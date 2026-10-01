import { createWriteStream } from "node:fs";
import { chmod, rm } from "node:fs/promises";
import { once } from "node:events";

export function csvEscape(value) {
  const text = String(value ?? "");
  const escaped = text.replace(/"/g, '""');
  return /["\n\r,;]/.test(text) ? `"${escaped}"` : escaped;
}

async function writeChunk(stream, chunk) {
  if (stream.write(chunk)) return;
  await once(stream, "drain");
}

async function closeStream(stream) {
  stream.end();
  await once(stream, "finish");
}

export async function writeCsvExport({
  filePath,
  headers,
  fetchPage,
  mapRow,
  pageSize = 5000,
  onProgress = async () => undefined,
}) {
  const stream = createWriteStream(filePath, { flags: "wx", mode: 0o600 });
  let total = 0;
  let cursor = null;

  try {
    await writeChunk(stream, `\uFEFF${headers.map(csvEscape).join(";")}\n`);
    while (true) {
      const page = await fetchPage({ cursor, limit: pageSize });
      const records = Array.isArray(page?.records) ? page.records : [];
      for (const record of records) {
        await writeChunk(stream, `${mapRow(record).map(csvEscape).join(";")}\n`);
      }
      total += records.length;
      await onProgress({ current: total, total: Number(page?.total || 0), message: `${total.toLocaleString("pt-BR")} leads exportados` });
      cursor = page?.nextCursor || null;
      if (!records.length || !cursor) break;
    }
    await closeStream(stream);
    await chmod(filePath, 0o600).catch(() => undefined);
    return { total };
  } catch (error) {
    stream.destroy();
    await rm(filePath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function resolveWorkbookWriter(excelModule) {
  const library = excelModule?.default || excelModule;
  const WorkbookWriter = library?.stream?.xlsx?.WorkbookWriter;
  if (!WorkbookWriter) {
    const error = new Error("ExcelJS não disponibilizou o writer XLSX por streaming.");
    error.code = "XLSX_STREAM_WRITER_UNAVAILABLE";
    throw error;
  }
  return WorkbookWriter;
}

export async function writeXlsxExport({
  filePath,
  headers,
  fetchPage,
  mapRow,
  pageSize = 2000,
  onProgress = async () => undefined,
}) {
  const excelModule = await import("exceljs");
  const WorkbookWriter = resolveWorkbookWriter(excelModule);
  const workbook = new WorkbookWriter({ filename: filePath, useStyles: false, useSharedStrings: false });
  workbook.creator = "CRM Casa do Ads";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet("Leads CRM", { views: [{ state: "frozen", ySplit: 1 }] });
  worksheet.columns = headers.map((header) => ({ header, key: header, width: Math.min(42, Math.max(12, String(header).length + 4)) }));
  worksheet.getRow(1).commit();

  let total = 0;
  let cursor = null;
  try {
    while (true) {
      const page = await fetchPage({ cursor, limit: pageSize });
      const records = Array.isArray(page?.records) ? page.records : [];
      for (const record of records) {
        worksheet.addRow(mapRow(record)).commit();
      }
      total += records.length;
      await onProgress({ current: total, total: Number(page?.total || 0), message: `${total.toLocaleString("pt-BR")} leads exportados` });
      cursor = page?.nextCursor || null;
      if (!records.length || !cursor) break;
    }
    worksheet.commit();
    await workbook.commit();
    await chmod(filePath, 0o600).catch(() => undefined);
    return { total };
  } catch (error) {
    await rm(filePath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeWorksheetPages({ workbook, name, headers, fetchPage, mapRow, pageSize = 2000, onProgress = async () => undefined, progressLabel = name }) {
  const worksheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  worksheet.columns = headers.map((header) => ({ header, key: header, width: Math.min(42, Math.max(12, String(header).length + 4)) }));
  worksheet.getRow(1).commit();

  let total = 0;
  let cursor = null;
  while (true) {
    const page = await fetchPage({ cursor, limit: pageSize });
    const records = Array.isArray(page?.records) ? page.records : [];
    for (const record of records) worksheet.addRow(mapRow(record)).commit();
    total += records.length;
    await onProgress({ current: total, total: Number(page?.total || 0), message: `${progressLabel}: ${total.toLocaleString("pt-BR")} registro(s)` });
    cursor = page?.nextCursor || null;
    if (!records.length || !cursor) break;
  }
  worksheet.commit();
  return { total };
}

export async function writeDetailedXlsxExport({
  filePath,
  primarySheet,
  extraSheets = [],
  onProgress = async () => undefined,
}) {
  const excelModule = await import("exceljs");
  const WorkbookWriter = resolveWorkbookWriter(excelModule);
  const workbook = new WorkbookWriter({ filename: filePath, useStyles: false, useSharedStrings: false });
  workbook.creator = "CRM Casa do Ads";
  workbook.created = new Date();

  try {
    const primaryResult = await writeWorksheetPages({
      workbook,
      name: primarySheet.name || "Leads CRM",
      headers: primarySheet.headers,
      fetchPage: primarySheet.fetchPage,
      mapRow: primarySheet.mapRow,
      pageSize: primarySheet.pageSize || 2000,
      onProgress,
      progressLabel: primarySheet.progressLabel || "Leads",
    });

    const sheetTotals = {};
    for (const sheet of extraSheets) {
      const result = await writeWorksheetPages({
        workbook,
        name: sheet.name,
        headers: sheet.headers,
        fetchPage: sheet.fetchPage,
        mapRow: sheet.mapRow,
        pageSize: sheet.pageSize || 3000,
        onProgress: async ({ total, message }) => onProgress({
          current: primaryResult.total,
          total: primaryResult.total,
          message: total ? message : `Gerando aba ${sheet.name}...`,
        }),
        progressLabel: sheet.progressLabel || sheet.name,
      });
      sheetTotals[sheet.name] = result.total;
    }

    await workbook.commit();
    await chmod(filePath, 0o600).catch(() => undefined);
    return { total: primaryResult.total, sheetTotals };
  } catch (error) {
    await rm(filePath, { force: true }).catch(() => undefined);
    throw error;
  }
}
