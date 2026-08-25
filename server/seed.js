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

  // Sample vendors (only when empty)
  const vendors = await store.list('vendors');
  if (vendors.length === 0) {
    const samples = [
      { name: 'Sainik Xerox & Stationery', location: 'Gate No. 1, Near Reception', phone: '9876543210', category: 'Documentation', order: 1 },
      { name: 'Veer Photo Studio', location: 'Block B, Ground Floor', phone: '9876543211', category: 'Photography', order: 2 },
      { name: 'Ex-Servicemen Canteen', location: 'Behind Admin Block', phone: '9876543212', category: 'Refreshments', order: 3 },
    ];
    for (const v of samples) await store.create('vendors', { active: true, ...v });
    console.log('[seed] Sample vendors added.');
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
