export const version = "20260910_27_whatsapp_webjs_crm";
export const description = "Sessoes individuais whatsapp-web.js e idempotencia de leads recebidos";

export async function up({ execute }) {
  await execute(`
    CREATE TABLE IF NOT EXISTS whatsapp_accounts (
      user_id VARCHAR(64) NOT NULL PRIMARY KEY,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      status VARCHAR(40) NOT NULL DEFAULT 'disconnected',
      phone VARCHAR(40) NOT NULL DEFAULT '',
      display_name VARCHAR(255) NOT NULL DEFAULT '',
      last_error VARCHAR(1000) NOT NULL DEFAULT '',
      last_qr_at VARCHAR(40) NOT NULL DEFAULT '',
      last_ready_at VARCHAR(40) NOT NULL DEFAULT '',
      last_disconnect_at VARCHAR(40) NOT NULL DEFAULT '',
      created_at VARCHAR(40) NOT NULL DEFAULT '',
      updated_at VARCHAR(40) NOT NULL DEFAULT '',
      INDEX idx_whatsapp_accounts_enabled (enabled, status),
      INDEX idx_whatsapp_accounts_updated (updated_at),
      CONSTRAINT fk_whatsapp_accounts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS whatsapp_inbound_events (
      message_id VARCHAR(191) NOT NULL PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      chat_id VARCHAR(191) NOT NULL DEFAULT '',
      phone_key VARCHAR(40) NOT NULL DEFAULT '',
      lead_id VARCHAR(64) NOT NULL DEFAULT '',
      outcome VARCHAR(40) NOT NULL DEFAULT 'processing',
      message_type VARCHAR(40) NOT NULL DEFAULT '',
      received_at VARCHAR(40) NOT NULL DEFAULT '',
      created_at VARCHAR(40) NOT NULL DEFAULT '',
      updated_at VARCHAR(40) NOT NULL DEFAULT '',
      INDEX idx_whatsapp_inbound_user_created (user_id, created_at),
      INDEX idx_whatsapp_inbound_phone (phone_key, created_at),
      INDEX idx_whatsapp_inbound_lead (lead_id, created_at),
      CONSTRAINT fk_whatsapp_inbound_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}
