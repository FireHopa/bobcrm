import { sqlDateColumn } from "./dateColumns.js";

export function buildTodayTemporalSql(useDateColumns = false) {
  const taskDueColumn = sqlDateColumn("t", "due_at", "due_at_dt", useDateColumns);
  const taskCompletedColumn = sqlDateColumn("t", "completed_at", "completed_at_dt", useDateColumns);
  const rankedTaskDueColumn = useDateColumns ? "due_at_dt" : "due_at";
  const leadUpdatedColumn = sqlDateColumn("l", "updated_at", "updated_at_dt", useDateColumns);
  const overdue = useDateColumns
    ? `${taskDueColumn} < CURDATE()`
    : `LEFT(${taskDueColumn}, 10) < DATE_FORMAT(CURDATE(), '%Y-%m-%d')`;
  const today = useDateColumns
    ? `${taskDueColumn} >= CURDATE() AND ${taskDueColumn} < DATE_ADD(CURDATE(), INTERVAL 1 DAY)`
    : `LEFT(${taskDueColumn}, 10) = DATE_FORMAT(CURDATE(), '%Y-%m-%d')`;
  const upcoming = useDateColumns
    ? `${taskDueColumn} >= DATE_ADD(CURDATE(), INTERVAL 1 DAY)`
    : `LEFT(${taskDueColumn}, 10) > DATE_FORMAT(CURDATE(), '%Y-%m-%d')`;
  const completedToday = useDateColumns
    ? `${taskCompletedColumn} >= CURDATE() AND ${taskCompletedColumn} < DATE_ADD(CURDATE(), INTERVAL 1 DAY)`
    : `LEFT(${taskCompletedColumn}, 10) = DATE_FORMAT(CURDATE(), '%Y-%m-%d')`;
  const stalled = useDateColumns
    ? `${leadUpdatedColumn} < DATE_SUB(CURDATE(), INTERVAL 7 DAY)`
    : `LEFT(${leadUpdatedColumn}, 10) < DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 7 DAY), '%Y-%m-%d')`;
  const withoutNextStep = useDateColumns
    ? "l.next_contact_at_dt IS NULL"
    : "TRIM(COALESCE(l.next_contact_at, '')) = ''";

  return {
    taskDueColumn,
    buildTaskCountSql(taskAccessClause) {
      return `SELECT
       SUM(CASE WHEN t.status = 'pending' AND ${overdue} THEN 1 ELSE 0 END) AS overdue,
       SUM(CASE WHEN t.status = 'pending' AND ${today} THEN 1 ELSE 0 END) AS today,
       SUM(CASE WHEN t.status = 'pending' AND ${upcoming} THEN 1 ELSE 0 END) AS upcoming,
       SUM(CASE WHEN t.status = 'pending' AND t.type = 'reuniao' AND ${today} THEN 1 ELSE 0 END) AS meetings_today,
       SUM(CASE WHEN t.status = 'completed' AND ${completedToday} THEN 1 ELSE 0 END) AS completed_today
     FROM tasks t
     WHERE ${taskAccessClause}`;
    },

    buildTaskListsSql(taskAccessClause) {
      return `WITH classified AS (
       SELECT t.*, l.name AS lead_name, l.company AS lead_company, l.phone AS lead_phone,
         CASE
           WHEN t.status = 'pending' AND ${overdue} THEN 'overdue'
           WHEN t.status = 'pending' AND ${today} THEN 'today'
           WHEN t.status = 'pending' AND ${upcoming} THEN 'upcoming'
           ELSE ''
         END AS __bucket
       FROM tasks t
       LEFT JOIN leads l ON l.id = t.lead_id
       WHERE ${taskAccessClause} AND t.status = 'pending'
     ), ranked AS (
       SELECT classified.*,
         ROW_NUMBER() OVER (
           PARTITION BY __bucket
           ORDER BY CASE priority WHEN 'urgente' THEN 1 WHEN 'alta' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
                    ${rankedTaskDueColumn} ASC
         ) AS __row_num
       FROM classified
       WHERE __bucket != ''
     )
     SELECT * FROM ranked
     WHERE __row_num <= 12
     ORDER BY FIELD(__bucket, 'overdue', 'today', 'upcoming'), __row_num`;
    },
    buildOperationalSql(leadAccessClause) {
      return `SELECT
       SUM(CASE WHEN l.deleted_at = '' AND l.is_lost = 0 AND l.status = 'Novo lead' AND TRIM(COALESCE(l.contact_made_at, '')) = '' THEN 1 ELSE 0 END) AS awaiting_first_contact,
       SUM(CASE WHEN l.deleted_at = '' AND l.is_lost = 0 AND TRIM(COALESCE(l.responsible_user_id, '')) = '' AND TRIM(COALESCE(l.responsible, '')) = '' THEN 1 ELSE 0 END) AS without_owner,
       SUM(CASE WHEN l.deleted_at = '' AND l.is_lost = 0 AND l.status NOT IN ('Fechado', 'Perdido') AND ${withoutNextStep} THEN 1 ELSE 0 END) AS without_next_step,
       SUM(CASE WHEN l.deleted_at = '' AND l.is_lost = 0 AND l.status NOT IN ('Fechado', 'Perdido') AND ${stalled} THEN 1 ELSE 0 END) AS stalled
     FROM leads l
     WHERE ${leadAccessClause}`;
    },
    teamOverdueSql: `SELECT COALESCE(NULLIF(t.responsible_name, ''), 'Sem responsável') AS responsible_name, COUNT(*) AS total
       FROM tasks t
       WHERE t.status = 'pending' AND ${overdue}
       GROUP BY COALESCE(NULLIF(t.responsible_name, ''), 'Sem responsável')
       ORDER BY total DESC, responsible_name ASC
       LIMIT 12`,
  };
}
