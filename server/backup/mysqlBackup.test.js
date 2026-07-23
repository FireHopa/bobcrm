import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertSafeRestoreTarget,
  createEncryptedMysqlBackup,
  getNativeBackupArgumentsForTest,
  inspectEncryptedMysqlBackup,
  parseBackupEncryptionKey,
  resolveBackupSettings,
  restoreEncryptedMysqlBackup,
  selectBackupsForRetention,
  verifyEncryptedMysqlBackup,
} from "./mysqlBackup.js";

const SQL_FIXTURE = [
  "CREATE TABLE users (id VARCHAR(64) PRIMARY KEY, name VARCHAR(255));",
  "INSERT INTO users VALUES ('u1', 'Administrador');",
  "CREATE TABLE leads (id VARCHAR(64) PRIMARY KEY, name VARCHAR(255));",
  "INSERT INTO leads VALUES ('l1', 'Lead Teste');",
  "",
].join("\n");

async function createFakeBinary(directory, name, source) {
  const filePath = path.join(directory, name);
  await writeFile(filePath, `#!/usr/bin/env node\n${source}\n`, "utf8");
  await chmod(filePath, 0o755);
  return filePath;
}

async function withBackupFixture(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "crm-backup-test-"));
  const storageRoot = path.join(root, "external-storage");
  const dumpBinary = await createFakeBinary(root, "fake-mysqldump", `process.stdout.write(${JSON.stringify(SQL_FIXTURE)});`);
  const mysqlBinary = await createFakeBinary(root, "fake-mysql", `
    const fs = require("node:fs");
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => fs.writeFileSync(process.env.FAKE_MYSQL_OUTPUT, Buffer.concat(chunks)));
  `);
  const encryptionKey = randomBytes(32).toString("base64");
  const settings = {
    storageRoot,
    encryptionKey,
    retentionDays: 30,
    retentionCount: 3,
    commandTimeoutMs: 10_000,
    mysqldumpBinary: dumpBinary,
    mysqlBinary,
    restoreDatabasePrefix: "crm_restore_test_",
  };
  const database = { host: "127.0.0.1", port: 3306, user: "crm", password: "secret", database: "crm_source" };
  try {
    await callback({ root, storageRoot, settings, database });
  } finally {
    delete process.env.FAKE_MYSQL_OUTPUT;
    await rm(root, { recursive: true, force: true });
  }
}

test("backup nativo usa snapshot consistente e inclui objetos completos", () => {
  const args = getNativeBackupArgumentsForTest();
  for (const option of ["--single-transaction", "--quick", "--routines", "--events", "--triggers", "--hex-blob"]) {
    assert.ok(args.dump.includes(option), `opção ausente: ${option}`);
  }
  assert.equal(args.dump.at(-1), "crm_test");
  assert.equal(args.restore.at(-1), "crm_test");
});

test("chave de backup aceita somente 32 bytes", () => {
  assert.equal(parseBackupEncryptionKey(randomBytes(32).toString("base64")).length, 32);
  assert.equal(parseBackupEncryptionKey(randomBytes(32).toString("hex")).length, 32);
  assert.throws(() => parseBackupEncryptionKey("curta"), { code: "INVALID_BACKUP_ENCRYPTION_KEY" });
});

test("produção exige armazenamento externo ao projeto", () => {
  assert.throws(() => resolveBackupSettings({
    projectRoot: "/app/crm",
    isProduction: true,
    env: { NODE_ENV: "production", BACKUP_EXTERNAL_DIR: "/app/crm/server/backups", BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64") },
  }), { code: "BACKUP_STORAGE_NOT_EXTERNAL" });

  const settings = resolveBackupSettings({
    projectRoot: "/app/crm",
    isProduction: true,
    env: { NODE_ENV: "production", BACKUP_EXTERNAL_DIR: "/var/backups/crm", BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64") },
  });
  assert.equal(settings.storageRoot, "/var/backups/crm");
});

test("cria, verifica e restaura backup criptografado por streaming", { concurrency: false }, async () => {
  await withBackupFixture(async ({ root, settings, database }) => {
    const backup = await createEncryptedMysqlBackup({ settings, database, serverVersion: "8.0-test", createdAt: "2026-07-07T12:00:00.000Z" });
    const encrypted = await readFile(backup.filePath);
    assert.equal(encrypted.includes(Buffer.from("Lead Teste")), false);
    assert.match(backup.fileName, /\.cadbkp$/);
    assert.equal(backup.sha256.length, 64);

    const inspected = await inspectEncryptedMysqlBackup(backup.filePath);
    assert.equal(inspected.header.databaseName, "crm_source");
    assert.equal(inspected.header.cipher, "aes-256-gcm");

    const verification = await verifyEncryptedMysqlBackup({ filePath: backup.filePath, encryptionKey: settings.encryptionKey });
    assert.equal(verification.sqlBytes, Buffer.byteLength(SQL_FIXTURE));

    const restoredSqlPath = path.join(root, "restored.sql");
    process.env.FAKE_MYSQL_OUTPUT = restoredSqlPath;
    const restored = await restoreEncryptedMysqlBackup({
      settings,
      database,
      targetDatabase: "crm_restore_test_empty",
      filePath: backup.filePath,
    });
    assert.equal(restored.targetDatabase, "crm_restore_test_empty");
    assert.equal(await readFile(restoredSqlPath, "utf8"), SQL_FIXTURE);
  });
});

test("backup adulterado, cabeçalho alterado ou chave incorreta falha na verificação", async () => {
  await withBackupFixture(async ({ settings, database }) => {
    const backup = await createEncryptedMysqlBackup({ settings, database, createdAt: "2026-07-07T12:00:00.000Z" });
    await assert.rejects(
      verifyEncryptedMysqlBackup({ filePath: backup.filePath, encryptionKey: randomBytes(32).toString("base64") }),
      { code: "BACKUP_VERIFICATION_FAILED" },
    );

    const originalBytes = await readFile(backup.filePath);
    const inspected = await inspectEncryptedMysqlBackup(backup.filePath);
    const payloadTampered = Buffer.from(originalBytes);
    payloadTampered[inspected.payloadOffset + 1] ^= 0xff;
    await writeFile(backup.filePath, payloadTampered);
    await assert.rejects(
      verifyEncryptedMysqlBackup({ filePath: backup.filePath, encryptionKey: settings.encryptionKey }),
      { code: "BACKUP_VERIFICATION_FAILED" },
    );

    const headerTampered = Buffer.from(originalBytes);
    const createdAtMarker = Buffer.from("2026-07-07T12:00:00.000Z");
    const markerIndex = headerTampered.indexOf(createdAtMarker);
    assert.ok(markerIndex > 0);
    headerTampered[markerIndex + 3] = "7".charCodeAt(0);
    await writeFile(backup.filePath, headerTampered);
    await assert.rejects(
      verifyEncryptedMysqlBackup({ filePath: backup.filePath, encryptionKey: settings.encryptionKey }),
      { code: "BACKUP_VERIFICATION_FAILED" },
    );
  });
});

test("restauração bloqueia banco original e nomes fora do prefixo", () => {
  assert.throws(() => assertSafeRestoreTarget({ sourceDatabase: "crm", targetDatabase: "crm", requiredPrefix: "crm_restore_test_" }), { code: "RESTORE_TARGET_IS_SOURCE" });
  assert.throws(() => assertSafeRestoreTarget({ sourceDatabase: "crm", targetDatabase: "producao", requiredPrefix: "crm_restore_test_" }), { code: "UNSAFE_RESTORE_DATABASE" });
  assert.doesNotThrow(() => assertSafeRestoreTarget({ sourceDatabase: "crm", targetDatabase: "crm_restore_test_123", requiredPrefix: "crm_restore_test_" }));
});

test("retenção preserva a quantidade mínima e expira somente arquivos vencidos", () => {
  const records = [
    { id: "4", status: "verified", storage_key: "4.cadbkp", created_at: "2026-07-04T00:00:00Z", retention_expires_at: "2026-07-05T00:00:00Z", expired_at: "" },
    { id: "3", status: "verified", storage_key: "3.cadbkp", created_at: "2026-07-03T00:00:00Z", retention_expires_at: "2026-07-05T00:00:00Z", expired_at: "" },
    { id: "2", status: "verified", storage_key: "2.cadbkp", created_at: "2026-07-02T00:00:00Z", retention_expires_at: "2026-07-06T00:00:00Z", expired_at: "" },
    { id: "1", status: "verified", storage_key: "1.cadbkp", created_at: "2026-07-01T00:00:00Z", retention_expires_at: "2026-08-01T00:00:00Z", expired_at: "" },
  ];
  const expired = selectBackupsForRetention(records, { retentionCount: 2, now: new Date("2026-07-07T00:00:00Z") });
  assert.deepEqual(expired.map((item) => item.id), ["2"]);
});
