import test from "node:test";
import assert from "node:assert/strict";
import { description, up, version } from "./20260827_24_runtime_process_heartbeat.js";

test("migração cria tabela compartilhada de heartbeat dos processos", async () => {
  const statements = [];
  await up({ execute: async (sql) => statements.push(sql) });

  assert.equal(version, "20260827_24_runtime_process_heartbeat");
  assert.match(description, /heartbeat/i);
  assert.equal(statements.length, 1);
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS runtime_process_heartbeats/i);
  assert.match(statements[0], /PRIMARY KEY \(role\)/i);
  assert.match(statements[0], /heartbeat_at DATETIME\(3\)/i);
});
