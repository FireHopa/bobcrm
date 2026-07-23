import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(projectRoot, "server", ".env");

if (!existsSync(envPath)) {
  console.error("server/.env não encontrado. Copie server/.env.example ou o .env da instalação anterior antes de executar este comando.");
  process.exitCode = 1;
} else {
  const recommended = new Map([
    ["MAX_BODY_BYTES", "16777216"],
    ["DEFAULT_LEADS_PAGE_LIMIT", "150"],
    ["MAX_LEADS_PAGE_LIMIT", "1000"],
    ["EXPORT_PAGE_SIZE", "5000"],
    ["SEARCH_INDEX_REBUILD_ON_START", "0"],
    ["JOB_POLL_INTERVAL_MS", "1500"],
  ]);

  const original = await readFile(envPath, "utf8");
  const lines = original.split(/\r?\n/);
  const found = new Set();
  const updated = lines.map((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (!match || !recommended.has(match[1])) return line;
    found.add(match[1]);
    return `${match[1]}=${recommended.get(match[1])}`;
  });

  for (const [key, value] of recommended) {
    if (!found.has(key)) updated.push(`${key}=${value}`);
  }

  await writeFile(envPath, `${updated.join("\n").replace(/\n+$/, "")}\n`, { mode: 0o600 });
  console.log("Configurações operacionais do server/.env normalizadas sem alterar credenciais, tokens ou chaves.");
}
