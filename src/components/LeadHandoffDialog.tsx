import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { KanbanPipeline } from "../types/Kanban";
import type { CRMUser, Lead, TaskPriority, TaskType } from "../types/Lead";
import {
  fetchKanbanPipelines,
  handoffLeadToConsultant,
  type LeadHandoffResult,
} from "../utils/api";

const taskTypes: Array<{ value: TaskType; label: string }> = [
  { value: "ligacao", label: "Ligação" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "E-mail" },
  { value: "reuniao", label: "Reunião" },
  { value: "follow_up", label: "Follow-up" },
  { value: "outro", label: "Outro" },
];

const priorities: Array<{ value: TaskPriority; label: string }> = [
  { value: "normal", label: "Normal" },
  { value: "alta", label: "Alta" },
  { value: "urgente", label: "Urgente" },
  { value: "baixa", label: "Baixa" },
];

const focusableSelector = [
  "button:not([disabled])",
  "select:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function localDateTimeMinimum() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

function initialTaskDueAt(value: string) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return `${normalized}T09:00`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return "";
  const offset = parsed.getTimezoneOffset() * 60_000;
  return new Date(parsed.getTime() - offset).toISOString().slice(0, 16);
}

function formatTaskDate(value: string) {
  if (!value) return "data ainda não definida";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

type LeadHandoffDialogProps = {
  lead: Lead;
  assignableUsers: CRMUser[];
  onClose: () => void;
  onCompleted: (result: LeadHandoffResult) => void;
};

export function LeadHandoffDialog({ lead, assignableUsers, onClose, onCompleted }: LeadHandoffDialogProps) {
  const [pipelines, setPipelines] = useState<KanbanPipeline[]>([]);
  const [consultantUserId, setConsultantUserId] = useState(lead.responsibleUserId || "");
  const [pipelineId, setPipelineId] = useState("");
  const [stageId, setStageId] = useState("");
  const [taskTitle, setTaskTitle] = useState("Realizar primeiro contato");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskDueAt, setTaskDueAt] = useState(() => initialTaskDueAt(lead.nextContactAt));
  const [taskType, setTaskType] = useState<TaskType>("ligacao");
  const [taskPriority, setTaskPriority] = useState<TaskPriority>("normal");
  const [requestId] = useState(() => crypto.randomUUID());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const consultantSelectRef = useRef<HTMLSelectElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);

  const selectedConsultant = useMemo(
    () => assignableUsers.find((user) => user.id === consultantUserId) || null,
    [assignableUsers, consultantUserId],
  );

  const selectedPipeline = useMemo(
    () => pipelines.find((pipeline) => pipeline.id === pipelineId) || null,
    [pipelineId, pipelines],
  );

  const selectedStage = useMemo(
    () => selectedPipeline?.stages.find((stage) => stage.id === stageId) || null,
    [selectedPipeline, stageId],
  );

  const currentPipeline = useMemo(
    () => pipelines.find((pipeline) => pipeline.id === lead.pipelineId) || null,
    [lead.pipelineId, pipelines],
  );

  const consultantStepComplete = Boolean(consultantUserId);
  const pipelineStepComplete = Boolean(pipelineId && stageId);
  const taskStepComplete = Boolean(taskTitle.trim().length >= 3 && taskDueAt);
  const formComplete = consultantStepComplete && pipelineStepComplete && taskStepComplete;

  useEffect(() => {
    let active = true;
    fetchKanbanPipelines()
      .then((result) => {
        if (!active) return;
        setPipelines(result);
        if (result.length === 1) {
          const onlyPipeline = result[0];
          const firstOpenStage = onlyPipeline.stages.find((stage) => stage.stageType === "open" && !["Fechado", "Perdido"].includes(stage.statusKey));
          if (firstOpenStage) {
            setPipelineId(onlyPipeline.id);
            setStageId(firstOpenStage.id);
          }
        }
      })
      .catch((caughtError) => {
        if (!active) return;
        setError(caughtError instanceof Error ? caughtError.message : "Não foi possível carregar os funis.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      window.setTimeout(() => {
        const returnTarget = document.querySelector<HTMLElement>(`[data-handoff-lead-id="${lead.id}"]`);
        returnTarget?.focus();
      }, 0);
    };
  }, [lead.id]);

  useEffect(() => {
    if (!isLoading) consultantSelectRef.current?.focus();
  }, [isLoading]);

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !isSaving) {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab") return;
    const focusableElements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) || [])
      .filter((element) => element.offsetParent !== null);
    if (!focusableElements.length) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  function handlePipelineChange(nextPipelineId: string) {
    setPipelineId(nextPipelineId);
    const nextPipeline = pipelines.find((pipeline) => pipeline.id === nextPipelineId);
    const firstOpenStage = nextPipeline?.stages.find((stage) => stage.stageType === "open" && !["Fechado", "Perdido"].includes(stage.statusKey));
    setStageId(firstOpenStage?.id || "");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!formComplete) {
      setError("Conclua os três passos: consultor, funil com etapa e primeira tarefa.");
      return;
    }

    setIsSaving(true);
    try {
      const result = await handoffLeadToConsultant(lead.id, {
        requestId,
        consultantUserId,
        pipelineId,
        stageId,
        task: {
          title: taskTitle.trim(),
          description: taskDescription.trim(),
          dueAt: taskDueAt,
          type: taskType,
          priority: taskPriority,
          responsibleUserId: consultantUserId,
          leadId: lead.id,
        },
      });
      onCompleted(result);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível encaminhar o lead.");
    } finally {
      setIsSaving(false);
    }
  }

  return createPortal(
    <div
      className="leadHandoffOverlay leadHandoffOverlayV44"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !isSaving) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="leadHandoffDialog leadHandoffDialogV44"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-handoff-title"
        aria-describedby="lead-handoff-description"
        onKeyDown={handleDialogKeyDown}
      >
        <header className="leadHandoffHeader leadHandoffHeaderV44">
          <div>
            <span className="eyebrow">Encaminhamento comercial</span>
            <h3 id="lead-handoff-title">Encaminhar {lead.name || lead.company || "lead"}</h3>
            <p id="lead-handoff-description">Defina a carteira, a posição no funil e o primeiro compromisso do consultor.</p>
          </div>
          <button className="iconButton" type="button" onClick={onClose} disabled={isSaving} aria-label="Fechar encaminhamento">×</button>
        </header>

        <div className="leadHandoffProgressV44" aria-label="Progresso do encaminhamento">
          <div className={consultantStepComplete ? "isComplete" : "isCurrent"}><span>1</span><strong>Consultor</strong></div>
          <div className={pipelineStepComplete ? "isComplete" : consultantStepComplete ? "isCurrent" : ""}><span>2</span><strong>Funil e etapa</strong></div>
          <div className={taskStepComplete ? "isComplete" : pipelineStepComplete ? "isCurrent" : ""}><span>3</span><strong>Primeira tarefa</strong></div>
        </div>

        <form className="leadHandoffForm leadHandoffFormV44" onSubmit={handleSubmit}>
          <div className="leadHandoffCurrentV44">
            <span>Situação atual</span>
            <strong>{lead.responsible || "Sem consultor"}</strong>
            <small>{currentPipeline?.name || "Sem funil identificado"}</small>
          </div>

          {error ? <div className="leadHandoffError" role="alert">{error}</div> : null}

          <section className="leadHandoffStepV44">
            <header><span>1</span><div><strong>Quem vai assumir este lead?</strong><small>O consultor passa a visualizar o lead na própria carteira.</small></div></header>
            <label className="field">
              <span>Consultor responsável</span>
              <select
                ref={consultantSelectRef}
                value={consultantUserId}
                onChange={(event) => setConsultantUserId(event.target.value)}
                required
                disabled={isLoading || isSaving}
              >
                <option value="">Selecione o consultor</option>
                {assignableUsers.map((user) => <option key={user.id} value={user.id}>{user.name || user.email}</option>)}
              </select>
              <small>Somente consultores ativos aparecem nesta lista.</small>
            </label>
          </section>

          <section className="leadHandoffStepV44">
            <header><span>2</span><div><strong>Onde o lead deve entrar?</strong><small>Escolha o funil comercial e a primeira etapa de trabalho.</small></div></header>
            <div className="leadHandoffGrid">
              <label className="field">
                <span>Funil de destino</span>
                <select value={pipelineId} onChange={(event) => handlePipelineChange(event.target.value)} required disabled={isLoading || isSaving}>
                  <option value="">Selecione o funil</option>
                  {pipelines.map((pipeline) => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>)}
                </select>
              </label>

              <label className="field">
                <span>Etapa inicial</span>
                <select value={stageId} onChange={(event) => setStageId(event.target.value)} required disabled={!selectedPipeline || isSaving}>
                  <option value="">Selecione a etapa</option>
                  {selectedPipeline?.stages
                    .filter((stage) => stage.stageType === "open" && !["Fechado", "Perdido"].includes(stage.statusKey))
                    .map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
                </select>
              </label>
            </div>
          </section>

          <section className="leadHandoffStepV44">
            <header><span>3</span><div><strong>Qual será o primeiro compromisso?</strong><small>O consultor receberá esta tarefa na Tela Hoje.</small></div></header>
            <div className="leadHandoffGrid">
              <label className="field leadHandoffFullField">
                <span>Título da primeira tarefa</span>
                <input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} maxLength={180} required disabled={isSaving} />
              </label>

              <label className="field">
                <span>Tipo</span>
                <select value={taskType} onChange={(event) => setTaskType(event.target.value as TaskType)} disabled={isSaving}>
                  {taskTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
              </label>

              <label className="field">
                <span>Data e horário</span>
                <input type="datetime-local" min={localDateTimeMinimum()} value={taskDueAt} onChange={(event) => setTaskDueAt(event.target.value)} required disabled={isSaving} />
              </label>

              <label className="field">
                <span>Prioridade</span>
                <select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value as TaskPriority)} disabled={isSaving}>
                  {priorities.map((priority) => <option key={priority.value} value={priority.value}>{priority.label}</option>)}
                </select>
              </label>

              <label className="field leadHandoffFullField">
                <span>Orientação para o consultor <small>(opcional)</small></span>
                <textarea value={taskDescription} onChange={(event) => setTaskDescription(event.target.value)} rows={3} maxLength={5000} disabled={isSaving} placeholder="Ex.: Veio da imersão, demonstrou interesse em Google Ads e pediu contato após as 14h." />
              </label>
            </div>
          </section>

          <aside className={`leadHandoffReviewV44 ${formComplete ? "isReady" : ""}`} aria-live="polite">
            <div>
              <span>Resumo da operação</span>
              <strong>{formComplete ? "Pronto para encaminhar" : "Complete os três passos"}</strong>
            </div>
            <p>
              {lead.name || "O lead"} será atribuído a <b>{selectedConsultant?.name || "um consultor"}</b>, entrará em <b>{selectedPipeline?.name || "um funil"}</b> na etapa <b>{selectedStage?.name || "inicial"}</b> e receberá a tarefa <b>{taskTitle.trim() || "primeiro contato"}</b> para <b>{formatTaskDate(taskDueAt)}</b>.
            </p>
          </aside>

          {!isLoading && !assignableUsers.length ? <p className="mutedText">Nenhum consultor ativo foi encontrado. Cadastre ou ative o consultor na Administração.</p> : null}
          {!isLoading && !pipelines.length ? <p className="mutedText">Nenhum funil ativo foi encontrado.</p> : null}

          <footer className="leadHandoffFooter leadHandoffFooterV44">
            <button className="secondaryButton" type="button" onClick={onClose} disabled={isSaving}>Voltar sem encaminhar</button>
            <button className="primaryButton" type="submit" disabled={isLoading || isSaving || !assignableUsers.length || !pipelines.length || !formComplete}>
              {isSaving ? "Encaminhando..." : "Encaminhar lead agora"}
            </button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}
