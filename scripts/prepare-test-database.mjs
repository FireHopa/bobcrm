import mysql from "mysql2/promise";

const database = String(process.env.MYSQL_DATABASE || "").trim();
if (!/^crm_phase6_[a-zA-Z0-9_]+$/.test(database)) {
  throw new Error("MYSQL_DATABASE deve começar com crm_phase6_ para permitir preparação descartável.");
}
const connection = await mysql.createConnection({
  host: process.env.MYSQL_TEST_HOST || process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_TEST_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_TEST_USER || process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_TEST_PASSWORD || process.env.MYSQL_PASSWORD || "",
});
try {
  await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  console.log(`Banco descartável preparado: ${database}`);
} finally {
  await connection.end();
}
