import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('heavy lead workspace is code-split and drawer is not mounted while closed', () => {
  const app = read('src/App.tsx');
  assert.match(app, /const LeadTable = lazy\(\(\) => import\("\.\/components\/LeadTable"\)/);
  assert.match(app, /\{!handoffLead \? \(/);
  assert.match(app, /selectedLead \? \(/);
  assert.doesNotMatch(app, /import \{ LeadTable \} from "\.\/components\/LeadTable"/);
});

test('lead rows and main lead table are memoized', () => {
  const source = read('src/components/LeadTable.tsx');
  assert.match(source, /const LeadTableRow = memo\(function LeadTableRow/);
  assert.match(source, /export const LeadTable = memo\(function LeadTable/);
  assert.doesNotMatch(source, /<LeadActions\s+leads=\{leads\}/);
});

test('kanban filters are stabilized before reaching the board', () => {
  const source = read('src/components/LeadTable.tsx');
  const board = read('src/components/KanbanBoard.tsx');
  assert.match(source, /const \[kanbanFilters, setKanbanFilters\]/);
  assert.match(source, /setKanbanFilters\(\{/);
  assert.match(source, /filters=\{kanbanFilters\}/);
  assert.match(board, /export const KanbanBoard = memo\(function KanbanBoard/);
  assert.match(board, /const KanbanCardItem = memo\(function KanbanCardItem/);
  assert.match(board, /onDragOverCard=\{handleCardDragOver\}/);
});

test('external kanban refresh reacts only to a new version', () => {
  const source = read('src/features/kanban/useKanbanBoardData.ts');
  assert.match(source, /const lastExternalRefreshVersion = useRef\(externalRefreshVersion\)/);
  assert.match(source, /lastExternalRefreshVersion\.current === externalRefreshVersion/);
  assert.doesNotMatch(source, /window\.setTimeout\(\(\) => \{\s*void loadBoard\(selectedPipelineId\);\s*\}, 180\)/s);
});

test('kanban lead search aborts stale requests', () => {
  const board = read('src/components/KanbanBoard.tsx');
  const api = read('src/utils/api.ts');
  assert.match(board, /leadSearchController = useRef<AbortController \| null>/);
  assert.match(board, /searchLeadsForKanban\(selectedPipelineId, leadSearch, 50, controller\.signal\)/);
  assert.match(api, /signal\?: AbortSignal/);
  assert.match(api, /kanban\/leads\/search\?\$\{query\.toString\(\)\}`, \{ signal \}/);
});

test('opportunity metrics are materialized once per loaded lead render cycle', () => {
  const source = read('src/components/ServiceOpportunityMap.tsx');
  assert.match(source, /const metricsByLeadId = useMemo\(\(\) => new Map\(leads\.map/);
  assert.match(source, /const sortedFilteredLeads = useMemo/);
  assert.doesNotMatch(source, /function sortOpportunityLeads/);
});

test('global search submit does not launch a second direct list request', () => {
  const app = read('src/App.tsx');
  const match = app.match(/const handleGlobalSearchSubmit = useCallback\(\(value: string\) => \{([\s\S]*?)\}, \[\]\);/);
  assert.ok(match, 'handleGlobalSearchSubmit not found');
  assert.doesNotMatch(match[1], /loadLeadsFromServer/);
});

test('offscreen kanban and opportunity cards use browser rendering containment', () => {
  const css = read('src/styles/phase11-performance.css');
  const main = read('src/main.tsx');
  assert.match(css, /content-visibility:\s*auto/);
  assert.match(css, /contain-intrinsic-size/);
  assert.match(main, /phase11-performance\.css/);
});
