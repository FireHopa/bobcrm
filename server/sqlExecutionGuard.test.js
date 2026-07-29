import test from "node:test";
import assert from "node:assert/strict";
import { isMysqlStatementTimeout, withMaxExecutionTimeHint } from "./sqlExecutionGuard.js";

test("injeta MAX_EXECUTION_TIME apenas em SELECT", () => {
  assert.match(withMaxExecutionTimeHint("SELECT id FROM leads", 4000), /SELECT \/\*\+ MAX_EXECUTION_TIME\(4000\) \*\//);
  assert.equal(withMaxExecutionTimeHint("UPDATE leads SET name = ?", 4000), "UPDATE leads SET name = ?");
  assert.equal(withMaxExecutionTimeHint("SELECT 1", 0), "SELECT 1");
});

test("limita timeout e reconhece códigos MySQL/MariaDB", () => {
  assert.match(withMaxExecutionTimeHint("SELECT 1", 999999), /MAX_EXECUTION_TIME\(60000\)/);
  assert.equal(isMysqlStatementTimeout({ code: "ER_QUERY_TIMEOUT" }), true);
  assert.equal(isMysqlStatementTimeout({ errno: 1969 }), true);
  assert.equal(isMysqlStatementTimeout({ code: "ER_PARSE_ERROR" }), false);
});
