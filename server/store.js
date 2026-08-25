/**
 * Storage layer.
 *
 * Two interchangeable drivers behind ONE interface:
 *   1. "mongo" – MongoDB Atlas (or any MongoDB) via Mongoose. Used when MONGODB_URI is set.
 *   2. "file"  – zero-config JSON file store (data/db.json). Used as a fallback so the app
 *               always boots (great for local dev, demos and CI).
 *
 * Every method returns plain JSON objects with a string `id` field.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULTS = {
  settings: {
    orgName: 'Zila Sainik Board',
    district: 'District Sainik Welfare Office',
    logoUrl: '',
    theme: { navy: '#0b2545', red: '#c8102e', lightBlue: '#2e7fd4' },
    marqueeSpeed: 22,
  },
  links: {
    vms: {
      label: 'Visitor Management System',
      description: 'Register your visit, get a token and skip the queue.',
      link: 'https://example.gov.in/vms',
      previewText: 'You are being redirected to the official Visitor Management System.',
      enabled: true,
    },
    grievance: {
      label: 'Grievance Redressal',
      description: 'Raise a grievance and track its status online.',
      link: 'https://example.gov.in/grievance',
      previewText: 'You are being redirected to the official Grievance Redressal portal.',
      enabled: true,
    },
  },
};

/* ================================================================== */
/* File driver                                                         */
/* ================================================================== */
class FileStore {
  constructor() {
    this.name = 'file';
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DATA_FILE)) {
      this._write({ users: [], notices: [], vendors: [], ads: [], singletons: {} });
    }
  }
  async connect() {
    return this;
  }
  _read() {
    let db;
    try {
      db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch {
      db = { users: [], notices: [], vendors: [], ads: [], singletons: {} };
    }
    if (!db.ads) db.ads = [];
    return db;
  }
  _write(db) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  }
  _id() {
    return crypto.randomBytes(12).toString('hex');
  }

  /* users */
  async findUser(username) {
    return this._read().users.find((u) => u.username === String(username).toLowerCase()) || null;
  }
  async createUser(doc) {
    const db = this._read();
    const user = { id: this._id(), role: 'admin', ...doc, username: doc.username.toLowerCase() };
    db.users.push(user);
    this._write(db);
    return user;
  }
  async setUserPassword(id, passwordHash) {
    const db = this._read();
    const u = db.users.find((x) => x.id === id);
    if (!u) return null;
    u.passwordHash = passwordHash;
    this._write(db);
    return u;
  }
  async findUserById(id) {
    return this._read().users.find((u) => u.id === id) || null;
  }

  /* generic collection helpers */
  async list(col) {
    return this._read()[col].slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  async create(col, doc) {
    const db = this._read();
    const item = { id: this._id(), createdAt: new Date().toISOString(), ...doc };
    db[col].push(item);
    this._write(db);
    return item;
  }
  async update(col, id, patch) {
    const db = this._read();
    const i = db[col].findIndex((x) => x.id === id);
    if (i === -1) return null;
    db[col][i] = { ...db[col][i], ...patch, id, updatedAt: new Date().toISOString() };
    this._write(db);
    return db[col][i];
  }
  async remove(col, id) {
    const db = this._read();
    const before = db[col].length;
    db[col] = db[col].filter((x) => x.id !== id);
    if (db[col].length === before) return false;
    this._write(db);
    return true;
  }

  /* singletons */
  async getSingleton(key) {
    const db = this._read();
    return db.singletons[key] ?? structuredClone(DEFAULTS[key]);
  }
  async setSingleton(key, value) {
    const db = this._read();
    db.singletons[key] = value;
    this._write(db);
    return value;
  }
}

/* ================================================================== */
/* Mongo driver                                                        */
/* ================================================================== */
class MongoStore {
  constructor(uri) {
    this.name = 'mongo';
    this.uri = uri;
  }
  async connect() {
    const mongoose = require('mongoose');
    mongoose.set('strictQuery', true);
    await mongoose.connect(this.uri, { serverSelectionTimeoutMS: 10000 });
    this.models = require('./models');
    this.map = { notices: this.models.Notice, vendors: this.models.Vendor, ads: this.models.Ad };
    return this;
  }
  _model(col) {
    const m = this.map[col];
    if (!m) throw new Error(`Unknown collection: ${col}`);
    return m;
  }

  async findUser(username) {
    const u = await this.models.User.findOne({ username: String(username).toLowerCase() });
    return u ? u.toJSON() : null;
  }
  async findUserById(id) {
    const u = await this.models.User.findById(id).catch(() => null);
    return u ? u.toJSON() : null;
  }
  async createUser(doc) {
    const u = await this.models.User.create({ ...doc, username: doc.username.toLowerCase() });
    return u.toJSON();
  }
  async setUserPassword(id, passwordHash) {
    const u = await this.models.User.findByIdAndUpdate(id, { passwordHash }, { new: true });
    return u ? u.toJSON() : null;
  }

  async list(col) {
    const docs = await this._model(col).find().sort({ order: 1, createdAt: 1 });
    return docs.map((d) => d.toJSON());
  }
  async create(col, doc) {
    const d = await this._model(col).create(doc);
    return d.toJSON();
  }
  async update(col, id, patch) {
    const d = await this._model(col)
      .findByIdAndUpdate(id, patch, { new: true, runValidators: true })
      .catch(() => null);
    return d ? d.toJSON() : null;
  }
  async remove(col, id) {
    const r = await this._model(col).findByIdAndDelete(id).catch(() => null);
    return !!r;
  }

  async getSingleton(key) {
    const s = await this.models.Singleton.findOne({ key });
    if (!s) return structuredClone(DEFAULTS[key]);
    return { ...structuredClone(DEFAULTS[key]), ...s.value };
  }
  async setSingleton(key, value) {
    await this.models.Singleton.findOneAndUpdate(
      { key },
      { key, value },
      { upsert: true, new: true }
    );
    return value;
  }
}

/* ================================================================== */
let store = null;

async function initStore() {
  const uri = process.env.MONGODB_URI;
  if (uri) {
    try {
      store = await new MongoStore(uri).connect();
      console.log('[store] Connected to MongoDB');
      return store;
    } catch (err) {
      console.error('[store] MongoDB connection failed:', err.message);
      console.error('[store] Falling back to local JSON file store (data/db.json).');
    }
  } else {
    console.log('[store] No MONGODB_URI set — using local JSON file store (data/db.json).');
  }
  store = await new FileStore().connect();
  return store;
}

function getStore() {
  if (!store) throw new Error('Store not initialised. Call initStore() first.');
  return store;
}

module.exports = { initStore, getStore, DEFAULTS };
