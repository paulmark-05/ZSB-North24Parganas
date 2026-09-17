/**
 * Sanitizes the tiny rich-text subset the admin CMS allows (bold, italic,
 * underline, line breaks) for fields that get rendered as real HTML on the
 * public site — ad descriptions and the notice banner's custom message.
 *
 * This is the authoritative guard: the browser also sanitizes before
 * sending, but that's not trustworthy on its own since these fields are
 * reachable directly via the API with a valid admin token.
 */
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
