import { normalizeCustomFields } from "../constants/customFields";
import { getClientIntelligence, normalizeServiceStatusMap, serviceOptions } from "../constants/services";
import type { Lead, LeadStatus, ServiceInterest, ServiceProviderStatus } from "../types/Lead";
import { isPastDate, isToday } from "./formatters";

export type LeadScores = {
  commercialPotential: number;
  mappingUrgency: number;
  priority: number;
  reasons: string[];
};

export type DuplicateMatchReason = "email" | "phone" | "nameCompany";

export type DuplicateGroup = {
  key: string;
  label: string;
  reason: DuplicateMatchReason;
  leads: Lead[];
};

export type OperationBucket = {
  id: string;
  title: string;
  subtitle: string;
  emptyText: string;
  leads: Lead[];
};

export type ImportDeduplicationReport = {
  received: number;
  created: number;
  merged: number;
  ignoredInsideFile: number;
};

const CORE_MAPPING_SERVICES: ServiceInterest[] = [
  "Gerenciamento Google",
  "Gerenciamento Meta",
  "Criação de Website",
  "Mentorias AEO",
];

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeEmailKey(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhoneKey(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function normalizeNameCompanyKey(lead: Pick<Lead, "name" | "company">): string {
  const name = normalizeSearchText(lead.name || "");
  const company = normalizeSearchText(lead.company || "");

  if (!name || !company) return "";

  return `${name}|${company}`;
}

export function isActiveLead(lead: Lead): boolean {
  return !lead.isLost && lead.status !== "Perdido" && lead.status !== "Fechado";
}

function hasMeaningfulBudget(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return Boolean(digits && Number(digits) > 0);
}

function daysSince(date: string): number | null {
  if (!date) return null;

  const parsed = new Date(date.includes("T") ? date : `${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  parsed.setHours(0, 0, 0, 0);

  return Math.floor((today.getTime() - parsed.getTime()) / 86_400_000);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function getLeadScores(lead: Lead): LeadScores {
  const intelligence = getClientIntelligence(lead);
  const serviceStatusMap = normalizeServiceStatusMap(lead.serviceStatusMap, lead.serviceInterests || []);
  const reasons: string[] = [];
  let commercialPotential = 0;
  let mappingUrgency = 0;

  if (lead.temperature === "Quente") {
    commercialPotential += 22;
    reasons.push("temperatura quente");
  } else if (lead.temperature === "Morno") {
    commercialPotential += 12;
    reasons.push("temperatura morna");
  }

  if (hasMeaningfulBudget(lead.estimatedBudget)) {
    commercialPotential += 16;
    reasons.push("orçamento informado");
  }

  if (lead.pain.trim()) {
    commercialPotential += 12;
    reasons.push("dor registrada");
  }

  if (lead.website.trim()) {
    commercialPotential += 8;
    reasons.push("site informado");
  }

  if (intelligence.externalAgencyServicesCount > 0) {
    commercialPotential += Math.min(25, intelligence.externalAgencyServicesCount * 8);
    reasons.push("usa outra agência");
  }

  if (intelligence.notDoneServicesCount > 0) {
    commercialPotential += Math.min(20, intelligence.notDoneServicesCount * 5);
    reasons.push("serviços não feitos");
  }

  if (intelligence.casaServicesCount > 0) {
    commercialPotential += 10;
    reasons.push("já tem relação com a Casa do Ads");
  }

  if (lead.advertisesOnGoogle || lead.advertisesOnMeta || intelligence.hasAnyPaidTraffic) {
    commercialPotential += 10;
    reasons.push("já tem mídia paga ou indício de mídia paga");
  }

  if (!lead.responsible.trim() && !lead.responsibleUserId.trim()) mappingUrgency += 15;
  if (!lead.source.trim()) mappingUrgency += 8;
  if (!lead.temperature.trim()) mappingUrgency += 10;
  if (!lead.pain.trim()) mappingUrgency += 10;
  if (!lead.nextContactAt.trim()) mappingUrgency += 15;
  if (!lead.website.trim()) mappingUrgency += 8;

  const coreUnknown = CORE_MAPPING_SERVICES.filter((service) => serviceStatusMap[service] === "Não sabemos").length;
  mappingUrgency += Math.min(28, coreUnknown * 7);
  mappingUrgency += Math.min(20, intelligence.unknownServicesCount * 2);

  if (!intelligence.hasAnyConfirmedInformation) {
    mappingUrgency += 15;
    reasons.push("sem diagnóstico comercial confirmado");
  }

  const finalCommercialPotential = clampScore(commercialPotential);
  const finalMappingUrgency = clampScore(mappingUrgency);
  const priority = clampScore(finalCommercialPotential * 0.65 + finalMappingUrgency * 0.35);

  return {
    commercialPotential: finalCommercialPotential,
    mappingUrgency: finalMappingUrgency,
    priority,
    reasons: reasons.slice(0, 4),
  };
}

export function getRecommendedCommercialPlan(lead: Lead) {
  const intelligence = getClientIntelligence(lead);
  const serviceStatusMap = normalizeServiceStatusMap(lead.serviceStatusMap, lead.serviceInterests || []);
  const coreUnknown = CORE_MAPPING_SERVICES.filter((service) => serviceStatusMap[service] === "Não sabemos");

  if (coreUnknown.length >= 3) {
    return {
      diagnosis: "Lead com pouca informação comercial. A prioridade é fazer um diagnóstico rápido antes de vender.",
      nextAction: "Mapear Google Ads, Meta Ads, website e AEO/IA em uma conversa curta.",
      offer: "Diagnóstico de presença digital + mentoria ou gestão conforme maturidade do negócio.",
      script: "Vi que ainda não temos mapeado como vocês captam clientes hoje. Posso fazer um diagnóstico rápido para entender se existe oportunidade em Google, Meta, site e IA?",
    };
  }

  if (intelligence.externalAgencyServicesCount > 0) {
    return {
      diagnosis: "Lead com serviço em outra agência. Existe oportunidade de auditoria, comparação e possível migração.",
      nextAction: "Oferecer uma análise objetiva do que está funcionando, do que pode melhorar e do custo de oportunidade.",
      offer: "Auditoria de Google/Meta + plano de migração para gestão Casa do Ads.",
      script: "Vi que parte da operação já está com fornecedor. Posso fazer uma leitura técnica para mostrar onde há desperdício, gargalo ou oportunidade de melhoria?",
    };
  }

  if (intelligence.casaServicesCount > 0 && (intelligence.notDoneServicesCount > 0 || intelligence.unknownServicesCount > 0)) {
    return {
      diagnosis: "Cliente ou lead já conectado à Casa do Ads, mas com espaço claro para expansão.",
      nextAction: "Apresentar uma próxima camada de crescimento, sem parecer venda forçada.",
      offer: "Expansão para IA/AEO, website, Meta Ads ou Google Ads, conforme lacuna principal.",
      script: "Como vocês já têm uma frente com a Casa do Ads, eu queria te mostrar onde ainda pode existir ganho rápido de aquisição ou autoridade digital.",
    };
  }

  if (intelligence.notDoneServicesCount > 0) {
    return {
      diagnosis: "Lead tem serviços importantes que ainda não são feitos. Boa oportunidade para entrada consultiva.",
      nextAction: "Priorizar a oferta que resolve uma dor clara, evitando vender muitos serviços ao mesmo tempo.",
      offer: "Mentoria prática ou implantação inicial do serviço que hoje não é executado.",
      script: "Pelo que mapeamos, essa frente ainda não está ativa. Posso te mostrar um caminho simples para começar sem depender de tentativa e erro?",
    };
  }

  return {
    diagnosis: "Lead com informações básicas registradas, mas sem sinal forte de prioridade comercial.",
    nextAction: "Atualizar dor, orçamento, responsável e próximo contato.",
    offer: "Diagnóstico comercial antes de oferta direta.",
    script: "Quero entender melhor o cenário atual para não te oferecer algo genérico. Hoje a principal dificuldade é atrair mais clientes, vender melhor ou organizar a presença digital?",
  };
}

export function getDuplicateGroups(leads: Lead[]): DuplicateGroup[] {
  const buckets = new Map<string, DuplicateGroup>();

  function addToBucket(key: string, label: string, reason: DuplicateMatchReason, lead: Lead) {
    if (!key) return;

    const bucketKey = `${reason}:${key}`;
    const current = buckets.get(bucketKey) || { key: bucketKey, label, reason, leads: [] };

    if (!current.leads.some((currentLead) => currentLead.id === lead.id)) {
      current.leads.push(lead);
    }

    buckets.set(bucketKey, current);
  }

  leads.forEach((lead) => {
    const emailKey = normalizeEmailKey(lead.email);
    const phoneKey = normalizePhoneKey(lead.phone);
    const nameCompanyKey = normalizeNameCompanyKey(lead);

    if (emailKey) addToBucket(emailKey, `E-mail: ${emailKey}`, "email", lead);
    if (phoneKey.length >= 8) addToBucket(phoneKey, `Telefone: ${phoneKey}`, "phone", lead);
    if (nameCompanyKey) addToBucket(nameCompanyKey, "Nome + empresa iguais", "nameCompany", lead);
  });

  return Array.from(buckets.values())
    .filter((bucket) => bucket.leads.length > 1)
    .sort((a, b) => b.leads.length - a.leads.length);
}

function findDuplicateLead(incomingLead: Lead, currentLeads: Lead[]): Lead | null {
  const incomingEmail = normalizeEmailKey(incomingLead.email);
  const incomingPhone = normalizePhoneKey(incomingLead.phone);
  const incomingNameCompany = normalizeNameCompanyKey(incomingLead);

  return (
    currentLeads.find((lead) => incomingEmail && normalizeEmailKey(lead.email) === incomingEmail) ||
    currentLeads.find((lead) => incomingPhone.length >= 8 && normalizePhoneKey(lead.phone) === incomingPhone) ||
    currentLeads.find((lead) => incomingNameCompany && normalizeNameCompanyKey(lead) === incomingNameCompany) ||
    null
  );
}

function mergeCustomFields(currentFields = {}, incomingFields = {}) {
  const currentCustomFields = normalizeCustomFields(currentFields);
  const incomingCustomFields = normalizeCustomFields(incomingFields);
  const mergedCustomFields = { ...currentCustomFields };

  Object.entries(incomingCustomFields).forEach(([field, value]) => {
    if (!String(mergedCustomFields[field as keyof typeof mergedCustomFields] || "").trim() && String(value || "").trim()) {
      mergedCustomFields[field as keyof typeof mergedCustomFields] = value;
    }
  });

  return mergedCustomFields;
}

function shouldReplaceServiceStatus(currentStatus: ServiceProviderStatus | undefined, incomingStatus: ServiceProviderStatus | undefined): boolean {
  if (!incomingStatus || incomingStatus === "Não sabemos") return false;
  if (!currentStatus || currentStatus === "Não sabemos") return true;

  return false;
}

function mergeLeadData(currentLead: Lead, incomingLead: Lead): Lead {
  const currentMap = normalizeServiceStatusMap(currentLead.serviceStatusMap, currentLead.serviceInterests || []);
  const incomingMap = normalizeServiceStatusMap(incomingLead.serviceStatusMap, incomingLead.serviceInterests || []);
  const mergedMap = { ...currentMap };

  serviceOptions.forEach((service) => {
    if (shouldReplaceServiceStatus(mergedMap[service], incomingMap[service])) {
      mergedMap[service] = incomingMap[service];
    }
  });

  const mergedStatus = currentLead.status === "Novo lead" && incomingLead.status !== "Novo lead" ? incomingLead.status : currentLead.status;
  const isLost = currentLead.isLost || incomingLead.isLost || mergedStatus === "Perdido";

  return {
    ...currentLead,
    name: currentLead.name || incomingLead.name,
    email: currentLead.email || incomingLead.email,
    phone: currentLead.phone || incomingLead.phone,
    company: currentLead.company || incomingLead.company,
    website: currentLead.website || incomingLead.website,
    instagram: currentLead.instagram || incomingLead.instagram,
    advertisesOnMeta: currentLead.advertisesOnMeta || incomingLead.advertisesOnMeta,
    advertisesOnGoogle: currentLead.advertisesOnGoogle || incomingLead.advertisesOnGoogle,
    doesNotAdvertiseOnMeta: currentLead.doesNotAdvertiseOnMeta || incomingLead.doesNotAdvertiseOnMeta,
    doesNotAdvertiseOnGoogle: currentLead.doesNotAdvertiseOnGoogle || incomingLead.doesNotAdvertiseOnGoogle,
    doesNotAdvertise: currentLead.doesNotAdvertise || incomingLead.doesNotAdvertise,
    lastContactAt: currentLead.lastContactAt || incomingLead.lastContactAt,
    contactMadeAt: currentLead.contactMadeAt || incomingLead.contactMadeAt,
    nextContactAt: currentLead.nextContactAt || incomingLead.nextContactAt,
    expectedCloseAt: currentLead.expectedCloseAt || incomingLead.expectedCloseAt,
    estimatedBudget: currentLead.estimatedBudget || incomingLead.estimatedBudget,
    isLost,
    lostReason: currentLead.lostReason || incomingLead.lostReason,
    commercialNotes: [currentLead.commercialNotes, incomingLead.commercialNotes].filter(Boolean).join(currentLead.commercialNotes && incomingLead.commercialNotes ? "\n" : ""),
    status: isLost ? "Perdido" : mergedStatus,
    responsible: currentLead.responsible || incomingLead.responsible,
    temperature: currentLead.temperature || incomingLead.temperature,
    pain: currentLead.pain || incomingLead.pain,
    source: currentLead.source || incomingLead.source,
    serviceInterests: serviceOptions.filter((service) => Boolean(mergedMap[service])),
    serviceStatusMap: mergedMap,
    customFields: mergeCustomFields(currentLead.customFields, incomingLead.customFields),
  };
}

function addLeadToDeduplicationMaps(
  lead: Lead,
  maps: { byEmail: Map<string, Lead>; byPhone: Map<string, Lead>; byNameCompany: Map<string, Lead> },
) {
  const emailKey = normalizeEmailKey(lead.email);
  const phoneKey = normalizePhoneKey(lead.phone);
  const nameCompanyKey = normalizeNameCompanyKey(lead);

  if (emailKey && !maps.byEmail.has(emailKey)) maps.byEmail.set(emailKey, lead);
  if (phoneKey.length >= 8 && !maps.byPhone.has(phoneKey)) maps.byPhone.set(phoneKey, lead);
  if (nameCompanyKey && !maps.byNameCompany.has(nameCompanyKey)) maps.byNameCompany.set(nameCompanyKey, lead);
}

function getLeadFromDeduplicationMaps(
  lead: Lead,
  maps: { byEmail: Map<string, Lead>; byPhone: Map<string, Lead>; byNameCompany: Map<string, Lead> },
): Lead | null {
  const emailKey = normalizeEmailKey(lead.email);
  if (emailKey && maps.byEmail.has(emailKey)) return maps.byEmail.get(emailKey) || null;

  const phoneKey = normalizePhoneKey(lead.phone);
  if (phoneKey.length >= 8 && maps.byPhone.has(phoneKey)) return maps.byPhone.get(phoneKey) || null;

  const nameCompanyKey = normalizeNameCompanyKey(lead);
  if (nameCompanyKey && maps.byNameCompany.has(nameCompanyKey)) return maps.byNameCompany.get(nameCompanyKey) || null;

  return null;
}

export function mergeImportedLeadsWithCurrentBase(incomingLeads: Lead[], currentLeads: Lead[]) {
  const mergedCurrentLeads = [...currentLeads];
  const leadIndexById = new Map(mergedCurrentLeads.map((lead, index) => [lead.id, index]));
  const leadsToSave: Lead[] = [];
  const seenIncomingKeys = new Set<string>();
  const maps = {
    byEmail: new Map<string, Lead>(),
    byPhone: new Map<string, Lead>(),
    byNameCompany: new Map<string, Lead>(),
  };
  const report: ImportDeduplicationReport = {
    received: incomingLeads.length,
    created: 0,
    merged: 0,
    ignoredInsideFile: 0,
  };

  mergedCurrentLeads.forEach((lead) => addLeadToDeduplicationMaps(lead, maps));

  incomingLeads.forEach((incomingLead) => {
    const internalKey = normalizeEmailKey(incomingLead.email) || normalizePhoneKey(incomingLead.phone) || normalizeNameCompanyKey(incomingLead);

    if (internalKey && seenIncomingKeys.has(internalKey)) {
      report.ignoredInsideFile += 1;
      return;
    }

    if (internalKey) seenIncomingKeys.add(internalKey);

    const duplicatedLead = getLeadFromDeduplicationMaps(incomingLead, maps);

    if (duplicatedLead) {
      const mergedLead = mergeLeadData(duplicatedLead, { ...incomingLead, id: duplicatedLead.id });
      const index = leadIndexById.get(duplicatedLead.id);
      if (index !== undefined) mergedCurrentLeads[index] = mergedLead;
      leadsToSave.push(mergedLead);
      addLeadToDeduplicationMaps(mergedLead, maps);
      report.merged += 1;
      return;
    }

    mergedCurrentLeads.unshift(incomingLead);
    leadIndexById.set(incomingLead.id, 0);
    addLeadToDeduplicationMaps(incomingLead, maps);
    leadsToSave.push(incomingLead);
    report.created += 1;
  });

  return { leadsToSave, report };
}

function sortLeadsByPriority(leads: Lead[]): Lead[] {
  return [...leads].sort((a, b) => getLeadScores(b).priority - getLeadScores(a).priority);
}

export function getOperationBuckets(leads: Lead[]): OperationBucket[] {
  const activeLeads = leads.filter(isActiveLead);
  const todayOrLate = activeLeads.filter((lead) => lead.nextContactAt && (isToday(lead.nextContactAt) || isPastDate(lead.nextContactAt)));
  const withoutNextStep = activeLeads.filter((lead) => !lead.nextContactAt);
  const withoutOwner = activeLeads.filter((lead) => !lead.responsible.trim());
  const hot = activeLeads.filter((lead) => lead.temperature === "Quente");
  const migration = activeLeads.filter((lead) => getClientIntelligence(lead).externalAgencyServicesCount > 0);
  const expansion = leads.filter((lead) => !lead.isLost && lead.status !== "Perdido" && getClientIntelligence(lead).casaServicesCount > 0 && getClientIntelligence(lead).unknownServicesCount + getClientIntelligence(lead).notDoneServicesCount > 0);
  const needsMapping = activeLeads.filter((lead) => getLeadScores(lead).mappingUrgency >= 55);
  const parked = activeLeads.filter((lead) => {
    const lastContact = daysSince(lead.lastContactAt || lead.contactMadeAt || lead.createdAt);
    return lastContact !== null && lastContact >= 15;
  });

  return [
    {
      id: "today",
      title: "Contatar hoje",
      subtitle: "Follow-ups vencidos ou para hoje",
      emptyText: "Nenhum follow-up vencido ou agendado para hoje.",
      leads: sortLeadsByPriority(todayOrLate).slice(0, 12),
    },
    {
      id: "without-next-step",
      title: "Sem próximo passo",
      subtitle: "Leads ativos sem data de retorno",
      emptyText: "Todos os leads ativos têm próximo contato.",
      leads: sortLeadsByPriority(withoutNextStep).slice(0, 12),
    },
    {
      id: "without-owner",
      title: "Sem responsável",
      subtitle: "Precisa distribuir para o time",
      emptyText: "Todos os leads ativos têm responsável.",
      leads: sortLeadsByPriority(withoutOwner).slice(0, 12),
    },
    {
      id: "hot",
      title: "Quentes",
      subtitle: "Prioridade comercial direta",
      emptyText: "Nenhum lead quente no momento.",
      leads: sortLeadsByPriority(hot).slice(0, 12),
    },
    {
      id: "migration",
      title: "Migração de agência",
      subtitle: "Serviços hoje com outro fornecedor",
      emptyText: "Nenhuma oportunidade de migração mapeada.",
      leads: sortLeadsByPriority(migration).slice(0, 12),
    },
    {
      id: "expansion",
      title: "Expansão Casa do Ads",
      subtitle: "Já compra algo e ainda tem lacuna",
      emptyText: "Nenhuma expansão mapeada agora.",
      leads: sortLeadsByPriority(expansion).slice(0, 12),
    },
    {
      id: "mapping",
      title: "Precisa mapear",
      subtitle: "Score alto de falta de diagnóstico",
      emptyText: "Nenhum lead crítico de mapeamento.",
      leads: sortLeadsByPriority(needsMapping).slice(0, 12),
    },
    {
      id: "parked",
      title: "Parados há 15+ dias",
      subtitle: "Ativos sem avanço recente",
      emptyText: "Nenhum lead parado há mais de 15 dias.",
      leads: sortLeadsByPriority(parked).slice(0, 12),
    },
  ];
}

export function getTodayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getTomorrowInputValue(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().slice(0, 10);
}

export function getLeadStatusAfterContact(currentStatus: LeadStatus): LeadStatus {
  if (currentStatus === "Novo lead" || currentStatus === "Sem resposta") return "Contato feito";
  return currentStatus;
}
