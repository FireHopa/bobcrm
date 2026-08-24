import { memo, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { normalizeCustomFields, spreadsheetCustomFieldLabels } from "../constants/customFields";
import {
  getLeadWithSyncedAdvertisingFromServices,
  getServiceInterestsFromStatusMap,
  normalizeServiceStatusMap,
  serviceOptions,
  serviceProviderStatusOptions,
} from "../constants/services";
import type {
  Lead,
  LeadSource,
  LeadStatus,
  LeadTemperature,
  LostReason,
  ServiceInterest,
  ServiceProviderStatus,
  ServiceStatusMap,
  LeadCustomFieldKey,
  LeadCustomFields,
  AuditEntry,
  CRMUser,
  ExternalLeadOrigin,
  LeadNote,
  CRMTask,
  TaskPriority,
  TaskType,
} from "../types/Lead";
import {
  addLeadNoteOnServer,
  completeTaskOnServer,
  createTaskOnServer,
  fetchLeadAuditFromServer,
  fetchLeadExternalOriginsFromServer,
  fetchLeadNotesFromServer,
  fetchTasksFromServer,
  hasPermission,
} from "../utils/api";
import { formatCurrencyBRL, formatDate, formatPhone, normalizeWebsite } from "../utils/formatters";
import { TaskCompletionDialog, type TaskCompletionPayload } from "./TaskCompletionDialog";
import { LeadContactMenu, LeadOverflowMenu } from "./LeadActionMenus";
import { BrDateInput } from "./BrDateInput";
import {
  createLeadDrawerFormState,
  leadLostReasonOptions,
  leadSourceOptions,
  leadStatusOptions,
  leadTemperatureOptions,
  validateLeadDrawerForm,
  type DrawerMode,
  type LeadDrawerFormErrors,
  type LeadDrawerFormState,
} from "../features/leads/leadDrawerModel";
import {
  ClientIntelligencePanel,
  CommercialRecommendationPanel,
  ExternalOriginsSection,
  InfoItem,
  InfoText,
  ServiceStatusList,
} from "../features/leads/LeadDetailsPanels";


function toDateTimeLocalInput(value: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return `${normalized}T00:00`;
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  return match ? `${match[1]}T${match[2]}:${match[3]}` : "";
}

function fromDateTimeLocalInput(value: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized) ? `${normalized}:00` : normalized;
}

const DRAWER_FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type LeadDetailsDrawerProps = {
  lead: Lead | null;
  mode: DrawerMode;
  onClose: () => void;
  onChangeMode: (mode: DrawerMode) => void;
  onSaveLead: (lead: Lead) => void;
  onDeleteLead: (leadId: string) => void;
  currentUser: CRMUser | null;
  assignableUsers: CRMUser[];
  onTaskChanged?: () => void;
  onRequestHandoff?: (lead: Lead) => void;
};

export const LeadDetailsDrawer = memo(function LeadDetailsDrawer({
  lead,
  mode,
  onClose,
  onChangeMode,
  onSaveLead,
  onDeleteLead,
  currentUser,
  assignableUsers,
  onTaskChanged,
  onRequestHandoff,
}: LeadDetailsDrawerProps) {
  const [formState, setFormState] = useState<LeadDrawerFormState | null>(lead ? createLeadDrawerFormState(lead) : null);
  const [formErrors, setFormErrors] = useState<LeadDrawerFormErrors>({});
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditError, setAuditError] = useState("");
  const [externalOrigins, setExternalOrigins] = useState<ExternalLeadOrigin[]>([]);
  const [externalOriginsError, setExternalOriginsError] = useState("");
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [noteBody, setNoteBody] = useState("");
  const [noteError, setNoteError] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [tasks, setTasks] = useState<CRMTask[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDueAt, setTaskDueAt] = useState("");
  const [taskType, setTaskType] = useState<TaskType>("follow_up");
  const [taskPriority, setTaskPriority] = useState<TaskPriority>("normal");
  const [taskResponsibleUserId, setTaskResponsibleUserId] = useState(lead?.responsibleUserId || currentUser?.id || "");
  const [taskError, setTaskError] = useState("");
  const [isSavingTask, setIsSavingTask] = useState(false);
  const [taskToComplete, setTaskToComplete] = useState<CRMTask | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);

  const canEditFull = hasPermission(currentUser, "edit_leads_full");
  const canEditSalesFields = hasPermission(currentUser, "edit_lead_sales_fields");
  const canEditLead = canEditFull || canEditSalesFields;
  const canAssignLead = hasPermission(currentUser, "assign_leads");
  const canAddNote = hasPermission(currentUser, "add_lead_note");
  const canDeleteLead = hasPermission(currentUser, "delete_leads");
  const canManageTasks = hasPermission(currentUser, "manage_all_tasks") || hasPermission(currentUser, "manage_own_tasks");
  const canAssignTasks = hasPermission(currentUser, "assign_tasks");
  const canHandoffLead = canAssignLead
    && hasPermission(currentUser, "move_lead_pipeline")
    && canAssignTasks;
  const isEditing = mode === "edit" && canEditLead;

  useEffect(() => {
    setFormState(lead ? createLeadDrawerFormState(lead) : null);
    setFormErrors({});
    setAuditEntries([]);
    setAuditError("");
    setExternalOrigins([]);
    setExternalOriginsError("");
    setNotes([]);
    setNoteBody("");
    setNoteError("");
    setTasks([]);
    setTaskTitle("");
    setTaskDueAt("");
    setTaskType("follow_up");
    setTaskPriority("normal");
    setTaskResponsibleUserId(lead?.responsibleUserId || currentUser?.id || "");
    setTaskError("");
    setTaskToComplete(null);

    if (!lead) return;

    fetchLeadExternalOriginsFromServer(lead.id)
      .then(setExternalOrigins)
      .catch((error) => setExternalOriginsError(error instanceof Error ? error.message : "Não foi possível carregar as origens automáticas."));

    fetchLeadNotesFromServer(lead.id)
      .then(setNotes)
      .catch((error) => setNoteError(error instanceof Error ? error.message : "Não foi possível carregar as notas."));

    fetchTasksFromServer({ bucket: "all", leadId: lead.id, limit: 100 })
      .then(setTasks)
      .catch((error) => setTaskError(error instanceof Error ? error.message : "Não foi possível carregar as tarefas."));

    if (hasPermission(currentUser, "read_audit")) {
      fetchLeadAuditFromServer(lead.id)
        .then(setAuditEntries)
        .catch((error) => setAuditError(error instanceof Error ? error.message : "Não foi possível carregar o histórico."));
    }
  }, [lead, currentUser]);

  useEffect(() => {
    if (!lead) return;
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      drawerRef.current?.querySelector<HTMLElement>(".drawerCloseButton")?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.setTimeout(() => previousActiveElement?.focus(), 0);
    };
  }, [lead?.id]);

  if (!lead || !formState) return null;

  const isLost = formState.isLost || formState.status === "Perdido";
  const intelligenceLead = getLeadWithSyncedAdvertisingFromServices({
    ...lead,
    advertisesOnMeta: formState.advertisesOnMeta,
    advertisesOnGoogle: formState.advertisesOnGoogle,
    doesNotAdvertiseOnMeta: formState.doesNotAdvertiseOnMeta,
    doesNotAdvertiseOnGoogle: formState.doesNotAdvertiseOnGoogle,
    doesNotAdvertise: formState.doesNotAdvertise,
    serviceStatusMap: formState.serviceStatusMap,
    serviceInterests: getServiceInterestsFromStatusMap(formState.serviceStatusMap),
  });

  function updateField<Field extends keyof LeadDrawerFormState>(field: Field, value: LeadDrawerFormState[Field]) {
    setFormState((currentState) => currentState ? { ...currentState, [field]: value } : currentState);
    if (field === "name" || field === "phone") {
      setFormErrors((currentErrors) => ({ ...currentErrors, identity: undefined }));
    } else if (field === "email") {
      setFormErrors((currentErrors) => ({ ...currentErrors, identity: undefined, email: undefined }));
    } else if (field === "lostReason") {
      setFormErrors((currentErrors) => ({ ...currentErrors, lostReason: undefined }));
    }
  }

  function handleStatusChange(status: LeadStatus) {
    setFormState((currentState) => currentState ? {
      ...currentState,
      status,
      isLost: status === "Perdido",
    } : currentState);
    if (status !== "Perdido") setFormErrors((currentErrors) => ({ ...currentErrors, lostReason: undefined }));
  }

  function handleLostChange(checked: boolean) {
    setFormState((currentState) => currentState ? {
      ...currentState,
      isLost: checked,
      status: checked ? "Perdido" : "Novo lead",
      lostReason: checked ? currentState.lostReason : "",
    } : currentState);
    if (!checked) setFormErrors((currentErrors) => ({ ...currentErrors, lostReason: undefined }));
  }

  function updateServiceStatus(service: ServiceInterest, status: ServiceProviderStatus) {
    setFormState((currentState) => currentState ? {
      ...currentState,
      serviceStatusMap: { ...currentState.serviceStatusMap, [service]: status || "Não sabemos" },
    } : currentState);
  }

  function updateCustomField(field: LeadCustomFieldKey, value: string) {
    setFormState((currentState) => currentState ? {
      ...currentState,
      customFields: { ...currentState.customFields, [field]: value },
    } : currentState);
  }

  function handleNoAdsChange(checked: boolean) {
    setFormState((currentState) => currentState ? {
      ...currentState,
      doesNotAdvertise: checked,
      advertisesOnMeta: checked ? false : currentState.advertisesOnMeta,
      advertisesOnGoogle: checked ? false : currentState.advertisesOnGoogle,
      doesNotAdvertiseOnMeta: checked,
      doesNotAdvertiseOnGoogle: checked,
    } : currentState);
  }

  function handlePaidAdsChange(field: "advertisesOnMeta" | "advertisesOnGoogle", checked: boolean) {
    setFormState((currentState) => {
      if (!currentState) return currentState;
      const isMeta = field === "advertisesOnMeta";
      return {
        ...currentState,
        [field]: checked,
        doesNotAdvertiseOnMeta: isMeta && checked ? false : currentState.doesNotAdvertiseOnMeta,
        doesNotAdvertiseOnGoogle: !isMeta && checked ? false : currentState.doesNotAdvertiseOnGoogle,
        doesNotAdvertise: checked ? false : currentState.doesNotAdvertise,
      };
    });
  }

  function handleNegativeAdsChange(field: "doesNotAdvertiseOnMeta" | "doesNotAdvertiseOnGoogle", checked: boolean) {
    setFormState((currentState) => {
      if (!currentState) return currentState;
      const isMeta = field === "doesNotAdvertiseOnMeta";
      const doesNotAdvertiseOnMeta = isMeta ? checked : currentState.doesNotAdvertiseOnMeta;
      const doesNotAdvertiseOnGoogle = isMeta ? currentState.doesNotAdvertiseOnGoogle : checked;
      const advertisesOnMeta = isMeta && checked ? false : currentState.advertisesOnMeta;
      const advertisesOnGoogle = !isMeta && checked ? false : currentState.advertisesOnGoogle;
      return {
        ...currentState,
        [field]: checked,
        advertisesOnMeta,
        advertisesOnGoogle,
        doesNotAdvertise: !advertisesOnMeta && !advertisesOnGoogle && doesNotAdvertiseOnMeta && doesNotAdvertiseOnGoogle,
      };
    });
  }

  function handleSave() {
    if (!lead || !formState || !canEditLead) return;

    const normalizedIsLost = formState.isLost || formState.status === "Perdido";
    const errors = validateLeadDrawerForm(formState, canEditFull);
    setFormErrors(errors);
    if (Object.keys(errors).length) return;

    if (!canEditFull) {
      onSaveLead({
        ...lead,
        email: formState.email.trim(),
        temperature: formState.temperature,
        expectedCloseAt: formState.expectedCloseAt,
      });
      return;
    }

    const serviceInterests = getServiceInterestsFromStatusMap(formState.serviceStatusMap);

    onSaveLead(getLeadWithSyncedAdvertisingFromServices({
      ...lead,
      name: formState.name.trim(),
      email: formState.email.trim(),
      phone: formState.phone.trim(),
      company: formState.company.trim(),
      website: normalizeWebsite(formState.website),
      instagram: formState.instagram.trim(),
      advertisesOnMeta: formState.advertisesOnMeta,
      advertisesOnGoogle: formState.advertisesOnGoogle,
      doesNotAdvertiseOnMeta: formState.doesNotAdvertiseOnMeta,
      doesNotAdvertiseOnGoogle: formState.doesNotAdvertiseOnGoogle,
      doesNotAdvertise: formState.doesNotAdvertise,
      lastContactAt: formState.lastContactAt,
      contactMadeAt: formState.contactMadeAt,
      nextContactAt: formState.nextContactAt,
      expectedCloseAt: formState.expectedCloseAt,
      estimatedBudget: formState.estimatedBudget,
      isLost: normalizedIsLost,
      lostReason: formState.lostReason,
      commercialNotes: formState.commercialNotes.trim(),
      status: normalizedIsLost ? "Perdido" : formState.status,
      responsible: formState.responsible.trim(),
      responsibleUserId: formState.responsibleUserId,
      temperature: formState.temperature,
      pain: formState.pain.trim(),
      source: formState.source,
      serviceInterests,
      serviceStatusMap: formState.serviceStatusMap,
      customFields: normalizeCustomFields(formState.customFields),
    }));
  }

  async function handleAddNote() {
    const normalizedBody = noteBody.trim();
    if (!lead || !canAddNote || !normalizedBody || isSavingNote) return;
    setIsSavingNote(true);
    setNoteError("");
    try {
      const createdNote = await addLeadNoteOnServer(lead.id, normalizedBody);
      setNotes((currentNotes) => [createdNote, ...currentNotes]);
      setNoteBody("");
    } catch (error) {
      setNoteError(error instanceof Error ? error.message : "Não foi possível registrar a nota.");
    } finally {
      setIsSavingNote(false);
    }
  }

  async function handleCreateTask() {
    if (!lead || !canManageTasks || !taskTitle.trim() || !taskDueAt || isSavingTask) return;
    setIsSavingTask(true);
    setTaskError("");
    try {
      const createdTask = await createTaskOnServer({
        title: taskTitle.trim(),
        dueAt: taskDueAt,
        leadId: lead.id,
        responsibleUserId: canAssignTasks ? taskResponsibleUserId : currentUser?.id,
        type: taskType,
        priority: taskPriority,
      });
      setTasks((currentTasks) => [...currentTasks, createdTask].sort((a, b) => a.dueAt.localeCompare(b.dueAt)));
      setTaskTitle("");
      setTaskDueAt("");
      onTaskChanged?.();
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : "Não foi possível criar a tarefa.");
    } finally {
      setIsSavingTask(false);
    }
  }

  async function completeTask(task: CRMTask, payload: TaskCompletionPayload) {
    setIsSavingTask(true);
    setTaskError("");
    try {
      const response = await completeTaskOnServer(task.id, payload);
      setTasks((currentTasks) => {
        const withoutCompleted = currentTasks.map((item) => item.id === task.id ? response.task : item);
        return response.nextTask
          ? [...withoutCompleted, response.nextTask].sort((a, b) => a.dueAt.localeCompare(b.dueAt))
          : withoutCompleted;
      });
      onTaskChanged?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível concluir a tarefa.";
      setTaskError(message);
      throw new Error(message);
    } finally {
      setIsSavingTask(false);
    }
  }

  function handleDrawerKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !taskToComplete) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusableElements = Array.from(
      drawerRef.current?.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE_SELECTOR) || [],
    ).filter((element) => !element.hasAttribute("disabled"));
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

  function handleDelete() {
    if (canDeleteLead && lead) onDeleteLead(lead.id);
  }

  const notesSection = (
    <section className="drawerSection">
      <h3>Notas da negociação</h3>
      {canAddNote ? (
        <div className="drawerNoteComposer">
          <label className="field">
            <span>Nova nota ou observação da reunião</span>
            <textarea
              value={noteBody}
              onChange={(event) => setNoteBody(event.target.value)}
              rows={3}
              maxLength={5000}
              placeholder="Registre contexto, objeções, decisões e próximos passos."
            />
          </label>
          <button className="secondaryButton" type="button" onClick={() => void handleAddNote()} disabled={!noteBody.trim() || isSavingNote}>
            {isSavingNote ? "Salvando..." : "Adicionar nota"}
          </button>
        </div>
      ) : null}
      {noteError ? <p className="formError" role="alert">{noteError}</p> : null}
      {lead.commercialNotes ? <InfoText label="Observação legada" value={lead.commercialNotes} /> : null}
      <div className="auditTimeline">
        {notes.length ? notes.map((note) => (
          <article className="auditItem" key={note.id}>
            <strong>{note.body}</strong>
            <span>{note.createdByName || "Usuário"} • {note.createdAt ? new Date(note.createdAt).toLocaleString("pt-BR") : ""}</span>
          </article>
        )) : <p className="mutedText">Nenhuma nota registrada ainda.</p>}
      </div>
    </section>
  );

  const tasksSection = (
    <section className="drawerSection">
      <h3>Tarefas e próximos passos</h3>
      {canManageTasks ? (
        <div className="drawerTaskComposerV42" role="group" aria-label="Criar tarefa">
          <label className="field"><span>Título</span><input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Ex.: Retornar proposta" required /></label>
          <label className="field"><span>Data e horário <small className="dateFormatHint">Dia/Mês/Ano · Hora</small></span><BrDateInput withTime value={taskDueAt} onChange={setTaskDueAt} required ariaLabel="Data e horário da tarefa" /></label>
          <label className="field"><span>Tipo</span><select value={taskType} onChange={(event) => setTaskType(event.target.value as TaskType)}><option value="follow_up">Follow-up</option><option value="ligacao">Ligação</option><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option><option value="reuniao">Reunião</option><option value="outro">Outro</option></select></label>
          <label className="field"><span>Prioridade</span><select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value as TaskPriority)}><option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></label>
          {canAssignTasks ? <label className="field"><span>Responsável</span><select value={taskResponsibleUserId} onChange={(event) => setTaskResponsibleUserId(event.target.value)} required><option value="">Selecione</option>{assignableUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label> : null}
          <button className="primaryButton" type="button" onClick={() => void handleCreateTask()} disabled={isSavingTask || !taskTitle.trim() || !taskDueAt}>{isSavingTask ? "Salvando..." : "Criar tarefa"}</button>
        </div>
      ) : null}
      {taskError ? <p className="fieldError">{taskError}</p> : null}
      <div className="drawerTaskListV42">
        {tasks.length ? tasks.map((task) => (
          <article className="drawerTaskItemV42" key={task.id}>
            <div><strong>{task.title}</strong><span>{task.responsibleName || "Sem responsável"} • {task.dueAt ? new Date(task.dueAt.length === 10 ? `${task.dueAt}T12:00:00` : task.dueAt).toLocaleString("pt-BR") : "Sem data"}</span>{task.result ? <small>Resultado: {task.result}</small> : null}</div>
            <div><span className={`badge ${task.status === "completed" ? "badgeGreen" : task.priority === "urgente" ? "badgeRed" : task.priority === "alta" ? "badgeYellow" : "badgeBlue"}`}>{task.status === "completed" ? "Concluída" : task.priority}</span>{task.status === "pending" ? <button className="secondaryButton" type="button" onClick={() => setTaskToComplete(task)} disabled={isSavingTask}>Concluir</button> : null}</div>
          </article>
        )) : <p className="mutedText">Nenhuma tarefa registrada para este lead.</p>}
      </div>
    </section>
  );

  return (
    <div className="drawerOverlay" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !taskToComplete) onClose(); }}>
      <aside ref={drawerRef} className="leadDrawer" role="dialog" aria-modal="true" aria-labelledby="lead-drawer-title" tabIndex={-1} onKeyDown={handleDrawerKeyDown}>
        <header className="leadDrawerHeader">
          <div>
            <span className="eyebrow">{isEditing ? (canEditFull ? "Editando lead" : "Atualizando negociação") : "Detalhes do lead"}</span>
            <h2 id="lead-drawer-title">{lead.name || lead.phone || "Lead sem nome"}</h2>
            <p>{lead.company || "Empresa não informada"}</p>
          </div>
          <button className="drawerCloseButton" type="button" onClick={onClose} aria-label="Fechar painel">×</button>
        </header>

        <div className="drawerQuickStats">
          <span className={`badge ${isLost ? "badgeRed" : "badgeBlue"}`}>{isLost ? "Perdido" : formState.status}</span>
          <span className={`badge ${formState.temperature === "Quente" ? "badgeRed" : formState.temperature === "Morno" ? "badgeYellow" : "badgeGray"}`}>
            {formState.temperature || "Temperatura não informada"}
          </span>
          <span className="badge badgeGreen">{formState.responsible || "Sem responsável"}</span>
        </div>

        {canHandoffLead && !lead.responsibleUserId ? (
          <section className="leadHandoffCalloutV44" aria-label="Lead sem consultor">
            <div>
              <span className="eyebrow">Próxima ação recomendada</span>
              <strong>Este lead ainda não está na carteira de um consultor.</strong>
              <p>Encaminhe em um único fluxo: consultor, funil, etapa e primeira tarefa.</p>
            </div>
            <button
              className="primaryButton"
              type="button"
              data-handoff-lead-id={lead.id}
              onClick={() => onRequestHandoff?.(lead)}
            >
              Encaminhar agora
            </button>
          </section>
        ) : null}

        {isEditing ? (
          <form className="drawerEditForm" onSubmit={(event) => event.preventDefault()} noValidate>
            {Object.keys(formErrors).length ? (
              <div className="formValidationSummary" role="alert">
                <strong>Revise os campos destacados.</strong>
                <span>As alterações ainda não foram salvas.</span>
              </div>
            ) : null}
            {canEditFull ? (
              <>
                <section className="drawerSection">
                  <h3>Dados principais</h3>
                  <div className="drawerFormGrid">
                    <label className="field"><span>Nome</span><input type="text" value={formState.name} onChange={(event) => updateField("name", event.target.value)} aria-invalid={Boolean(formErrors.identity)} aria-describedby={formErrors.identity ? "drawer-identity-error" : undefined} /></label>
                    <label className="field"><span>E-mail</span><input type="email" value={formState.email} onChange={(event) => updateField("email", event.target.value)} aria-invalid={Boolean(formErrors.email || formErrors.identity)} aria-describedby={formErrors.email ? "drawer-email-error" : formErrors.identity ? "drawer-identity-error" : undefined} />{formErrors.email ? <small id="drawer-email-error" className="fieldError">{formErrors.email}</small> : null}</label>
                    <label className="field"><span>Telefone</span><input type="tel" value={formState.phone} onChange={(event) => updateField("phone", formatPhone(event.target.value))} aria-invalid={Boolean(formErrors.identity)} aria-describedby={formErrors.identity ? "drawer-identity-error" : undefined} /></label>
                    <label className="field"><span>Empresa</span><input type="text" value={formState.company} onChange={(event) => updateField("company", event.target.value)} /></label>
                    <label className="field"><span>Website</span><input type="text" value={formState.website} onChange={(event) => updateField("website", event.target.value)} /></label>
                    <label className="field"><span>Instagram</span><input type="text" value={formState.instagram} onChange={(event) => updateField("instagram", event.target.value)} placeholder="@empresa ou instagram.com/empresa" /></label>
                  </div>
                  {formErrors.identity ? <p id="drawer-identity-error" className="fieldError" role="alert">{formErrors.identity}</p> : null}
                </section>

                <ExternalOriginsSection origins={externalOrigins} error={externalOriginsError} />

                <section className="drawerSection">
                  <h3>Informações complementares</h3>
                  <div className="drawerFormGrid">
                    <label className="field"><span>Status</span><select value={formState.status} onChange={(event) => handleStatusChange(event.target.value as LeadStatus)}>{leadStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
                    {canAssignLead ? (
                      <div className="field leadAssignmentReadOnly">
                        <span>Responsável</span>
                        <strong>{formState.responsible || "Sem responsável"}</strong>
                        <small>Para atribuir ou trocar o consultor, use “Encaminhar para consultor”.</small>
                      </div>
                    ) : null}
                    <div className="field leadAssignmentReadOnly">
                      <span>SDR RESPONSÁVEL</span>
                      <strong>{lead.sdrResponsible || "A preencher automaticamente"}</strong>
                      <small>Registro automático e permanente do SDR que originou o atendimento.</small>
                    </div>
                    <label className="field"><span>Temperatura</span><select value={formState.temperature} onChange={(event) => updateField("temperature", event.target.value as LeadTemperature)}>{leadTemperatureOptions.map((temperature) => <option key={temperature || "empty"} value={temperature}>{temperature || "Selecione"}</option>)}</select></label>
                    <label className="field"><span>Origem</span><select value={formState.source} onChange={(event) => updateField("source", event.target.value as LeadSource)}>{leadSourceOptions.map((source) => <option key={source || "empty"} value={source}>{source || "Selecione"}</option>)}</select></label>
                    {currentUser?.role !== "pre_venda" ? <label className="field"><span>Fechamento previsto <small className="dateFormatHint">Dia/Mês/Ano · Hora</small></span><BrDateInput withTime value={toDateTimeLocalInput(formState.expectedCloseAt)} onChange={(value) => updateField("expectedCloseAt", fromDateTimeLocalInput(value))} ariaLabel="Fechamento previsto" /></label> : null}
                    <div className="drawerFullField drawerServicesEdit">
                      <span className="fieldTitle">Mapeamento dos serviços</span>
                      <div className="serviceStatusGrid drawerServiceStatusGrid">
                        {serviceOptions.map((service) => (
                          <label className="serviceStatusCard" key={service}><span>{service}</span><select value={formState.serviceStatusMap[service] || "Não sabemos"} onChange={(event) => updateServiceStatus(service, event.target.value as ServiceProviderStatus)}>{serviceProviderStatusOptions.map((status) => <option key={status} value={status}>{status === "Não sabemos" ? "Desconhecido" : status}</option>)}</select></label>
                        ))}
                      </div>
                      <ClientIntelligencePanel lead={intelligenceLead} />
                      <CommercialRecommendationPanel lead={intelligenceLead} />
                    </div>
                    <label className="field drawerFullField"><span>Dor do lead</span><textarea value={formState.pain} onChange={(event) => updateField("pain", event.target.value)} rows={3} /></label>
                    <label className="field drawerFullField"><span>Observação comercial legada</span><textarea value={formState.commercialNotes} onChange={(event) => updateField("commercialNotes", event.target.value)} rows={3} /></label>
                  </div>
                </section>

                <section className="drawerSection">
                  <h3>Datas e orçamento</h3>
                  <div className="drawerFormGrid">
                    <label className="field"><span>Último contato em <small className="dateFormatHint">Dia/Mês/Ano</small></span><BrDateInput value={formState.lastContactAt} onChange={(value) => updateField("lastContactAt", value)} ariaLabel="Último contato em" /></label>
                    <label className="field"><span>Contato feito em <small className="dateFormatHint">Dia/Mês/Ano</small></span><BrDateInput value={formState.contactMadeAt} onChange={(value) => updateField("contactMadeAt", value)} ariaLabel="Contato feito em" /></label>
                    <label className="field"><span>Próximo contato em <small className="dateFormatHint">Dia/Mês/Ano</small></span><BrDateInput value={formState.nextContactAt} onChange={(value) => updateField("nextContactAt", value)} ariaLabel="Próximo contato em" /></label>
                    <label className="field"><span>Orçamento estimado</span><input type="text" inputMode="numeric" value={formState.estimatedBudget} onChange={(event) => updateField("estimatedBudget", formatCurrencyBRL(event.target.value))} /></label>
                  </div>
                </section>

                <section className="drawerSection">
                  <h3>Campos adicionais da planilha</h3>
                  <div className="drawerFormGrid">{spreadsheetCustomFieldLabels.map((field) => <label className="field" key={field}><span>{field}</span><input type="text" value={formState.customFields[field] || ""} onChange={(event) => updateCustomField(field, event.target.value)} /></label>)}</div>
                </section>

                <section className="drawerSection">
                  <h3>Mídia e perda</h3>
                  <div className="drawerChecksGrid">
                    <label className="checkCard"><input type="checkbox" checked={formState.advertisesOnMeta} onChange={(event) => handlePaidAdsChange("advertisesOnMeta", event.target.checked)} />Anuncia na Meta</label>
                    <label className="checkCard"><input type="checkbox" checked={formState.advertisesOnGoogle} onChange={(event) => handlePaidAdsChange("advertisesOnGoogle", event.target.checked)} />Anuncia no Google</label>
                    <label className="checkCard"><input type="checkbox" checked={formState.doesNotAdvertiseOnMeta} onChange={(event) => handleNegativeAdsChange("doesNotAdvertiseOnMeta", event.target.checked)} />Não anuncia na Meta</label>
                    <label className="checkCard"><input type="checkbox" checked={formState.doesNotAdvertiseOnGoogle} onChange={(event) => handleNegativeAdsChange("doesNotAdvertiseOnGoogle", event.target.checked)} />Não anuncia no Google</label>
                    <label className="checkCard"><input type="checkbox" checked={formState.doesNotAdvertise} onChange={(event) => handleNoAdsChange(event.target.checked)} />Não anuncia</label>
                    <label className="checkCard drawerDangerCheck"><input type="checkbox" checked={formState.isLost} onChange={(event) => handleLostChange(event.target.checked)} />Marcar como perdido</label>
                  </div>
                  <label className="field"><span>Motivo da perda</span><select value={formState.lostReason} onChange={(event) => updateField("lostReason", event.target.value as LostReason)} aria-invalid={Boolean(formErrors.lostReason)} aria-describedby={formErrors.lostReason ? "drawer-lost-reason-error" : undefined}>{leadLostReasonOptions.map((reason) => <option key={reason || "empty"} value={reason}>{reason || "Selecione"}</option>)}</select>{formErrors.lostReason ? <small id="drawer-lost-reason-error" className="fieldError">{formErrors.lostReason}</small> : null}</label>
                </section>
              </>
            ) : (
              <section className="drawerSection">
                <h3>Campos permitidos ao consultor</h3>
                <p className="mutedText">Você pode atualizar somente e-mail, termômetro e data prevista de fechamento. Etapas são movimentadas no Kanban do próprio funil.</p>
                <div className="drawerFormGrid">
                  <label className="field"><span>E-mail</span><input type="email" value={formState.email} onChange={(event) => updateField("email", event.target.value)} aria-invalid={Boolean(formErrors.email)} aria-describedby={formErrors.email ? "drawer-email-error" : undefined} />{formErrors.email ? <small id="drawer-email-error" className="fieldError">{formErrors.email}</small> : null}</label>
                  <label className="field"><span>Temperatura</span><select value={formState.temperature} onChange={(event) => updateField("temperature", event.target.value as LeadTemperature)}>{leadTemperatureOptions.map((temperature) => <option key={temperature || "empty"} value={temperature}>{temperature || "Selecione"}</option>)}</select></label>
                  <label className="field"><span>Fechamento previsto <small className="dateFormatHint">Dia/Mês/Ano · Hora</small></span><BrDateInput withTime value={toDateTimeLocalInput(formState.expectedCloseAt)} onChange={(value) => updateField("expectedCloseAt", fromDateTimeLocalInput(value))} ariaLabel="Fechamento previsto" /></label>
                </div>
              </section>
            )}
            {tasksSection}
            {notesSection}
          </form>
        ) : (
          <div className="drawerViewContent">
            <section className="drawerSection">
              <h3>Dados principais</h3>
              <div className="drawerInfoGrid">
                <InfoItem label="Nome" value={lead.name} /><InfoItem label="E-mail" value={lead.email} /><InfoItem label="Telefone" value={lead.phone} /><InfoItem label="Empresa" value={lead.company} /><InfoItem label="Website" value={lead.website} /><InfoItem label="Instagram" value={lead.instagram || ""} /><InfoItem label="Origem" value={lead.source} />
              </div>
            </section>
            <ExternalOriginsSection origins={externalOrigins} error={externalOriginsError} />
            <section className="drawerSection">
              <h3>Informações complementares</h3>
              <div className="drawerInfoGrid">
                <InfoItem label="Status" value={lead.status} /><InfoItem label="Responsável" value={lead.responsible} /><InfoItem label="SDR RESPONSÁVEL" value={lead.sdrResponsible} /><InfoItem label="Temperatura" value={lead.temperature} /><InfoItem label="Orçamento estimado" value={lead.estimatedBudget} />{currentUser?.role !== "pre_venda" ? <InfoItem label="Fechamento previsto" value={formatDate(lead.expectedCloseAt)} /> : null}
              </div>
              <ClientIntelligencePanel lead={intelligenceLead} />
              <CommercialRecommendationPanel lead={intelligenceLead} />
              <ServiceStatusList serviceStatusMap={formState.serviceStatusMap} />
              <InfoText label="Dor do lead" value={lead.pain} />
            </section>
            {tasksSection}
            {notesSection}
            <section className="drawerSection"><h3>Datas</h3><div className="drawerInfoGrid"><InfoItem label="Último contato em" value={formatDate(lead.lastContactAt)} /><InfoItem label="Contato feito em" value={formatDate(lead.contactMadeAt)} /><InfoItem label="Próximo contato em" value={formatDate(lead.nextContactAt)} /><InfoItem label="Criado em" value={lead.createdAt ? new Date(lead.createdAt).toLocaleDateString("pt-BR") : ""} /></div></section>
            <section className="drawerSection"><h3>Campos adicionais da planilha</h3><div className="drawerInfoGrid">{spreadsheetCustomFieldLabels.map((field) => <InfoItem key={field} label={field} value={lead.customFields?.[field] || ""} />)}</div></section>
            <section className="drawerSection"><h3>Mídia e perda</h3><div className="drawerInfoGrid"><InfoItem label="Anuncia na Meta" value={intelligenceLead.advertisesOnMeta ? "Sim" : "Não"} /><InfoItem label="Anuncia no Google" value={intelligenceLead.advertisesOnGoogle ? "Sim" : "Não"} /><InfoItem label="Não anuncia na Meta" value={intelligenceLead.doesNotAdvertiseOnMeta ? "Sim" : "Não"} /><InfoItem label="Não anuncia no Google" value={intelligenceLead.doesNotAdvertiseOnGoogle ? "Sim" : "Não"} /><InfoItem label="Não anuncia" value={intelligenceLead.doesNotAdvertise ? "Sim" : "Não"} /><InfoItem label="Motivo da perda" value={lead.lostReason} /></div></section>
            {hasPermission(currentUser, "read_audit") ? (
              <section className="drawerSection auditDrawerSection"><h3>Histórico de alterações</h3>{auditError ? <p className="mutedText">{auditError}</p> : null}<div className="auditTimeline">{auditEntries.length ? auditEntries.slice(0, 12).map((entry) => <article className="auditItem" key={entry.id}><strong>{entry.summary || entry.action}</strong><span>{entry.actorName} • {entry.createdAt ? new Date(entry.createdAt).toLocaleString("pt-BR") : ""}</span></article>) : <p className="mutedText">Nenhum histórico registrado ainda para este lead.</p>}</div></section>
            ) : null}
          </div>
        )}

        <footer className="leadDrawerFooter">
          {isEditing ? (
            <><button className="secondaryButton" type="button" onClick={() => onChangeMode("view")}>Cancelar</button><button className="primaryButton" type="button" onClick={handleSave}>Salvar alterações</button></>
          ) : (
            <>
              <LeadContactMenu
                lead={lead}
                onEditLead={canEditLead ? () => onChangeMode("edit") : undefined}
                className="secondaryButton drawerActionButtonV5"
                label="Contatar"
              />
              {canEditLead ? <button className="secondaryButton" type="button" onClick={() => onChangeMode("edit")}>Editar</button> : null}
              {canHandoffLead ? (
                <button
                  className="primaryButton"
                  type="button"
                  data-handoff-lead-id={lead.id}
                  onClick={() => onRequestHandoff?.(lead)}
                >
                  Encaminhar
                </button>
              ) : null}
              <LeadOverflowMenu
                lead={lead}
                includeOpen={false}
                includeEdit={false}
                includeScript={currentUser?.role !== "consultor_vendas"}
                onDeleteLead={canDeleteLead ? () => handleDelete() : undefined}
                triggerLabel="Mais ações"
                triggerClassName="secondaryButton actionMenuTextTrigger drawerActionButtonV5"
              />
            </>
          )}
        </footer>
      </aside>

      <TaskCompletionDialog
        task={taskToComplete}
        onClose={() => setTaskToComplete(null)}
        onComplete={(payload) => taskToComplete ? completeTask(taskToComplete, payload) : Promise.resolve()}
      />
    </div>
  );
});
