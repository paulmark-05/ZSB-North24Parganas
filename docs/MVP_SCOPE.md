# MVP Scope — Zila Sainik Board Portal + Admin CMS

## 1. Goal
A mobile-responsive public portal for the Zila Sainik Board, with a password-protected Admin CMS so staff can change every piece of content on the public page without touching code.

## 2. Colour & identity
| Token | Hex | Use |
|---|---|---|
| Navy | `#0b2545` | Header, marquee background, primary buttons |
| Red | `#c8102e` | Accent bar, "Notice" tag, destructive actions |
| Light blue | `#2e7fd4` | Links, service card accent, focus rings |

Light (non-dark) surfaces throughout: `#ffffff` cards on an `#f4f7fb` page. Circular logo placeholder top-left; admin can upload a replacement. All three colours are editable in the CMS.

## 3. Public page — components
1. **Header** — logo, organisation name, district subtitle, tricolour bar.
2. **Scrolling notice banner** — a red "NOTICE" tag plus a marquee that cycles through all *live* notices in sequence. Pauses on hover. Respects `prefers-reduced-motion`.
3. **Services** — two cards: Visitor Management System, Grievance Redressal. Clicking either opens an **in-app confirmation modal** showing the destination URL before redirecting (opens in a new tab).
4. **Advertisements** — one unified, manually-ordered list. Each entry is either a *listing* (initial-avatar, name, category · location, tap-to-call phone pill — the old "Vendors" concept) or a *poster* (image + business name, clicking opens the same confirmation modal then the linked website or Google Drive file). Order is set by dragging rows in the admin panel.
5. **Footer** — copyright + Administrator Login link.

## 4. Notice model (the core requirement)
Notices are a **queue**: each has its own date window and auto-expires. Only notices that are `active` **and** within `startDate…endDate` (inclusive) reach the public page.

Four types; the server composes the sentence so wording is always consistent:

| Type | Admin inputs | Rendered text |
|---|---|---|
| `counter_closed` | counters (multi-select 1–7), date/range | *"Counters 1, 3 and 5 will remain closed from 01 Aug 2026 to 04 Aug 2026."* |
| `secretary_unavailable` | date/range | *"The Secretary will not be available on 02 Sep 2026."* |
| `office_closed` | occasion, date/range | *"Office will remain closed on 15 Aug 2026 on account of Independence Day."* |
| `custom` | free text, date/range | *(exactly as typed)* |

A single date and a range are both supported — leave the end date the same as the start date for one day. The admin editor shows a **live preview** of the composed text (`POST /api/notices/preview`) before saving.

## 5. Admin CMS — screens
| Screen | Capability |
|---|---|
| Login | Real username/password → JWT (bcrypt-hashed, rate-limited) |
| Notice Banner | Create / edit / enable / disable / delete notices; live preview; live/scheduled/expired badges |
| VMS & Grievance | Title, description, redirect URL, confirmation text, show/hide — per card |
| Advertisements | Add / edit / remove / hide entries (listing or poster kind); drag-and-drop manual reordering shared across both kinds |
| Logo & Theme | Org name, subtitle, logo upload, three brand colours, marquee speed, restore defaults |
| Account | Change admin password |

## 6. Architecture
```
Browser ──► Express (Node 18+) ──► MongoDB Atlas   (MONGODB_URI set)
                              └──► data/db.json    (fallback, zero config)
```
- **Backend:** Node.js + Express, JWT auth, bcrypt, multer uploads, express-rate-limit.
- **Database:** Mongoose models for MongoDB Atlas (free M0 tier). A JSON-file driver behind the same interface means the app boots and runs with no database configured — useful for demos, local dev and CI.
- **Frontend:** static HTML/CSS/vanilla JS. No build step, no bundler, nothing to break. Served by the same Express process.
- **Uploads:** stored under `public/uploads/`. (See the deployment guide for object storage on ephemeral hosts.)

## 7. Out of scope for this MVP
Multiple admin roles, audit log, i18n (Hindi/Odia), analytics, an in-house VMS/grievance workflow (we link out to existing portals), and email notifications. Each is a clean addition on top of this structure.
