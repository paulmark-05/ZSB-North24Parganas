# Deployment & Hosting Guide

The app is a **single Node process** that serves both the API and the frontend. That means one deploy, one URL, no CORS headaches — you can host it anywhere Node runs.

---

## 1. Before you deploy — the checklist

- [ ] `MONGODB_URI` points at MongoDB Atlas (never ship with the JSON file store in production — most hosts wipe the disk on every restart)
- [ ] `JWT_SECRET` is a long random string, **not** the default
- [ ] `ADMIN_PASSWORD` changed from `Admin@12345` (or the password rotated on the Account tab after first login)
- [ ] Atlas **Network Access** allows your host's IP (or `0.0.0.0/0` if the host uses dynamic IPs — acceptable because a strong DB password still gates access)
- [ ] `CORS_ORIGIN` set to your domain if you ever split frontend and API
- [ ] `npm test` passes
- [ ] Uploads have a durable home (§6)

Generate the secret:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## 2. Render (recommended — free tier, simplest)

1. Push the project to a GitHub repository.
2. On **render.com** → **New → Web Service** → connect the repo.
3. Configure:
   - **Environment:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
4. **Environment → Add environment variable** for each:
   | Key | Value |
   |---|---|
   | `MONGODB_URI` | your Atlas string |
   | `JWT_SECRET` | your random string |
   | `ADMIN_USERNAME` | `admin` |
   | `ADMIN_PASSWORD` | a strong password |
   | `NODE_VERSION` | `20` |
5. **Create Web Service**. In ~2 minutes you get `https://your-app.onrender.com`.

> The free tier sleeps after 15 minutes of inactivity and takes ~30 s to wake. Fine for a district office; upgrade to the $7/mo Starter plan to keep it always-on.

---

## 3. Railway (fast alternative)

1. **railway.app** → **New Project → Deploy from GitHub repo**.
2. Railway auto-detects Node and runs `npm start`.
3. **Variables** tab → add the same variables as above.
4. **Settings → Networking → Generate Domain**.

---

## 4. Vercel

Vercel is serverless, so the Express app is exposed as a function. `vercel.json` and
the serverless handler at the bottom of `server/index.js` are already in this repo —
the handler lazily awaits `initStore()` + `ensureSeed()` on first invocation (a plain
`module.exports.default = app` would leave the store uninitialised and every request
would 500).

**`MONGODB_URI` is not optional here** — the JSON file store cannot survive a
serverless filesystem, which is wiped between invocations.

1. `npx vercel --prod` from the project root (or connect the GitHub repo in the
   Vercel dashboard — same idea as Render, "Import Project").
2. Add the same environment variables as §2 (`MONGODB_URI`, `JWT_SECRET`,
   `ADMIN_USERNAME`, `ADMIN_PASSWORD`) in **Project → Settings → Environment Variables**.
3. Redeploy after adding variables (Vercel doesn't hot-reload env changes into a
   already-built deployment).
4. **Storage tab → Create Database → Blob** → connect it to the project so the
   "Upload logo" / "Upload image" buttons in the Admin CMS actually persist (see §6).
   Skip this step and they'll fail outright — Vercel's filesystem is read-only, so
   there's no disk to fall back to here the way there is on Render.

---

## 5. Your own VPS (Ubuntu — for a government-owned server)

```bash
# --- install Node 20 ---
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx

# --- deploy the app ---
sudo mkdir -p /var/www/zsb && sudo chown $USER:$USER /var/www/zsb
cd /var/www/zsb
# upload/clone the project here, then:
npm ci --omit=dev
cp .env.example .env && nano .env     # fill in MONGODB_URI, JWT_SECRET, ADMIN_PASSWORD

# --- keep it running with PM2 ---
sudo npm install -g pm2
pm2 start server/index.js --name zsb
pm2 save
pm2 startup            # run the command it prints
```

**Nginx reverse proxy** — `/etc/nginx/sites-available/zsb`:
```nginx
server {
    listen 80;
    server_name zsb.example.gov.in;

    client_max_body_size 5M;          # allow 4 MB poster uploads

    location / {
        proxy_pass         http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/zsb /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# --- free HTTPS ---
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d zsb.example.gov.in
```

If Express sits behind a proxy, add `app.set('trust proxy', 1);` in `server/index.js` so the login rate-limiter sees real client IPs.

---

## 6. Uploads on ephemeral hosts (important)

Render, Railway and Vercel **wipe the disk on every deploy and restart**. Logos and ad posters saved to `public/uploads/` would disappear — and on Vercel specifically, the filesystem is read-only at runtime, so a disk write fails outright rather than just being temporary.

**The app already handles this.** `server/routes/api.js` uploads through [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) whenever `BLOB_READ_WRITE_TOKEN` is present in the environment, and falls back to writing `public/uploads/` otherwise (local dev, or any host with a normal persistent disk). No code changes needed — just enable it:

1. Vercel dashboard → your project → **Storage** tab → **Create Database** → **Blob**.
2. Connect it to the project. Vercel automatically adds `BLOB_READ_WRITE_TOKEN` to your environment variables and redeploys.
3. Done — the "Upload logo" / "Upload image" buttons in the CMS now persist to Blob storage and return a permanent public URL.

**Alternatives, if you'd rather not use Vercel Blob:**

**A. Paste an external URL (zero code, any host).** Host the image anywhere public — including Google Drive with "Anyone with the link" sharing — and paste its direct URL. The CMS stores whatever URL you save; the upload button is a convenience, not a requirement.

**B. Render persistent disk.** On a paid Render plan, attach a disk mounted at `/opt/render/project/src/public/uploads`. No code change needed — the disk-fallback path in `saveUpload()` already writes there.

---

## 7. Backups

Atlas M0 has no automatic backups. Set a weekly reminder:
```bash
mongodump --uri="$MONGODB_URI" --out=./backup-$(date +%F)
# restore:
mongorestore --uri="$MONGODB_URI" ./backup-2026-07-14
```
Or upgrade to M2+ ($9/mo) for continuous automated backups. The whole dataset is tiny — notices, ads and two config documents — so a dump takes seconds.

---

## 8. Post-deploy smoke test

```bash
BASE=https://your-app.onrender.com

curl $BASE/api/health          # expect {"ok":true,...,"driver":"mongo"}
curl $BASE/api/content         # expect settings, links, notices, ads
```
Then in a browser:
1. Load `/` — header, banner, cards and the Advertisements section all render.
2. Load `/admin` — sign in with your production credentials.
3. Add a notice → refresh `/` → it scrolls.
4. Change the password on the **Account** tab.
5. Open `/` on a phone — check that the layout stacks and the banner scrolls.

⚠️ **`driver: "file"` in production means your `MONGODB_URI` is wrong or unreachable.** The app is running, but every change will be lost on the next restart. Fix the connection string before going live.

---

## 9. Hardening for a public government deployment

| Item | Why |
|---|---|
| HTTPS everywhere (Certbot / host-managed) | JWTs travel in the `Authorization` header |
| Add `helmet` (`npm i helmet` → `app.use(helmet())`) | Sets sane security headers |
| Restrict Atlas Network Access to the server IP | Stops password-guessing from anywhere else |
| Rotate `JWT_SECRET` periodically | Invalidates any leaked sessions |
| Keep `/admin` off search engines | Already handled via `<meta name="robots" content="noindex">` |
| Strong admin password, changed on day one | Login is rate-limited (20 attempts / 10 min) but a weak password is still a weak password |
| `npm audit` before each release | Catches dependency CVEs |
