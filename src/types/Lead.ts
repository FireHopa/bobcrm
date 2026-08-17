export type LeadSource =
  | ""
  | "Instagram"
  | "Google"
  | "Indicação"
  | "WhatsApp"
  | "Evento"
  | "Landing Page"
  | "Tráfego Pago"
  | "Outro";

export type LeadStatus =
  | "Novo lead"
  | "Contato feito"
  | "Sem resposta"
  | "Reunião marcada"
  | "Diagnóstico realizado"
  | "Proposta enviada"
  | "Em negociação"
  | "Fechado"
  | "Perdido";

export type LeadTemperature = "" | "Frio" | "Morno" | "Quente";

export type LostReason =
  | ""
  | "Preço"
  | "Sem resposta"
  | "Sem orçamento"
  | "Fechou com concorrente"
  | "Não era o momento"
  | "Não viu valor"
  | "Fora do perfil"
  | "Lead curioso"
  | "Outro";

export type ServiceInterest =
  | "Criação de Website"
  | "Mentorias em Google Ads"
  | "Mentorias em Meta Ads"
  | "Mentorias em LinkedIn Ads"
  | "Mentorias em Canva"
  | "Mentorias em CapCut"
  | "Mentorias AEO"
  | "Gerenciamento Google"
  | "Gerenciamento Meta"
  | "Gerenciamento LinkedIn Ads"
  | "Social Media"
  | "Projeto Copy - LinkedIn, Perfil de Empresa e Blog no site";

export type ServiceProviderStatus = "Casa do Ads" | "Outra agência" | "Não é feito" | "Não sabemos";

export type ServiceStatusMap = Partial<Record<ServiceInterest, ServiceProviderStatus>>;

export type LeadCustomFieldKey =
  | "Datas Imersão"
  | "Possui website?"
  | "Indicado por";

export type LeadCustomFields = Partial<Record<LeadCustomFieldKey, string>>;

export type Lead = {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  website: string;
  instagram?: string;
  advertisesOnMeta: boolean;
  advertisesOnGoogle: boolean;
  doesNotAdvertiseOnMeta?: boolean;
  doesNotAdvertiseOnGoogle?: boolean;
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
  serviceInterests: ServiceInterest[];
  serviceStatusMap: ServiceStatusMap;
  customFields: LeadCustomFields;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string;
  deletedBy?: string;
  restoredAt?: string;
  restoredBy?: string;
  pipelineId?: string;
  pipelineStageId?: string;
  kanbanPosition?: number;
  pipelineEnteredAt?: string;
};

export type UserRole = "admin" | "pre_venda" | "consultor_vendas";
export type LeadAccessScope = "all" | "team" | "own" | "none";

export type CRMTeam = {
  id: string;
  name: string;
  managerUserId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CRMUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  roleLabel: string;
  teamId: string;
  teamName: string;
  leadAccessScope: LeadAccessScope;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
  permissions: string[];
};

export type ExternalLeadOrigin = {
  id: string;
  leadId: string;
  provider: string;
  tenantId: string;
  webhookId: string;
  webhookName: string;
  source: string;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
  metadata: Record<string, unknown>;
};

export type AuditEntry = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actorId: string;
  actorName: string;
  changes: Record<string, { from?: unknown; to?: unknown } | unknown>;
  summary: string;
  createdAt: string;
};

export type LeadNote = {
  id: string;
  leadId: string;
  body: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
};

export type TaskType = "ligacao" | "whatsapp" | "email" | "reuniao" | "follow_up" | "outro";
export type TaskPriority = "baixa" | "normal" | "alta" | "urgente";
export type TaskStatus = "pending" | "completed" | "canceled";

export type CRMTask = {
  id: string;
  type: TaskType;
  title: string;
  description: string;
  responsibleUserId: string;
  responsibleName: string;
  createdBy: string;
  createdByName: string;
  leadId: string;
  leadName: string;
  leadCompany: string;
  leadPhone: string;
  dueAt: string;
  priority: TaskPriority;
  status: TaskStatus;
  result: string;
  completedAt: string;
  completedBy: string;
  nextTaskId: string;
  recurrence: string;
  source: string;
  createdAt: string;
  updatedAt: string;
};

export type TodayDashboard = {
  role: UserRole;
  roleLabel: string;
  scope: { kind: string; label: string; scope: LeadAccessScope; memberCount?: number };
  generatedAt: string;
  taskSummary: {
    overdue: number;
    today: number;
    upcoming: number;
    meetingsToday: number;
    completedToday: number;
  };
  tasks: {
    overdue: CRMTask[];
    today: CRMTask[];
    upcoming: CRMTask[];
  };
  roleMetrics: {
    awaitingFirstContact: number;
    withoutOwner: number;
    withoutNextStep: number;
    stalled: number;
  };
  teamOverdue: { responsibleName: string; total: number }[];
  systemHealth: null | {
    activeUsers: number;
    failedIntegrations: number;
    latestBackupAt: string;
  };
};

export type BackupEntry = {
  id: string;
  fileName: string;
  type: "manual" | "auto" | "startup" | string;
  status: "verified" | "expired" | "legacy_unverified" | string;
  sizeBytes: number;
  sha256: string;
  encryption: string;
  compression: string;
  storageProvider: string;
  createdAt: string;
  verifiedAt: string;
  verificationStatus: string;
  retentionExpiresAt: string;
  expiredAt: string;
};
