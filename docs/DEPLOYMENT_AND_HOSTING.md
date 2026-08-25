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

Vercel is serverless, so the Express app must be exposed as a function.

Create `vercel.json` in the project root:
```json
{
  "version": 2,
  "builds": [{ "src": "server/index.js", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "server/index.js" }]
}
```
Then add to the very end of `server/index.js`:
```js
module.exports.default = app;   // Vercel serverless handler
```
Deploy with `npx vercel --prod`, and add the environment variables in the Vercel dashboard.

⚠️ On Vercel the filesystem is read-only — **you must** use Cloudinary/S3 for uploads (§6).

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

Render, Railway and Vercel **wipe the disk on every deploy and restart**. Logos and ad posters saved to `public/uploads/` will disappear.

**Three options, easiest first:**

**A. Paste an external URL (zero code).** Host the image anywhere public — including Google Drive with "Anyone with the link" sharing — and paste its direct URL. The CMS stores whatever URL you save; the upload button is a convenience, not a requirement.

**B. Cloudinary free tier (recommended).** Sign up, then in `server/routes/api.js` swap multer's `diskStorage` for `multer.memoryStorage()` and pipe the buffer to Cloudinary's upload API, returning the Cloudinary URL instead of `/uploads/…`. Roughly 15 lines; nothing else in the app changes because everything downstream just consumes a URL string.

**C. Render persistent disk.** On a paid Render plan, attach a disk mounted at `/opt/render/project/src/public/uploads`. No code change at all.

---

## 7. Backups

Atlas M0 has no automatic backups. Set a weekly reminder:
```bash
mongodump --uri="$MONGODB_URI" --out=./backup-$(date +%F)
# restore:
mongorestore --uri="$MONGODB_URI" ./backup-2026-07-14
```
Or upgrade to M2+ ($9/mo) for continuous automated backups. The whole dataset is tiny — notices, vendors and three config documents — so a dump takes seconds.

---

## 8. Post-deploy smoke test

```bash
BASE=https://your-app.onrender.com

curl $BASE/api/health          # expect {"ok":true,...,"driver":"mongo"}
curl $BASE/api/content         # expect settings, links, ad, notices, vendors
```
Then in a browser:
1. Load `/` — header, banner, cards, vendors and ad all render.
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
