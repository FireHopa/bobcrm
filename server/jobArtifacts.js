import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import path from "node:path";

function parseBoundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function isPathInside(parentDirectory, candidatePath) {
  const relative = path.relative(path.resolve(parentDirectory), path.resolve(candidatePath));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function resolveJobArtifactSettings({ env = process.env, projectRoot, isProduction = false } = {}) {
  const storageRoot = path.resolve(projectRoot, env.JOB_ARTIFACT_DIR || "../crm-casa-ads-job-artifacts");
  if (isProduction && !isPathInside(path.dirname(projectRoot), storageRoot) && storageRoot === path.resolve(projectRoot)) {
    throw new Error("JOB_ARTIFACT_DIR deve apontar para armazenamento externo ao projeto em produção.");
  }
  if (isProduction) {
    const relative = path.relative(path.resolve(projectRoot), storageRoot);
    if (!relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("JOB_ARTIFACT_DIR deve ficar fora da pasta do projeto em produção.");
    }
  }

  return {
    storageRoot,
    artifactTtlHours: parseBoundedInteger(env.JOB_ARTIFACT_TTL_HOURS, 24, 1, 168),
    jobRetentionDays: parseBoundedInteger(env.JOB_RETENTION_DAYS, 7, 1, 90),
  };
}

export async function ensureJobArtifactStorage(storageRoot) {
  await mkdir(storageRoot, { recursive: true, mode: 0o700 });
  await chmod(storageRoot, 0o700).catch(() => undefined);
}

export function createJobStorageKey(kind, extension) {
  const safeKind = String(kind || "job").replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
  const safeExtension = String(extension || "bin")
    .split(".")
    .map((part) => part.replace(/[^a-z0-9]/gi, "").toLowerCase())
    .filter(Boolean)
    .join(".") || "bin";
  const day = new Date().toISOString().slice(0, 10);
  return `${day}/${safeKind}-${randomUUID()}.${safeExtension}`;
}

export function resolveJobStoragePath(storageRoot, storageKey) {
  const candidate = path.resolve(storageRoot, String(storageKey || ""));
  if (!isPathInside(storageRoot, candidate)) {
    const error = new Error("Caminho de artifact de job inválido.");
    error.code = "INVALID_JOB_ARTIFACT_PATH";
    throw error;
  }
  return candidate;
}

export async function prepareJobStoragePath(storageRoot, storageKey) {
  const filePath = resolveJobStoragePath(storageRoot, storageKey);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  return filePath;
}

export async function writeJsonJobPayload({ storageRoot, payload }) {
  const storageKey = createJobStorageKey("import-payload", "json.gz");
  const filePath = await prepareJobStoragePath(storageRoot, storageKey);
  const source = Readable.from([JSON.stringify(payload)]);
  const output = createWriteStream(filePath, { flags: "wx", mode: 0o600 });
  await pipeline(source, createGzip({ level: 6 }), output);
  await chmod(filePath, 0o600).catch(() => undefined);
  return { storageKey, filePath };
}

export async function readJsonJobPayload({ storageRoot, storageKey, maxBytes = 64 * 1024 * 1024 }) {
  const filePath = resolveJobStoragePath(storageRoot, storageKey);
  const chunks = [];
  let bytes = 0;
  const gunzip = createGunzip();
  gunzip.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      const error = new Error("Payload descompactado do job excede o limite permitido.");
      error.code = "JOB_PAYLOAD_TOO_LARGE";
      gunzip.destroy(error);
      return;
    }
    chunks.push(chunk);
  });
  await pipeline(createReadStream(filePath), gunzip);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function hashJobArtifact(filePath) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

export async function describeJobArtifact({ storageRoot, storageKey, fileName, contentType }) {
  const filePath = resolveJobStoragePath(storageRoot, storageKey);
  const [details, sha256] = await Promise.all([stat(filePath), hashJobArtifact(filePath)]);
  return {
    storageKey,
    fileName,
    contentType,
    sizeBytes: details.size,
    sha256,
    filePath,
  };
}

export async function removeJobArtifact({ storageRoot, storageKey }) {
  if (!storageKey) return false;
  const filePath = resolveJobStoragePath(storageRoot, storageKey);
  await rm(filePath, { force: true });
  return true;
}

export function jobArtifactExpiryIso(ttlHours, now = Date.now()) {
  return new Date(now + Math.max(1, Number(ttlHours || 1)) * 60 * 60 * 1000).toISOString();
}

export function jobRecordExpiryIso(retentionDays, now = Date.now()) {
  return new Date(now + Math.max(1, Number(retentionDays || 1)) * 24 * 60 * 60 * 1000).toISOString();
}
