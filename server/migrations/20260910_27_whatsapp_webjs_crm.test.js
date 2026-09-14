import test from "node:test";
import assert from "node:assert/strict";
import { up, version } from "./20260910_27_whatsapp_webjs_crm.js";

test("whatsapp webjs migration creates session and inbound idempotency tables", async () => {
  const statements = [];
  await up({ execute: async (sql) => { statements.push(sql); } });
  assert.equal(version, "20260910_27_whatsapp_webjs_crm");
  assert.equal(statements.length, 2);
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS whatsapp_accounts/i);
  assert.match(statements[0], /PRIMARY KEY/i);
  assert.match(statements[0], /FOREIGN KEY \(user_id\) REFERENCES users\(id\)/i);
  assert.match(statements[1], /CREATE TABLE IF NOT EXISTS whatsapp_inbound_events/i);
  assert.match(statements[1], /message_id VARCHAR\(191\) NOT NULL PRIMARY KEY/i);
  assert.match(statements[1], /idx_whatsapp_inbound_phone/i);
});
