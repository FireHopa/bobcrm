import test from "node:test";
import assert from "node:assert/strict";
import { createHeavyJobSerialExecutor, HEAVY_JOB_TYPES } from "./jobExecutionPolicy.js";

test("jobs pesados são serializados enquanto job leve não entra na fila pesada", async () => {
  const runHeavy = createHeavyJobSerialExecutor();
  let activeHeavy = 0;
  let maxHeavy = 0;
  const order = [];
  const heavy = (id, delay = 15) => runHeavy({ id, type: "import_leads" }, async () => {
    activeHeavy += 1;
    maxHeavy = Math.max(maxHeavy, activeHeavy);
    order.push(`start:${id}`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    order.push(`end:${id}`);
    activeHeavy -= 1;
    return id;
  });
  const light = runHeavy({ id: "light", type: "export_leads_csv" }, async () => "light");
  const results = await Promise.all([heavy("a"), heavy("b"), light]);
  assert.deepEqual(results.sort(), ["a", "b", "light"]);
  assert.equal(maxHeavy, 1);
  assert.deepEqual(order, ["start:a", "end:a", "start:b", "end:b"]);
  assert.equal(HEAVY_JOB_TYPES.has("backup_mysql"), true);
  assert.equal(HEAVY_JOB_TYPES.has("rebuild_search_index"), true);
});
