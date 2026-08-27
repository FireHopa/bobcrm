import { ChangeEvent, useEffect, useMemo, useState } from "react";
import type { Lead, LeadSource, LeadStatus, LeadTemperature } from "../types/Lead";
import type { KanbanPipeline, KanbanStage } from "../types/Kanban";
import { fetchKanbanPipelines } from "../utils/api";
import { ConsultantPipelineImport } from "./ConsultantPipelineImport";
import type { ImportDeduplicationReport } from "../utils/commercial";
import {
  CSV_PROFILE_SAMPLE_ROWS,
  IMPORT_BATCH_SIZE,
  buildLeadFromRow,
  createEmptyImportProgress,
  emptyBulkDefaults,
  emptyMapping,
  getDuplicatedMappingLabels,
  getCell,
  getImportDuplicateKey,
  importFields,
  isValidLead,
  iterateCsvRows,
  lostReasonOptions,
  normalizeBatchReport,
  normalizeText,
  parseSpreadsheetInWorker,
  profileCsvFile,
  sourceOptions,
  suggestMapping,
  statusOptions,
  temperatureOptions,
  validateImportFile,
  waitForBrowser,
  type BulkDefaults,
  type ImportFieldKey,
  type ImportLeadsProps,
  type ImportMapping,
  type ImportProgress,
  type LargeCsvMeta,
  type RawRow,
} from "../features/import/importModel";

function getPreferredImportStage(pipeline: KanbanPipeline, status: LeadStatus) {
  return pipeline.stages.find((stage) => stage.statusKey === status)
    || pipeline.stages.find((stage) => stage.stageType === "open")
    || pipeline.stages[0]
    || null;
}

function applyImportStageToPreview(lead: Lead, stage: KanbanStage | null) {
  if (!stage) return lead;
  if (stage.stageType === "won") return { ...lead, status: "Fechado" as LeadStatus, isLost: false };
  if (stage.stageType === "lost") return { ...lead, status: "Perdido" as LeadStatus, isLost: true };
  if (stage.statusKey) return { ...lead, status: stage.statusKey as LeadStatus, isLost: stage.statusKey === "Perdido" };
  if (lead.status === "Fechado" || lead.status === "Perdido") return { ...lead, status: "Novo lead" as LeadStatus, isLost: false };
  return lead;
}

export function ImportLeads({ onImportLeads, onImportFinished }: ImportLeadsProps) {
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<RawRow[]>([]);
  const [largeCsvMeta, setLargeCsvMeta] = useState<LargeCsvMeta | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>(emptyMapping);
  const [bulkDefaults, setBulkDefaults] = useState<BulkDefaults>(emptyBulkDefaults);
  const [error, setError] = useState("");
  const [fileReadStatus, setFileReadStatus] = useState("");
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [pipelines, setPipelines] = useState<KanbanPipeline[]>([]);
  const [pipelineLoadError, setPipelineLoadError] = useState("");
  const [targetPipelineId, setTargetPipelineId] = useState("");
  const [targetStageId, setTargetStageId] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    void fetchKanbanPipelines(controller.signal)
      .then((availablePipelines) => {
        setPipelines(availablePipelines);
        setPipelineLoadError("");
      })
      .catch((caughtError) => {
        if (controller.signal.aborted) return;
        setPipelineLoadError(caughtError instanceof Error ? caughtError.message : "Não foi possível carregar os funis.");
      });

    return () => controller.abort();
  }, []);

  const selectedPipeline = useMemo(
    () => pipelines.find((pipeline) => pipeline.id === targetPipelineId) || null,
    [pipelines, targetPipelineId],
  );
  const selectedStage = useMemo(
    () => selectedPipeline?.stages.find((stage) => stage.id === targetStageId) || null,
    [selectedPipeline, targetStageId],
  );

  const previewSourceRows = largeCsvMeta ? largeCsvMeta.sampleRows : rows.slice(0, CSV_PROFILE_SAMPLE_ROWS);
  const previewLeads = useMemo(
    () => previewSourceRows
      .map((row) => applyImportStageToPreview(buildLeadFromRow(row, mapping, bulkDefaults), selectedStage))
      .filter(isValidLead)
      .slice(0, 8),
    [previewSourceRows, mapping, bulkDefaults, selectedStage],
  );
  const totalRows = largeCsvMeta?.totalRows ?? rows.length;
  const validRowsCount = useMemo(() => {
    if (!mapping.name) return 0;
    if (largeCsvMeta) return largeCsvMeta.totalRows;
    return rows.reduce((total, row) => total + (getCell(row, mapping.name).trim() ? 1 : 0), 0);
  }, [largeCsvMeta, mapping.name, rows]);
  const invalidRowsCount = largeCsvMeta ? 0 : Math.max(0, rows.length - validRowsCount);
  const duplicatedMappingLabels = useMemo(() => getDuplicatedMappingLabels(mapping), [mapping]);
  const hasFile = headers.length > 0;
  const hasRequiredName = mapping.name !== "";
  const hasValidKanbanTarget = !targetPipelineId || Boolean(selectedPipeline && selectedStage);
  const canImport = hasRequiredName && totalRows > 0 && hasValidKanbanTarget && !isImporting;
  const isLargeImport = Boolean(largeCsvMeta);
  const progressPercent = importProgress?.totalRows
    ? Math.min(100, Math.round((importProgress.processedRows / importProgress.totalRows) * 100))
    : 0;

  function canGoToNextStep() {
    if (currentStep === 1) return hasFile && !fileReadStatus;
    if (currentStep === 2) return hasRequiredName;
    if (currentStep === 3) return hasRequiredName;
    if (currentStep === 4) return canImport;
    return false;
  }

  function resetImport() {
    if (isImporting) return;
    setFileName("");
    setHeaders([]);
    setRows([]);
    setLargeCsvMeta(null);
    setMapping(emptyMapping);
    setBulkDefaults(emptyBulkDefaults);
    setError("");
    setFileReadStatus("");
    setImportProgress(null);
    setCurrentStep(1);
  }

  function updateMapping(field: ImportFieldKey, value: string) {
    setMapping((currentMapping) => ({
      ...currentMapping,
      [field]: value,
    }));
  }

  function updateTargetPipeline(pipelineId: string) {
    setTargetPipelineId(pipelineId);
    const pipeline = pipelines.find((item) => item.id === pipelineId);
    setTargetStageId(pipeline ? getPreferredImportStage(pipeline, bulkDefaults.status)?.id || "" : "");
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) return;

    setError("");
    setFileReadStatus("");
    setImportProgress(null);

    try {
      validateImportFile(file);
      setFileName(file.name);

      const isCsvFile = /\.csv$/i.test(file.name);

      if (isCsvFile) {
        setRows([]);
        setLargeCsvMeta(null);
        setFileReadStatus("Lendo CSV em fluxo seguro. O arquivo não será carregado inteiro na memória.");

        const profile = await profileCsvFile(file);

        setHeaders(profile.headers);
        setRows([]);
        setLargeCsvMeta({ file, delimiter: profile.delimiter, totalRows: profile.totalRows, sampleRows: profile.sampleRows });
        setMapping(suggestMapping(profile.headers));
        setCurrentStep(2);
        return;
      }

      setFileReadStatus("Processando XLSX em ambiente isolado com limite de tempo e tamanho.");
      const sheetRows = await parseSpreadsheetInWorker(file);

      const cleanRows = sheetRows
        .map((row) => row.map((cell) => normalizeText(cell)))
        .filter((row) => row.some((cell) => cell.trim() !== ""));

      if (cleanRows.length < 2) {
        throw new Error("A planilha precisa ter uma linha de cabeçalho e pelo menos uma linha de lead.");
      }

      const importedHeaders = cleanRows[0].map((header, index) => header || `Coluna ${index + 1}`);
      const importedRows = cleanRows.slice(1);

      setHeaders(importedHeaders);
      setRows(importedRows);
      setLargeCsvMeta(null);
      setMapping(suggestMapping(importedHeaders));
      setCurrentStep(2);
    } catch (caughtError) {
      setHeaders([]);
      setRows([]);
      setLargeCsvMeta(null);
      setMapping(emptyMapping);
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível ler a planilha.");
    } finally {
      setFileReadStatus("");
      event.target.value = "";
    }
  }

  async function sendBatch(batch: Lead[], progress: ImportProgress, totalReport: ImportDeduplicationReport) {
    if (!batch.length) return;

    const batchReport = normalizeBatchReport(await onImportLeads(batch, {
      chunked: true,
      pipelineId: targetPipelineId,
      stageId: targetStageId,
    }), batch.length);
    totalReport.created += batchReport.created;
    totalReport.merged += batchReport.merged;
    totalReport.ignoredInsideFile += batchReport.ignoredInsideFile;

    progress.sentRows += batch.length;
    progress.batches += 1;
    progress.created = totalReport.created;
    progress.merged = totalReport.merged;
    progress.ignoredInsideFile = totalReport.ignoredInsideFile;
    setImportProgress({ ...progress });
    await waitForBrowser();
  }

  async function processRowForImport(row: RawRow, batch: Lead[], seenKeys: Set<string>, progress: ImportProgress, totalReport: ImportDeduplicationReport) {
    progress.processedRows += 1;

    const lead = buildLeadFromRow(row, mapping, bulkDefaults);

    if (!isValidLead(lead)) {
      progress.ignoredInsideFile += 1;
      totalReport.ignoredInsideFile += 1;
      return;
    }

    const duplicateKey = getImportDuplicateKey(lead);

    if (duplicateKey && seenKeys.has(duplicateKey)) {
      progress.ignoredInsideFile += 1;
      totalReport.ignoredInsideFile += 1;
      return;
    }

    if (duplicateKey) seenKeys.add(duplicateKey);

    progress.validRows += 1;
    batch.push(lead);
  }

  async function handleImport() {
    if (!canImport) return;

    const progress = createEmptyImportProgress(totalRows);
    const totalReport: ImportDeduplicationReport = {
      received: totalRows,
      created: 0,
      merged: 0,
      ignoredInsideFile: 0,
    };
    const batch: Lead[] = [];
    const seenKeys = new Set<string>();

    setIsImporting(true);
    setError("");
    setCurrentStep(5);
    setImportProgress({ ...progress, status: "importing" });

    try {
      if (largeCsvMeta) {
        let rowIndex = 0;

        for await (const row of iterateCsvRows(largeCsvMeta.file, largeCsvMeta.delimiter)) {
          if (!row.some((cell) => cell.trim() !== "")) continue;

          if (rowIndex === 0) {
            rowIndex += 1;
            continue;
          }

          await processRowForImport(row, batch, seenKeys, progress, totalReport);

          if (batch.length >= IMPORT_BATCH_SIZE) {
            await sendBatch(batch.splice(0, batch.length), progress, totalReport);
          } else if (progress.processedRows % 2000 === 0) {
            setImportProgress({ ...progress, status: "importing" });
            await waitForBrowser();
          }

          rowIndex += 1;
        }
      } else {
        for (const row of rows) {
          await processRowForImport(row, batch, seenKeys, progress, totalReport);

          if (batch.length >= IMPORT_BATCH_SIZE) {
            await sendBatch(batch.splice(0, batch.length), progress, totalReport);
          } else if (progress.processedRows % 2000 === 0) {
            setImportProgress({ ...progress, status: "importing" });
            await waitForBrowser();
          }
        }
      }

      await sendBatch(batch.splice(0, batch.length), progress, totalReport);
      progress.status = "done";
      progress.created = totalReport.created;
      progress.merged = totalReport.merged;
      progress.ignoredInsideFile = totalReport.ignoredInsideFile;
      setImportProgress({ ...progress });
      onImportFinished?.(totalReport);
    } catch (caughtError) {
      progress.status = "error";
      setImportProgress({ ...progress });
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível concluir a importação em lotes.");
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <section className="panel importPanel importPanelV32 importPanelV33">
      <ConsultantPipelineImport onImportFinished={onImportFinished} />
      <div className="importTopV32 importTopV33">
        <div>
          <span className="eyebrow">Importação</span>
          <h2>Importar leads por planilha</h2>
          <p>Fluxo guiado em 5 etapas. Para bases grandes, o CRM importa em lotes de {IMPORT_BATCH_SIZE.toLocaleString("pt-BR")} contatos.</p>
        </div>

        <div className="importActionsV32 importActionsV33">
          <button className="secondaryButton" type="button" onClick={resetImport} disabled={isImporting}>Limpar</button>
          {currentStep > 1 ? (
            <button className="secondaryButton" type="button" onClick={() => setCurrentStep((Math.max(1, currentStep - 1) as 1 | 2 | 3 | 4 | 5))} disabled={isImporting}>Voltar</button>
          ) : null}
          {currentStep > 1 && currentStep < 5 ? (
            <button className="primaryButton" type="button" disabled={!canGoToNextStep() || isImporting} onClick={() => setCurrentStep((Math.min(5, currentStep + 1) as 1 | 2 | 3 | 4 | 5))}>
              {currentStep >= 2 && !hasRequiredName ? "Mapeie o campo Nome" : "Continuar"}
            </button>
          ) : currentStep === 5 ? (
            <button className="primaryButton importButton" type="button" onClick={handleImport} disabled={!canImport}>
              {isImporting ? "Importando em lotes..." : canImport ? `Importar ${isLargeImport ? "em lotes" : validRowsCount.toLocaleString("pt-BR") + " leads"}` : "Mapeie o campo Nome"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="importInsightV34">Para importar com segurança, envie a planilha e confirme o campo Nome.</div>

      <div className="importStepsV8 importStepsV32 importStepsV33 importStepsV34">
        {[
          { step: 1, title: "Enviar arquivo", helper: "XLSX ou CSV" },
          { step: 2, title: "Mapear colunas", helper: "Detecte Nome, telefone, e-mail e empresa" },
          { step: 3, title: "Campos críticos", helper: "Nome obrigatório" },
          { step: 4, title: "Prévia", helper: hasFile ? `${totalRows.toLocaleString("pt-BR")} linhas lidas` : "Aguardando arquivo" },
          { step: 5, title: "Importar", helper: canImport ? "Envio em lotes seguros" : "Aguardando validação" },
        ].map((item) => (
          <article key={item.step} className={`importStepV8 ${currentStep === item.step ? "importStepActiveV8" : currentStep > item.step ? "importStepDoneV8" : ""}`}>
            <strong>{item.step}</strong>
            <div>
              <h3>{item.title}</h3>
              <p>{item.helper}</p>
            </div>
          </article>
        ))}
      </div>

      {error ? <div className="importError">{error}</div> : null}
      {fileReadStatus ? <div className="importWarning">{fileReadStatus}</div> : null}

      {currentStep === 1 ? (
        <div className="uploadPanelV8 uploadPanelV33 uploadPanelV34">
          <div>
            <h3>Selecionar planilha</h3>
            <p>Envie XLSX de até 15 MB ou CSV de até 200 MB. Planilhas XLS legadas devem ser salvas como XLSX ou CSV. Para bases grandes, prefira CSV. A primeira linha precisa ter os nomes das colunas.</p>
          </div>

          <label className="fileDropzone fileDropzoneV8">
            <input type="file" accept=".xlsx,.csv" onChange={handleFileChange} disabled={Boolean(fileReadStatus) || isImporting} />
            <span>Selecionar planilha</span>
            <strong>{fileName || "Nenhum arquivo selecionado"}</strong>
          </label>
        </div>
      ) : null}

      {currentStep === 2 ? (
        <section className="mappingPanelV8 mappingPanelV33">
          <div className="sectionTitleRow">
            <div>
              <h3>Mapear colunas</h3>
              <p>Confirme os campos detectados automaticamente. Nome é obrigatório para continuar.</p>
            </div>
          </div>

          {isLargeImport ? <div className="importWarning">Modo seguro ativo: este CSV tem {totalRows.toLocaleString("pt-BR")} linhas e será importado sem carregar todos os contatos de uma vez na tela.</div> : null}

          <div className="mappingListV8">
            {importFields
              .filter((field) => field.group === "Dados básicos")
              .map((field) => (
                <label className="mappingRowV8" key={field.key}>
                  <div>
                    <strong>{field.label}{field.required ? " *" : ""}</strong>
                    {field.key === "name" ? <span>Obrigatório para criar o lead.</span> : <span>Recomendado para qualificação.</span>}
                  </div>
                  <select value={mapping[field.key]} onChange={(event) => updateMapping(field.key, event.target.value)} disabled={!headers.length || isImporting}>
                    <option value="">Não importar</option>
                    {headers.map((header, index) => <option key={`${field.key}-${header}-${index}`} value={String(index)}>{header}</option>)}
                  </select>
                </label>
              ))}
          </div>

          <details className="mappingDetailsV8">
            <summary>Campos comerciais e complementares</summary>
            <div className="mappingListV8">
              {importFields
                .filter((field) => field.group !== "Dados básicos")
                .map((field) => (
                  <label className="mappingRowV8" key={field.key}>
                    <div><strong>{field.label}</strong></div>
                    <select value={mapping[field.key]} onChange={(event) => updateMapping(field.key, event.target.value)} disabled={!headers.length || isImporting}>
                      <option value="">Não importar</option>
                      {headers.map((header, index) => <option key={`${field.key}-${header}-${index}`} value={String(index)}>{header}</option>)}
                    </select>
                  </label>
                ))}
            </div>
          </details>

          <details className="mappingDetailsV8">
            <summary>Ver colunas detectadas</summary>
            <div className="detectedColumns detectedColumnsV8">
              {headers.map((header, index) => <span key={`${header}-${index}`} className="detectedColumn">{index + 1}. {header}</span>)}
            </div>
          </details>

          {duplicatedMappingLabels.length ? <div className="importWarning">Atenção: alguns campos estão usando a mesma coluna. Confira: {duplicatedMappingLabels.join(", ")}.</div> : null}
        </section>
      ) : null}

      {currentStep === 3 ? (
        <section className="mappingPanelV8 mappingPanelV33 criticalFieldsPanelV33">
          <div className="sectionTitleRow">
            <div>
              <h3>Confirmar campos críticos</h3>
              <p>O campo Nome é obrigatório. E-mail, telefone e empresa ajudam o time a agir mais rápido.</p>
            </div>
          </div>

          <div className="summaryBarV8 summaryBarV33">
            <article><span>Nome</span><strong>{hasRequiredName ? "Mapeado" : "Pendente"}</strong></article>
            <article><span>E-mail</span><strong>{mapping.email ? "Mapeado" : "Opcional"}</strong></article>
            <article><span>Telefone</span><strong>{mapping.phone ? "Mapeado" : "Opcional"}</strong></article>
            <article><span>Empresa</span><strong>{mapping.company ? "Mapeado" : "Opcional"}</strong></article>
          </div>

          {!hasRequiredName ? <div className="importWarning">O campo Nome é obrigatório para continuar.</div> : null}

          <details className="bulkDefaultsPanel bulkDefaultsPanelV32" open><summary>Definir destino e dados padrão da importação</summary>
            <div>
              <h3>Qualificação em massa</h3>
              <p>Use estes campos para preencher informações ausentes na planilha.</p>
            </div>

            <div className="bulkDefaultsGrid">
              <div className="leadAssignmentNoticeV43 importAssignmentNoticeV43">
                <strong>Importação sem responsável</strong>
                <span>
                  Os leads entram sem consultor. Você pode escolher abaixo o funil e a etapa de entrada. Se deixar no modo automático,
                  o CRM usará o funil padrão e a etapa correspondente ao status.
                </span>
              </div>
              <label className="field">
                <span>Funil de destino</span>
                <select value={targetPipelineId} onChange={(event) => updateTargetPipeline(event.target.value)} disabled={isImporting || !pipelines.length}>
                  <option value="">Automático pelo status</option>
                  {pipelines.map((pipeline) => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}{pipeline.isDefault ? " (padrão)" : ""}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Etapa inicial</span>
                <select value={targetStageId} onChange={(event) => setTargetStageId(event.target.value)} disabled={isImporting || !selectedPipeline}>
                  <option value="">{selectedPipeline ? "Selecione a etapa" : "Definida automaticamente"}</option>
                  {selectedPipeline?.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
                </select>
              </label>
              <label className="field"><span>Origem padrão</span><select value={bulkDefaults.source} onChange={(event) => setBulkDefaults({ ...bulkDefaults, source: event.target.value as LeadSource })} disabled={isImporting}>{sourceOptions.map((source) => <option key={source || "empty"} value={source}>{source || "Selecione"}</option>)}</select></label>
              <label className="field"><span>Temperatura padrão</span><select value={bulkDefaults.temperature} onChange={(event) => setBulkDefaults({ ...bulkDefaults, temperature: event.target.value as LeadTemperature })} disabled={isImporting}>{temperatureOptions.map((temperature) => <option key={temperature || "empty"} value={temperature}>{temperature || "Selecione"}</option>)}</select></label>
              <label className="field"><span>{selectedStage ? "Status definido pela etapa" : "Status padrão"}</span><select value={bulkDefaults.status} onChange={(event) => setBulkDefaults({ ...bulkDefaults, status: event.target.value as LeadStatus })} disabled={isImporting || Boolean(selectedStage)}>{statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
            </div>
            {pipelineLoadError ? <div className="importWarning">Não foi possível carregar os funis: {pipelineLoadError}. A importação continuará usando o funil padrão.</div> : null}
            {targetPipelineId && !targetStageId ? <div className="importWarning">Selecione a etapa inicial do funil para continuar.</div> : null}
            {selectedPipeline && selectedStage ? (
              <div className="importWarning">
                Destino definido: <strong>{selectedPipeline.name} → {selectedStage.name}</strong>. Leads novos e duplicados mesclados serão enviados para esta etapa, e o status seguirá a configuração da etapa.
              </div>
            ) : null}
          </details>
        </section>
      ) : null}

      {currentStep === 4 ? (
        <section className="previewPanelV8 previewPanelV33">
          <div className="sectionTitleRow">
            <div>
              <h3>Prévia antes de importar</h3>
              <p>Revise uma amostra antes de criar os leads no CRM. A importação real será feita em lotes.</p>
            </div>
          </div>

          <div className="summaryBarV8 summaryBarV33 importSummaryWithDestination">
            <article><span>Colunas</span><strong>{headers.length}</strong></article>
            <article><span>Linhas lidas</span><strong>{totalRows.toLocaleString("pt-BR")}</strong></article>
            <article><span>Leads válidos</span><strong>{isLargeImport ? "Durante envio" : validRowsCount.toLocaleString("pt-BR")}</strong></article>
            <article><span>Ignoradas</span><strong>{isLargeImport ? "Durante envio" : invalidRowsCount.toLocaleString("pt-BR")}</strong></article>
            <article><span>Destino</span><strong>{selectedPipeline && selectedStage ? `${selectedPipeline.name} / ${selectedStage.name}` : "Automático"}</strong></article>
          </div>

          <div className="previewCardsV8">
            {previewLeads.length ? previewLeads.map((lead, index) => (
              <article className="previewLeadCardV8" key={`${lead.name}-${lead.email}-${index}`}>
                <header><strong>{lead.name || "Sem nome"}</strong><span>{lead.company || "Empresa não informada"}</span></header>
                <dl>
                  <div><dt>Telefone</dt><dd>{lead.phone || "Não informado"}</dd></div>
                  <div><dt>E-mail</dt><dd>{lead.email || "Não informado"}</dd></div>
                  <div><dt>Status</dt><dd>{lead.status}</dd></div>
                  <div><dt>Instagram</dt><dd>{lead.instagram || "Não informado"}</dd></div>
                  <div><dt>Origem</dt><dd>{lead.source || "Não informado"}</dd></div>
                </dl>
              </article>
            )) : (
              <div className="previewEmptyV8">
                <strong>Prévia indisponível</strong>
                <p>Envie uma planilha e confirme o campo Nome para visualizar os leads.</p>
              </div>
            )}
          </div>

          {totalRows > previewLeads.length ? <p className="previewFooter">Mostrando uma amostra de até {previewLeads.length} leads. A base completa será processada em lotes de {IMPORT_BATCH_SIZE.toLocaleString("pt-BR")}.</p> : null}
        </section>
      ) : null}

      {currentStep === 5 ? (
        <section className="previewPanelV8 importFinishPanelV33">
          <div className="sectionTitleRow">
            <div>
              <h3>{importProgress?.status === "done" ? "Importação concluída" : "Pronto para importar"}</h3>
              <p>{isLargeImport ? "O CSV grande será lido em streaming e enviado em lotes para não travar o navegador." : "Os leads serão enviados em lotes para não sobrecarregar o servidor."}</p>
            </div>
          </div>

          <div className="summaryBarV8 summaryBarV33">
            <article><span>Linhas do arquivo</span><strong>{totalRows.toLocaleString("pt-BR")}</strong></article>
            <article><span>Lote</span><strong>{IMPORT_BATCH_SIZE.toLocaleString("pt-BR")}</strong></article>
            <article><span>Arquivo</span><strong>{fileName || "Não informado"}</strong></article>
            <article><span>Destino</span><strong>{selectedPipeline && selectedStage ? `${selectedPipeline.name} / ${selectedStage.name}` : "Automático"}</strong></article>
          </div>

          {importProgress ? (
            <div className="importProgressBoxV35">
              <div className="importProgressHeaderV35">
                <strong>{importProgress.status === "done" ? "100% concluído" : `${progressPercent}% processado`}</strong>
                <span>{importProgress.processedRows.toLocaleString("pt-BR")} de {importProgress.totalRows.toLocaleString("pt-BR")} linhas</span>
              </div>
              <progress value={importProgress.status === "done" ? importProgress.totalRows : importProgress.processedRows} max={Math.max(1, importProgress.totalRows)} />
              <div className="importProgressGridV35">
                <article><span>Enviados</span><strong>{importProgress.sentRows.toLocaleString("pt-BR")}</strong></article>
                <article><span>Lotes</span><strong>{importProgress.batches.toLocaleString("pt-BR")}</strong></article>
                <article><span>Criados</span><strong>{importProgress.created.toLocaleString("pt-BR")}</strong></article>
                <article><span>Mesclados</span><strong>{importProgress.merged.toLocaleString("pt-BR")}</strong></article>
                <article><span>Ignorados</span><strong>{importProgress.ignoredInsideFile.toLocaleString("pt-BR")}</strong></article>
              </div>
            </div>
          ) : null}

          <div className="importFinalActionsV33">
            <button className="primaryButton importButton" type="button" onClick={handleImport} disabled={!canImport}>
              {isImporting ? "Importando em lotes..." : importProgress?.status === "done" ? "Importar novamente" : canImport ? "Iniciar importação em lotes" : "Mapeie o campo Nome"}
            </button>
            <button className="secondaryButton" type="button" onClick={() => setCurrentStep(4)} disabled={isImporting}>Voltar para prévia</button>
          </div>
        </section>
      ) : null}
    </section>
  );
}
