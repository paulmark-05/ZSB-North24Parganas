/* Public portal — renders everything from GET /api/content */
(function () {
  const modal = $('#modal');
  let pendingUrl = null;

  document.getElementById('year').textContent = new Date().getFullYear();

  function applyTheme(theme) {
    if (!theme) return;
    const r = document.documentElement.style;
    if (theme.navy) r.setProperty('--navy', theme.navy);
    if (theme.red) r.setProperty('--red', theme.red);
    if (theme.lightBlue) r.setProperty('--blue', theme.lightBlue);
  }

  function renderHeader(s) {
    $('#orgName').textContent = s.orgName || 'Zila Sainik Board';
    $('#district').textContent = s.district || '';
    $('#footOrg').textContent = s.orgName || 'Zila Sainik Board';
    document.title = `${s.orgName || 'Zila Sainik Board'} — Official Portal`;
    if (s.logoUrl) {
      $('#logo').innerHTML = `<img src="${esc(s.logoUrl)}" alt="Logo" />`;
    }
  }

  function renderNotices(notices, speed) {
    const mq = $('#marquee');
    const track = $('#track');
    if (!notices.length) {
      mq.classList.add('empty');
      mq.innerHTML = 'No active notices at this time.';
      return;
    }
    // Duplicate the sequence once so the -50% translate loops seamlessly.
    const seq = notices
      .map((n) => `<span class="item">${esc(n.text)}</span><span class="item sep">•</span>`)
      .join('');
    track.innerHTML = seq + seq;
    track.style.setProperty('--speed', Math.max(12, Number(speed) || 24) + 's');
  }

  function serviceCard(cfg, kind) {
    const icon = kind === 'grievance' ? '⚖' : '🪪';
    return `
      <button class="action-card ${kind === 'grievance' ? 'is-grievance' : ''}"
              type="button" data-kind="${kind}">
        <div class="ico">${icon}</div>
        <div>
          <h3>${esc(cfg.label)}</h3>
          <p>${esc(cfg.description)}</p>
        </div>
        <div class="go">›</div>
      </button>`;
  }

  function renderCards(links) {
    const out = [];
    if (links.vms && links.vms.enabled !== false) out.push(serviceCard(links.vms, 'vms'));
    if (links.grievance && links.grievance.enabled !== false) out.push(serviceCard(links.grievance, 'grievance'));
    $('#cards').innerHTML = out.join('') || '<div class="empty-state">No services are available right now.</div>';

    $$('#cards .action-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cfg = links[btn.dataset.kind];
        openModal(cfg.label, cfg.previewText, cfg.link);
      });
    });
  }

  /* Unified Advertisements section — each entry is either a `listing`
     (vendor-style: name/phone/location) or a `poster` (image + link).
     Rendered in one list, in the admin's manually-set order. */
  function adCard(ad) {
    if (ad.kind === 'listing') {
      return `
        <div class="vendor">
          <div class="av">${esc((ad.name || '?').trim().charAt(0).toUpperCase())}</div>
          <div class="meta">
            <strong>${esc(ad.name)}</strong>
            <span>${esc([ad.category, ad.location].filter(Boolean).join(' · '))}</span>
          </div>
          ${ad.phone ? `<a class="tel" href="tel:${esc(ad.phone)}">📞 ${esc(ad.phone)}</a>` : ''}
        </div>`;
    }
    // No poster image: skip the banner placeholder entirely and render a
    // compact, text-only card — a headline + description, no empty box.
    return `
      <button class="ad ${ad.imageUrl ? '' : 'ad-textonly'}" type="button" data-id="${esc(ad.id)}">
        ${ad.imageUrl ? `<div class="banner"><img src="${esc(ad.imageUrl)}" alt="${esc(ad.name)}" /></div>` : ''}
        <div class="foot">
          <div class="foot-text">
            <strong>${esc(ad.name || 'Advertisement')}</strong>
            ${ad.description ? `<span class="desc">${esc(ad.description)}</span>` : ''}
          </div>
          <span class="pill">${esc(ad.caption || 'Ad')}</span>
        </div>
      </button>`;
  }

  function renderAds(ads) {
    const list = (ads || []).filter((a) => a.active !== false);
    if (!list.length) {
      $('#adSection').hidden = true;
      return;
    }
    $('#adSection').hidden = false;
    $('#ads').classList.toggle('single-item', list.length === 1);
    $('#ads').innerHTML = list.map(adCard).join('');

    $$('#ads .ad').forEach((btn) => {
      const ad = list.find((a) => a.id === btn.dataset.id);
      btn.addEventListener('click', () => {
        if (!ad.link) return toast('No link configured for this advertisement.', 'err');
        const text = ad.linkType === 'drive'
          ? 'You are being redirected to the advertiser’s poster on Google Drive.'
          : 'You are being redirected to the advertiser’s website.';
        openModal(ad.name || 'Advertisement', text, ad.link);
      });
    });
  }

  /* ------------------------- redirect modal ------------------------- */
  function openModal(title, text, url) {
    if (!url) return toast('No link has been configured yet.', 'err');
    pendingUrl = url;
    $('#mTitle').textContent = title;
    $('#mText').textContent = text || 'You are about to leave this portal.';
    $('#mUrl').textContent = url;
    $('#mPreview').src = url; // live preview of the destination before continuing
    modal.hidden = false;
  }
  function closeModal() {
    modal.hidden = true;
    pendingUrl = null;
    $('#mPreview').src = 'about:blank'; // stop the embedded page running in the background
  }

  $('#mCancel').addEventListener('click', closeModal);
  $('#mGo').addEventListener('click', () => {
    if (pendingUrl) window.open(pendingUrl, '_blank', 'noopener');
    closeModal();
  });
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

  /* ----------------------------- boot + live polling ----------------------------- */
  // No WebSocket infra here (the app runs on serverless hosting, where a persistent
  // socket connection isn't reliable) — polling for changes is the portable
  // equivalent, so admin edits show up here without a manual refresh.
  let lastSnapshot = null;
  async function loadContent(isFirstLoad) {
    try {
      const { data } = await API.get('/content');
      const snapshot = JSON.stringify(data);
      if (snapshot === lastSnapshot) return; // nothing changed — skip the re-render
      lastSnapshot = snapshot;
      applyTheme(data.settings.theme);
      renderHeader(data.settings);
      renderNotices(data.notices, data.settings.marqueeSpeed);
      renderCards(data.links);
      renderAds(data.ads);
    } catch (err) {
      if (isFirstLoad) {
        $('#marquee').classList.add('empty');
        $('#marquee').innerHTML = 'Unable to load content — ' + esc(err.message);
        toast(err.message, 'err');
      }
      // on later polls, fail quietly — a dropped poll shouldn't spam toasts
    }
  }

  loadContent(true);
  setInterval(() => loadContent(false), 8000);
})();
