import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scanProjectForSecrets } from "./scan-secrets.mjs";

test("scanner ignora artefatos e detecta segredo em fonte versionável", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crm-secret-scan-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "ignored"), { recursive: true });
    await writeFile(path.join(root, "src", "safe.ts"), "export const value = 'ok';\n");
    await writeFile(path.join(root, "src", "unsafe.env"), "SERVICE_TOKEN=real-secret-value-123\n");
    await writeFile(path.join(root, "node_modules", "ignored", "secret.env"), "SERVICE_TOKEN=ignored-secret\n");

    const result = await scanProjectForSecrets(root);
    assert.equal(result.files.some((file) => file.includes("node_modules")), false);
    assert.equal(result.findings.some((finding) => finding.includes("src/unsafe.env")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
