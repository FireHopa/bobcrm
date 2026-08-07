import { timingSafeEqual } from "node:crypto";

const ALLOWED_SOURCES = new Set([
  "WhatsApp",
  "Landing Page",
  "Evento",
  "Instagram",
  "Google",
  "Indicação",
  "Tráfego Pago",
  "Outro",
]);

export function safeSecretEquals(received, expected) {
  const left = Buffer.from(String(received || ""));
  const right = Buffer.from(String(expected || ""));
  if (!left.length || !right.length || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "").replace(/^0+/, "");
}

export function phoneKeyVariants(value) {
  const raw = digitsOnly(value);
  const variants = new Set();
  if (!raw) return [];

  variants.add(raw);

  if (/^55\d{10,11}$/.test(raw)) variants.add(raw.slice(2));
  if (/^\d{10,11}$/.test(raw)) variants.add(`55${raw}`);

  if (/^351[2-9]\d{8}$/.test(raw)) variants.add(raw.slice(3));
  if (/^[2-9]\d{8}$/.test(raw)) variants.add(`351${raw}`);

  return Array.from(variants).filter((item) => item.length >= 8);
}

export function normalizeIntegrationSource(value) {
  const source = String(value || "WhatsApp").trim();
  return ALLOWED_SOURCES.has(source) ? source : "WhatsApp";
}

export function normalizeZapePayload(body = {}) {
  const lead = body.lead && typeof body.lead === "object" ? body.lead : {};
  const webhook = body.webhook && typeof body.webhook === "object" ? body.webhook : {};
  const target = body.target && typeof body.target === "object" ? body.target : {};
  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};

  const eventKey = String(body.eventKey || "").trim().slice(0, 255);
  const tenantId = String(body.tenantId || "").trim().slice(0, 120);
  const externalLeadId = String(body.externalLeadId || lead.id || "").trim().slice(0, 120);
  const phone = digitsOnly(lead.phone || lead.whatsapp || lead.whatsappDigits || "");
  const email = String(lead.email || "").trim().toLowerCase().slice(0, 255);

  if (!eventKey) throw integrationValidationError("eventKey é obrigatório.");
  if (!tenantId) throw integrationValidationError("tenantId é obrigatório.");
  if (!externalLeadId) throw integrationValidationError("externalLeadId é obrigatório.");
  if (!phone && !email) throw integrationValidationError("Informe telefone ou e-mail do lead.");

  return {
    eventKey,
    eventType: String(body.eventType || "lead.created").trim().slice(0, 120),
    provider: "zape",
    tenantId,
    externalLeadId,
    webhook: {
      id: String(webhook.id || "").trim().slice(0, 120),
      name: String(webhook.name || "").trim().slice(0, 255),
      payloadType: String(webhook.payloadType || "").trim().slice(0, 80),
    },
    target: {
      pipelineId: String(target.pipelineId || "").trim().slice(0, 64),
      stageId: String(target.stageId || "").trim().slice(0, 64),
      source: normalizeIntegrationSource(target.source),
      profile: String(target.profile || "").trim().slice(0, 120),
      temperature: String(target.temperature || "").trim().slice(0, 80),
      priority: String(target.priority || "").trim().slice(0, 80),
      commercialTreatment: String(target.commercialTreatment || "").trim().slice(0, 120),
    },
    lead: {
      name: String(lead.name || lead.nome || "").trim().slice(0, 255),
      email,
      phone,
      company: String(lead.company || lead.empresa || "").trim().slice(0, 255),
      website: String(lead.website || "").trim().slice(0, 500),
      advertisesOnGoogle: Boolean(lead.advertisesOnGoogle),
      advertisesOnGoogleRaw: String(lead.advertisesOnGoogleRaw || lead.jaAnuncia || "").trim().slice(0, 160),
      tags: Array.isArray(lead.tags) ? lead.tags.slice(0, 100) : String(lead.tags || "").slice(0, 4000),
      createdAt: String(lead.createdAt || "").trim().slice(0, 40),
    },
    metadata: {
      ...metadata,
      receivedFrom: "zape",
    },
  };
}

function integrationValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}
