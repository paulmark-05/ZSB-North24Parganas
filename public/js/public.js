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

  function renderVendors(vendors) {
    const el = $('#vendors');
    if (!vendors.length) {
      el.innerHTML = '<div class="empty-state">No vendors listed yet.</div>';
      return;
    }
    el.innerHTML = vendors
      .map((v) => `
        <div class="vendor">
          <div class="av">${esc((v.name || '?').trim().charAt(0).toUpperCase())}</div>
          <div class="meta">
            <strong>${esc(v.name)}</strong>
            <span>${esc([v.category, v.location].filter(Boolean).join(' · '))}</span>
          </div>
          ${v.phone ? `<a class="tel" href="tel:${esc(v.phone)}">📞 ${esc(v.phone)}</a>` : ''}
        </div>`)
      .join('');
  }

  function renderAds(ads) {
    const list = (ads || []).filter((a) => a.active !== false);
    if (!list.length) {
      $('#adSection').hidden = true;
      return;
    }
    $('#adSection').hidden = false;
    $('#ads').innerHTML = list
      .map((ad, i) => `
        <button class="ad" type="button" data-idx="${i}">
          <div class="banner">${ad.imageUrl ? `<img src="${esc(ad.imageUrl)}" alt="${esc(ad.businessName)}" />` : 'ADVERTISEMENT'}</div>
          <div class="foot">
            <strong>${esc(ad.businessName || 'Advertisement')}</strong>
            <span class="pill">${esc(ad.caption || 'Ad')}</span>
          </div>
        </button>`)
      .join('');

    $$('#ads .ad').forEach((btn, i) => {
      const ad = list[i];
      btn.addEventListener('click', () => {
        if (!ad.link) return toast('No link configured for this advertisement.', 'err');
        const text = ad.linkType === 'drive'
          ? 'You are being redirected to the advertiser’s poster on Google Drive.'
          : 'You are being redirected to the advertiser’s website.';
        openModal(ad.businessName || 'Advertisement', text, ad.link);
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
    modal.hidden = false;
  }
  function closeModal() { modal.hidden = true; pendingUrl = null; }

  $('#mCancel').addEventListener('click', closeModal);
  $('#mGo').addEventListener('click', () => {
    if (pendingUrl) window.open(pendingUrl, '_blank', 'noopener');
    closeModal();
  });
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

  /* ----------------------------- boot ----------------------------- */
  API.get('/content')
    .then(({ data }) => {
      applyTheme(data.settings.theme);
      renderHeader(data.settings);
      renderNotices(data.notices, data.settings.marqueeSpeed);
      renderCards(data.links);
      renderVendors(data.vendors);
      renderAds(data.ads);
    })
    .catch((err) => {
      $('#marquee').classList.add('empty');
      $('#marquee').innerHTML = 'Unable to load content — ' + esc(err.message);
      toast(err.message, 'err');
    });
})();
