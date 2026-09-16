/**
 * End-to-end API test suite. Boots the server on a test port, exercises every
 * endpoint (public + authenticated + error paths) and prints a pass/fail table.
 *
 *   npm test
 *
 * Uses a temporary JSON store so it never touches your real data.
 */
process.env.PORT = process.env.TEST_PORT || '4555';
process.env.MONGODB_URI = ''; // force the file driver
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'Admin@12345';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const DATA_FILE = path.join(__dirname, '..', 'data', 'db.json');
const BACKUP = DATA_FILE + '.testbak';

const BASE = `http://127.0.0.1:${process.env.PORT}`;
let token = '';
let passed = 0;
let failed = 0;

async function call(method, p, body, auth = true) {
  const headers = {};
  if (auth && token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* html */ }
  return { status: res.status, json };
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${err.message}`);
  }
}

(async function run() {
  // isolate data
  if (fs.existsSync(DATA_FILE)) fs.renameSync(DATA_FILE, BACKUP);

  const { start } = require('../server/index');
  await start();
  await new Promise((r) => setTimeout(r, 300));

  console.log('\n── Health & public endpoints ──');
  await test('GET /api/health returns ok', async () => {
    const r = await call('GET', '/api/health');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.ok, true);
  });
  await test('GET /api/content returns settings, links, notices, ads', async () => {
    const r = await call('GET', '/api/content');
    assert.strictEqual(r.status, 200);
    for (const k of ['settings', 'links', 'notices', 'ads']) {
      assert.ok(k in r.json.data, `missing ${k}`);
    }
  });
  await test('GET /api/content exposes only live notices with composed text', async () => {
    const r = await call('GET', '/api/content');
    r.json.data.notices.forEach((n) => assert.ok(n.text && n.text.length > 0));
  });
  await test('GET /api/ads is public', async () => {
    const r = await call('GET', '/api/ads', undefined, false);
    assert.strictEqual(r.status, 200);
  });
  await test('Unknown API route returns JSON 404', async () => {
    const r = await call('GET', '/api/does-not-exist');
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.json.ok, false);
  });

  console.log('\n── Authentication ──');
  await test('POST /api/auth/login rejects bad password', async () => {
    const r = await call('POST', '/api/auth/login', { username: 'admin', password: 'wrong' }, false);
    assert.strictEqual(r.status, 401);
  });
  await test('POST /api/auth/login rejects missing fields', async () => {
    const r = await call('POST', '/api/auth/login', { username: 'admin' }, false);
    assert.strictEqual(r.status, 400);
  });
  await test('POST /api/auth/login succeeds and returns a token', async () => {
    const r = await call('POST', '/api/auth/login', { username: 'admin', password: 'Admin@12345' }, false);
    assert.strictEqual(r.status, 200);
    assert.ok(r.json.token);
    token = r.json.token;
  });
  await test('GET /api/auth/me returns the current user', async () => {
    const r = await call('GET', '/api/auth/me');
    assert.strictEqual(r.json.user.username, 'admin');
  });
  await test('Protected route without token returns 401', async () => {
    const r = await call('GET', '/api/notices', undefined, false);
    assert.strictEqual(r.status, 401);
  });

  console.log('\n── Notices ──');
  let noticeId = null;
  await test('POST /api/notices rejects counter_closed with no counters', async () => {
    const r = await call('POST', '/api/notices', { type: 'counter_closed', counters: [], startDate: '2026-08-01' });
    assert.strictEqual(r.status, 400);
  });
  await test('POST /api/notices rejects endDate before startDate', async () => {
    const r = await call('POST', '/api/notices', { type: 'secretary_unavailable', startDate: '2026-08-10', endDate: '2026-08-01' });
    assert.strictEqual(r.status, 400);
  });
  await test('POST /api/notices creates a counter notice with correct text', async () => {
    const r = await call('POST', '/api/notices', {
      type: 'counter_closed', counters: [3, 1, 3], startDate: '2026-08-01', endDate: '2026-08-04',
    });
    assert.strictEqual(r.status, 201);
    assert.match(r.json.data.text, /Counters 1 and 3 will remain closed from 01 Aug 2026 to 04 Aug 2026\./);
    noticeId = r.json.data.id;
  });
  await test('POST /api/notices/preview composes office_closed text', async () => {
    const r = await call('POST', '/api/notices/preview', {
      type: 'office_closed', occasion: 'Independence Day', startDate: '2026-08-15', endDate: '2026-08-15',
    });
    assert.match(r.json.data.text, /Office will remain closed on 15 Aug 2026 on account of Independence Day\./);
  });
  await test('POST /api/notices/preview composes secretary text', async () => {
    const r = await call('POST', '/api/notices/preview', { type: 'secretary_unavailable', startDate: '2026-09-02' });
    assert.match(r.json.data.text, /Secretary will not be available on 02 Sep 2026\./);
  });
  await test('POST /api/notices rejects empty custom text', async () => {
    const r = await call('POST', '/api/notices', { type: 'custom', customText: '  ', startDate: '2026-08-01' });
    assert.strictEqual(r.status, 400);
  });
  await test('GET /api/notices lists notices with live flags', async () => {
    const r = await call('GET', '/api/notices');
    assert.ok(Array.isArray(r.json.data));
    assert.ok(r.json.data.some((n) => n.id === noticeId));
  });
  await test('PUT /api/notices/:id updates a notice', async () => {
    const r = await call('PUT', '/api/notices/' + noticeId, {
      type: 'counter_closed', counters: [7], startDate: '2026-08-01', endDate: '2026-08-01',
    });
    assert.match(r.json.data.text, /Counter 7 will remain closed on 01 Aug 2026\./);
  });
  await test('PATCH /api/notices/:id/toggle flips active', async () => {
    const r = await call('PATCH', '/api/notices/' + noticeId + '/toggle');
    assert.strictEqual(r.json.data.active, false);
  });
  await test('DELETE /api/notices/:id removes it', async () => {
    const r = await call('DELETE', '/api/notices/' + noticeId);
    assert.strictEqual(r.status, 200);
  });
  await test('DELETE unknown notice returns 404', async () => {
    const r = await call('DELETE', '/api/notices/deadbeefdeadbeefdeadbeef');
    assert.strictEqual(r.status, 404);
  });

  console.log('\n── Links (VMS / Grievance) ──');
  await test('PUT /api/links rejects an invalid URL', async () => {
    const r = await call('PUT', '/api/links', { vms: { enabled: true, link: 'not-a-url' } });
    assert.strictEqual(r.status, 400);
  });
  await test('PUT /api/links saves both links', async () => {
    const r = await call('PUT', '/api/links', {
      vms: { enabled: true, label: 'Visitor Pass', link: 'https://vms.example.gov.in', previewText: 'Redirecting…' },
      grievance: { enabled: true, label: 'Grievance', link: 'https://grievance.example.gov.in', previewText: 'Redirecting…' },
    });
    assert.strictEqual(r.json.data.vms.label, 'Visitor Pass');
    assert.strictEqual(r.json.data.grievance.link, 'https://grievance.example.gov.in');
  });
  await test('GET /api/content reflects the new links', async () => {
    const r = await call('GET', '/api/content', undefined, false);
    assert.strictEqual(r.json.data.links.vms.label, 'Visitor Pass');
  });

  console.log('\n── Advertisements (unified listing + poster) ──');
  let posterId = null;
  let listingId = null;
  await test('POST /api/ads rejects a missing name', async () => {
    const r = await call('POST', '/api/ads', { kind: 'poster', link: 'https://example.com' });
    assert.strictEqual(r.status, 400);
  });
  await test('POST /api/ads rejects an invalid link on a poster', async () => {
    const r = await call('POST', '/api/ads', { kind: 'poster', name: 'Veer Motors', link: 'not-a-url' });
    assert.strictEqual(r.status, 400);
  });
  await test('POST /api/ads creates a poster ad', async () => {
    const r = await call('POST', '/api/ads', {
      kind: 'poster', name: 'Unity Run', linkType: 'website',
      link: 'https://unityrun.example.com', imageUrl: '/uploads/x.png',
    });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.json.data.name, 'Unity Run');
    assert.strictEqual(r.json.data.kind, 'poster');
    posterId = r.json.data.id;
  });
  await test('POST /api/ads creates a listing entry (no link required)', async () => {
    const r = await call('POST', '/api/ads', {
      kind: 'listing', name: 'Test Vendor', location: 'Gate 2', phone: '9990001111',
    });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.json.data.kind, 'listing');
    listingId = r.json.data.id;
  });
  await test('Both entries appear together in public content', async () => {
    const r = await call('GET', '/api/content', undefined, false);
    const ids = r.json.data.ads.map((a) => a.id);
    assert.ok(ids.includes(posterId) && ids.includes(listingId));
  });
  await test('PUT /api/ads/:id updates a listing', async () => {
    const r = await call('PUT', '/api/ads/' + listingId, { kind: 'listing', name: 'Renamed Vendor', active: true });
    assert.strictEqual(r.json.data.name, 'Renamed Vendor');
  });
  await test('POST /api/ads/reorder sets explicit order', async () => {
    const r = await call('POST', '/api/ads/reorder', { order: [listingId, posterId] });
    assert.strictEqual(r.status, 200);
    const ordered = r.json.data.filter((a) => [listingId, posterId].includes(a.id));
    assert.strictEqual(ordered[0].id, listingId);
    assert.strictEqual(ordered[1].id, posterId);
  });
  await test('PATCH /api/ads/:id/toggle flips active', async () => {
    const r = await call('PATCH', '/api/ads/' + posterId + '/toggle');
    assert.strictEqual(r.json.data.active, false);
  });
  await test('Disabled ads are hidden from public content', async () => {
    const r = await call('GET', '/api/content', undefined, false);
    assert.ok(!r.json.data.ads.some((a) => a.id === posterId));
  });
  await test('DELETE /api/ads/:id removes it', async () => {
    const r = await call('DELETE', '/api/ads/' + posterId);
    assert.strictEqual(r.status, 200);
    const r2 = await call('DELETE', '/api/ads/' + listingId);
    assert.strictEqual(r2.status, 200);
  });

  console.log('\n── Settings & theme ──');
  await test('PUT /api/settings rejects an empty organisation name', async () => {
    const r = await call('PUT', '/api/settings', { orgName: '   ' });
    assert.strictEqual(r.status, 400);
  });
  await test('PUT /api/settings saves org, logo and theme', async () => {
    const r = await call('PUT', '/api/settings', {
      orgName: 'Zila Sainik Board, Khordha',
      district: 'Bhubaneswar',
      logoUrl: '/uploads/logo.png',
      marqueeSpeed: 30,
      theme: { navy: '#0b2545', red: '#c8102e', lightBlue: '#2e7fd4' },
    });
    assert.strictEqual(r.json.data.orgName, 'Zila Sainik Board, Khordha');
    assert.strictEqual(r.json.data.marqueeSpeed, 30);
    assert.strictEqual(r.json.data.theme.red, '#c8102e');
  });
  await test('POST /api/admin/reset-defaults restores defaults', async () => {
    const r = await call('POST', '/api/admin/reset-defaults', {});
    assert.strictEqual(r.status, 200);
    const s = await call('GET', '/api/settings', undefined, false);
    assert.strictEqual(s.json.data.orgName, 'Zila Sainik Board');
  });

  console.log('\n── Account ──');
  await test('Change password rejects a wrong current password', async () => {
    const r = await call('POST', '/api/auth/change-password', { currentPassword: 'nope', newPassword: 'LongEnough1' });
    assert.strictEqual(r.status, 401);
  });
  await test('Change password rejects a short new password', async () => {
    const r = await call('POST', '/api/auth/change-password', { currentPassword: 'Admin@12345', newPassword: 'short' });
    assert.strictEqual(r.status, 400);
  });
  await test('Change password succeeds and the new password works', async () => {
    const r = await call('POST', '/api/auth/change-password', { currentPassword: 'Admin@12345', newPassword: 'NewPass@2026' });
    assert.strictEqual(r.status, 200);
    const l = await call('POST', '/api/auth/login', { username: 'admin', password: 'NewPass@2026' }, false);
    assert.strictEqual(l.status, 200);
  });

  console.log('\n── Static pages ──');
  await test('GET / serves the public portal', async () => {
    const res = await fetch(BASE + '/');
    const html = await res.text();
    assert.ok(html.includes('Zila Sainik Board'));
  });
  await test('GET /admin serves the CMS', async () => {
    const res = await fetch(BASE + '/admin');
    const html = await res.text();
    assert.ok(html.includes('Admin CMS'));
  });

  /* summary */
  console.log(`\n${'─'.repeat(46)}`);
  console.log(`  Passed: ${passed}   Failed: ${failed}   Total: ${passed + failed}`);
  console.log(`${'─'.repeat(46)}\n`);

  // restore data
  try { fs.unlinkSync(DATA_FILE); } catch {}
  if (fs.existsSync(BACKUP)) fs.renameSync(BACKUP, DATA_FILE);

  process.exit(failed === 0 ? 0 : 1);
})();
