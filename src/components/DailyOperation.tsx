import { memo, useEffect, useMemo, useState } from "react";
import type { CRMTask, CRMUser, Lead, TaskPriority, TaskType, TodayDashboard } from "../types/Lead";
import {
  completeTaskOnServer,
  fetchTasksFromServer,
  fetchTodayDashboardFromServer,
  fetchUsersFromServer,
} from "../utils/api";
import { formatDate } from "../utils/formatters";
import { BrDateInput } from "./BrDateInput";
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

type AdminDateMode = "default" | "until" | "between" | "exact";

type DailyOperationProps = {
  leads: Lead[];
  currentUser: CRMUser | null;
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

export const DailyOperation = memo(function DailyOperation({ currentUser, onViewLead, onDataChanged }: DailyOperationProps) {
  const [dashboard, setDashboard] = useState<TodayDashboard | null>(null);
  const [activeBucket, setActiveBucket] = useState<"overdue" | "today" | "upcoming">("today");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [taskToComplete, setTaskToComplete] = useState<CRMTask | null>(null);

  const [adminUsers, setAdminUsers] = useState<CRMUser[]>([]);
  const [adminResponsibleUserId, setAdminResponsibleUserId] = useState("");
  const [adminDateMode, setAdminDateMode] = useState<AdminDateMode>("default");
  const [adminDateFrom, setAdminDateFrom] = useState("");
  const [adminDateTo, setAdminDateTo] = useState("");
  const [filteredTasks, setFilteredTasks] = useState<CRMTask[]>([]);
  const [isFiltering, setIsFiltering] = useState(false);
  const [filterError, setFilterError] = useState("");

  const isAdmin = currentUser?.role === "admin";
  const hasCustomDateFilter = isAdmin && adminDateMode !== "default";
  const customFilterReady = !hasCustomDateFilter
    || (adminDateMode === "exact" && Boolean(adminDateFrom))
    || (adminDateMode === "until" && Boolean(adminDateTo))
    || (adminDateMode === "between" && Boolean(adminDateFrom) && Boolean(adminDateTo));

  async function refreshDashboard() {
    setIsLoading(true);
    setError("");
    try {
      setDashboard(await fetchTodayDashboardFromServer({
        responsibleUserId: isAdmin && adminResponsibleUserId ? adminResponsibleUserId : undefined,
      }));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível carregar a rotina de hoje.");
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshAdminFilteredTasks() {
    if (adminDateMode === "default" || !customFilterReady) {
      setFilteredTasks([]);
      setFilterError("");
      return;
    }

    setIsFiltering(true);
    setFilterError("");
    try {
      const tasks = await fetchTasksFromServer({
        bucket: "all",
        limit: 200,
        responsibleUserId: adminResponsibleUserId || undefined,
        dateMode: adminDateMode,
        dateFrom: adminDateMode === "exact" || adminDateMode === "between" ? adminDateFrom : undefined,
        dateTo: adminDateMode === "until" || adminDateMode === "between" ? adminDateTo : undefined,
      });
      setFilteredTasks(tasks);
    } catch (caughtError) {
      setFilteredTasks([]);
      setFilterError(caughtError instanceof Error ? caughtError.message : "Não foi possível aplicar o filtro de tarefas.");
    } finally {
      setIsFiltering(false);
    }
  }

  useEffect(() => {
    void refreshDashboard();
  }, [currentUser?.id, adminResponsibleUserId]);

  useEffect(() => {
    if (!isAdmin) {
      setAdminUsers([]);
      setAdminResponsibleUserId("");
      setAdminDateMode("default");
      setAdminDateFrom("");
      setAdminDateTo("");
      setFilteredTasks([]);
      return;
    }

    fetchUsersFromServer()
      .then((users) => setAdminUsers(users.filter((user) => user.isActive)))
      .catch(() => setAdminUsers([]));
  }, [currentUser?.id, isAdmin]);

  useEffect(() => {
    void refreshAdminFilteredTasks();
  }, [adminResponsibleUserId, adminDateMode, adminDateFrom, adminDateTo, currentUser?.id]);

  const visibleTasks = hasCustomDateFilter ? filteredTasks : dashboard?.tasks[activeBucket] || [];
  const nextAction = useMemo(() => {
    if (hasCustomDateFilter) return customFilterReady ? filteredTasks[0] || null : null;
    return dashboard?.tasks.overdue[0] || dashboard?.tasks.today[0] || dashboard?.tasks.upcoming[0] || null;
  }, [customFilterReady, dashboard, filteredTasks, hasCustomDateFilter]);

  async function completeTask(task: CRMTask, payload: TaskCompletionPayload) {
    setIsSaving(true);
    setError("");
    try {
      await completeTaskOnServer(task.id, payload);
      await refreshDashboard();
      if (hasCustomDateFilter) await refreshAdminFilteredTasks();
      onDataChanged?.();
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Não foi possível concluir a tarefa.";
      setError(message);
      throw new Error(message);
    } finally {
      setIsSaving(false);
    }
  }

  function resetAdminDateFilter() {
    setAdminDateMode("default");
    setAdminDateFrom("");
    setAdminDateTo("");
    setFilterError("");
    setFilteredTasks([]);
  }

  if (isLoading && !dashboard) {
    return <section className="panel loadingPanel"><span className="eyebrow">Rotina comercial</span><h2>Carregando tarefas e prioridades</h2></section>;
  }

  return (
    <section className="operationWorkspace operationWorkspaceV42">
      <div className="operationScopeBar" role="status" aria-live="polite">
        <strong>Tela Hoje: {dashboard?.roleLabel || "Usuário"}</strong>
        {isAdmin && adminResponsibleUserId ? <span>• usuário filtrado</span> : null}
        {dashboard?.generatedAt ? <small>Atualizado em {new Date(dashboard.generatedAt).toLocaleString("pt-BR")}</small> : null}
        <button className="secondaryButton" type="button" onClick={() => { void refreshDashboard(); if (hasCustomDateFilter) void refreshAdminFilteredTasks(); }} disabled={isLoading || isFiltering}>Atualizar</button>
      </div>

      {error ? <div className="systemNotice" role="alert"><strong>Não foi possível concluir a ação.</strong><span>{error}</span></div> : null}

      {isAdmin ? (
        <section className="panel" aria-label="Filtros administrativos de tarefas">
          <div className="sectionTitleRow">
            <div><span className="eyebrow">Visão administrativa</span><h2>Tarefas de toda a equipe</h2><p>Veja todo mundo ou uma pessoa específica e aplique um período exato.</p></div>
            {adminDateMode !== "default" ? <button className="secondaryButton" type="button" onClick={resetAdminDateFilter}>Limpar período</button> : null}
          </div>
          <div className="drawerFormGrid">
            <label className="field">
              <span>Responsável</span>
              <select value={adminResponsibleUserId} onChange={(event) => setAdminResponsibleUserId(event.target.value)}>
                <option value="">Todo mundo</option>
                {adminUsers.map((user) => <option key={user.id} value={user.id}>{user.name || user.email} • {user.roleLabel || user.role}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Filtro de data</span>
              <select value={adminDateMode} onChange={(event) => setAdminDateMode(event.target.value as AdminDateMode)}>
                <option value="default">Visão padrão da Tela Hoje</option>
                <option value="until">Até uma data</option>
                <option value="between">Entre duas datas</option>
                <option value="exact">Data exata</option>
              </select>
            </label>
            {adminDateMode === "until" ? (
              <label className="field"><span>Até</span><BrDateInput value={adminDateTo} onChange={setAdminDateTo} ariaLabel="Tarefas até a data" /></label>
            ) : null}
            {adminDateMode === "exact" ? (
              <label className="field"><span>Data exata</span><BrDateInput value={adminDateFrom} onChange={setAdminDateFrom} ariaLabel="Data exata das tarefas" /></label>
            ) : null}
            {adminDateMode === "between" ? (
              <>
                <label className="field"><span>De</span><BrDateInput value={adminDateFrom} onChange={setAdminDateFrom} ariaLabel="Tarefas a partir da data" /></label>
                <label className="field"><span>Até</span><BrDateInput value={adminDateTo} onChange={setAdminDateTo} ariaLabel="Tarefas até a data" /></label>
              </>
            ) : null}
          </div>
          {filterError ? <p className="fieldError" role="alert">{filterError}</p> : null}
        </section>
      ) : null}

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
      ) : hasCustomDateFilter && !customFilterReady ? (
        <section className="panel"><h2>Defina a data do filtro</h2><p>Preencha o período acima para carregar as tarefas.</p></section>
      ) : <section className="panel"><h2>Nenhuma tarefa pendente</h2><p>A fila operacional está limpa no escopo selecionado.</p></section>}

      <div className="operationStatsRail operationStatsRailV42">
        <article><span>Tarefas atrasadas</span><strong>{dashboard?.taskSummary.overdue || 0}</strong></article>
        <article><span>Tarefas de hoje</span><strong>{dashboard?.taskSummary.today || 0}</strong></article>
        <article><span>Reuniões hoje</span><strong>{dashboard?.taskSummary.meetingsToday || 0}</strong></article>
        <article><span>Concluídas hoje</span><strong>{dashboard?.taskSummary.completedToday || 0}</strong></article>
        <article><span>Próximas</span><strong>{dashboard?.taskSummary.upcoming || 0}</strong></article>
      </div>

      <div className="operationRoleGridV42">
        <section className="panel">
          <div className="sectionTitleRow">
            <div>
              <span className="eyebrow">Execução</span>
              <h2>{hasCustomDateFilter ? `Tarefas filtradas (${filteredTasks.length})` : "Fila de tarefas"}</h2>
            </div>
          </div>
          {!hasCustomDateFilter ? (
            <div className="operationBucketTabsV42" role="tablist" aria-label="Filas de tarefas">
              <button type="button" className={activeBucket === "overdue" ? "active" : ""} onClick={() => setActiveBucket("overdue")}>Atrasadas ({dashboard?.taskSummary.overdue || 0})</button>
              <button type="button" className={activeBucket === "today" ? "active" : ""} onClick={() => setActiveBucket("today")}>Hoje ({dashboard?.taskSummary.today || 0})</button>
              <button type="button" className={activeBucket === "upcoming" ? "active" : ""} onClick={() => setActiveBucket("upcoming")}>Próximas ({dashboard?.taskSummary.upcoming || 0})</button>
            </div>
          ) : null}
          <div className="taskQueueV42">
            {isFiltering ? <div className="operationEmptyCompact"><strong>Carregando tarefas filtradas...</strong></div> : visibleTasks.length ? visibleTasks.map((task) => (
              <article className="taskCardV42" key={task.id}>
                <div><strong>{task.title}</strong><span>{taskTypeLabels[task.type]} • {task.responsibleName || "Sem responsável"}</span><small>{task.leadName || task.leadCompany || task.leadPhone || "Sem lead"} • {formatTaskDate(task.dueAt)}</small></div>
                <div className="taskCardActionsV42"><span className={`badge ${getTaskTone(task.priority)}`}>{priorityLabels[task.priority]}</span>{task.leadId ? <button className="secondaryButton" type="button" onClick={() => onViewLead(task.leadId)}>Abrir lead</button> : null}<button className="primaryButton" type="button" onClick={() => setTaskToComplete(task)} disabled={isSaving}>Concluir</button></div>
              </article>
            )) : <div className="operationEmptyCompact"><strong>{hasCustomDateFilter && !customFilterReady ? "Defina o período para carregar a fila." : "Nenhuma tarefa nesta fila."}</strong></div>}
          </div>
        </section>

        <aside className="operationSideStackV42">
          <section className="panel">
            <span className="eyebrow">Indicadores do papel</span>
            <h2>{dashboard?.role === "consultor_vendas" ? "Minha carteira" : dashboard?.role === "pre_venda" ? "Operação de pré-venda" : "Saúde da operação"}</h2>
            <div className="roleMetricsListV42">
              <div><span>Aguardando primeiro contato</span><strong>{dashboard?.roleMetrics.awaitingFirstContact || 0}</strong></div>
              {dashboard?.role !== "consultor_vendas" ? <div><span>Sem responsável</span><strong>{dashboard?.roleMetrics.withoutOwner || 0}</strong></div> : null}
              <div><span>Sem próximo passo</span><strong>{dashboard?.roleMetrics.withoutNextStep || 0}</strong></div>
              <div><span>Parados há mais de 7 dias</span><strong>{dashboard?.roleMetrics.stalled || 0}</strong></div>
            </div>
          </section>

          {dashboard?.teamOverdue?.length ? <section className="panel"><span className="eyebrow">Equipe</span><h2>Atrasos por responsável</h2><div className="roleMetricsListV42">{dashboard.teamOverdue.map((item) => <div key={item.responsibleName}><span>{item.responsibleName}</span><strong>{item.total}</strong></div>)}</div></section> : null}

          {dashboard?.systemHealth ? <section className="panel"><span className="eyebrow">Administração</span><h2>Alertas operacionais</h2><div className="roleMetricsListV42"><div><span>Usuários ativos</span><strong>{dashboard.systemHealth.activeUsers}</strong></div><div><span>Falhas de integração</span><strong>{dashboard.systemHealth.failedIntegrations}</strong></div><div><span>Último backup</span><strong>{dashboard.systemHealth.latestBackupAt ? new Date(dashboard.systemHealth.latestBackupAt).toLocaleDateString("pt-BR") : "Não encontrado"}</strong></div></div></section> : null}
        </aside>
      </div>

      <TaskCompletionDialog
        task={taskToComplete}
        onClose={() => setTaskToComplete(null)}
        onComplete={(payload) => taskToComplete ? completeTask(taskToComplete, payload) : Promise.resolve()}
      />
    </section>
  );
});
