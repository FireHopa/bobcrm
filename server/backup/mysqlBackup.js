import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  appendFile,
  chmod,
  mkdtemp,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";

export const BACKUP_MAGIC = Buffer.from("CADBKP01", "ascii");
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_AUTH_TAG_BYTES = 16;
export const BACKUP_IV_BYTES = 12;
export const BACKUP_EXTENSION = ".cadbkp";
const HEADER_LENGTH_BYTES = 4;
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function assertNoLineBreak(value, label) {
  if (/\r|\n/.test(String(value ?? ""))) {
    const error = new Error(`${label} contém caracteres inválidos.`);
    error.code = "INVALID_DATABASE_CONFIG";
    throw error;
  }
}

function normalizeDatabaseConfig(database) {
  const normalized = {
    host: String(database?.host || "127.0.0.1"),
    port: boundedInteger(database?.port, 3306, 1, 65535),
    user: String(database?.user || "root"),
    password: String(database?.password || ""),
    database: String(database?.database || ""),
  };

  Object.entries(normalized).forEach(([key, value]) => assertNoLineBreak(value, `MYSQL_${key.toUpperCase()}`));
  if (!/^[A-Za-z0-9_]+$/.test(normalized.database)) {
    const error = new Error("Nome do banco MySQL inválido para backup.");
    error.code = "INVALID_DATABASE_NAME";
    throw error;
  }
  return normalized;
}

function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveBackupSettings({ env = process.env, projectRoot = process.cwd(), isProduction = env.NODE_ENV === "production" } = {}) {
  const configuredStorage = String(env.BACKUP_EXTERNAL_DIR || env.BACKUP_DIR || path.join(projectRoot, "server", "backups")).trim();
  const storageRoot = path.resolve(projectRoot, configuredStorage);
  const requireExternal = String(env.BACKUP_REQUIRE_EXTERNAL_STORAGE ?? (isProduction ? "1" : "0")) === "1";

  if (requireExternal && isPathInside(projectRoot, storageRoot)) {
    const error = new Error("BACKUP_EXTERNAL_DIR deve apontar para um volume externo ao projeto.");
    error.code = "BACKUP_STORAGE_NOT_EXTERNAL";
    throw error;
  }

  return {
    storageRoot,
    requireExternal,
    encryptionKey: String(env.BACKUP_ENCRYPTION_KEY || "").trim(),
    retentionDays: boundedInteger(env.BACKUP_RETENTION_DAYS, 30, 1, 3650),
    retentionCount: boundedInteger(env.BACKUP_RETENTION_COUNT, 30, 1, 1000),
    commandTimeoutMs: boundedInteger(env.BACKUP_COMMAND_TIMEOUT_MS, 30 * 60 * 1000, 30_000, 6 * 60 * 60 * 1000),
    mysqldumpBinary: String(env.MYSQLDUMP_BIN || "mysqldump").trim(),
    mysqlBinary: String(env.MYSQL_BIN || "mysql").trim(),
    restoreDatabasePrefix: String(env.BACKUP_RESTORE_DATABASE_PREFIX || "crm_restore_test_").replace(/[^A-Za-z0-9_]/g, "") || "crm_restore_test_",
  };
}

export function parseBackupEncryptionKey(rawValue) {
  const raw = String(rawValue || "").trim();
  let key;
  if (/^[a-fA-F0-9]{64}$/.test(raw)) key = Buffer.from(raw, "hex");
  else {
    try {
      key = Buffer.from(raw, "base64");
    } catch {
      key = Buffer.alloc(0);
    }
  }
  if (key.length !== 32) {
    const error = new Error("BACKUP_ENCRYPTION_KEY deve conter exatamente 32 bytes em Base64 ou 64 caracteres hexadecimais.");
    error.code = "INVALID_BACKUP_ENCRYPTION_KEY";
    throw error;
  }
  return key;
}

function escapeOptionFileValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function withMysqlDefaultsFile(database, callback) {
  const normalized = normalizeDatabaseConfig(database);
  const directory = await mkdtemp(path.join(os.tmpdir(), "crm-mysql-auth-"));
  const filePath = path.join(directory, "client.cnf");
  const content = [
    "[client]",
    `host="${escapeOptionFileValue(normalized.host)}"`,
    `port=${normalized.port}`,
    `user="${escapeOptionFileValue(normalized.user)}"`,
    `password="${escapeOptionFileValue(normalized.password)}"`,
    "protocol=tcp",
    "default-character-set=utf8mb4",
    "",
  ].join("\n");

  try {
    await writeFile(filePath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(filePath, 0o600);
    return await callback({ defaultsFile: filePath, database: normalized });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function buildDumpArguments(defaultsFile, databaseName) {
  return [
    `--defaults-extra-file=${defaultsFile}`,
    "--single-transaction",
    "--quick",
    "--routines",
    "--events",
    "--triggers",
    "--hex-blob",
    "--default-character-set=utf8mb4",
    "--skip-lock-tables",
    "--no-tablespaces",
    databaseName,
  ];
}

function buildRestoreArguments(defaultsFile, databaseName) {
  return [
    `--defaults-extra-file=${defaultsFile}`,
    "--default-character-set=utf8mb4",
    databaseName,
  ];
}

export function getNativeBackupArgumentsForTest({ defaultsFile = "/tmp/client.cnf", databaseName = "crm_test" } = {}) {
  return {
    dump: buildDumpArguments(defaultsFile, databaseName),
    restore: buildRestoreArguments(defaultsFile, databaseName),
  };
}

function createProcessMonitor(child, { command, timeoutMs }) {
  let stderr = "";
  let timedOut = false;
  let killTimer;

  child.stderr?.on("data", (chunk) => {
    if (stderr.length >= MAX_STDERR_BYTES) return;
    stderr += chunk.toString("utf8").slice(0, MAX_STDERR_BYTES - stderr.length);
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
    killTimer.unref?.();
  }, timeoutMs);
  timeout.unref?.();

  return new Promise((resolve, reject) => {
    child.once("error", (cause) => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      const error = new Error(cause.code === "ENOENT"
        ? `Executável obrigatório não encontrado: ${command}.`
        : `Falha ao iniciar ${command}: ${cause.message}`);
      error.code = cause.code === "ENOENT" ? "BACKUP_BINARY_NOT_FOUND" : "BACKUP_PROCESS_START_FAILED";
      error.cause = cause;
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      if (code === 0 && !timedOut) {
        resolve({ stderr });
        return;
      }
      const reason = timedOut ? "tempo limite excedido" : `código ${code ?? "desconhecido"}${signal ? `, sinal ${signal}` : ""}`;
      const error = new Error(`${command} falhou: ${reason}.${stderr.trim() ? ` ${stderr.trim()}` : ""}`);
      error.code = timedOut ? "BACKUP_PROCESS_TIMEOUT" : "BACKUP_PROCESS_FAILED";
      reject(error);
    });
  });
}

function spawnNative(spawnImpl, command, args, options) {
  return spawnImpl(command, args, {
    windowsHide: true,
    shell: false,
    ...options,
  });
}

function buildHeader({ createdAt, databaseName, serverVersion, iv, key }) {
  return {
    format: "crm-casa-ads-mysql-backup",
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt,
    databaseName,
    serverVersion: String(serverVersion || "unknown").slice(0, 120),
    cipher: "aes-256-gcm",
    compression: "gzip",
    iv: iv.toString("base64"),
    authTagBytes: BACKUP_AUTH_TAG_BYTES,
    keyFingerprint: createHash("sha256").update(key).digest("hex").slice(0, 16),
  };
}

function serializeHeader(header) {
  const headerBuffer = Buffer.from(JSON.stringify(header), "utf8");
  if (headerBuffer.length > MAX_HEADER_BYTES) throw new Error("Cabeçalho de backup excedeu o limite de segurança.");
  const length = Buffer.alloc(HEADER_LENGTH_BYTES);
  length.writeUInt32BE(headerBuffer.length, 0);
  return Buffer.concat([BACKUP_MAGIC, length, headerBuffer]);
}

function createTimestampFileName(createdAt) {
  const stamp = new Date(createdAt).toISOString().replace(/[:.]/g, "-");
  return `crm-casa-do-ads-mysql-${stamp}${BACKUP_EXTENSION}`;
}

export function resolveStoragePath(storageRoot, storageKey) {
  const key = String(storageKey || "");
  if (!key || path.isAbsolute(key) || key.includes("\0")) {
    const error = new Error("Identificador de armazenamento de backup inválido.");
    error.code = "INVALID_BACKUP_STORAGE_KEY";
    throw error;
  }
  const candidate = path.resolve(storageRoot, key);
  if (!isPathInside(storageRoot, candidate) || candidate === path.resolve(storageRoot)) {
    const error = new Error("Caminho de backup fora do armazenamento autorizado.");
    error.code = "BACKUP_PATH_OUTSIDE_STORAGE";
    throw error;
  }
  return candidate;
}

export async function computeFileSha256(filePath) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), new Writable({
    write(chunk, _encoding, callback) {
      hash.update(chunk);
      callback();
    },
  }));
  return hash.digest("hex");
}

export async function inspectEncryptedMysqlBackup(filePath) {
  const handle = await open(filePath, "r");
  try {
    const prefix = Buffer.alloc(BACKUP_MAGIC.length + HEADER_LENGTH_BYTES);
    const prefixRead = await handle.read(prefix, 0, prefix.length, 0);
    if (prefixRead.bytesRead !== prefix.length || !prefix.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
      const error = new Error("Arquivo não possui o formato de backup do CRM.");
      error.code = "INVALID_BACKUP_FORMAT";
      throw error;
    }
    const headerLength = prefix.readUInt32BE(BACKUP_MAGIC.length);
    if (headerLength < 2 || headerLength > MAX_HEADER_BYTES) {
      const error = new Error("Cabeçalho de backup inválido.");
      error.code = "INVALID_BACKUP_HEADER";
      throw error;
    }
    const headerBuffer = Buffer.alloc(headerLength);
    const headerRead = await handle.read(headerBuffer, 0, headerLength, prefix.length);
    if (headerRead.bytesRead !== headerLength) throw new Error("Backup truncado durante leitura do cabeçalho.");
    let header;
    try {
      header = JSON.parse(headerBuffer.toString("utf8"));
    } catch {
      const error = new Error("Cabeçalho JSON do backup é inválido.");
      error.code = "INVALID_BACKUP_HEADER";
      throw error;
    }
    if (header.format !== "crm-casa-ads-mysql-backup" || header.formatVersion !== BACKUP_FORMAT_VERSION) {
      const error = new Error("Versão de backup não suportada.");
      error.code = "UNSUPPORTED_BACKUP_VERSION";
      throw error;
    }
    const fileStat = await handle.stat();
    const payloadOffset = prefix.length + headerLength;
    if (fileStat.size <= payloadOffset + BACKUP_AUTH_TAG_BYTES) {
      const error = new Error("Backup criptografado está vazio ou truncado.");
      error.code = "TRUNCATED_BACKUP";
      throw error;
    }
    const authTag = Buffer.alloc(BACKUP_AUTH_TAG_BYTES);
    await handle.read(authTag, 0, BACKUP_AUTH_TAG_BYTES, fileStat.size - BACKUP_AUTH_TAG_BYTES);
    return {
      header,
      authenticatedHeader: Buffer.concat([prefix, headerBuffer]),
      sizeBytes: fileStat.size,
      payloadOffset,
      payloadEnd: fileStat.size - BACKUP_AUTH_TAG_BYTES - 1,
      authTag,
    };
  } finally {
    await handle.close();
  }
}

function createDecryptAndGunzipStreams({ filePath, encryptionKey, inspected }) {
  const key = parseBackupEncryptionKey(encryptionKey);
  const iv = Buffer.from(String(inspected.header.iv || ""), "base64");
  if (iv.length !== BACKUP_IV_BYTES) {
    const error = new Error("IV do backup é inválido.");
    error.code = "INVALID_BACKUP_HEADER";
    throw error;
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: BACKUP_AUTH_TAG_BYTES });
  decipher.setAAD(inspected.authenticatedHeader);
  decipher.setAuthTag(inspected.authTag);
  return {
    source: createReadStream(filePath, { start: inspected.payloadOffset, end: inspected.payloadEnd }),
    decipher,
    gunzip: createGunzip(),
  };
}

export async function createEncryptedMysqlBackup({
  settings,
  database,
  serverVersion = "unknown",
  createdAt = new Date().toISOString(),
  spawnImpl = spawn,
} = {}) {
  const normalizedDatabase = normalizeDatabaseConfig(database);
  const key = parseBackupEncryptionKey(settings?.encryptionKey);
  await mkdir(settings.storageRoot, { recursive: true, mode: 0o700 });
  await chmod(settings.storageRoot, 0o700).catch(() => undefined);

  const fileName = createTimestampFileName(createdAt);
  const storageKey = fileName;
  const finalPath = resolveStoragePath(settings.storageRoot, storageKey);
  const temporaryPath = `${finalPath}.partial-${process.pid}-${randomBytes(4).toString("hex")}`;
  const iv = randomBytes(BACKUP_IV_BYTES);
  const header = buildHeader({ createdAt, databaseName: normalizedDatabase.database, serverVersion, iv, key });
  const prefix = serializeHeader(header);

  try {
    await writeFile(temporaryPath, prefix, { flag: "wx", mode: 0o600 });
    await withMysqlDefaultsFile(normalizedDatabase, async ({ defaultsFile }) => {
      const child = spawnNative(spawnImpl, settings.mysqldumpBinary, buildDumpArguments(defaultsFile, normalizedDatabase.database), {
        stdio: ["ignore", "pipe", "pipe"],
      });
      const monitor = createProcessMonitor(child, { command: settings.mysqldumpBinary, timeoutMs: settings.commandTimeoutMs });
      const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: BACKUP_AUTH_TAG_BYTES });
      cipher.setAAD(prefix);
      const output = createWriteStream(temporaryPath, { flags: "a", mode: 0o600 });
      const streamResult = pipeline(child.stdout, createGzip({ level: 6 }), cipher, output);
      const results = await Promise.allSettled([monitor, streamResult]);
      const failure = results.find((result) => result.status === "rejected");
      if (failure) {
        child.kill("SIGKILL");
        throw failure.reason;
      }
      await appendFile(temporaryPath, cipher.getAuthTag());
    });

    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, finalPath);
    const fileStat = await stat(finalPath);
    const sha256 = await computeFileSha256(finalPath);
    return {
      fileName,
      storageKey,
      filePath: finalPath,
      sizeBytes: fileStat.size,
      sha256,
      createdAt,
      retentionExpiresAt: new Date(new Date(createdAt).getTime() + settings.retentionDays * 86_400_000).toISOString(),
      encryption: "aes-256-gcm",
      compression: "gzip",
      formatVersion: BACKUP_FORMAT_VERSION,
      databaseName: normalizedDatabase.database,
      storageProvider: "external_filesystem",
    };
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function verifyEncryptedMysqlBackup({ filePath, encryptionKey } = {}) {
  const inspected = await inspectEncryptedMysqlBackup(filePath);
  const streams = createDecryptAndGunzipStreams({ filePath, encryptionKey, inspected });
  let sqlBytes = 0;
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      sqlBytes += chunk.length;
      callback();
    },
  });
  try {
    await pipeline(streams.source, streams.decipher, streams.gunzip, sink);
  } catch (cause) {
    const error = new Error("Falha na verificação criptográfica ou na descompressão do backup.");
    error.code = "BACKUP_VERIFICATION_FAILED";
    error.cause = cause;
    throw error;
  }
  if (sqlBytes === 0) {
    const error = new Error("Backup verificado não contém dump SQL.");
    error.code = "EMPTY_BACKUP_DUMP";
    throw error;
  }
  return { ...inspected, sqlBytes, verifiedAt: new Date().toISOString() };
}

export function assertSafeRestoreTarget({ sourceDatabase, targetDatabase, requiredPrefix, allowAnyTarget = false }) {
  const source = String(sourceDatabase || "");
  const target = String(targetDatabase || "");
  if (!/^[A-Za-z0-9_]+$/.test(target)) {
    const error = new Error("Nome do banco de restauração inválido.");
    error.code = "INVALID_RESTORE_DATABASE";
    throw error;
  }
  if (target === source) {
    const error = new Error("A restauração nunca pode apontar para o banco de origem.");
    error.code = "RESTORE_TARGET_IS_SOURCE";
    throw error;
  }
  if (!allowAnyTarget && !target.startsWith(requiredPrefix)) {
    const error = new Error(`Banco de restauração deve começar com ${requiredPrefix}.`);
    error.code = "UNSAFE_RESTORE_DATABASE";
    throw error;
  }
}

export async function restoreEncryptedMysqlBackup({
  settings,
  database,
  targetDatabase,
  filePath,
  allowAnyTarget = false,
  spawnImpl = spawn,
} = {}) {
  const normalizedDatabase = normalizeDatabaseConfig({ ...database, database: targetDatabase });
  const inspected = await inspectEncryptedMysqlBackup(filePath);
  assertSafeRestoreTarget({
    sourceDatabase: inspected.header.databaseName,
    targetDatabase: normalizedDatabase.database,
    requiredPrefix: settings.restoreDatabasePrefix,
    allowAnyTarget,
  });

  const streams = createDecryptAndGunzipStreams({ filePath, encryptionKey: settings.encryptionKey, inspected });
  await withMysqlDefaultsFile(normalizedDatabase, async ({ defaultsFile }) => {
    const child = spawnNative(spawnImpl, settings.mysqlBinary, buildRestoreArguments(defaultsFile, normalizedDatabase.database), {
      stdio: ["pipe", "ignore", "pipe"],
    });
    const monitor = createProcessMonitor(child, { command: settings.mysqlBinary, timeoutMs: settings.commandTimeoutMs });
    const streamResult = pipeline(streams.source, streams.decipher, streams.gunzip, child.stdin);
    const results = await Promise.allSettled([monitor, streamResult]);
    const failure = results.find((result) => result.status === "rejected");
    if (failure) {
      child.kill("SIGKILL");
      throw failure.reason;
    }
  });

  return {
    restoredAt: new Date().toISOString(),
    targetDatabase: normalizedDatabase.database,
    sourceDatabase: inspected.header.databaseName,
  };
}

export function selectBackupsForRetention(records, { retentionCount, now = new Date() } = {}) {
  const safeCount = Math.max(1, Number(retentionCount || 1));
  const ordered = [...records]
    .filter((record) => record && record.storage_key && !record.expired_at && ["completed", "verified"].includes(record.status))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  const keepIds = new Set(ordered.slice(0, safeCount).map((record) => record.id));
  const nowMs = now.getTime();
  return ordered.filter((record) => {
    if (keepIds.has(record.id)) return false;
    const expiresAt = Date.parse(record.retention_expires_at || "");
    return Number.isFinite(expiresAt) && expiresAt <= nowMs;
  });
}

export async function removeBackupArtifact({ storageRoot, storageKey }) {
  const filePath = resolveStoragePath(storageRoot, storageKey);
  await unlink(filePath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  return filePath;
}
