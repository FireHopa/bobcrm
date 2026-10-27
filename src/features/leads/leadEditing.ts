import type { Lead } from "../../types/Lead";
import { normalizeWebsite } from "../../utils/formatters";
import { getLeadWithSyncedAdvertisingFromServices, getServiceInterestsFromStatusMap } from "../../constants/services";
import { createLeadDrawerFormState, type LeadDrawerFormState } from "./leadDrawerModel";

export type LeadPatch = {
  id: string;
  expectedUpdatedAt: string;
  changes: Partial<Lead>;
};

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const left = Object.entries(a), right = Object.entries(b);
  return left.length === right.length && left.every(([key, value]) =>
    Object.prototype.hasOwnProperty.call(b, key) && sameValue(value, (b as Record<string, unknown>)[key]));
}

const consultantFields = new Set(["name", "email", "phone", "company", "website", "instagram", "temperature", "expectedCloseAt"]);
const trimmedFields = new Set(["name", "email", "phone", "company", "instagram", "commercialNotes", "observation", "responsible", "pain"]);
const adsFields = ["advertisesOnMeta", "advertisesOnGoogle", "doesNotAdvertiseOnMeta", "doesNotAdvertiseOnGoogle", "doesNotAdvertise"] as const;

export function buildLeadDrawerPatch(base: Lead, draft: LeadDrawerFormState, canEditFull: boolean): LeadPatch {
  const initial = createLeadDrawerFormState(base);
  const changes: Record<string, unknown> = {};
  for (const key of Object.keys(initial) as Array<keyof LeadDrawerFormState>) {
    if ((!canEditFull && !consultantFields.has(key)) || sameValue(initial[key], draft[key])) continue;
    if (key === "serviceStatusMap" || key === "customFields") {
      const before = initial[key] as Record<string, unknown>;
      changes[key] = Object.fromEntries(Object.entries(draft[key]).filter(([name, value]) => !sameValue(before[name], value)));
    } else {
      changes[key] = key === "website" ? normalizeWebsite(draft.website)
        : trimmedFields.has(key) ? String(draft[key]).trim() : draft[key];
      if (sameValue(changes[key], initial[key])) delete changes[key];
    }
  }
  if (canEditFull && ("status" in changes || "isLost" in changes)) {
    changes.isLost = draft.isLost || draft.status === "Perdido";
    changes.status = changes.isLost ? "Perdido" : draft.status;
    changes.lostReason = changes.isLost ? draft.lostReason : "";
  }
  if (canEditFull && "serviceStatusMap" in changes) {
    changes.serviceInterests = getServiceInterestsFromStatusMap(draft.serviceStatusMap);
    const synced = getLeadWithSyncedAdvertisingFromServices({ ...base, serviceStatusMap: draft.serviceStatusMap });
    for (const key of adsFields) {
      // An explicit advertising edit takes priority over automatic diagnosis sync.
      if (!(key in changes) && !sameValue(synced[key], base[key])) changes[key] = synced[key];
    }
  }
  return { id: base.id, expectedUpdatedAt: base.updatedAt || "", changes: changes as Partial<Lead> };
}

// Three-way rebase: refresh untouched fields, keep local typing and flag collisions.
// Nested custom/diagnosis fields are compared individually, not as whole objects.
export function rebaseLeadDraft(draft: LeadDrawerFormState, base: Lead, incoming: Lead) {
  const before = createLeadDrawerFormState(base);
  const after = createLeadDrawerFormState(incoming);
  const next: Record<string, unknown> = { ...after };
  const conflicts: string[] = [];
  for (const key of Object.keys(before) as Array<keyof LeadDrawerFormState>) {
    if (key === "customFields" || key === "serviceStatusMap") {
      const oldMap = before[key] as Record<string, unknown>, newMap = after[key] as Record<string, unknown>;
      const localMap = draft[key] as Record<string, unknown>;
      const result = { ...newMap };
      for (const name of Object.keys(localMap)) {
        if (sameValue(localMap[name], oldMap[name])) continue;
        result[name] = localMap[name];
        if (!sameValue(newMap[name], oldMap[name]) && !sameValue(newMap[name], localMap[name])) conflicts.push(`${key}: ${name}`);
      }
      next[key] = result;
    } else if (!sameValue(draft[key], before[key])) {
      next[key] = draft[key];
      if (!sameValue(after[key], before[key]) && !sameValue(after[key], draft[key])) conflicts.push(key);
    }
  }
  return { draft: next as LeadDrawerFormState, conflicts };
}

export const leadFieldLabels: Record<string, string> = {
  name: "Nome", email: "E-mail", phone: "Telefone", company: "Empresa", website: "Website", instagram: "Instagram",
  temperature: "Temperatura", status: "Status", expectedCloseAt: "Fechamento previsto", observation: "Observacao",
  commercialNotes: "Observacao comercial legada", pain: "Dor do lead", responsible: "Responsavel",
};
