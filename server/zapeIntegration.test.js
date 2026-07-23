import test from "node:test";
import assert from "node:assert/strict";
import { normalizeZapePayload, phoneKeyVariants, safeSecretEquals } from "./zapeIntegration.js";

test("phoneKeyVariants reconhece Brasil com e sem DDI", () => {
  assert.deepEqual(new Set(phoneKeyVariants("+55 (11) 99999-9999")), new Set(["5511999999999", "11999999999"]));
  assert.deepEqual(new Set(phoneKeyVariants("11 99999-9999")), new Set(["11999999999", "5511999999999"]));
});

test("phoneKeyVariants reconhece Portugal com e sem DDI", () => {
  assert.deepEqual(new Set(phoneKeyVariants("+351 912 345 678")), new Set(["351912345678", "912345678"]));
  assert.deepEqual(new Set(phoneKeyVariants("912345678")), new Set(["912345678", "351912345678"]));
});

test("safeSecretEquals rejeita chaves diferentes", () => {
  assert.equal(safeSecretEquals("abc", "abc"), true);
  assert.equal(safeSecretEquals("abc", "abd"), false);
  assert.equal(safeSecretEquals("abc", "abcd"), false);
});

test("normalizeZapePayload aceita lead somente com telefone", () => {
  const payload = normalizeZapePayload({
    eventKey: "zape:admin:1",
    tenantId: "admin",
    externalLeadId: "1",
    lead: { phone: "+55 11 99999-9999" },
    target: {},
  });

  assert.equal(payload.lead.phone, "5511999999999");
  assert.equal(payload.target.source, "WhatsApp");
});
