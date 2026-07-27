import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const serverSource = read("server/index.js");
const ecosystemSource = read("ecosystem.config.cjs");
const envSource = read("server/.env.example");
const queueSource = read("server/jobQueue.js");
const runtimeRoleSource = read("server/runtimeRole.js");

test("PM2 separa API e worker em processos distintos", () => {
  assert.match(ecosystemSource, /crm-casa-ads-api/);
  assert.match(ecosystemSource, /PROCESS_ROLE:\s*"api"/);
  assert.match(ecosystemSource, /crm-casa-ads-worker/);
  assert.match(ecosystemSource, /PROCESS_ROLE:\s*"worker"/);
  assert.equal((ecosystemSource.match(/script:\s*"server\/index\.js"/g) || []).length, 2);
});

test("API não inicia worker local e worker não inicia HTTP nem migrations", () => {
  assert.match(serverSource, /if \(PROCESS_CAPABILITIES\.runsJobWorker\) \{\s*await startPersistentJobWorker\(\)/);
  assert.match(serverSource, /if \(PROCESS_CAPABILITIES\.runsHttpServer\) \{[\s\S]*?createServer/);
  assert.match(serverSource, /initializeDatabase\(\{ manageSchema: PROCESS_CAPABILITIES\.managesSchema \}\)/);
  assert.match(serverSource, /if \(manageSchema\) \{[\s\S]*?runSchemaMigrations\(\)/);
  assert.match(serverSource, /WORKER_SCHEMA_NOT_READY/);
});

test("pools de conexão são independentes por papel sem ampliar o default total", () => {
  assert.match(serverSource, /MYSQL_API_CONNECTION_LIMIT", 8/);
  assert.match(serverSource, /MYSQL_WORKER_CONNECTION_LIMIT", 2/);
  assert.match(serverSource, /connectionLimit: MYSQL_POOL_CONNECTION_LIMIT/);
  assert.match(envSource, /MYSQL_API_CONNECTION_LIMIT=8/);
  assert.match(envSource, /MYSQL_WORKER_CONNECTION_LIMIT=2/);
});

test("worker standalone mantém polling referenciado e API aceita worker externo", () => {
  assert.match(queueSource, /unrefTimers = true/);
  assert.match(queueSource, /if \(unrefTimers\) timer\.unref/);
  assert.match(serverSource, /unrefTimers: PROCESS_ROLE !== PROCESS_ROLES\.WORKER/);
  assert.match(runtimeRoleSource, /workerMode: localWorkerRequired \? "local" : "external"/);
  assert.match(runtimeRoleSource, /const workerReady = localWorkerRequired \? Boolean\(worker\) : true/);
});
