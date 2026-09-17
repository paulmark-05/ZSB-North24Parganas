/**
 * Builds the human-readable marquee sentence for a notice, and decides whether
 * a notice is currently "live" (active + within its date window).
 */

const { sanitizeRich } = require('./sanitizeRich');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmt(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return `${String(dt.getUTCDate()).padStart(2, '0')} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

function sameDay(a, b) {
  return new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);
}

function datePhrase(startDate, endDate) {
  if (!endDate || sameDay(startDate, endDate)) return `on ${fmt(startDate)}`;
  return `from ${fmt(startDate)} to ${fmt(endDate)}`;
}

function listCounters(counters = []) {
  const c = [...new Set(counters)].filter((n) => n >= 1 && n <= 7).sort((a, b) => a - b);
  if (c.length === 0) return { label: 'Counter', text: '' };
  if (c.length === 1) return { label: 'Counter', text: `Counter ${c[0]}` };
  const head = c.slice(0, -1).join(', ');
  return { label: 'Counters', text: `Counters ${head} and ${c[c.length - 1]}` };
}

/** Compose the display text for a notice object. */
function composeNoticeText(n) {
  const when = datePhrase(n.startDate, n.endDate);
  switch (n.type) {
    case 'counter_closed': {
      const { text } = listCounters(n.counters);
      if (!text) return '';
      const verb = (n.counters || []).length > 1 ? 'will remain closed' : 'will remain closed';
      return `${text} ${verb} ${when}.`;
    }
    case 'secretary_unavailable':
      return `The Secretary will not be available ${when}.`;
    case 'office_closed':
      return n.occasion
        ? `Office will remain closed ${when} on account of ${n.occasion}.`
        : `Office will remain closed ${when}.`;
    case 'custom':
      return (n.customText || '').trim();
    default:
      return '';
  }
}

/** Is the notice active and within its date window (inclusive, day granularity)? */
function isLive(n, now = new Date()) {
  if (!n.active) return false;
  const today = now.toISOString().slice(0, 10);
  const start = new Date(n.startDate).toISOString().slice(0, 10);
  const end = new Date(n.endDate || n.startDate).toISOString().slice(0, 10);
  return start <= today && today <= end;
}

/** Validate an incoming notice payload. Returns { ok, errors, value }. */
function validateNotice(body = {}) {
  const errors = [];
  const type = body.type;
  const allowed = ['counter_closed', 'secretary_unavailable', 'office_closed', 'custom'];
  if (!allowed.includes(type)) errors.push(`type must be one of: ${allowed.join(', ')}`);

  const startDate = body.startDate ? new Date(body.startDate) : null;
  const endDate = body.endDate ? new Date(body.endDate) : startDate;
  if (!startDate || Number.isNaN(startDate.getTime())) errors.push('startDate is required (YYYY-MM-DD)');
  if (endDate && Number.isNaN(endDate.getTime())) errors.push('endDate is invalid');
  if (startDate && endDate && endDate < startDate) errors.push('endDate cannot be before startDate');

  let counters = Array.isArray(body.counters) ? body.counters.map(Number) : [];
  counters = [...new Set(counters)].filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  if (type === 'counter_closed' && counters.length === 0) {
    errors.push('Select at least one counter (1-7)');
  }

  let customText = '';
  if (type === 'custom') {
    const clean = sanitizeRich(body.customText, 500);
    if (clean === null) {
      errors.push('Custom message must be 500 characters or fewer.');
    } else {
      customText = clean;
      if (!customText.replace(/<[^>]*>/g, '').trim()) errors.push('customText is required for a custom notice');
    }
  }

  const value = {
    type,
    counters: type === 'counter_closed' ? counters : [],
    occasion: type === 'office_closed' ? String(body.occasion || '').trim() : '',
    customText,
    startDate,
    endDate,
    active: body.active === undefined ? true : !!body.active,
    order: Number.isFinite(Number(body.order)) ? Number(body.order) : 0,
  };

  return { ok: errors.length === 0, errors, value };
}

module.exports = { composeNoticeText, isLive, validateNotice, datePhrase, fmt };
