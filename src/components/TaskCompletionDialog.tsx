import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { CRMTask, TaskPriority, TaskType } from "../types/Lead";
import { ModalDialog } from "./ModalDialog";
import { BrDateInput } from "./BrDateInput";

export type TaskCompletionPayload = {
  result: string;
  nextTask?: {
    title: string;
    dueAt: string;
    leadId?: string;
    responsibleUserId?: string;
    type: TaskType;
    priority: TaskPriority;
  };
};

type TaskCompletionDialogProps = {
  task: CRMTask | null;
  onClose: () => void;
  onComplete: (payload: TaskCompletionPayload) => Promise<void>;
};

function toLocalDateTime(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function defaultFollowUpDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return toLocalDateTime(date);
}

export function TaskCompletionDialog({ task, onClose, onComplete }: TaskCompletionDialogProps) {
  const [result, setResult] = useState("");
  const [createNextTask, setCreateNextTask] = useState(false);
  const [nextTitle, setNextTitle] = useState("");
  const [nextDueAt, setNextDueAt] = useState(defaultFollowUpDate);
  const [nextPriority, setNextPriority] = useState<TaskPriority>("normal");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const leadLabel = useMemo(
    () => task?.leadName || task?.leadCompany || "cliente",
    [task],
  );

  useEffect(() => {
    if (!task) return;
    setResult("");
    setCreateNextTask(false);
    setNextTitle(`Follow-up com ${task.leadName || task.leadCompany || "cliente"}`);
    setNextDueAt(defaultFollowUpDate());
    setNextPriority("normal");
    setError("");
    setIsSaving(false);
  }, [task?.id]);

  if (!task) return null;
  const activeTask = task;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (createNextTask && nextTitle.trim().length < 3) {
      setError("Informe um título com pelo menos 3 caracteres para o próximo follow-up.");
      return;
    }

    if (createNextTask && !nextDueAt) {
      setError("Escolha a data e o horário do próximo follow-up.");
      return;
    }

    setIsSaving(true);
    try {
      await onComplete({
        result: result.trim(),
        nextTask: createNextTask ? {
          title: nextTitle.trim(),
          dueAt: nextDueAt,
          leadId: activeTask.leadId,
          responsibleUserId: activeTask.responsibleUserId,
          type: "follow_up",
          priority: nextPriority,
        } : undefined,
      });
      onClose();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível concluir a tarefa.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <ModalDialog
      title="Concluir tarefa"
      description={`${activeTask.title} · ${leadLabel}`}
      onClose={onClose}
      closeDisabled={isSaving}
      dismissOnBackdrop={!isSaving}
      size="medium"
      footer={(
        <>
          <button className="secondaryButton" type="button" onClick={onClose} disabled={isSaving}>Cancelar</button>
          <button className="primaryButton" type="submit" form={`complete-task-${activeTask.id}`} disabled={isSaving}>
            {isSaving ? "Concluindo..." : "Concluir tarefa"}
          </button>
        </>
      )}
    >
      <form id={`complete-task-${activeTask.id}`} className="taskCompletionForm" onSubmit={handleSubmit}>
        <label className="field">
          <span>Resultado da tarefa</span>
          <textarea
            data-dialog-initial-focus
            value={result}
            onChange={(event) => setResult(event.target.value)}
            rows={4}
            maxLength={5000}
            placeholder="Ex.: Cliente respondeu, pediu proposta e confirmou retorno para sexta-feira."
          />
          <small>Opcional. Registre o que aconteceu para manter o histórico comercial claro.</small>
        </label>

        <label className="taskCompletionToggle">
          <input
            type="checkbox"
            checked={createNextTask}
            onChange={(event) => setCreateNextTask(event.target.checked)}
          />
          <span>
            <strong>Criar próximo follow-up</strong>
            <small>Deixe a próxima ação agendada antes de encerrar esta tarefa.</small>
          </span>
        </label>

        {createNextTask ? (
          <div className="taskCompletionNextFields">
            <label className="field taskCompletionFullField">
              <span>Título</span>
              <input value={nextTitle} onChange={(event) => setNextTitle(event.target.value)} maxLength={180} />
            </label>
            <label className="field">
              <span>Data e horário <small className="dateFormatHint">Dia/Mês/Ano · Hora</small></span>
              <BrDateInput
                withTime
                min={toLocalDateTime(new Date())}
                value={nextDueAt}
                onChange={setNextDueAt}
                ariaLabel="Data e horário do próximo follow-up"
              />
            </label>
            <label className="field">
              <span>Prioridade</span>
              <select value={nextPriority} onChange={(event) => setNextPriority(event.target.value as TaskPriority)}>
                <option value="baixa">Baixa</option>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </label>
          </div>
        ) : null}

        {error ? <p className="fieldError" role="alert">{error}</p> : null}
      </form>
    </ModalDialog>
  );
}
