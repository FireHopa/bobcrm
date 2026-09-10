import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { phoneKeyVariants } from "./zapeIntegration.js";

const PROVIDER = "activecampaign";
const PAGE_SIZE = 100;

export function normalizeActiveCampaignBaseUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "").replace(/\/api\/3$/i, "");
  if (!raw) throw validationError("Informe a URL da API da ActiveCampaign.");
  let parsed;
  try { parsed = new URL(raw); } catch { throw validationError("A URL da ActiveCampaign é inválida."); }
  if (parsed.protocol !== "https:") throw validationError("A URL da ActiveCampaign precisa usar HTTPS.");
  return parsed.origin;
}

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function cancellationError() {
  const error = new Error("Importação cancelada pelo usuário.");
  error.code = "JOB_CANCELED";
  return error;
}

async function assertNotCanceled(shouldCancel) {
  if (typeof shouldCancel === "function" && await shouldCancel()) throw cancellationError();
}

async function cancellableDelay(ms, shouldCancel) {
  const total = Math.max(0, Number(ms || 0));
  const started = Date.now();
  while (Date.now() - started < total) {
    await assertNotCanceled(shouldCancel);
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, total - (Date.now() - started))));
  }
  await assertNotCanceled(shouldCancel);
}

function credentialKey(secret) {
  const normalized = String(secret || "").trim();
  if (normalized.length < 24 || normalized === "change_me") {
    const error = new Error("Configure INTEGRATION_CREDENTIALS_SECRET (mínimo 24 caracteres) no servidor para executar a importação da ActiveCampaign.");
    error.statusCode = 503;
    error.code = "INTEGRATION_CREDENTIALS_SECRET_REQUIRED";
    throw error;
  }
  return createHash("sha256").update(normalized).digest();
}

export function sealActiveCampaignCredentials({ baseUrl, apiToken }, secret) {
  const normalizedBaseUrl = normalizeActiveCampaignBaseUrl(baseUrl);
  const token = String(apiToken || "").trim();
  if (!token) throw validationError("Informe o API Token da ActiveCampaign.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialKey(secret), iv);
  const plaintext = Buffer.from(JSON.stringify({ baseUrl: normalizedBaseUrl, apiToken: token }), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") };
}

export function openActiveCampaignCredentials(payload, secret) {
  try {
    const decipher = createDecipheriv("aes-256-gcm", credentialKey(secret), Buffer.from(String(payload?.iv || ""), "base64"));
    decipher.setAuthTag(Buffer.from(String(payload?.tag || ""), "base64"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(String(payload?.data || ""), "base64")), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch (error) {
    if (error?.statusCode) throw error;
    const wrapped = new Error("Não foi possível abrir as credenciais temporárias da ActiveCampaign.");
    wrapped.code = "ACTIVE_CAMPAIGN_CREDENTIALS_INVALID";
    throw wrapped;
  }
}

async function activeRequest(credentials, pathname, search = new URLSearchParams(), options = {}) {
  const url = `${credentials.baseUrl}/api/3${pathname}${search.toString() ? `?${search}` : ""}`;
  let lastError;
  const shouldCancel = options.shouldCancel;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await assertNotCanceled(shouldCancel);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(url, { headers: { "Api-Token": credentials.apiToken, Accept: "application/json" }, signal: controller.signal });
      const text = await response.text();
      await assertNotCanceled(shouldCancel);
      let body = {};
      try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
      if (response.ok) return body;
      if ((response.status === 429 || response.status >= 500) && attempt < 4) {
        await cancellableDelay(Math.min(4000, 500 * (2 ** (attempt - 1))), shouldCancel);
        continue;
      }
      const error = new Error(body?.message || body?.errors?.[0]?.title || `ActiveCampaign respondeu HTTP ${response.status}.`);
      error.statusCode = response.status === 401 || response.status === 403 ? 400 : 502;
      error.code = `ACTIVE_CAMPAIGN_HTTP_${response.status}`;
      throw error;
    } catch (error) {
      lastError = error;
      if (error?.statusCode || attempt >= 4) throw error;
      await cancellableDelay(Math.min(4000, 500 * (2 ** (attempt - 1))), shouldCancel);
    } finally { clearTimeout(timeout); }
  }
  throw lastError || new Error("Falha ao consultar a ActiveCampaign.");
}

export async function testActiveCampaignConnection(credentials) {
  const normalized = { baseUrl: normalizeActiveCampaignBaseUrl(credentials.baseUrl), apiToken: String(credentials.apiToken || "").trim() };
  if (!normalized.apiToken) throw validationError("Informe o API Token da ActiveCampaign.");
  const search = new URLSearchParams({ limit: "1" });
  const body = await activeRequest(normalized, "/contacts", search);
  return { ok: true, contacts: Number(body?.meta?.total || body?.contacts?.length || 0), baseUrl: normalized.baseUrl };
}

function progressStats(summary = {}, extra = {}) {
  return {
    notesFetched: Number(summary.notesFetched || 0),
    contactNotes: Number(summary.contactNotes || 0),
    processedNotes: Number(extra.processedNotes ?? summary.processedNotes ?? 0),
    imported: Number(summary.imported || 0),
    updated: Number(summary.updated || 0),
    duplicates: Number(summary.duplicates || 0),
    contactsWithoutLead: Number(summary.contactsWithoutLead || 0),
    ambiguousContacts: Number(summary.ambiguousContacts || 0),
    errors: Number(extra.errors || 0),
  };
}

function stagePercent(start, end, current, total) {
  const safeTotal = Math.max(0, Number(total || 0));
  if (!safeTotal) return start;
  const ratio = Math.max(0, Math.min(1, Number(current || 0) / safeTotal));
  return Math.round(start + ((end - start) * ratio));
}

async function reportProgress(updateProgress, percent, message, details = {}) {
  if (!updateProgress) return;
  await updateProgress(
    Math.max(0, Math.min(100, Number(percent || 0))),
    100,
    message,
    { ...details, lastUpdatedAt: new Date().toISOString() },
  );
}

async function fetchAllNotes(credentials, updateProgress, summary, shouldCancel) {
  const notes = [];
  let offset = 0;
  let total = null;
  let pageNumber = 0;
  do {
    await assertNotCanceled(shouldCancel);
    const search = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    const body = await activeRequest(credentials, "/notes", search, { shouldCancel });
    await assertNotCanceled(shouldCancel);
    const page = Array.isArray(body?.notes) ? body.notes : [];
    pageNumber += 1;
    if (total === null) total = Number(body?.meta?.total || 0) || null;
    notes.push(...page);
    summary.notesFetched = notes.length;
    offset += page.length;
    const percent = total
      ? stagePercent(5, 35, notes.length, total)
      : Math.min(34, 5 + Math.max(1, pageNumber));
    await reportProgress(
      updateProgress,
      percent,
      `Buscando notas na ActiveCampaign: ${notes.length}${total ? ` de ${total}` : ""}`,
      {
        stage: "fetch_notes",
        stageLabel: "Buscando notas",
        stageCurrent: notes.length,
        stageTotal: total || 0,
        currentPage: pageNumber,
        stats: progressStats(summary),
      },
    );
    if (!page.length || page.length < PAGE_SIZE) break;
  } while (total === null || notes.length < total);
  return notes;
}

async function fetchContactsForIds(credentials, requiredIds, updateProgress, summary, shouldCancel) {
  const contacts = new Map();
  if (!requiredIds.size) return contacts;
  let idGreater = "0";
  let scanned = 0;
  let totalAvailable = null;
  let pageNumber = 0;
  while (contacts.size < requiredIds.size) {
    await assertNotCanceled(shouldCancel);
    const search = new URLSearchParams({ limit: String(PAGE_SIZE), id_greater: idGreater });
    search.set("orders[id]", "ASC");
    const body = await activeRequest(credentials, "/contacts", search, { shouldCancel });
    await assertNotCanceled(shouldCancel);
    const page = Array.isArray(body?.contacts) ? body.contacts : [];
    pageNumber += 1;
    if (totalAvailable === null) totalAvailable = Number(body?.meta?.total || 0) || null;
    if (!page.length) break;
    scanned += page.length;
    for (const contact of page) {
      const id = String(contact?.id || "");
      if (requiredIds.has(id)) contacts.set(id, contact);
    }
    const lastId = String(page[page.length - 1]?.id || "");
    const percent = totalAvailable
      ? stagePercent(40, 60, Math.min(scanned, totalAvailable), totalAvailable)
      : Math.min(59, 40 + Math.max(1, pageNumber));
    await reportProgress(
      updateProgress,
      percent,
      `Localizando contatos da ActiveCampaign: ${contacts.size} de ${requiredIds.size}`,
      {
        stage: "fetch_contacts",
        stageLabel: "Localizando contatos",
        stageCurrent: contacts.size,
        stageTotal: requiredIds.size,
        scannedContacts: scanned,
        currentPage: pageNumber,
        stats: progressStats(summary),
      },
    );
    if (!lastId || lastId === idGreater) break;
    idGreater = lastId;
    if (page.length < PAGE_SIZE) break;
  }
  return contacts;
}

function leadLookup(rows) {
  const byEmail = new Map();
  const byPhone = new Map();
  const add = (map, key, id) => { if (!key) return; const set = map.get(key) || new Set(); set.add(id); map.set(key, set); };
  for (const row of rows) {
    add(byEmail, String(row.email_key || "").trim().toLowerCase(), row.id);
    const phone = String(row.phone_key || "").replace(/\D/g, "");
    for (const variant of phoneKeyVariants(phone)) add(byPhone, variant, row.id);
    if (phone) add(byPhone, phone, row.id);
  }
  return { byEmail, byPhone };
}

function resolveLeadForContact(contact, lookup) {
  const email = String(contact?.email || "").trim().toLowerCase();
  const emailIds = email ? lookup.byEmail.get(email) : null;
  if (emailIds?.size === 1) return { leadId: [...emailIds][0], mode: "email" };
  if (emailIds?.size > 1) return { leadId: "", mode: "ambiguous" };
  const candidates = new Set();
  for (const key of phoneKeyVariants(contact?.phone || "")) for (const id of lookup.byPhone.get(key) || []) candidates.add(id);
  if (candidates.size === 1) return { leadId: [...candidates][0], mode: "phone" };
  if (candidates.size > 1) return { leadId: "", mode: "ambiguous" };
  return { leadId: "", mode: "unmatched" };
}

function normalizeImportedBody(value) {
  const body = String(value || "").replace(/\r\n/g, "\n").trim();
  if (body.length <= 5000) return { body, truncated: false };
  return { body: `${body.slice(0, 4940)}\n\n[Nota truncada na importação da ActiveCampaign]`, truncated: true };
}

function noteHash(note, body) {
  return createHash("sha256").update(`${String(note?.mdate || "")}\n${body}`).digest("hex");
}

export async function importActiveCampaignNotes({ credentials, fromDate = "", queryRows, execute, withTransaction, updateProgress, shouldCancel }) {
  const startedAt = new Date().toISOString();
  const summary = {
    notesFetched: 0, contactNotes: 0, processedNotes: 0, ignoredNonContact: 0, ignoredByDate: 0,
    contactsReferenced: 0, contactsFound: 0, contactsMatchedByEmail: 0, contactsMatchedByPhone: 0,
    contactsWithoutLead: 0, ambiguousContacts: 0, imported: 0, updated: 0, duplicates: 0, truncated: 0, emptyNotes: 0,
    startedAt, completedAt: "",
  };

  await assertNotCanceled(shouldCancel);
  await reportProgress(updateProgress, 2, "Preparando importação da ActiveCampaign", {
    stage: "preparing",
    stageLabel: "Preparando",
    stageCurrent: 0,
    stageTotal: 1,
    currentPage: 0,
    stats: progressStats(summary),
  });

  const allNotes = await fetchAllNotes(credentials, updateProgress, summary, shouldCancel);
  await assertNotCanceled(shouldCancel);
  const fromTimestamp = fromDate ? Date.parse(`${fromDate}T00:00:00`) : NaN;
  const relevantNotes = [];
  const contactIds = new Set();
  let filteredNotes = 0;
  for (const note of allNotes) {
    if (filteredNotes % 1000 === 0) await assertNotCanceled(shouldCancel);
    filteredNotes += 1;
    const ownerType = String(note?.owner?.type || "").toLowerCase();
    const reltype = String(note?.reltype || "").toLowerCase();
    if (ownerType !== "contact" && reltype !== "subscriber") { summary.ignoredNonContact += 1; continue; }
    const created = Date.parse(String(note?.cdate || ""));
    if (Number.isFinite(fromTimestamp) && Number.isFinite(created) && created < fromTimestamp) { summary.ignoredByDate += 1; continue; }
    const contactId = String(note?.owner?.id || note?.relid || "").trim();
    if (!contactId) continue;
    relevantNotes.push(note);
    contactIds.add(contactId);
  }
  summary.contactNotes = relevantNotes.length;
  summary.contactsReferenced = contactIds.size;

  await reportProgress(updateProgress, 38, `Preparando ${relevantNotes.length} nota(s) de contato para cruzamento`, {
    stage: "filter_notes",
    stageLabel: "Preparando notas",
    stageCurrent: relevantNotes.length,
    stageTotal: relevantNotes.length,
    currentPage: 0,
    stats: progressStats(summary),
  });

  const contacts = await fetchContactsForIds(credentials, contactIds, updateProgress, summary, shouldCancel);
  await assertNotCanceled(shouldCancel);
  summary.contactsFound = contacts.size;

  await reportProgress(updateProgress, 62, "Cruzando contatos da ActiveCampaign com os leads do BobCRM", {
    stage: "match_leads",
    stageLabel: "Cruzando leads",
    stageCurrent: 0,
    stageTotal: contacts.size,
    currentPage: 0,
    stats: progressStats(summary),
  });

  await assertNotCanceled(shouldCancel);
  const leadRows = await queryRows("SELECT id, email_key, phone_key FROM leads WHERE deleted_at = '' AND merged_into_lead_id = ''");
  const lookup = leadLookup(leadRows);
  const contactMatches = new Map();
  let matchedContactsProcessed = 0;
  for (const [contactId, contact] of contacts.entries()) {
    if (matchedContactsProcessed % 250 === 0) await assertNotCanceled(shouldCancel);
    const match = resolveLeadForContact(contact, lookup);
    contactMatches.set(contactId, match);
    if (match.mode === "email") summary.contactsMatchedByEmail += 1;
    else if (match.mode === "phone") summary.contactsMatchedByPhone += 1;
    else if (match.mode === "ambiguous") summary.ambiguousContacts += 1;
    else summary.contactsWithoutLead += 1;
    matchedContactsProcessed += 1;
  }
  summary.contactsWithoutLead += Math.max(0, contactIds.size - contacts.size);

  await reportProgress(updateProgress, 65, "Cruzamento concluído. Iniciando gravação das notas", {
    stage: "match_leads",
    stageLabel: "Cruzando leads",
    stageCurrent: matchedContactsProcessed,
    stageTotal: contacts.size,
    currentPage: 0,
    stats: progressStats(summary),
  });

  await assertNotCanceled(shouldCancel);
  const existingRows = await queryRows("SELECT provider, external_note_id, note_id, lead_id, content_hash FROM integration_note_imports WHERE provider = ?", [PROVIDER]);
  const existing = new Map(existingRows.map((row) => [String(row.external_note_id), row]));

  let processed = 0;
  for (let start = 0; start < relevantNotes.length; start += 100) {
    await assertNotCanceled(shouldCancel);
    const batch = relevantNotes.slice(start, start + 100);
    await withTransaction(async (client) => {
      for (const note of batch) {
        processed += 1;
        summary.processedNotes = processed;
        const contactId = String(note?.owner?.id || note?.relid || "").trim();
        const match = contactMatches.get(contactId);
        if (!match?.leadId) continue;
        const normalized = normalizeImportedBody(note?.note);
        if (!normalized.body) { summary.emptyNotes += 1; continue; }
        if (normalized.truncated) summary.truncated += 1;
        const externalNoteId = String(note?.id || "").trim();
        if (!externalNoteId) continue;
        const hash = noteHash(note, normalized.body);
        const previous = existing.get(externalNoteId);
        const createdAt = String(note?.cdate || new Date().toISOString());
        const importedAt = new Date().toISOString();
        if (previous) {
          if (String(previous.content_hash || "") === hash && String(previous.lead_id || "") === match.leadId) { summary.duplicates += 1; continue; }
          await execute("UPDATE lead_notes SET lead_id = ?, body = ?, created_by = ?, created_by_name = ?, created_at = ? WHERE id = ?", [match.leadId, normalized.body, "integration:activecampaign", "ActiveCampaign", createdAt, previous.note_id], client);
          await execute("UPDATE integration_note_imports SET lead_id = ?, external_contact_id = ?, external_updated_at = ?, content_hash = ?, imported_at = ? WHERE provider = ? AND external_note_id = ?", [match.leadId, contactId, String(note?.mdate || createdAt), hash, importedAt, PROVIDER, externalNoteId], client);
          summary.updated += 1;
        } else {
          const noteId = randomUUID();
          await execute("INSERT INTO lead_notes (id, lead_id, body, created_by, created_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?)", [noteId, match.leadId, normalized.body, "integration:activecampaign", "ActiveCampaign", createdAt], client);
          await execute("INSERT INTO integration_note_imports (provider, external_note_id, external_contact_id, note_id, lead_id, external_updated_at, content_hash, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [PROVIDER, externalNoteId, contactId, noteId, match.leadId, String(note?.mdate || createdAt), hash, importedAt], client);
          existing.set(externalNoteId, { note_id: noteId, lead_id: match.leadId, content_hash: hash });
          summary.imported += 1;
        }
      }
    });
    await assertNotCanceled(shouldCancel);
    const percent = stagePercent(65, 98, processed, Math.max(1, relevantNotes.length));
    await reportProgress(updateProgress, percent, `Importando notas: ${processed} de ${relevantNotes.length}`, {
      stage: "import_notes",
      stageLabel: "Importando notas",
      stageCurrent: processed,
      stageTotal: relevantNotes.length,
      currentPage: Math.floor(start / 100) + 1,
      stats: progressStats(summary, { processedNotes: processed }),
    });
  }

  await assertNotCanceled(shouldCancel);
  await reportProgress(updateProgress, 99, "Finalizando importação e consolidando o resumo", {
    stage: "finalizing",
    stageLabel: "Finalizando",
    stageCurrent: 1,
    stageTotal: 1,
    currentPage: 0,
    stats: progressStats(summary, { processedNotes: processed }),
  });

  await assertNotCanceled(shouldCancel);
  summary.completedAt = new Date().toISOString();
  await reportProgress(updateProgress, 100, "Importação concluída", {
    stage: "completed",
    stageLabel: "Concluído",
    stageCurrent: 1,
    stageTotal: 1,
    currentPage: 0,
    stats: progressStats(summary, { processedNotes: processed }),
  });
  return summary;
}

