import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import {
  createEncryptedMysqlBackup,
  resolveBackupSettings,
  restoreEncryptedMysqlBackup,
  verifyEncryptedMysqlBackup,
} from "../server/backup/mysqlBackup.js";

function safeIdentifier(value) {
  const normalized = String(value || "").replace(/[^A-Za-z0-9_]/g, "");
  if (!normalized) throw new Error("Identificador MySQL de teste inválido.");
  return normalized.slice(0, 64);
}

const stamp = `${Date.now()}_${randomBytes(3).toString("hex")}`;
const prefix = safeIdentifier(process.env.BACKUP_RESTORE_DATABASE_PREFIX || "crm_restore_test_");
const sourceDatabase = safeIdentifier(`${prefix}source_${stamp}`);
const targetDatabase = safeIdentifier(`${prefix}target_${stamp}`);
const host = process.env.BACKUP_TEST_MYSQL_HOST || process.env.MYSQL_HOST || "127.0.0.1";
const port = Number(process.env.BACKUP_TEST_MYSQL_PORT || process.env.MYSQL_PORT || 3306);
const user = process.env.BACKUP_TEST_MYSQL_USER || process.env.MYSQL_USER || "root";
const password = process.env.BACKUP_TEST_MYSQL_PASSWORD ?? process.env.MYSQL_PASSWORD ?? "";
const storageRoot = await mkdtemp(path.join(os.tmpdir(), "crm-real-restore-test-"));
const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY || randomBytes(32).toString("base64");
const settings = {
  ...resolveBackupSettings({
    projectRoot: process.cwd(),
    isProduction: false,
    env: {
      ...process.env,
      BACKUP_EXTERNAL_DIR: storageRoot,
      BACKUP_ENCRYPTION_KEY: encryptionKey,
      BACKUP_RESTORE_DATABASE_PREFIX: prefix,
    },
  }),
  storageRoot,
  encryptionKey,
};
let admin;

async function dropDatabase(name) {
  if (!admin) return;
  await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
}

try {
  admin = await mysql.createConnection({ host, port, user, password, multipleStatements: true });
  await dropDatabase(sourceDatabase);
  await dropDatabase(targetDatabase);
  await admin.query(`CREATE DATABASE \`${sourceDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  const source = await mysql.createConnection({ host, port, user, password, database: sourceDatabase, multipleStatements: true });
  try {
    await source.query(`
      CREATE TABLE backup_probe (
        id INT NOT NULL PRIMARY KEY,
        label VARCHAR(120) NOT NULL,
        amount DECIMAL(12,2) NOT NULL
      ) ENGINE=InnoDB;
      CREATE TABLE backup_child (
        id INT NOT NULL PRIMARY KEY,
        probe_id INT NOT NULL,
        note VARCHAR(120) NOT NULL,
        CONSTRAINT fk_backup_child_probe FOREIGN KEY (probe_id) REFERENCES backup_probe(id)
      ) ENGINE=InnoDB;
      INSERT INTO backup_probe VALUES (1, 'Primeiro', 10.50), (2, 'Segundo', 20.75), (3, 'Terceiro', 30.00);
      INSERT INTO backup_child VALUES (1, 1, 'A'), (2, 2, 'B');
      CREATE VIEW backup_probe_view AS SELECT id, label FROM backup_probe;
      CREATE TRIGGER backup_probe_before_insert BEFORE INSERT ON backup_probe FOR EACH ROW SET NEW.label = TRIM(NEW.label);
      CREATE PROCEDURE backup_probe_count() SELECT COUNT(*) AS total FROM backup_probe;
    `);
  } finally {
    await source.end();
  }

  const [[versionRow]] = await admin.query("SELECT VERSION() AS version");
  const backup = await createEncryptedMysqlBackup({
    settings,
    database: { host, port, user, password, database: sourceDatabase },
    serverVersion: versionRow.version,
  });
  const verification = await verifyEncryptedMysqlBackup({ filePath: backup.filePath, encryptionKey });
  if (verification.sqlBytes <= 0) throw new Error("Dump restaurável ficou vazio.");

  await admin.query(`CREATE DATABASE \`${targetDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await restoreEncryptedMysqlBackup({
    settings,
    database: { host, port, user, password, database: sourceDatabase },
    targetDatabase,
    filePath: backup.filePath,
  });

  const target = await mysql.createConnection({ host, port, user, password, database: targetDatabase });
  try {
    const [[probeCount]] = await target.query("SELECT COUNT(*) AS total, SUM(amount) AS amount FROM backup_probe");
    const [[childCount]] = await target.query("SELECT COUNT(*) AS total FROM backup_child");
    const [[viewCount]] = await target.query("SELECT COUNT(*) AS total FROM backup_probe_view");
    const [[triggerCount]] = await admin.query(
      "SELECT COUNT(*) AS total FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? AND TRIGGER_NAME = 'backup_probe_before_insert'",
      [targetDatabase],
    );
    const [[routineCount]] = await admin.query(
      "SELECT COUNT(*) AS total FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME = 'backup_probe_count'",
      [targetDatabase],
    );
    if (Number(probeCount.total) !== 3 || String(probeCount.amount) !== "61.25") throw new Error("Dados da tabela principal divergiram após restauração.");
    if (Number(childCount.total) !== 2) throw new Error("Dados relacionados divergiram após restauração.");
    if (Number(viewCount.total) !== 3) throw new Error("View não foi restaurada corretamente.");
    if (Number(triggerCount.total) !== 1) throw new Error("Trigger não foi restaurado.");
    if (Number(routineCount.total) !== 1) throw new Error("Procedure não foi restaurada.");
  } finally {
    await target.end();
  }

  console.log(JSON.stringify({
    ok: true,
    sourceDatabase,
    targetDatabase,
    backupFile: backup.fileName,
    encryptedBytes: backup.sizeBytes,
    sqlBytes: verification.sqlBytes,
    verified: true,
    tablesValidated: 2,
    viewValidated: true,
    triggerValidated: true,
    routineValidated: true,
  }, null, 2));
} finally {
  await dropDatabase(targetDatabase).catch(() => undefined);
  await dropDatabase(sourceDatabase).catch(() => undefined);
  await admin?.end().catch(() => undefined);
  await rm(storageRoot, { recursive: true, force: true });
}
