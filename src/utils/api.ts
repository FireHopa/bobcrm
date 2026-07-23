import { normalizeCustomFields } from "../constants/customFields";
import { normalizeServiceStatusMap, getServiceInterestsFromStatusMap } from "../constants/services";
import type { AuditEntry, BackupEntry, CRMTask, CRMTeam, CRMUser, ExternalLeadOrigin, Lead, LeadAccessScope, LeadNote, TaskPriority, TaskType, TodayDashboard } from "../types/Lead";
import type { KanbanBoardData, KanbanBoardFilters, KanbanLeadSearchResult, KanbanPipeline, KanbanStage } from "../types/Kanban";

export type ServerHealth = {
  ok: boolean;
  storage: "sqlite" | "mysql";
  version: string;
  authRequired: boolean;
  database?: boolean | string;
  worker?: boolean;
  activeJobs?: number;
  latencyMs?: number;
  reason?: string;
  host?: string;
  backupsDirectory?: string;
  leads?: number;
  deletedLeads?: number;
  users?: number;
};

export type LoginResponse = {
  csrfToken: string;
  expiresAt: string;
  user: CRMUser;
};

type CurrentSessionResponse = {
  csrfToken: string;
  user: CRMUser;
};

export class ApiRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

export type ServerImportReport = {
  received: number;
  created: number;
  merged: number;
  ignoredInsideFile: number;
};

export type ImportLeadsBatchResult = {
  leads: Lead[];
  report: ServerImportReport;
};

export type AsyncJobStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export type AsyncJob = {
  id: string;
  type: string;
  status: AsyncJobStatus;
  progressCurrent: number;
  progressTotal: number;
  progressMessage: string;
  attempts: number;
  maxAttempts: number;
  result: Record<string, unknown>;
  artifact: null | {
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    expiresAt: string;
  };
  errorCode: string;
  errorMessage: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  completedAt: string;
  failedAt: string;
  expiresAt: string;
};

export type LeadPagination = {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextCursor: string;
  sortBy: string;
  sortDirection: "asc" | "desc";
};

export type LeadScopeMeta = {
  kind: "base_complete" | "equipe" | "carteira_usuario" | "sem_acesso" | "filtro_atual";
  label: string;
  scope: LeadAccessScope;
  memberCount?: number;
  total?: number;
};

export type LeadSummary = {
  total: number;
  active: number;
  dueFollowUps: number;
  highPriority: number;
  withoutOwner: number;
  withoutNextStep: number;
  hotLeads: number;
  agencyOpportunities: number;
  needsMapping: number;
  expansionOpportunities: number;
  deleted: number;
  scope?: LeadScopeMeta;
  generatedAt?: string;
};

export type OpportunitySummary = {
  total: number;
  expansion: number;
  migration: number;
  mapping: number;
  priority: number;
  agency: number;
  withoutDiagnosis: number;
  mappingCritical: number;
  serviceStatuses: {
    "Casa do Ads": number;
    "Outra agência": number;
    "Não é feito": number;
    "Não sabemos": number;
  };
  scope?: LeadScopeMeta;
  generatedAt?: string;
};

export type AdminLeadOverview = {
  total: number;
  withOwner: number;
  withTemperature: number;
  withPain: number;
  withNextContact: number;
  withWebsite: number;
  withoutOwner: number;
  withoutConfirmedDiagnosis: number;
  highMappingUrgency: number;
  duplicateGroups: number;
  scope?: LeadScopeMeta;
  generatedAt?: string;
};

export type DuplicateGroup = {
  key: string;
  duplicateKey: string;
  label: string;
  reason: "email" | "phone" | "nameCompany";
  total: number;
  isTruncated: boolean;
  leads: Lead[];
};

export type DuplicateGroupsPage = {
  groups: DuplicateGroup[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  scope?: LeadScopeMeta;
};

export type LeadFilterOptions = {
  owners: { name: string; total: number }[];
  scope?: LeadScopeMeta;
};

export type FetchLeadsParams = {
  search?: string;
  status?: string;
  temperature?: string;
  responsible?: string;
  quickFilter?: string;
  limit?: number;
  offset?: number;
  cursor?: string;
  sortBy?: "updatedAt" | "createdAt" | "name" | "company" | "status" | "temperature" | "responsible" | "nextContactAt" | "lastContactAt";
  sortDirection?: "asc" | "desc";
  includeSummary?: boolean;
  includeOpportunitySummary?: boolean;
};

export type FetchLeadsPageResult = {
  leads: Lead[];
  pagination: LeadPagination;
  summary: LeadSummary;
  hasSummary: boolean;
  opportunitySummary: OpportunitySummary;
  filteredOpportunitySummary: OpportunitySummary;
  hasOpportunitySummary: boolean;
};

type ApiRequestOptions = RequestInit & {
  timeoutMs?: number;
};

const DEFAULT_API_TIMEOUT_MS = 20000;
const BOOT_API_TIMEOUT_MS = 8000;
const LONG_API_TIMEOUT_MS = 300000;

const LEGACY_TOKEN_KEY = "crmCasaAdsV30Token";
const CSRF_TOKEN_KEY = "crmCasaAdsCsrfToken";

function getCsrfToken(): string {
  return sessionStorage.getItem(CSRF_TOKEN_KEY) || "";
}

function setCsrfToken(token: string) {
  if (token) sessionStorage.setItem(CSRF_TOKEN_KEY, token);
  else sessionStorage.removeItem(CSRF_TOKEN_KEY);
}

export function clearServerSessionState() {
  sessionStorage.removeItem(CSRF_TOKEN_KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
}

function isUnsafeMethod(method: unknown): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(String(method || "GET").toUpperCase());
}

// Remove automaticamente tokens legados do navegador. A autenticação atual usa cookie HttpOnly.
localStorage.removeItem(LEGACY_TOKEN_KEY);

export function hasPermission(user: CRMUser | null, permission: string): boolean {
  return Boolean(user?.permissions?.includes(permission));
}

function normalizeBooleanText(value: unknown): boolean {
  const normalized = String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  return ["sim", "s", "yes", "y", "true", "1", "ok", "ativo", "anuncia", "x"].includes(normalized);
}

async function requestApi<ResponseBody>(path: string, options: ApiRequestOptions = {}): Promise<ResponseBody> {
  const { timeoutMs = DEFAULT_API_TIMEOUT_MS, signal: externalSignal, ...fetchOptions } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(fetchOptions.headers as Record<string, string> | undefined),
  };
  const csrfToken = getCsrfToken();
  if (isUnsafeMethod(fetchOptions.method) && csrfToken) headers["X-CSRF-Token"] = csrfToken;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  let response: Response;

  try {
    response = await fetch(path, {
      ...fetchOptions,
      headers,
      credentials: "include",
      signal: controller.signal,
    });
  } catch (caughtError) {
    if (controller.signal.aborted) {
      if (externalSignal?.aborted) {
        const abortedError = new Error("Requisição cancelada.");
        abortedError.name = "AbortError";
        throw abortedError;
      }
      throw new Error("O servidor demorou para responder. Confirme se o terminal do backend está rodando e tente novamente.");
    }

    throw caughtError;
  } finally {
    window.clearTimeout(timeoutId);
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    if (response.status === 401) clearServerSessionState();
    const message = payload?.message || `Erro ${response.status} ao comunicar com o servidor.`;
    throw new ApiRequestError(message, response.status);
  }

  return payload as ResponseBody;
}

async function downloadFile(path: string, fallbackFileName: string) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), LONG_API_TIMEOUT_MS);
  const response = await fetch(path, {
    credentials: "include",
    signal: controller.signal,
  }).finally(() => window.clearTimeout(timeoutId));

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    if (response.status === 401) clearServerSessionState();
    throw new ApiRequestError(payload?.message || `Erro ${response.status} ao baixar o arquivo.`, response.status);
  }

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const fileNameMatch = disposition.match(/filename="?([^";]+)"?/i);
  const fileName = fileNameMatch?.[1] || fallbackFileName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}


function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForJob(initialJob: AsyncJob, options: { timeoutMs?: number; pollIntervalMs?: number } = {}): Promise<AsyncJob> {
  const timeoutMs = options.timeoutMs ?? LONG_API_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? 800;
  const deadline = Date.now() + timeoutMs;
  let job = initialJob;

  while (job.status === "queued" || job.status === "running") {
    if (Date.now() >= deadline) {
      throw new Error("O processamento continua no servidor, mas excedeu o tempo de acompanhamento desta tela. Consulte novamente em instantes.");
    }
    await delay(pollIntervalMs);
    job = await requestApi<AsyncJob>(`/api/jobs/${encodeURIComponent(job.id)}`, { timeoutMs: DEFAULT_API_TIMEOUT_MS });
  }

  if (job.status !== "completed") {
    throw new ApiRequestError(job.errorMessage || "O processamento assíncrono falhou.", 422);
  }
  return job;
}

async function enqueueAndWaitForJob(path: string, body: Record<string, unknown>, timeoutMs = LONG_API_TIMEOUT_MS): Promise<AsyncJob> {
  const queued = await requestApi<AsyncJob>(path, {
    method: "POST",
    body: JSON.stringify(body),
    timeoutMs: DEFAULT_API_TIMEOUT_MS,
  });
  return waitForJob(queued, { timeoutMs });
}

export function normalizeLeadFromApi(lead: Partial<Lead>): Lead {
  const status = lead.status || (lead.isLost ? "Perdido" : "Novo lead");
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
    updatedAt: lead.updatedAt || "",
    deletedAt: lead.deletedAt || "",
    deletedBy: lead.deletedBy || "",
    restoredAt: lead.restoredAt || "",
    restoredBy: lead.restoredBy || "",
    pipelineId: lead.pipelineId || "",
    pipelineStageId: lead.pipelineStageId || "",
    kanbanPosition: Number(lead.kanbanPosition || 0),
    pipelineEnteredAt: lead.pipelineEnteredAt || "",
  };
}

const DEFAULT_LEAD_PAGE_SIZE = 150;

const emptySummary: LeadSummary = {
  total: 0,
  active: 0,
  dueFollowUps: 0,
  highPriority: 0,
  withoutOwner: 0,
  withoutNextStep: 0,
  hotLeads: 0,
  agencyOpportunities: 0,
  needsMapping: 0,
  expansionOpportunities: 0,
  deleted: 0,
};

export const emptyOpportunitySummary: OpportunitySummary = {
  total: 0,
  expansion: 0,
  migration: 0,
  mapping: 0,
  priority: 0,
  agency: 0,
  withoutDiagnosis: 0,
  mappingCritical: 0,
  serviceStatuses: {
    "Casa do Ads": 0,
    "Outra agência": 0,
    "Não é feito": 0,
    "Não sabemos": 0,
  },
};

function buildQueryString(params: FetchLeadsParams = {}): string {
  const searchParams = new URLSearchParams();
  const limit = params.limit ?? DEFAULT_LEAD_PAGE_SIZE;
  const offset = params.offset ?? 0;

  searchParams.set("limit", String(limit));
  searchParams.set("offset", String(offset));
  if (params.cursor) searchParams.set("cursor", params.cursor);
  if (params.sortBy) searchParams.set("sortBy", params.sortBy);
  if (params.sortDirection) searchParams.set("sortDirection", params.sortDirection);

  if (params.search?.trim()) searchParams.set("search", params.search.trim());
  if (params.status?.trim()) searchParams.set("status", params.status.trim());
  if (params.temperature?.trim()) searchParams.set("temperature", params.temperature.trim());
  if (params.responsible?.trim()) searchParams.set("responsible", params.responsible.trim());
  if (params.quickFilter?.trim() && params.quickFilter !== "all") searchParams.set("quickFilter", params.quickFilter.trim());
  if (params.includeSummary === false) searchParams.set("summary", "0");
  if (params.includeOpportunitySummary) searchParams.set("opportunitySummary", "1");

  return searchParams.toString();
}

function normalizeLeadPageResponse(
  response: Partial<Lead>[] | {
    leads?: Partial<Lead>[];
    pagination?: Partial<LeadPagination>;
    summary?: Partial<LeadSummary>;
    opportunitySummary?: Partial<OpportunitySummary>;
    filteredOpportunitySummary?: Partial<OpportunitySummary>;
    scope?: LeadScopeMeta;
  },
  params: FetchLeadsParams = {},
): FetchLeadsPageResult {
  const rawLeads = Array.isArray(response) ? response : Array.isArray(response.leads) ? response.leads : [];
  const leads = rawLeads.map(normalizeLeadFromApi);
  const rawPagination = Array.isArray(response) ? {} : response.pagination || {};
  const hasSummary = !Array.isArray(response) && Boolean(response.summary);
  const rawSummary = Array.isArray(response) ? {} : response.summary || {};
  const rawOpportunitySummary = Array.isArray(response) ? {} : response.opportunitySummary || {};
  const rawFilteredOpportunitySummary = Array.isArray(response) ? {} : response.filteredOpportunitySummary || {};
  const limit = Number(rawPagination.limit ?? params.limit ?? DEFAULT_LEAD_PAGE_SIZE);
  const offset = Number(rawPagination.offset ?? params.offset ?? 0);
  const total = Number(rawPagination.total ?? leads.length);

  return {
    leads,
    pagination: {
      total,
      limit,
      offset,
      hasMore: Boolean(rawPagination.hasMore ?? offset + leads.length < total),
      nextCursor: String(rawPagination.nextCursor || ""),
      sortBy: String(rawPagination.sortBy || params.sortBy || "updatedAt"),
      sortDirection: rawPagination.sortDirection === "asc" ? "asc" : "desc",
    },
    summary: {
      total: Number(rawSummary.total ?? total),
      active: Number(rawSummary.active ?? 0),
      dueFollowUps: Number(rawSummary.dueFollowUps ?? 0),
      highPriority: Number(rawSummary.highPriority ?? 0),
      withoutOwner: Number(rawSummary.withoutOwner ?? 0),
      withoutNextStep: Number(rawSummary.withoutNextStep ?? 0),
      hotLeads: Number(rawSummary.hotLeads ?? 0),
      agencyOpportunities: Number(rawSummary.agencyOpportunities ?? 0),
      needsMapping: Number(rawSummary.needsMapping ?? 0),
      expansionOpportunities: Number(rawSummary.expansionOpportunities ?? 0),
      deleted: Number(rawSummary.deleted ?? 0),
      scope: rawSummary.scope,
      generatedAt: rawSummary.generatedAt,
    },
    hasSummary,
    opportunitySummary: normalizeOpportunitySummary(rawOpportunitySummary),
    filteredOpportunitySummary: normalizeOpportunitySummary(rawFilteredOpportunitySummary),
    hasOpportunitySummary: !Array.isArray(response) && Boolean(response.opportunitySummary),
  };
}

function normalizeOpportunitySummary(summary: Partial<OpportunitySummary> = {}): OpportunitySummary {
  return {
    total: Number(summary.total ?? 0),
    expansion: Number(summary.expansion ?? 0),
    migration: Number(summary.migration ?? 0),
    mapping: Number(summary.mapping ?? 0),
    priority: Number(summary.priority ?? 0),
    agency: Number(summary.agency ?? 0),
    withoutDiagnosis: Number(summary.withoutDiagnosis ?? 0),
    mappingCritical: Number(summary.mappingCritical ?? 0),
    serviceStatuses: {
      "Casa do Ads": Number(summary.serviceStatuses?.["Casa do Ads"] ?? 0),
      "Outra agência": Number(summary.serviceStatuses?.["Outra agência"] ?? 0),
      "Não é feito": Number(summary.serviceStatuses?.["Não é feito"] ?? 0),
      "Não sabemos": Number(summary.serviceStatuses?.["Não sabemos"] ?? 0),
    },
    scope: summary.scope,
    generatedAt: summary.generatedAt,
  };
}

export async function checkServerHealth(options: { timeoutMs?: number } = {}): Promise<ServerHealth> {
  return requestApi<ServerHealth>("/api/health", { timeoutMs: options.timeoutMs ?? BOOT_API_TIMEOUT_MS });
}

export async function loginToServer(email: string, password: string): Promise<LoginResponse> {
  clearServerSessionState();
  const response = await requestApi<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setCsrfToken(response.csrfToken);
  return response;
}

export async function fetchCurrentUser(): Promise<CRMUser> {
  const response = await requestApi<CurrentSessionResponse>("/api/auth/me", { timeoutMs: BOOT_API_TIMEOUT_MS });
  setCsrfToken(response.csrfToken);
  return response.user;
}

export async function logoutFromServer(): Promise<void> {
  try {
    await requestApi<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
  } finally {
    clearServerSessionState();
  }
}

export async function fetchLeadPageFromServer(params: FetchLeadsParams = {}): Promise<FetchLeadsPageResult> {
  const queryString = buildQueryString(params);
  const response = await requestApi<
    Partial<Lead>[] | {
      leads?: Partial<Lead>[];
      pagination?: Partial<LeadPagination>;
      summary?: Partial<LeadSummary>;
      opportunitySummary?: Partial<OpportunitySummary>;
      filteredOpportunitySummary?: Partial<OpportunitySummary>;
      scope?: LeadScopeMeta;
    }
  >(`/api/leads?${queryString}`, { timeoutMs: 60000 });

  return normalizeLeadPageResponse(response, params);
}

export async function fetchLeadSummaryFromServer(): Promise<LeadSummary> {
  return requestApi<LeadSummary>("/api/leads/summary", { timeoutMs: DEFAULT_API_TIMEOUT_MS });
}

export async function fetchOpportunitySummaryFromServer(): Promise<OpportunitySummary> {
  const summary = await requestApi<Partial<OpportunitySummary>>("/api/leads/opportunities/summary", { timeoutMs: 60000 });
  return normalizeOpportunitySummary(summary);
}

export async function fetchAdminLeadOverviewFromServer(): Promise<AdminLeadOverview> {
  return requestApi<AdminLeadOverview>("/api/admin/leads/overview", { timeoutMs: 60000 });
}

export async function fetchDuplicateGroupsFromServer(params: { limit?: number; offset?: number } = {}): Promise<DuplicateGroupsPage> {
  const search = new URLSearchParams();
  search.set("limit", String(params.limit ?? 20));
  search.set("offset", String(params.offset ?? 0));
  const response = await requestApi<{
    groups?: Array<Omit<DuplicateGroup, "leads"> & { leads?: Partial<Lead>[] }>;
    pagination?: Partial<DuplicateGroupsPage["pagination"]>;
    scope?: LeadScopeMeta;
  }>(`/api/leads/duplicates?${search.toString()}`, { timeoutMs: 60000 });
  const groups: DuplicateGroup[] = Array.isArray(response.groups) ? response.groups.map((group): DuplicateGroup => {
    const reason: DuplicateGroup["reason"] = group.reason === "email" || group.reason === "phone" ? group.reason : "nameCompany";
    return {
      key: String(group.key || ""),
      duplicateKey: String(group.duplicateKey || ""),
      label: String(group.label || ""),
      reason,
      total: Number(group.total || 0),
      isTruncated: Boolean(group.isTruncated),
      leads: Array.isArray(group.leads) ? group.leads.map(normalizeLeadFromApi) : [],
    };
  }) : [];
  const limit = Number(response.pagination?.limit ?? params.limit ?? 20);
  const offset = Number(response.pagination?.offset ?? params.offset ?? 0);
  const total = Number(response.pagination?.total ?? groups.length);
  return {
    groups,
    pagination: {
      total,
      limit,
      offset,
      hasMore: Boolean(response.pagination?.hasMore ?? offset + groups.length < total),
    },
    scope: response.scope,
  };
}

export async function fetchLeadFilterOptionsFromServer(): Promise<LeadFilterOptions> {
  return requestApi<LeadFilterOptions>("/api/leads/filter-options", { timeoutMs: DEFAULT_API_TIMEOUT_MS });
}

export async function fetchLeadByIdFromServer(leadId: string): Promise<Lead> {
  const lead = await requestApi<Partial<Lead>>(`/api/leads/${encodeURIComponent(leadId)}`);
  return normalizeLeadFromApi(lead);
}

function buildKanbanQueryString(filters: KanbanBoardFilters = {}, extra: Record<string, string | number | undefined> = {}) {
  const params = new URLSearchParams();
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.status?.trim()) params.set("status", filters.status.trim());
  if (filters.temperature?.trim()) params.set("temperature", filters.temperature.trim());
  if (filters.responsible?.trim()) params.set("responsible", filters.responsible.trim());
  if (filters.quickFilter?.trim() && filters.quickFilter !== "all") params.set("quickFilter", filters.quickFilter.trim());
  Object.entries(extra).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  return params.toString();
}

function normalizeKanbanStage(stage: Partial<KanbanStage>): KanbanStage {
  return {
    id: stage.id || "",
    pipelineId: stage.pipelineId || "",
    name: stage.name || "Etapa",
    color: stage.color || "#64748B",
    position: Number(stage.position || 0),
    stageType: stage.stageType === "won" || stage.stageType === "lost" ? stage.stageType : "open",
    statusKey: stage.statusKey || "",
    wipLimit: Number(stage.wipLimit || 0),
    isArchived: Boolean(stage.isArchived),
    cardCount: Number(stage.cardCount || 0),
    createdAt: stage.createdAt || "",
    updatedAt: stage.updatedAt || "",
  };
}

function normalizeKanbanPipeline(pipeline: Partial<KanbanPipeline>): KanbanPipeline {
  return {
    id: pipeline.id || "",
    name: pipeline.name || "Funil",
    isDefault: Boolean(pipeline.isDefault),
    isArchived: Boolean(pipeline.isArchived),
    position: Number(pipeline.position || 0),
    cardCount: Number(pipeline.cardCount || 0),
    createdAt: pipeline.createdAt || "",
    updatedAt: pipeline.updatedAt || "",
    stages: Array.isArray(pipeline.stages) ? pipeline.stages.map(normalizeKanbanStage) : [],
  };
}

export async function fetchKanbanPipelines(signal?: AbortSignal): Promise<KanbanPipeline[]> {
  const pipelines = await requestApi<Partial<KanbanPipeline>[]>("/api/kanban/pipelines", { signal });
  return pipelines.map(normalizeKanbanPipeline);
}

export async function fetchKanbanBoard(
  pipelineId: string,
  filters: KanbanBoardFilters = {},
  limitPerStage = 50,
  signal?: AbortSignal,
): Promise<KanbanBoardData> {
  const query = buildKanbanQueryString(filters, { pipelineId, limitPerStage });
  const board = await requestApi<Partial<KanbanBoardData>>(`/api/kanban/board?${query}`, { timeoutMs: 60000, signal });
  const pipeline = normalizeKanbanPipeline(board.pipeline || {});
  return {
    pipeline,
    stages: Array.isArray(board.stages)
      ? board.stages.map((stage) => ({
          ...normalizeKanbanStage(stage),
          filteredCardCount: Number(stage.filteredCardCount ?? stage.cardCount ?? 0),
          cards: Array.isArray(stage.cards) ? stage.cards.map(normalizeLeadFromApi) : [],
          hasMore: Boolean(stage.hasMore),
        }))
      : [],
    filtersTotal: Number(board.filtersTotal || 0),
    limitPerStage: Number(board.limitPerStage || limitPerStage),
  };
}

export async function fetchMoreKanbanStageCards(
  stageId: string,
  offset: number,
  filters: KanbanBoardFilters = {},
  limit = 50,
): Promise<{ cards: Lead[]; total: number; hasMore: boolean }> {
  const query = buildKanbanQueryString(filters, { offset, limit });
  const response = await requestApi<{ cards?: Partial<Lead>[]; total?: number; hasMore?: boolean }>(
    `/api/kanban/stages/${encodeURIComponent(stageId)}/cards?${query}`,
    { timeoutMs: 60000 },
  );
  const cards = Array.isArray(response.cards) ? response.cards.map(normalizeLeadFromApi) : [];
  return { cards, total: Number(response.total || 0), hasMore: Boolean(response.hasMore) };
}

export async function createKanbanPipeline(payload: { name: string; sourcePipelineId?: string }): Promise<KanbanPipeline> {
  const pipeline = await requestApi<Partial<KanbanPipeline>>("/api/kanban/pipelines", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return normalizeKanbanPipeline(pipeline);
}

export async function updateKanbanPipeline(
  pipelineId: string,
  payload: { name?: string; isDefault?: boolean },
): Promise<KanbanPipeline> {
  const pipeline = await requestApi<Partial<KanbanPipeline>>(`/api/kanban/pipelines/${encodeURIComponent(pipelineId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return normalizeKanbanPipeline(pipeline);
}

export async function archiveKanbanPipeline(pipelineId: string): Promise<void> {
  await requestApi<{ ok: boolean }>(`/api/kanban/pipelines/${encodeURIComponent(pipelineId)}`, { method: "DELETE" });
}

export async function createKanbanStage(
  pipelineId: string,
  payload: { name: string; color?: string; stageType?: KanbanStage["stageType"]; statusKey?: string; wipLimit?: number },
): Promise<KanbanStage> {
  const stage = await requestApi<Partial<KanbanStage>>(`/api/kanban/pipelines/${encodeURIComponent(pipelineId)}/stages`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return normalizeKanbanStage(stage);
}

export async function updateKanbanStage(
  stageId: string,
  payload: Partial<Pick<KanbanStage, "name" | "color" | "stageType" | "statusKey" | "wipLimit">>,
): Promise<KanbanStage> {
  const stage = await requestApi<Partial<KanbanStage>>(`/api/kanban/stages/${encodeURIComponent(stageId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return normalizeKanbanStage(stage);
}

export async function reorderKanbanStages(pipelineId: string, stageIds: string[]): Promise<void> {
  await requestApi<{ ok: boolean }>(`/api/kanban/pipelines/${encodeURIComponent(pipelineId)}/stages/reorder`, {
    method: "PUT",
    body: JSON.stringify({ stageIds }),
  });
}

export async function deleteKanbanStage(stageId: string, targetStageId?: string): Promise<void> {
  await requestApi<{ ok: boolean }>(`/api/kanban/stages/${encodeURIComponent(stageId)}`, {
    method: "DELETE",
    body: JSON.stringify({ targetStageId }),
  });
}

export async function moveKanbanCard(payload: {
  leadId: string;
  pipelineId: string;
  stageId: string;
  beforeLeadId?: string;
  afterLeadId?: string;
}): Promise<Lead> {
  const lead = await requestApi<Partial<Lead>>("/api/kanban/cards/move", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return normalizeLeadFromApi(lead);
}

export async function searchLeadsForKanban(
  pipelineId: string,
  search: string,
  limit = 40,
): Promise<KanbanLeadSearchResult[]> {
  const query = new URLSearchParams({ pipelineId, search, limit: String(limit) });
  const leads = await requestApi<Array<Partial<KanbanLeadSearchResult>>>(`/api/kanban/leads/search?${query.toString()}`);
  return leads.map((lead) => ({
    ...normalizeLeadFromApi(lead),
    pipelineName: lead.pipelineName || "Sem funil",
    stageName: lead.stageName || "Sem etapa",
  }));
}

export async function bulkAssignKanbanCards(payload: { leadIds: string[]; pipelineId: string; stageId: string }): Promise<Lead[]> {
  const leads = await requestApi<Partial<Lead>[]>("/api/kanban/cards/bulk-assign", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return leads.map(normalizeLeadFromApi);
}

export async function fetchLeadsFromServer(): Promise<Lead[]> {
  const result = await fetchLeadPageFromServer({ limit: DEFAULT_LEAD_PAGE_SIZE, offset: 0 });
  return result.leads;
}

export async function createLeadOnServer(lead: Lead): Promise<Lead> {
  const savedLead = await requestApi<Partial<Lead>>("/api/leads", {
    method: "POST",
    body: JSON.stringify({ lead }),
  });

  return normalizeLeadFromApi(savedLead);
}

export async function updateLeadOnServer(lead: Lead): Promise<Lead> {
  const savedLead = await requestApi<Partial<Lead>>(`/api/leads/${encodeURIComponent(lead.id)}`, {
    method: "PUT",
    body: JSON.stringify({ lead }),
  });

  return normalizeLeadFromApi(savedLead);
}

export async function deleteLeadFromServer(leadId: string): Promise<void> {
  await requestApi<{ ok: boolean }>(`/api/leads/${encodeURIComponent(leadId)}`, {
    method: "DELETE",
  });
}

export async function importLeadBatchToServer(leads: Lead[]): Promise<ImportLeadsBatchResult> {
  const completed = await enqueueAndWaitForJob("/api/leads/import", { leads }, LONG_API_TIMEOUT_MS);
  const rawReport = (completed.result?.report || {}) as Partial<ServerImportReport>;
  return {
    leads: [],
    report: {
      received: Number(rawReport.received ?? leads.length),
      created: Number(rawReport.created ?? 0),
      merged: Number(rawReport.merged ?? 0),
      ignoredInsideFile: Number(rawReport.ignoredInsideFile ?? 0),
    },
  };
}

export async function importLeadsToServer(leads: Lead[]): Promise<Lead[]> {
  const result = await importLeadBatchToServer(leads);
  return result.leads;
}

export async function fetchDeletedLeadsFromServer(): Promise<Lead[]> {
  const leads = await requestApi<Partial<Lead>[]>("/api/leads/deleted");
  return leads.map(normalizeLeadFromApi);
}

export async function restoreLeadOnServer(leadId: string): Promise<Lead> {
  const lead = await requestApi<Partial<Lead>>(`/api/leads/${encodeURIComponent(leadId)}/restore`, {
    method: "POST",
  });
  return normalizeLeadFromApi(lead);
}

export async function permanentlyDeleteLeadFromServer(leadId: string): Promise<void> {
  await requestApi<{ ok: boolean }>(`/api/leads/${encodeURIComponent(leadId)}/permanent`, {
    method: "DELETE",
  });
}

export async function mergeLeadsOnServer(primaryLeadId: string, duplicateLeadIds: string[]): Promise<Lead> {
  const lead = await requestApi<Partial<Lead>>("/api/leads/merge", {
    method: "POST",
    body: JSON.stringify({ primaryLeadId, duplicateLeadIds }),
  });
  return normalizeLeadFromApi(lead);
}

export async function fetchLeadExternalOriginsFromServer(leadId: string): Promise<ExternalLeadOrigin[]> {
  return requestApi<ExternalLeadOrigin[]>(`/api/leads/${encodeURIComponent(leadId)}/external-origins`);
}

export async function fetchLeadNotesFromServer(leadId: string): Promise<LeadNote[]> {
  return requestApi<LeadNote[]>(`/api/leads/${encodeURIComponent(leadId)}/notes`);
}

export async function addLeadNoteOnServer(leadId: string, body: string): Promise<LeadNote> {
  return requestApi<LeadNote>(`/api/leads/${encodeURIComponent(leadId)}/notes`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export type CreateTaskPayload = {
  type?: TaskType;
  title: string;
  description?: string;
  responsibleUserId?: string;
  leadId?: string;
  dueAt: string;
  priority?: TaskPriority;
  recurrence?: string;
};

export type LeadHandoffPayload = {
  requestId: string;
  consultantUserId: string;
  pipelineId: string;
  stageId: string;
  task: CreateTaskPayload;
};

export type LeadHandoffResult = {
  lead: Lead;
  task: CRMTask;
  idempotentReplay?: boolean;
};

export async function handoffLeadToConsultant(leadId: string, payload: LeadHandoffPayload): Promise<LeadHandoffResult> {
  const response = await requestApi<{ lead: Partial<Lead>; task: CRMTask; idempotentReplay?: boolean }>(`/api/leads/${encodeURIComponent(leadId)}/handoff`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return { lead: normalizeLeadFromApi(response.lead), task: response.task, idempotentReplay: response.idempotentReplay };
}

export async function fetchTodayDashboardFromServer(): Promise<TodayDashboard> {
  return requestApi<TodayDashboard>("/api/today");
}

export async function fetchTasksFromServer(params: { bucket?: "overdue" | "today" | "upcoming" | "completed" | "all"; leadId?: string; limit?: number } = {}): Promise<CRMTask[]> {
  const search = new URLSearchParams();
  if (params.bucket) search.set("bucket", params.bucket);
  if (params.leadId) search.set("leadId", params.leadId);
  if (params.limit) search.set("limit", String(params.limit));
  return requestApi<CRMTask[]>(`/api/tasks?${search.toString()}`);
}

export async function createTaskOnServer(payload: CreateTaskPayload): Promise<CRMTask> {
  return requestApi<CRMTask>("/api/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateTaskOnServer(taskId: string, payload: Partial<CreateTaskPayload>): Promise<CRMTask> {
  return requestApi<CRMTask>(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function completeTaskOnServer(taskId: string, payload: { result?: string; nextTask?: CreateTaskPayload | null } = {}): Promise<{ task: CRMTask; nextTask: CRMTask | null }> {
  return requestApi<{ task: CRMTask; nextTask: CRMTask | null }>(`/api/tasks/${encodeURIComponent(taskId)}/complete`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function cancelTaskOnServer(taskId: string): Promise<void> {
  await requestApi<{ ok: boolean }>(`/api/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
}

export async function fetchLeadAuditFromServer(leadId: string): Promise<AuditEntry[]> {
  return requestApi<AuditEntry[]>(`/api/leads/${encodeURIComponent(leadId)}/audit`);
}

export async function fetchRecentAuditFromServer(): Promise<AuditEntry[]> {
  return requestApi<AuditEntry[]>("/api/audit");
}

export async function fetchTeamsFromServer(): Promise<CRMTeam[]> {
  return requestApi<CRMTeam[]>("/api/teams");
}

export async function createTeamOnServer(payload: { name: string; managerUserId?: string }): Promise<CRMTeam> {
  return requestApi<CRMTeam>("/api/teams", { method: "POST", body: JSON.stringify(payload) });
}

export async function updateTeamOnServer(teamId: string, payload: Partial<CRMTeam>): Promise<CRMTeam> {
  return requestApi<CRMTeam>(`/api/teams/${encodeURIComponent(teamId)}`, { method: "PUT", body: JSON.stringify(payload) });
}

export async function fetchUsersFromServer(): Promise<CRMUser[]> {
  return requestApi<CRMUser[]>("/api/users");
}

export async function fetchAssignableUsersFromServer(): Promise<CRMUser[]> {
  return requestApi<CRMUser[]>("/api/users/assignable");
}

export async function createUserOnServer(payload: {
  name: string;
  email: string;
  password: string;
  role: CRMUser["role"];
  teamId?: string;
  leadAccessScope?: LeadAccessScope;
}): Promise<CRMUser> {
  return requestApi<CRMUser>("/api/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateUserOnServer(userId: string, payload: Partial<CRMUser> & { password?: string }): Promise<CRMUser> {
  return requestApi<CRMUser>(`/api/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deactivateUserOnServer(userId: string): Promise<void> {
  await requestApi<{ ok: boolean }>(`/api/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

export async function fetchBackupsFromServer(): Promise<BackupEntry[]> {
  return requestApi<BackupEntry[]>("/api/backups");
}

export async function createBackupOnServer(): Promise<BackupEntry> {
  const completed = await enqueueAndWaitForJob("/api/backups", {}, 30 * 60 * 1000);
  const backup = completed.result?.backup as BackupEntry | undefined;
  if (!backup?.id) throw new Error("O backup foi concluído, mas o servidor não retornou os metadados do arquivo.");
  return backup;
}

export async function downloadBackupById(backupId: string): Promise<void> {
  await downloadFile(`/api/backups/${encodeURIComponent(backupId)}/download`, `crm-casa-do-ads-backup-${new Date().toISOString().slice(0, 10)}.cadbkp`);
}

async function createAndDownloadLeadExport(format: "csv" | "xlsx"): Promise<void> {
  const completed = await enqueueAndWaitForJob("/api/exports/leads", { format }, 30 * 60 * 1000);
  await downloadFile(
    `/api/jobs/${encodeURIComponent(completed.id)}/download`,
    `crm-casa-do-ads-leads-${new Date().toISOString().slice(0, 10)}.${format}`,
  );
}

export async function downloadLeadsCsvExport(): Promise<void> {
  await createAndDownloadLeadExport("csv");
}

export async function downloadLeadsXlsxExport(): Promise<void> {
  await createAndDownloadLeadExport("xlsx");
}

export async function downloadDatabaseBackup(): Promise<BackupEntry> {
  const backup = await createBackupOnServer();
  await downloadBackupById(backup.id);
  return backup;
}
