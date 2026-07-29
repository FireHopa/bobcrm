import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./operational-integrity.mjs", import.meta.url), "utf8");

test("auditoria de integridade é read-only por padrão e separa reparo explícito", () => {
  assert.match(source, /const REPAIR = process\.argv\.includes\("--repair"\)/);
  assert.match(source, /pendingTasksOnDeletedLeads/);
  assert.match(source, /orphanTasks/);
  assert.match(source, /leadsWithInactiveOwner/);
  assert.match(source, /duplicateKanbanPositions/);
  assert.match(source, /staleRunningJobs/);
  assert.match(source, /nextContactMismatches/);
  assert.match(source, /REPAIR \? await repairSafeIssues/);
});

test("reparo seguro usa transação e não redistribui responsáveis automaticamente", () => {
  assert.match(source, /beginTransaction\(\)/);
  assert.match(source, /status = 'canceled'/);
  assert.match(source, /SET l\.next_contact_at/);
  assert.doesNotMatch(source, /SET l\.responsible_user_id/);
  assert.match(source, /rollback\(\)/);
});
