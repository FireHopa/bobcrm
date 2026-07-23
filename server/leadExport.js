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
