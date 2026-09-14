import test from "node:test";
import assert from "node:assert/strict";
import {
  createWhatsappRuntime,
  inboundWhatsappIdentityIds,
  isEligibleInboundLeadMessage,
  normalizeWhatsappPhone,
  phoneFromLidMappings,
  phoneFromWhatsappCandidate,
  sanitizeWhatsappClientId,
  whatsappClientIdForUser,
  whatsappMediaKind,
} from "./whatsappRuntime.js";

test("inbound lead policy accepts only new individual inbound chats", () => {
  assert.equal(isEligibleInboundLeadMessage({ from: "5511999999999@c.us" }), true);
  assert.equal(isEligibleInboundLeadMessage({ from: "123456789@lid" }), true);
  assert.equal(isEligibleInboundLeadMessage({ from: "5511999999999@c.us", fromMe: true }), false);
  assert.equal(isEligibleInboundLeadMessage({ from: "120363000000@g.us" }), false);
  assert.equal(isEligibleInboundLeadMessage({ from: "status@broadcast", isStatus: true }), false);
  assert.equal(isEligibleInboundLeadMessage({ from: "123@newsletter" }), false);
  assert.equal(isEligibleInboundLeadMessage({ from: "123@broadcast", broadcast: true }), false);
});

test("phone normalization and client ids are stable and isolated", () => {
  assert.equal(normalizeWhatsappPhone("+55 (11) 99999-9999"), "5511999999999");
  assert.equal(normalizeWhatsappPhone("0055 11 99999-9999"), "5511999999999");
  assert.equal(sanitizeWhatsappClientId("user/a?b"), "user_a_b");
  assert.equal(whatsappClientIdForUser("user/a?b"), whatsappClientIdForUser("user/a?b"));
  assert.notEqual(whatsappClientIdForUser("user/a?b"), whatsappClientIdForUser("user:a*b"));
  assert.match(whatsappClientIdForUser("user/a?b"), /^consultant-[A-Za-z0-9_-]+-[a-f0-9]{16}$/);
});



test("LID mappings resolve the real phone and never use raw LID digits", () => {
  const lid = "108675624616077@lid";
  assert.equal(phoneFromLidMappings(lid, [{ lid, pn: "5511999999999@c.us" }]), "5511999999999");
  assert.equal(phoneFromLidMappings(lid, [{ lid, pn: "108675624616077@lid" }]), "");
  assert.equal(phoneFromLidMappings(lid, [{ lid, pn: "108675624616077@c.us" }]), "");
  assert.equal(phoneFromWhatsappCandidate("+55 (11) 99999-9999", lid), "5511999999999");
  assert.equal(phoneFromWhatsappCandidate("108675624616077", lid), "");
  assert.equal(phoneFromLidMappings(lid, [{ lid: "another@lid", pn: "5511888888888@c.us" }, { lid: "other@lid", pn: "5511777777777@c.us" }]), "");
  assert.equal(phoneFromLidMappings("5511999999999@c.us", [{ lid, pn: "5511999999999@c.us" }]), "");
});

test("inbound LID remains authoritative even when Contact exposes phone-looking digits", () => {
  assert.deepEqual(
    inboundWhatsappIdentityIds("93102626881759@lid", "93102626881759@c.us"),
    { sourceId: "93102626881759@lid", lidId: "93102626881759@lid", isLid: true },
  );
  assert.deepEqual(
    inboundWhatsappIdentityIds("5511999999999@c.us", "5511999999999@c.us"),
    { sourceId: "5511999999999@c.us", lidId: "", isLid: false },
  );
});

test("media types distinguish images and voice notes for the CRM UI", () => {
  assert.equal(whatsappMediaKind("image"), "image");
  assert.equal(whatsappMediaKind("audio"), "audio");
  assert.equal(whatsappMediaKind("ptt"), "audio");
  assert.equal(whatsappMediaKind("document"), "document");
});

test("admin account directory exposes connected consultant sessions without loading whatsapp-web.js", async () => {
  const runtime = createWhatsappRuntime({
    enabled: false,
    sessionRoot: "/tmp/whatsapp-runtime-test",
    execute: async () => undefined,
    queryRows: async (sql) => {
      if (!String(sql).includes("FROM whatsapp_accounts wa")) return [];
      return [{
        user_id: "consultant-1",
        user_name: "Consultora Um",
        user_email: "um@example.com",
        user_role: "consultor_vendas",
        user_team_id: "team-1",
        enabled: 1,
        status: "ready",
        phone: "5511999999999",
        display_name: "Atendimento Um",
        last_error: "",
        last_ready_at: "2026-09-11T10:00:00.000Z",
        last_disconnect_at: "",
      }];
    },
  });
  const accounts = await runtime.listAccounts();
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].userId, "consultant-1");
  assert.equal(accounts[0].userName, "Consultora Um");
  assert.equal(accounts[0].connected, true);
  assert.equal(accounts[0].phone, "5511999999999");
});
