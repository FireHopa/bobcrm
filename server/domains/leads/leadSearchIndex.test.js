import test from "node:test";
import assert from "node:assert/strict";
import { buildLeadSearchIndexBatchUpdate } from "./leadSearchIndex.js";

test("rebuild do índice de busca atualiza um lote com uma única query", () => {
  const batch = buildLeadSearchIndexBatchUpdate([
    { id: "1", name: "Clínica Árvore", company: "Casa do Ads" },
    { id: "2", name: "Empresa Dois", phone: "11999990000" },
  ]);
  assert.match(batch.sql, /UPDATE leads l/);
  assert.match(batch.sql, /UNION ALL/);
  assert.match(batch.sql, /SET l\.search_text = p\.search_text/);
  assert.equal(batch.params.length, 4);
  assert.match(batch.params[1], /clinica arvore/);
});
