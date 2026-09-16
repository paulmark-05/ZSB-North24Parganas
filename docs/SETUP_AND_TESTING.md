# Setup & Testing Guide

## 1. Prerequisites
- **Node.js 18 or newer** (`node -v` to check) — download from nodejs.org
- A code editor, and a terminal
- *(Optional)* A free MongoDB Atlas account

---

## 2. Install and run (5 minutes, no database needed)

```bash
# 1. Unzip and enter the folder
cd zila-sainik-board-portal

# 2. Install dependencies
npm install

# 3. Create your environment file
cp .env.example .env        # Windows: copy .env.example .env

# 4. Start
npm start
```

You should see:

```
[store] No MONGODB_URI set — using local JSON file store (data/db.json).
[seed] Admin user created -> username: "admin"  password: "Admin@12345"

  Public site : http://localhost:4000/
  Admin CMS   : http://localhost:4000/admin
  API health  : http://localhost:4000/api/health
```

Open **http://localhost:4000/** for the public portal and **http://localhost:4000/admin** for the CMS.

> **Default login:** `admin` / `Admin@12345` — change it on the **Account** tab immediately.

`npm run dev` starts the same server with auto-reload while you edit files.

---

## 3. Connecting MongoDB Atlas (free tier)

1. Sign in at **cloud.mongodb.com** → **Create** → choose the **M0 Free** cluster → pick a region near you (e.g. Mumbai) → Create.
2. **Database Access** → *Add New Database User* → username + password → role **Read and write to any database**.
3. **Network Access** → *Add IP Address*. For a first test use `0.0.0.0/0` (allow all); for production, restrict it to your server's IP.
4. **Database → Connect → Drivers** → copy the connection string. It looks like:
   ```
   mongodb+srv://<user>:<password>@cluster0.abc12.mongodb.net/?retryWrites=true&w=majority
   ```
5. Paste it into `.env`, replace `<password>`, and add the database name `zsb` before the `?`:
   ```ini
   MONGODB_URI=mongodb+srv://zsbadmin:YourPass123@cluster0.abc12.mongodb.net/zsb?retryWrites=true&w=majority
   ```
6. Restart: `npm start`. You should now see `[store] Connected to MongoDB`.

> If the connection fails, the app logs the error and **falls back to the JSON file store** so the site never goes down. Check the log line to confirm which driver is live — or hit `/api/health`, which reports `"driver": "mongo"` or `"file"`.

**Using Supabase instead?** Supabase is Postgres, not Mongo. This build targets MongoDB Atlas. If you prefer Supabase, the only file to rewrite is `server/store.js` — add a third driver implementing the same ~14 methods, and nothing else in the codebase changes.

---

## 4. Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | Port the server listens on |
| `MONGODB_URI` | *(empty)* | Atlas connection string. Blank = JSON file store |
| `JWT_SECRET` | dev fallback | **Set a long random string in production** |
| `JWT_EXPIRES_IN` | `8h` | Admin session length |
| `ADMIN_USERNAME` | `admin` | Seed admin (first boot only) |
| `ADMIN_PASSWORD` | `Admin@12345` | Seed password (first boot only) |
| `CORS_ORIGIN` | `*` | Restrict in production if you split domains |

Generate a good secret:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## 5. Automated tests

```bash
npm test
```

Boots the server on port 4555 against a temporary store (your real data is backed up and restored) and exercises **all 40 endpoint cases** — happy paths, validation failures, auth failures and 404s.

Expected tail:
```
  Passed: 40   Failed: 0   Total: 40
```
Exit code is `0` on success, `1` on any failure — safe to drop straight into CI.

---

## 6. Manual test script

Sign in at `/admin` and work through this list. Keep the public page open in a second tab and refresh after each save.

### Notices
| # | Action | Expected |
|---|---|---|
| 1 | New notice → *Counter(s) closed* → tick 2 and 5 → start today, end today+3 | Preview reads *"Counters 2 and 5 will remain closed from … to …"* |
| 2 | Save | Row appears with a green **Live now** badge; text scrolls on the public page |
| 3 | New notice → *Office closed* → occasion "Diwali" → a future date | Row shows a blue **Scheduled** badge and does **not** appear publicly |
| 4 | New notice → dates in the past | Row shows a red **Expired** badge; not shown publicly |
| 5 | New notice → *Counter(s) closed* with no counters ticked → Save | Inline error: *"Select at least one counter (1-7)"* |
| 6 | Set an end date before the start date | Inline error: *"endDate cannot be before startDate"* |
| 7 | Add 3+ live notices | All scroll in sequence, separated by a blue bullet; hovering pauses the scroll |
| 8 | Disable a notice | Disappears from the public banner immediately on refresh |
| 9 | Delete all notices | Banner reads *"No active notices at this time."* |

### VMS & Grievance
| # | Action | Expected |
|---|---|---|
| 10 | Change the VMS title and URL → Save | Public card title updates; clicking it opens the confirmation modal showing the new URL |
| 11 | In the modal, click **Cancel** | Modal closes, no redirect |
| 12 | Click **Continue →** | Destination opens in a new tab |
| 13 | Enter `abc` as the URL → Save | Inline error: *"VMS link must be a valid http(s) URL."* |
| 14 | Untick *Show this card* → Save | Card disappears from the public page |

### Advertisements (unified listing + poster)
| # | Action | Expected |
|---|---|---|
| 15 | New ad → Type: Poster → upload a poster (PNG/JPG) | Preview thumbnail updates immediately; large images auto-compress on save |
| 16 | Set business name + website/Drive link → Save | Public entry shows the poster and name; clicking opens the confirmation modal, then the link |
| 17 | Upload a 10 MB file | Error: file too large (4 MB limit) |
| 18 | New ad → Type: Listing → add name + phone number | Appears publicly as a vendor-style row; the phone pill is a working `tel:` link on mobile |
| 19 | Save either kind with an empty name | Inline error: *"Name is required."* |
| 20 | Drag a row to a new position | Order persists after reload; public page reflects the same order |
| 21 | Untick *Show on public site* on any entry | That entry disappears from the public "Advertisements" section only |
| 22 | Delete an entry | Confirmation prompt, then removed from both views |

### Logo, theme, account
| # | Action | Expected |
|---|---|---|
| 23 | Upload a logo → Save | Replaces the circular "LOGO" placeholder in the public header |
| 24 | Change the three brand colours → Save | Public page restyles on refresh (header, marquee, accents) |
| 25 | Set banner scroll duration to 40 → Save | Marquee visibly slows down |
| 26 | **Restore defaults** | Org name and links return to their seeded values (Advertisements are unaffected — manage those from their own tab) |
| 27 | Change the password, sign out, sign in with the new one | Succeeds; the old password now fails |
| 28 | Wait for the token to expire (or clear `localStorage`) and click anything | Kicked back to the login screen with *"Session expired"* |

### Responsiveness
| # | Action | Expected |
|---|---|---|
| 29 | DevTools → iPhone SE (375 px) | Cards stack in one column; the admin sidebar becomes a horizontal scroller |
| 30 | Desktop ≥ 640 px | VMS and Grievance sit side by side |

---

## 7. Quick API check (curl)

```bash
# Public content — no auth
curl http://localhost:4000/api/content

# Log in and capture the token
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Admin@12345"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

# Create a notice
curl -X POST http://localhost:4000/api/notices \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"counter_closed","counters":[1,4],"startDate":"2026-08-01","endDate":"2026-08-05"}'
```

---

## 8. Full endpoint reference

🔓 = public, 🔒 = requires `Authorization: Bearer <token>`

| Method | Endpoint | | Purpose |
|---|---|---|---|
| GET | `/api/health` | 🔓 | Uptime + active DB driver |
| GET | `/api/content` | 🔓 | **Everything the public page needs, in one call** |
| POST | `/api/auth/login` | 🔓 | Sign in → JWT (rate-limited: 20 / 10 min) |
| GET | `/api/auth/me` | 🔒 | Current user |
| POST | `/api/auth/change-password` | 🔒 | Change password |
| GET | `/api/notices` | 🔒 | All notices + `text` and `live` flags |
| POST | `/api/notices` | 🔒 | Create |
| POST | `/api/notices/preview` | 🔒 | Compose text without saving |
| PUT | `/api/notices/:id` | 🔒 | Update |
| PATCH | `/api/notices/:id/toggle` | 🔒 | Enable / disable |
| DELETE | `/api/notices/:id` | 🔒 | Delete |
| GET | `/api/settings` | 🔓 | Org, logo, theme |
| PUT | `/api/settings` | 🔒 | Update |
| GET | `/api/links` | 🔓 | VMS + Grievance config |
| PUT | `/api/links` | 🔒 | Update |
| GET | `/api/ads` | 🔓 | List all Advertisements entries (listing + poster kinds) |
| POST | `/api/ads` | 🔒 | Create |
| PUT | `/api/ads/:id` | 🔒 | Update |
| PATCH | `/api/ads/:id/toggle` | 🔒 | Enable / disable |
| POST | `/api/ads/reorder` | 🔒 | Set manual order — body `{ order: [id, id, …] }` |
| DELETE | `/api/ads/:id` | 🔒 | Delete |
| POST | `/api/upload` | 🔒 | Image upload → `{ url }` (auto-compressed) |
| POST | `/api/admin/reset-defaults` | 🔒 | Restore settings/links |

Every response is `{ ok: true, data }` or `{ ok: false, error }`. Unknown `/api/*` paths return a JSON 404 — never an HTML page.

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `EADDRINUSE` on start | Another process holds port 4000. Change `PORT` in `.env`, or kill it: `npx kill-port 4000` |
| Banner shows *"Unable to load content"* | The API isn't reachable. Confirm the server is running and check the browser console |
| Login always fails | The seed only runs on first boot. Delete `data/db.json` (or the `users` collection in Atlas) and restart to re-seed |
| Logo/poster uploads vanish after redeploy | The host has an ephemeral filesystem — see §6 of the deployment guide |
| `MongoServerError: bad auth` | Wrong password in `MONGODB_URI`, or the password has special characters that need URL-encoding (`@` → `%40`) |
| Atlas connection times out | Your IP isn't in the Atlas **Network Access** allow-list |
