import { expect, type Page, type APIResponse } from "@playwright/test";

export const adminEmail = process.env.E2E_ADMIN_EMAIL || "admin.phase6@example.test";
export const adminPassword = process.env.E2E_ADMIN_PASSWORD || "Phase6-Aa!Local-Test-Only";

export async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("E-mail").fill(adminEmail);
  await page.getByLabel("Senha").fill(adminPassword);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Navegação principal do CRM" })).toBeVisible();
}

export async function apiRequest(page: Page, pathname: string, options: { method?: string; data?: unknown } = {}) {
  const csrfToken = await page.evaluate(() => sessionStorage.getItem("crmCasaAdsCsrfToken") || "");
  const method = options.method || "GET";
  const headers: Record<string, string> = {};
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()) && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const response = await page.request.fetch(pathname, { method, data: options.data, headers });
  return response;
}

export async function expectJson(response: APIResponse, status = 200) {
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}

export async function createLead(page: Page, suffix = String(Date.now())) {
  const response = await apiRequest(page, "/api/leads", {
    method: "POST",
    data: {
      name: `Lead E2E ${suffix}`,
      email: `lead.e2e.${suffix}@example.test`,
      phone: `119${suffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}`,
      company: `Empresa E2E ${suffix}`,
      status: "Novo lead",
      temperature: "Quente",
      pain: "Teste E2E de aquisição",
    },
  });
  return expectJson(response, 201);
}

export async function waitForJob(page: Page, jobId: string, timeoutMs = 90_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await apiRequest(page, `/api/jobs/${encodeURIComponent(jobId)}`);
    const job = await expectJson(response);
    if (job.status === "completed") return job;
    if (["failed", "canceled"].includes(job.status)) throw new Error(`Job ${jobId} terminou como ${job.status}: ${job.errorMessage || job.errorCode}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Job ${jobId} não terminou em ${timeoutMs} ms.`);
}
