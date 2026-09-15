import { createEmptyCustomFields } from "../../constants/customFields";
import { getServiceInterestsFromStatusMap, parseServiceStatusMap } from "../../constants/services";
import type { Lead, LeadSource, LeadStatus, LeadTemperature, LostReason } from "../../types/Lead";
import type { ImportDeduplicationReport } from "../../utils/commercial";
import { normalizeWebsite } from "../../utils/formatters";

export type RawRow = string[];

export type ImportFieldKey =
  | "name"
  | "email"
  | "phone"
  | "company"
  | "website"
  | "instagram"
  | "advertisesOnMeta"
  | "advertisesOnGoogle"
  | "doesNotAdvertiseOnMeta"
  | "doesNotAdvertiseOnGoogle"
  | "doesNotAdvertise"
  | "status"
  | "responsible"
  | "temperature"
  | "pain"
  | "lostReason"
  | "commercialNotes"
  | "source"
  | "serviceInterests"
  | "advertisesOnGoogle2"
  | "siteInput";

export type ImportMapping = Record<ImportFieldKey, string>;

export type ImportField = {
  key: ImportFieldKey;
  label: string;
  required?: boolean;
  group: "Dados básicos" | "Comercial" | "Mídia e origem" | "Perda e observação";
};

export const importFields: ImportField[] = [
  { key: "name", label: "Nome", required: true, group: "Dados básicos" },
  { key: "email", label: "E-mail", group: "Dados básicos" },
  { key: "phone", label: "Número de telefone", group: "Dados básicos" },
  { key: "company", label: "Empresa", group: "Dados básicos" },
  { key: "website", label: "Website", group: "Dados básicos" },
  { key: "instagram", label: "Instagram", group: "Dados básicos" },
  { key: "siteInput", label: "Coloque seu site → Website", group: "Dados básicos" },
  { key: "commercialNotes", label: "Observação comercial", group: "Dados básicos" },

  { key: "status", label: "Status do lead", group: "Comercial" },
  { key: "responsible", label: "Responsável legado (não atribui consultor)", group: "Comercial" },
  { key: "temperature", label: "Temperatura do lead", group: "Comercial" },
  { key: "pain", label: "Dor do lead", group: "Comercial" },
  { key: "serviceInterests", label: "Mapeamento dos serviços", group: "Comercial" },

  { key: "advertisesOnMeta", label: "Anuncia na Meta?", group: "Mídia e origem" },
  { key: "advertisesOnGoogle", label: "Anuncia no Google?", group: "Mídia e origem" },
  { key: "doesNotAdvertiseOnMeta", label: "Não anuncia na Meta?", group: "Mídia e origem" },
  { key: "doesNotAdvertiseOnGoogle", label: "Não anuncia no Google?", group: "Mídia e origem" },
  { key: "advertisesOnGoogle2", label: "Já anuncia no Google ADS? - 2 → Anuncia no Google?", group: "Mídia e origem" },
  { key: "doesNotAdvertise", label: "Não anuncia?", group: "Mídia e origem" },
  { key: "source", label: "Origem", group: "Mídia e origem" },

  { key: "lostReason", label: "Motivo da perda", group: "Perda e observação" },
];

export const emptyMapping: ImportMapping = {
  name: "",
  email: "",
  phone: "",
  company: "",
  website: "",
  instagram: "",
  advertisesOnMeta: "",
  advertisesOnGoogle: "",
  doesNotAdvertiseOnMeta: "",
  doesNotAdvertiseOnGoogle: "",
  doesNotAdvertise: "",
  status: "",
  responsible: "",
  temperature: "",
  pain: "",
  lostReason: "",
  commercialNotes: "",
  source: "",
  serviceInterests: "",
  advertisesOnGoogle2: "",
  siteInput: "",
};

export const statusOptions: LeadStatus[] = [
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

export const temperatureOptions: LeadTemperature[] = ["", "Frio", "Morno", "Quente"];

export const lostReasonOptions: LostReason[] = [
  "",
  "Sem interesse",
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

export const sourceOptions: LeadSource[] = [
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


export type ImportLeadsOptions = {
  chunked?: boolean;
  pipelineId?: string;
  stageId?: string;
};

export type ImportLeadsProps = {
  onImportLeads: (leads: Lead[], options?: ImportLeadsOptions) => Promise<ImportDeduplicationReport | void>;
  onImportFinished?: (report: ImportDeduplicationReport) => void;
};

export type BulkDefaults = {
  source: LeadSource;
  temperature: LeadTemperature;
  status: LeadStatus;
};

export const emptyBulkDefaults: BulkDefaults = {
  source: "",
  temperature: "",
  status: "Novo lead",
};

export function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/^\uFEFF/, "").trim();
}

function normalizeSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function getCell(row: RawRow, mappedIndex: string): string {
  if (mappedIndex === "") return "";
  const index = Number(mappedIndex);
  if (Number.isNaN(index)) return "";

  return normalizeText(row[index]);
}

function normalizeBoolean(value: string): boolean {
  const normalized = normalizeSearch(value);

  return ["sim", "s", "yes", "y", "true", "1", "ok", "ativo", "anuncia", "x"].includes(normalized);
}

function normalizeStatus(value: string, isLost: boolean): LeadStatus {
  const normalized = normalizeSearch(value);

  if (isLost || normalized.includes("perdido")) return "Perdido";
  if (normalized.includes("fechado") || normalized.includes("ganho")) return "Fechado";
  if (normalized.includes("negoci")) return "Em negociação";
  if (normalized.includes("proposta")) return "Proposta enviada";
  if (normalized.includes("diagnostico")) return "Diagnóstico realizado";
  if (normalized.includes("reuniao") || normalized.includes("reuniao marcada")) return "Reunião marcada";
  if (normalized.includes("sem resposta")) return "Sem resposta";
  if (normalized.includes("contato")) return "Contato feito";

  return "Novo lead";
}

function normalizeTemperature(value: string): LeadTemperature {
  const normalized = normalizeSearch(value);

  if (normalized.includes("quente")) return "Quente";
  if (normalized.includes("morno")) return "Morno";
  if (normalized.includes("frio")) return "Frio";

  return "";
}

function normalizeLostReason(value: string): LostReason {
  const normalized = normalizeSearch(value);

  const foundReason = lostReasonOptions.find((reason) => reason && normalizeSearch(reason) === normalized);

  if (foundReason) return foundReason;

  if (normalized.includes("preco") || normalized.includes("caro")) return "Preço";
  if (normalized.includes("sem resposta")) return "Sem resposta";
  if (normalized.includes("orcamento") || normalized.includes("verba")) return "Sem orçamento";
  if (normalized.includes("concorrente")) return "Fechou com concorrente";
  if (normalized.includes("momento")) return "Não era o momento";
  if (normalized.includes("valor")) return "Não viu valor";
  if (normalized.includes("perfil")) return "Fora do perfil";
  if (normalized.includes("curioso")) return "Lead curioso";

  return value.trim() ? "Outro" : "";
}

function normalizeSource(value: string): LeadSource {
  const normalized = normalizeSearch(value);

  const foundSource = sourceOptions.find((source) => source && normalizeSearch(source) === normalized);

  if (foundSource) return foundSource;

  if (normalized.includes("insta") || normalized.includes("reels") || normalized.includes("story")) return "Instagram";
  if (normalized.includes("google") || normalized.includes("maps")) return "Google";
  if (normalized.includes("indic")) return "Indicação";
  if (normalized.includes("whats")) return "WhatsApp";
  if (normalized.includes("evento") || normalized.includes("imersao")) return "Evento";
  if (normalized.includes("landing") || normalized.includes("lp")) return "Landing Page";
  if (normalized.includes("trafego") || normalized.includes("ads") || normalized.includes("meta")) return "Tráfego Pago";

  return value.trim() ? "Outro" : "";
}

function normalizeImportedPhone(value: string): string {
  const cleanValue = value.trim();
  const digits = cleanValue.replace(/\D/g, "");

  if (!digits) return "";
  if (digits.length === 13 && digits.startsWith("55")) return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  if (digits.length === 12 && digits.startsWith("55")) return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (digits.startsWith("351") && digits.length >= 12) return `+${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`;

  return cleanValue;
}

export function suggestMapping(headers: string[]): ImportMapping {
  const mapping = { ...emptyMapping };
  const normalizedHeaders = headers.map((header) => normalizeSearch(header));

  // Alguns exports de CRM trazem colunas de dono/proprietário antes dos dados
  // do contato. Sem prioridade explícita, o matching genérico de "nome" e
  // "email" pode confundir Nome/Email do dono com Nome/Email do lead.
  const preferredExactHeaders: Partial<Record<ImportFieldKey, string[]>> = {
    name: [
      "nome do contato principal",
      "nome completo do contato principal",
      "nome do contato",
      "nome completo do contato",
      "nome completo",
    ],
    email: [
      "email de contato principal",
      "email do contato principal",
      "e mail de contato principal",
      "e mail do contato principal",
      "email do contato",
      "e mail do contato",
    ],
    phone: ["telefone", "telefone do contato", "celular", "whatsapp", "phone"],
    company: ["conta", "empresa", "company", "nome da empresa"],
    website: ["website", "site", "url", "dominio", "domínio"],
  };

  Object.entries(preferredExactHeaders).forEach(([fieldKey, candidates]) => {
    const field = fieldKey as ImportFieldKey;
    if (mapping[field]) return;

    const normalizedCandidates = (candidates || []).map((candidate) => normalizeSearch(candidate));
    const preferredIndex = normalizedHeaders.findIndex((header) => normalizedCandidates.includes(header));

    if (preferredIndex >= 0) {
      mapping[field] = String(preferredIndex);
    }
  });

  const rules: Record<ImportFieldKey, string[]> = {
    name: ["nome", "name", "cliente", "lead", "contato"],
    email: ["email", "e mail", "mail"],
    phone: ["telefone", "celular", "whatsapp", "phone", "numero", "número"],
    company: ["empresa", "company", "negocio", "negócio"],
    website: ["website", "site", "url", "dominio", "domínio"],
    instagram: ["instagram", "perfil do instagram", "usuario instagram", "usuário instagram", "arroba"],
    advertisesOnMeta: ["meta", "facebook", "instagram ads", "anuncia na meta"],
    advertisesOnGoogle: ["ja anuncia no google", "já anuncia no google", "anuncia no google", "google ads"],
    doesNotAdvertiseOnMeta: ["nao anuncia na meta", "não anuncia na meta", "sem meta ads", "nao faz meta ads", "não faz meta ads"],
    doesNotAdvertiseOnGoogle: ["nao anuncia no google", "não anuncia no google", "sem google ads", "nao faz google ads", "não faz google ads"],
    doesNotAdvertise: ["nao anuncia", "não anuncia", "sem anuncio", "sem anúncio", "nao faz trafego", "não faz tráfego"],
    status: ["status", "etapa", "fase", "pipeline"],
    responsible: ["responsavel", "responsável", "vendedor", "sdr", "closer", "owner"],
    temperature: ["temperatura", "prioridade"],
    pain: ["dor", "problema", "necessidade", "desafio"],
    lostReason: ["motivo da perda", "motivo perda", "perda"],
    commercialNotes: ["observacao", "observação", "observacoes", "notas", "comentario", "comentário"],
    source: ["origem", "source", "canal"],
    serviceInterests: ["servico", "serviço", "produto", "interesse", "oferta", "solucao", "solução", "quem faz", "responsavel servico"],
    advertisesOnGoogle2: ["ja anuncia no google ads 2", "já anuncia no google ads 2", "anuncia no google ads 2", "google ads 2"],
    siteInput: ["coloque seu site", "informe seu site", "digite seu site"],
  };

  function canMatchField(field: ImportFieldKey, normalizedHeader: string): boolean {
    const isOwnerField = normalizedHeader.includes("dono")
      || normalizedHeader.includes("proprietario")
      || normalizedHeader.includes("owner");
    const isIdField = normalizedHeader === "id" || normalizedHeader.startsWith("id ");

    // Nunca usar dados do dono/proprietário como identidade do lead.
    if ((field === "name" || field === "email") && isOwnerField) return false;
    // Evita mapear "ID do Negócio" como Empresa.
    if (field === "company" && isIdField) return false;

    const mentionsGoogle = normalizedHeader.includes("google");
    const mentionsMeta = normalizedHeader.includes("meta") || normalizedHeader.includes("facebook") || normalizedHeader.includes("instagram ads");
    const isNegative = normalizedHeader.includes("nao anuncia")
      || normalizedHeader.includes("sem anuncio")
      || normalizedHeader.includes("nao faz")
      || (mentionsGoogle && normalizedHeader.includes("sem google"))
      || (mentionsMeta && (normalizedHeader.includes("sem meta") || normalizedHeader.includes("sem facebook") || normalizedHeader.includes("sem instagram ads")));

    if ((field === "advertisesOnGoogle" || field === "advertisesOnGoogle2") && isNegative) return false;
    if (field === "advertisesOnMeta" && isNegative) return false;
    if (field === "doesNotAdvertise" && (mentionsGoogle || mentionsMeta)) return false;
    if (field === "instagram" && (normalizedHeader.includes(" ads") || normalizedHeader.includes("anuncia"))) return false;
    return true;
  }

  headers.forEach((header, index) => {
    const normalizedHeader = normalizeSearch(header);

    importFields.forEach((field) => {
      if (!canMatchField(field.key, normalizedHeader)) return;
      if (mapping[field.key]) return;

      const matched = rules[field.key].some((rule) => normalizedHeader === normalizeSearch(rule));

      if (matched) {
        mapping[field.key] = String(index);
      }
    });
  });

  headers.forEach((header, index) => {
    const normalizedHeader = normalizeSearch(header);

    importFields.forEach((field) => {
      if (!canMatchField(field.key, normalizedHeader)) return;
      if (mapping[field.key]) return;

      const matched = rules[field.key].some((rule) => normalizedHeader.includes(normalizeSearch(rule)));

      if (matched) {
        mapping[field.key] = String(index);
      }
    });
  });

  return mapping;
}

export function buildLeadFromRow(row: RawRow, mapping: ImportMapping, bulkDefaults: BulkDefaults): Lead {
  const lostReason = normalizeLostReason(getCell(row, mapping.lostReason));
  const generalDoesNotAdvertise = normalizeBoolean(getCell(row, mapping.doesNotAdvertise));
  let advertisesOnMeta = normalizeBoolean(getCell(row, mapping.advertisesOnMeta));
  const advertisesOnGoogleValue = getCell(row, mapping.advertisesOnGoogle) || getCell(row, mapping.advertisesOnGoogle2) || "";
  let advertisesOnGoogle = normalizeBoolean(advertisesOnGoogleValue);
  let doesNotAdvertiseOnMeta = normalizeBoolean(getCell(row, mapping.doesNotAdvertiseOnMeta));
  let doesNotAdvertiseOnGoogle = normalizeBoolean(getCell(row, mapping.doesNotAdvertiseOnGoogle));

  if (generalDoesNotAdvertise) {
    advertisesOnMeta = false;
    advertisesOnGoogle = false;
    doesNotAdvertiseOnMeta = true;
    doesNotAdvertiseOnGoogle = true;
  }
  if (advertisesOnMeta) doesNotAdvertiseOnMeta = false;
  if (advertisesOnGoogle) doesNotAdvertiseOnGoogle = false;

  const doesNotAdvertise = !advertisesOnMeta
    && !advertisesOnGoogle
    && (generalDoesNotAdvertise || (doesNotAdvertiseOnMeta && doesNotAdvertiseOnGoogle));
  const isLostFromReason = Boolean(lostReason);
  const statusFromRow = normalizeStatus(getCell(row, mapping.status), isLostFromReason);
  const status = getCell(row, mapping.status) ? statusFromRow : bulkDefaults.status;
  const isLost = status === "Perdido";
  const serviceStatusMap = parseServiceStatusMap(getCell(row, mapping.serviceInterests));
  const serviceInterests = getServiceInterestsFromStatusMap(serviceStatusMap);

  return {
    id: crypto.randomUUID(),
    name: getCell(row, mapping.name),
    email: getCell(row, mapping.email),
    phone: normalizeImportedPhone(getCell(row, mapping.phone)),
    company: getCell(row, mapping.company),
    website: normalizeWebsite(getCell(row, mapping.website) || getCell(row, mapping.siteInput) || ""),
    instagram: getCell(row, mapping.instagram),
    advertisesOnMeta,
    advertisesOnGoogle,
    doesNotAdvertiseOnMeta,
    doesNotAdvertiseOnGoogle,
    doesNotAdvertise,
    lastContactAt: "",
    contactMadeAt: "",
    nextContactAt: "",
    expectedCloseAt: "",
    estimatedBudget: "",
    isLost,
    lostReason,
    commercialNotes: getCell(row, mapping.commercialNotes),
    status,
    responsible: "",
    responsibleUserId: "",
    sdrResponsible: "",
    sdrResponsibleUserId: "",
    temperature: normalizeTemperature(getCell(row, mapping.temperature)) || bulkDefaults.temperature,
    pain: getCell(row, mapping.pain),
    source: normalizeSource(getCell(row, mapping.source)) || bulkDefaults.source,
    serviceInterests,
    serviceStatusMap,
    customFields: createEmptyCustomFields(),
    createdAt: new Date().toISOString(),
  };
}

export function isValidLead(lead: Lead): boolean {
  return Boolean(lead.name.trim());
}

export function getDuplicatedMappingLabels(mapping: ImportMapping) {
  const selected = Object.entries(mapping).filter(([, value]) => value !== "");
  const selectedIndexes = selected.map(([, value]) => value);

  return selected
    .filter(([, value], index) => selectedIndexes.indexOf(value) !== index)
    .map(([key]) => importFields.find((field) => field.key === key)?.label || key);
}


const MAX_CSV_FILE_BYTES = 200 * 1024 * 1024;
const MAX_SPREADSHEET_FILE_BYTES = 15 * 1024 * 1024;
const MAX_SPREADSHEET_ROWS = 50_000;
const MAX_SPREADSHEET_COLUMNS = 200;
const SPREADSHEET_PARSE_TIMEOUT_MS = 30_000;
export const IMPORT_BATCH_SIZE = 500;
export const CSV_PROFILE_SAMPLE_ROWS = 40;

export function validateImportFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";

  if (extension === "xls") {
    throw new Error("O formato XLS legado foi desativado por segurança. Salve o arquivo como XLSX ou CSV antes de importar.");
  }

  if (!["csv", "xlsx"].includes(extension)) {
    throw new Error("Formato não permitido. Envie um arquivo CSV ou XLSX.");
  }

  if (file.size <= 0) {
    throw new Error("O arquivo selecionado está vazio.");
  }

  const maxBytes = extension === "csv" ? MAX_CSV_FILE_BYTES : MAX_SPREADSHEET_FILE_BYTES;

  if (file.size > maxBytes) {
    const maxMegabytes = Math.floor(maxBytes / (1024 * 1024));
    const recommendation = extension === "csv"
      ? "Divida o arquivo em lotes menores."
      : "Converta a base para CSV ou divida a planilha em lotes menores.";

    throw new Error(`O arquivo excede o limite de ${maxMegabytes} MB. ${recommendation}`);
  }
}

export type LargeCsvMeta = {
  file: File;
  delimiter: string;
  totalRows: number;
  sampleRows: RawRow[];
};

type SpreadsheetWorkerResponse =
  | { ok: true; rows: RawRow[] }
  | { ok: false; message: string };

export async function parseSpreadsheetInWorker(file: File): Promise<RawRow[]> {
  const buffer = await file.arrayBuffer();
  const worker = new Worker(new URL("../../workers/spreadsheetParser.worker.ts", import.meta.url), { type: "module" });

  return new Promise<RawRow[]>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      worker.terminate();
      reject(new Error("A leitura da planilha excedeu 30 segundos. Converta o arquivo para CSV ou divida-o em partes menores."));
    }, SPREADSHEET_PARSE_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<SpreadsheetWorkerResponse>) => {
      window.clearTimeout(timeoutId);
      worker.terminate();
      if (event.data.ok) resolve(event.data.rows);
      else reject(new Error(event.data.message));
    };
    worker.onerror = () => {
      window.clearTimeout(timeoutId);
      worker.terminate();
      reject(new Error("O processamento isolado da planilha falhou. Converta o arquivo para CSV e tente novamente."));
    };

    worker.postMessage({
      buffer,
      maxRows: MAX_SPREADSHEET_ROWS,
      maxColumns: MAX_SPREADSHEET_COLUMNS,
    }, [buffer]);
  });
}

export type ImportProgress = {
  totalRows: number;
  processedRows: number;
  validRows: number;
  sentRows: number;
  batches: number;
  created: number;
  merged: number;
  ignoredInsideFile: number;
  status: "idle" | "reading" | "importing" | "done" | "error";
};

type CsvParserState = {
  delimiter: string;
  currentCell: string;
  currentRow: string[];
  inQuotes: boolean;
  pendingQuote: boolean;
  hasContent: boolean;
};

function createCsvParserState(delimiter: string): CsvParserState {
  return {
    delimiter,
    currentCell: "",
    currentRow: [],
    inQuotes: false,
    pendingQuote: false,
    hasContent: false,
  };
}

function completeCsvCell(state: CsvParserState) {
  state.currentRow.push(state.currentCell);
  state.currentCell = "";
}

function completeCsvRow(state: CsvParserState, completedRows: RawRow[]) {
  completeCsvCell(state);

  if (state.currentRow.some((cell) => String(cell || "").trim() !== "")) {
    completedRows.push(state.currentRow);
  }

  state.currentRow = [];
  state.hasContent = false;
}

function feedCsvParser(state: CsvParserState, text: string): RawRow[] {
  const completedRows: RawRow[] = [];
  let index = 0;

  while (index < text.length) {
    let char = text[index];

    if (state.pendingQuote) {
      if (char === '"') {
        state.currentCell += '"';
        state.pendingQuote = false;
        state.hasContent = true;
        index += 1;
        continue;
      }

      state.inQuotes = false;
      state.pendingQuote = false;
    }

    if (char === '"') {
      if (state.inQuotes) {
        state.pendingQuote = true;
      } else if (!state.currentCell) {
        state.inQuotes = true;
      } else {
        state.currentCell += char;
      }

      state.hasContent = true;
      index += 1;
      continue;
    }

    if (!state.inQuotes && char === state.delimiter) {
      completeCsvCell(state);
      index += 1;
      continue;
    }

    if (!state.inQuotes && char === "\n") {
      completeCsvRow(state, completedRows);
      index += 1;
      continue;
    }

    if (!state.inQuotes && char === "\r") {
      index += 1;
      continue;
    }

    state.currentCell += char;
    if (char.trim()) state.hasContent = true;
    index += 1;
  }

  return completedRows;
}

function finishCsvParser(state: CsvParserState): RawRow[] {
  const completedRows: RawRow[] = [];

  if (state.pendingQuote) {
    state.pendingQuote = false;
    state.inQuotes = false;
  }

  if (state.hasContent || state.currentCell || state.currentRow.length) {
    completeCsvRow(state, completedRows);
  }

  return completedRows;
}

function countDelimiterOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && char === delimiter) {
      count += 1;
    }
  }

  return count;
}

function detectCsvDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/)[0] || sample;
  const candidates = [",", ";", "\t"];
  const ranked = candidates
    .map((delimiter) => ({ delimiter, count: countDelimiterOutsideQuotes(firstLine, delimiter) }))
    .sort((a, b) => b.count - a.count);

  return ranked[0]?.count ? ranked[0].delimiter : ",";
}

export async function* iterateCsvRows(file: File, delimiter: string): AsyncGenerator<RawRow> {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8");
  const parser = createCsvParserState(delimiter);

  while (true) {
    const { value, done } = await reader.read();

    if (done) break;

    const text = decoder.decode(value, { stream: true });
    const rows = feedCsvParser(parser, text);

    for (const row of rows) {
      yield row.map((cell) => normalizeText(cell));
    }
  }

  const remainingText = decoder.decode();

  for (const row of feedCsvParser(parser, remainingText)) {
    yield row.map((cell) => normalizeText(cell));
  }

  for (const row of finishCsvParser(parser)) {
    yield row.map((cell) => normalizeText(cell));
  }
}

export async function profileCsvFile(file: File): Promise<{ headers: string[]; delimiter: string; totalRows: number; sampleRows: RawRow[] }> {
  const sample = await file.slice(0, 128 * 1024).text();
  const delimiter = detectCsvDelimiter(sample);
  const sampleRows: RawRow[] = [];
  let headers: string[] = [];
  let totalRows = 0;
  let rowIndex = 0;

  for await (const row of iterateCsvRows(file, delimiter)) {
    if (!row.some((cell) => cell.trim() !== "")) continue;

    if (rowIndex === 0) {
      headers = row.map((header, index) => header || `Coluna ${index + 1}`);
    } else {
      totalRows += 1;
      if (sampleRows.length < CSV_PROFILE_SAMPLE_ROWS) sampleRows.push(row);
    }

    rowIndex += 1;
  }

  if (!headers.length || totalRows < 1) {
    throw new Error("A planilha precisa ter uma linha de cabeçalho e pelo menos uma linha de lead.");
  }

  return { headers, delimiter, totalRows, sampleRows };
}

export function waitForBrowser() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

export function getImportDuplicateKey(lead: Lead): string {
  const emailKey = lead.email.trim().toLowerCase();
  if (emailKey) return `email:${emailKey}`;

  const phoneKey = lead.phone.replace(/\D/g, "");
  if (phoneKey.length >= 8) return `phone:${phoneKey}`;

  const nameCompanyKey = [normalizeSearch(lead.name), normalizeSearch(lead.company)].filter(Boolean).join("|");
  return nameCompanyKey.includes("|") ? `nameCompany:${nameCompanyKey}` : "";
}

export function createEmptyImportProgress(totalRows: number): ImportProgress {
  return {
    totalRows,
    processedRows: 0,
    validRows: 0,
    sentRows: 0,
    batches: 0,
    created: 0,
    merged: 0,
    ignoredInsideFile: 0,
    status: "idle",
  };
}

export function normalizeBatchReport(report: ImportDeduplicationReport | void, fallbackReceived: number): ImportDeduplicationReport {
  return {
    received: Number(report?.received ?? fallbackReceived),
    created: Number(report?.created ?? fallbackReceived),
    merged: Number(report?.merged ?? 0),
    ignoredInsideFile: Number(report?.ignoredInsideFile ?? 0),
  };
}

