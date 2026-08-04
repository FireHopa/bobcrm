import { createEmptyCustomFields, normalizeCustomFields } from "../../constants/customFields";
import { getServiceInterestsFromStatusMap, parseServiceStatusMap } from "../../constants/services";
import type { Lead, LeadCustomFieldKey, LeadCustomFields, LeadSource, LeadStatus, LeadTemperature, LostReason } from "../../types/Lead";
import type { ImportDeduplicationReport } from "../../utils/commercial";
import { formatDate, normalizeWebsite } from "../../utils/formatters";

export type RawRow = string[];

export type ImportFieldKey =
  | "name"
  | "email"
  | "phone"
  | "company"
  | "website"
  | "advertisesOnMeta"
  | "advertisesOnGoogle"
  | "doesNotAdvertise"
  | "status"
  | "responsible"
  | "temperature"
  | "pain"
  | "nextContactAt"
  | "lostReason"
  | "commercialNotes"
  | "lastContactAt"
  | "contactMadeAt"
  | "estimatedBudget"
  | "source"
  | "serviceInterests"
  | "immersionDates"
  | "hasWebsite"
  | "referredBy"
  | "advertisesOnGoogle2"
  | "alreadyHasWebsite"
  | "siteInput";

export type ImportMapping = Record<ImportFieldKey, string>;

export type ImportField = {
  key: ImportFieldKey;
  label: string;
  required?: boolean;
  group: "Dados básicos" | "Comercial" | "Mídia e origem" | "Datas" | "Perda e observação" | "Campos da planilha";
};

export const importFields: ImportField[] = [
  { key: "name", label: "Nome", required: true, group: "Dados básicos" },
  { key: "email", label: "E-mail", group: "Dados básicos" },
  { key: "phone", label: "Número de telefone", group: "Dados básicos" },
  { key: "company", label: "Empresa", group: "Dados básicos" },
  { key: "website", label: "Website", group: "Dados básicos" },
  { key: "siteInput", label: "Coloque seu site → Website", group: "Dados básicos" },

  { key: "status", label: "Status do lead", group: "Comercial" },
  { key: "responsible", label: "Responsável legado (não atribui consultor)", group: "Comercial" },
  { key: "temperature", label: "Temperatura do lead", group: "Comercial" },
  { key: "pain", label: "Dor do lead", group: "Comercial" },
  { key: "estimatedBudget", label: "Orçamento estimado", group: "Comercial" },
  { key: "serviceInterests", label: "Mapeamento dos serviços", group: "Comercial" },

  { key: "advertisesOnMeta", label: "Anuncia na Meta?", group: "Mídia e origem" },
  { key: "advertisesOnGoogle", label: "Anuncia no Google?", group: "Mídia e origem" },
  { key: "advertisesOnGoogle2", label: "Já anuncia no Google ADS? - 2 → Anuncia no Google?", group: "Mídia e origem" },
  { key: "doesNotAdvertise", label: "Não anuncia?", group: "Mídia e origem" },
  { key: "source", label: "Origem", group: "Mídia e origem" },

  { key: "lastContactAt", label: "Último contato em", group: "Datas" },
  { key: "contactMadeAt", label: "Contato feito em", group: "Datas" },
  { key: "nextContactAt", label: "Próximo contato em", group: "Datas" },

  { key: "lostReason", label: "Motivo da perda", group: "Perda e observação" },
  { key: "commercialNotes", label: "Observação comercial", group: "Perda e observação" },

  { key: "immersionDates", label: "Datas Imersão", group: "Campos da planilha" },
  { key: "hasWebsite", label: "Possui website?", group: "Campos da planilha" },
  { key: "alreadyHasWebsite", label: "Já possui Website? → Possui website?", group: "Campos da planilha" },
  { key: "referredBy", label: "Indicado por", group: "Campos da planilha" },
];

export const emptyMapping: ImportMapping = {
  name: "",
  email: "",
  phone: "",
  company: "",
  website: "",
  advertisesOnMeta: "",
  advertisesOnGoogle: "",
  doesNotAdvertise: "",
  status: "",
  responsible: "",
  temperature: "",
  pain: "",
  nextContactAt: "",
  lostReason: "",
  commercialNotes: "",
  lastContactAt: "",
  contactMadeAt: "",
  estimatedBudget: "",
  source: "",
  serviceInterests: "",
  immersionDates: "",
  hasWebsite: "",
  referredBy: "",
  advertisesOnGoogle2: "",
  alreadyHasWebsite: "",
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

const customFieldMapping: Record<"immersionDates" | "hasWebsite" | "referredBy", LeadCustomFieldKey> = {
  immersionDates: "Datas Imersão",
  hasWebsite: "Possui website?",
  referredBy: "Indicado por",
};

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
  nextContactAt: string;
};

export const emptyBulkDefaults: BulkDefaults = {
  source: "",
  temperature: "",
  status: "Novo lead",
  nextContactAt: "",
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

function normalizeDateValue(value: string): string {
  const cleanValue = value.trim();

  if (!cleanValue) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(cleanValue)) {
    return cleanValue;
  }

  const brDate = cleanValue.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);

  if (brDate) {
    const day = brDate[1].padStart(2, "0");
    const month = brDate[2].padStart(2, "0");
    const year = brDate[3].length === 2 ? `20${brDate[3]}` : brDate[3];

    return `${year}-${month}-${day}`;
  }

  const parsedDate = new Date(cleanValue);

  if (!Number.isNaN(parsedDate.getTime())) {
    const year = parsedDate.getFullYear();
    const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
    const day = String(parsedDate.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  return "";
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

function formatBudget(value: string): string {
  const cleanValue = value.trim();

  if (!cleanValue) return "";

  if (cleanValue.includes("R$")) return cleanValue;

  const digits = cleanValue.replace(/\D/g, "");

  if (!digits) return cleanValue;

  const amount = Number(digits);

  if (Number.isNaN(amount)) return cleanValue;

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amount);
}

export function suggestMapping(headers: string[]): ImportMapping {
  const mapping = { ...emptyMapping };

  const rules: Record<ImportFieldKey, string[]> = {
    name: ["nome", "name", "cliente", "lead", "contato"],
    email: ["email", "e mail", "mail"],
    phone: ["telefone", "celular", "whatsapp", "phone", "numero", "número"],
    company: ["empresa", "company", "negocio", "negócio"],
    website: ["website", "site", "url", "dominio", "domínio"],
    advertisesOnMeta: ["meta", "facebook", "instagram ads", "anuncia na meta"],
    advertisesOnGoogle: ["ja anuncia no google", "já anuncia no google", "anuncia no google", "google ads"],
    doesNotAdvertise: ["nao anuncia", "não anuncia", "sem anuncio", "sem anúncio", "nao faz trafego"],
    status: ["status", "etapa", "fase", "pipeline"],
    responsible: ["responsavel", "responsável", "vendedor", "sdr", "closer", "owner"],
    temperature: ["temperatura", "prioridade"],
    pain: ["dor", "problema", "necessidade", "desafio"],
    nextContactAt: ["proximo contato", "próximo contato", "retorno", "follow up", "followup"],
    lostReason: ["motivo da perda", "motivo perda", "perda"],
    commercialNotes: ["observacao", "observação", "observacoes", "notas", "comentario", "comentário"],
    lastContactAt: ["ultimo contato", "último contato", "ultima interacao", "última interação"],
    contactMadeAt: ["contato feito", "primeiro contato", "data contato"],
    estimatedBudget: ["orcamento", "orçamento", "budget", "verba", "investimento"],
    source: ["origem", "source", "canal"],
    serviceInterests: ["servico", "serviço", "produto", "interesse", "oferta", "solucao", "solução", "quem faz", "responsavel servico"],
    immersionDates: ["datas imersao", "data imersao", "datas da imersao"],
    hasWebsite: ["possui website", "possui site"],
    referredBy: ["indicado por", "indicacao", "indicação"],
    advertisesOnGoogle2: ["ja anuncia no google ads 2", "já anuncia no google ads 2", "anuncia no google ads 2", "google ads 2"],
    alreadyHasWebsite: ["ja possui website", "já possui website", "ja possui site", "já possui site"],
    siteInput: ["coloque seu site", "informe seu site", "digite seu site"],
  };

  headers.forEach((header, index) => {
    const normalizedHeader = normalizeSearch(header);

    importFields.forEach((field) => {
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
      if (mapping[field.key]) return;

      const matched = rules[field.key].some((rule) => normalizedHeader.includes(normalizeSearch(rule)));

      if (matched) {
        mapping[field.key] = String(index);
      }
    });
  });

  return mapping;
}

function buildCustomFieldsFromRow(row: RawRow, mapping: ImportMapping): LeadCustomFields {
  const customFields = createEmptyCustomFields();

  Object.entries(customFieldMapping).forEach(([mappingKey, fieldLabel]) => {
    customFields[fieldLabel] = getCell(row, mapping[mappingKey as ImportFieldKey]);
  });

  const alreadyHasWebsite = getCell(row, mapping.alreadyHasWebsite);

  if (!customFields["Possui website?"] && alreadyHasWebsite) {
    customFields["Possui website?"] = alreadyHasWebsite;
  }

  return normalizeCustomFields(customFields);
}

export function buildLeadFromRow(row: RawRow, mapping: ImportMapping, bulkDefaults: BulkDefaults): Lead {
  const customFields = buildCustomFieldsFromRow(row, mapping);
  const lostReason = normalizeLostReason(getCell(row, mapping.lostReason));
  const doesNotAdvertise = normalizeBoolean(getCell(row, mapping.doesNotAdvertise));
  const advertisesOnMeta = doesNotAdvertise ? false : normalizeBoolean(getCell(row, mapping.advertisesOnMeta));
  const advertisesOnGoogleValue = getCell(row, mapping.advertisesOnGoogle) || getCell(row, mapping.advertisesOnGoogle2) || "";
  const advertisesOnGoogle = doesNotAdvertise ? false : normalizeBoolean(advertisesOnGoogleValue);
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
    advertisesOnMeta,
    advertisesOnGoogle,
    doesNotAdvertise,
    lastContactAt: normalizeDateValue(getCell(row, mapping.lastContactAt)),
    contactMadeAt: normalizeDateValue(getCell(row, mapping.contactMadeAt)),
    nextContactAt: normalizeDateValue(getCell(row, mapping.nextContactAt)) || bulkDefaults.nextContactAt,
    expectedCloseAt: "",
    estimatedBudget: formatBudget(getCell(row, mapping.estimatedBudget)),
    isLost,
    lostReason,
    commercialNotes: getCell(row, mapping.commercialNotes),
    status,
    responsible: "",
    responsibleUserId: "",
    temperature: normalizeTemperature(getCell(row, mapping.temperature)) || bulkDefaults.temperature,
    pain: getCell(row, mapping.pain),
    source: normalizeSource(getCell(row, mapping.source)) || (customFields["Indicado por"] ? "Indicação" : "") || bulkDefaults.source,
    serviceInterests,
    serviceStatusMap,
    customFields,
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
export const IMPORT_BATCH_SIZE = 3000;
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

