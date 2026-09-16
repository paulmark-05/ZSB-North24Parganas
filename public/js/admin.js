/* Admin CMS — auth, tabs, and all editors. */
(function () {
  const loginView = $('#loginView');
  const appView = $('#appView');

  let editingNoticeId = null;
  let editingAdId = null;
  let adImageUrl = '';
  let logoUrl = '';
  let dragInProgress = false;

  const showErr = (id, msg) => {
    const el = $(id);
    el.textContent = msg;
    el.hidden = !msg;
  };

  /* ==================== BUSY OVERLAY (uploads, saves) ==================== */
  function showLoading(text) {
    $('#loadingText').textContent = text || 'Working…';
    $('#loadingOverlay').hidden = false;
  }
  function hideLoading() {
    $('#loadingOverlay').hidden = true;
  }
  async function withLoading(text, fn) {
    showLoading(text);
    try {
      return await fn();
    } finally {
      hideLoading();
    }
  }

  /* ============================ AUTH ============================ */
  window.onUnauthorized = () => {
    appView.hidden = true;
    loginView.style.display = 'flex';
    toast('Session expired. Please sign in again.', 'err');
  };

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    showErr('#loginErr', '');
    const btn = $('#loginBtn');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const r = await API.post('/auth/login', { username: $('#u').value.trim(), password: $('#p').value });
      API.Token.set(r.token);
      await boot(r.user);
    } catch (err) {
      showErr('#loginErr', err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });

  $('#logoutBtn').addEventListener('click', () => {
    API.Token.clear();
    location.reload();
  });

  /* ============================ TABS ============================ */
  $$('#side .nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('#side .nav-item').forEach((b) => b.classList.toggle('active', b === btn));
      $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== btn.dataset.tab));
    });
  });

  /* ========================== NOTICES ========================== */
  const chips = $('#counterChips');
  chips.innerHTML = [1, 2, 3, 4, 5, 6, 7]
    .map((n) => `<label class="chip"><input type="checkbox" value="${n}" /><span>${n}</span></label>`)
    .join('');

  function noticeTypeUI() {
    const t = $('#nType').value;
    $('#fCounters').hidden = t !== 'counter_closed';
    $('#fOccasion').hidden = t !== 'office_closed';
    $('#fCustom').hidden = t !== 'custom';
  }

  function readNotice() {
    return {
      type: $('#nType').value,
      counters: $$('#counterChips input:checked').map((c) => Number(c.value)),
      occasion: $('#nOccasion').value.trim(),
      customText: $('#nCustom').value.trim(),
      startDate: $('#nStart').value,
      endDate: $('#nEnd').value || $('#nStart').value,
      active: $('#nActive').checked,
    };
  }

  let previewTimer = null;
  async function refreshPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      const body = readNotice();
      if (!body.startDate) {
        $('#nPreview').innerHTML = '<em>Choose a start date to see the banner text…</em>';
        return;
      }
      try {
        const r = await API.post('/notices/preview', body);
        $('#nPreview').textContent = r.data.text || '—';
      } catch (err) {
        $('#nPreview').innerHTML = '<em>' + esc(err.message) + '</em>';
      }
    }, 220);
  }

  ['#nType', '#nOccasion', '#nCustom', '#nStart', '#nEnd'].forEach((s) =>
    $(s).addEventListener('input', () => { noticeTypeUI(); refreshPreview(); })
  );
  chips.addEventListener('change', refreshPreview);

  function openNoticeForm(n) {
    editingNoticeId = n ? n.id : null;
    $('#noticeForm').hidden = false;
    showErr('#noticeErr', '');
    $('#nType').value = n ? n.type : 'counter_closed';
    $$('#counterChips input').forEach((c) => (c.checked = !!(n && (n.counters || []).includes(Number(c.value)))));
    $('#nOccasion').value = n ? n.occasion || '' : '';
    $('#nCustom').value = n ? n.customText || '' : '';
    $('#nStart').value = n ? String(n.startDate).slice(0, 10) : todayISO();
    $('#nEnd').value = n ? String(n.endDate).slice(0, 10) : todayISO();
    $('#nActive').checked = n ? n.active !== false : true;
    noticeTypeUI();
    refreshPreview();
    $('#noticeForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  $('#newNotice').addEventListener('click', () => openNoticeForm(null));
  $('#cancelNotice').addEventListener('click', () => {
    $('#noticeForm').hidden = true;
    editingNoticeId = null;
  });

  $('#noticeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    showErr('#noticeErr', '');
    try {
      const body = readNotice();
      if (editingNoticeId) await API.put('/notices/' + editingNoticeId, body);
      else await API.post('/notices', body);
      toast('Notice saved.', 'ok');
      $('#noticeForm').hidden = true;
      editingNoticeId = null;
      loadNotices();
    } catch (err) {
      showErr('#noticeErr', err.message);
    }
  });

  function noticeBadge(n) {
    if (!n.active) return '<span class="badge off">Off</span>';
    if (n.live) return '<span class="badge live">Live now</span>';
    const today = todayISO();
    if (String(n.endDate).slice(0, 10) < today) return '<span class="badge exp">Expired</span>';
    return '<span class="badge sched">Scheduled</span>';
  }

  async function loadNotices() {
    const { data } = await API.get('/notices');
    const el = $('#noticeList');
    if (!data.length) {
      el.innerHTML = '<div class="empty-state">No notices yet. Click “New notice” to add the first one.</div>';
      return;
    }
    el.innerHTML = data
      .map((n) => `
        <div class="rec ${n.active ? '' : 'inactive'}">
          <div class="body">
            <strong>${noticeBadge(n)}${esc(n.text)}</strong>
            <span>${esc(String(n.startDate).slice(0, 10))} → ${esc(String(n.endDate).slice(0, 10))}</span>
          </div>
          <div class="acts">
            <button class="btn ghost sm" data-act="toggle" data-id="${n.id}">${n.active ? 'Disable' : 'Enable'}</button>
            <button class="btn ghost sm" data-act="edit" data-id="${n.id}">Edit</button>
            <button class="btn red sm" data-act="del" data-id="${n.id}">Delete</button>
          </div>
        </div>`)
      .join('');

    $$('#noticeList [data-act]').forEach((b) => {
      b.addEventListener('click', async () => {
        const n = data.find((x) => x.id === b.dataset.id);
        try {
          if (b.dataset.act === 'edit') return openNoticeForm(n);
          if (b.dataset.act === 'toggle') { await API.patch('/notices/' + n.id + '/toggle'); toast('Notice updated.', 'ok'); }
          if (b.dataset.act === 'del') {
            if (!confirm('Delete this notice permanently?')) return;
            await API.del('/notices/' + n.id);
            toast('Notice deleted.', 'ok');
          }
          loadNotices();
        } catch (err) { toast(err.message, 'err'); }
      });
    });
  }

  /* ========================== LINKS ========================== */
  async function loadLinks() {
    const { data } = await API.get('/links');
    $('#vmsEnabled').checked = data.vms.enabled !== false;
    $('#vmsLabel').value = data.vms.label || '';
    $('#vmsDesc').value = data.vms.description || '';
    $('#vmsLink').value = data.vms.link || '';
    $('#vmsPrev').value = data.vms.previewText || '';
    $('#grvEnabled').checked = data.grievance.enabled !== false;
    $('#grvLabel').value = data.grievance.label || '';
    $('#grvDesc').value = data.grievance.description || '';
    $('#grvLink').value = data.grievance.link || '';
    $('#grvPrev').value = data.grievance.previewText || '';
  }

  $('#linksForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    showErr('#linksErr', '');
    try {
      await API.put('/links', {
        vms: {
          enabled: $('#vmsEnabled').checked, label: $('#vmsLabel').value,
          description: $('#vmsDesc').value, link: $('#vmsLink').value, previewText: $('#vmsPrev').value,
        },
        grievance: {
          enabled: $('#grvEnabled').checked, label: $('#grvLabel').value,
          description: $('#grvDesc').value, link: $('#grvLink').value, previewText: $('#grvPrev').value,
        },
      });
      toast('Links saved.', 'ok');
    } catch (err) { showErr('#linksErr', err.message); }
  });

  /* ==================== ADVERTISEMENTS (unified) ==================== */
  function paintAdPreview() {
    $('#adPreview').innerHTML = adImageUrl
      ? `<img src="${esc(adImageUrl)}" alt="poster" />`
      : 'POSTER PLACEHOLDER';
  }

  function adLinkTypeUI() {
    const t = ($$('input[name="adLinkType"]:checked')[0] || {}).value || 'website';
    if (t === 'drive') {
      $('#adLinkLabel').textContent = 'Google Drive link (opens when the ad is clicked)';
      $('#adLinkHint').textContent = 'Make sure the Drive file is shared as “Anyone with the link — Viewer”.';
      $('#adLink').placeholder = 'https://drive.google.com/file/d/…/view';
    } else {
      $('#adLinkLabel').textContent = 'Website URL (opens when the ad is clicked)';
      $('#adLinkHint').textContent = 'Any http(s) link — the advertiser’s own website, landing page, etc.';
      $('#adLink').placeholder = 'https://…';
    }
  }
  $$('input[name="adLinkType"]').forEach((r) => r.addEventListener('change', adLinkTypeUI));

  function adKindUI() {
    const kind = ($$('input[name="adKind"]:checked')[0] || {}).value || 'poster';
    const isListing = kind === 'listing';
    $('#adNameLabel').textContent = isListing ? 'Name' : 'Business name';
    $('#fCaption').hidden = isListing;
    $('#fCategory').hidden = !isListing;
    $('#fListingFields').hidden = !isListing;
    $('#fPosterFields').hidden = isListing;
  }
  $$('input[name="adKind"]').forEach((r) => r.addEventListener('change', adKindUI));

  function adImageToggleUI() {
    $('#fPosterImage').hidden = !$('#adHasImage').checked;
  }
  $('#adHasImage').addEventListener('change', adImageToggleUI);

  function openAdModal(ad) {
    editingAdId = ad ? ad.id : null;
    $('#adModalTitle').textContent = ad ? 'Edit advertisement' : 'New advertisement';
    showErr('#adErr', '');

    const kind = ad ? ad.kind || 'poster' : 'poster';
    $$('input[name="adKind"]').forEach((r) => (r.checked = r.value === kind));

    $('#adName2').value = ad ? ad.name : '';
    $('#adCaption').value = ad ? ad.caption || '' : 'Advertisement';
    $('#adDescription').value = ad ? ad.description || '' : '';
    $('#adCategory').value = ad ? ad.category || '' : '';
    $('#adLocation').value = ad ? ad.location || '' : '';
    $('#adPhone').value = ad ? ad.phone || '' : '';

    const linkType = ad ? ad.linkType || 'website' : 'website';
    $$('input[name="adLinkType"]').forEach((r) => (r.checked = r.value === linkType));
    $('#adLink').value = ad ? ad.link || '' : '';

    $('#adEnabled').checked = ad ? ad.active !== false : true;
    adImageUrl = ad ? ad.imageUrl || '' : '';
    $('#adHasImage').checked = ad ? !!adImageUrl : true;
    paintAdPreview();
    adLinkTypeUI();
    adKindUI();
    adImageToggleUI();
    $('#adModal').hidden = false;
  }

  function closeAdModal() {
    $('#adModal').hidden = true;
    editingAdId = null;
  }

  $('#newAd').addEventListener('click', () => openAdModal(null));
  $('#cancelAd').addEventListener('click', closeAdModal);
  $('#adModal').addEventListener('click', (e) => { if (e.target === $('#adModal')) closeAdModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#adModal').hidden) closeAdModal(); });

  $('#adPick').addEventListener('click', () => $('#adFile').click());
  $('#adFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const r = await withLoading('Uploading image…', () => API.upload(f));
      adImageUrl = r.data.url;
      paintAdPreview();
      toast('Image uploaded. Remember to save.', 'ok');
    } catch (err) { toast(err.message, 'err'); }
    e.target.value = '';
  });
  $('#adClear').addEventListener('click', () => { adImageUrl = ''; paintAdPreview(); });

  $('#adForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    showErr('#adErr', '');
    const kind = ($$('input[name="adKind"]:checked')[0] || {}).value || 'poster';
    const body = { kind, name: $('#adName2').value, active: $('#adEnabled').checked };
    if (kind === 'listing') {
      body.category = $('#adCategory').value;
      body.location = $('#adLocation').value;
      body.phone = $('#adPhone').value;
    } else {
      body.caption = $('#adCaption').value;
      body.description = $('#adDescription').value;
      body.linkType = ($$('input[name="adLinkType"]:checked')[0] || {}).value || 'website';
      body.link = $('#adLink').value;
      body.imageUrl = $('#adHasImage').checked ? adImageUrl : '';
    }
    const isNew = !editingAdId;
    try {
      await withLoading(isNew ? 'Publishing advertisement…' : 'Updating advertisement…', () =>
        isNew ? API.post('/ads', body) : API.put('/ads/' + editingAdId, body)
      );
      toast('Advertisement saved.', 'ok');
      closeAdModal();
      loadAds();
    } catch (err) { showErr('#adErr', err.message); }
  });

  function adRowMeta(a) {
    if (a.kind === 'listing') return [a.category, a.location, a.phone].filter(Boolean).join(' · ') || '—';
    return (a.linkType === 'drive' ? 'Google Drive' : 'Website') + ' · ' + (a.link || 'no link set');
  }

  async function loadAds() {
    const { data } = await API.get('/ads');
    const el = $('#adList');
    if (!data.length) {
      el.innerHTML = '<div class="empty-state">No ads yet. Click “New ad” to add one.</div>';
      return;
    }
    el.innerHTML = data
      .map((a) => `
        <div class="rec draggable-rec ${a.active ? '' : 'inactive'}" draggable="true" data-id="${a.id}">
          <span class="drag-handle" title="Drag to reorder">⠿</span>
          <div class="body">
            <strong>
              ${a.active ? '' : '<span class="badge off">Hidden</span>'}
              <span class="badge ${a.kind === 'listing' ? 'listing' : 'poster'}">${a.kind === 'listing' ? 'Listing' : 'Poster'}</span>
              ${esc(a.name)}
            </strong>
            <span>${esc(adRowMeta(a))}</span>
          </div>
          <div class="acts">
            <button class="btn ghost sm" data-act="toggle" data-id="${a.id}">${a.active ? 'Disable' : 'Enable'}</button>
            <button class="btn ghost sm" data-act="edit" data-id="${a.id}">Edit</button>
            <button class="btn red sm" data-act="del" data-id="${a.id}">Delete</button>
          </div>
        </div>`)
      .join('');

    $$('#adList [data-act]').forEach((b) => {
      b.addEventListener('click', async () => {
        const a = data.find((x) => x.id === b.dataset.id);
        try {
          if (b.dataset.act === 'edit') return openAdModal(a);
          if (b.dataset.act === 'toggle') { await API.patch('/ads/' + a.id + '/toggle'); toast('Ad updated.', 'ok'); }
          if (b.dataset.act === 'del') {
            if (!confirm(`Delete “${a.name}”?`)) return;
            await API.del('/ads/' + a.id);
            toast('Ad deleted.', 'ok');
          }
          loadAds();
        } catch (err) { toast(err.message, 'err'); }
      });
    });

    setupDragReorder();
  }

  /* Native HTML5 drag-and-drop reordering. Drop position is computed live
     during dragover so the list visually reflows as you drag, then the
     final DOM order is persisted in one call. */
  function setupDragReorder() {
    const el = $('#adList');
    let draggedEl = null;

    $$('.draggable-rec', el).forEach((row) => {
      row.addEventListener('dragstart', () => {
        draggedEl = row;
        dragInProgress = true;
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        draggedEl = null;
        dragInProgress = false;
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!draggedEl || row === draggedEl) return;
        const rect = row.getBoundingClientRect();
        const before = e.clientY - rect.top < rect.height / 2;
        row.parentNode.insertBefore(draggedEl, before ? row : row.nextSibling);
      });
      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        const order = $$('.draggable-rec', el).map((r) => r.dataset.id);
        try {
          await API.post('/ads/reorder', { order });
          toast('Order saved.', 'ok');
        } catch (err) {
          toast(err.message, 'err');
          loadAds();
        }
      });
    });
  }

  /* ========================== SETTINGS ========================== */
  function paintLogo() {
    $('#logoPreview').innerHTML = logoUrl
      ? `<img src="${esc(logoUrl)}" alt="logo" />`
      : '<span class="ph">LOGO</span>';
  }

  async function loadSettings() {
    const { data } = await API.get('/settings');
    $('#sOrg').value = data.orgName || '';
    $('#sDist').value = data.district || '';
    $('#sSpeed').value = data.marqueeSpeed || 22;
    $('#cNavy').value = (data.theme && data.theme.navy) || '#0b2545';
    $('#cRed').value = (data.theme && data.theme.red) || '#c8102e';
    $('#cBlue').value = (data.theme && data.theme.lightBlue) || '#2e7fd4';
    logoUrl = data.logoUrl || '';
    paintLogo();
  }

  $('#logoPick').addEventListener('click', () => $('#logoFile').click());
  $('#logoFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const r = await withLoading('Uploading logo…', () => API.upload(f));
      logoUrl = r.data.url;
      paintLogo();
      toast('Logo uploaded. Remember to save.', 'ok');
    } catch (err) { toast(err.message, 'err'); }
    e.target.value = '';
  });
  $('#logoClear').addEventListener('click', () => { logoUrl = ''; paintLogo(); });

  $('#settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    showErr('#setErr', '');
    try {
      await API.put('/settings', {
        orgName: $('#sOrg').value,
        district: $('#sDist').value,
        logoUrl,
        marqueeSpeed: Number($('#sSpeed').value),
        theme: { navy: $('#cNavy').value, red: $('#cRed').value, lightBlue: $('#cBlue').value },
      });
      toast('Settings saved.', 'ok');
    } catch (err) { showErr('#setErr', err.message); }
  });

  $('#resetBtn').addEventListener('click', async () => {
    if (!confirm('Restore settings and links to factory defaults?')) return;
    try {
      await API.post('/admin/reset-defaults', {});
      await Promise.all([loadSettings(), loadLinks()]);
      toast('Defaults restored.', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  });

  /* ========================== ACCOUNT ========================== */
  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    showErr('#pwErr', '');
    try {
      await API.post('/auth/change-password', {
        currentPassword: $('#pwCur').value,
        newPassword: $('#pwNew').value,
      });
      $('#pwForm').reset();
      toast('Password updated.', 'ok');
    } catch (err) { showErr('#pwErr', err.message); }
  });

  /* ============================ BOOT ============================ */
  // Same portable "poll instead of push" approach as the public page (no
  // persistent-socket infra on serverless hosting). Skipped while a form is
  // open or a drag is in progress so it never clobbers an in-progress edit.
  let pollTimer = null;
  function startLivePolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (appView.hidden || dragInProgress) return;
      if (!$('#noticeForm').hidden || !$('#adModal').hidden) return;
      loadNotices().catch(() => {});
      loadAds().catch(() => {});
    }, 8000);
  }

  async function boot(user) {
    loginView.style.display = 'none';
    appView.hidden = false;
    $('#who').textContent = 'Signed in as ' + (user.displayName || user.username);
    try {
      await Promise.all([loadNotices(), loadLinks(), loadAds(), loadSettings()]);
      startLivePolling();
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  (async function init() {
    if (!API.Token.get()) return;
    try {
      const r = await API.get('/auth/me');
      await boot(r.user);
    } catch {
      API.Token.clear(); // stay on login screen
    }
  })();
})();
