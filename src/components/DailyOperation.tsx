import { memo, useEffect, useMemo, useState } from "react";
import type { CRMTask, CRMUser, Lead, TaskPriority, TaskType, TodayDashboard } from "../types/Lead";
import {
  completeTaskOnServer,
  createTaskOnServer,
  fetchTodayDashboardFromServer,
  hasPermission,
} from "../utils/api";
import { formatDate } from "../utils/formatters";
import { TaskCompletionDialog, type TaskCompletionPayload } from "./TaskCompletionDialog";

const taskTypeLabels: Record<TaskType, string> = {
  ligacao: "Ligação",
  whatsapp: "WhatsApp",
  email: "E-mail",
  reuniao: "Reunião",
  follow_up: "Follow-up",
  outro: "Outro",
};

const priorityLabels: Record<TaskPriority, string> = {
  baixa: "Baixa",
  normal: "Normal",
  alta: "Alta",
  urgente: "Urgente",
};

type DailyOperationProps = {
  leads: Lead[];
  currentUser: CRMUser | null;
  assignableUsers: CRMUser[];
  onViewLead: (leadId: string) => void;
  onDataChanged?: () => void;
};

function formatTaskDate(value: string) {
  if (!value) return "Sem data";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return formatDate(value);
  return date.toLocaleString("pt-BR", value.length === 10 ? { dateStyle: "short" } : { dateStyle: "short", timeStyle: "short" });
}

function getTaskTone(priority: TaskPriority) {
  if (priority === "urgente") return "badgeRed";
  if (priority === "alta") return "badgeYellow";
  if (priority === "baixa") return "badgeBlue";
  return "badgeGreen";
}

export const DailyOperation = memo(function DailyOperation({ leads, currentUser, assignableUsers, onViewLead, onDataChanged }: DailyOperationProps) {
  const [dashboard, setDashboard] = useState<TodayDashboard | null>(null);
  const [activeBucket, setActiveBucket] = useState<"overdue" | "today" | "upcoming">("today");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [taskLeadId, setTaskLeadId] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDueAt, setTaskDueAt] = useState("");
  const [taskType, setTaskType] = useState<TaskType>("follow_up");
  const [taskPriority, setTaskPriority] = useState<TaskPriority>("normal");
  const [taskResponsibleUserId, setTaskResponsibleUserId] = useState(currentUser?.id || "");
  const [taskToComplete, setTaskToComplete] = useState<CRMTask | null>(null);

  const canManageTasks = hasPermission(currentUser, "manage_all_tasks") || hasPermission(currentUser, "manage_own_tasks");
  const canAssignTasks = hasPermission(currentUser, "assign_tasks");

  async function refreshDashboard() {
    setIsLoading(true);
    setError("");
    try {
      setDashboard(await fetchTodayDashboardFromServer());
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível carregar a rotina de hoje.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refreshDashboard();
  }, [currentUser?.id]);

  useEffect(() => {
    setTaskResponsibleUserId(currentUser?.id || "");
  }, [currentUser?.id]);

  const visibleTasks = dashboard?.tasks[activeBucket] || [];
  const nextAction = useMemo(() => dashboard?.tasks.overdue[0] || dashboard?.tasks.today[0] || dashboard?.tasks.upcoming[0] || null, [dashboard]);

  async function completeTask(task: CRMTask, payload: TaskCompletionPayload) {
    setIsSaving(true);
    setError("");
    try {
      await completeTaskOnServer(task.id, payload);
      await refreshDashboard();
      onDataChanged?.();
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Não foi possível concluir a tarefa.";
      setError(message);
      throw new Error(message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateTask(event: React.FormEvent) {
    event.preventDefault();
    if (!taskTitle.trim() || !taskDueAt || !taskLeadId) return;
    setIsSaving(true);
    setError("");
    try {
      await createTaskOnServer({
        title: taskTitle.trim(),
        dueAt: taskDueAt,
        leadId: taskLeadId,
        responsibleUserId: canAssignTasks ? taskResponsibleUserId : currentUser?.id,
        type: taskType,
        priority: taskPriority,
      });
      setTaskTitle("");
      setTaskDueAt("");
      setTaskLeadId("");
      await refreshDashboard();
      onDataChanged?.();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível criar a tarefa.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading && !dashboard) {
    return <section className="panel loadingPanel"><span className="eyebrow">Rotina comercial</span><h2>Carregando tarefas e prioridades</h2></section>;
  }

  return (
    <section className="operationWorkspace operationWorkspaceV42">
      <div className="operationScopeBar" role="status" aria-live="polite">
        <strong>Tela Hoje: {dashboard?.roleLabel || "Usuário"}</strong>
        <span>{dashboard?.scope.label || "Carteira autorizada"}</span>
        {dashboard?.generatedAt ? <small>Atualizado em {new Date(dashboard.generatedAt).toLocaleString("pt-BR")}</small> : null}
        <button className="secondaryButton" type="button" onClick={() => void refreshDashboard()} disabled={isLoading}>Atualizar</button>
      </div>

      {error ? <div className="systemNotice" role="alert"><strong>Não foi possível concluir a ação.</strong><span>{error}</span></div> : null}

      {nextAction ? (
        <section className="panel nextActionPanelV42">
          <div className="sectionTitleRow">
            <div><span className="eyebrow">Próxima ação</span><h2>{nextAction.title}</h2><p>{nextAction.leadName || nextAction.leadCompany || "Tarefa sem lead"} • {formatTaskDate(nextAction.dueAt)}</p></div>
            <span className={`badge ${getTaskTone(nextAction.priority)}`}>{priorityLabels[nextAction.priority]}</span>
          </div>
          <div className="nextActionButtonsV39">
            {nextAction.leadId ? <button className="secondaryButton" type="button" onClick={() => onViewLead(nextAction.leadId)}>Abrir lead</button> : null}
            <button className="primaryButton" type="button" onClick={() => setTaskToComplete(nextAction)} disabled={isSaving}>Concluir tarefa</button>
          </div>
        </section>
      ) : <section className="panel"><h2>Nenhuma tarefa pendente</h2><p>A fila operacional está limpa no seu escopo.</p></section>}

      <div className="operationStatsRail operationStatsRailV42">
        <article><span>Tarefas atrasadas</span><strong>{dashboard?.taskSummary.overdue || 0}</strong></article>
        <article><span>Tarefas de hoje</span><strong>{dashboard?.taskSummary.today || 0}</strong></article>
        <article><span>Reuniões hoje</span><strong>{dashboard?.taskSummary.meetingsToday || 0}</strong></article>
        <article><span>Concluídas hoje</span><strong>{dashboard?.taskSummary.completedToday || 0}</strong></article>
        <article><span>Próximas</span><strong>{dashboard?.taskSummary.upcoming || 0}</strong></article>
      </div>

      <div className="operationRoleGridV42">
        <section className="panel">
          <div className="sectionTitleRow"><div><span className="eyebrow">Execução</span><h2>Fila de tarefas</h2></div></div>
          <div className="operationBucketTabsV42" role="tablist" aria-label="Filas de tarefas">
            <button type="button" className={activeBucket === "overdue" ? "active" : ""} onClick={() => setActiveBucket("overdue")}>Atrasadas ({dashboard?.taskSummary.overdue || 0})</button>
            <button type="button" className={activeBucket === "today" ? "active" : ""} onClick={() => setActiveBucket("today")}>Hoje ({dashboard?.taskSummary.today || 0})</button>
            <button type="button" className={activeBucket === "upcoming" ? "active" : ""} onClick={() => setActiveBucket("upcoming")}>Próximas ({dashboard?.taskSummary.upcoming || 0})</button>
          </div>
          <div className="taskQueueV42">
            {visibleTasks.length ? visibleTasks.map((task) => (
              <article className="taskCardV42" key={task.id}>
                <div><strong>{task.title}</strong><span>{taskTypeLabels[task.type]} • {task.responsibleName || "Sem responsável"}</span><small>{task.leadName || task.leadCompany || task.leadPhone || "Sem lead"} • {formatTaskDate(task.dueAt)}</small></div>
                <div className="taskCardActionsV42"><span className={`badge ${getTaskTone(task.priority)}`}>{priorityLabels[task.priority]}</span>{task.leadId ? <button className="secondaryButton" type="button" onClick={() => onViewLead(task.leadId)}>Abrir lead</button> : null}<button className="primaryButton" type="button" onClick={() => setTaskToComplete(task)} disabled={isSaving}>Concluir</button></div>
              </article>
            )) : <div className="operationEmptyCompact"><strong>Nenhuma tarefa nesta fila.</strong></div>}
          </div>
        </section>

        <aside className="operationSideStackV42">
          <section className="panel">
            <span className="eyebrow">Indicadores do papel</span>
            <h2>{dashboard?.role === "consultor_vendas" ? "Minha carteira" : dashboard?.role === "pre_venda" ? "Operação de pré-venda" : "Saúde da operação"}</h2>
            <div className="roleMetricsListV42">
              <div><span>Aguardando primeiro contato</span><strong>{dashboard?.roleMetrics.awaitingFirstContact || 0}</strong></div>
              <div><span>Sem responsável</span><strong>{dashboard?.roleMetrics.withoutOwner || 0}</strong></div>
              <div><span>Sem próximo passo</span><strong>{dashboard?.roleMetrics.withoutNextStep || 0}</strong></div>
              <div><span>Parados há mais de 7 dias</span><strong>{dashboard?.roleMetrics.stalled || 0}</strong></div>
            </div>
          </section>

          {dashboard?.teamOverdue?.length ? <section className="panel"><span className="eyebrow">Equipe</span><h2>Atrasos por responsável</h2><div className="roleMetricsListV42">{dashboard.teamOverdue.map((item) => <div key={item.responsibleName}><span>{item.responsibleName}</span><strong>{item.total}</strong></div>)}</div></section> : null}

          {dashboard?.systemHealth ? <section className="panel"><span className="eyebrow">Administração</span><h2>Alertas operacionais</h2><div className="roleMetricsListV42"><div><span>Usuários ativos</span><strong>{dashboard.systemHealth.activeUsers}</strong></div><div><span>Falhas de integração</span><strong>{dashboard.systemHealth.failedIntegrations}</strong></div><div><span>Último backup</span><strong>{dashboard.systemHealth.latestBackupAt ? new Date(dashboard.systemHealth.latestBackupAt).toLocaleDateString("pt-BR") : "Não encontrado"}</strong></div></div></section> : null}
        </aside>
      </div>

      {canManageTasks ? (
        <section className="panel taskComposerPanelV42">
          <div className="sectionTitleRow"><div><span className="eyebrow">Nova tarefa</span><h2>Agendar próximo passo</h2><p>A tarefa fica vinculada ao lead e aparece na Tela Hoje do responsável.</p></div></div>
          <form className="taskComposerGridV42" onSubmit={handleCreateTask}>
            <label className="field"><span>Lead</span><select value={taskLeadId} onChange={(event) => setTaskLeadId(event.target.value)} required><option value="">Selecione</option>{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.name || lead.company || lead.phone || "Lead sem nome"}</option>)}</select></label>
            <label className="field"><span>Título</span><input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Ex.: Retornar proposta" required /></label>
            <label className="field"><span>Data e horário</span><input type="datetime-local" value={taskDueAt} onChange={(event) => setTaskDueAt(event.target.value)} required /></label>
            <label className="field"><span>Tipo</span><select value={taskType} onChange={(event) => setTaskType(event.target.value as TaskType)}>{Object.entries(taskTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="field"><span>Prioridade</span><select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value as TaskPriority)}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            {canAssignTasks ? <label className="field"><span>Responsável</span><select value={taskResponsibleUserId} onChange={(event) => setTaskResponsibleUserId(event.target.value)} required><option value="">Selecione</option>{assignableUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label> : null}
            <button className="primaryButton" type="submit" disabled={isSaving || !taskLeadId || !taskTitle.trim() || !taskDueAt}>{isSaving ? "Salvando..." : "Criar tarefa"}</button>
          </form>
        </section>
      ) : null}

      <TaskCompletionDialog
        task={taskToComplete}
        onClose={() => setTaskToComplete(null)}
        onComplete={(payload) => taskToComplete ? completeTask(taskToComplete, payload) : Promise.resolve()}
      />
    </section>
  );
});
