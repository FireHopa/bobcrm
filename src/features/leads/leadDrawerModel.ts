import { normalizeCustomFields } from "../../constants/customFields";
import { normalizeServiceStatusMap } from "../../constants/services";
import type {
  Lead,
  LeadCustomFields,
  LeadSource,
  LeadStatus,
  LeadTemperature,
  LostReason,
  ServiceStatusMap,
} from "../../types/Lead";

export type DrawerMode = "view" | "edit";

export type LeadDrawerFormState = {
  name: string;
  email: string;
  phone: string;
  company: string;
  website: string;
  instagram: string;
  advertisesOnMeta: boolean;
  advertisesOnGoogle: boolean;
  doesNotAdvertiseOnMeta: boolean;
  doesNotAdvertiseOnGoogle: boolean;
  doesNotAdvertise: boolean;
  lastContactAt: string;
  contactMadeAt: string;
  nextContactAt: string;
  expectedCloseAt: string;
  estimatedBudget: string;
  isLost: boolean;
  lostReason: LostReason;
  commercialNotes: string;
  status: LeadStatus;
  responsible: string;
  responsibleUserId: string;
  temperature: LeadTemperature;
  pain: string;
  source: LeadSource;
  serviceStatusMap: ServiceStatusMap;
  customFields: LeadCustomFields;
};

export type LeadDrawerFormErrors = Partial<Record<"identity" | "email" | "lostReason", string>>;

export const leadSourceOptions: LeadSource[] = [
  "",
  "Instagram",
  "Google",
  "Indicação",
  "WhatsApp",
  "Evento",
  "Landing Page",
  "Tráfego Pago",
  "Outro",
];

export const leadStatusOptions: LeadStatus[] = [
  "Novo lead",
  "Contato feito",
  "Sem resposta",
  "Reunião marcada",
  "Diagnóstico realizado",
  "Proposta enviada",
  "Em negociação",
  "Fechado",
  "Perdido",
];

export const leadTemperatureOptions: LeadTemperature[] = ["", "Frio", "Morno", "Quente"];

export const leadLostReasonOptions: LostReason[] = [
  "",
  "Preço",
  "Sem resposta",
  "Sem orçamento",
  "Fechou com concorrente",
  "Não era o momento",
  "Não viu valor",
  "Fora do perfil",
  "Lead curioso",
  "Outro",
];

export function createLeadDrawerFormState(lead: Lead): LeadDrawerFormState {
  const advertisesOnMeta = Boolean(lead.advertisesOnMeta);
  const advertisesOnGoogle = Boolean(lead.advertisesOnGoogle);
  const legacyDoesNotAdvertise = Boolean(lead.doesNotAdvertise);
  const doesNotAdvertiseOnMeta = !advertisesOnMeta && (Boolean(lead.doesNotAdvertiseOnMeta) || legacyDoesNotAdvertise);
  const doesNotAdvertiseOnGoogle = !advertisesOnGoogle && (Boolean(lead.doesNotAdvertiseOnGoogle) || legacyDoesNotAdvertise);

  return {
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    company: lead.company,
    website: lead.website,
    instagram: lead.instagram || "",
    advertisesOnMeta,
    advertisesOnGoogle,
    doesNotAdvertiseOnMeta,
    doesNotAdvertiseOnGoogle,
    doesNotAdvertise: !advertisesOnMeta && !advertisesOnGoogle && doesNotAdvertiseOnMeta && doesNotAdvertiseOnGoogle,
    lastContactAt: lead.lastContactAt,
    contactMadeAt: lead.contactMadeAt,
    nextContactAt: lead.nextContactAt,
    expectedCloseAt: lead.expectedCloseAt || "",
    estimatedBudget: lead.estimatedBudget,
    isLost: lead.isLost || lead.status === "Perdido",
    lostReason: lead.lostReason,
    commercialNotes: lead.commercialNotes,
    status: lead.status || "Novo lead",
    responsible: lead.responsible,
    responsibleUserId: lead.responsibleUserId || "",
    temperature: lead.temperature,
    pain: lead.pain,
    source: lead.source,
    serviceStatusMap: normalizeServiceStatusMap(lead.serviceStatusMap, lead.serviceInterests || []),
    customFields: normalizeCustomFields(lead.customFields),
  };
}

export function validateLeadDrawerForm(formState: LeadDrawerFormState, canEditFull: boolean): LeadDrawerFormErrors {
  const errors: LeadDrawerFormErrors = {};
  const normalizedIsLost = formState.isLost || formState.status === "Perdido";
  if (formState.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formState.email.trim())) {
    errors.email = "Informe um e-mail válido.";
  }
  if (canEditFull && ![formState.name, formState.email, formState.phone].some((value) => value.trim())) {
    errors.identity = "Informe ao menos nome, e-mail ou telefone.";
  }
  if (canEditFull && normalizedIsLost && !formState.lostReason) {
    errors.lostReason = "Selecione o motivo da perda.";
  }
  return errors;
}
