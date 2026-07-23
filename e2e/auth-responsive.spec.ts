import { test, expect } from "@playwright/test";
import { apiRequest, createLead, expectJson, login } from "./fixtures";

const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];

test("login e responsividade não criam overflow horizontal nos breakpoints definidos", async ({ page }) => {
  await login(page);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Navegação principal do CRM" })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(dimensions.scroll, `overflow em ${viewport.width}px`).toBeLessThanOrEqual(dimensions.client + 1);
  }
});

test("diálogos funcionam por teclado, Escape e devolvem o foco", async ({ page }) => {
  await login(page);
  const lead = await createLead(page, `keyboard-${Date.now()}`);
  await expectJson(await apiRequest(page, "/api/tasks", {
    method: "POST",
    data: { leadId: lead.id, title: "Tarefa para teclado", dueAt: "2026-08-01T10:00", type: "follow_up", priority: "normal" },
  }), 201);

  await page.getByRole("button", { name: "Leads", exact: true }).click();
  await page.getByPlaceholder(/Buscar na carteira autorizada/).fill(lead.email);
  await page.getByRole("button", { name: "Abrir lead", exact: true }).first().click();
  const drawer = page.getByRole("dialog");
  const completeButton = drawer.getByRole("button", { name: "Concluir", exact: true });
  await expect(completeButton).toBeVisible();
  await completeButton.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: /Concluir tarefa/i });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(completeButton).toBeFocused();
});
