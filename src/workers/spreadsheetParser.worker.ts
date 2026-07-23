/// <reference lib="webworker" />

import { Workbook } from "exceljs";

type ParseRequest = {
  buffer: ArrayBuffer;
  maxRows: number;
  maxColumns: number;
};

type ParseSuccess = {
  ok: true;
  rows: string[][];
};

type ParseFailure = {
  ok: false;
  message: string;
};

function normalizeCellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const candidate = value as {
      text?: unknown;
      result?: unknown;
      hyperlink?: unknown;
      richText?: Array<{ text?: unknown }>;
    };
    if (candidate.result !== undefined) return normalizeCellText(candidate.result);
    if (Array.isArray(candidate.richText)) return candidate.richText.map((part) => String(part.text || "")).join("");
    if (candidate.text !== undefined) return String(candidate.text || "");
    if (candidate.hyperlink !== undefined) return String(candidate.hyperlink || "");
  }
  return String(value);
}

self.onmessage = async (event: MessageEvent<ParseRequest>) => {
  try {
    const { buffer, maxRows, maxColumns } = event.data;
    const workbook = new Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error("A planilha não possui abas.");
    if (worksheet.rowCount > maxRows) {
      throw new Error(`A planilha possui mais de ${maxRows.toLocaleString("pt-BR")} linhas. Converta para CSV para importar bases maiores.`);
    }
    if (worksheet.columnCount > maxColumns) {
      throw new Error(`A planilha possui mais de ${maxColumns} colunas e foi bloqueada por segurança.`);
    }

    const rows: string[][] = [];
    for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const values: string[] = [];
      for (let columnNumber = 1; columnNumber <= worksheet.columnCount; columnNumber += 1) {
        values.push(normalizeCellText(row.getCell(columnNumber).value).trim());
      }
      if (values.some(Boolean)) rows.push(values);
    }

    const response: ParseSuccess = { ok: true, rows };
    self.postMessage(response);
  } catch (caughtError) {
    const response: ParseFailure = {
      ok: false,
      message: caughtError instanceof Error ? caughtError.message : "Não foi possível processar a planilha.",
    };
    self.postMessage(response);
  }
};
