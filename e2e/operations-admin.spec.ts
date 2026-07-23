import { test, expect } from "@playwright/test";
import mysql from "mysql2/promise";
import { apiRequest, createLead, expectJson, login, waitForJob } from "./fixtures";

function mysqlConfig() {
  return {
    host: process.env.MYSQL_TEST_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_TEST_PORT || 3306),
    user: process.env.MYSQL_TEST_USER || "root",
    password: process.env.MYSQL_TEST_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "crm_phase6_e2e",
  };
}

test("encaminhamento e movimentação no Kanban preservam o responsável e a etapa", async ({ page }) => {
  await login(page);
  const lead = await createLead(page, `handoff-${Date.now()}`);
  const password = `Aa!Consultor-${Date.now()}`;
  const userResponse = await apiRequest(page, "/api/users", { method: "POST", data: { name: "Consultor E2E", email: `consultor.${Date.now()}@example.test`, password, role: "consultor_vendas" } });
  const consultant = await expectJson(userResponse, 201);
  const pipelines = await expectJson(await apiRequest(page, "/api/kanban/pipelines"));
  const board = await expectJson(await apiRequest(page, `/api/kanban/board?pipelineId=${pipelines[0].id}`));
  const openStages = board.stages.filter((stage: { stageType: string }) => stage.stageType === "open");

  const handoff = await expectJson(await apiRequest(page, `/api/leads/${lead.id}/handoff`, {
    method: "POST",
    data: {
      requestId: `e2e-${Date.now()}`,
      consultantUserId: consultant.id,
      pipelineId: pipelines[0].id,
      stageId: openStages[0].id,
      task: { title: "Contato do encaminhamento", dueAt: "2026-08-03T09:00", type: "follow_up", priority: "alta" },
    },
  }));
  expect(handoff.lead.responsibleUserId).toBe(consultant.id);

  await expectJson(await apiRequest(page, "/api/kanban/cards/move", { method: "POST", data: { leadId: lead.id, pipelineId: pipelines[0].id, stageId: openStages[1].id } }));
  await page.getByRole("button", { name: "Leads", exact: true }).click();
  await page.getByRole("button", { name: "Kanban" }).click();
  const card = page.locator(`[data-lead-id="${lead.id}"]`);
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-stage-id", openStages[1].id);
  await card.getByLabel("Mover para").selectOption(openStages[0].id);
  await expect(card).toHaveAttribute("data-stage-id", openStages[0].id);
});

test("filtros, paginação, importação pequena e grande, duplicados, mesclagem, lixeira e restauração", async ({ page }) => {
  await login(page);
  const lead = await createLead(page, `admin-${Date.now()}`);

  for (const filter of ["expansion", "migration", "mapping", "priority", "agency", "withoutDiagnosis", "mappingCritical"]) {
    const result = await expectJson(await apiRequest(page, `/api/leads?quickFilter=${filter}&limit=5&offset=0`));
    expect(typeof result.pagination.total).toBe("number");
    expect(result.pagination.limit).toBe(5);
  }

  const small = Array.from({ length: 3 }, (_, index) => ({ name: `Importação pequena ${index}`, email: `small.${Date.now()}.${index}@example.test`, status: "Novo lead" }));
  const smallJob = await expectJson(await apiRequest(page, "/api/leads/import", { method: "POST", data: { leads: small } }), 202);
  expect((await waitForJob(page, smallJob.id)).result.report.received).toBe(3);

  const large = Array.from({ length: 1_200 }, (_, index) => ({ name: `Importação grande ${index}`, email: `large.${Date.now()}.${index}@example.test`, status: "Novo lead" }));
  const largeJob = await expectJson(await apiRequest(page, "/api/leads/import", { method: "POST", data: { leads: large } }), 202);
  expect((await waitForJob(page, largeJob.id, 120_000)).result.report.received).toBe(1_200);

  const connection = await mysql.createConnection(mysqlConfig());
  try {
    const [rows] = await connection.query("SELECT * FROM leads WHERE id = ?", [lead.id]);
    const duplicate = { ...(rows as Record<string, unknown>[])[0], id: `dup-${lead.id}`, name: `${lead.name} duplicado`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    await connection.query("INSERT INTO leads SET ?", duplicate);
    const groups = await expectJson(await apiRequest(page, "/api/leads/duplicates?limit=20&offset=0"));
    const group = groups.groups.find((item: { leads: { id: string }[] }) => item.leads.some((candidate) => candidate.id === lead.id));
    expect(group).toBeTruthy();
    await expectJson(await apiRequest(page, "/api/leads/merge", { method: "POST", data: { primaryLeadId: lead.id, duplicateLeadIds: [duplicate.id] } }));
  } finally {
    await connection.end();
  }

  await expectJson(await apiRequest(page, `/api/leads/${lead.id}`, { method: "DELETE" }));
  const trash = await expectJson(await apiRequest(page, "/api/leads/deleted"));
  expect(trash.some((item: { id: string }) => item.id === lead.id)).toBeTruthy();
  const restored = await expectJson(await apiRequest(page, `/api/leads/${lead.id}/restore`, { method: "POST" }));
  expect(restored.deletedAt).toBe("");
});
