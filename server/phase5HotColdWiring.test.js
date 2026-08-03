import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexSource = readFileSync(new URL("./index.js", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../src/utils/api.ts", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../src/components/SettingsCenter.tsx", import.meta.url), "utf8");
const jobQueueSource = readFileSync(new URL("./jobQueue.js", import.meta.url), "utf8");
const policySource = readFileSync(new URL("./jobExecutionPolicy.js", import.meta.url), "utf8");
const envSource = readFileSync(new URL("./.env.example", import.meta.url), "utf8");

test("fase 5 está ligada à migration, API e worker", () => {
  assert.match(indexSource, /20260729_17_hot_cold_leads_phase5/);
  assert.match(indexSource, /hotColdRuntime\.handleApi/);
  assert.match(indexSource, /performArchiveJob/);
  assert.match(indexSource, /performArchiveCsvExportJob/);
  assert.match(jobQueueSource, /archive_cold_leads/);
  assert.match(jobQueueSource, /export_archived_leads_csv/);
  assert.match(policySource, /archive_cold_leads/);
});

test("frontend oferece arquivo, busca, restauração e download", () => {
  assert.match(apiSource, /fetchArchivedLeadsFromServer/);
  assert.match(apiSource, /restoreArchivedLeadOnServer/);
  assert.match(apiSource, /downloadArchivedLeadsCsvExport/);
  assert.match(settingsSource, /Arquivo de Leads/);
  assert.match(settingsSource, /Arquivar excedente/);
  assert.match(settingsSource, /Buscar no arquivo/);
});

test("limite Hot\/Cold é configurável", () => {
  assert.match(envSource, /HOT_LEADS_LIMIT=30000/);
  assert.match(envSource, /HOT_LEADS_ARCHIVE_BATCH_SIZE=250/);
  assert.match(envSource, /HOT_LEADS_AUTO_ARCHIVE=1/);
});

test("index principal continua dentro do limite arquitetural", () => {
  assert.ok(indexSource.split(/\r?\n/).length <= 5600);
});
