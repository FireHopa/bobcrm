import { ChangeEvent, useMemo, useState } from "react";
import { unzipSync } from "fflate";
import type { Lead } from "../types/Lead";
import type { ImportDeduplicationReport } from "../utils/commercial";
import {
  importConsultantPipelineBatch,
  preflightConsultantPipelineImport,
  type ConsultantImportEntry,
  type ConsultantImportOwnerDescriptor,
  type ConsultantImportPreflight,
  type ConsultantImportRouteDescriptor,
} from "../utils/api";
import {
  buildLeadFromRow,
  emptyBulkDefaults,
  emptyMapping,
  getImportDuplicateKey,
  isValidLead,
  iterateCsvRows,
  profileCsvFile,
  waitForBrowser,
  type ImportMapping,
  type RawRow,
} from "../features/import/importModel";

type Props = {
  onImportFinished?: (report: ImportDeduplicationReport) => void;
};

const CONSULTANT_IMPORT_BATCH_SIZE = 500;

type ConsultantHeaders = {
  dealId: number;
  dealTitle: number;
  firstName: number;
  lastName: number;
  ownerName: number;
  ownerEmail: number;
  pipelineName: number;
  stageName: number;
  leadName: number;
  leadEmail: number;
  phone: number;
  company: number;
  website: number;
  notes: number;
  temperature: number;
};

type SourceCsv = {
  file: File;
  delimiter: string;
  headers: string[];
  indexes: ConsultantHeaders;
  totalRows: number;
};

type ScanResult = {
  sources: SourceCsv[];
  owners: ConsultantImportOwnerDescriptor[];
  routes: ConsultantImportRouteDescriptor[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
};

const MAX_SPECIAL_ZIP_BYTES = 30 * 1024 * 1024;
const MAX_SPECIAL_UNCOMPRESSED_BYTES = 120 * 1024 * 1024;

function normalizeHeader(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findHeaderIndex(headers: string[], names: string[], required = false) {
  const candidates = new Set(names.map(normalizeHeader));
  const index = headers.findIndex((header) => candidates.has(normalizeHeader(header)));
  if (required && index < 0) {
    throw new Error(`Coluna obrigatória não encontrada: ${names[0]}.`);
  }
  return index;
}

function readConsultantHeaders(headers: string[]): ConsultantHeaders {
  return {
    dealId: findHeaderIndex(headers, ["ID do Negócio", "ID do Negocio"], true),
    dealTitle: findHeaderIndex(headers, ["Título", "Titulo"]),
    firstName: findHeaderIndex(headers, ["Primeiro nome do contato principal"]),
    lastName: findHeaderIndex(headers, ["Sobrenome do contato principal"]),
    ownerName: findHeaderIndex(headers, ["Nome do dono"], true),
    ownerEmail: findHeaderIndex(headers, ["Email do dono", "E-mail do dono"], true),
    pipelineName: findHeaderIndex(headers, ["Funil"], true),
    stageName: findHeaderIndex(headers, ["Etapa"], true),
    leadName: findHeaderIndex(headers, ["Nome do contato principal", "Nome do contato"], true),
    leadEmail: findHeaderIndex(headers, ["Email de contato principal", "E-mail de contato principal"]),
    phone: findHeaderIndex(headers, ["Telefone", "Celular", "WhatsApp"]),
    company: findHeaderIndex(headers, ["Conta", "Empresa"]),
    website: findHeaderIndex(headers, ["WEBSITE", "Website", "Site"]),
    notes: findHeaderIndex(headers, ["Descrição", "Descricao", "Observação", "Observacao"]),
    temperature: findHeaderIndex(headers, ["Termômetro", "Termometro", "Temperatura"]),
  };
}

function rowValue(row: RawRow, index: number) {
  return index >= 0 ? String(row[index] || "").trim() : "";
}


function getLegacyLeadName(row: RawRow, indexes: ConsultantHeaders) {
  const fullName = rowValue(row, indexes.leadName);
  if (fullName) return fullName;
  const splitName = [rowValue(row, indexes.firstName), rowValue(row, indexes.lastName)].filter(Boolean).join(" ").trim();
  if (splitName) return splitName;
  const company = rowValue(row, indexes.company);
  if (company) return company;
  const email = rowValue(row, indexes.leadEmail);
  if (email) return email;
  const dealId = rowValue(row, indexes.dealId);
  const title = rowValue(row, indexes.dealTitle);
  return title ? `${title}${dealId ? ` #${dealId}` : ""}` : dealId ? `Negócio ${dealId}` : "";
}

function incrementDescriptor<T extends { count: number }>(map: Map<string, T>, key: string, factory: () => T) {
  const current = map.get(key);
  if (current) current.count += 1;
  else map.set(key, factory());
}

async function expandSelectedFiles(selectedFiles: File[]): Promise<File[]> {
  const csvFiles: File[] = [];

  for (const selected of selectedFiles) {
    const lowerName = selected.name.toLowerCase();
    if (lowerName.endsWith(".csv")) {
      if (!lowerName.includes("resumo_planilhas_por_dono")) csvFiles.push(selected);
      continue;
    }

    if (!lowerName.endsWith(".zip")) continue;
    if (selected.size > MAX_SPECIAL_ZIP_BYTES) {
      throw new Error("O ZIP especial excede 30 MB. Use o ZIP das planilhas desta migração ou envie os CSVs separados.");
    }

    const entries = unzipSync(new Uint8Array(await selected.arrayBuffer()));
    let uncompressedBytes = 0;

    for (const [name, bytes] of Object.entries(entries)) {
      uncompressedBytes += bytes.byteLength;
      if (uncompressedBytes > MAX_SPECIAL_UNCOMPRESSED_BYTES) {
        throw new Error("O conteúdo descompactado excede o limite de segurança de 120 MB.");
      }
      const normalizedName = name.toLowerCase();
      if (!normalizedName.endsWith(".csv") || normalizedName.includes("resumo_planilhas_por_dono")) continue;
      const copiedBytes = new Uint8Array(bytes.byteLength);
      copiedBytes.set(bytes);
      csvFiles.push(new File([copiedBytes], name.split("/").pop() || name, { type: "text/csv" }));
    }
  }

  if (!csvFiles.length) throw new Error("Nenhum CSV de leads foi encontrado no arquivo selecionado.");
  return csvFiles;
}

async function scanConsultantFiles(files: File[]): Promise<ScanResult> {
  const sources: SourceCsv[] = [];
  const ownerMap = new Map<string, ConsultantImportOwnerDescriptor>();
  const routeMap = new Map<string, ConsultantImportRouteDescriptor>();
  let totalRows = 0;
  let validRows = 0;
  let invalidRows = 0;

  for (const file of files) {
    const profile = await profileCsvFile(file);
    const indexes = readConsultantHeaders(profile.headers);
    const source: SourceCsv = {
      file,
      delimiter: profile.delimiter,
      headers: profile.headers,
      indexes,
      totalRows: profile.totalRows,
    };
    sources.push(source);
    totalRows += profile.totalRows;

    let rowIndex = 0;
    for await (const row of iterateCsvRows(file, profile.delimiter)) {
      if (!row.some((cell) => cell.trim())) continue;
      if (rowIndex === 0) {
        rowIndex += 1;
        continue;
      }

      const ownerName = rowValue(row, indexes.ownerName);
      const ownerEmail = rowValue(row, indexes.ownerEmail);
      const pipelineName = rowValue(row, indexes.pipelineName);
      const stageName = rowValue(row, indexes.stageName);
      const leadName = getLegacyLeadName(row, indexes);

      if (!leadName) invalidRows += 1;
      else validRows += 1;

      const ownerKey = `${ownerEmail.toLowerCase()}|${normalizeHeader(ownerName)}`;
      incrementDescriptor(ownerMap, ownerKey, () => ({ ownerName, ownerEmail, count: 1 }));

      const routeKey = `${normalizeHeader(pipelineName)}|${normalizeHeader(stageName)}`;
      incrementDescriptor(routeMap, routeKey, () => ({ pipelineName, stageName, count: 1 }));
      rowIndex += 1;
    }
  }

  return {
    sources,
    owners: Array.from(ownerMap.values()).sort((a, b) => b.count - a.count),
    routes: Array.from(routeMap.values()).sort((a, b) => b.count - a.count),
    totalRows,
    validRows,
    invalidRows,
  };
}

function buildMapping(indexes: ConsultantHeaders): ImportMapping {
  return {
    ...emptyMapping,
    name: String(indexes.leadName),
    email: indexes.leadEmail >= 0 ? String(indexes.leadEmail) : "",
    phone: indexes.phone >= 0 ? String(indexes.phone) : "",
    company: indexes.company >= 0 ? String(indexes.company) : "",
    website: indexes.website >= 0 ? String(indexes.website) : "",
    commercialNotes: indexes.notes >= 0 ? String(indexes.notes) : "",
    temperature: indexes.temperature >= 0 ? String(indexes.temperature) : "",
  };
}

function buildConsultantEntry(row: RawRow, source: SourceCsv): ConsultantImportEntry | null {
  const lead = buildLeadFromRow(row, buildMapping(source.indexes), emptyBulkDefaults);
  lead.name = getLegacyLeadName(row, source.indexes);
  const legacyDealId = rowValue(row, source.indexes.dealId);
  if (legacyDealId) lead.id = `legacy-consultores-${legacyDealId}`;
  if (!isValidLead(lead)) return null;

  return {
    lead,
    ownerName: rowValue(row, source.indexes.ownerName),
    ownerEmail: rowValue(row, source.indexes.ownerEmail),
    pipelineName: rowValue(row, source.indexes.pipelineName),
    stageName: rowValue(row, source.indexes.stageName),
  };
}

export function ConsultantPipelineImport({ onImportFinished }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedName, setSelectedName] = useState("");
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [preflight, setPreflight] = useState<ConsultantImportPreflight | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [isPreparing, setIsPreparing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [created, setCreated] = useState(0);
  const [merged, setMerged] = useState(0);
  const [ignored, setIgnored] = useState(0);

  const missingOwners = useMemo(() => preflight?.owners.filter((item) => item.status !== "matched") || [], [preflight]);
  const missingRoutes = useMemo(() => preflight?.routes.filter((item) => item.status !== "matched") || [], [preflight]);
  const canImport = Boolean(scan?.validRows && preflight?.ready && !isPreparing && !isImporting);
  const progressPercent = scan?.validRows ? Math.min(100, Math.round((processed / scan.validRows) * 100)) : 0;

  async function runPreflight(nextScan = scan) {
    if (!nextScan) return;
    setError("");
    setStatus("Verificando responsáveis, funil e etapas diretamente no CRM...");
    try {
      const result = await preflightConsultantPipelineImport(nextScan.owners, nextScan.routes);
      setPreflight(result);
      setStatus(result.ready
        ? "Validação concluída. Responsáveis e etapas encontrados no CRM."
        : "Validação concluída com pendências. Corrija os itens abaixo e verifique novamente.");
    } catch (caughtError) {
      setPreflight(null);
      setStatus("");
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível validar os dados no CRM.");
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selected.length) return;

    setIsPreparing(true);
    setError("");
    setPreflight(null);
    setScan(null);
    setProcessed(0);
    setCreated(0);
    setMerged(0);
    setIgnored(0);
    setSelectedName(selected.length === 1 ? selected[0].name : `${selected.length} arquivos selecionados`);
    setStatus("Lendo as planilhas e identificando responsáveis e etapas...");

    try {
      const csvFiles = await expandSelectedFiles(selected);
      const nextScan = await scanConsultantFiles(csvFiles);
      setScan(nextScan);
      setStatus(`${nextScan.validRows.toLocaleString("pt-BR")} leads identificados. Consultando cadastros atuais do CRM...`);
      await runPreflight(nextScan);
    } catch (caughtError) {
      setStatus("");
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível analisar as planilhas.");
    } finally {
      setIsPreparing(false);
    }
  }

  async function sendBatch(batch: ConsultantImportEntry[], report: ImportDeduplicationReport) {
    if (!batch.length) return;
    const result = await importConsultantPipelineBatch(batch);
    report.created += result.report.created;
    report.merged += result.report.merged;
    report.ignoredInsideFile += result.report.ignoredInsideFile;
    setCreated(report.created);
    setMerged(report.merged);
    setIgnored(report.ignoredInsideFile);
    await waitForBrowser();
  }

  async function handleImport() {
    if (!scan || !preflight?.ready || !canImport) return;

    const report: ImportDeduplicationReport = {
      received: scan.validRows,
      created: 0,
      merged: 0,
      ignoredInsideFile: 0,
    };
    const seenKeys = new Set<string>();
    const batch: ConsultantImportEntry[] = [];
    let locallyProcessed = 0;

    setIsImporting(true);
    setError("");
    setStatus("Importando com responsável e etapa por lead...");
    setProcessed(0);
    setCreated(0);
    setMerged(0);
    setIgnored(0);

    try {
      for (const source of scan.sources) {
        let rowIndex = 0;
        for await (const row of iterateCsvRows(source.file, source.delimiter)) {
          if (!row.some((cell) => cell.trim())) continue;
          if (rowIndex === 0) {
            rowIndex += 1;
            continue;
          }

          const entry = buildConsultantEntry(row, source);
          if (!entry) {
            rowIndex += 1;
            continue;
          }

          locallyProcessed += 1;
          const duplicateKey = getImportDuplicateKey(entry.lead as Lead);
          if (duplicateKey && seenKeys.has(duplicateKey)) {
            report.ignoredInsideFile += 1;
            setIgnored(report.ignoredInsideFile);
          } else {
            if (duplicateKey) seenKeys.add(duplicateKey);
            batch.push(entry);
          }

          if (batch.length >= CONSULTANT_IMPORT_BATCH_SIZE) {
            await sendBatch(batch.splice(0, batch.length), report);
          }

          if (locallyProcessed % 500 === 0) {
            setProcessed(locallyProcessed);
            setStatus(`Importando ${locallyProcessed.toLocaleString("pt-BR")} de ${scan.validRows.toLocaleString("pt-BR")} leads...`);
            await waitForBrowser();
          }
          rowIndex += 1;
        }
      }

      await sendBatch(batch.splice(0, batch.length), report);
      setProcessed(scan.validRows);
      setStatus(`Importação concluída. ${report.created.toLocaleString("pt-BR")} criados e ${report.merged.toLocaleString("pt-BR")} mesclados.`);
      onImportFinished?.(report);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível concluir a importação especial.");
      setStatus("Importação interrompida. Nenhum próximo lote será enviado até corrigir o problema.");
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <section className="consultantImportCard">
      <div className="consultantImportHeader">
        <div>
          <span className="eyebrow">Migração exclusiva</span>
          <h3>Pipeline Consultores de Vendas</h3>
          <p>Importa o ZIP desta migração e atribui cada lead ao usuário e à etapa correspondente no CRM.</p>
        </div>
        <button className="primaryButton" type="button" onClick={() => setIsOpen((value) => !value)} disabled={isImporting}>
          {isOpen ? "Fechar importador" : "Importar Pipeline Consultores"}
        </button>
      </div>

      {isOpen ? (
        <div className="consultantImportBody">
          <div className="consultantImportNotice">
            Este fluxo é separado da importação comum. O funil legado “Pipeline Consultores de Vendas” é direcionado automaticamente para “Pipeline consultor venda”. Antes de importar, o sistema confere os usuários e as etapas que existem agora no banco.
          </div>

          <label className="fileDropzone fileDropzoneV8 consultantImportDropzone">
            <input type="file" accept=".zip,.csv" multiple onChange={handleFileChange} disabled={isPreparing || isImporting} />
            <span>{isPreparing ? "Analisando..." : "Selecionar ZIP ou CSVs"}</span>
            <strong>{selectedName || "Use planilhas_separadas_por_dono.zip"}</strong>
          </label>

          {status ? <div className="importWarning">{status}</div> : null}
          {error ? <div className="importError">{error}</div> : null}

          {scan ? (
            <div className="consultantImportSummary">
              <article><span>Leads válidos</span><strong>{scan.validRows.toLocaleString("pt-BR")}</strong></article>
              <article><span>Responsáveis</span><strong>{scan.owners.length}</strong></article>
              <article><span>Rotas de etapa</span><strong>{scan.routes.length}</strong></article>
              <article><span>Sem nome</span><strong>{scan.invalidRows.toLocaleString("pt-BR")}</strong></article>
            </div>
          ) : null}

          {preflight ? (
            <div className="consultantPreflight">
              <div className={`consultantPreflightStatus ${preflight.ready ? "consultantPreflightReady" : "consultantPreflightPending"}`}>
                <strong>{preflight.ready ? "Tudo pronto para importar" : "Existem cadastros faltando"}</strong>
                <span>
                  {preflight.ready
                    ? `${preflight.owners.length} responsáveis e ${preflight.routes.length} destinos validados.`
                    : `${preflight.missingOwners} responsável(is) e ${preflight.missingRoutes} destino(s) precisam de ajuste.`}
                </span>
              </div>

              {preflight.fallbackRows > 0 ? (
                <div className="consultantFallbackInfo">
                  {preflight.fallbackRows.toLocaleString("pt-BR")} lead(s) estão sem etapa ou marcados como “Etapa padrão” e serão enviados para a etapa aberta padrão de “Pipeline consultor venda”.
                </div>
              ) : null}

              {missingOwners.length ? (
                <div className="consultantMissingBlock">
                  <h4>Responsáveis não encontrados</h4>
                  {missingOwners.map((item) => (
                    <div key={`${item.ownerEmail}-${item.ownerName}`}>
                      <strong>{item.ownerName || "Sem nome"}</strong>
                      <span>{item.ownerEmail || "Sem e-mail"} · {item.count.toLocaleString("pt-BR")} leads · {item.status === "ambiguous" ? "mais de um usuário compatível" : "usuário ativo não encontrado"}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {missingRoutes.length ? (
                <div className="consultantMissingBlock">
                  <h4>Funis ou etapas não encontrados</h4>
                  {missingRoutes.map((item) => (
                    <div key={`${item.pipelineName}-${item.stageName}`}>
                      <strong>{item.pipelineName} / {item.stageName || "Etapa padrão"}</strong>
                      <span>{item.count.toLocaleString("pt-BR")} leads · {item.status === "missing_pipeline" ? "funil não encontrado" : "etapa não encontrada"}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {!preflight.ready ? (
                <button className="secondaryButton" type="button" onClick={() => void runPreflight()} disabled={isPreparing || isImporting}>
                  Verificar novamente
                </button>
              ) : null}
            </div>
          ) : null}

          {isImporting || processed > 0 ? (
            <div className="consultantImportProgress">
              <div><span>Progresso</span><strong>{progressPercent}%</strong></div>
              <progress max={100} value={progressPercent} />
              <p>{processed.toLocaleString("pt-BR")} processados · {created.toLocaleString("pt-BR")} criados · {merged.toLocaleString("pt-BR")} mesclados · {ignored.toLocaleString("pt-BR")} ignorados</p>
            </div>
          ) : null}

          <div className="consultantImportFooter">
            <button className="primaryButton importButton" type="button" onClick={handleImport} disabled={!canImport}>
              {isImporting ? "Importando..." : preflight?.ready && scan ? `Importar ${scan.validRows.toLocaleString("pt-BR")} leads agora` : "Aguardando validação"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
