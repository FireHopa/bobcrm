import { useCallback, useEffect, useRef, useState } from "react";
import type { KanbanBoardData, KanbanBoardFilters, KanbanPipeline } from "../../types/Kanban";
import { fetchKanbanBoard, fetchKanbanPipelines } from "../../utils/api";

const PIPELINE_STORAGE_KEY = "crmCasaAdsKanbanPipeline";
const INITIAL_CARDS_PER_STAGE = 30;

type UseKanbanBoardDataOptions = {
  filters: KanbanBoardFilters;
  externalRefreshVersion: number;
  onBoardLoaded?: (board: KanbanBoardData) => void;
};

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function useKanbanBoardData({ filters, externalRefreshVersion, onBoardLoaded }: UseKanbanBoardDataOptions) {
  const [pipelines, setPipelines] = useState<KanbanPipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineIdState] = useState(() => localStorage.getItem(PIPELINE_STORAGE_KEY) || "");
  const [board, setBoard] = useState<KanbanBoardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const externalRefreshInitialized = useRef(false);
  const lastExternalRefreshVersion = useRef(externalRefreshVersion);
  const boardRequestController = useRef<AbortController | null>(null);

  const setSelectedPipelineId = useCallback((pipelineId: string) => {
    setSelectedPipelineIdState(pipelineId);
    if (pipelineId) localStorage.setItem(PIPELINE_STORAGE_KEY, pipelineId);
    else localStorage.removeItem(PIPELINE_STORAGE_KEY);
  }, []);

  const loadPipelines = useCallback(async (preferredPipelineId = "") => {
    const result = await fetchKanbanPipelines();
    setPipelines(result);
    const storedPipelineId = preferredPipelineId || selectedPipelineId;
    const nextPipeline = result.find((pipeline) => pipeline.id === storedPipelineId)
      || result.find((pipeline) => pipeline.isDefault)
      || result[0];
    setSelectedPipelineId(nextPipeline?.id || "");
    return nextPipeline?.id || "";
  }, [selectedPipelineId, setSelectedPipelineId]);

  const loadBoard = useCallback(async (pipelineId: string) => {
    if (!pipelineId) return;

    boardRequestController.current?.abort();
    const controller = new AbortController();
    boardRequestController.current = controller;
    setIsLoading(true);
    setError("");

    try {
      const stableFilters: KanbanBoardFilters = {
        search: filters.search || "",
        status: filters.status || "",
        temperature: filters.temperature || "",
        responsible: filters.responsible || "",
        quickFilter: filters.quickFilter || "",
      };
      const result = await fetchKanbanBoard(pipelineId, stableFilters, INITIAL_CARDS_PER_STAGE, controller.signal);
      if (controller.signal.aborted) return;
      setBoard(result);
      onBoardLoaded?.(result);
    } catch (caughtError) {
      if (!isAbortError(caughtError)) {
        setError(caughtError instanceof Error ? caughtError.message : "Não foi possível carregar o funil.");
      }
    } finally {
      if (boardRequestController.current === controller) {
        boardRequestController.current = null;
        setIsLoading(false);
      }
    }
  }, [filters.search, filters.status, filters.temperature, filters.responsible, filters.quickFilter, onBoardLoaded]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    void fetchKanbanPipelines(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setPipelines(result);
        const storedPipelineId = localStorage.getItem(PIPELINE_STORAGE_KEY) || "";
        const nextPipeline = result.find((pipeline) => pipeline.id === storedPipelineId)
          || result.find((pipeline) => pipeline.isDefault)
          || result[0];
        if (nextPipeline) setSelectedPipelineId(nextPipeline.id);
        else setIsLoading(false);
      })
      .catch((caughtError) => {
        if (!controller.signal.aborted && !isAbortError(caughtError)) {
          setError(caughtError instanceof Error ? caughtError.message : "Não foi possível carregar os funis.");
          setIsLoading(false);
        }
      });
    return () => controller.abort();
  }, [setSelectedPipelineId]);

  useEffect(() => {
    if (!selectedPipelineId) return;
    void loadBoard(selectedPipelineId);
  }, [selectedPipelineId, loadBoard]);

  useEffect(() => {
    if (!externalRefreshInitialized.current) {
      externalRefreshInitialized.current = true;
      lastExternalRefreshVersion.current = externalRefreshVersion;
      return;
    }

    if (lastExternalRefreshVersion.current === externalRefreshVersion) return;
    lastExternalRefreshVersion.current = externalRefreshVersion;
    if (selectedPipelineId) void loadBoard(selectedPipelineId);
  }, [externalRefreshVersion, loadBoard, selectedPipelineId]);

  useEffect(() => () => boardRequestController.current?.abort(), []);

  return {
    pipelines,
    setPipelines,
    selectedPipelineId,
    setSelectedPipelineId,
    board,
    setBoard,
    isLoading,
    setIsLoading,
    error,
    setError,
    loadPipelines,
    loadBoard,
  };
}
