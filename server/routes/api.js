const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const { getStore, DEFAULTS } = require('../store');
const { signToken, requireAuth } = require('../middleware/auth');
const { composeNoticeText, isLive, validateNotice } = require('../lib/notice');

const router = express.Router();

/* ------------------------------------------------------------------ */
/* File uploads (logo + ad poster) -> /public/uploads                   */
/* ------------------------------------------------------------------ */
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.png').toLowerCase();
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    },
  }),
  limits: { fileSize: 4 * 1024 * 1024 }, // 4 MB
  fileFilter: (_req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.mimetype);
    cb(ok ? null : new Error('Only PNG, JPG, WEBP or SVG images are allowed.'), ok);
  },
});

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */
router.get('/health', (_req, res) => {
  res.json({ ok: true, status: 'up', driver: getStore().name, time: new Date().toISOString() });
});

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many login attempts. Please try again in a few minutes.' },
});

router.post('/auth/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'Username and password are required.' });
    }
    const user = await getStore().findUser(username);
    if (!user || !(await bcrypt.compare(String(password), user.passwordHash))) {
      return res.status(401).json({ ok: false, error: 'Invalid username or password.' });
    }
    return res.json({
      ok: true,
      token: signToken(user),
      user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/auth/me', requireAuth, async (req, res, next) => {
  try {
    const user = await getStore().findUserById(req.user.sub);
    if (!user) return res.status(401).json({ ok: false, error: 'User no longer exists.' });
    return res.json({
      ok: true,
      user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/auth/change-password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ ok: false, error: 'Current and new password are required.' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ ok: false, error: 'New password must be at least 8 characters.' });
    }
    const user = await getStore().findUserById(req.user.sub);
    if (!user || !(await bcrypt.compare(String(currentPassword), user.passwordHash))) {
      return res.status(401).json({ ok: false, error: 'Current password is incorrect.' });
    }
    await getStore().setUserPassword(user.id, await bcrypt.hash(String(newPassword), 10));
    return res.json({ ok: true, message: 'Password updated.' });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Public aggregate content — everything the public page needs          */
/* ------------------------------------------------------------------ */
router.get('/content', async (_req, res, next) => {
  try {
    const store = getStore();
    const [settings, links, notices, vendors, ads] = await Promise.all([
      store.getSingleton('settings'),
      store.getSingleton('links'),
      store.list('notices'),
      store.list('vendors'),
      store.list('ads'),
    ]);

    const liveNotices = notices
      .filter((n) => isLive(n))
      .map((n) => ({ id: n.id, type: n.type, text: composeNoticeText(n) }))
      .filter((n) => n.text);

    return res.json({
      ok: true,
      data: {
        settings,
        links,
        notices: liveNotices,
        vendors: vendors.filter((v) => v.active !== false),
        ads: ads.filter((a) => a.active !== false),
      },
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Settings (org name, district, logo, theme)                          */
/* ------------------------------------------------------------------ */
router.get('/settings', async (_req, res, next) => {
  try {
    res.json({ ok: true, data: await getStore().getSingleton('settings') });
  } catch (err) {
    next(err);
  }
});

router.put('/settings', requireAuth, async (req, res, next) => {
  try {
    const current = await getStore().getSingleton('settings');
    const b = req.body || {};
    const next_ = {
      ...current,
      orgName: b.orgName !== undefined ? String(b.orgName).trim() : current.orgName,
      district: b.district !== undefined ? String(b.district).trim() : current.district,
      logoUrl: b.logoUrl !== undefined ? String(b.logoUrl).trim() : current.logoUrl,
      marqueeSpeed: b.marqueeSpeed !== undefined ? Math.min(90, Math.max(8, Number(b.marqueeSpeed) || 22)) : current.marqueeSpeed,
      theme: { ...current.theme, ...(b.theme || {}) },
    };
    if (!next_.orgName) return res.status(400).json({ ok: false, error: 'Organisation name cannot be empty.' });
    res.json({ ok: true, data: await getStore().setSingleton('settings', next_) });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Links (VMS + Grievance)                                             */
/* ------------------------------------------------------------------ */
const isHttpUrl = (u) => /^https?:\/\/.+/i.test(String(u || '').trim());

router.get('/links', async (_req, res, next) => {
  try {
    res.json({ ok: true, data: await getStore().getSingleton('links') });
  } catch (err) {
    next(err);
  }
});

router.put('/links', requireAuth, async (req, res, next) => {
  try {
    const current = await getStore().getSingleton('links');
    const b = req.body || {};
    const merge = (key) => {
      const c = current[key] || {};
      const n = b[key] || {};
      return {
        label: n.label !== undefined ? String(n.label).trim() : c.label,
        description: n.description !== undefined ? String(n.description).trim() : c.description,
        link: n.link !== undefined ? String(n.link).trim() : c.link,
        previewText: n.previewText !== undefined ? String(n.previewText).trim() : c.previewText,
        enabled: n.enabled !== undefined ? !!n.enabled : c.enabled !== false,
      };
    };
    const next_ = { vms: merge('vms'), grievance: merge('grievance') };
    for (const k of ['vms', 'grievance']) {
      if (next_[k].enabled && !isHttpUrl(next_[k].link)) {
        return res.status(400).json({ ok: false, error: `${k.toUpperCase()} link must be a valid http(s) URL.` });
      }
    }
    res.json({ ok: true, data: await getStore().setSingleton('links', next_) });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Ads CRUD (multiple ads, like vendors)                                */
/* ------------------------------------------------------------------ */
router.get('/ads', async (_req, res, next) => {
  try {
    res.json({ ok: true, data: await getStore().list('ads') });
  } catch (err) {
    next(err);
  }
});

function adPayload(b = {}) {
  const businessName = String(b.businessName || '').trim();
  if (!businessName) return { ok: false, error: 'Business name is required.' };
  const linkType = b.linkType === 'drive' ? 'drive' : 'website';
  const link = String(b.link || '').trim();
  if (link && !isHttpUrl(link)) {
    return { ok: false, error: 'Ad link must be a valid http(s) URL.' };
  }
  return {
    ok: true,
    value: {
      businessName,
      caption: String(b.caption || '').trim() || 'Advertisement',
      imageUrl: String(b.imageUrl || '').trim(),
      linkType,
      link,
      active: b.active === undefined ? true : !!b.active,
      order: Number.isFinite(Number(b.order)) ? Number(b.order) : 0,
    },
  };
}

router.post('/ads', requireAuth, async (req, res, next) => {
  try {
    const p = adPayload(req.body);
    if (!p.ok) return res.status(400).json({ ok: false, error: p.error });
    res.status(201).json({ ok: true, data: await getStore().create('ads', p.value) });
  } catch (err) {
    next(err);
  }
});

router.put('/ads/:id', requireAuth, async (req, res, next) => {
  try {
    const p = adPayload(req.body);
    if (!p.ok) return res.status(400).json({ ok: false, error: p.error });
    const updated = await getStore().update('ads', req.params.id, p.value);
    if (!updated) return res.status(404).json({ ok: false, error: 'Ad not found.' });
    res.json({ ok: true, data: updated });
  } catch (err) {
    next(err);
  }
});

router.patch('/ads/:id/toggle', requireAuth, async (req, res, next) => {
  try {
    const list = await getStore().list('ads');
    const found = list.find((a) => a.id === req.params.id);
    if (!found) return res.status(404).json({ ok: false, error: 'Ad not found.' });
    const updated = await getStore().update('ads', req.params.id, { active: !found.active });
    res.json({ ok: true, data: updated });
  } catch (err) {
    next(err);
  }
});

router.delete('/ads/:id', requireAuth, async (req, res, next) => {
  try {
    const done = await getStore().remove('ads', req.params.id);
    if (!done) return res.status(404).json({ ok: false, error: 'Ad not found.' });
    res.json({ ok: true, message: 'Ad deleted.' });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Notices CRUD                                                        */
/* ------------------------------------------------------------------ */
const decorate = (n) => ({ ...n, text: composeNoticeText(n), live: isLive(n) });

router.get('/notices', requireAuth, async (_req, res, next) => {
  try {
    const notices = await getStore().list('notices');
    res.json({ ok: true, data: notices.map(decorate) });
  } catch (err) {
    next(err);
  }
});

router.post('/notices', requireAuth, async (req, res, next) => {
  try {
    const { ok, errors, value } = validateNotice(req.body);
    if (!ok) return res.status(400).json({ ok: false, error: errors.join(' ') , errors });
    const created = await getStore().create('notices', value);
    res.status(201).json({ ok: true, data: decorate(created) });
  } catch (err) {
    next(err);
  }
});

router.put('/notices/:id', requireAuth, async (req, res, next) => {
  try {
    const { ok, errors, value } = validateNotice(req.body);
    if (!ok) return res.status(400).json({ ok: false, error: errors.join(' '), errors });
    const updated = await getStore().update('notices', req.params.id, value);
    if (!updated) return res.status(404).json({ ok: false, error: 'Notice not found.' });
    res.json({ ok: true, data: decorate(updated) });
  } catch (err) {
    next(err);
  }
});

router.patch('/notices/:id/toggle', requireAuth, async (req, res, next) => {
  try {
    const list = await getStore().list('notices');
    const found = list.find((n) => n.id === req.params.id);
    if (!found) return res.status(404).json({ ok: false, error: 'Notice not found.' });
    const updated = await getStore().update('notices', req.params.id, { active: !found.active });
    res.json({ ok: true, data: decorate(updated) });
  } catch (err) {
    next(err);
  }
});

router.delete('/notices/:id', requireAuth, async (req, res, next) => {
  try {
    const done = await getStore().remove('notices', req.params.id);
    if (!done) return res.status(404).json({ ok: false, error: 'Notice not found.' });
    res.json({ ok: true, message: 'Notice deleted.' });
  } catch (err) {
    next(err);
  }
});

/* Live preview of composed text without saving */
router.post('/notices/preview', requireAuth, (req, res) => {
  const { ok, errors, value } = validateNotice(req.body);
  if (!ok) return res.status(400).json({ ok: false, error: errors.join(' '), errors });
  res.json({ ok: true, data: { text: composeNoticeText(value) } });
});

/* ------------------------------------------------------------------ */
/* Vendors CRUD                                                        */
/* ------------------------------------------------------------------ */
router.get('/vendors', async (_req, res, next) => {
  try {
    res.json({ ok: true, data: await getStore().list('vendors') });
  } catch (err) {
    next(err);
  }
});

function vendorPayload(b = {}) {
  const name = String(b.name || '').trim();
  if (!name) return { ok: false, error: 'Vendor name is required.' };
  return {
    ok: true,
    value: {
      name,
      location: String(b.location || '').trim(),
      phone: String(b.phone || '').trim(),
      category: String(b.category || '').trim(),
      active: b.active === undefined ? true : !!b.active,
      order: Number.isFinite(Number(b.order)) ? Number(b.order) : 0,
    },
  };
}

router.post('/vendors', requireAuth, async (req, res, next) => {
  try {
    const p = vendorPayload(req.body);
    if (!p.ok) return res.status(400).json({ ok: false, error: p.error });
    res.status(201).json({ ok: true, data: await getStore().create('vendors', p.value) });
  } catch (err) {
    next(err);
  }
});

router.put('/vendors/:id', requireAuth, async (req, res, next) => {
  try {
    const p = vendorPayload(req.body);
    if (!p.ok) return res.status(400).json({ ok: false, error: p.error });
    const updated = await getStore().update('vendors', req.params.id, p.value);
    if (!updated) return res.status(404).json({ ok: false, error: 'Vendor not found.' });
    res.json({ ok: true, data: updated });
  } catch (err) {
    next(err);
  }
});

router.delete('/vendors/:id', requireAuth, async (req, res, next) => {
  try {
    const done = await getStore().remove('vendors', req.params.id);
    if (!done) return res.status(404).json({ ok: false, error: 'Vendor not found.' });
    res.json({ ok: true, message: 'Vendor deleted.' });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Upload                                                              */
/* ------------------------------------------------------------------ */
router.post('/upload', requireAuth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, error: err.message });
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file received.' });
    res.status(201).json({ ok: true, data: { url: `/uploads/${req.file.filename}` } });
  });
});

/* ------------------------------------------------------------------ */
/* Reset to factory defaults (handy for demos)                          */
/* ------------------------------------------------------------------ */
router.post('/admin/reset-defaults', requireAuth, async (_req, res, next) => {
  try {
    const store = getStore();
    await store.setSingleton('settings', structuredClone(DEFAULTS.settings));
    await store.setSingleton('links', structuredClone(DEFAULTS.links));
    res.json({ ok: true, message: 'Settings and links restored to defaults.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
