import { buildIsoToMysqlDateExpression } from "../dateColumns.js";

export const version = "20260727_11_fix_datetime_bridge_iso8601";
export const description = "Corrige triggers DATETIME(3) para ISO-8601 com Z e milissegundos";

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

export async function up({ execute }) {
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

  await recreateDateTriggers(execute, "leads", leadFields);
  await recreateDateTriggers(execute, "tasks", taskFields);
}
