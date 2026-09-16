const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const rateLimit = require('express-rate-limit');

const { getStore, DEFAULTS } = require('../store');
const { signToken, requireAuth } = require('../middleware/auth');
const { composeNoticeText, isLive, validateNotice } = require('../lib/notice');

const router = express.Router();

/* ------------------------------------------------------------------ */
/* File uploads (logo + ad poster)                                     */
/*                                                                      */
/* Vercel's filesystem is read-only outside /tmp, so files can't live   */
/* on local disk there. When BLOB_READ_WRITE_TOKEN is present (Vercel   */
/* auto-injects it once a Blob store is connected to the project) we    */
/* upload to Vercel Blob and return its public URL. Otherwise (local    */
/* dev, or any host with a normal writable disk) we fall back to        */
/* saving under /public/uploads exactly as before.                      */
/* ------------------------------------------------------------------ */
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');
const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;
if (!USE_BLOB && !fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }, // 4 MB
  fileFilter: (_req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.mimetype);
    cb(ok ? null : new Error('Only PNG, JPG, WEBP or SVG images are allowed.'), ok);
  },
});

/**
 * Downscales oversized images and re-encodes them at a lossy-but-clean
 * quality so phone-camera photos (often several MB) don't get stored
 * at full size. SVGs are vector — nothing to compress — and pass through.
 */
async function compressImage(buffer, mimetype) {
  if (mimetype === 'image/svg+xml') return buffer;
  try {
    let img = sharp(buffer).rotate(); // normalise EXIF orientation before resizing
    const meta = await img.metadata();
    if (meta.width && meta.width > 1600) {
      img = img.resize({ width: 1600, withoutEnlargement: true });
    }
    if (mimetype === 'image/png') return await img.png({ compressionLevel: 9 }).toBuffer();
    if (mimetype === 'image/webp') return await img.webp({ quality: 80 }).toBuffer();
    return await img.jpeg({ quality: 78, mozjpeg: true }).toBuffer();
  } catch {
    return buffer; // if it isn't decodable as an image for some reason, store it untouched
  }
}

async function saveUpload(file) {
  const ext = (path.extname(file.originalname) || '.png').toLowerCase();
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
  const buffer = await compressImage(file.buffer, file.mimetype);

  if (USE_BLOB) {
    const { put } = require('@vercel/blob');
    const blob = await put(filename, buffer, {
      access: 'public',
      contentType: file.mimetype,
      addRandomSuffix: false,
    });
    return blob.url;
  }

  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
  return `/uploads/${filename}`;
}

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
    const [settings, links, notices, ads] = await Promise.all([
      store.getSingleton('settings'),
      store.getSingleton('links'),
      store.list('notices'),
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
/* Ads CRUD — the unified "Advertisements" section. Each entry is       */
/* either a `listing` (vendor-style: name/phone/location) or a         */
/* `poster` (image + redirect link). Both share one manual order.       */
/* ------------------------------------------------------------------ */
router.get('/ads', async (_req, res, next) => {
  try {
    res.json({ ok: true, data: await getStore().list('ads') });
  } catch (err) {
    next(err);
  }
});

function adPayload(b = {}) {
  const kind = b.kind === 'listing' ? 'listing' : 'poster';
  const name = String(b.name || '').trim();
  if (!name) return { ok: false, error: 'Name is required.' };

  const value = {
    kind,
    name,
    active: b.active === undefined ? true : !!b.active,
    order: Number.isFinite(Number(b.order)) ? Number(b.order) : 0,
    location: '', phone: '', category: '',
    caption: 'Advertisement', imageUrl: '', linkType: 'website', link: '',
  };

  if (kind === 'listing') {
    value.location = String(b.location || '').trim();
    value.phone = String(b.phone || '').trim();
    value.category = String(b.category || '').trim();
  } else {
    const linkType = b.linkType === 'drive' ? 'drive' : 'website';
    const link = String(b.link || '').trim();
    if (link && !isHttpUrl(link)) return { ok: false, error: 'Ad link must be a valid http(s) URL.' };
    value.caption = String(b.caption || '').trim() || 'Advertisement';
    value.imageUrl = String(b.imageUrl || '').trim();
    value.linkType = linkType;
    value.link = link;
  }

  return { ok: true, value };
}

router.post('/ads', requireAuth, async (req, res, next) => {
  try {
    const p = adPayload(req.body);
    if (!p.ok) return res.status(400).json({ ok: false, error: p.error });
    const list = await getStore().list('ads');
    const maxOrder = list.reduce((m, a) => Math.max(m, a.order ?? 0), -1);
    res.status(201).json({ ok: true, data: await getStore().create('ads', { ...p.value, order: maxOrder + 1 }) });
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

// Manual reorder — body: { order: [id1, id2, id3, ...] } in the desired sequence.
router.post('/ads/reorder', requireAuth, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.order) ? req.body.order : null;
    if (!ids || !ids.length) return res.status(400).json({ ok: false, error: 'order must be a non-empty array of ad ids.' });
    const store = getStore();
    await Promise.all(ids.map((id, i) => store.update('ads', id, { order: i })));
    res.json({ ok: true, data: await store.list('ads') });
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
/* Upload                                                              */
/* ------------------------------------------------------------------ */
router.post('/upload', requireAuth, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ ok: false, error: err.message });
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file received.' });
    try {
      const url = await saveUpload(req.file);
      res.status(201).json({ ok: true, data: { url } });
    } catch (uploadErr) {
      res.status(500).json({ ok: false, error: 'Upload failed: ' + uploadErr.message });
    }
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
