import { useEffect, useMemo, useState } from "react";
import type { CRMUser } from "../types/Lead";
import type { KanbanPipeline } from "../types/Kanban";
import { spreadsheetCustomFieldLabels } from "../constants/customFields";
import { serviceOptions, serviceProviderStatusOptions } from "../constants/services";
import { leadLostReasonOptions, leadStatusOptions, leadTemperatureOptions } from "../features/leads/leadDrawerModel";
import {
  describeApiError,
  downloadLeadsCsvExport,
  downloadLeadsXlsxExport,
  fetchKanbanPipelines,
  fetchLeadFilterOptionsFromServer,
  previewLeadExport,
  type LeadExportDateFilter,
  type LeadExportFilters,
  type LeadExportPreview,
} from "../utils/api";

type LeadExportCenterProps = {
  currentUser: CRMUser;
  users: CRMUser[];
};

type Preset = { id: string; name: string; filters: LeadExportFilters };

const PRESET_KEY = "crmCasaAdsLeadExportPresetsV1";
const initialFilters: LeadExportFilters = { base: "active", dates: {}, fieldStates: {}, advertising: {} };
const datePresetOptions = [
  ["", "Qualquer data"], ["overdue", "Vencido"], ["today", "Hoje"], ["tomorrow", "Amanhã"],
  ["next7", "Próximos 7 dias"], ["next30", "Próximos 30 dias"], ["thisMonth", "Este mês"],
  ["noDate", "Sem data"], ["hasDate", "Com data"], ["custom", "Período personalizado"],
] as const;

const fieldStateLabels: Array<[string, string]> = [
  ["responsible", "Responsável"], ["temperature", "Temperatura"], ["source", "Origem"], ["pain", "Dor"],
  ["nextStep", "Próximo passo"], ["website", "Website"], ["instagram", "Instagram"], ["commercialNotes", "Observação comercial"],
  ["observation", "Observação"],
  ["email", "E-mail"], ["phone", "Telefone"], ["company", "Empresa"],
];

function splitCsv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function compactFilters(filters: LeadExportFilters): LeadExportFilters {
  return JSON.parse(JSON.stringify(filters, (_key, value) => {
    if (value === "" || value === null) return undefined;
    if (Array.isArray(value) && value.length === 0) return undefined;
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return undefined;
    return value;
  }));
}

function countActiveCriteria(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).reduce<number>((sum, item) => sum + countActiveCriteria(item), 0);
  return 1;
}

function MultiChecks({ label, options, selected, onChange }: { label: string; options: Array<{ value: string; label: string }>; selected: string[]; onChange: (values: string[]) => void }) {
  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  }

  return (
    <fieldset className="exportCheckGroup">
      <legend>
        <span>{label}</span>
        {selected.length ? <small>{selected.length} selecionado(s)</small> : null}
      </legend>
      <div className="exportCheckGrid">
        {options.map((option) => {
          const checked = selected.includes(option.value);
          return (
            <label key={option.value} className={`exportCheckOption${checked ? " is-selected" : ""}`}>
              <input type="checkbox" checked={checked} onChange={() => toggle(option.value)} />
              <span className="exportCheckMark" aria-hidden="true">{checked ? "✓" : ""}</span>
              <span className="exportCheckText">{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function DateFilterControl({ label, value = {}, onChange }: { label: string; value?: LeadExportDateFilter; onChange: (value: LeadExportDateFilter) => void }) {
  const preset = value.preset || "";
  return (
    <div className="exportDateFilter">
      <label className="field">
        <span>{label}</span>
        <select value={preset} onChange={(event) => onChange({ ...value, preset: event.target.value })}>
          {datePresetOptions.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select>
      </label>
      {preset === "custom" ? (
        <div className="exportDateRange">
          <label className="field"><span>De</span><input type="date" value={value.from || ""} onChange={(event) => onChange({ ...value, from: event.target.value })} /></label>
          <label className="field"><span>Até</span><input type="date" value={value.to || ""} onChange={(event) => onChange({ ...value, to: event.target.value })} /></label>
        </div>
      ) : null}
    </div>
  );
}

export function LeadExportCenter({ currentUser, users }: LeadExportCenterProps) {
  const [filters, setFilters] = useState<LeadExportFilters>(initialFilters);
  const [sources, setSources] = useState<Array<{ name: string; total: number }>>([]);
  const [pipelines, setPipelines] = useState<KanbanPipeline[]>([]);
  const [preview, setPreview] = useState<LeadExportPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [exportBusy, setExportBusy] = useState<"" | "csv" | "xlsx" | "complete">("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [presetName, setPresetName] = useState("");
  const [presets, setPresets] = useState<Preset[]>(() => {
    try { return JSON.parse(localStorage.getItem(PRESET_KEY) || "[]"); } catch { return []; }
  });

  useEffect(() => {
    let active = true;
    void Promise.all([fetchLeadFilterOptionsFromServer(), fetchKanbanPipelines()]).then(([options, pipelineList]) => {
      if (!active) return;
      setSources(options.sources || []);
      setPipelines(pipelineList.filter((pipeline) => !pipeline.isArchived));
    }).catch((cause) => active && setError(describeApiError(cause, "Não foi possível carregar o exportador de leads.")));
    return () => { active = false; };
  }, []);

  const compactedFilters = useMemo(() => compactFilters(filters), [filters]);
  const serializedFilters = useMemo(() => JSON.stringify(compactedFilters), [compactedFilters]);

  useEffect(() => {
    let active = true;
    const timeoutId = window.setTimeout(() => {
      setPreviewLoading(true);
      setError("");
      void previewLeadExport(JSON.parse(serializedFilters)).then((result) => {
        if (active) setPreview(result);
      }).catch((cause) => {
        if (active) {
          setPreview(null);
          setError(describeApiError(cause, "Não foi possível calcular a prévia da exportação."));
        }
      }).finally(() => active && setPreviewLoading(false));
    }, 450);
    return () => { active = false; window.clearTimeout(timeoutId); };
  }, [serializedFilters]);

  const activeUsers = useMemo(() => users.filter((user) => user.isActive), [users]);
  const availableStages = useMemo(() => pipelines.flatMap((pipeline) => pipeline.stages.filter((stage) => !stage.isArchived).map((stage) => ({ ...stage, pipelineName: pipeline.name }))), [pipelines]);
  const activeCriteriaCount = useMemo(() => countActiveCriteria(compactedFilters), [compactedFilters]);

  function patch(patchValue: Partial<LeadExportFilters>) { setFilters((current) => ({ ...current, ...patchValue })); }
  function patchNested<K extends "dates" | "fieldStates" | "advertising" | "customFields">(key: K, childKey: string, value: unknown) {
    setFilters((current) => ({ ...current, [key]: { ...(current[key] || {}), [childKey]: value } }));
  }
  function savePresets(next: Preset[]) {
    setPresets(next);
    localStorage.setItem(PRESET_KEY, JSON.stringify(next));
  }
  function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    const next = [...presets.filter((preset) => preset.name.toLocaleLowerCase("pt-BR") !== name.toLocaleLowerCase("pt-BR")), { id: crypto.randomUUID(), name, filters: compactedFilters }];
    savePresets(next);
    setPresetName("");
    setMessage(`Preset “${name}” salvo.`);
  }
  function resetFilters() {
    setFilters(initialFilters);
    setMessage("");
  }
  async function runExport(kind: "csv" | "xlsx" | "complete") {
    setExportBusy(kind);
    setError("");
    setMessage("");
    try {
      if (kind === "csv") await downloadLeadsCsvExport(compactedFilters);
      else await downloadLeadsXlsxExport(compactedFilters, kind === "complete" ? "complete" : "simple");
      setMessage(`Exportação ${kind === "complete" ? "XLSX completa" : kind.toUpperCase()} concluída.`);
    } catch (cause) {
      setError(describeApiError(cause, "Não foi possível concluir a exportação."));
    } finally {
      setExportBusy("");
    }
  }

  return (
    <section className="panel leadExportPanel">
      <div className="exportHero">
        <div className="exportHeroMain">
          <span className="eyebrow">Administração</span>
          <h3>Exportação de Leads</h3>
          <p>Monte qualquer conjunto de leads usando os mesmos filtros do CRM, confira a prévia em tempo real e exporte o resultado exato em CSV ou XLSX.</p>
          <div className="exportHeroBadges">
            <span className="exportHeroBadge">Somente administradores</span>
            <span className="exportHeroBadge">Prévia em tempo real</span>
            <span className="exportHeroBadge">Job assíncrono</span>
          </div>
        </div>
        <div className="exportHeroStats">
          <div className="exportStatCard exportStatCardPrimary">
            <span>Total encontrado</span>
            <strong>{previewLoading ? "…" : (preview?.total ?? 0).toLocaleString("pt-BR")}</strong>
            <small>lead(s) no conjunto atual</small>
          </div>
          <div className="exportStatCard">
            <span>Critérios ativos</span>
            <strong>{activeCriteriaCount.toLocaleString("pt-BR")}</strong>
            <small>itens de filtro preenchidos</small>
          </div>
          <div className="exportStatCard">
            <span>Presets salvos</span>
            <strong>{presets.length.toLocaleString("pt-BR")}</strong>
            <small>configurações prontas</small>
          </div>
        </div>
      </div>

      {error ? <div className="systemNotice systemNoticeError" role="alert">{error}</div> : null}
      {message ? <div className="systemNotice">{message}</div> : null}

      <div className="exportToolbarCard">
        <div className="sectionTitleRow exportToolbarHeader">
          <div>
            <h4>Presets e atalhos</h4>
            <p>Salve filtros usados com frequência e retome exportações recorrentes em poucos cliques.</p>
          </div>
        </div>
        <div className="exportPresetBar">
          <label className="field">
            <span>Preset salvo</span>
            <select defaultValue="" onChange={(event) => { const preset = presets.find((item) => item.id === event.target.value); if (preset) { setFilters(preset.filters); setMessage(`Preset “${preset.name}” aplicado.`); } }}>
              <option value="">Selecionar preset salvo</option>
              {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Salvar configuração atual</span>
            <input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="Ex.: Propostas abertas" />
          </label>
          <button className="secondaryButton" type="button" onClick={savePreset} disabled={!presetName.trim()}>Salvar preset</button>
          <button className="ghostButton" type="button" onClick={resetFilters}>Limpar filtros</button>
        </div>
      </div>

      <div className="exportFilterSections">
        <details open className="exportFilterSection">
          <summary>
            <div>
              <strong>Base, busca e situação comercial</strong>
              <small>Defina o universo principal de leads e o recorte comercial básico.</small>
            </div>
          </summary>
          <div className="exportFieldGrid">
            <label className="field"><span>Base</span><select value={filters.base || "active"} onChange={(event) => patch({ base: event.target.value as LeadExportFilters["base"] })}><option value="active">Leads ativos</option><option value="deleted">Lixeira</option><option value="archived">Arquivo de leads</option></select></label>
            <label className="field exportWideField"><span>Busca geral</span><input value={filters.search || ""} onChange={(event) => patch({ search: event.target.value })} placeholder="Nome, empresa, telefone, e-mail, notas..." /></label>
            <label className="field"><span>Orçamento contém</span><input value={filters.estimatedBudgetContains || ""} onChange={(event) => patch({ estimatedBudgetContains: event.target.value })} /></label>
            <label className="field"><span>Observação contém</span><input value={filters.observationContains || ""} onChange={(event) => patch({ observationContains: event.target.value })} /></label>
            <label className="field"><span>Filtro comercial rápido</span><select value={filters.quickFilter || ""} onChange={(event) => patch({ quickFilter: event.target.value })}><option value="">Nenhum</option><option value="owner">Sem responsável</option><option value="next">Sem próximo passo</option><option value="lead-priority">Alta prioridade</option><option value="lead-mapping">Precisa mapear</option><option value="agency">Outra agência</option><option value="lead-expansion">Oportunidade de expansão</option><option value="diagnosis">Sem diagnóstico</option><option value="mapping-critical">Mapeamento crítico</option></select></label>
          </div>
          <MultiChecks label="Status" options={leadStatusOptions.map((value) => ({ value, label: value }))} selected={filters.statuses || []} onChange={(statuses) => patch({ statuses })} />
          <MultiChecks label="Temperatura" options={leadTemperatureOptions.filter(Boolean).map((value) => ({ value, label: value }))} selected={filters.temperatures || []} onChange={(temperatures) => patch({ temperatures })} />
          <MultiChecks label="Status de pagamento" options={[{ value: "pago", label: "Pago" }, { value: "pendente", label: "Pendente" }, { value: "cancelado", label: "Cancelado" }]} selected={filters.paymentStatuses || []} onChange={(paymentStatuses) => patch({ paymentStatuses })} />
          <MultiChecks label="Motivo da perda" options={leadLostReasonOptions.filter(Boolean).map((value) => ({ value, label: value }))} selected={filters.lostReasons || []} onChange={(lostReasons) => patch({ lostReasons })} />
        </details>

        <details className="exportFilterSection">
          <summary>
            <div>
              <strong>Responsáveis, origem, funil e etapa</strong>
              <small>Combine responsáveis atuais, SDRs, origem do lead e posição no pipeline.</small>
            </div>
          </summary>
          <MultiChecks label="Responsável atual" options={activeUsers.map((user) => ({ value: user.id, label: `${user.name} · ${user.roleLabel}` }))} selected={filters.responsibleUserIds || []} onChange={(responsibleUserIds) => patch({ responsibleUserIds })} />
          <MultiChecks label="SDR responsável" options={activeUsers.map((user) => ({ value: user.id, label: `${user.name} · ${user.roleLabel}` }))} selected={filters.sdrResponsibleUserIds || []} onChange={(sdrResponsibleUserIds) => patch({ sdrResponsibleUserIds })} />
          <MultiChecks label="Origem" options={sources.map((source) => ({ value: source.name, label: `${source.name} (${source.total})` }))} selected={filters.sources || []} onChange={(sourcesValue) => patch({ sources: sourcesValue })} />
          <div className="exportFieldGrid">
            <label className="field"><span>Responsáveis legados/por nome</span><input value={(filters.responsibleNames || []).join(", ")} onChange={(event) => patch({ responsibleNames: splitCsv(event.target.value) })} placeholder="Nomes separados por vírgula" /></label>
            <label className="field"><span>SDRs legados/por nome</span><input value={(filters.sdrResponsibleNames || []).join(", ")} onChange={(event) => patch({ sdrResponsibleNames: splitCsv(event.target.value) })} placeholder="Nomes separados por vírgula" /></label>
            <label className="field"><span>Origens manuais</span><input value={(filters.sources || []).join(", ")} onChange={(event) => patch({ sources: splitCsv(event.target.value) })} placeholder="Instagram, evento, webhook..." /></label>
          </div>
          <MultiChecks label="Funil" options={pipelines.map((pipeline) => ({ value: pipeline.id, label: pipeline.name }))} selected={filters.pipelineIds || []} onChange={(pipelineIds) => patch({ pipelineIds })} />
          <MultiChecks label="Etapa" options={availableStages.map((stage) => ({ value: stage.id, label: `${stage.pipelineName} › ${stage.name}` }))} selected={filters.stageIds || []} onChange={(stageIds) => patch({ stageIds })} />
          <MultiChecks label="Tipo de etapa" options={[{ value: "open", label: "Aberta" }, { value: "won", label: "Ganha" }, { value: "lost", label: "Perdida" }]} selected={filters.stageTypes || []} onChange={(stageTypes) => patch({ stageTypes: stageTypes as Array<"open" | "won" | "lost"> })} />
        </details>

        <details className="exportFilterSection">
          <summary>
            <div>
              <strong>Datas</strong>
              <small>Filtre o conjunto por criação, atualização, contatos, ganhos, perdas e entrada no funil.</small>
            </div>
          </summary>
          <div className="exportDateGrid">
            {(["createdAt", "updatedAt", "nextContactAt", "expectedCloseAt", "lastContactAt", "contactMadeAt", "wonAt", "lostAt", "pipelineEnteredAt"] as const).map((key) => {
              const labels: Record<string, string> = { createdAt: "Criação", updatedAt: "Atualização", nextContactAt: "Próximo contato", expectedCloseAt: "Fechamento previsto", lastContactAt: "Último contato", contactMadeAt: "Contato realizado", wonAt: "Ganho", lostAt: "Perdido", pipelineEnteredAt: "Entrada no funil" };
              return <DateFilterControl key={key} label={labels[key]} value={filters.dates?.[key]} onChange={(value) => patchNested("dates", key, value)} />;
            })}
          </div>
        </details>

        <details className="exportFilterSection">
          <summary>
            <div>
              <strong>Qualidade e preenchimento dos dados</strong>
              <small>Encontre leads incompletos, com lacunas cadastrais ou sem confirmação de mídia.</small>
            </div>
          </summary>
          <div className="exportFieldGrid">
            {fieldStateLabels.map(([key, label]) => <label className="field" key={key}><span>{label}</span><select value={filters.fieldStates?.[key] || ""} onChange={(event) => patchNested("fieldStates", key, event.target.value)}><option value="">Qualquer</option><option value="filled">Preenchido</option><option value="empty">Vazio</option></select></label>)}
          </div>
          <div className="exportFieldGrid">
            {[ ["google", "Anuncia Google"], ["meta", "Anuncia Meta"], ["none", "Marcado como não anuncia"] ].map(([key, label]) => <label className="field" key={key}><span>{label}</span><select value={filters.advertising?.[key] || ""} onChange={(event) => patchNested("advertising", key, event.target.value)}><option value="">Qualquer</option><option value="yes">Sim</option><option value="no">Não</option></select></label>)}
          </div>
        </details>

        <details className="exportFilterSection">
          <summary>
            <div>
              <strong>Serviços, campos personalizados e valores</strong>
              <small>Combine serviços de interesse, status operacionais, campos extras e faixas de valores.</small>
            </div>
          </summary>
          <MultiChecks label="Serviços de interesse" options={serviceOptions.map((value) => ({ value, label: value }))} selected={filters.serviceInterests || []} onChange={(serviceInterests) => patch({ serviceInterests })} />
          <MultiChecks label="Situação dos serviços" options={serviceProviderStatusOptions.map((value) => ({ value, label: value }))} selected={filters.serviceStatuses || []} onChange={(serviceStatuses) => patch({ serviceStatuses })} />
          <div className="exportFieldGrid">
            {spreadsheetCustomFieldLabels.map((field) => <label className="field" key={field}><span>{field}</span><input value={filters.customFields?.[field] || ""} onChange={(event) => patchNested("customFields", field, event.target.value)} /></label>)}
            <label className="field"><span>Valor esperado mínimo</span><input type="number" value={filters.expectedValueMin ?? ""} onChange={(event) => patch({ expectedValueMin: event.target.value === "" ? null : Number(event.target.value) })} /></label>
            <label className="field"><span>Valor esperado máximo</span><input type="number" value={filters.expectedValueMax ?? ""} onChange={(event) => patch({ expectedValueMax: event.target.value === "" ? null : Number(event.target.value) })} /></label>
            <label className="field"><span>Valor fechado mínimo</span><input type="number" value={filters.closedValueMin ?? ""} onChange={(event) => patch({ closedValueMin: event.target.value === "" ? null : Number(event.target.value) })} /></label>
            <label className="field"><span>Valor fechado máximo</span><input type="number" value={filters.closedValueMax ?? ""} onChange={(event) => patch({ closedValueMax: event.target.value === "" ? null : Number(event.target.value) })} /></label>
          </div>
        </details>

        <details className="exportFilterSection">
          <summary>
            <div>
              <strong>Tarefas</strong>
              <small>Filtre o conjunto por existência, status, prioridade, responsável e vencimento das tarefas.</small>
            </div>
          </summary>
          <div className="exportFieldGrid">
            <label className="field"><span>Condição</span><select value={filters.task?.presence || ""} onChange={(event) => patch({ task: { ...(filters.task || {}), presence: event.target.value } })}><option value="">Qualquer</option><option value="has">Possui tarefa</option><option value="none">Sem tarefa</option><option value="pending">Pendente</option><option value="completed">Concluída</option><option value="overdue">Atrasada</option><option value="today">Vence hoje</option></select></label>
          </div>
          <MultiChecks label="Responsável pela tarefa" options={activeUsers.map((user) => ({ value: user.id, label: user.name }))} selected={filters.task?.responsibleUserIds || []} onChange={(responsibleUserIds) => patch({ task: { ...(filters.task || {}), responsibleUserIds } })} />
          <MultiChecks label="Tipo da tarefa" options={[{ value: "ligacao", label: "Ligação" }, { value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "E-mail" }, { value: "reuniao", label: "Reunião" }, { value: "follow_up", label: "Follow-up" }, { value: "outro", label: "Outro" }]} selected={filters.task?.types || []} onChange={(types) => patch({ task: { ...(filters.task || {}), types } })} />
          <MultiChecks label="Status da tarefa" options={[{ value: "pending", label: "Pendente" }, { value: "completed", label: "Concluída" }, { value: "canceled", label: "Cancelada" }]} selected={filters.task?.statuses || []} onChange={(statuses) => patch({ task: { ...(filters.task || {}), statuses } })} />
          <MultiChecks label="Prioridade" options={[{ value: "baixa", label: "Baixa" }, { value: "normal", label: "Normal" }, { value: "alta", label: "Alta" }, { value: "urgente", label: "Urgente" }]} selected={filters.task?.priorities || []} onChange={(priorities) => patch({ task: { ...(filters.task || {}), priorities } })} />
          <DateFilterControl label="Vencimento da tarefa" value={filters.task?.due} onChange={(due) => patch({ task: { ...(filters.task || {}), due } })} />
        </details>

        <details className="exportFilterSection">
          <summary>
            <div>
              <strong>Encaminhamentos, auditoria e origem técnica</strong>
              <small>Crie recortes avançados por histórico operacional, auditoria e integrações externas.</small>
            </div>
          </summary>
          <MultiChecks label="Executado por" options={activeUsers.map((user) => ({ value: user.id, label: user.name }))} selected={filters.handoff?.actorUserIds || []} onChange={(actorUserIds) => patch({ handoff: { ...(filters.handoff || {}), actorUserIds } })} />
          <MultiChecks label="Responsável anterior" options={activeUsers.map((user) => ({ value: user.id, label: user.name }))} selected={filters.handoff?.fromUserIds || []} onChange={(fromUserIds) => patch({ handoff: { ...(filters.handoff || {}), fromUserIds } })} />
          <MultiChecks label="Encaminhado para" options={activeUsers.map((user) => ({ value: user.id, label: user.name }))} selected={filters.handoff?.toUserIds || []} onChange={(toUserIds) => patch({ handoff: { ...(filters.handoff || {}), toUserIds } })} />
          <MultiChecks label="Funil do encaminhamento" options={pipelines.map((pipeline) => ({ value: pipeline.id, label: pipeline.name }))} selected={filters.handoff?.pipelineIds || []} onChange={(pipelineIds) => patch({ handoff: { ...(filters.handoff || {}), pipelineIds } })} />
          <MultiChecks label="Etapa do encaminhamento" options={availableStages.map((stage) => ({ value: stage.id, label: `${stage.pipelineName} › ${stage.name}` }))} selected={filters.handoff?.stageIds || []} onChange={(stageIds) => patch({ handoff: { ...(filters.handoff || {}), stageIds } })} />
          <DateFilterControl label="Data do encaminhamento" value={filters.handoff?.created} onChange={(created) => patch({ handoff: { ...(filters.handoff || {}), created } })} />
          <MultiChecks label="Usuário da auditoria" options={activeUsers.map((user) => ({ value: user.id, label: user.name }))} selected={filters.audit?.actorUserIds || []} onChange={(actorUserIds) => patch({ audit: { ...(filters.audit || {}), actorUserIds } })} />
          <div className="exportFieldGrid">
            <label className="field exportWideField"><span>Ações de auditoria (separadas por vírgula)</span><input value={(filters.audit?.actions || []).join(", ")} onChange={(event) => patch({ audit: { ...(filters.audit || {}), actions: splitCsv(event.target.value) } })} placeholder="lead_created, task_completed, lead_stage_changed..." /></label>
            <label className="field"><span>Provedores externos</span><input value={(filters.externalOrigin?.providers || []).join(", ")} onChange={(event) => patch({ externalOrigin: { ...(filters.externalOrigin || {}), providers: splitCsv(event.target.value) } })} placeholder="zape, activecampaign" /></label>
            <label className="field"><span>Origens externas</span><input value={(filters.externalOrigin?.sources || []).join(", ")} onChange={(event) => patch({ externalOrigin: { ...(filters.externalOrigin || {}), sources: splitCsv(event.target.value) } })} /></label>
            <label className="field"><span>Webhooks</span><input value={(filters.externalOrigin?.webhookNames || []).join(", ")} onChange={(event) => patch({ externalOrigin: { ...(filters.externalOrigin || {}), webhookNames: splitCsv(event.target.value) } })} /></label>
          </div>
          <DateFilterControl label="Data do evento de auditoria" value={filters.audit?.created} onChange={(created) => patch({ audit: { ...(filters.audit || {}), created } })} />
        </details>
      </div>

      <div className="exportPreviewBlock">
        <div className="sectionTitleRow">
          <div>
            <h4>Prévia</h4>
            <p>Até 20 leads do conjunto atual. O total é calculado no servidor com os filtros aplicados.</p>
          </div>
        </div>
        <div className="tableScroller">
          <table className="dataTable exportPreviewTable">
            <thead>
              <tr><th>Lead</th><th>Empresa</th><th>Status</th><th>Pagamento</th><th>Responsável</th><th>Origem</th><th>Funil / etapa</th></tr>
            </thead>
            <tbody>
              {(preview?.sample || []).slice(0, 20).map((lead) => <tr key={lead.id}><td><strong>{lead.name || "Sem nome"}</strong><small>{lead.email || lead.phone}</small></td><td>{lead.company || "—"}</td><td>{lead.status || "—"}</td><td>{lead.paymentStatus === "pago" ? "Pago" : lead.paymentStatus === "pendente" ? "Pendente" : lead.paymentStatus === "cancelado" ? "Cancelado" : "—"}</td><td>{lead.responsible || "—"}</td><td>{lead.source || "—"}</td><td>{[lead.pipelineName, lead.stageName].filter(Boolean).join(" › ") || "—"}</td></tr>)}
              {!previewLoading && !preview?.sample?.length ? <tr><td colSpan={7} className="emptyState">Nenhum lead corresponde aos filtros.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="exportActionsBar">
        <div><strong>Exportar {(preview?.total ?? 0).toLocaleString("pt-BR")} lead(s)</strong><span>O XLSX completo inclui abas extras de tarefas, notas, encaminhamentos, auditoria e origens externas.</span></div>
        <div className="exportActionButtons">
          <button className="secondaryButton" type="button" disabled={Boolean(exportBusy) || !preview?.total} onClick={() => void runExport("csv")}>{exportBusy === "csv" ? "Gerando…" : "Exportar CSV"}</button>
          <button className="primaryButton" type="button" disabled={Boolean(exportBusy) || !preview?.total} onClick={() => void runExport("xlsx")}>{exportBusy === "xlsx" ? "Gerando…" : "Exportar XLSX"}</button>
          <button className="primaryButton" type="button" disabled={Boolean(exportBusy) || !preview?.total} onClick={() => void runExport("complete")}>{exportBusy === "complete" ? "Gerando completo…" : "XLSX completo"}</button>
        </div>
      </div>
      <small className="exportAuditHint">A exportação é restrita a administradores, roda como job assíncrono e fica registrada na auditoria. Usuário atual: {currentUser.name}.</small>
    </section>
  );
}
