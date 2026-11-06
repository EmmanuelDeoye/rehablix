// js/tour/tour.js — touch-focus tutorials. The page dims, one control at a time is lit up with a short tip;
// Next / Back / Skip, or tap the lit control to go on. Each page's tour shows once (localStorage
// rx-tour-<id>), never over an open dialog, and can be replayed from Settings ("Show page tips again").
// Tours: js/tour/tour-steps.js (shared with Android).
(function () {
  'use strict';
  // the web shows only the what's-new highlights; the app has the full page tours (tour-steps.js `on`)
  const TOURS = (window.RehablixTourSteps || []).filter((t) => !t.on || t.on === 'web');
  const SEEN = 'rx-tour-';
  const OFF = 'rx-tour-off';   // "Don't show tips again"
  const tipsOff = () => { try { return localStorage.getItem(OFF) === '1'; } catch (e) { return true; } };
  const seen = (id) => { try { return localStorage.getItem(SEEN + id) === '1'; } catch (e) { return true; } };
  const markSeen = (id) => { try { localStorage.setItem(SEEN + id, '1'); } catch (e) { /* storage blocked */ } };
  let active = null, timer = null;

  function visible(el) {
    if (!el || !el.getClientRects().length) return false;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 4 && r.height > 4 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]');
  }
  // first visible element of a comma-separated selector list
  function find(sel) {
    for (const s of String(sel).split(',')) {
      for (const el of document.querySelectorAll(s.trim())) if (visible(el)) return el;
    }
    return null;
  }
  // a dialog, popup or another first-run screen is up: wait
  function busy() {
    return !!Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], .modal-overlay.active, .modal.active, .modal-backdrop.show, #welcomeTour, .rx-welcome, .preview-modal'))
      .find((el) => visible(el) && !el.closest('.rx-tour'));
  }
  const route = () => document.body.dataset.route || '';

  function css() {
    if (document.getElementById('rxTourCss')) return;
    const s = document.createElement('style'); s.id = 'rxTourCss';
    s.textContent =
      '.rx-tour{position:fixed;inset:0;z-index:2147482000;}' +
      '.rx-tour-hole{position:fixed;border-radius:16px;box-shadow:0 0 0 9999px rgba(6,14,18,.62),0 0 0 3px rgba(20,184,166,.9),0 0 24px rgba(20,184,166,.55);transition:all .28s cubic-bezier(.2,.8,.2,1);pointer-events:auto;cursor:pointer;animation:rxTourPulse 1.8s ease-in-out infinite}' +
      '@keyframes rxTourPulse{50%{box-shadow:0 0 0 9999px rgba(6,14,18,.62),0 0 0 5px rgba(20,184,166,.55),0 0 32px rgba(20,184,166,.7)}}' +
      '.rx-tour-card{position:fixed;max-width:min(340px,calc(100vw - 24px));padding:14px 16px 12px;border-radius:18px;color:var(--text-primary,#1f2933);' +
      'background:rgba(255,255,255,.86);-webkit-backdrop-filter:blur(18px) saturate(160%);backdrop-filter:blur(18px) saturate(160%);border:1px solid rgba(255,255,255,.7);' +
      'box-shadow:0 18px 40px rgba(0,0,0,.25),inset 0 1px 0 rgba(255,255,255,.8);transition:top .28s,left .28s;font:14px/1.45 Inter,system-ui,sans-serif}' +
      '[data-theme="dark"] .rx-tour-card{background:rgba(30,42,50,.88);border-color:rgba(255,255,255,.1);color:#eef2f6}' +
      '.rx-tour-card h4{margin:0 0 4px;font-size:15px;font-weight:700}.rx-tour-card p{margin:0 0 10px}' +
      '.rx-tour-row{display:flex;align-items:center;gap:6px}.rx-tour-dots{flex:1;font-size:12px;opacity:.65}' +
      '.rx-tour-never{display:flex;align-items:center;gap:7px;margin:0 0 10px;font-size:12.5px;opacity:.8;cursor:pointer;user-select:none}.rx-tour-never input{width:16px;height:16px;accent-color:#009688;margin:0}' +
      '.rx-tour-card button{font:inherit;font-weight:600;border-radius:999px;padding:7px 14px;cursor:pointer;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit}' +
      '.rx-tour-card .rx-tour-next{background:#009688;border-color:#009688;color:#fff}.rx-tour-card .rx-tour-skip{border:0;padding:7px 6px;opacity:.7}';
    document.head.appendChild(s);
  }

  function start(tour) {
    const steps = tour.steps.filter((s) => find(s.sel));
    if (!steps.length) { markSeen(tour.id); return; }
    css();
    const box = document.createElement('div'); box.className = 'rx-tour'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', tour.title + ' tips');
    box.innerHTML = '<div class="rx-tour-hole"></div><div class="rx-tour-card" role="document"><h4></h4><p></p>' +
      '<label class="rx-tour-never"><input type="checkbox" class="rx-tour-off"> Skip all tips and don\'t show them again</label><div class="rx-tour-row"><span class="rx-tour-dots"></span>' +
      '<button class="rx-tour-skip" type="button">Skip</button><button class="rx-tour-back" type="button">Back</button><button class="rx-tour-next" type="button">Next</button></div></div>';
    document.body.appendChild(box);
    active = { tour, steps, i: 0, box, route: route() };
    const hole = box.querySelector('.rx-tour-hole'), card = box.querySelector('.rx-tour-card');
    const place = () => {
      const st = active && active.steps[active.i]; if (!st) return;
      const el = find(st.sel);
      if (!el) { next(); return; }
      const r = el.getBoundingClientRect(), pad = 6;
      hole.style.left = (r.left - pad) + 'px'; hole.style.top = (r.top - pad) + 'px';
      hole.style.width = (r.width + pad * 2) + 'px'; hole.style.height = (r.height + pad * 2) + 'px';
      const cw = card.offsetWidth, ch = card.offsetHeight, vw = innerWidth, vh = innerHeight;
      let top = r.bottom + 16; if (top + ch > vh - 10) top = Math.max(10, r.top - ch - 16);
      if (r.height > vh * 0.55) top = Math.min(vh - ch - 12, Math.max(10, r.top + 16));   // a tall target: the card sits inside it
      card.style.top = top + 'px'; card.style.left = Math.min(vw - cw - 12, Math.max(12, r.left + r.width / 2 - cw / 2)) + 'px';
    };
    const show = () => {
      const st = active.steps[active.i], el = find(st.sel);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      card.querySelector('h4').textContent = st.title;
      card.querySelector('p').textContent = st.text;
      card.querySelector('.rx-tour-dots').textContent = (active.i + 1) + ' of ' + active.steps.length;
      card.querySelector('.rx-tour-back').style.visibility = active.i ? 'visible' : 'hidden';
      card.querySelector('.rx-tour-next').textContent = active.i === active.steps.length - 1 ? 'Got it' : 'Next';
      place(); setTimeout(place, 350);
    };
    const end = () => { markSeen(tour.id); box.remove(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); active = null; };
    const next = () => { if (!active) return; if (active.i >= active.steps.length - 1) end(); else { active.i++; show(); } };
    box.querySelector('.rx-tour-next').onclick = next;
    box.querySelector('.rx-tour-back').onclick = () => { if (active.i > 0) { active.i--; show(); } };
    box.querySelector('.rx-tour-skip').onclick = end;
    // "Don't show tips again": closes this tour and every future one (Settings can turn them back on)
    box.querySelector('.rx-tour-off').onchange = (e) => {
      if (!e.target.checked) return;
      try { localStorage.setItem(OFF, '1'); } catch (err) { /* storage blocked */ }
      end();
      if (typeof window.showToast === 'function') window.showToast('Tips turned off. You can turn them back on in Settings.', 'info', 4500);
    };
    hole.onclick = next;   // touch the lit control to go on
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') end(); });
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    active.end = end;
    show();
    box.querySelector('.rx-tour-next').focus();
  }

  // looks for a tour to show on the page on screen
  function check() {
    if (active) { if (active.route !== route()) active.end(); return; }
    if (document.hidden || tipsOff() || busy()) return;
    const r = route();
    const tour = TOURS.find((t) => t.route === r && !seen(t.id) && (!t.when || find(t.when)));
    if (tour) start(tour);
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(check, 900); }
  document.addEventListener('rehablix:routechange', schedule);
  setInterval(() => { if (!active) check(); }, 2500);   // sub-screens (Project Maker's dashboard and editor, Study's views)

  // Settings: "Show page tips again"
  function settingsButton() {
    if (route() !== 'settings' || document.getElementById('rxTourReset')) return;
    const host = document.querySelector('.settings-container');
    if (!host) return;
    const card = document.createElement('div');
    card.className = 'glass-card'; card.style.cssText = 'margin-top:1rem;padding:1rem 1.2rem;border-radius:1.2rem;display:flex;align-items:center;gap:.8rem;flex-wrap:wrap;background:var(--card-bg);border:1px solid var(--border-light)';
    card.innerHTML = '<div style="flex:1;min-width:180px"><strong>Tips</strong><div style="font-size:.85rem;color:var(--text-secondary)">Short guided tips that point out what is new.</div></div>' +
      '<button id="rxTourReset" class="btn btn-secondary" type="button">Show tips again</button>';
    // above Account / Danger Zone, so Log Out stays right before Delete Account
    const before = document.getElementById('settingsAccountCard') || host.querySelector('.danger-card');
    if (before && before.parentNode) before.parentNode.insertBefore(card, before); else host.appendChild(card);
    card.querySelector('#rxTourReset').onclick = () => {
      TOURS.forEach((t) => { try { localStorage.removeItem(SEEN + t.id); } catch (e) { /* storage blocked */ } });
      try { localStorage.removeItem(OFF); } catch (e) { /* storage blocked */ }
      if (typeof window.showToast === 'function') window.showToast('Tips are back on.', 'success');
    };
  }
  document.addEventListener('rehablix:routechange', () => setTimeout(settingsButton, 400));

  window.RehablixTour = {
    reset() { TOURS.forEach((t) => { try { localStorage.removeItem(SEEN + t.id); } catch (e) { /* storage blocked */ } }); try { localStorage.removeItem(OFF); } catch (e) { /* storage blocked */ } },
    showNow(id) { const t = TOURS.find((x) => x.id === id); if (t && !active) start(t); },
    check,
  };
})();
