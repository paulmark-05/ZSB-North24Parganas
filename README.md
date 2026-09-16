# Zila Sainik Board — Public Portal + Admin CMS

A mobile-responsive public portal with a password-protected Admin CMS. Staff can edit every piece of public content — the scrolling notice banner, service links, the Advertisements section, the logo and the colour theme — without touching code.

**Palette:** Navy `#0b2545` · Red `#c8102e` · Light blue `#2e7fd4` — light, official, non-dark.

---

## Quick start

```bash
npm install
cp .env.example .env
npm start
```

- Public site → <http://localhost:4000/>
- Admin CMS → <http://localhost:4000/admin>
- Default login → `admin` / `Admin@12345` *(change it on the Account tab)*

Runs immediately with **no database** (JSON file store). Set `MONGODB_URI` in `.env` to switch to MongoDB Atlas — no other change needed.

```bash
npm test     # 42 endpoint tests, all green
```

---

## What's in the box

| | |
|---|---|
| **Notice banner** | Queue of notices, each with its own date window and auto-expiry. Four types: counters 1–7 closed · Secretary unavailable · Office closed (occasion) · custom. The server composes the wording; the CMS shows a live preview. |
| **VMS & Grievance** | Two cards, each with an admin-editable redirect URL. An in-app confirmation modal shows the destination before opening it. |
| **Advertisements** | One unified, manually-orderable (drag-and-drop) list. Each entry is either a listing (name/phone/location, tap-to-call) or a poster ad (image + website/Google Drive redirect link, via the same confirmation modal). |
| **Logo & theme** | Circular logo placeholder with upload, plus all three brand colours and the marquee speed. |
| **Auth** | Real JWT login, bcrypt-hashed password, rate-limited, self-service password change. |

---

## Project layout

```
├── server/
│   ├── index.js            Express app + static hosting
│   ├── store.js            Storage layer: Mongo driver + JSON-file driver
│   ├── seed.js             Creates the admin user + sample content
│   ├── models/index.js     Mongoose schemas
│   ├── lib/notice.js       Notice text composition + validation
│   ├── middleware/auth.js  JWT sign / verify
│   └── routes/api.js       Every endpoint
├── public/
│   ├── index.html          Public portal
│   ├── admin.html          Admin CMS
│   ├── css/style.css       Whole design system
│   ├── js/api.js           API client + helpers
│   ├── js/public.js        Public page
│   └── js/admin.js         CMS
├── tests/api.test.js       42 endpoint tests
└── docs/
    ├── MVP_SCOPE.md
    ├── SETUP_AND_TESTING.md
    └── DEPLOYMENT_AND_HOSTING.md
```

Frontend is plain HTML/CSS/JS — no build step, no bundler, nothing to break.

---

## Documentation

- **[MVP Scope](docs/MVP_SCOPE.md)** — what's built, what's deliberately out of scope
- **[Setup & Testing](docs/SETUP_AND_TESTING.md)** — install, Atlas setup, 30-step manual test script, full API reference
- **[Deployment & Hosting](docs/DEPLOYMENT_AND_HOSTING.md)** — Render / Railway / Vercel / VPS, HTTPS, uploads, backups
