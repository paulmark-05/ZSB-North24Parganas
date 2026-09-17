/**
 * Sanitizes the tiny rich-text subset the admin CMS allows (bold, italic,
 * underline, line breaks) for fields that get rendered as real HTML on the
 * public site — ad descriptions and the notice banner's custom message.
 *
 * This is the authoritative guard: the browser also sanitizes before
 * sending, but that's not trustworthy on its own since these fields are
 * reachable directly via the API with a valid admin token.
 */
// Pinned to 2.17.1 (exact version — see package.json) rather than latest.
// 2.17.6+ bumped its htmlparser2 dependency to a pure-ESM-only build that
// requires Node's require(esm) support (Node >=22.12) — that crashes with
// ERR_REQUIRE_ESM on Vercel's runtime, which doesn't support it, even
// though it worked in local dev on a newer Node. 2.17.1 carries 3 known
// moderate advisories (GHSA-vccv-cmxp-4j9h, GHSA-g8qq-57p8-ggw5,
// GHSA-jxwj-j7wr-gfrw), but every one of them needs either allowed
// attributes (ours is `{}` — none allowed on any tag) or allowed SVG/
// textarea/style tags (not in our allowlist below) to be exploitable.
// Verified empirically against all three PoCs — see the "sanitizer blocks
// known CVE payloads" test in tests/api.test.js.
const sanitizeHtml = require('sanitize-html');

const OPTS = {
  allowedTags: ['b', 'strong', 'i', 'em', 'u', 'br'],
  allowedAttributes: {},
};

/**
 * Returns the cleaned HTML (only b/strong/i/em/u/br survive, no attributes),
 * or null if the visible text exceeds maxTextLen.
 */
function sanitizeRich(html, maxTextLen) {
  const clean = sanitizeHtml(String(html || ''), OPTS).trim();
  if (maxTextLen != null) {
    const plainText = sanitizeHtml(clean, { allowedTags: [], allowedAttributes: {} });
    if (plainText.length > maxTextLen) return null;
  }
  return clean;
}

module.exports = { sanitizeRich };
