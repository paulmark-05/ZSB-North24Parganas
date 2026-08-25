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

  window.API = {
    Token,
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b),
    put: (p, b) => request('PUT', p, b),
    patch: (p, b) => request('PATCH', p, b || {}),
    del: (p) => request('DELETE', p),
    upload: (file) => {
      const fd = new FormData();
      fd.append('file', file);
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
