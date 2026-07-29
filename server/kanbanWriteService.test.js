import test from "node:test";
import assert from "node:assert/strict";
import { createKanbanWriteService } from "./kanbanWriteService.js";

test("rebalance atualiza posições em CASE por lote", async () => {
  const updates = [];
  const service = createKanbanWriteService({
    queryRows: async () => [{ id: "a" }, { id: "b" }, { id: "c" }],
    execute: async (sql, params) => { updates.push({ sql, params }); return { affectedRows: 3 }; },
    scalar: async () => 0,
    getLeadAccessContext: async () => ({}),
    getKanbanStageById: async () => null,
    getStageStatusUpdate: () => ({ status: "Novo lead", isLost: 0 }),
    recordAudit: async () => undefined,
    nowIso: () => "2026-07-27T12:00:00.000Z",
  });
  await service.rebalanceStagePositions("stage", {});
  assert.equal(updates.length, 1);
  assert.match(updates[0].sql, /CASE id/);
  assert.deepEqual(updates[0].params.slice(0, 6), ["a", 1000, "b", 2000, "c", 3000]);
});

test("bulk assign valida todos os cards e faz um único UPDATE de leads", async () => {
  const executed = [];
  const audits = [];
  const rows = [
    { id: "lead-a", name: "A", status: "Novo lead", responsible_user_id: "admin", deleted_at: "", created_at: "2026-07-27T12:00:00.000Z", updated_at: "2026-07-27T12:00:00.000Z" },
    { id: "lead-b", name: "B", status: "Novo lead", responsible_user_id: "admin", deleted_at: "", created_at: "2026-07-27T12:00:00.000Z", updated_at: "2026-07-27T12:00:00.000Z" },
  ];
  const service = createKanbanWriteService({
    queryRows: async (sql) => {
      if (/SELECT l\.\*/.test(sql)) return rows;
      if (/SELECT \* FROM leads/.test(sql)) return rows.map((row) => ({ ...row, pipeline_id: "pipe", pipeline_stage_id: "stage" }));
      return [];
    },
    execute: async (sql, params) => { executed.push({ sql, params }); return { affectedRows: 2 }; },
    scalar: async () => 5000,
    getLeadAccessContext: async (user) => ({ user, teamMembers: [] }),
    getKanbanStageById: async () => ({ id: "stage", pipeline_id: "pipe", name: "Contato feito", stage_type: "open", status_key: "Contato feito" }),
    getStageStatusUpdate: () => ({ status: "Contato feito", isLost: 0 }),
    recordAudit: async (entry) => { audits.push(entry); },
    nowIso: () => "2026-07-27T12:00:00.000Z",
  });

  const result = await service.assignCardsInBulk({
    currentUser: { id: "admin", name: "Admin", role: "admin" },
    leadIds: ["lead-a", "lead-b"],
    pipelineId: "pipe",
    stageId: "stage",
  }, {});

  const leadUpdates = executed.filter((entry) => /UPDATE leads SET pipeline_id/.test(entry.sql));
  assert.equal(leadUpdates.length, 1);
  assert.match(leadUpdates[0].sql, /kanban_position = CASE id/);
  assert.equal(result.length, 2);
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0].changes.leadIds, ["lead-a", "lead-b"]);
});
