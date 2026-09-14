'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RUNTIME_DIR = __dirname;
const PACKAGE_DIR = path.join(RUNTIME_DIR, 'node_modules', 'whatsapp-web.js');
const PACKAGE_JSON = path.join(PACKAGE_DIR, 'package.json');
const UTILS_FILE = path.join(PACKAGE_DIR, 'src', 'util', 'Injected', 'Utils.js');

const PATCH_MARKER = 'BOBCRM_WWEBJS_23000_COMPAT';

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const index = source.indexOf(before);
  if (index === -1) {
    throw new Error(`Nao foi possivel aplicar o patch whatsapp-web.js (${label}). Estrutura inesperada do pacote.`);
  }
  return source.slice(0, index) + after + source.slice(index + before.length);
}

function patchUtilsSource(input) {
  let source = String(input || '');
  if (source.includes(PATCH_MARKER)) return source;

  const helper = [
    `    // ${PATCH_MARKER}: WhatsApp Web 2.3000.x passou a expor alguns WIDs`,
    '    // com $1 em vez de _serialized. Normalize antes de atravessar o CDP.',
    '    window.WWebJS.__widToSerialized = (wid) => {',
    '        if (wid === null || wid === undefined) return wid;',
    "        if (typeof wid === 'string') return wid;",
    "        if (typeof wid._serialized === 'string') return wid._serialized;",
    "        if (typeof wid.$1 === 'string') return wid.$1;",
    "        if (typeof wid.user === 'string' && typeof wid.server === 'string') {",
    '            return `${wid.user}@${wid.server}`;',
    '        }',
    '        return undefined;',
    '    };',
    '',
    '    window.WWebJS.__ensureSerializedIds = (model) => {',
    '        try {',
    "            if (!model || typeof model !== 'object') return model;",
    '            const fixWid = (obj, key) => {',
    '                const value = obj && obj[key];',
    "                if (!value || typeof value !== 'object') return;",
    '                const serialized = window.WWebJS.__widToSerialized(value);',
    '                if (serialized !== undefined) obj[key] = serialized;',
    '            };',
    '            const fixId = (obj) => {',
    "                if (!obj || typeof obj !== 'object') return;",
    "                if (obj.id && typeof obj.id === 'object' && typeof obj.id._serialized !== 'string') {",
    '                    const serialized = window.WWebJS.__widToSerialized(obj.id);',
    '                    if (serialized !== undefined) obj.id._serialized = serialized;',
    '                }',
    "                fixWid(obj, 'from');",
    "                fixWid(obj, 'to');",
    "                fixWid(obj, 'author');",
    '            };',
    '            fixId(model);',
    '            if (model.groupMetadata && Array.isArray(model.groupMetadata.participants)) {',
    '                model.groupMetadata.participants.forEach((participant) => fixId(participant));',
    '            }',
    '            if (model.lastMessage) fixId(model.lastMessage);',
    '            return model;',
    '        } catch (_) {',
    '            return model;',
    '        }',
    '    };',
    '',
  ].join('\n') + '\n';

  source = replaceOnce(source, '    window.WWebJS = {};\n', `    window.WWebJS = {};\n${helper}`, 'helpers de serializacao');

  source = replaceOnce(source, '            .Msg.get(newMsgKey._serialized);', '            .Msg.get(newMsgKey._serialized || newMsgKey.$1);', 'sendMessage/newMsgKey');
  source = replaceOnce(source, "        return window.require('WAWebCollections').Msg.get(msg.id._serialized);", "        return window.require('WAWebCollections').Msg.get(msg.id._serialized || msg.id.$1);", 'editMessage/msg.id');
  source = replaceOnce(source, '    window.WWebJS.getMessageModel = (message) => {\n        const msg = message.serialize();\n', '    window.WWebJS.getMessageModel = (message) => {\n        const msg = message.serialize();\n        window.WWebJS.__ensureSerializedIds(msg);\n', 'getMessageModel normalizer');
  source = replaceOnce(source, '                remote: msg.id.remote._serialized,', '                remote: msg.id.remote._serialized || msg.id.remote.$1,', 'message remote id');

  const oldChatsBlock = [
    '    window.WWebJS.getChats = async () => {',
    "        const chats = window.require('WAWebCollections').Chat.getModelsArray();",
    '        const chatPromises = chats.map((chat) =>',
    '            window.WWebJS.getChatModel(chat),',
    '        );',
    '        return await Promise.all(chatPromises);',
    '    };',
    '    window.WWebJS.getChannels = async () => {',
    '        const channels = window',
    "            .require('WAWebCollections')",
    '            .WAWebNewsletterCollection.getModelsArray();',
    '        const channelPromises = channels?.map((channel) =>',
    '            window.WWebJS.getChatModel(channel, { isChannel: true }),',
    '        );',
    '        return await Promise.all(channelPromises);',
    '    };',
    '',
  ].join('\n');

  const newChatsBlock = [
    '    window.WWebJS.__getChatModelSafe = async (chat, opts) => {',
    '        try {',
    '            return await window.WWebJS.getChatModel(chat, opts);',
    '        } catch (_) {',
    '            try {',
    '                const fallback = chat && chat.serialize ? chat.serialize() : null;',
    '                if (fallback) window.WWebJS.__ensureSerializedIds(fallback);',
    '                return fallback || null;',
    '            } catch (_) {',
    '                return null;',
    '            }',
    '        }',
    '    };',
    '',
    '    window.WWebJS.getChats = async () => {',
    "        const chats = window.require('WAWebCollections').Chat.getModelsArray();",
    '        const results = await Promise.all(',
    '            chats.map((chat) => window.WWebJS.__getChatModelSafe(chat)),',
    '        );',
    '        return results.filter(Boolean);',
    '    };',
    '    window.WWebJS.getChannels = async () => {',
    '        const channels = window',
    "            .require('WAWebCollections')",
    '            .WAWebNewsletterCollection.getModelsArray();',
    '        const results = await Promise.all(',
    '            (channels || []).map((channel) =>',
    '                window.WWebJS.__getChatModelSafe(channel, { isChannel: true }),',
    '            ),',
    '        );',
    '        return results.filter(Boolean);',
    '    };',
    '',
  ].join('\n');
  source = replaceOnce(source, oldChatsBlock, newChatsBlock, 'getChats/getChannels fault isolation');

  source = replaceOnce(source, '        const model = chat.serialize();\n        model.isGroup = false;', '        const model = chat.serialize();\n        window.WWebJS.__ensureSerializedIds(model);\n        model.isGroup = false;', 'getChatModel normalizer');
  source = replaceOnce(source, '                .createWid(chat.id._serialized);', '                .createWid(chat.id._serialized || chat.id.$1);', 'group chat wid');

  const oldGroupBlock = [
    '            await groupMetadata.update(chatWid);',
    "            const { toPn } = window.require('WAWebLidMigrationUtils');",
    '            const serializedMetadata = chat.groupMetadata.serialize();',
    '            for (const p of serializedMetadata.participants || []) {',
    '                p.id = toPn(p.id) ?? p.id;',
    '            }',
    '            model.groupMetadata = serializedMetadata;',
    '            model.isReadOnly = chat.groupMetadata.announce;',
  ].join('\n');

  const newGroupBlock = [
    '            try {',
    '                await groupMetadata.update(chatWid);',
    '            } catch (_) {',
    '                // Metadado de grupo obsoleto/revogado nao deve derrubar toda a lista.',
    '            }',
    '            try {',
    "                const { toPn } = window.require('WAWebLidMigrationUtils');",
    '                const serializedMetadata = chat.groupMetadata.serialize();',
    '                for (const p of serializedMetadata.participants || []) {',
    '                    try {',
    '                        p.id = toPn(p.id) ?? p.id;',
    '                    } catch (_) {',
    '                        // Mantem o id original quando a migracao LID -> PN falhar.',
    '                    }',
    '                }',
    '                model.groupMetadata = serializedMetadata;',
    '            } catch (_) {',
    '                try {',
    '                    model.groupMetadata = chat.groupMetadata.serialize();',
    '                } catch (_) {',
    '                    // Campo opcional.',
    '                }',
    '            }',
    '            try {',
    '                model.isReadOnly = chat.groupMetadata.announce;',
    '            } catch (_) {',
    '                // Campo opcional.',
    '            }',
  ].join('\n');
  source = replaceOnce(source, oldGroupBlock, newGroupBlock, 'group metadata isolation');

  const oldNewsletterBlock = [
    '            await newsletterMetadata.update(chat.id);',
    '            model.channelMetadata = chat.newsletterMetadata.serialize();',
    '            model.channelMetadata.createdAtTs =',
    '                chat.newsletterMetadata.creationTime;',
  ].join('\n');
  const newNewsletterBlock = [
    '            try {',
    '                await newsletterMetadata.update(chat.id);',
    '            } catch (_) {',
    '                // Canal revogado/suspenso nao deve derrubar a lista inteira.',
    '            }',
    '            try {',
    '                model.channelMetadata = chat.newsletterMetadata.serialize();',
    '                model.channelMetadata.createdAtTs =',
    '                    chat.newsletterMetadata.creationTime;',
    '            } catch (_) {',
    '                // Campo opcional.',
    '            }',
  ].join('\n');
  source = replaceOnce(source, oldNewsletterBlock, newNewsletterBlock, 'newsletter metadata isolation');

  source = replaceOnce(source, '                      .Msg.get(chat.lastReceivedKey._serialized) ||', '                      .Msg.get(chat.lastReceivedKey._serialized || chat.lastReceivedKey.$1) ||', 'lastReceivedKey cache');
  source = replaceOnce(source, '                              chat.lastReceivedKey._serialized,', '                              chat.lastReceivedKey._serialized || chat.lastReceivedKey.$1,', 'lastReceivedKey fetch');
  source = replaceOnce(source, '    window.WWebJS.getContactModel = (contact) => {\n        let res = contact.serialize();\n', '    window.WWebJS.getContactModel = (contact) => {\n        let res = contact.serialize();\n        window.WWebJS.__ensureSerializedIds(res);\n', 'getContactModel normalizer');

  source = source.replace('.getMaybeMePnUser()._serialized;', ".getMaybeMePnUser()?._serialized || window.require('WAWebUserPrefsMeUser').getMaybeMePnUser()?.$1;");
  source = source.replace(".createWid(p.jid)._serialized,", ".createWid(p.jid)._serialized || window.require('WAWebWidFactory').createWid(p.jid).$1,");
  source = source.replace(")._serialized,\n                        message: 'ServerStatusCodeError',", ")._serialized || window.require('WAWebJidToWid').userJidToUserWid(participant.participantArgs[0].participantJid).$1,\n                        message: 'ServerStatusCodeError',");

  return source;
}

function applyPatch() {
  if (!fs.existsSync(PACKAGE_JSON) || !fs.existsSync(UTILS_FILE)) {
    console.log('[whatsapp-runtime] whatsapp-web.js ainda nao esta instalado; patch de compatibilidade sera aplicado apos a instalacao.');
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
  const before = fs.readFileSync(UTILS_FILE, 'utf8');
  if (before.includes(PATCH_MARKER)) {
    console.log(`[whatsapp-runtime] patch WhatsApp Web 2.3000.x ja aplicado em whatsapp-web.js ${pkg.version}.`);
    return;
  }

  const after = patchUtilsSource(before);
  fs.writeFileSync(UTILS_FILE, after, 'utf8');
  console.log(`[whatsapp-runtime] patch WhatsApp Web 2.3000.x aplicado em whatsapp-web.js ${pkg.version}.`);
}

if (require.main === module) {
  try {
    applyPatch();
  } catch (error) {
    console.error('[whatsapp-runtime] falha ao aplicar patch de compatibilidade:', error?.message || error);
    process.exitCode = 1;
  }
}

module.exports = { patchUtilsSource, applyPatch, PATCH_MARKER };
