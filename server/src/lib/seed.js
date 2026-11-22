import { DEFAULT_CATEGORIES, DEFAULT_FEE_PRESETS } from '@ft/shared';

/** Give a brand-new household its default categories and transfer fee presets. */
export async function seedHousehold(client, householdId) {
  for (const c of DEFAULT_CATEGORIES) {
    await client.query(
      `INSERT INTO categories (household_id, name, kind, icon, is_system) VALUES ($1, $2, $3, $4, $5)`,
      [householdId, c.name, c.kind, c.icon, Boolean(c.system)],
    );
  }
  for (const p of DEFAULT_FEE_PRESETS) {
    await client.query(
      `INSERT INTO transfer_fee_presets (household_id, name, fee_cents, fee_paid_by) VALUES ($1, $2, $3, $4)`,
      [householdId, p.name, p.fee_cents, p.fee_paid_by],
    );
  }
}
