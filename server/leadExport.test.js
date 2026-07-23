import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { csvEscape, writeCsvExport, writeXlsxExport } from "./leadExport.js";

test("csvEscape neutraliza separadores, aspas e quebras", () => {
  assert.equal(csvEscape("simples"), "simples");
  assert.equal(csvEscape("A;B"), '"A;B"');
  assert.equal(csvEscape('A"B'), '"A""B"');
});

test("CSV é escrito por páginas sem concatenar a base inteira", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crm-export-csv-"));
  const filePath = path.join(root, "leads.csv");
  const cursors = [];
  try {
    const result = await writeCsvExport({
      filePath,
      headers: ["Nome", "Email"],
      fetchPage: async ({ cursor }) => {
        cursors.push(cursor);
        if (!cursor) return { records: [{ name: "A", email: "a@example.com" }], nextCursor: "1", total: 2 };
        return { records: [{ name: "B", email: "b@example.com" }], nextCursor: null, total: 2 };
      },
      mapRow: (lead) => [lead.name, lead.email],
      pageSize: 1,
    });
    const content = await readFile(filePath, "utf8");
    assert.equal(result.total, 2);
    assert.deepEqual(cursors, [null, "1"]);
    assert.match(content, /^\uFEFFNome;Email/);
    assert.match(content, /B;b@example\.com/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("XLSX usa WorkbookWriter por streaming e produz arquivo válido", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "crm-export-xlsx-"));
  const filePath = path.join(root, "leads.xlsx");
  try {
    const result = await writeXlsxExport({
      filePath,
      headers: ["Nome", "Email"],
      fetchPage: async ({ cursor }) => cursor ? { records: [], nextCursor: null, total: 1 } : { records: [{ name: "A", email: "a@example.com" }], nextCursor: null, total: 1 },
      mapRow: (lead) => [lead.name, lead.email],
    });
    const content = await readFile(filePath);
    assert.equal(result.total, 1);
    assert.equal(content.subarray(0, 2).toString("hex"), "504b");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
