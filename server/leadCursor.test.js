import assert from "node:assert/strict";
import test from "node:test";
import { decodeLeadCursor, encodeLeadCursor, leadCursorFilterKey } from "./leadCursor.js";

test("cursor preserva total e modo de busca para páginas seguintes", () => {
  const encoded = encodeLeadCursor({ v: 1, id: "lead-10", total: 140000, searchMode: "fulltext" });
  assert.deepEqual(decodeLeadCursor(encoded), { v: 1, id: "lead-10", total: 140000, searchMode: "fulltext" });
});

test("chave de filtros é determinística e muda quando filtro muda", () => {
  const base = { search: "maria", status: "Novo lead", temperature: "", responsible: "", quickFilter: "" };
  assert.equal(leadCursorFilterKey(base), leadCursorFilterKey({ ...base }));
  assert.notEqual(leadCursorFilterKey(base), leadCursorFilterKey({ ...base, status: "Contato feito" }));
});
