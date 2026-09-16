require('dotenv').config();
const bcrypt = require('bcryptjs');
const { initStore, getStore, DEFAULTS } = require('./store');

/**
 * Creates the default admin user, singletons and sample content if missing.
 * Safe to run repeatedly — it never overwrites existing data.
 */
async function ensureSeed() {
  const store = getStore();

  const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'Admin@12345';

  const existing = await store.findUser(username);
  if (!existing) {
    await store.createUser({
      username,
      passwordHash: await bcrypt.hash(password, 10),
      displayName: 'Administrator',
      role: 'admin',
    });
    console.log(`[seed] Admin user created -> username: "${username}"  password: "${password}"`);
    console.log('[seed] Change this password immediately after first login.');
  }

  // Singletons
  for (const key of ['settings', 'links']) {
    const current = await store.getSingleton(key);
    await store.setSingleton(key, { ...structuredClone(DEFAULTS[key]), ...current });
  }

  // One-time migration: fold the old standalone "vendors" collection into
  // the unified "ads" collection (kind: 'listing'). Runs exactly once, ever —
  // gated by a persistent flag rather than "is ads empty right now", so it
  // can never mistake a deliberately-emptied list for an unmigrated one and
  // silently bring old data back.
  const migrations = (await store.getSingleton('migrations')) || {};
  if (!migrations.vendorsToAds) {
    const oldVendors = await store.list('vendors');
    if (oldVendors.length > 0) {
      for (const v of oldVendors) {
        await store.create('ads', {
          kind: 'listing',
          name: v.name,
          location: v.location || '',
          phone: v.phone || '',
          category: v.category || '',
          active: v.active !== false,
          order: v.order ?? 0,
        });
      }
      console.log(`[seed] Migrated ${oldVendors.length} vendor(s) into the unified ads collection.`);
    } else {
      const existingListings = (await store.list('ads')).filter((a) => a.kind === 'listing');
      if (existingListings.length === 0) {
        const samples = [
          { name: 'Sainik Xerox & Stationery', location: 'Gate No. 1, Near Reception', phone: '9876543210', category: 'Documentation', order: 1 },
          { name: 'Veer Photo Studio', location: 'Block B, Ground Floor', phone: '9876543211', category: 'Photography', order: 2 },
          { name: 'Ex-Servicemen Canteen', location: 'Behind Admin Block', phone: '9876543212', category: 'Refreshments', order: 3 },
        ];
        for (const s of samples) await store.create('ads', { kind: 'listing', active: true, ...s });
        console.log('[seed] Sample listings added.');
      }
    }
    await store.setSingleton('migrations', { ...migrations, vendorsToAds: true });
  }

  // Sample notices (only when empty)
  const notices = await store.list('notices');
  if (notices.length === 0) {
    const today = new Date();
    const plus = (d) => new Date(today.getTime() + d * 86400000);
    const samples = [
      { type: 'counter_closed', counters: [2, 5], startDate: today, endDate: plus(3), active: true, order: 1 },
      { type: 'secretary_unavailable', startDate: today, endDate: plus(1), active: true, order: 2 },
      { type: 'office_closed', occasion: 'Independence Day', startDate: plus(30), endDate: plus(30), active: true, order: 3 },
      { type: 'custom', customText: 'Pension verification camp will be held every Wednesday, 10:00 AM to 1:00 PM.', startDate: today, endDate: plus(60), active: true, order: 4 },
    ];
    for (const n of samples) await store.create('notices', { counters: [], occasion: '', customText: '', ...n });
    console.log('[seed] Sample notices added.');
  }
}

async function main() {
  await initStore();
  await ensureSeed();
  console.log('[seed] Done.');
  process.exit(0);
}

if (require.main === module) main();

module.exports = { ensureSeed };
