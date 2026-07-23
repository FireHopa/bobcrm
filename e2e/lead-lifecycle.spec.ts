import { test, expect } from "@playwright/test";
import { apiRequest, expectJson, login } from "./fixtures";

test("criação e edição de lead, tarefa e follow-up pelo fluxo crítico", async ({ page }) => {
  await login(page);
  const suffix = Date.now();
  await page.getByRole("button", { name: "Novo lead", exact: true }).click();
  await page.getByLabel("Nome").fill(`Lead fluxo ${suffix}`);
  await page.getByLabel("Telefone").fill("11999998888");
  await page.getByLabel("E-mail").fill(`fluxo.${suffix}@example.test`);
  await page.getByLabel("Empresa").fill("Empresa Fluxo E2E");
  await page.getByRole("button", { name: "Salvar lead" }).click();

  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Editar", exact: true }).click();
  await drawer.getByLabel("E-mail").fill(`fluxo.editado.${suffix}@example.test`);
  await drawer.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(drawer.getByText(`fluxo.editado.${suffix}@example.test`)).toBeVisible();

  await drawer.getByRole("group", { name: "Criar tarefa" }).getByLabel("Título").fill("Follow-up E2E");
  await drawer.getByRole("group", { name: "Criar tarefa" }).getByLabel(/Data|Prazo/).fill("2026-08-01T10:00");
  await drawer.getByRole("button", { name: "Criar tarefa" }).click();
  await expect(drawer.getByText("Follow-up E2E")).toBeVisible();
  await drawer.getByRole("button", { name: "Concluir" }).click();

  const completion = page.getByRole("dialog", { name: /Concluir tarefa/i });
  await completion.getByLabel("Resultado da tarefa").fill("Contato realizado no E2E");
  await completion.getByLabel("Criar próximo follow-up").check();
  await completion.getByLabel(/Data e horário/).fill("2026-08-02T11:00");
  await completion.getByRole("button", { name: /Concluir tarefa/ }).click();
  await expect(page.getByText("Contato realizado no E2E")).toBeVisible();

  const leadsResponse = await apiRequest(page, `/api/leads?search=${encodeURIComponent(`fluxo.editado.${suffix}@example.test`)}&limit=10`);
  const leadsPage = await expectJson(leadsResponse);
  expect(leadsPage.leads).toHaveLength(1);
  const taskResponse = await apiRequest(page, `/api/tasks?leadId=${encodeURIComponent(leadsPage.leads[0].id)}&bucket=all&limit=20`);
  const tasks = await expectJson(taskResponse);
  expect(tasks.some((task: { status: string; result: string }) => task.status === "completed" && task.result.includes("Contato realizado"))).toBeTruthy();
  expect(tasks.some((task: { status: string; title: string }) => task.status === "pending" && task.title.includes("Follow-up"))).toBeTruthy();
});
