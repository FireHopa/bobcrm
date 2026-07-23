import { existsSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import {
  inspectEncryptedMysqlBackup,
  resolveBackupSettings,
  restoreEncryptedMysqlBackup,
} from "../server/backup/mysqlBackup.js";

function getArg(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : "";
}

function safeIdentifier(value) {
  const normalized = String(value || "");
  if (!/^[A-Za-z0-9_]+$/.test(normalized)) throw new Error("Nome do banco de destino inválido.");
  return normalized;
}

const filePath = path.resolve(getArg("file"));
const targetDatabase = safeIdentifier(getArg("target"));
if (!getArg("file") || !targetDatabase) {
  throw new Error("Uso: npm run backup:restore -- --file /caminho/backup.cadbkp --target crm_restore_test_destino");
}
if (!existsSync(filePath)) throw new Error("Arquivo de backup não encontrado.");

const settings = resolveBackupSettings({ env: process.env, projectRoot: process.cwd() });
const source = await inspectEncryptedMysqlBackup(filePath);
const allowAnyTarget = process.env.BACKUP_RESTORE_ALLOW_ANY_TARGET === "1";
if (allowAnyTarget && process.env.BACKUP_RESTORE_CONFIRM_DATABASE !== targetDatabase) {
  throw new Error("Para destino fora do prefixo seguro, defina BACKUP_RESTORE_CONFIRM_DATABASE exatamente com o nome do banco alvo.");
}
if (targetDatabase === source.header.databaseName) {
  throw new Error("A restauração no banco de origem é bloqueada. Use um banco vazio com outro nome.");
}

const connectionConfig = {
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
};
let admin;
let databaseCreated = false;
try {
  admin = await mysql.createConnection(connectionConfig);
  const [databaseRows] = await admin.query(
    "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
    [targetDatabase],
  );
  if (!databaseRows.length) {
    await admin.query(`CREATE DATABASE \`${targetDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    databaseCreated = true;
  } else {
    const [[tableCount]] = await admin.query(
      "SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
      [targetDatabase],
    );
    if (Number(tableCount.total) > 0) {
      throw new Error("O banco de destino não está vazio. A restauração foi bloqueada sem alterar dados.");
    }
  }

  const result = await restoreEncryptedMysqlBackup({
    settings,
    database: { ...connectionConfig, database: source.header.databaseName },
    targetDatabase,
    filePath,
    allowAnyTarget,
  });
  const [[restoredTables]] = await admin.query(
    "SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
    [targetDatabase],
  );
  if (Number(restoredTables.total) === 0) throw new Error("Restauração terminou sem criar tabelas.");

  console.log(JSON.stringify({
    ok: true,
    sourceDatabase: result.sourceDatabase,
    targetDatabase: result.targetDatabase,
    targetWasCreated: databaseCreated,
    restoredTables: Number(restoredTables.total),
    restoredAt: result.restoredAt,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    targetDatabase,
    targetWasCreated: databaseCreated,
    message: error.message,
    recovery: databaseCreated
      ? "O banco criado para a restauração foi preservado para diagnóstico. Revise-o antes de excluir manualmente."
      : "Nenhum banco foi criado por este comando.",
  }, null, 2));
  process.exitCode = 1;
} finally {
  await admin?.end().catch(() => undefined);
}
