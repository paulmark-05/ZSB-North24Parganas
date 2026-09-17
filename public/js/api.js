/* Shared API client + tiny helpers (no framework, no build step). */
(function () {
  const TOKEN_KEY = 'zsb_token';

  const Token = {
    get: () => localStorage.getItem(TOKEN_KEY),
    set: (t) => localStorage.setItem(TOKEN_KEY, t),
    clear: () => localStorage.removeItem(TOKEN_KEY),
  };

  async function request(method, path, body, isForm) {
    const headers = {};
    const token = Token.get();
    if (token) headers.Authorization = 'Bearer ' + token;
    if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetch('/api' + path, {
        method,
        headers,
        body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      });
    } catch {
      throw new Error('Network error — is the server running?');
    }

    let json = null;
    try { json = await res.json(); } catch { /* non-JSON */ }

    if (res.status === 401 && !path.startsWith('/auth/login')) {
      Token.clear();
      if (window.onUnauthorized) window.onUnauthorized();
    }
    if (!res.ok || (json && json.ok === false)) {
      throw new Error((json && json.error) || `Request failed (${res.status})`);
    }
    return json;
  }

  /**
   * Shrinks an image in the browser before it's ever sent. Vercel (and most
   * serverless hosts) reject request bodies over ~4.5MB at the platform
   * level — before our own code even runs — so a phone photo has to be
   * downsized client-side, not just on the server. SVGs are vector and
   * untouched; everything else is capped to maxDim on its longest side and
   * re-encoded at `quality` (ignored for PNG, which is lossless).
   */
  async function shrinkImage(file, maxDim, quality) {
    if (!file.type || file.type === 'image/svg+xml' || !file.type.startsWith('image/')) return file;

    let img;
    const url = URL.createObjectURL(file);
    try {
      img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('Could not read image'));
        im.src = url;
      });
    } catch {
      URL.revokeObjectURL(url);
      return file; // unreadable as an image — let the server validate/reject it
    }

    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const width = Math.round(img.width * scale);
    const height = Math.round(img.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);

    const outType = file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, outType, quality));
    if (!blob) return file; // canvas export failed for some reason — fall back to the original

    const ext = outType === 'image/png' ? '.png' : outType === 'image/webp' ? '.webp' : '.jpg';
    return new File([blob], file.name.replace(/\.\w+$/, '') + ext, { type: outType });
  }

  window.API = {
    Token,
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b),
    put: (p, b) => request('PUT', p, b),
    patch: (p, b) => request('PATCH', p, b || {}),
    del: (p) => request('DELETE', p),
    upload: async (file) => {
      const shrunk = await shrinkImage(file, 1600, 0.85);
      const fd = new FormData();
      fd.append('file', shrunk);
      return request('POST', '/upload', fd, true);
    },
  };

  /* --------------------------- helpers --------------------------- */
  window.$ = (sel, root) => (root || document).querySelector(sel);
  window.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  window.esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );

  /**
   * Strips everything except a tiny whitelist of inline tags (b/strong/i/em/u/br,
   * no attributes). This is a client-side convenience only — the server runs
   * the authoritative sanitizer (server/lib/sanitizeRich.js) since these fields
   * are reachable directly via the API, not just through this editor.
   */
  const RICH_ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR']);
  window.sanitizeRichText = (html) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = String(html == null ? '' : html);
    (function clean(node) {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) return;
        if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); return; }
        if (!RICH_ALLOWED.has(child.tagName)) {
          while (child.firstChild) child.parentNode.insertBefore(child.firstChild, child);
          child.remove();
          return;
        }
        Array.from(child.attributes).forEach((a) => child.removeAttribute(a.name));
        clean(child);
      });
    })(tmp);
    return tmp.innerHTML;
  };

  /**
   * Turns a `.rich-editable` div into a live bold/italic/underline editor:
   * the B/I/U buttons apply real formatting immediately (via execCommand),
   * Enter inserts a <br> (not a nested block), and paste always lands as
   * plain text so clipboard HTML can't sneak in unreviewed markup.
   */
  window.wireRichEditor = (toolbarEl, editableEl) => {
    try { document.execCommand('defaultParagraphSeparator', false, 'br'); } catch { /* older browsers */ }

    toolbarEl.querySelectorAll('.fmt-btn').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep the text selection intact
      btn.addEventListener('click', () => {
        editableEl.focus();
        document.execCommand(btn.dataset.fmt, false, null);
        editableEl.dispatchEvent(new Event('input'));
      });
    });

    editableEl.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });

    editableEl.addEventListener('blur', () => {
      editableEl.innerHTML = sanitizeRichText(editableEl.innerHTML);
    });
  };

  window.toast = function (msg, kind) {
    const wrap = document.getElementById('toasts');
    if (!wrap) return alert(msg);
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 3400);
  };

  window.todayISO = () => new Date().toISOString().slice(0, 10);
})();
