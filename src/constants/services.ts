import type { Lead, ServiceInterest, ServiceProviderStatus, ServiceStatusMap } from "../types/Lead";

export const serviceOptions: ServiceInterest[] = [
  "Criação de Website",
  "Mentorias em Google Ads",
  "Mentorias em Meta Ads",
  "Mentorias em LinkedIn Ads",
  "Mentorias em Canva",
  "Mentorias em CapCut",
  "Mentorias AEO",
  "Gerenciamento Google",
  "Gerenciamento Meta",
  "Gerenciamento LinkedIn Ads",
  "Social Media",
  "Projeto Copy - LinkedIn, Perfil de Empresa e Blog no site",
];

export const serviceProviderStatusOptions: ServiceProviderStatus[] = [
  "Casa do Ads",
  "Outra agência",
  "Não é feito",
  "Não sabemos",
];

export type InferredAnswer = "Sim" | "Não" | "Não sabemos";

export type ClientIntelligenceId =
  | "announcesGoogle"
  | "announcesMeta"
  | "announcesLinkedIn"
  | "hasWebsite"
  | "hasGooglePresence"
  | "createsContent"
  | "usesAi"
  | "isCasaClient"
  | "usesExternalAgency"
  | "hasMigrationOpportunity"
  | "hasExpansionOpportunity"
  | "needsMapping";

export type ClientIntelligenceItem = {
  id: ClientIntelligenceId;
  label: string;
  value: InferredAnswer;
  className: string;
  description: string;
};

export type ClientIntelligenceSummary = {
  items: ClientIntelligenceItem[];
  counts: Record<ServiceProviderStatus, number>;
  casaServicesCount: number;
  externalAgencyServicesCount: number;
  notDoneServicesCount: number;
  unknownServicesCount: number;
  hasAnyPaidTraffic: boolean;
  hasAnyConfirmedInformation: boolean;
};

export const strategicServiceGroups = {
  googleAds: ["Gerenciamento Google", "Mentorias em Google Ads"] as ServiceInterest[],
  metaAds: ["Gerenciamento Meta", "Mentorias em Meta Ads"] as ServiceInterest[],
  linkedInAds: ["Gerenciamento LinkedIn Ads", "Mentorias em LinkedIn Ads"] as ServiceInterest[],
  website: ["Criação de Website"] as ServiceInterest[],
  googlePresence: ["Projeto Copy - LinkedIn, Perfil de Empresa e Blog no site"] as ServiceInterest[],
  content: ["Social Media", "Projeto Copy - LinkedIn, Perfil de Empresa e Blog no site"] as ServiceInterest[],
  ai: ["Mentorias AEO"] as ServiceInterest[],
};

function getInferredAnswerClass(value: InferredAnswer): string {
  if (value === "Sim") return "badgeGreen";
  if (value === "Não") return "badgeRed";
  return "badgeGray";
}

function inferAnswerFromStatuses(statuses: ServiceProviderStatus[]): InferredAnswer {
  if (statuses.some((status) => status === "Casa do Ads" || status === "Outra agência")) return "Sim";
  if (statuses.length > 0 && statuses.every((status) => status === "Não é feito")) return "Não";
  return "Não sabemos";
}

function inferAnswerForServices(
  serviceStatusMap: ServiceStatusMap | undefined,
  servicesToCheck: ServiceInterest[],
  serviceInterests: ServiceInterest[] = [],
): InferredAnswer {
  const normalizedMap = normalizeServiceStatusMap(serviceStatusMap, serviceInterests);
  const statuses = servicesToCheck.map((service) => normalizedMap[service] || "Não sabemos");

  return inferAnswerFromStatuses(statuses);
}

function countServiceStatuses(serviceStatusMap: ServiceStatusMap | undefined, serviceInterests: ServiceInterest[] = []): Record<ServiceProviderStatus, number> {
  const normalizedMap = normalizeServiceStatusMap(serviceStatusMap, serviceInterests);
  const counts: Record<ServiceProviderStatus, number> = {
    "Casa do Ads": 0,
    "Outra agência": 0,
    "Não é feito": 0,
    "Não sabemos": 0,
  };

  serviceOptions.forEach((service) => {
    const status = normalizedMap[service] || "Não sabemos";
    counts[status] += 1;
  });

  return counts;
}

function createIntelligenceItem(
  id: ClientIntelligenceId,
  label: string,
  value: InferredAnswer,
  description: string,
): ClientIntelligenceItem {
  return {
    id,
    label,
    value,
    className: getInferredAnswerClass(value),
    description,
  };
}

export function getClientIntelligence(lead: Lead): ClientIntelligenceSummary {
  const counts = countServiceStatuses(lead.serviceStatusMap, lead.serviceInterests || []);
  const casaServicesCount = counts["Casa do Ads"];
  const externalAgencyServicesCount = counts["Outra agência"];
  const notDoneServicesCount = counts["Não é feito"];
  const unknownServicesCount = counts["Não sabemos"];

  const announcesGoogle = inferAnswerForServices(lead.serviceStatusMap, strategicServiceGroups.googleAds, lead.serviceInterests || []);
  const announcesMeta = inferAnswerForServices(lead.serviceStatusMap, strategicServiceGroups.metaAds, lead.serviceInterests || []);
  const announcesLinkedIn = inferAnswerForServices(lead.serviceStatusMap, strategicServiceGroups.linkedInAds, lead.serviceInterests || []);
  const hasWebsite = inferAnswerForServices(lead.serviceStatusMap, strategicServiceGroups.website, lead.serviceInterests || []);
  const hasGooglePresence = inferAnswerForServices(lead.serviceStatusMap, strategicServiceGroups.googlePresence, lead.serviceInterests || []);
  const createsContent = inferAnswerForServices(lead.serviceStatusMap, strategicServiceGroups.content, lead.serviceInterests || []);
  const usesAi = inferAnswerForServices(lead.serviceStatusMap, strategicServiceGroups.ai, lead.serviceInterests || []);
  const isCasaClient: InferredAnswer = casaServicesCount > 0 ? "Sim" : "Não";
  const usesExternalAgency: InferredAnswer = externalAgencyServicesCount > 0 ? "Sim" : "Não";
  const hasMigrationOpportunity: InferredAnswer = externalAgencyServicesCount > 0 ? "Sim" : "Não";
  const hasExpansionOpportunity: InferredAnswer = casaServicesCount > 0 && (externalAgencyServicesCount > 0 || notDoneServicesCount > 0 || unknownServicesCount > 0) ? "Sim" : "Não";
  const needsMapping: InferredAnswer = unknownServicesCount > 0 ? "Sim" : "Não";

  return {
    items: [
      createIntelligenceItem("announcesGoogle", "Anuncia no Google", announcesGoogle, "Inferido a partir de Gerenciamento Google e Mentorias em Google Ads."),
      createIntelligenceItem("announcesMeta", "Anuncia na Meta", announcesMeta, "Inferido a partir de Gerenciamento Meta e Mentorias em Meta Ads."),
      createIntelligenceItem("announcesLinkedIn", "Anuncia no LinkedIn", announcesLinkedIn, "Inferido a partir de Gerenciamento LinkedIn Ads e Mentorias em LinkedIn Ads."),
      createIntelligenceItem("hasWebsite", "Tem site", hasWebsite, "Inferido a partir do serviço Criação de Website."),
      createIntelligenceItem("hasGooglePresence", "Presença Google", hasGooglePresence, "Inferido a partir do serviço Perfil de Empresa dentro do Projeto Copy."),
      createIntelligenceItem("createsContent", "Produz conteúdo", createsContent, "Inferido a partir de Social Media e Projeto Copy."),
      createIntelligenceItem("usesAi", "Usa IA/AEO", usesAi, "Inferido a partir de Mentorias AEO."),
      createIntelligenceItem("isCasaClient", "Cliente Casa", isCasaClient, "Existe pelo menos um serviço feito pela Casa do Ads."),
      createIntelligenceItem("usesExternalAgency", "Usa agência externa", usesExternalAgency, "Existe pelo menos um serviço feito por outra agência."),
      createIntelligenceItem("hasMigrationOpportunity", "Oportunidade de migração", hasMigrationOpportunity, "Existe serviço em outra agência que pode ser auditado e migrado."),
      createIntelligenceItem("hasExpansionOpportunity", "Oportunidade de expansão", hasExpansionOpportunity, "Cliente já compra da Casa do Ads e ainda tem lacunas comerciais."),
      createIntelligenceItem("needsMapping", "Precisa mapear", needsMapping, "Existe pelo menos um serviço marcado como Não sabemos."),
    ],
    counts,
    casaServicesCount,
    externalAgencyServicesCount,
    notDoneServicesCount,
    unknownServicesCount,
    hasAnyPaidTraffic: announcesGoogle === "Sim" || announcesMeta === "Sim" || announcesLinkedIn === "Sim",
    hasAnyConfirmedInformation: casaServicesCount + externalAgencyServicesCount + notDoneServicesCount > 0,
  };
}

export function getClientIntelligenceItem(lead: Lead, id: ClientIntelligenceId): ClientIntelligenceItem {
  return getClientIntelligence(lead).items.find((item) => item.id === id)!;
}

export function getLeadWithSyncedAdvertisingFromServices(lead: Lead): Lead {
  const intelligence = getClientIntelligence(lead);
  const google = intelligence.items.find((item) => item.id === "announcesGoogle")?.value || "Não sabemos";
  const meta = intelligence.items.find((item) => item.id === "announcesMeta")?.value || "Não sabemos";

  const advertisesOnGoogle = google === "Sim" ? true : google === "Não" ? false : lead.advertisesOnGoogle;
  const advertisesOnMeta = meta === "Sim" ? true : meta === "Não" ? false : lead.advertisesOnMeta;
  const doesNotAdvertise = advertisesOnGoogle || advertisesOnMeta ? false : google === "Não" && meta === "Não" ? true : lead.doesNotAdvertise;

  return {
    ...lead,
    advertisesOnGoogle,
    advertisesOnMeta,
    doesNotAdvertise,
  };
}


const serviceAliases: Record<ServiceInterest, string[]> = {
  "Criação de Website": ["criacao de website", "criação de website", "site", "website", "criacao de site", "criação de site"],
  "Mentorias em Google Ads": ["mentoria google ads", "mentorias google ads", "mentoria em google", "curso google ads"],
  "Mentorias em Meta Ads": ["mentoria meta ads", "mentorias meta ads", "mentoria em meta", "curso meta ads", "facebook ads"],
  "Mentorias em LinkedIn Ads": ["mentoria linkedin ads", "mentorias linkedin ads", "mentoria em linkedin", "curso linkedin ads", "linkedin ads"],
  "Mentorias em Canva": ["mentoria canva", "mentorias canva", "canva"],
  "Mentorias em CapCut": ["mentoria capcut", "mentorias capcut", "capcut", "cap cut"],
  "Mentorias AEO": ["mentoria aeo", "mentorias aeo", "aeo", "respostas da ia", "recomendado pelo chatgpt"],
  "Gerenciamento Google": ["gerenciamento google", "gestao google", "gestão google", "gerenciamento google ads", "gestao google ads"],
  "Gerenciamento Meta": ["gerenciamento meta", "gestao meta", "gestão meta", "gerenciamento meta ads", "gestao meta ads"],
  "Gerenciamento LinkedIn Ads": ["gerenciamento linkedin", "gerenciamento linkedin ads", "gestao linkedin", "gestão linkedin", "linkedin ads"],
  "Social Media": ["social media", "redes sociais", "conteudo redes sociais", "conteúdo redes sociais"],
  "Projeto Copy - LinkedIn, Perfil de Empresa e Blog no site": [
    "projeto copy",
    "copy linkedin",
    "perfil de empresa",
    "blog no site",
    "linkedin perfil de empresa blog",
  ],
};

function normalizeServiceText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isValidServiceProviderStatus(status: unknown): status is ServiceProviderStatus {
  return serviceProviderStatusOptions.includes(status as ServiceProviderStatus);
}

export function createEmptyServiceStatusMap(): ServiceStatusMap {
  return serviceOptions.reduce<ServiceStatusMap>((map, service) => {
    map[service] = "Não sabemos";
    return map;
  }, {});
}

export function getServiceInterestsFromStatusMap(serviceStatusMap: ServiceStatusMap = {}): ServiceInterest[] {
  return serviceOptions.filter((service) => Boolean(serviceStatusMap[service]));
}

export function normalizeServiceStatusMap(
  serviceStatusMap: ServiceStatusMap | undefined,
  serviceInterests: ServiceInterest[] = [],
): ServiceStatusMap {
  const normalizedMap: ServiceStatusMap = {};

  serviceOptions.forEach((service) => {
    const status = serviceStatusMap?.[service];

    if (isValidServiceProviderStatus(status)) {
      normalizedMap[service] = status;
      return;
    }

    if (serviceInterests.includes(service)) {
      normalizedMap[service] = "Não sabemos";
      return;
    }

    normalizedMap[service] = "Não sabemos";
  });

  return normalizedMap;
}

export function getServiceStatusBadgeClass(status: ServiceProviderStatus): string {
  if (status === "Casa do Ads") return "badgeBlue";
  if (status === "Outra agência") return "badgeYellow";
  if (status === "Não é feito") return "badgeRed";
  if (status === "Não sabemos") return "badgeGray";

  return "badgeGray";
}

export function formatServices(services: ServiceInterest[] = []): string {
  return services.length ? services.join(", ") : "";
}

export function formatServiceStatusMap(serviceStatusMap: ServiceStatusMap = {}): string {
  const normalizedMap = normalizeServiceStatusMap(serviceStatusMap);

  return serviceOptions.map((service) => `${service}: ${normalizedMap[service] || "Não sabemos"}`).join(" | ");
}

export function parseServiceInterests(value: string): ServiceInterest[] {
  const normalizedValue = normalizeServiceText(value);

  if (!normalizedValue) return [];

  return serviceOptions.filter((service) => {
    const aliases = [service, ...serviceAliases[service]].map(normalizeServiceText);
    return aliases.some((alias) => normalizedValue.includes(alias));
  });
}

function parseServiceProviderStatus(value: string): ServiceProviderStatus {
  const normalizedValue = normalizeServiceText(value);

  if (!normalizedValue) return "Não sabemos";

  if (normalizedValue.includes("casa do ads") || normalizedValue.includes("casa ads")) {
    return "Casa do Ads";
  }

  if (
    normalizedValue.includes("outra agencia") ||
    normalizedValue.includes("agencia") ||
    normalizedValue.includes("terceiro") ||
    normalizedValue.includes("fornecedor")
  ) {
    return "Outra agência";
  }

  if (
    normalizedValue.includes("nao e feito") ||
    normalizedValue.includes("nao eh feito") ||
    normalizedValue.includes("nao faz") ||
    normalizedValue.includes("nao feito") ||
    normalizedValue.includes("sem fazer") ||
    normalizedValue.includes("ninguem faz")
  ) {
    return "Não é feito";
  }

  if (
    normalizedValue.includes("nao sabemos") ||
    normalizedValue.includes("nao sabe") ||
    normalizedValue.includes("nao sei") ||
    normalizedValue.includes("desconhecido") ||
    normalizedValue.includes("a confirmar")
  ) {
    return "Não sabemos";
  }

  return "Não sabemos";
}

export function parseServiceStatusMap(value: string): ServiceStatusMap {
  const detectedServices = parseServiceInterests(value);
  const serviceStatusMap = createEmptyServiceStatusMap();

  detectedServices.forEach((service) => {
    serviceStatusMap[service] = parseServiceProviderStatus(value);
  });

  return serviceStatusMap;
}
