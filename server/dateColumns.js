const TABLE_DATE_FIELDS = Object.freeze({
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

export const DATETIME_TABLE_FIELDS = TABLE_DATE_FIELDS;

export function qualifyColumn(alias, name) {
  return alias ? `${alias}.${name}` : name;
}

export function sqlDateColumn(alias, legacyColumn, datetimeColumn, useDateColumns = false) {
  return qualifyColumn(alias, useDateColumns ? datetimeColumn : legacyColumn);
}

export function buildLegacyDatePredicate(alias, legacyColumn, operator, rhsSql) {
  const column = qualifyColumn(alias, legacyColumn);
  return `LEFT(${column}, 10) ${operator} ${rhsSql}`;
}

export function buildDatePredicate(alias, legacyColumn, datetimeColumn, operator, rhsSql, useDateColumns = false) {
  if (!useDateColumns) return buildLegacyDatePredicate(alias, legacyColumn, operator, rhsSql);
  return `${qualifyColumn(alias, datetimeColumn)} ${operator} ${rhsSql}`;
}

export function buildDatePresentPredicate(alias, legacyColumn, datetimeColumn, useDateColumns = false) {
  if (useDateColumns) return `${qualifyColumn(alias, datetimeColumn)} IS NOT NULL`;
  const column = qualifyColumn(alias, legacyColumn);
  return `TRIM(COALESCE(${column}, '')) != ''`;
}

export function buildDateMissingPredicate(alias, legacyColumn, datetimeColumn, useDateColumns = false) {
  if (useDateColumns) return `${qualifyColumn(alias, datetimeColumn)} IS NULL`;
  const column = qualifyColumn(alias, legacyColumn);
  return `TRIM(COALESCE(${column}, '')) = ''`;
}

export function buildIsoToMysqlDateExpression(columnExpression) {
  const value = `TRIM(COALESCE(${columnExpression}, ''))`;
  return `CASE
    WHEN ${value} = '' THEN NULL
    WHEN ${value} REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      THEN STR_TO_DATE(${value}, '%Y-%m-%d')
    WHEN ${value} REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{1,6}'
      THEN STR_TO_DATE(REPLACE(SUBSTRING(${value}, 1, 26), 'T', ' '), '%Y-%m-%d %H:%i:%s.%f')
    WHEN ${value} REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}'
      THEN STR_TO_DATE(REPLACE(SUBSTRING(${value}, 1, 19), 'T', ' '), '%Y-%m-%d %H:%i:%s')
    ELSE NULL
  END`;
}

function pendingClause(tableAlias, fields) {
  return fields
    .map(([legacy, datetime]) => `(TRIM(COALESCE(${tableAlias}.${legacy}, '')) != '' AND ${tableAlias}.${datetime} IS NULL)`)
    .join(" OR ");
}

export function createDateColumnRuntime({ queryFirst, logger = console }) {
  let ready = false;

  return {
    isReady() {
      return ready;
    },

    async refreshReadiness({ logTransition = false, client } = {}) {
      if (ready) return true;
      const pending = await queryFirst(
        `SELECT id, source FROM (
           SELECT l.id, 'leads' AS source FROM leads l
            WHERE ${pendingClause("l", TABLE_DATE_FIELDS.leads)}
           UNION ALL
           SELECT t.id, 'tasks' AS source FROM tasks t
            WHERE ${pendingClause("t", TABLE_DATE_FIELDS.tasks)}
         ) pending_dates LIMIT 1`,
        [],
        client,
      );
      const nextReady = !pending;
      if (logTransition && nextReady !== ready) {
        logger.log(nextReady
          ? "Colunas DATETIME(3): ATIVAS. Filtros temporais usarão campos indexáveis."
          : "Colunas DATETIME(3): EM BACKFILL. Filtros temporais permanecem no modo VARCHAR até concluir e validar 100% dos registros.");
      }
      ready = nextReady;
      return ready;
    },
  };
}
