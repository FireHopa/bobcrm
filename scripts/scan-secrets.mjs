import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findSecrets } from "./create-release.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const SKIPPED_DIRECTORIES = new Set([".git", "backups", "coverage", "data", "dist", "logs", "node_modules", "release", "tmp"]);
const TEXT_EXTENSIONS = new Set([".css", ".env", ".example", ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".sql", ".ts", ".tsx", ".txt", ".yaml", ".yml"]);
const MAX_SCAN_BYTES = 5 * 1024 * 1024;

function shouldScanFile(fileName) {
  if (fileName === ".gitignore" || fileName === "Dockerfile") return true;
  if (fileName.endsWith(".env.example")) return true;
  return TEXT_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

async function walk(root, relativeDirectory, output) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) await walk(root, relativePath, output);
      continue;
    }
    if (!entry.isFile() || !shouldScanFile(entry.name)) continue;
    const details = await stat(path.join(root, relativePath));
    if (details.size <= MAX_SCAN_BYTES) output.push(relativePath.split(path.sep).join("/"));
  }
}

export async function scanProjectForSecrets(projectRoot = DEFAULT_PROJECT_ROOT) {
  const files = [];
  await walk(projectRoot, "", files);
  const findings = [];
  for (const relativePath of files.sort()) {
    const content = await readFile(path.join(projectRoot, relativePath));
    findings.push(...findSecrets(relativePath, content));
  }
  return { files, findings };
}

async function main() {
  const result = await scanProjectForSecrets();
  if (result.findings.length) {
    console.error(`Scanner encontrou ${result.findings.length} possível(is) segredo(s):`);
    result.findings.forEach((finding) => console.error(`- ${finding}`));
    process.exitCode = 1;
    return;
  }
  console.log(`Scanner de segredos aprovado: ${result.files.length} arquivo(s) verificados.`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
