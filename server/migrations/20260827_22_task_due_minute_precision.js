import { buildIsoToMysqlDateExpression } from "../dateColumns.js";

export const version = "20260827_22_task_due_minute_precision";
export const description = "Corrige bridge DATETIME para horários com precisão de minuto e recupera tarefas fora da Tela Hoje";

const TABLE_FIELDS = Object.freeze({
  leads: Object.freeze([
    ["next_contact_at", "next_contact_at_dt"],
    ["expected_close_at", "expected_close_at_dt"],
    ["created_at", "created_at_dt"],
    ["updated_at", "updated_at_dt"],
  ]),
  tasks: Object.freeze([
    ["due_at", "due_at_dt"],
    ["completed_at", "completed_at_dt"],
    ["created_at", "created_at_dt"],
    ["updated_at", "updated_at_dt"],
  ]),
});

function triggerAssignments(fields) {
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
    SET ${triggerAssignments(fields)}`);
  await execute(`CREATE TRIGGER ${updateTrigger}
    BEFORE UPDATE ON ${table}
    FOR EACH ROW
    SET ${triggerAssignments(fields)}`);
}

async function backfillMissingDateColumns(execute, table, fields) {
  const assignments = fields
    .map(([legacy, datetime]) => `${datetime} = CASE
      WHEN ${datetime} IS NULL AND TRIM(COALESCE(${legacy}, '')) != ''
        THEN ${buildIsoToMysqlDateExpression(legacy)}
      ELSE ${datetime}
    END`)
    .join(",\n      ");
  const pending = fields
    .map(([legacy, datetime]) => `(${datetime} IS NULL AND TRIM(COALESCE(${legacy}, '')) != '')`)
    .join(" OR ");
  await execute(`UPDATE ${table}
    SET ${assignments}
    WHERE ${pending}`);
}

export async function up({ execute }) {
  for (const [table, fields] of Object.entries(TABLE_FIELDS)) {
    await recreateDateTriggers(execute, table, fields);
    await backfillMissingDateColumns(execute, table, fields);
  }
}
