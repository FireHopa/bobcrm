import { normalizeCustomFields } from "./constants/customFields";
import { getServiceInterestsFromStatusMap, normalizeServiceStatusMap } from "./constants/services";
import type { Lead } from "./types/Lead";

export const LEGACY_STORAGE_KEY = "crm-premium-google-leads-v2";

function normalizeBooleanText(value: unknown): boolean {
  const normalized = String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  return ["sim", "s", "yes", "y", "true", "1", "ok", "ativo", "anuncia", "x"].includes(normalized);
}

export function migrateLead(lead: Partial<Lead>): Lead {
  const status: Lead["status"] = lead.status || (lead.isLost ? "Perdido" : "Novo lead");
  const serviceInterests = Array.isArray(lead.serviceInterests) ? lead.serviceInterests : [];
  const serviceStatusMap = normalizeServiceStatusMap(lead.serviceStatusMap, serviceInterests);
  const rawCustomFields: Partial<Record<string, unknown>> = lead.customFields && typeof lead.customFields === "object" ? lead.customFields : {};
  const legacyWebsite = String(rawCustomFields["Coloque seu site"] ?? "").trim();
  const legacyGoogleAds = String(rawCustomFields["Já anuncia no Google ADS? - 2"] ?? "").trim();

  return {
    id: lead.id || crypto.randomUUID(),
    name: lead.name || "",
    email: lead.email || "",
    phone: lead.phone || "",
    company: lead.company || "",
    website: lead.website || legacyWebsite || "",
    advertisesOnMeta: Boolean(lead.advertisesOnMeta),
    advertisesOnGoogle: Boolean(lead.advertisesOnGoogle) || normalizeBooleanText(legacyGoogleAds),
    doesNotAdvertise: Boolean(lead.doesNotAdvertise),
    lastContactAt: lead.lastContactAt || "",
    contactMadeAt: lead.contactMadeAt || "",
    nextContactAt: lead.nextContactAt || "",
    expectedCloseAt: lead.expectedCloseAt || "",
    estimatedBudget: lead.estimatedBudget || "",
    isLost: Boolean(lead.isLost || status === "Perdido"),
    lostReason: lead.lostReason || "",
    commercialNotes: lead.commercialNotes || "",
    status,
    responsible: lead.responsible || "",
    responsibleUserId: lead.responsibleUserId || "",
    temperature: lead.temperature || "",
    pain: lead.pain || "",
    source: lead.source || "",
    serviceInterests: serviceInterests.length ? serviceInterests : getServiceInterestsFromStatusMap(serviceStatusMap),
    serviceStatusMap,
    customFields: normalizeCustomFields(rawCustomFields),
    createdAt: lead.createdAt || new Date().toISOString(),
  };
}

export function getLegacyStoredLeads(): Lead[] {
  try {
    const storedLeads = localStorage.getItem(LEGACY_STORAGE_KEY);
    const parsedLeads = storedLeads ? JSON.parse(storedLeads) : [];

    if (!Array.isArray(parsedLeads)) {
      return [];
    }

    return parsedLeads.map(migrateLead);
  } catch {
    return [];
  }
}

export function clearLegacyStoredLeads(): void {
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

export function getStoredLeads(): Lead[] {
  return getLegacyStoredLeads();
}

export function setStoredLeads(): void {
  // A partir da V25, os dados não são mais gravados no navegador.
  // A função foi mantida apenas para compatibilidade com versões antigas.
}
