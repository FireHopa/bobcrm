export const version = "20260807_21_instagram_channel_advertising";
export const description = "Instagram nativo e sinalização de não anúncio por canal";

export async function up({ execute, addColumnIfMissing }) {
  for (const tableName of ["leads", "leads_archive"]) {
    await addColumnIfMissing(tableName, "instagram", "VARCHAR(255) NOT NULL DEFAULT '' AFTER website");
    await addColumnIfMissing(tableName, "does_not_advertise_on_meta", "TINYINT(1) NOT NULL DEFAULT 0 AFTER does_not_advertise");
    await addColumnIfMissing(tableName, "does_not_advertise_on_google", "TINYINT(1) NOT NULL DEFAULT 0 AFTER does_not_advertise_on_meta");
    await execute(`UPDATE \`${tableName}\`
      SET does_not_advertise_on_meta = 1, does_not_advertise_on_google = 1
      WHERE does_not_advertise = 1`);
  }
}
