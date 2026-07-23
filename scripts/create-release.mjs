import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");

const DENIED_PATH_SEGMENTS = new Set([
  ".git",
  ".idea",
  ".vscode",
  "backups",
  "coverage",
  "data",
  "dist",
  "logs",
  "node_modules",
  "release",
  "tmp",
]);

const DENIED_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".env.test",
]);

const DENIED_EXTENSIONS = new Set([
  ".bak",
  ".backup",
  ".db",
  ".dump",
  ".key",
  ".log",
  ".p12",
  ".pem",
  ".pfx",
  ".sqlite",
  ".sqlite3",
]);

const SECRET_PATTERNS = [
  { label: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "GitHub token", pattern: /\b(?:ghp|gho|ghu|ghs|github_pat)_[0-9A-Za-z_]{20,}\b/ },
  { label: "OpenAI key", pattern: /\bsk-(?:proj-)?[0-9A-Za-z_-]{20,}\b/ },
  { label: "JWT", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
];

const PLACEHOLDER_MARKERS = [
  "CHANGE_ME",
  "CHANGEME",
  "EXAMPLE",
  "PLACEHOLDER",
  "REPLACE_ME",
  "REPLACE_WITH",
  "YOUR_",
  "<",
  "${",
];

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function isDeniedPath(relativePath) {
  const normalized = toPosix(relativePath).replace(/^\.\//, "");
  const segments = normalized.split("/").filter(Boolean);
  const fileName = segments.at(-1) || "";
  const extension = path.extname(fileName).toLowerCase();

  if (segments.some((segment) => DENIED_PATH_SEGMENTS.has(segment))) return true;
  if (DENIED_FILE_NAMES.has(fileName)) return true;
  if (fileName.startsWith(".env.") && fileName !== ".env.example") return true;
  if (DENIED_EXTENSIONS.has(extension)) return true;
  return false;
}

function isAllowedExtension(fileName, extensions) {
  return extensions.some((extension) => fileName.endsWith(extension));
}

async function walkDirectory(root, relativeDirectory, allowedExtensions, output) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (isDeniedPath(relativePath)) continue;

    if (entry.isSymbolicLink()) {
      throw new Error(`Release bloqueado: link simbólico não permitido (${toPosix(relativePath)}).`);
    }
    if (entry.isDirectory()) {
      await walkDirectory(root, relativePath, allowedExtensions, output);
      continue;
    }
    if (entry.isFile() && isAllowedExtension(entry.name, allowedExtensions)) {
      output.add(toPosix(relativePath));
    }
  }
}

export async function collectAllowedFiles(projectRoot = DEFAULT_PROJECT_ROOT) {
  const allowlistPath = path.join(projectRoot, "release.allowlist.json");
  const allowlist = JSON.parse(await readFile(allowlistPath, "utf8"));
  const output = new Set();

  for (const relativePath of allowlist.files || []) {
    if (isDeniedPath(relativePath)) {
      throw new Error(`Allowlist inválida: caminho proibido (${relativePath}).`);
    }
    const absolutePath = path.join(projectRoot, relativePath);
    const details = await stat(absolutePath).catch(() => null);
    if (!details?.isFile()) {
      throw new Error(`Allowlist inválida: arquivo ausente (${relativePath}).`);
    }
    output.add(toPosix(relativePath));
  }

  for (const [relativeDirectory, extensions] of Object.entries(allowlist.directories || {})) {
    if (isDeniedPath(relativeDirectory)) {
      throw new Error(`Allowlist inválida: diretório proibido (${relativeDirectory}).`);
    }
    await walkDirectory(projectRoot, relativeDirectory, extensions, output);
  }

  return [...output].sort();
}

function isPlaceholder(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return !normalized || PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker));
}

export function findSecrets(relativePath, content) {
  const findings = [];
  const text = content.toString("utf8");

  for (const { label, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) findings.push(`${relativePath}: padrão de ${label}`);
  }

  const fileName = path.posix.basename(toPosix(relativePath));
  const isEnvironmentTemplate = fileName === ".env" || fileName.startsWith(".env.") || fileName.endsWith(".env");
  if (isEnvironmentTemplate) {
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*(?:PASSWORD|TOKEN|SECRET|KEY)[A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const value = match[2].replace(/^['"]|['"]$/g, "");
      if (!isPlaceholder(value)) findings.push(`${relativePath}: valor sensível preenchido em ${match[1]}`);
    }
  }

  return findings;
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

export async function buildRelease(projectRoot = DEFAULT_PROJECT_ROOT) {
  const files = await collectAllowedFiles(projectRoot);
  const archiveEntries = {};
  const manifestFiles = [];
  const findings = [];

  for (const relativePath of files) {
    if (isDeniedPath(relativePath)) {
      throw new Error(`Release bloqueado: arquivo proibido selecionado (${relativePath}).`);
    }
    const content = await readFile(path.join(projectRoot, relativePath));
    findings.push(...findSecrets(relativePath, content));
    archiveEntries[relativePath] = new Uint8Array(content);
    manifestFiles.push({ path: relativePath, bytes: content.byteLength, sha256: sha256(content) });
  }

  if (findings.length) {
    throw new Error(`Release bloqueado por possível segredo:\n${findings.map((item) => `- ${item}`).join("\n")}`);
  }

  const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  const manifest = {
    application: packageJson.name,
    version: packageJson.version,
    generatedAt: new Date().toISOString(),
    policy: "explicit-allowlist",
    files: manifestFiles,
  };
  archiveEntries["RELEASE_MANIFEST.json"] = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);

  return {
    files,
    manifest,
    zip: zipSync(archiveEntries, { level: 9 }),
  };
}

export async function createReleaseArchive({
  projectRoot = DEFAULT_PROJECT_ROOT,
  outputPath,
  checkOnly = false,
} = {}) {
  const release = await buildRelease(projectRoot);
  if (checkOnly) return { ...release, outputPath: null };

  const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  const finalOutputPath = outputPath || path.join(projectRoot, "release", `${packageJson.name}-v${packageJson.version}.zip`);
  await mkdir(path.dirname(finalOutputPath), { recursive: true });
  await writeFile(finalOutputPath, release.zip);
  return { ...release, outputPath: finalOutputPath };
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const result = await createReleaseArchive({ checkOnly });
  if (checkOnly) {
    console.log(`Release validado: ${result.files.length} arquivo(s), nenhum artefato proibido ou segredo detectado.`);
    return;
  }
  console.log(`Release criado: ${result.outputPath}`);
  console.log(`Arquivos incluídos: ${result.files.length}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
