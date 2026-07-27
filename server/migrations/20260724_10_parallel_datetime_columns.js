import { buildIsoToMysqlDateExpression } from "../dateColumns.js";

export const version = "20260724_10_parallel_datetime_columns";
export const description = "Cria colunas DATETIME(3) paralelas e bridge de compatibilidade para leads e tasks";

function triggerAssignments(prefix, fields) {
  return fields
    .map(([legacy, datetime]) => `NEW.${datetime} = ${buildIsoToMysqlDateExpression(`NEW.${legacy}`)}`)
    .join(",\n      ");
}

async function recreateDateTriggers(execute, table, fields) {
  const insertTrigger = `trg_${table}_datetime_bridge_bi`;
  const updateTrigger = `trg_${table}_datetime_bridge_bu`;
  await execute(`DROP TRIGGER IF EXISTS ${insertTrigger}`);
  await execute(`DROP TRIGGER IF EXISTS ${updateTrigger}`);
  await execute(`CREATE TRIGGER ${insertTrigger}
    BEFORE INSERT ON ${table}
    FOR EACH ROW
    SET ${triggerAssignments("NEW", fields)}`);
  await execute(`CREATE TRIGGER ${updateTrigger}
    BEFORE UPDATE ON ${table}
    FOR EACH ROW
    SET ${triggerAssignments("NEW", fields)}`);
}

export async function up({ addColumnIfMissing, addIndexIfMissing, execute }) {
  const leadFields = [
    ["next_contact_at", "next_contact_at_dt"],
    ["expected_close_at", "expected_close_at_dt"],
    ["created_at", "created_at_dt"],
    ["updated_at", "updated_at_dt"],
  ];
  const taskFields = [
    ["due_at", "due_at_dt"],
    ["completed_at", "completed_at_dt"],
    ["created_at", "created_at_dt"],
    ["updated_at", "updated_at_dt"],
  ];

  await addColumnIfMissing("leads", "next_contact_at_dt", "DATETIME(3) NULL AFTER next_contact_at");
  await addColumnIfMissing("leads", "expected_close_at_dt", "DATETIME(3) NULL AFTER expected_close_at");
  await addColumnIfMissing("leads", "created_at_dt", "DATETIME(3) NULL AFTER created_at");
  await addColumnIfMissing("leads", "updated_at_dt", "DATETIME(3) NULL AFTER updated_at");

  await addColumnIfMissing("tasks", "due_at_dt", "DATETIME(3) NULL AFTER due_at");
  await addColumnIfMissing("tasks", "completed_at_dt", "DATETIME(3) NULL AFTER completed_at");
  await addColumnIfMissing("tasks", "created_at_dt", "DATETIME(3) NULL AFTER created_at");
  await addColumnIfMissing("tasks", "updated_at_dt", "DATETIME(3) NULL AFTER updated_at");

  await addIndexIfMissing("leads", "idx_leads_next_contact_dt", "INDEX idx_leads_next_contact_dt (deleted_at, next_contact_at_dt)");
  await addIndexIfMissing("leads", "idx_leads_expected_close_dt", "INDEX idx_leads_expected_close_dt (deleted_at, expected_close_at_dt, responsible_user_id)");
  await addIndexIfMissing("leads", "idx_leads_stalled_dt", "INDEX idx_leads_stalled_dt (deleted_at, is_lost, status, updated_at_dt)");
  await addIndexIfMissing("tasks", "idx_tasks_responsible_due_dt", "INDEX idx_tasks_responsible_due_dt (responsible_user_id, status, due_at_dt)");
  await addIndexIfMissing("tasks", "idx_tasks_status_due_dt", "INDEX idx_tasks_status_due_dt (status, due_at_dt)");
  await addIndexIfMissing("tasks", "idx_tasks_completed_dt", "INDEX idx_tasks_completed_dt (status, completed_at_dt)");

  await recreateDateTriggers(execute, "leads", leadFields);
  await recreateDateTriggers(execute, "tasks", taskFields);
}
