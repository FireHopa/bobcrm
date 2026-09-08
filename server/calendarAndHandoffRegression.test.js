import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("calendário brasileiro usa portal no body e não é recortado por modais/drawers", () => {
  const component = read("src/components/BrDateInput.tsx");
  const styles = read("src/styles.css");

  assert.match(component, /import \{ createPortal \} from "react-dom"/);
  assert.match(component, /popoverRef/);
  assert.match(component, /createPortal\(/);
  assert.match(component, /document\.body/);
  assert.match(component, /window\.addEventListener\("scroll", handleViewportChange, true\)/);
  assert.match(styles, /\.brDatePopover \{[\s\S]*position:\s*fixed/);
  assert.match(styles, /\.brDatePopover \{[\s\S]*z-index:\s*2147483647/);
});

test("encaminhamento abre com lead fresco e revalida antes do POST", () => {
  const app = read("src/App.tsx");
  const dialog = read("src/components/LeadHandoffDialog.tsx");

  assert.match(app, /const openLeadHandoff = useCallback\(async \(lead: Lead\)/);
  assert.match(app, /const freshLead = await fetchLeadByIdFromServer\(lead\.id\)/);
  assert.match(dialog, /let freshLead = await fetchLeadByIdFromServer\(lead\.id\)/);
  assert.match(dialog, /hasMeaningfulHandoffConflict\(lead, freshLead\)/);
  assert.match(dialog, /caughtError\.code !== "STALE_WRITE_CONFLICT"/);
  assert.match(dialog, /const latestLead = await fetchLeadByIdFromServer\(lead\.id\)/);
});


test("refresh de tarefas só altera updated_at quando o próximo contato realmente muda", () => {
  const backend = read("server/index.js");
  assert.match(backend, /COALESCE\(next_contact_at, ''\) <> \?/);
  assert.match(backend, /\[nextDueAt, nowIso\(\), normalizedLeadId, nextDueAt\]/);
});
