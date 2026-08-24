import type { Lead } from "./Lead";

export type KanbanStageType = "open" | "won" | "lost";

export type KanbanStage = {
  id: string;
  pipelineId: string;
  name: string;
  color: string;
  position: number;
  stageType: KanbanStageType;
  statusKey: string;
  wipLimit: number;
  isArchived: boolean;
  cardCount: number;
  createdAt: string;
  updatedAt: string;
};

export type KanbanPipeline = {
  id: string;
  name: string;
  isDefault: boolean;
  isArchived: boolean;
  position: number;
  cardCount: number;
  createdAt: string;
  updatedAt: string;
  stages: KanbanStage[];
};

export type KanbanStageColumn = KanbanStage & {
  filteredCardCount: number;
  cards: Lead[];
  hasMore: boolean;
};

export type KanbanBoardData = {
  pipeline: KanbanPipeline;
  stages: KanbanStageColumn[];
  filtersTotal: number;
  limitPerStage: number;
};

export type KanbanBoardFilters = {
  search?: string;
  status?: string;
  temperature?: string;
  responsible?: string;
  nextStepDateFilter?: string;
  nextStepFrom?: string;
  nextStepTo?: string;
  expectedCloseDateFilter?: string;
  expectedCloseFrom?: string;
  expectedCloseTo?: string;
  quickFilter?: string;
};

export type KanbanLeadSearchResult = Lead & {
  pipelineName: string;
  stageName: string;
};
