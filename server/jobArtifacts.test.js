import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createJobStorageKey,
  describeJobArtifact,
  jobArtifactExpiryIso,
  readJsonJobPayload,
  resolveJobArtifactSettings,
  resolveJobStoragePath,
  writeJsonJobPayload,
} from "./jobArtifacts.js";

test("produção exige diretório de artifacts fora do projeto", () => {
  const projectRoot = "/srv/crm";
  assert.throws(() => resolveJobArtifactSettings({ env: { JOB_ARTIFACT_DIR: "runtime/jobs" }, projectRoot, isProduction: true }), /fora da pasta do projeto/);
  const settings = resolveJobArtifactSettings({ env: { JOB_ARTIFACT_DIR: "../crm-jobs" }, projectRoot, isProduction: true });
  assert.equal(settings.storageRoot, "/srv/crm-jobs");
});

test("storage key é opaca e path traversal é bloqueado", () => {
  assert.match(createJobStorageKey("export csv", "csv"), /^\d{4}-\d{2}-\d{2}\/export_csv-[a-f0-9-]+\.csv$/);
  assert.match(createJobStorageKey("import payload", "json.gz"), /^\d{4}-\d{2}-\d{2}\/import_payload-[a-f0-9-]+\.json\.gz$/);
  assert.throws(() => resolveJobStoragePath("/tmp/jobs", "../segredo.env"), /inválido/);
});

test("payload de importação é persistido comprimido e restaurado", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crm-job-artifacts-"));
  try {
    const payload = { leads: Array.from({ length: 100 }, (_, index) => ({ id: index, name: `Lead ${index}` })) };
    const saved = await writeJsonJobPayload({ storageRoot: root, payload });
    const restored = await readJsonJobPayload({ storageRoot: root, storageKey: saved.storageKey });
    assert.deepEqual(restored, payload);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact registra tamanho e SHA-256 sem carregar arquivo inteiro", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crm-job-hash-"));
  try {
    const key = "2026-07-07/export.csv";
    const filePath = resolveJobStoragePath(root, key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "abc", { flag: "w" });
    const artifact = await describeJobArtifact({ storageRoot: root, storageKey: key, fileName: "export.csv", contentType: "text/csv" });
    assert.equal(artifact.sizeBytes, 3);
    assert.equal(artifact.sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("expiração de artifact é calculada por TTL", () => {
  assert.equal(jobArtifactExpiryIso(1, Date.parse("2026-07-07T12:00:00.000Z")), "2026-07-07T13:00:00.000Z");
});
