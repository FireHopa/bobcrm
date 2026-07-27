import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBooleanFullTextQuery,
  buildLeadSearchText,
  customFieldLabels,
  leadToDbParams,
  normalizeEmailKey,
  normalizeLead,
  normalizePhoneKey,
  rowToLead,
} from "./leadMapper.js";

test("normalização de lead preserva compatibilidade legada sem converter dados silenciosamente", () => {
  const lead = normalizeLead({
    id: "lead-1",
    name: " Cliente Árvore ",
    email: " CLIENTE@EXEMPLO.COM ",
    phone: "+55 (11) 99999-0000",
    customFields: {
      "Já possui Website?": "Sim",
      "Já anuncia no Google ADS? - 2": "Sim",
      "Coloque seu site": "https://exemplo.com",
    },
  });
  assert.equal(lead.id, "lead-1");
  assert.equal(lead.website, "https://exemplo.com");
  assert.equal(lead.advertisesOnGoogle, true);
  assert.equal(lead.customFields["Possui website?"], "Sim");
  assert.deepEqual(Object.keys(lead.customFields), customFieldLabels);
});

test("chaves e texto de busca são determinísticos", () => {
  assert.equal(normalizeEmailKey(" TESTE@EXEMPLO.COM "), "teste@exemplo.com");
  assert.equal(normalizePhoneKey("+55 (11) 98888-7777"), "5511988887777");
  assert.equal(buildBooleanFullTextQuery("Clínica de São Paulo"), "+clinica* +sao* +paulo*");
  assert.match(buildLeadSearchText({ name: "Clínica Árvore", company: "Casa do Ads" }), /clinica arvore casa do ads/);
});

test("mapeamento de linha MySQL e parâmetros de persistência mantêm contrato", () => {
  const row = {
    id: "lead-2",
    name: "Teste",
    email: "teste@example.com",
    phone: "11999990000",
    company: "Empresa",
    service_interests: '["Google Ads"]',
    service_status_map: '{"Google Ads":"Casa do Ads"}',
    custom_fields: '{"Indicado por":"Evento"}',
    created_at: "2026-07-08T10:00:00.000Z",
  };
  const lead = rowToLead(row);
  assert.deepEqual(lead.serviceInterests, ["Google Ads"]);
  assert.equal(lead.customFields["Indicado por"], "Evento");
  const params = leadToDbParams(lead, { updatedAt: "2026-07-08T11:00:00.000Z" });
  assert.equal(params.length, 53);
  assert.equal(params[3], "teste@example.com");
  assert.equal(params[5], "11999990000");
});
