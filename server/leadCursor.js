export function encodeLeadCursor(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeLeadCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    return parsed && parsed.v === 1 && parsed.id ? parsed : null;
  } catch {
    const error = new Error("Cursor de paginação inválido.");
    error.statusCode = 400;
    throw error;
  }
}

export function leadCursorFilterKey(filters = {}) {
  return JSON.stringify([
    filters.search || "",
    filters.status || "",
    filters.temperature || "",
    filters.responsible || "",
    filters.source || "",
    filters.quickFilter || "",
  ]);
}
