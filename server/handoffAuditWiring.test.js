import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("handoff grava histórico normalizado dentro do fluxo transacional", async () => {
  const source = await read("server/index.js");
  assert.match(source, /INSERT INTO lead_handoffs/);
  assert.match(source, /action: "lead_handed_off"/);
  assert.match(source, /pathname === "\/api\/handoffs"/);
});

test("SDR possui aba própria e admin possui painel completo", async () => {
  const [app, settings] = await Promise.all([read("src/App.tsx"), read("src/components/SettingsCenter.tsx")]);
  assert.match(app, /currentUser\.role === "pre_venda"[\s\S]*?Encaminhamentos/);
  assert.match(app, /HandoffActivityDashboard[\s\S]*?mode="sdr"/);
  assert.match(settings, /label: "Encaminhamentos"/);
  assert.match(settings, /HandoffActivityDashboard mode="admin"/);
});

test("consultor recebe origem do encaminhamento dentro do lead", async () => {
  const [drawer, api] = await Promise.all([read("src/components/LeadDetailsDrawer.tsx"), read("src/utils/api.ts")]);
  assert.match(drawer, /Encaminhado para você/);
  assert.match(drawer, /fetchLeadHandoffOriginFromServer/);
  assert.match(api, /\/handoff-origin/);
});
