import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import type { KanbanBoardData, KanbanBoardFilters, KanbanLeadSearchResult, KanbanPipeline, KanbanStage, KanbanStageColumn, KanbanStageType } from "../types/Kanban";
import type { Lead, LeadStatus } from "../types/Lead";
import {
  archiveKanbanPipeline,
  bulkAssignKanbanCards,
  createKanbanPipeline,
  createKanbanStage,
  deleteKanbanStage,
  fetchKanbanBoard,
  fetchKanbanPipelines,
  fetchMoreKanbanStageCards,
  moveKanbanCard,
  reorderKanbanStages,
  searchLeadsForKanban,
  updateKanbanPipeline,
  updateKanbanStage,
} from "../utils/api";
import { getLeadScores, getRecommendedCommercialPlan } from "../utils/commercial";
import { formatDate } from "../utils/formatters";
import { createLeadMenuIcon, LeadOverflowMenu } from "./LeadActionMenus";
import { useConfirmationDialog } from "./ConfirmationDialog";
import { ModalDialog } from "./ModalDialog";
import { useKanbanBoardData } from "../features/kanban/useKanbanBoardData";

const STAGE_COLORS = ["#2563EB", "#0EA5E9", "#8B5CF6", "#F59E0B", "#F97316", "#16A34A", "#DC2626", "#64748B"];
const OPEN_STAGE_STATUS_OPTIONS: Array<{ value: "" | LeadStatus; label: string }> = [
  { value: "", label: "Sem vínculo automático" },
  { value: "Novo lead", label: "Novo lead" },
  { value: "Contato feito", label: "Contato feito" },
  { value: "Sem resposta", label: "Sem resposta" },
  { value: "Reunião marcada", label: "Reunião marcada" },
  { value: "Diagnóstico realizado", label: "Diagnóstico realizado" },
  { value: "Proposta enviada", label: "Proposta enviada" },
  { value: "Em negociação", label: "Em negociação" },
];

type KanbanBoardProps = {
  filters: KanbanBoardFilters;
  canMoveCards: boolean;
  canAddCards: boolean;
  canEditCards: boolean;
  canDeleteCards: boolean;
  canManagePipeline: boolean;
  onViewLead: (leadId: string) => void;
  onEditLead: (leadId: string) => void;
  onDeleteLead: (leadId: string) => void;
  onLeadUpdated?: (lead: Lead) => void;
  externalRefreshVersion?: number;
};

type DraggedCard = {
  leadId: string;
  sourceStageId: string;
};

type DraggedStage = {
  stageId: string;
  sourceIndex: number;
};

type StageDraft = Pick<KanbanStage, "id" | "name" | "color" | "stageType" | "statusKey" | "wipLimit" | "cardCount">;

function toStageDraft(stage: KanbanStage): StageDraft {
  return {
    id: stage.id,
    name: stage.name,
    color: stage.color,
    stageType: stage.stageType,
    statusKey: stage.statusKey,
    wipLimit: stage.wipLimit,
    cardCount: stage.cardCount,
  };
}

function getPriorityClass(value: number) {
  if (value >= 70) return "badgeRed";
  if (value >= 45) return "badgeYellow";
  return "badgeBlue";
}

function getStageTypeLabel(stageType: KanbanStageType) {
  if (stageType === "won") return "Ganho";
  if (stageType === "lost") return "Perdido";
  return "Em aberto";
}

function replaceCardInBoard(board: KanbanBoardData, updatedLead: Lead): KanbanBoardData {
  return {
    ...board,
    stages: board.stages.map((stage) => ({
      ...stage,
      cards: stage.cards.map((card) => (card.id === updatedLead.id ? updatedLead : card)),
    })),
  };
}

type KanbanCardItemProps = {
  lead: Lead;
  stageId: string;
  stages: KanbanStageColumn[];
  cardIndex: number;
  stageIndex: number;
  isDragging: boolean;
  isDropBefore: boolean;
  canMoveCards: boolean;
  canEditCards: boolean;
  canDeleteCards: boolean;
  onViewLead: (leadId: string) => void;
  onEditLead: (leadId: string) => void;
  onDeleteLead: (leadId: string) => void;
  onDragStartCard: (event: DragEvent<HTMLElement>, lead: Lead, stageId: string) => void;
  onDragEndCard: () => void;
  onDragOverCard: (event: DragEvent<HTMLElement>, stageId: string, cardIndex: number, stageIndex: number) => void;
  onDropCard: (event: DragEvent<HTMLElement>, stageId: string, cardIndex: number, stageIndex: number) => void;
  onMoveCard: (leadId: string, targetStageId: string) => void;
};

const KanbanCardItem = memo(function KanbanCardItem({
  lead,
  stageId,
  stages,
  cardIndex,
  stageIndex,
  isDragging,
  isDropBefore,
  canMoveCards,
  canEditCards,
  canDeleteCards,
  onViewLead,
  onEditLead,
  onDeleteLead,
  onDragStartCard,
  onDragEndCard,
  onDragOverCard,
  onDropCard,
  onMoveCard,
}: KanbanCardItemProps) {
  const scores = getLeadScores(lead);
  const plan = getRecommendedCommercialPlan(lead);

  return (
    <article
      data-lead-id={lead.id}
      data-stage-id={stageId}
      className={`kanbanCardV40 ${isDragging ? "kanbanCardDragging" : ""} ${isDropBefore ? "kanbanCardDropBefore" : ""}`}
      draggable={canMoveCards}
      onDragStart={(event) => onDragStartCard(event, lead, stageId)}
      onDragEnd={onDragEndCard}
      onDragOver={(event) => onDragOverCard(event, stageId, cardIndex, stageIndex)}
      onDrop={(event) => onDropCard(event, stageId, cardIndex, stageIndex)}
    >
      <div className="kanbanCardTopline">
        <button type="button" className="kanbanCardIdentity" onClick={() => onViewLead(lead.id)}>
          <strong>{lead.name || lead.phone || "Lead sem nome"}</strong>
          <span>{lead.company || lead.email || lead.phone || "Empresa pendente"}</span>
        </button>
        <LeadOverflowMenu
          lead={lead}
          onViewLead={onViewLead}
          onEditLead={canEditCards ? onEditLead : undefined}
          includeContactChannels
          extraItems={canDeleteCards ? [{
            id: "delete",
            label: "Excluir lead",
            description: "Mover o lead para a lixeira",
            icon: createLeadMenuIcon("delete"),
            danger: true,
            separatorBefore: true,
            onSelect: () => onDeleteLead(lead.id),
          }] : []}
        />
      </div>

      <div className="kanbanCardBadges">
        <span className={`badge ${getPriorityClass(scores.priority)}`}>Prioridade {scores.priority}</span>
        {lead.temperature ? <span className="badge badgeGray">{lead.temperature}</span> : null}
      </div>

      <p className="kanbanCardNextAction" title={plan.nextAction}>{plan.offer || plan.nextAction}</p>

      <div className="kanbanCardMeta">
        <span>{lead.responsible || "Sem responsável"}</span>
        <span>{lead.nextContactAt ? formatDate(lead.nextContactAt) : "Sem próximo passo"}</span>
      </div>

      {canMoveCards ? (
        <label className="kanbanMoveSelect">
          <span>Mover para</span>
          <select value={stageId} onChange={(event) => onMoveCard(lead.id, event.target.value)}>
            {stages.map((targetStage) => <option key={targetStage.id} value={targetStage.id}>{targetStage.name}</option>)}
          </select>
        </label>
      ) : null}
    </article>
  );
});

function Modal({ title, description, onClose, children, wide = false }: { title: string; description?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <ModalDialog
      title={title}
      description={description}
      onClose={onClose}
      size={wide ? "large" : "medium"}
      className="kanbanModalDialogV5"
    >
      <div className="kanbanModalBody">{children}</div>
    </ModalDialog>
  );
}

export const KanbanBoard = memo(function KanbanBoard({
  filters,
  canMoveCards,
  canAddCards,
  canEditCards,
  canDeleteCards,
  canManagePipeline,
  onViewLead,
  onEditLead,
  onDeleteLead,
  onLeadUpdated,
  externalRefreshVersion = 0,
}: KanbanBoardProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [draggedCard, setDraggedCard] = useState<DraggedCard | null>(null);
  const [dropTarget, setDropTarget] = useState<{ stageId: string; index: number } | null>(null);
  const [draggedStage, setDraggedStage] = useState<DraggedStage | null>(null);
  const [stageDropIndex, setStageDropIndex] = useState<number | null>(null);
  const [createPipelineOpen, setCreatePipelineOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingStageId, setEditingStageId] = useState("");
  const [newStageInlineOpen, setNewStageInlineOpen] = useState(false);
  const [addLeadsOpen, setAddLeadsOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [copyCurrentStages, setCopyCurrentStages] = useState(true);
  const [pipelineNameDraft, setPipelineNameDraft] = useState("");
  const [stageDrafts, setStageDrafts] = useState<StageDraft[]>([]);
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState(STAGE_COLORS[0]);
  const [newStageType, setNewStageType] = useState<KanbanStageType>("open");
  const [newStageStatusKey, setNewStageStatusKey] = useState<"" | LeadStatus>("");
  const [newStageWip, setNewStageWip] = useState(0);
  const [stageToDelete, setStageToDelete] = useState<KanbanStage | null>(null);
  const [deleteTargetStageId, setDeleteTargetStageId] = useState("");
  const [leadSearch, setLeadSearch] = useState("");
  const [leadSearchResults, setLeadSearchResults] = useState<KanbanLeadSearchResult[]>([]);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [addToStageId, setAddToStageId] = useState("");
  const [isSearchingLeads, setIsSearchingLeads] = useState(false);
  const leadSearchController = useRef<AbortController | null>(null);
  const { confirm, confirmationDialog } = useConfirmationDialog();

  const handleBoardLoaded = useCallback((result: KanbanBoardData) => {
    setPipelineNameDraft(result.pipeline.name);
    setStageDrafts(result.stages.map(toStageDraft));
    setEditingStageId((currentStageId) => result.stages.some((stage) => stage.id === currentStageId) ? currentStageId : "");
    setAddToStageId((currentStageId) => currentStageId && result.stages.some((stage) => stage.id === currentStageId)
      ? currentStageId
      : result.stages[0]?.id || "");
  }, []);

  const {
    pipelines,
    selectedPipelineId,
    setSelectedPipelineId,
    board,
    setBoard,
    isLoading,
    error,
    setError,
    loadPipelines,
    loadBoard,
  } = useKanbanBoardData({ filters, externalRefreshVersion, onBoardLoaded: handleBoardLoaded });

  const draggedCardStateRef = useRef(draggedCard);
  const draggedStageStateRef = useRef(draggedStage);
  const dropTargetStateRef = useRef(dropTarget);
  const stageDropIndexStateRef = useRef(stageDropIndex);
  const commitCardMoveRef = useRef<(leadId: string, targetStageId: string, targetIndex?: number) => Promise<void>>(async () => undefined);
  const commitStageReorderRef = useRef<(targetIndex?: number | null) => Promise<void>>(async () => undefined);

  draggedCardStateRef.current = draggedCard;
  draggedStageStateRef.current = draggedStage;
  dropTargetStateRef.current = dropTarget;
  stageDropIndexStateRef.current = stageDropIndex;
  commitCardMoveRef.current = commitCardMove;
  commitStageReorderRef.current = commitStageReorder;

  const handleCardDragStart = useCallback((event: DragEvent<HTMLElement>, lead: Lead, stageId: string) => {
    if (!canMoveCards) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", lead.id);
    const nextDraggedCard = { leadId: lead.id, sourceStageId: stageId };
    draggedCardStateRef.current = nextDraggedCard;
    setDraggedCard(nextDraggedCard);
  }, [canMoveCards]);

  const handleCardDragEnd = useCallback(() => {
    draggedCardStateRef.current = null;
    dropTargetStateRef.current = null;
    setDraggedCard(null);
    setDropTarget(null);
  }, []);

  const handleCardDragOver = useCallback((event: DragEvent<HTMLElement>, stageId: string, cardIndex: number, stageIndex: number) => {
    if (draggedStageStateRef.current) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      const rect = event.currentTarget.getBoundingClientRect();
      const nextDropIndex = event.clientX > rect.left + rect.width / 2 ? stageIndex + 1 : stageIndex;
      if (stageDropIndexStateRef.current !== nextDropIndex) {
        stageDropIndexStateRef.current = nextDropIndex;
        setStageDropIndex(nextDropIndex);
      }
      return;
    }

    if (!draggedCardStateRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const index = event.clientY > rect.top + rect.height / 2 ? cardIndex + 1 : cardIndex;
    const currentTarget = dropTargetStateRef.current;
    if (!currentTarget || currentTarget.stageId !== stageId || currentTarget.index !== index) {
      const nextTarget = { stageId, index };
      dropTargetStateRef.current = nextTarget;
      setDropTarget(nextTarget);
    }
  }, []);

  const handleCardDrop = useCallback((event: DragEvent<HTMLElement>, stageId: string, cardIndex: number, stageIndex: number) => {
    event.preventDefault();
    event.stopPropagation();

    if (draggedStageStateRef.current) {
      const rect = event.currentTarget.getBoundingClientRect();
      const targetIndex = event.clientX > rect.left + rect.width / 2 ? stageIndex + 1 : stageIndex;
      void commitStageReorderRef.current(targetIndex);
      return;
    }

    const leadId = draggedCardStateRef.current?.leadId || event.dataTransfer.getData("text/plain");
    const currentTarget = dropTargetStateRef.current;
    const targetIndex = currentTarget?.stageId === stageId ? currentTarget.index : cardIndex;
    if (leadId) void commitCardMoveRef.current(leadId, stageId, targetIndex);
  }, []);

  const handleCardMoveSelect = useCallback((leadId: string, targetStageId: string) => {
    void commitCardMoveRef.current(leadId, targetStageId);
  }, []);

  useEffect(() => {
    if (!addLeadsOpen || !selectedPipelineId) {
      leadSearchController.current?.abort();
      leadSearchController.current = null;
      return;
    }

    const timeoutId = window.setTimeout(() => {
      leadSearchController.current?.abort();
      const controller = new AbortController();
      leadSearchController.current = controller;
      setIsSearchingLeads(true);
      void searchLeadsForKanban(selectedPipelineId, leadSearch, 50, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setLeadSearchResults(result);
        })
        .catch((caughtError) => {
          if (!controller.signal.aborted && !(caughtError instanceof Error && caughtError.name === "AbortError")) {
            setError(caughtError instanceof Error ? caughtError.message : "Não foi possível buscar os leads.");
          }
        })
        .finally(() => {
          if (leadSearchController.current === controller) {
            leadSearchController.current = null;
            setIsSearchingLeads(false);
          }
        });
    }, 300);

    return () => {
      window.clearTimeout(timeoutId);
      leadSearchController.current?.abort();
    };
  }, [addLeadsOpen, leadSearch, selectedPipelineId, setError]);

  const hasActiveFilters = Boolean(
    filters.search?.trim()
      || filters.status?.trim()
      || filters.temperature?.trim()
      || filters.responsible?.trim()
      || (filters.quickFilter?.trim() && filters.quickFilter !== "all"),
  );

  const activePipeline = useMemo(
    () => pipelines.find((pipeline) => pipeline.id === selectedPipelineId) || board?.pipeline || null,
    [board?.pipeline, pipelines, selectedPipelineId],
  );

  async function refreshEverything(preferredPipelineId = selectedPipelineId) {
    const resolvedPipelineId = await loadPipelines(preferredPipelineId);
    if (resolvedPipelineId) await loadBoard(resolvedPipelineId);
  }

  async function handlePipelineChange(pipelineId: string) {
    if (!(await confirmDiscardCurrentStageChanges())) return;
    setSelectedPipelineId(pipelineId);
    setSelectedLeadIds(new Set());
    setEditingStageId("");
    resetNewStageForm();
  }

  async function handleCreatePipeline() {
    if (newPipelineName.trim().length < 2) return;
    setIsSaving(true);
    setError("");
    try {
      const pipeline = await createKanbanPipeline({
        name: newPipelineName.trim(),
        sourcePipelineId: copyCurrentStages ? selectedPipelineId : undefined,
      });
      setCreatePipelineOpen(false);
      setNewPipelineName("");
      await refreshEverything(pipeline.id);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível criar o funil.");
    } finally {
      setIsSaving(false);
    }
  }

  function startStageDragging(event: DragEvent<HTMLElement>, stageId: string, sourceIndex: number) {
    if (!canManagePipeline || isSaving) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-kanban-stage", stageId);
    event.dataTransfer.setData("text/plain", `stage:${stageId}`);
    setDraggedCard(null);
    setDropTarget(null);
    setDraggedStage({ stageId, sourceIndex });
    setStageDropIndex(sourceIndex);
  }

  function finishStageDragging() {
    setDraggedStage(null);
    setStageDropIndex(null);
  }

  function resolveStageDropIndex(event: DragEvent<HTMLElement>, stageIndex: number) {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX > rect.left + rect.width / 2 ? stageIndex + 1 : stageIndex;
  }

  function setStageReorderTarget(event: DragEvent<HTMLElement>, stageIndex: number) {
    if (!draggedStage) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const nextDropIndex = resolveStageDropIndex(event, stageIndex);
    if (stageDropIndex !== nextDropIndex) setStageDropIndex(nextDropIndex);
  }

  function setLastStageReorderTarget(event: DragEvent<HTMLElement>) {
    if (!draggedStage || !board) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    if (stageDropIndex !== board.stages.length) setStageDropIndex(board.stages.length);
  }

  function setColumnDropTarget(event: DragEvent<HTMLElement>, stageId: string, index: number) {
    if (!draggedCard) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (!dropTarget || dropTarget.stageId !== stageId || dropTarget.index !== index) setDropTarget({ stageId, index });
  }

  async function commitCardMove(leadId: string, targetStageId: string, targetIndex?: number) {
    if (!board || !canMoveCards) return;
    const previousBoard = board;
    const sourceStage = board.stages.find((stage) => stage.cards.some((card) => card.id === leadId));
    const sourceCard = sourceStage?.cards.find((card) => card.id === leadId);
    const targetStage = board.stages.find((stage) => stage.id === targetStageId);
    if (!sourceStage || !sourceCard || !targetStage) return;

    const nextStages = board.stages.map((stage) => ({ ...stage, cards: [...stage.cards] }));
    const sourceColumn = nextStages.find((stage) => stage.id === sourceStage.id)!;
    const targetColumn = nextStages.find((stage) => stage.id === targetStageId)!;
    const sourceIndex = sourceColumn.cards.findIndex((card) => card.id === leadId);
    sourceColumn.cards.splice(sourceIndex, 1);
    let insertIndex = targetIndex ?? targetColumn.cards.length;
    if (sourceColumn.id === targetColumn.id && sourceIndex < insertIndex) insertIndex -= 1;
    insertIndex = Math.max(0, Math.min(insertIndex, targetColumn.cards.length));
    const optimisticCard = { ...sourceCard, pipelineId: board.pipeline.id, pipelineStageId: targetStageId };
    targetColumn.cards.splice(insertIndex, 0, optimisticCard);

    if (sourceColumn.id !== targetColumn.id) {
      sourceColumn.cardCount = Math.max(0, sourceColumn.cardCount - 1);
      sourceColumn.filteredCardCount = Math.max(0, sourceColumn.filteredCardCount - 1);
      targetColumn.cardCount += 1;
      targetColumn.filteredCardCount += 1;
    }

    const beforeLeadId = targetColumn.cards[insertIndex + 1]?.id || "";
    const afterLeadId = targetColumn.cards[insertIndex - 1]?.id || "";
    setBoard({ ...board, stages: nextStages });
    setDraggedCard(null);
    setDropTarget(null);
    setIsSaving(true);
    setError("");

    try {
      const savedLead = await moveKanbanCard({
        leadId,
        pipelineId: board.pipeline.id,
        stageId: targetStageId,
        beforeLeadId,
        afterLeadId,
        expectedUpdatedAt: sourceCard.updatedAt,
      });
      setBoard((currentBoard) => currentBoard ? replaceCardInBoard(currentBoard, savedLead) : currentBoard);
      onLeadUpdated?.(savedLead);
      await Promise.all([loadPipelines(board.pipeline.id), loadBoard(board.pipeline.id)]);
    } catch (caughtError) {
      setBoard(previousBoard);
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível mover o card.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDrop(event: DragEvent<HTMLElement>, stageId: string, fallbackIndex: number) {
    event.preventDefault();
    event.stopPropagation();
    const leadId = draggedCard?.leadId || event.dataTransfer.getData("text/plain");
    const index = dropTarget?.stageId === stageId ? dropTarget.index : fallbackIndex;
    if (leadId) await commitCardMove(leadId, stageId, index);
  }

  async function loadMore(stage: KanbanStageColumn) {
    if (!board) return;
    setIsSaving(true);
    try {
      const result = await fetchMoreKanbanStageCards(stage.id, stage.cards.length, filters, board.limitPerStage);
      setBoard((currentBoard) => {
        if (!currentBoard) return currentBoard;
        return {
          ...currentBoard,
          stages: currentBoard.stages.map((currentStage) => currentStage.id === stage.id
            ? { ...currentStage, cards: [...currentStage.cards, ...result.cards], filteredCardCount: result.total, hasMore: result.hasMore }
            : currentStage),
        };
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível carregar mais cards.");
    } finally {
      setIsSaving(false);
    }
  }

  async function savePipelineName() {
    if (!board || pipelineNameDraft.trim().length < 2) return;
    setIsSaving(true);
    try {
      await updateKanbanPipeline(board.pipeline.id, { name: pipelineNameDraft.trim() });
      await refreshEverything(board.pipeline.id);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível renomear o funil.");
    } finally {
      setIsSaving(false);
    }
  }

  async function makeDefaultPipeline() {
    if (!board) return;
    setIsSaving(true);
    try {
      await updateKanbanPipeline(board.pipeline.id, { isDefault: true });
      await refreshEverything(board.pipeline.id);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível definir o funil padrão.");
    } finally {
      setIsSaving(false);
    }
  }

  async function archivePipeline() {
    if (!board || board.pipeline.isDefault) return;
    const confirmed = await confirm({
      title: "Arquivar funil?",
      message: board.pipeline.name,
      detail: "Os cards serão movidos para o funil padrão. O histórico dos leads será preservado.",
      confirmLabel: "Arquivar funil",
      tone: "danger",
    });
    if (!confirmed) return;
    setIsSaving(true);
    try {
      await archiveKanbanPipeline(board.pipeline.id);
      setSettingsOpen(false);
      await refreshEverything("");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível arquivar o funil.");
    } finally {
      setIsSaving(false);
    }
  }

  function updateStageDraft(stageId: string, patch: Partial<StageDraft>) {
    setStageDrafts((current) => current.map((stage) => stage.id === stageId ? { ...stage, ...patch } : stage));
  }

  async function confirmDiscardCurrentStageChanges() {
    const hasNewStageDraft = newStageInlineOpen && Boolean(
      newStageName.trim()
      || newStageType !== "open"
      || newStageStatusKey
      || newStageWip > 0
      || newStageColor.toUpperCase() !== STAGE_COLORS[0],
    );
    if (hasNewStageDraft) {
      return confirm({
        title: "Descartar nova etapa?",
        message: "Há uma nova etapa ainda não salva.",
        detail: "Os dados preenchidos nessa etapa serão perdidos.",
        confirmLabel: "Descartar alterações",
        tone: "danger",
      });
    }
    if (!editingStageId || !board) return true;
    const currentStage = board.stages.find((stage) => stage.id === editingStageId);
    const currentDraft = stageDrafts.find((stage) => stage.id === editingStageId);
    if (!currentStage || !isStageDraftDirty(currentStage, currentDraft)) return true;
    return confirm({
      title: "Descartar alterações?",
      message: `A etapa ${currentStage.name} possui mudanças não salvas.`,
      detail: "Os valores anteriores serão restaurados.",
      confirmLabel: "Descartar alterações",
      tone: "danger",
    });
  }

  async function openStageEditor(stage: KanbanStageColumn) {
    if (editingStageId === stage.id) return;
    if (!(await confirmDiscardCurrentStageChanges())) return;
    setStageDrafts((current) => {
      const nextDraft = toStageDraft(stage);
      return current.some((item) => item.id === stage.id)
        ? current.map((item) => item.id === stage.id ? nextDraft : item)
        : [...current, nextDraft];
    });
    resetNewStageForm();
    setEditingStageId(stage.id);
  }

  function cancelStageEditor(stage: KanbanStageColumn) {
    updateStageDraft(stage.id, toStageDraft(stage));
    setEditingStageId("");
  }

  function isStageDraftDirty(stage: KanbanStageColumn, draft?: StageDraft) {
    if (!draft) return false;
    const currentStatusKey = stage.stageType === "open" ? stage.statusKey : stage.stageType === "won" ? "Fechado" : "Perdido";
    const draftStatusKey = draft.stageType === "open" ? draft.statusKey : draft.stageType === "won" ? "Fechado" : "Perdido";
    return stage.name !== draft.name.trim()
      || stage.color.toUpperCase() !== draft.color.toUpperCase()
      || stage.stageType !== draft.stageType
      || currentStatusKey !== draftStatusKey
      || stage.wipLimit !== draft.wipLimit;
  }

  async function saveStage(stage: StageDraft, closeInlineEditor = false) {
    const currentStage = board?.stages.find((item) => item.id === stage.id);
    const nextStatusKey = stage.stageType === "open" ? stage.statusKey : stage.stageType === "won" ? "Fechado" : "Perdido";
    const changesCardStatus = Boolean(
      currentStage
      && currentStage.cardCount > 0
      && (currentStage.stageType !== stage.stageType || currentStage.statusKey !== nextStatusKey),
    );
    if (changesCardStatus) {
      const confirmed = await confirm({
        title: "Atualizar status dos cards?",
        message: `${currentStage?.cardCount.toLocaleString("pt-BR")} card(s) serão atualizados.`,
        detail: "A mudança de tipo ou status da etapa será aplicada aos leads que estão nela.",
        confirmLabel: "Atualizar cards",
        tone: "danger",
      });
      if (!confirmed) return false;
    }

    setIsSaving(true);
    try {
      await updateKanbanStage(stage.id, {
        name: stage.name.trim(),
        color: stage.color,
        stageType: stage.stageType,
        statusKey: nextStatusKey,
        wipLimit: stage.wipLimit,
      });
      if (closeInlineEditor) setEditingStageId("");
      await refreshEverything(selectedPipelineId);
      return true;
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível atualizar a etapa.");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function persistStageOrder(nextStages: KanbanStageColumn[], previousStages: KanbanStageColumn[]) {
    if (!board) return;
    setBoard({ ...board, stages: nextStages });
    setIsSaving(true);
    setError("");
    try {
      await reorderKanbanStages(board.pipeline.id, nextStages.map((stage) => stage.id));
    } catch (caughtError) {
      setBoard((currentBoard) => currentBoard ? { ...currentBoard, stages: previousStages } : currentBoard);
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível reordenar as etapas.");
    } finally {
      setIsSaving(false);
    }
  }

  async function moveStage(stageId: string, direction: -1 | 1) {
    if (isSaving) return;
    const orderedStages = board?.stages || [];
    const index = orderedStages.findIndex((stage) => stage.id === stageId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= orderedStages.length) return;
    const nextStages = [...orderedStages];
    [nextStages[index], nextStages[targetIndex]] = [nextStages[targetIndex], nextStages[index]];
    await persistStageOrder(nextStages, orderedStages);
  }

  async function commitStageReorder(targetIndex = stageDropIndex) {
    if (!board || !draggedStage || targetIndex == null) {
      finishStageDragging();
      return;
    }

    const previousStages = board.stages;
    const sourceIndex = previousStages.findIndex((stage) => stage.id === draggedStage.stageId);
    if (sourceIndex < 0) {
      finishStageDragging();
      return;
    }

    const nextStages = [...previousStages];
    const [movedStage] = nextStages.splice(sourceIndex, 1);
    let resolvedTargetIndex = targetIndex;
    if (sourceIndex < resolvedTargetIndex) resolvedTargetIndex -= 1;
    resolvedTargetIndex = Math.max(0, Math.min(resolvedTargetIndex, nextStages.length));
    nextStages.splice(resolvedTargetIndex, 0, movedStage);

    finishStageDragging();
    if (nextStages.every((stage, index) => stage.id === previousStages[index]?.id)) return;
    await persistStageOrder(nextStages, previousStages);
  }

  async function handleStageDrop(event: DragEvent<HTMLElement>, targetIndex?: number) {
    if (!draggedStage) return;
    event.preventDefault();
    event.stopPropagation();
    await commitStageReorder(targetIndex ?? stageDropIndex);
  }

  async function duplicateStage(stage: KanbanStageColumn) {
    if (!board) return;
    setIsSaving(true);
    try {
      const createdStage = await createKanbanStage(board.pipeline.id, {
        name: `${stage.name} - cópia`,
        color: stage.color,
        stageType: stage.stageType,
        statusKey: stage.stageType === "open" ? stage.statusKey : stage.stageType === "won" ? "Fechado" : "Perdido",
        wipLimit: stage.wipLimit,
      });
      const stageIds = board.stages.map((item) => item.id);
      const sourceIndex = stageIds.indexOf(stage.id);
      stageIds.splice(sourceIndex + 1, 0, createdStage.id);
      await reorderKanbanStages(board.pipeline.id, stageIds);
      setEditingStageId("");
      await refreshEverything(board.pipeline.id);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível duplicar a etapa.");
    } finally {
      setIsSaving(false);
    }
  }

  function resetNewStageForm() {
    setNewStageName("");
    setNewStageStatusKey("");
    setNewStageWip(0);
    setNewStageType("open");
    setNewStageColor(STAGE_COLORS[0]);
    setNewStageInlineOpen(false);
  }

  async function addStage() {
    if (!newStageName.trim() || !board) return;
    setIsSaving(true);
    try {
      await createKanbanStage(board.pipeline.id, {
        name: newStageName.trim(),
        color: newStageColor,
        stageType: newStageType,
        statusKey: newStageType === "open" ? newStageStatusKey : newStageType === "won" ? "Fechado" : "Perdido",
        wipLimit: newStageWip,
      });
      resetNewStageForm();
      await refreshEverything(board.pipeline.id);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível criar a etapa.");
    } finally {
      setIsSaving(false);
    }
  }

  function requestStageDelete(stageId: string) {
    const stage = board?.stages.find((item) => item.id === stageId) || null;
    setStageToDelete(stage);
    setDeleteTargetStageId(board?.stages.find((item) => item.id !== stageId)?.id || "");
  }

  async function confirmStageDelete() {
    if (!stageToDelete) return;
    setIsSaving(true);
    try {
      await deleteKanbanStage(stageToDelete.id, stageToDelete.cardCount > 0 ? deleteTargetStageId : undefined);
      setStageToDelete(null);
      setEditingStageId("");
      await refreshEverything(selectedPipelineId);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível remover a etapa.");
    } finally {
      setIsSaving(false);
    }
  }

  function toggleLeadSelection(leadId: string) {
    setSelectedLeadIds((current) => {
      const next = new Set(current);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  }

  async function assignSelectedLeads() {
    if (!canAddCards || !board || !selectedLeadIds.size || !addToStageId) return;
    setIsSaving(true);
    try {
      const savedLeads = await bulkAssignKanbanCards({
        leadIds: Array.from(selectedLeadIds),
        pipelineId: board.pipeline.id,
        stageId: addToStageId,
      });
      savedLeads.forEach((lead) => onLeadUpdated?.(lead));
      setSelectedLeadIds(new Set());
      setAddLeadsOpen(false);
      setLeadSearch("");
      await refreshEverything(board.pipeline.id);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível adicionar os cards ao funil.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading && !board) {
    return <div className="kanbanLoadingState"><strong>Carregando o Kanban...</strong><span>Buscando funis, etapas e cards diretamente no MySQL.</span></div>;
  }

  return (
    <div className="kanbanWorkspaceV40">
      <div className="kanbanControlBar">
        <div className="kanbanPipelinePicker">
          <label htmlFor="kanbanPipelineSelect">Funil</label>
          <select id="kanbanPipelineSelect" value={selectedPipelineId} onChange={(event) => void handlePipelineChange(event.target.value)}>
            {pipelines.map((pipeline) => (
              <option key={pipeline.id} value={pipeline.id}>{pipeline.name} · {pipeline.cardCount.toLocaleString("pt-BR")}</option>
            ))}
          </select>
          {activePipeline?.isDefault ? <span className="kanbanDefaultPill">Padrão</span> : null}
        </div>

        <div className="kanbanControlActions">
          {canAddCards ? <button className="secondaryButton" type="button" onClick={() => setAddLeadsOpen(true)}>Adicionar cards</button> : null}
          {canManagePipeline ? <button className="kanbanPipelineMenuButton" type="button" onClick={() => setSettingsOpen(true)} aria-label="Abrir opções do funil" title="Opções do funil">•••</button> : null}
          {canManagePipeline ? <button className="primaryButton" type="button" onClick={() => setCreatePipelineOpen(true)}>Novo funil</button> : null}
        </div>
      </div>

      <div className="kanbanBoardSummary">
        <span><strong>{board?.filtersTotal.toLocaleString("pt-BR") || 0}</strong> card(s) nos filtros atuais</span>
        <span>Arraste cards entre etapas e use o puxador de seis pontos para reorganizar as colunas.</span>
        {isSaving ? <span className="kanbanSavingIndicator">Salvando...</span> : null}
      </div>

      {error ? <div className="kanbanError" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")}>Fechar</button></div> : null}

      <div className="kanbanBoardV40" aria-label={`Kanban ${board?.pipeline.name || "comercial"}`}>
        {board?.stages.map((stage, stageIndex) => {
          const isOverWip = stage.wipLimit > 0 && stage.cardCount > stage.wipLimit;
          const stageDraft = stageDrafts.find((item) => item.id === stage.id);
          const stageDraftIsDirty = isStageDraftDirty(stage, stageDraft);
          const isNoOpStageDrop = Boolean(
            draggedStage
            && (stageDropIndex === draggedStage.sourceIndex || stageDropIndex === draggedStage.sourceIndex + 1),
          );
          const isStageDropBefore = Boolean(draggedStage && !isNoOpStageDrop && stageDropIndex === stageIndex);
          const isStageDropAfter = Boolean(draggedStage && !isNoOpStageDrop && stageDropIndex === stageIndex + 1);
          return (
            <section
              data-stage-id={stage.id}
              className={`kanbanColumnV40 ${dropTarget?.stageId === stage.id ? "kanbanColumnDropActive" : ""} ${draggedStage?.stageId === stage.id ? "kanbanColumnStageDragSource" : ""} ${isStageDropBefore ? "kanbanStageDropBefore" : ""} ${isStageDropAfter ? "kanbanStageDropAfter" : ""}`}
              key={stage.id}
              onDragOver={(event) => {
                if (draggedStage) setStageReorderTarget(event, stageIndex);
                else setColumnDropTarget(event, stage.id, stage.cards.length);
              }}
              onDrop={(event) => {
                if (draggedStage) void handleStageDrop(event, resolveStageDropIndex(event, stageIndex));
                else void handleDrop(event, stage.id, stage.cards.length);
              }}
            >
              <header className="kanbanColumnHeaderV40" style={{ borderTopColor: stage.color }}>
                <div className="kanbanStageIdentity">
                  {canManagePipeline ? (
                    <button
                      className="kanbanStageDragHandle"
                      type="button"
                      draggable={!isSaving}
                      disabled={isSaving}
                      onDragStart={(event) => startStageDragging(event, stage.id, stageIndex)}
                      onDragEnd={finishStageDragging}
                      onKeyDown={(event) => {
                        if (!event.altKey) return;
                        if (event.key === "ArrowLeft" && stageIndex > 0) {
                          event.preventDefault();
                          void moveStage(stage.id, -1);
                        }
                        if (event.key === "ArrowRight" && stageIndex < (board?.stages.length || 0) - 1) {
                          event.preventDefault();
                          void moveStage(stage.id, 1);
                        }
                      }}
                      aria-label={`Arrastar etapa ${stage.name}. Use Alt mais seta esquerda ou direita para mover pelo teclado.`}
                      title="Arraste para reorganizar. Pelo teclado, use Alt + ← ou Alt + →"
                    >
                      <span /><span /><span /><span /><span /><span />
                    </button>
                  ) : null}
                  <span className="kanbanStageDot" style={{ backgroundColor: stage.color }} />
                  {canManagePipeline ? (
                    <button className="kanbanStageNameButton" type="button" onClick={() => void openStageEditor(stage)} title="Editar esta etapa">
                      <strong>{stage.name}</strong>
                    </button>
                  ) : <strong>{stage.name}</strong>}
                </div>
                <div className="kanbanStageHeaderActions">
                  <div className="kanbanStageMetrics" title={hasActiveFilters ? `${stage.filteredCardCount.toLocaleString("pt-BR")} nos filtros atuais de ${stage.cardCount.toLocaleString("pt-BR")} card(s) no total` : `${stage.cardCount.toLocaleString("pt-BR")} card(s) no total`}>
                    <span className={isOverWip ? "kanbanWipExceeded" : ""}>{(hasActiveFilters ? stage.filteredCardCount : stage.cardCount).toLocaleString("pt-BR")}</span>
                    {hasActiveFilters ? <small>{stage.cardCount.toLocaleString("pt-BR")} total{stage.wipLimit > 0 ? ` · limite ${stage.wipLimit}` : ""}</small> : stage.wipLimit > 0 ? <small>Limite {stage.wipLimit}</small> : null}
                  </div>
                  {canManagePipeline ? (
                    <button
                      className={`kanbanStageMenuButton ${editingStageId === stage.id ? "isActive" : ""}`}
                      type="button"
                      onClick={() => editingStageId === stage.id ? cancelStageEditor(stage) : void openStageEditor(stage)}
                      aria-label={`Editar etapa ${stage.name}`}
                      aria-expanded={editingStageId === stage.id}
                      title="Editar etapa"
                    >•••</button>
                  ) : null}
                </div>
              </header>

              {canManagePipeline && editingStageId === stage.id && stageDraft ? (
                <form
                  className="kanbanInlineStageEditor"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveStage(stageDraft, true);
                  }}
                  onClick={(event) => event.stopPropagation()}
                  onDragStart={(event) => event.preventDefault()}
                >
                  <div className="kanbanInlineStageEditorTitle">
                    <div><strong>Editar etapa</strong><span>{stage.cardCount.toLocaleString("pt-BR")} card(s)</span></div>
                    <button type="button" onClick={() => cancelStageEditor(stage)} aria-label="Fechar edição">×</button>
                  </div>

                  <label className="kanbanInlineStageField">
                    <span>Nome da etapa</span>
                    <input autoFocus value={stageDraft.name} maxLength={160} onChange={(event) => updateStageDraft(stage.id, { name: event.target.value })} />
                  </label>

                  <div className="kanbanInlineStageGrid">
                    <label className="kanbanInlineStageField kanbanInlineColorField">
                      <span>Cor</span>
                      <input type="color" value={stageDraft.color} onChange={(event) => updateStageDraft(stage.id, { color: event.target.value.toUpperCase() })} aria-label={`Cor da etapa ${stage.name}`} />
                    </label>
                    <label className="kanbanInlineStageField">
                      <span>Tipo</span>
                      <select value={stageDraft.stageType} onChange={(event) => {
                        const stageType = event.target.value as KanbanStageType;
                        updateStageDraft(stage.id, {
                          stageType,
                          statusKey: stageType === "won" ? "Fechado" : stageType === "lost" ? "Perdido" : (stageDraft.stageType === "open" ? stageDraft.statusKey : ""),
                        });
                      }}>
                        <option value="open">Em aberto</option>
                        <option value="won">Ganho</option>
                        <option value="lost">Perdido</option>
                      </select>
                    </label>
                    <label className="kanbanInlineStageField">
                      <span>Limite WIP</span>
                      <input type="number" min="0" value={stageDraft.wipLimit} onChange={(event) => updateStageDraft(stage.id, { wipLimit: Math.max(0, Number(event.target.value)) })} />
                    </label>
                  </div>

                  <label className="kanbanInlineStageField">
                    <span>Status vinculado</span>
                    <select
                      value={stageDraft.stageType === "open" ? stageDraft.statusKey : stageDraft.stageType === "won" ? "Fechado" : "Perdido"}
                      disabled={stageDraft.stageType !== "open"}
                      onChange={(event) => updateStageDraft(stage.id, { statusKey: event.target.value })}
                    >
                      {stageDraft.stageType === "open"
                        ? OPEN_STAGE_STATUS_OPTIONS.map((option) => <option key={option.value || "none"} value={option.value}>{option.label}</option>)
                        : <option value={stageDraft.stageType === "won" ? "Fechado" : "Perdido"}>{stageDraft.stageType === "won" ? "Fechado" : "Perdido"}</option>}
                    </select>
                  </label>

                  <div className="kanbanInlineStageUtilityActions">
                    <button type="button" onClick={() => void duplicateStage(stage)} disabled={isSaving || stageDraftIsDirty} title={stageDraftIsDirty ? "Salve ou cancele as alterações antes de duplicar" : "Duplicar etapa"}>Duplicar etapa</button>
                  </div>

                  <div className="kanbanInlineStageFooter">
                    <button className="dangerTextButton" type="button" onClick={() => requestStageDelete(stage.id)} disabled={isSaving || (board?.stages.length || 0) <= 1}>Remover</button>
                    <div>
                      <button className="secondaryButton" type="button" onClick={() => cancelStageEditor(stage)} disabled={isSaving}>Cancelar</button>
                      <button className="primaryButton" type="submit" disabled={isSaving || !stageDraftIsDirty || stageDraft.name.trim().length < 2}>Salvar</button>
                    </div>
                  </div>
                </form>
              ) : null}

              <div className="kanbanCardsV40">
                {stage.cards.map((lead, cardIndex) => (
                  <KanbanCardItem
                    key={lead.id}
                    lead={lead}
                    stageId={stage.id}
                    stages={board.stages}
                    cardIndex={cardIndex}
                    stageIndex={stageIndex}
                    isDragging={draggedCard?.leadId === lead.id}
                    isDropBefore={dropTarget?.stageId === stage.id && dropTarget.index === cardIndex}
                    canMoveCards={canMoveCards}
                    canEditCards={canEditCards}
                    canDeleteCards={canDeleteCards}
                    onViewLead={onViewLead}
                    onEditLead={onEditLead}
                    onDeleteLead={onDeleteLead}
                    onDragStartCard={handleCardDragStart}
                    onDragEndCard={handleCardDragEnd}
                    onDragOverCard={handleCardDragOver}
                    onDropCard={handleCardDrop}
                    onMoveCard={handleCardMoveSelect}
                  />
                ))}

                {dropTarget?.stageId === stage.id && dropTarget.index === stage.cards.length ? <div className="kanbanEndDropMarker" /> : null}
                {!stage.cards.length ? <div className="kanbanEmptyColumn">Solte um card aqui</div> : null}
                {stage.hasMore ? (
                  <button className="kanbanLoadMore" type="button" onClick={() => void loadMore(stage)} disabled={isSaving}>
                    Carregar mais ({Math.max(0, stage.filteredCardCount - stage.cards.length).toLocaleString("pt-BR")})
                  </button>
                ) : null}
              </div>
            </section>
          );
        })}

        {canManagePipeline ? (
          <section
            className={`kanbanAddStageColumn ${newStageInlineOpen ? "isOpen" : ""} ${draggedStage && stageDropIndex === (board?.stages.length || 0) && stageDropIndex !== draggedStage.sourceIndex + 1 ? "kanbanStageDropBefore" : ""}`}
            onDragOver={setLastStageReorderTarget}
            onDrop={(event) => void handleStageDrop(event, board?.stages.length || 0)}
          >
            {!newStageInlineOpen ? (
              <button
                className="kanbanAddStageTrigger"
                type="button"
                onClick={() => void (async () => {
                  if (!(await confirmDiscardCurrentStageChanges())) return;
                  setEditingStageId("");
                  resetNewStageForm();
                  setNewStageInlineOpen(true);
                })()}
              >
                <span>＋</span>
                <strong>Nova etapa</strong>
                <small>Adicionar ao final do funil</small>
              </button>
            ) : (
              <form
                className="kanbanInlineNewStageForm"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addStage();
                }}
              >
                <div className="kanbanInlineStageEditorTitle">
                  <div><strong>Nova etapa</strong><span>Será adicionada ao final do funil</span></div>
                  <button type="button" onClick={resetNewStageForm} aria-label="Fechar nova etapa">×</button>
                </div>

                <label className="kanbanInlineStageField">
                  <span>Nome da etapa</span>
                  <input autoFocus value={newStageName} maxLength={160} onChange={(event) => setNewStageName(event.target.value)} placeholder="Ex.: Qualificação" />
                </label>

                <div className="kanbanInlineStageGrid">
                  <label className="kanbanInlineStageField kanbanInlineColorField">
                    <span>Cor</span>
                    <input type="color" value={newStageColor} onChange={(event) => setNewStageColor(event.target.value.toUpperCase())} aria-label="Cor da nova etapa" />
                  </label>
                  <label className="kanbanInlineStageField">
                    <span>Tipo</span>
                    <select value={newStageType} onChange={(event) => {
                      const stageType = event.target.value as KanbanStageType;
                      setNewStageType(stageType);
                      if (stageType !== "open") setNewStageStatusKey("");
                    }}>
                      <option value="open">Em aberto</option>
                      <option value="won">Ganho</option>
                      <option value="lost">Perdido</option>
                    </select>
                  </label>
                  <label className="kanbanInlineStageField">
                    <span>Limite WIP</span>
                    <input type="number" min="0" value={newStageWip} onChange={(event) => setNewStageWip(Math.max(0, Number(event.target.value)))} />
                  </label>
                </div>

                <label className="kanbanInlineStageField">
                  <span>Status vinculado</span>
                  <select
                    value={newStageType === "open" ? newStageStatusKey : newStageType === "won" ? "Fechado" : "Perdido"}
                    disabled={newStageType !== "open"}
                    onChange={(event) => setNewStageStatusKey(event.target.value as "" | LeadStatus)}
                  >
                    {newStageType === "open"
                      ? OPEN_STAGE_STATUS_OPTIONS.map((option) => <option key={option.value || "none"} value={option.value}>{option.label}</option>)
                      : <option value={newStageType === "won" ? "Fechado" : "Perdido"}>{newStageType === "won" ? "Fechado" : "Perdido"}</option>}
                  </select>
                </label>

                <div className="kanbanInlineStageFooter kanbanInlineNewStageFooter">
                  <button className="secondaryButton" type="button" onClick={resetNewStageForm} disabled={isSaving}>Cancelar</button>
                  <button className="primaryButton" type="submit" disabled={isSaving || newStageName.trim().length < 2}>Adicionar etapa</button>
                </div>
              </form>
            )}
          </section>
        ) : null}
      </div>

      {createPipelineOpen ? (
        <Modal title="Criar novo funil" description="Você poderá editar, reordenar e remover as etapas depois." onClose={() => setCreatePipelineOpen(false)}>
          <div className="kanbanFormGrid">
            <label>
              <span>Nome do funil</span>
              <input autoFocus value={newPipelineName} onChange={(event) => setNewPipelineName(event.target.value)} placeholder="Ex.: Vendas de mentorias" maxLength={160} />
            </label>
            <label className="kanbanCheckboxRow">
              <input type="checkbox" checked={copyCurrentStages} onChange={(event) => setCopyCurrentStages(event.target.checked)} />
              <span>Copiar as etapas do funil atual</span>
            </label>
          </div>
          <div className="kanbanModalFooter">
            <button className="secondaryButton" type="button" onClick={() => setCreatePipelineOpen(false)}>Cancelar</button>
            <button className="primaryButton" type="button" disabled={isSaving || newPipelineName.trim().length < 2} onClick={() => void handleCreatePipeline()}>Criar funil</button>
          </div>
        </Modal>
      ) : null}

      {settingsOpen && board ? (
        <Modal title="Opções do funil" description="As etapas agora são editadas diretamente nos cabeçalhos do Kanban." onClose={() => setSettingsOpen(false)}>
          <section className="kanbanSettingsSection">
            <div className="kanbanSettingsTitle"><h4>Funil</h4><span>{board.pipeline.cardCount.toLocaleString("pt-BR")} card(s)</span></div>
            <div className="kanbanInlineForm">
              <input value={pipelineNameDraft} onChange={(event) => setPipelineNameDraft(event.target.value)} maxLength={160} />
              <button className="secondaryButton" type="button" onClick={() => void savePipelineName()} disabled={isSaving}>Salvar nome</button>
              {!board.pipeline.isDefault ? <button className="secondaryButton" type="button" onClick={() => void makeDefaultPipeline()} disabled={isSaving}>Tornar padrão</button> : null}
            </div>
          </section>

          <div className="kanbanPipelineOptionsHint">
            <strong>Editar etapas</strong>
            <span>Clique no nome ou no botão ••• de qualquer coluna. Para criar uma nova etapa, use o cartão “Nova etapa” ao final do Kanban.</span>
          </div>

          <div className="kanbanModalFooter kanbanDangerFooter">
            {!board.pipeline.isDefault ? <button className="dangerTextButton" type="button" onClick={() => void archivePipeline()} disabled={isSaving}>Arquivar funil</button> : <span>O funil padrão não pode ser arquivado.</span>}
            <button className="primaryButton" type="button" onClick={() => setSettingsOpen(false)}>Concluir</button>
          </div>
        </Modal>
      ) : null}

      {stageToDelete && board ? (
        <Modal title={`Remover etapa “${stageToDelete.name}”`} description={stageToDelete.cardCount ? "Escolha para onde os cards desta etapa serão movidos." : "A etapa está vazia e pode ser removida com segurança."} onClose={() => setStageToDelete(null)}>
          {stageToDelete.cardCount > 0 ? (
            <label className="kanbanSingleField"><span>Etapa de destino</span><select value={deleteTargetStageId} onChange={(event) => setDeleteTargetStageId(event.target.value)}>{board.stages.filter((stage) => stage.id !== stageToDelete.id).map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>
          ) : null}
          <div className="kanbanModalFooter">
            <button className="secondaryButton" type="button" onClick={() => setStageToDelete(null)}>Cancelar</button>
            <button className="dangerButton" type="button" onClick={() => void confirmStageDelete()} disabled={isSaving || (stageToDelete.cardCount > 0 && !deleteTargetStageId)}>Remover etapa</button>
          </div>
        </Modal>
      ) : null}

      {addLeadsOpen && board ? (
        <Modal title="Adicionar cards ao funil" description="A busca consulta a base completa. Ao adicionar, o lead sai do funil anterior e entra neste." onClose={() => setAddLeadsOpen(false)} wide>
          <div className="kanbanAddLeadsToolbar">
            <label><span>Buscar lead</span><input autoFocus type="search" value={leadSearch} onChange={(event) => setLeadSearch(event.target.value)} placeholder="Nome, empresa, telefone ou e-mail" /></label>
            <label><span>Etapa de entrada</span><select value={addToStageId} onChange={(event) => setAddToStageId(event.target.value)}>{board.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>
          </div>

          <div className="kanbanLeadPickerList">
            {isSearchingLeads ? <div className="kanbanPickerState">Buscando na base completa...</div> : null}
            {!isSearchingLeads && !leadSearchResults.length ? <div className="kanbanPickerState">Nenhum lead fora deste funil foi encontrado.</div> : null}
            {leadSearchResults.map((lead) => (
              <label className="kanbanLeadPickerRow" key={lead.id}>
                <input type="checkbox" checked={selectedLeadIds.has(lead.id)} onChange={() => toggleLeadSelection(lead.id)} />
                <span className="kanbanLeadPickerIdentity"><strong>{lead.name || lead.phone || "Lead sem nome"}</strong><small>{lead.company || lead.email || lead.phone || "Sem identificação complementar"}</small></span>
                <span className="kanbanLeadPickerOrigin"><small>Origem atual</small><strong>{lead.pipelineName} · {lead.stageName}</strong></span>
              </label>
            ))}
          </div>

          <div className="kanbanModalFooter">
            <span>{selectedLeadIds.size} selecionado(s)</span>
            <button className="secondaryButton" type="button" onClick={() => setAddLeadsOpen(false)}>Cancelar</button>
            <button className="primaryButton" type="button" onClick={() => void assignSelectedLeads()} disabled={isSaving || !selectedLeadIds.size || !addToStageId}>Adicionar ao funil</button>
          </div>
        </Modal>
      ) : null}

      {confirmationDialog}
    </div>
  );
});
