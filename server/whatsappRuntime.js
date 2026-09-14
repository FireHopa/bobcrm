import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const DEFAULT_RECONNECT_DELAY_MS = 10000;
const DEFAULT_MAX_CHATS = 100;
const DEFAULT_MAX_MESSAGES = 80;
const MAX_MEDIA_BASE64_CHARS = 22 * 1024 * 1024;

export function sanitizeWhatsappClientId(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return normalized || "consultant";
}

export function normalizeWhatsappPhone(value) {
  return String(value || "").replace(/\D+/g, "").replace(/^0+/, "");
}

export function isWhatsappLidId(value) {
  return String(value || "").trim().toLowerCase().endsWith("@lid");
}

export function phoneFromWhatsappCandidate(value, rejectedLid = "") {
  const raw = String(value || "").trim();
  if (!raw || isWhatsappLidId(raw)) return "";
  const digits = normalizeWhatsappPhone(raw.split("@")[0]);
  const rejectedDigits = normalizeWhatsappPhone(String(rejectedLid || "").split("@")[0]);
  // WhatsApp phone identities ultimately map to E.164 numbers. Reject values
  // that are clearly not telephone numbers, and never recycle opaque LID digits.
  if (!digits || digits.length < 7 || digits.length > 15 || (rejectedDigits && digits === rejectedDigits)) return "";
  return digits;
}

export function phoneFromLidMappings(sourceId, mappings) {
  const lid = String(sourceId || "").trim();
  if (!isWhatsappLidId(lid) || !Array.isArray(mappings) || !mappings.length) return "";
  const mapping = mappings.find((entry) => String(entry?.lid || "") === lid)
    || (mappings.length === 1 ? mappings[0] : null);
  return phoneFromWhatsappCandidate(mapping?.pn, lid);
}

export function inboundWhatsappIdentityIds(messageFrom, contactId) {
  const messageId = String(messageFrom || "").trim();
  const contactSerializedId = String(contactId || "").trim();
  const lidId = [messageId, contactSerializedId].find((value) => isWhatsappLidId(value)) || "";
  return {
    sourceId: lidId || contactSerializedId || messageId,
    lidId,
    isLid: Boolean(lidId),
  };
}

export function whatsappClientIdForUser(userId) {
  const raw = String(userId || "").trim();
  const readable = sanitizeWhatsappClientId(raw).slice(0, 48);
  const digest = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return `consultant-${readable}-${digest}`;
}

export function isEligibleInboundLeadMessage(message) {
  if (!message || message.fromMe || message.isStatus || message.broadcast) return false;
  const from = String(message.from || "").toLowerCase();
  if (!from || from === "status@broadcast" || from.endsWith("@g.us") || from.endsWith("@broadcast") || from.endsWith("@newsletter")) return false;
  return from.endsWith("@c.us") || from.endsWith("@lid");
}

export function whatsappMediaKind(messageType) {
  const type = String(messageType || "").toLowerCase();
  if (type === "image") return "image";
  if (type === "audio" || type === "ptt") return "audio";
  if (type === "video") return "video";
  if (type === "document") return "document";
  if (type === "sticker") return "sticker";
  return "media";
}


/**
 * Installs a compatibility layer inside the live WhatsApp Web page.
 *
 * This intentionally avoids modifying whatsapp-web.js inside node_modules.
 * WhatsApp Web 2.3000.x may expose WID serialization as `$1` instead of
 * `_serialized`, and one malformed group/channel can make upstream getChats()
 * reject the whole list. The CRM only needs a stable/basic chat model here,
 * so we normalize identifiers and isolate each chat inside the browser page.
 */
export async function installWhatsappWebRuntimeCompatibility(client) {
  const page = client?.pupPage;
  if (!page || typeof page.evaluate !== "function") {
    const error = new Error("Página do WhatsApp Web indisponível para instalar compatibilidade.");
    error.code = "WHATSAPP_WEB_COMPAT_PAGE_UNAVAILABLE";
    throw error;
  }

  const result = await page.evaluate(() => {
    if (!window.WWebJS || typeof window.require !== "function") {
      return { installed: false, reason: "WWebJS_NOT_READY" };
    }
    if (window.WWebJS.__bobcrmCompatVersion === "2026-09-10-v4") {
      return { installed: true, alreadyInstalled: true, webVersion: window.Debug?.VERSION || "" };
    }

    const widToSerialized = (wid) => {
      if (wid === null || wid === undefined) return "";
      if (typeof wid === "string") return wid;
      if (typeof wid._serialized === "string" && wid._serialized) return wid._serialized;
      if (typeof wid.$1 === "string" && wid.$1) return wid.$1;
      if (typeof wid.user === "string" && typeof wid.server === "string") {
        return `${wid.user}@${wid.server}`;
      }
      try {
        const value = typeof wid.toString === "function" ? wid.toString() : "";
        return value && value !== "[object Object]" ? value : "";
      } catch {
        return "";
      }
    };

    // WA Web 2.3000.x renamed the serialized value of WID/MsgKey objects
    // from `_serialized` to `$1`. Several functions inside whatsapp-web.js
    // still read the old property. Restoring it on the live prototypes fixes
    // those reads without modifying node_modules and also covers newly-created
    // message keys used while sending media.
    const installSerializedAliasOnPrototype = (prototype) => {
      if (!prototype || typeof prototype !== "object") return false;
      try {
        if (Object.getOwnPropertyDescriptor(prototype, "_serialized")) return true;
        Object.defineProperty(prototype, "_serialized", {
          configurable: true,
          enumerable: false,
          get() {
            if (typeof this.$1 === "string" && this.$1) return this.$1;
            if (typeof this.user === "string" && typeof this.server === "string") {
              return `${this.user}@${this.server}`;
            }
            const remote = widToSerialized(this.remote);
            if (typeof this.fromMe === "boolean" && remote && this.id) {
              return `${this.fromMe}_${remote}_${this.id}`;
            }
            return undefined;
          },
        });
        return true;
      } catch {
        return false;
      }
    };

    const installSerializedAlias = (value) => {
      if (!value || typeof value !== "object") return false;
      try {
        // Do not return early when this particular instance already has
        // `_serialized`: newer MsgKey instances can expose only `$1`. We need
        // the alias on the prototype so future outgoing message keys work too.
        const prototype = Object.getPrototypeOf(value);
        return installSerializedAliasOnPrototype(prototype)
          || Boolean(typeof value._serialized === "string" && value._serialized)
          || Boolean(typeof value.$1 === "string" && value.$1);
      } catch {
        return false;
      }
    };

    try {
      installSerializedAlias(window.require("WAWebWidFactory").createWid("0@c.us"));
    } catch {
      // Best effort; existing chat/contact IDs below normally use the same WID prototype.
    }
    try {
      // Outgoing media uses WAWebMsgKey.newId()/new WAWebMsgKey and upstream
      // whatsapp-web.js 1.34.7 still reads newMsgKey._serialized. July 2026
      // WhatsApp Web builds expose that value as `$1`, so patch the class
      // prototype explicitly instead of relying on whichever cached message
      // happened to be inspected first.
      installSerializedAliasOnPrototype(window.require("WAWebMsgKey")?.prototype);
    } catch {
      // Optional best-effort compatibility; live message IDs below are a fallback.
    }
    try {
      const chats = window.require("WAWebCollections").Chat?.getModelsArray?.() || [];
      for (const chat of chats.slice(0, 30)) installSerializedAlias(chat?.id);
    } catch {
      // Ignore optional collection differences.
    }
    try {
      const messages = window.require("WAWebCollections").Msg?.getModelsArray?.() || [];
      for (const message of messages.slice(0, 30)) installSerializedAlias(message?.id);
    } catch {
      // Ignore optional collection differences.
    }

    const normalizeWidField = (object, key) => {
      const value = object?.[key];
      if (!value || typeof value !== "object") return;
      const serialized = widToSerialized(value);
      if (serialized) object[key] = serialized;
    };

    const normalizeModel = (model) => {
      if (!model || typeof model !== "object") return model;
      if (model.id && typeof model.id === "object" && !model.id._serialized) {
        const serialized = widToSerialized(model.id);
        if (serialized) model.id = { ...model.id, _serialized: serialized };
      }
      normalizeWidField(model, "from");
      normalizeWidField(model, "to");
      normalizeWidField(model, "author");
      if (model.lastMessage) normalizeModel(model.lastMessage);
      if (model.groupMetadata && Array.isArray(model.groupMetadata.participants)) {
        for (const participant of model.groupMetadata.participants) normalizeModel(participant);
      }
      return model;
    };

    // Replace getMessageModel instead of calling the upstream serializer first.
    // On affected WA Web builds that serializer can succeed while returning a
    // partially broken model, so a catch-only fallback is not sufficient.
    window.WWebJS.getMessageModel = (message) => {
      let msg;
      try {
        msg = message?.serialize?.();
      } catch {
        return null;
      }
      if (!msg || typeof msg !== "object") return null;

      msg.isEphemeral = message?.isEphemeral;
      msg.isStatusV3 = message?.isStatusV3;
      try {
        const { findLinks } = window.require("WALinkify");
        msg.links = findLinks(message?.mediaObject ? message?.caption : message?.body).map((link) => ({
          link: link.href,
          isSuspicious: Boolean(link.suspiciousCharacters && link.suspiciousCharacters.size),
        }));
      } catch {
        if (!Array.isArray(msg.links)) msg.links = [];
      }
      try {
        if (msg.buttons?.serialize) msg.buttons = msg.buttons.serialize();
        if (msg.dynamicReplyButtons) msg.dynamicReplyButtons = JSON.parse(JSON.stringify(msg.dynamicReplyButtons));
        if (msg.replyButtons) msg.replyButtons = JSON.parse(JSON.stringify(msg.replyButtons));
      } catch {
        // Optional button metadata must not break message serialization.
      }
      if (msg.id && typeof msg.id === "object" && typeof msg.id.remote === "object") {
        msg.id = { ...msg.id, remote: widToSerialized(msg.id.remote) };
      }
      if (msg.id && typeof msg.id === "object" && !msg.id._serialized) {
        const serialized = widToSerialized(msg.id) || widToSerialized(message?.id);
        if (serialized) msg.id = { ...msg.id, _serialized: serialized };
      }
      delete msg.pendingAckUpdate;
      return normalizeModel(msg);
    };

    const originalGetContactModel = typeof window.WWebJS.getContactModel === "function"
      ? window.WWebJS.getContactModel.bind(window.WWebJS)
      : null;
    if (originalGetContactModel) {
      window.WWebJS.getContactModel = (contact) => {
        try {
          return normalizeModel(originalGetContactModel(contact));
        } catch {
          try {
            const serialized = contact?.serialize?.() || null;
            if (serialized?.id && typeof serialized.id === "object" && !serialized.id._serialized) {
              const id = widToSerialized(serialized.id) || widToSerialized(contact?.id);
              if (id) serialized.id = { ...serialized.id, _serialized: id };
            }
            return normalizeModel(serialized);
          } catch {
            return null;
          }
        }
      };
    }

    const basicChatModel = (chat, { isChannel = false } = {}) => {
      if (!chat) return null;
      let model = null;
      try {
        model = chat.serialize?.() || {};
      } catch {
        model = {};
      }
      if (!model || typeof model !== "object") model = {};

      if (!model.id || typeof model.id !== "object") model.id = {};
      const serializedChatId = widToSerialized(model.id) || widToSerialized(chat.id);
      if (!serializedChatId) return null;
      model.id._serialized = serializedChatId;

      model.isGroup = Boolean(
        chat.groupMetadata ||
        (typeof chat.id?.isGroup === "function" && chat.id.isGroup()) ||
        serializedChatId.endsWith("@g.us"),
      );
      model.isChannel = Boolean(
        isChannel ||
        chat.newsletterMetadata ||
        serializedChatId.endsWith("@newsletter"),
      );
      if (!model.formattedTitle) {
        model.formattedTitle = String(
          chat.formattedTitle ||
          chat.name ||
          model.name ||
          model.subject ||
          serializedChatId,
        );
      }
      try {
        model.isMuted = chat.mute?.expiration !== 0;
      } catch {
        model.isMuted = Boolean(model.isMuted);
      }

      model.lastMessage = null;
      try {
        const messages = chat.msgs?.getModelsArray?.() || [];
        const last = messages.length ? messages[messages.length - 1] : null;
        if (last) model.lastMessage = window.WWebJS.getMessageModel(last);
      } catch {
        model.lastMessage = null;
      }

      delete model.msgs;
      delete model.msgUnsyncedButtonReplyMsgs;
      delete model.unsyncedButtonReplies;
      return normalizeModel(model);
    };

    window.WWebJS.getChatModel = async (chat, options = {}) => basicChatModel(chat, options);

    // WA Web can expose LID-based chat IDs. Resolve by serialized value as a
    // fallback before asking WhatsApp to create/find the latest chat.
    window.WWebJS.getChat = async (chatId, { getAsModel = true } = {}) => {
      const isChannel = /@\w*newsletter\b/.test(chatId);
      let chat = null;
      let chatWid = null;
      try {
        chatWid = window.require("WAWebWidFactory").createWid(chatId);
        installSerializedAlias(chatWid);
      } catch {
        chatWid = null;
      }

      try {
        const collections = window.require("WAWebCollections");
        if (isChannel) {
          const channels = collections.WAWebNewsletterCollection;
          try {
            chat = channels?.get?.(chatId) || (chatWid ? channels?.get?.(chatWid) : null);
          } catch {
            chat = null;
          }
          if (!chat) {
            try {
              await window.require("WAWebLoadNewsletterPreviewChatAction").loadNewsletterPreviewChat(chatId);
              chat = chatWid ? await channels?.find?.(chatWid) : null;
            } catch {
              chat = null;
            }
          }
        } else {
          const chats = collections.Chat;
          try {
            chat = chatWid ? chats?.get?.(chatWid) : null;
          } catch {
            chat = null;
          }
          if (!chat) {
            try {
              chat = (chats?.getModelsArray?.() || []).find((candidate) => widToSerialized(candidate?.id) === chatId) || null;
            } catch {
              chat = null;
            }
          }
          if (!chat && chatWid) {
            try {
              chat = (await window.require("WAWebFindChatAction").findOrCreateLatestChat(chatWid))?.chat || null;
            } catch {
              chat = null;
            }
          }
        }
      } catch {
        chat = null;
      }

      if (chat?.id) installSerializedAlias(chat.id);
      return getAsModel && chat ? await window.WWebJS.getChatModel(chat, { isChannel }) : chat;
    };

    window.WWebJS.getChats = async () => {
      let chats = [];
      try {
        chats = window.require("WAWebCollections").Chat.getModelsArray() || [];
      } catch {
        return [];
      }
      const results = [];
      for (const chat of chats) {
        try {
          const model = await window.WWebJS.getChatModel(chat);
          if (model) results.push(model);
        } catch {
          // One stale/corrupt chat must never fail the whole list.
        }
      }
      return results;
    };

    window.WWebJS.getChannels = async () => {
      let channels = [];
      try {
        channels = window.require("WAWebCollections").WAWebNewsletterCollection?.getModelsArray?.() || [];
      } catch {
        return [];
      }
      const results = [];
      for (const channel of channels) {
        try {
          const model = await window.WWebJS.getChatModel(channel, { isChannel: true });
          if (model) results.push(model);
        } catch {
          // Same isolation rule as normal chats.
        }
      }
      return results;
    };

    window.WWebJS.__bobcrmCompatVersion = "2026-09-10-v4";
    return { installed: true, alreadyInstalled: false, webVersion: window.Debug?.VERSION || "" };
  });

  if (!result?.installed) {
    const error = new Error(`Compatibilidade do WhatsApp Web não pôde ser instalada (${result?.reason || "UNKNOWN"}).`);
    error.code = "WHATSAPP_WEB_COMPAT_NOT_READY";
    throw error;
  }
  return result;
}

export async function resolveWhatsappPhoneFromLid(client, sourceId) {
  const lid = String(sourceId || "").trim();
  if (!isWhatsappLidId(lid)) return "";

  if (typeof client?.getContactLidAndPhone === "function") {
    try {
      const mappings = await client.getContactLidAndPhone([lid]);
      const phone = phoneFromLidMappings(lid, mappings);
      if (phone) return phone;
    } catch {
      // Fall through to the live WA Web stores. Current builds can expose `$1`
      // while whatsapp-web.js 1.34.7 still reads `_serialized` in this method.
    }
  }

  const page = client?.pupPage;
  if (!page || typeof page.evaluate !== "function") return "";
  try {
    const resolution = await page.evaluate(async (userId) => {
      const toSerialized = (wid) => {
        if (!wid) return "";
        if (typeof wid === "string") return wid;
        if (typeof wid._serialized === "string" && wid._serialized) return wid._serialized;
        if (typeof wid.$1 === "string" && wid.$1) return wid.$1;
        if (typeof wid.user === "string" && typeof wid.server === "string") return `${wid.user}@${wid.server}`;
        try {
          const asString = typeof wid.toString === "function" ? wid.toString() : "";
          return asString && asString !== "[object Object]" ? asString : "";
        } catch {
          return "";
        }
      };
      const candidates = [];
      let resolvedLid = userId;

      try {
        if (window.WWebJS?.enforceLidAndPnRetrieval) {
          const result = await window.WWebJS.enforceLidAndPnRetrieval(userId);
          resolvedLid = toSerialized(result?.lid) || resolvedLid;
          candidates.push(toSerialized(result?.phone));
        }
      } catch {
        // Continue with the underlying WA Web APIs.
      }

      try {
        const WidFactory = window.require('WAWebWidFactory');
        const ApiContact = window.require('WAWebApiContact');
        const QueryExists = window.require('WAWebQueryExistsJob');
        const wid = WidFactory.createWid(userId);
        candidates.push(toSerialized(ApiContact?.getPhoneNumber?.(wid)));
        let queryResult = null;
        if (!candidates.some(Boolean)) {
          queryResult = await QueryExists?.queryWidExists?.(wid);
          candidates.push(toSerialized(queryResult?.wid));
          candidates.push(toSerialized(ApiContact?.getPhoneNumber?.(wid)));
        }
        const contactCollection = window.require('WAWebCollections')?.Contact;
        let contact = contactCollection?.get?.(wid) || null;
        if (!contact && typeof contactCollection?.find === "function") {
          try {
            contact = await contactCollection.find(wid);
          } catch {
            contact = null;
          }
        }
        candidates.push(
          toSerialized(contact?.phoneNumber),
          toSerialized(contact?.pn),
          toSerialized(contact?.phone),
        );
      } catch {
        // No additional phone source is available in this WA Web build.
      }

      return { lid: resolvedLid, candidates: candidates.filter(Boolean) };
    }, lid);

    for (const candidate of resolution?.candidates || []) {
      const phone = phoneFromWhatsappCandidate(candidate, lid);
      if (phone) return phone;
    }
    return "";
  } catch {
    return "";
  }
}

function serializedId(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value._serialized || value.$1) return String(value._serialized || value.$1);
  if (value.user && value.server) return `${value.user}@${value.server}`;
  return String(value.user || "");
}

function safeUnixTimestamp(value) {
  const timestamp = Number(value || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;
  return Math.floor(timestamp);
}

function toIsoFromUnix(value) {
  const timestamp = safeUnixTimestamp(value);
  return timestamp ? new Date(timestamp * 1000).toISOString() : "";
}

function mapMessage(message) {
  return {
    id: serializedId(message?.id),
    chatId: String(message?.fromMe ? message?.to || "" : message?.from || ""),
    fromMe: Boolean(message?.fromMe),
    body: String(message?.body || ""),
    type: String(message?.type || "chat"),
    hasMedia: Boolean(message?.hasMedia),
    mediaKind: message?.hasMedia ? whatsappMediaKind(message?.type) : "",
    timestamp: safeUnixTimestamp(message?.timestamp),
    createdAt: toIsoFromUnix(message?.timestamp),
    ack: Number(message?.ack ?? 0),
  };
}

function mapLastMessage(message) {
  if (!message) return null;
  return mapMessage(message);
}

function makePublicAccountState(state, row = null) {
  const status = state?.status || row?.status || "disconnected";
  return {
    enabled: Boolean(state?.enabled ?? Number(row?.enabled || 0)),
    status,
    connected: status === "ready",
    qrCodeDataUrl: String(state?.qrCodeDataUrl || ""),
    phone: String(state?.phone || row?.phone || ""),
    displayName: String(state?.displayName || row?.display_name || ""),
    lastError: String(state?.lastError || row?.last_error || ""),
    lastQrAt: String(state?.lastQrAt || row?.last_qr_at || ""),
    lastReadyAt: String(state?.lastReadyAt || row?.last_ready_at || ""),
    lastDisconnectAt: String(state?.lastDisconnectAt || row?.last_disconnect_at || ""),
  };
}

export function createWhatsappRuntime(options = {}) {
  const {
    queryRows,
    execute,
    nowIso = () => new Date().toISOString(),
    onInboundLeadCandidate = async () => undefined,
    onResolvedLidIdentity = async () => undefined,
    sessionRoot,
    enabled = true,
    reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS,
    headless = true,
    executablePath = "",
    puppeteerArgs = ["--disable-dev-shm-usage"],
  } = options;

  if (typeof queryRows !== "function" || typeof execute !== "function") {
    throw new Error("WhatsappRuntime requer queryRows e execute.");
  }

  const states = new Map();
  const reconnectTimers = new Map();
  const startPromises = new Map();
  let stopped = false;
  let libraryPromise = null;
  let qrLibraryPromise = null;
  const runtimeRequire = createRequire(new URL("./whatsapp-runtime/package.json", import.meta.url));

  const missingRuntimeDependency = (dependencyName, cause) => {
    const error = new Error(`Dependência ${dependencyName} ausente no runtime do WhatsApp.`);
    error.code = "WHATSAPP_RUNTIME_MISSING";
    error.statusCode = 503;
    error.publicMessage = "O runtime do WhatsApp não está instalado no servidor. Execute npm run install:whatsapp-runtime na raiz do CRM e reinicie a API.";
    error.cause = cause;
    return error;
  };

  const resolveLibrary = async () => {
    if (!libraryPromise) {
      libraryPromise = Promise.resolve()
        .then(() => runtimeRequire("whatsapp-web.js"))
        .catch((error) => {
          libraryPromise = null;
          if (error?.code === "MODULE_NOT_FOUND") throw missingRuntimeDependency("whatsapp-web.js", error);
          throw error;
        });
    }
    return libraryPromise;
  };

  const resolveQrLibrary = async () => {
    if (!qrLibraryPromise) {
      qrLibraryPromise = Promise.resolve()
        .then(() => runtimeRequire("qrcode"))
        .catch((error) => {
          qrLibraryPromise = null;
          if (error?.code === "MODULE_NOT_FOUND") throw missingRuntimeDependency("qrcode", error);
          throw error;
        });
    }
    return qrLibraryPromise;
  };

  const stateFor = (userId) => {
    const key = String(userId || "").trim();
    if (!states.has(key)) {
      states.set(key, {
        userId: key,
        client: null,
        enabled: false,
        status: "disconnected",
        qrCodeDataUrl: "",
        phone: "",
        displayName: "",
        lastError: "",
        lastQrAt: "",
        lastReadyAt: "",
        lastDisconnectAt: "",
        initializeStarted: false,
      });
    }
    return states.get(key);
  };

  const updateAccount = async (userId, patch = {}) => {
    const current = stateFor(userId);
    Object.assign(current, patch);
    const at = nowIso();
    await execute(
      `INSERT INTO whatsapp_accounts (
        user_id, enabled, status, phone, display_name, last_error, last_qr_at,
        last_ready_at, last_disconnect_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        enabled = VALUES(enabled), status = VALUES(status), phone = VALUES(phone),
        display_name = VALUES(display_name), last_error = VALUES(last_error),
        last_qr_at = VALUES(last_qr_at), last_ready_at = VALUES(last_ready_at),
        last_disconnect_at = VALUES(last_disconnect_at), updated_at = VALUES(updated_at)`,
      [
        String(userId), current.enabled ? 1 : 0, String(current.status || "disconnected"),
        String(current.phone || ""), String(current.displayName || ""), String(current.lastError || "").slice(0, 1000),
        String(current.lastQrAt || ""), String(current.lastReadyAt || ""), String(current.lastDisconnectAt || ""), at, at,
      ],
    );
  };

  const getAccountRow = async (userId) => {
    const rows = await queryRows("SELECT * FROM whatsapp_accounts WHERE user_id = ? LIMIT 1", [String(userId)]);
    return rows[0] || null;
  };

  const ensureEligibleConsultant = async (userId) => {
    const rows = await queryRows(
      "SELECT id, name, email, role, is_active FROM users WHERE id = ? LIMIT 1",
      [String(userId)],
    );
    const user = rows[0] || null;
    if (!user || Number(user.is_active || 0) !== 1 || !["consultor_vendas", "vendedor"].includes(String(user.role || "").toLowerCase())) {
      const error = new Error("A conexão WhatsApp está disponível apenas para consultores de vendas ativos.");
      error.statusCode = 403;
      throw error;
    }
    return user;
  };

  const clearReconnect = (userId) => {
    const timer = reconnectTimers.get(String(userId));
    if (timer) clearTimeout(timer);
    reconnectTimers.delete(String(userId));
  };

  const destroyClient = async (userId, { logout = false } = {}) => {
    clearReconnect(userId);
    const key = String(userId || "").trim();
    const state = stateFor(key);
    const client = state.client;
    state.client = null;
    state.initializeStarted = false;
    if (client) {
      try {
        if (logout) await client.logout();
        else await client.destroy();
      } catch {
        // The browser may already be closed. Explicit logout cleanup below still applies.
      }
    }
    if (logout) {
      const localAuthDirectory = path.join(sessionRoot, `session-${whatsappClientIdForUser(key)}`);
      await rm(localAuthDirectory, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 }).catch(() => undefined);
    }
  };

  const scheduleReconnect = (userId) => {
    const key = String(userId);
    if (stopped || reconnectTimers.has(key)) return;
    const timer = setTimeout(async () => {
      reconnectTimers.delete(key);
      if (stopped) return;
      const row = await getAccountRow(key).catch(() => null);
      if (!row || Number(row.enabled || 0) !== 1) return;
      await restart(key, { preserveSession: true, automatic: true }).catch((error) => {
        console.warn("Falha ao reconectar WhatsApp do consultor.", { userId: key, code: error?.code || "WHATSAPP_RECONNECT_FAILED" });
        scheduleReconnect(key);
      });
    }, reconnectDelayMs);
    timer.unref?.();
    reconnectTimers.set(key, timer);
  };

  const resolveInboundIdentity = async (client, message) => {
    let contact = null;
    try {
      contact = await message.getContact();
    } catch {
      contact = null;
    }

    const messageFrom = String(message?.from || "").trim();
    const contactId = serializedId(contact?.id);
    const identityIds = inboundWhatsappIdentityIds(messageFrom, contactId);
    let phone = "";

    // The inbound message address is authoritative for deciding if this is a
    // LID conversation. Some WA Web builds expose contact.id/contact.number as
    // a phone-looking value derived from the LID; those digits must never be
    // accepted as the customer's telephone number.
    if (identityIds.isLid) {
      phone = await resolveWhatsappPhoneFromLid(client, identityIds.lidId);
    } else {
      phone = phoneFromWhatsappCandidate(contact?.number || identityIds.sourceId);
    }

    if (!phone && identityIds.isLid) {
      try {
        const formatted = typeof contact?.getFormattedNumber === "function"
          ? await contact.getFormattedNumber()
          : "";
        phone = phoneFromWhatsappCandidate(formatted, identityIds.lidId);
      } catch {
        phone = "";
      }
    }

    const displayName = String(contact?.pushname || contact?.name || contact?.shortName || "").trim();
    return { phone, displayName, sourceId: identityIds.sourceId, lidId: identityIds.lidId };
  };

  const reconcileStoredLidLeadPhones = async (userId, client) => {
    const rows = await queryRows(
      `SELECT chat_id, MAX(created_at) AS last_seen_at
       FROM whatsapp_inbound_events
       WHERE user_id = ? AND chat_id LIKE '%@lid' AND lead_id != ''
       GROUP BY chat_id
       ORDER BY last_seen_at DESC
       LIMIT 250`,
      [String(userId)],
    );
    for (const row of rows) {
      const lidId = String(row.chat_id || "").trim();
      if (!isWhatsappLidId(lidId)) continue;
      const phone = await resolveWhatsappPhoneFromLid(client, lidId).catch(() => "");
      if (!phone) continue;
      await onResolvedLidIdentity({ userId: String(userId), chatId: lidId, phone }).catch((error) => {
        console.warn("Não foi possível reconciliar telefone LID de lead WhatsApp.", {
          userId: String(userId),
          chatId: lidId,
          code: error?.code || "WHATSAPP_LID_RECONCILE_FAILED",
        });
      });
    }
  };

  const attachClientEvents = (userId, client) => {
    const key = String(userId);
    const state = stateFor(key);

    client.on("qr", (qr) => {
      if (state.client !== client || !state.enabled) return;
      void (async () => {
        const QRCode = await resolveQrLibrary();
        const qrCodeDataUrl = await QRCode.toDataURL(String(qr), { margin: 1, width: 360, errorCorrectionLevel: "M" });
        const at = nowIso();
        await updateAccount(key, {
          enabled: true,
          status: "qr",
          qrCodeDataUrl,
          lastQrAt: at,
          lastError: "",
        });
      })().catch((error) => {
        state.status = "error";
        state.lastError = `Não foi possível gerar o QR Code: ${error?.message || error}`;
      });
    });

    client.on("authenticated", () => {
      if (state.client !== client || !state.enabled) return;
      void updateAccount(key, { enabled: true, status: "authenticated", qrCodeDataUrl: "", lastError: "" }).catch(() => undefined);
    });

    client.on("ready", () => {
      if (state.client !== client || !state.enabled) return;
      void (async () => {
        const compat = await installWhatsappWebRuntimeCompatibility(client);
        if (state.client !== client || !state.enabled) return;
        const info = client.info || {};
        const phone = normalizeWhatsappPhone(info?.wid?.user || info?.wid?._serialized || "");
        const displayName = String(info?.pushname || "").trim();
        const at = nowIso();
        await updateAccount(key, {
          enabled: true,
          status: "ready",
          qrCodeDataUrl: "",
          phone,
          displayName,
          lastReadyAt: at,
          lastError: "",
        });
        console.log("Compatibilidade WhatsApp Web ativa.", { userId: key, webVersion: compat?.webVersion || "unknown" });
        void reconcileStoredLidLeadPhones(key, client).catch((error) => {
          console.warn("Reconciliação de telefones LID do WhatsApp não foi concluída.", {
            userId: key,
            code: error?.code || "WHATSAPP_LID_RECONCILE_FAILED",
          });
        });
      })().catch((error) => {
        if (state.client !== client || !state.enabled) return;
        void updateAccount(key, {
          enabled: true,
          status: "error",
          qrCodeDataUrl: "",
          lastError: `Falha ao preparar compatibilidade do WhatsApp Web: ${error?.message || error}`.slice(0, 1000),
        }).catch(() => undefined);
      });
    });

    client.on("auth_failure", (message) => {
      if (state.client !== client || !state.enabled) return;
      const errorText = String(message || "Falha de autenticação no WhatsApp.").slice(0, 1000);
      void updateAccount(key, { enabled: true, status: "auth_failure", qrCodeDataUrl: "", lastError: errorText }).catch(() => undefined);
      scheduleReconnect(key);
    });

    client.on("disconnected", (reason) => {
      if (state.client !== client || !state.enabled) return;
      state.client = null;
      state.initializeStarted = false;
      const at = nowIso();
      void updateAccount(key, {
        status: "disconnected",
        qrCodeDataUrl: "",
        lastDisconnectAt: at,
        lastError: String(reason || "WhatsApp desconectado.").slice(0, 1000),
      }).then(() => scheduleReconnect(key)).catch(() => scheduleReconnect(key));
      void client.destroy().catch(() => undefined);
    });

    client.on("message", (message) => {
      if (state.client !== client || !state.enabled || !isEligibleInboundLeadMessage(message)) return;
      void (async () => {
        const identity = await resolveInboundIdentity(client, message);
        if (!identity.phone) {
          console.warn("WhatsApp inbound individual sem telefone resolvido; lead não criado.", {
            userId: key,
            sourceKind: identity.sourceId?.toLowerCase().endsWith("@lid") ? "lid" : "phone",
            messageId: serializedId(message.id),
          });
          return;
        }
        if (identity.lidId) {
          await onResolvedLidIdentity({
            userId: key,
            chatId: identity.lidId,
            phone: identity.phone,
          });
        }
        const leadResult = await onInboundLeadCandidate({
          userId: key,
          phone: identity.phone,
          displayName: identity.displayName,
          messageId: serializedId(message.id),
          chatId: String(message.from || ""),
          receivedAt: toIsoFromUnix(message.timestamp) || nowIso(),
          messageType: String(message.type || "chat"),
        });
        console.log("WhatsApp inbound lead processado.", {
          userId: key,
          outcome: leadResult?.outcome || "unknown",
          leadId: leadResult?.leadId || "",
          assignedToConnectedConsultant: leadResult?.responsibleUserId
            ? String(leadResult.responsibleUserId) === key
            : undefined,
        });
      })().catch((error) => {
        console.error("Falha ao processar lead de mensagem WhatsApp recebida.", {
          userId: key,
          code: error?.code || "WHATSAPP_INBOUND_LEAD_FAILED",
          message: String(error?.message || error).slice(0, 500),
        });
      });
    });
  };

  const startClientUnlocked = async (userId) => {
    const key = String(userId || "").trim();
    if (!enabled) {
      const error = new Error("O módulo WhatsApp está desativado no servidor.");
      error.statusCode = 503;
      throw error;
    }
    if (stopped) throw new Error("WhatsappRuntime já foi encerrado.");
    await ensureEligibleConsultant(key);
    await mkdir(sessionRoot, { recursive: true });

    const state = stateFor(key);
    if (state.client && state.initializeStarted) return state;

    const wa = await resolveLibrary();
    const clientId = whatsappClientIdForUser(key);
    const puppeteer = {
      headless,
      args: puppeteerArgs,
      ...(executablePath ? { executablePath } : {}),
    };
    const client = new wa.Client({
      authStrategy: new wa.LocalAuth({ clientId, dataPath: sessionRoot, rmMaxRetries: 6 }),
      puppeteer,
      takeoverOnConflict: true,
      takeoverTimeoutMs: 30000,
    });

    state.client = client;
    state.initializeStarted = true;
    await updateAccount(key, { enabled: true, status: "initializing", qrCodeDataUrl: "", lastError: "" });
    attachClientEvents(key, client);
    void client.initialize().catch((error) => {
      if (state.client !== client) return;
      state.client = null;
      state.initializeStarted = false;
      void updateAccount(key, {
        status: "error",
        lastError: String(error?.message || error || "Falha ao inicializar WhatsApp.").slice(0, 1000),
      }).finally(() => scheduleReconnect(key));
      void client.destroy().catch(() => undefined);
    });
    return state;
  };

  const startClient = async (userId) => {
    const key = String(userId || "").trim();
    const currentPromise = startPromises.get(key);
    if (currentPromise) return currentPromise;
    const promise = startClientUnlocked(key);
    startPromises.set(key, promise);
    try {
      return await promise;
    } finally {
      if (startPromises.get(key) === promise) startPromises.delete(key);
    }
  };

  const restart = async (userId, { preserveSession = true, automatic = false } = {}) => {
    const key = String(userId || "").trim();
    if (!automatic) await ensureEligibleConsultant(key);
    const pendingStart = startPromises.get(key);
    if (pendingStart) await pendingStart.catch(() => undefined);
    await destroyClient(key, { logout: !preserveSession });
    await updateAccount(key, { enabled: true, status: "reconnecting", qrCodeDataUrl: "", lastError: "" });
    return startClient(key);
  };

  const disableUserRuntime = async (userId) => {
    const key = String(userId || "").trim();
    if (!key) return makePublicAccountState(null, null);
    const pendingStart = startPromises.get(key);
    if (pendingStart) await pendingStart.catch(() => undefined);
    const existingRow = await getAccountRow(key).catch(() => null);
    const existingState = states.get(key) || null;
    if (existingState) existingState.enabled = false;
    if (existingRow || existingState) {
      await updateAccount(key, { enabled: false, status: "disconnected", qrCodeDataUrl: "", lastError: "" });
    }
    await destroyClient(key, { logout: true });
    return makePublicAccountState(states.get(key) || null, existingRow);
  };

  return {
    async start() {
      if (!enabled) return;
      await mkdir(sessionRoot, { recursive: true });
      const rows = await queryRows(
        `SELECT wa.user_id
         FROM whatsapp_accounts wa
         INNER JOIN users u ON u.id = wa.user_id
         WHERE wa.enabled = 1 AND u.is_active = 1 AND u.role IN ('consultor_vendas', 'vendedor')
         ORDER BY wa.updated_at ASC`,
      );
      for (const row of rows) {
        void startClient(row.user_id).catch((error) => {
          console.warn("Não foi possível restaurar sessão WhatsApp.", { userId: row.user_id, code: error?.code || "WHATSAPP_RESTORE_FAILED" });
        });
      }
    },

    async stop() {
      stopped = true;
      for (const timer of reconnectTimers.values()) clearTimeout(timer);
      reconnectTimers.clear();
      await Promise.allSettled(Array.from(startPromises.values()));
      await Promise.allSettled(Array.from(states.keys()).map((userId) => destroyClient(userId, { logout: false })));
    },

    async connect(userId) {
      await startClient(userId);
      return this.getStatus(userId);
    },

    async reconnect(userId) {
      await restart(userId, { preserveSession: true });
      return this.getStatus(userId);
    },

    async disconnect(userId) {
      const key = String(userId || "").trim();
      await ensureEligibleConsultant(key);
      await disableUserRuntime(key);
      return this.getStatus(key);
    },

    async disableUser(userId) {
      return disableUserRuntime(userId);
    },

    async getStatus(userId) {
      const key = String(userId || "").trim();
      const row = await getAccountRow(key);
      const state = states.get(key) || null;
      if (row && Number(row.enabled || 0) === 1 && !state?.client && enabled && !stopped) {
        void startClient(key).catch(() => undefined);
      }
      return makePublicAccountState(state, row);
    },

    async listAccounts() {
      const rows = await queryRows(
        `SELECT wa.*, u.name AS user_name, u.email AS user_email, u.role AS user_role, u.team_id AS user_team_id
         FROM whatsapp_accounts wa
         INNER JOIN users u ON u.id = wa.user_id
         WHERE wa.enabled = 1
           AND u.is_active = 1
           AND u.role IN ('consultor_vendas', 'vendedor')
         ORDER BY u.name ASC, u.email ASC`,
      );
      return rows.map((row) => {
        const key = String(row.user_id || "");
        const publicState = makePublicAccountState(states.get(key) || null, row);
        if (Number(row.enabled || 0) === 1 && !states.get(key)?.client && enabled && !stopped) {
          void startClient(key).catch(() => undefined);
        }
        return {
          userId: key,
          userName: String(row.user_name || "Consultor"),
          userEmail: String(row.user_email || ""),
          role: String(row.user_role || "consultor_vendas"),
          teamId: String(row.user_team_id || ""),
          enabled: publicState.enabled,
          status: publicState.status,
          connected: publicState.connected,
          phone: publicState.phone,
          displayName: publicState.displayName,
          lastReadyAt: publicState.lastReadyAt,
          lastDisconnectAt: publicState.lastDisconnectAt,
          lastError: publicState.lastError,
        };
      });
    },

    async getLeadRouting(userId) {
      const key = String(userId || "").trim();
      await ensureEligibleConsultant(key);
      const row = await getAccountRow(key);
      return {
        pipelineId: String(row?.lead_pipeline_id || ""),
        stageId: String(row?.lead_pipeline_stage_id || ""),
      };
    },

    async setLeadRouting(userId, routing = {}) {
      const key = String(userId || "").trim();
      await ensureEligibleConsultant(key);
      const pipelineId = String(routing.pipelineId || "").trim().slice(0, 64);
      const stageId = String(routing.stageId || "").trim().slice(0, 64);
      const at = nowIso();
      await execute(
        `INSERT INTO whatsapp_accounts (
          user_id, lead_pipeline_id, lead_pipeline_stage_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          lead_pipeline_id = VALUES(lead_pipeline_id),
          lead_pipeline_stage_id = VALUES(lead_pipeline_stage_id),
          updated_at = VALUES(updated_at)`,
        [key, pipelineId, stageId, at, at],
      );
      return { pipelineId, stageId };
    },

    async getChats(userId, options = {}) {
      const state = stateFor(userId);
      if (state.status !== "ready" || !state.client) {
        const error = new Error("Conecte o WhatsApp antes de abrir as conversas.");
        error.statusCode = 409;
        throw error;
      }
      const limit = Math.min(Math.max(Number(options.limit || DEFAULT_MAX_CHATS), 1), 250);
      const search = String(options.search || "").trim().toLowerCase();
      let chats;
      try {
        chats = await state.client.getChats();
      } catch (firstError) {
        // WhatsApp Web can reinject its runtime after an internal navigation.
        // Reapply our live compatibility layer once and retry this read-only call.
        try {
          await installWhatsappWebRuntimeCompatibility(state.client);
          chats = await state.client.getChats();
        } catch {
          throw firstError;
        }
      }
      const mapped = chats
        .filter((chat) => !serializedId(chat?.id).endsWith("@broadcast"))
        .map((chat) => ({
          id: serializedId(chat?.id),
          name: String(chat?.name || "Conversa"),
          isGroup: Boolean(chat?.isGroup),
          unreadCount: Number(chat?.unreadCount || 0),
          timestamp: safeUnixTimestamp(chat?.timestamp || chat?.lastMessage?.timestamp),
          updatedAt: toIsoFromUnix(chat?.timestamp || chat?.lastMessage?.timestamp),
          lastMessage: mapLastMessage(chat?.lastMessage),
        }))
        .filter((chat) => !search || `${chat.name} ${chat.id} ${chat.lastMessage?.body || ""}`.toLowerCase().includes(search))
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);
      return mapped;
    },

    async getMessages(userId, chatId, options = {}) {
      const state = stateFor(userId);
      if (state.status !== "ready" || !state.client) {
        const error = new Error("Conecte o WhatsApp antes de abrir as mensagens.");
        error.statusCode = 409;
        throw error;
      }
      const normalizedChatId = String(chatId || "").trim();
      if (!normalizedChatId) {
        const error = new Error("Conversa inválida.");
        error.statusCode = 400;
        throw error;
      }
      const limit = Math.min(Math.max(Number(options.limit || DEFAULT_MAX_MESSAGES), 1), 150);
      const fetchMessages = async () => {
        const chat = await state.client.getChatById(normalizedChatId);
        if (!chat) {
          const error = new Error("Conversa não encontrada no WhatsApp conectado.");
          error.statusCode = 404;
          throw error;
        }
        return chat.fetchMessages({ limit });
      };
      let messages;
      try {
        messages = await fetchMessages();
      } catch (firstError) {
        try {
          await installWhatsappWebRuntimeCompatibility(state.client);
          messages = await fetchMessages();
        } catch {
          throw firstError;
        }
      }
      return messages.map(mapMessage);
    },

    async getMedia(userId, messageId) {
      const state = stateFor(userId);
      if (state.status !== "ready" || !state.client) {
        const error = new Error("WhatsApp não conectado.");
        error.statusCode = 409;
        throw error;
      }
      const message = await state.client.getMessageById(String(messageId || ""));
      if (!message || !message.hasMedia) {
        const error = new Error("Mídia não encontrada ou indisponível.");
        error.statusCode = 404;
        throw error;
      }
      let media;
      try {
        media = await message.downloadMedia();
      } catch (firstError) {
        // Safe read-only retry after restoring the $1 -> _serialized compatibility.
        try {
          await installWhatsappWebRuntimeCompatibility(state.client);
          const refreshedMessage = await state.client.getMessageById(String(messageId || ""));
          media = await refreshedMessage?.downloadMedia?.();
        } catch {
          throw firstError;
        }
      }
      if (!media?.data) {
        const error = new Error("A mídia expirou ou não pôde ser baixada pelo WhatsApp.");
        error.statusCode = 410;
        throw error;
      }
      const mediaData = String(media.data || "");
      if (mediaData.length > MAX_MEDIA_BASE64_CHARS) {
        const error = new Error("A midia excede o limite de 16 MB para visualizacao no CRM.");
        error.statusCode = 413;
        throw error;
      }
      return {
        mimetype: String(media.mimetype || "application/octet-stream"),
        data: mediaData,
        filename: String(media.filename || ""),
        filesize: Number(media.filesize || 0),
      };
    },

    async sendMessage(userId, payload = {}) {
      const state = stateFor(userId);
      if (state.status !== "ready" || !state.client) {
        const error = new Error("Conecte o WhatsApp antes de enviar mensagens.");
        error.statusCode = 409;
        throw error;
      }
      const chatId = String(payload.chatId || "").trim();
      const kind = String(payload.kind || "text").trim().toLowerCase();
      if (!chatId) {
        const error = new Error("Selecione uma conversa para enviar a mensagem.");
        error.statusCode = 400;
        throw error;
      }

      let sent;
      if (kind === "text") {
        const text = String(payload.text || "").trim();
        if (!text) {
          const error = new Error("Digite uma mensagem.");
          error.statusCode = 400;
          throw error;
        }
        if (text.length > 8000) {
          const error = new Error("Mensagem de texto excede o limite de 8.000 caracteres.");
          error.statusCode = 400;
          throw error;
        }
        sent = await state.client.sendMessage(chatId, text);
      } else if (kind === "image" || kind === "audio" || kind === "document") {
        const data = String(payload.data || "");
        if (!data || data.length > MAX_MEDIA_BASE64_CHARS) {
          const error = new Error("Arquivo vazio ou acima do limite permitido.");
          error.statusCode = data.length > MAX_MEDIA_BASE64_CHARS ? 413 : 400;
          throw error;
        }
        const wa = await resolveLibrary();
        const fallbackMime = kind === "image" ? "image/jpeg" : kind === "audio" ? "audio/webm;codecs=opus" : "application/octet-stream";
        const rawMimetype = String(payload.mimetype || fallbackMime).trim();
        const validationMime = rawMimetype.toLowerCase();
        if ((kind === "image" && !validationMime.startsWith("image/")) || (kind === "audio" && !validationMime.startsWith("audio/"))) {
          const error = new Error("Tipo MIME incompativel com a midia enviada.");
          error.statusCode = 400;
          throw error;
        }
        await installWhatsappWebRuntimeCompatibility(state.client);
        const defaultFilename = kind === "image" ? "imagem" : kind === "audio" ? "audio.webm" : "arquivo";
        const media = new wa.MessageMedia(
          rawMimetype,
          data,
          String(payload.filename || defaultFilename).slice(0, 255),
        );
        // Do not use waitUntilMsgSent here. On current WhatsApp Web builds the
        // promise can reject after the media has already been queued, producing
        // a false 500 and tempting callers to retry (which can duplicate files).
        // Delivery state is observed through the normal message ACK flow.
        sent = await state.client.sendMessage(chatId, media, {
          sendSeen: false,
          ...(kind === "image" && payload.caption ? { caption: String(payload.caption).slice(0, 2000) } : {}),
          ...(kind === "audio" ? { sendAudioAsVoice: true } : {}),
          ...(kind === "document" ? { sendMediaAsDocument: true } : {}),
        });
      } else {
        const error = new Error("Tipo de mensagem não suportado.");
        error.statusCode = 400;
        throw error;
      }
      if (sent) return mapMessage(sent);
      return {
        id: `local-${Date.now()}`,
        chatId,
        fromMe: true,
        body: kind === "text" ? String(payload.text || "") : String(payload.caption || ""),
        type: kind === "audio" ? "ptt" : kind,
        hasMedia: kind !== "text",
        mediaKind: kind === "text" ? "" : kind,
        timestamp: Math.floor(Date.now() / 1000),
        createdAt: nowIso(),
        ack: 0,
      };
    },
  };
}
