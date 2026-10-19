// js/lixa-agent/agent-ui.js — Lixa Agent mode on the web: the navbar icon, the
// agent screen over the page (below the navbar, above the bottom bar), its
// settings and details panels, the mode chip, the confirm card, the "found" list,
// the upgrade invitation, and the small draggable mascot that keeps her running
// in the background while the user works on a page.
//
// Opening it: the navbar icon (every page), tapping the Lixa logo on Lixa's empty
// new-chat screen, or Send with an empty message box — as in the Android app.
// Nothing here changes how Lixa chat itself works; exchanges are only added to the
// chat through its own functions (window.LixaCore).
(function () {
  'use strict';
  if (window.LixaAgentMode) return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const B = () => window.LixaAgentBrain;

  let root = null, bubble = null, navBtn = null, settingsNavBtn = null, session = null, avatar = null, bubbleAvatar = null, map = null;
  let showing = false, active = false, panel = null;      // panel: 'settings' | 'details' | 'captions' | null
  let wakeLock = null;                                      // the screen kept on while agent mode is open (Keep screen on)
  let warnNoConfirm = false;                                // the warning before "Ask before changes" is turned off
  let bubblePos = null;
  try { bubblePos = JSON.parse(localStorage.getItem('rehab-agent-bubble') || 'null'); } catch (e) { bubblePos = null; }

  const MODE_INFO = {
    TUTOR: { icon: 'fa-graduation-cap', label: 'Tutor mode' }, GAME: { icon: 'fa-trophy', label: 'Quiz (game mode)' },
    THERAPIST: { icon: 'fa-user-md', label: 'Therapist mode' }, PATIENT: { icon: 'fa-user', label: 'Patient mode' }
  };

  function route() { return (window.RehablixRouter && window.RehablixRouter.getCurrentRoute && window.RehablixRouter.getCurrentRoute()) || 'lixa'; }

  // ------------------------------------------------------------------ the page around her
  const hostApi = {
    route,
    open(href) {
      if (window.RehablixRouter) window.RehablixRouter.go(href); else window.location.href = href;
      minimize();                                     // the page is what the user wants to see now
    },
    close: () => close(),
    /** Brings the agent screen back from the background (a card that needs it). */
    restore() { if (active && !showing) open(); },
    clearScreen() { if (session) session.set({ found: [], details: null }); panel = null; render(); },
    onChange: () => render(),
    /** A few lines about what is on the page now, de-identified (patients are never named to the AI). */
    pageDetail(ids) {
      const host = document.querySelector('#keepAliveHost:not([hidden]) .kept-alive-view:not([hidden])') || document.querySelector('#transientHost:not([hidden])');
      if (!host) return '';
      const heads = Array.from(host.querySelectorAll('h1, h2, h3, .tab.active, .tab-btn.active, [aria-selected="true"]'))
        .filter(el => el.offsetParent !== null).map(el => el.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 10);
      if (!heads.length) return '';
      const D = window.RehablixDeidentify;
      return 'Headings and open tabs on the page: ' + heads.map(h => (D ? D.scrubText(h, ids) : h).slice(0, 80)).join(' | ') + '.';
    }
  };

  // ------------------------------------------------------------------ building the screen
  function build() {
    root = document.createElement('section');
    root.id = 'lixaAgent';
    root.className = 'lxa';
    root.hidden = true;
    root.setAttribute('aria-label', 'Lixa Agent');
    root.innerHTML = `
      <div class="lxa-top">
        <button type="button" class="lxa-round" data-act="min" aria-label="Put Lixa Agent in the background" title="Keep her running in the background"><i class="fas fa-chevron-down"></i></button>
        <div class="lxa-chip lxa-page"><i class="fas fa-comment-dots"></i><span></span></div>
        <button type="button" class="lxa-round" data-act="close" aria-label="Close Lixa Agent" title="Close"><i class="fas fa-times"></i></button>
      </div>
      <!-- Three columns on a desktop (the controls left, Lixa in the middle, cards and panels right);
           on a phone the columns melt into one (display: contents) in the usual order. -->
      <div class="lxa-left">
        <div class="lxa-modes">
          <div class="lxa-switch" role="group" aria-label="How Lixa talks">
            <button type="button" data-act="standard" aria-pressed="true">Standard</button>
            <button type="button" data-act="live" aria-pressed="false"><i class="fas fa-bolt"></i> Live</button>
          </div>
          <span class="lxa-miclive" role="status" hidden><span class="lxa-dot"></span>Mic live</span>
        </div>
        <div class="lxa-mode" hidden><i class="fas"></i><span class="lxa-mode-label"></span><span class="lxa-mode-score"></span><button type="button" data-act="endmode">End</button></div>
        <!-- (Lixa's settings are in the top navbar while this screen shows) -->
        <div class="lxa-controls">
          <button type="button" class="lxa-ctl" data-act="captions" aria-label="Show captions" title="Captions"><i class="fas fa-closed-captioning"></i></button>
          <button type="button" class="lxa-ctl" data-act="type" aria-label="Type instead" title="Type"><i class="fas fa-keyboard"></i></button>
          <button type="button" class="lxa-mic" data-act="mic" aria-label="Talk to Lixa"><i class="fas fa-microphone"></i></button>
          <button type="button" class="lxa-ctl" data-act="skip" aria-label="Skip this sentence" title="Skip"><i class="fas fa-forward"></i></button>
          <button type="button" class="lxa-ctl" data-act="details" aria-label="Show details" title="Details"><i class="fas fa-list"></i></button>
        </div>
      </div>
      <div class="lxa-center">
        <div class="lxa-stage">
          <div class="lxa-figure">
            <div class="lxa-working" hidden></div>
            <canvas class="lxa-canvas" aria-label="Lixa"></canvas>
          </div>
          <div class="lxa-panel lxa-settings" hidden></div>
          <div class="lxa-panel lxa-details" hidden><div class="lxa-panel-head"><b>Details</b><button type="button" data-act="closepanel" aria-label="Close details"><i class="fas fa-times"></i></button></div><div class="lxa-details-body"></div></div>
          <!-- the captions (what she heard, and the hint line): put away until their button is tapped, like the details -->
          <div class="lxa-panel lxa-captions" hidden>
            <div class="lxa-caption"><span class="lxa-who">You</span><span class="lxa-heard"></span></div>
            <div class="lxa-hint" aria-live="polite"></div>
          </div>
        </div>
        <!-- what only the user can act on (her voice waiting for a connection, a problem) always shows -->
        <div class="lxa-alert" role="status" hidden></div>
        <form class="lxa-type" hidden><input type="text" placeholder="Type to Lixa…" aria-label="Type to Lixa" autocomplete="off"><button type="submit" aria-label="Send"><i class="fas fa-paper-plane"></i></button></form>
      </div>
      <div class="lxa-right">
        <div class="lxa-cards"></div>
      </div>`;
    document.body.appendChild(root);
    avatar = new window.LixaAgentAvatar(root.querySelector('.lxa-canvas'));
    avatar.source = () => {
      const v = session ? session.view : { state: 'Idle' };
      return {
        state: v.state, mouthOpen: v.mouth || 0, mouthShape: v.shape, viseme: v.viseme == null ? -1 : v.viseme, asking: v.asking, waving: v.waving, gentle: !!(v.talkMode && v.talkMode.kind === 'THERAPIST'),
        emotion: v.emotion || 'neutral', body: v.talkMode && v.talkMode.kind === 'PATIENT' ? (v.body || 'normal') : 'normal'
      };
    };

    if ('ResizeObserver' in window) new ResizeObserver(fitFigure).observe(root.querySelector('.lxa-stage'));
    // Desktop: three columns, and the settings / details panels sit in the right
    // column beside Lixa instead of over her. Phone: they open over the stage.
    const desk = window.matchMedia ? window.matchMedia('(min-width: 1024px) and (min-height: 560px)') : null;
    const arrange = () => {
      const on = !!(desk && desk.matches);
      root.classList.toggle('lxa-desktop', on);
      const home = root.querySelector(on ? '.lxa-right' : '.lxa-stage');
      ['.lxa-settings', '.lxa-details'].forEach(sel => {
        const p = root.querySelector(sel);
        if (!p || p.parentNode === home) return;
        if (on) home.insertBefore(p, home.firstChild); else home.appendChild(p);
      });
      fitFigure();
    };
    if (desk) { if (desk.addEventListener) desk.addEventListener('change', arrange); else if (desk.addListener) desk.addListener(arrange); }
    arrange();
    root.addEventListener('click', onClick);
    root.querySelector('.lxa-canvas').addEventListener('click', () => {
      if (!session) return;
      // Live: a tap stops her talking (she listens), or carries on after a pause
      if (session.live && session.live.on) { session.live.sound.unlock(); if (session.state === 'Speaking') session.live.stopHer(); else if (session.live.phase === 'paused') session.live.resume(); return; }
      session.voice.unlock(); if (session.state === 'Speaking') session.voice.skipSentence(); else if (!session.view.listening) session.listen();
    });
    root.querySelector('.lxa-type').addEventListener('submit', e => {
      e.preventDefault();
      const input = root.querySelector('.lxa-type input');
      if (session && input.value.trim()) { session.typed(input.value); input.value = ''; }
    });
    // Settings, details and captions close on any tap outside them (the settings button is in the navbar).
    document.addEventListener('pointerdown', e => {
      if (!panel || !root || root.hidden) return;
      const open = root.querySelector('.lxa-' + panel);
      const btn = panel === 'settings' ? settingsNavBtn : root.querySelector('[data-act="' + panel + '"]');
      if (open && !open.contains(e.target) && !(btn && btn.contains(e.target))) { panel = null; render(); }
    }, true);

    bubble = document.createElement('button');
    bubble.type = 'button';
    bubble.id = 'lixaAgentBubble';
    bubble.className = 'lxa-bubble';
    bubble.hidden = true;
    bubble.setAttribute('aria-label', 'Lixa Agent is running. Tap to bring her back.');
    bubble.innerHTML = '<canvas class="lxa-bubble-canvas"></canvas>';
    document.body.appendChild(bubble);
    bubbleAvatar = new window.LixaAgentAvatar(bubble.querySelector('canvas'));
    bubbleAvatar.source = avatar.source;
    dragBubble();

    window.addEventListener('resize', place);
    document.addEventListener('rehablix:routechange', () => { place(); render(); syncNavButton(); });
  }

  function onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b || !session) return;
    const act = b.dataset.act;
    const live = session.live;
    session.voice.unlock();
    if (live && live.on) live.sound.unlock();
    switch (act) {
      case 'min': minimize(); break;
      case 'close': close(); break;
      case 'standard': if (live) live.end(true); break;
      case 'live': if (live && !live.on) live.start(); break;
      case 'livestandard': live.prompt = null; render(); session.listen(); break;
      case 'liveupgrade': live.prompt = null; hostApi.open('#/subscription'); break;
      case 'mic':
        if (live && live.on) { live.toggleMic(); break; }
        if (session.view.listening) session.stopListening(); else session.listen(); break;
      case 'skip': if (session.state === 'Speaking') { if (live && live.on) live.stopHer(); else session.voice.skipSentence(); } break;
      case 'details': case 'captions': panel = panel === act ? null : act; render(); break;
      case 'closepanel': panel = null; render(); break;
      case 'type': { const f = root.querySelector('.lxa-type'); f.hidden = !f.hidden; if (!f.hidden) f.querySelector('input').focus(); break; }
      case 'endmode': session.endTalkMode(); break;
      case 'confirm': session.answerConfirm(true); break;
      case 'cancel': session.answerConfirm(false); break;
      case 'upgrade': session.set({ upgrade: false }); hostApi.open('#/subscription'); break;
      case 'notnow': session.set({ upgrade: false }); break;
      case 'keepasking': warnNoConfirm = false; render(); break;
      case 'stopasking': warnNoConfirm = false; session.setAutoApprove(true); render(); break;
      case 'login': { const l = document.getElementById('loginBtn'); if (l) l.click(); break; }
      case 'openfound': session.openFound(b.dataset.ref); break;
      case 'set': {
        const k = b.dataset.key, v = b.dataset.val;
        if (k === 'short') session.setShort(v === '1');
        if (k === 'muted') session.setMuted(v === '1');
        if (k === 'accent') session.setAccent(v);
        if (k === 'voice') session.setVoice(v);
        if (k === 'background') session.setBackground(v === '1');
        if (k === 'screen') { session.setKeepScreenOn(v === '1'); syncWakeLock(); }
        // turning confirmations off needs the warning first; turning them back on is immediate
        if (k === 'confirm') { if (v === '0') { if (!session.autoApprove) { warnNoConfirm = true; panel = null; } } else { warnNoConfirm = false; session.setAutoApprove(false); } render(); }
        break;
      }
    }
  }

  /** Below the navbar and above the bottom bar, whatever page is open. */
  function place() {
    if (!root) return;
    const nav = document.querySelector('.navbar');
    const top = nav ? Math.max(0, Math.round(nav.getBoundingClientRect().bottom)) : 0;
    const bn = document.querySelector('.app-bottom-nav');
    // (a fixed bar has no offsetParent, so its visibility is read from its style)
    const bottom = bn && !bn.hidden && getComputedStyle(bn).display !== 'none' ? Math.round(bn.getBoundingClientRect().height) : 0;
    root.style.top = top + 'px';
    root.style.bottom = bottom + 'px';
    fitFigure();
  }

  /** The mascot as large as the stage allows (never over the cards or the controls), in the kit's shape. */
  function fitFigure() {
    if (!root || root.hidden) return;
    const stage = root.querySelector('.lxa-stage'), fig = root.querySelector('.lxa-figure');
    // (the desktop's middle column has room for a much bigger Lixa)
    const cap = root.classList.contains('lxa-desktop') ? 900 : 560;
    const w = Math.max(60, Math.min(stage.clientWidth, cap, stage.clientHeight * 1736 / 1024));
    fig.style.width = Math.floor(w) + 'px';
    fig.style.height = Math.floor(w * 1024 / 1736) + 'px';
  }

  // ------------------------------------------------------------------ drawing the state
  function seg(key, options, current) {
    return '<div class="lxa-seg">' + options.map(([val, label]) => `<button type="button" data-act="set" data-key="${key}" data-val="${val}" class="${String(current) === val ? 'on' : ''}">${label}</button>`).join('') + '</div>';
  }

  // The settings panel is only rebuilt when what it shows changes (so the model
  // picker's popup keeps its place); the shared model picker goes in its slot.
  function setSettings(el, html) {
    if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
    const slot = el.querySelector('.lxa-model-slot');
    if (slot && !slot.firstChild && window.RehablixModelChoice) slot.appendChild(window.RehablixModelChoice.chip());
  }

  function render() {
    if (!root || !session) return;
    const v = session.view;
    const entry = map && map.entry(route());
    root.querySelector('.lxa-page span').textContent = entry ? entry.title : 'Lixa';

    const mode = root.querySelector('.lxa-mode');
    mode.hidden = !v.talkMode;
    if (v.talkMode) {
      const info = MODE_INFO[v.talkMode.kind];
      mode.querySelector('i').className = 'fas ' + info.icon;
      mode.querySelector('.lxa-mode-label').textContent = info.label;
      mode.querySelector('.lxa-mode-score').textContent = v.talkScore ? 'Score ' + v.talkScore : '';
    }

    const working = root.querySelector('.lxa-working');
    working.hidden = !(v.state === 'Working' && v.status);
    working.textContent = v.status || '';

    // settings
    const settings = root.querySelector('.lxa-settings');
    settings.hidden = panel !== 'settings';
    // (short rows in four small groups, as in the Android app)
    const voices = window.LixaAgentLive ? window.LixaAgentLive.VOICES : [[session.voice.herVoice, '']];
    if (panel === 'settings') setSettings(settings,
      `<div class="lxa-group">Voice</div>` +
      // one voice for Standard and Live (Leda by default, to suit her look)
      `<div class="lxa-row lxa-voices">${seg('voice', voices.map(([n, sound]) => [n, sound ? n + ' · ' + sound : n]), session.live ? session.live.voice : session.voice.herVoice)}</div>` +
      `<div class="lxa-row"><span>Accent</span>${seg('accent', [['us', 'US'], ['gb', 'UK'], ['au', 'AU'], ['in', 'India']], session.accent)}</div>` +
      `<div class="lxa-row"><span>Answers</span>${seg('short', [['0', 'Full'], ['1', 'Short']], session.shortAnswers ? '1' : '0')}</div>` +
      `<div class="lxa-row"><span>Her voice</span>${seg('muted', [['0', 'On'], ['1', 'Muted']], session.muted ? '1' : '0')}</div>` +
      `<div class="lxa-group">Work</div>` +
      (window.RehablixModelChoice ? `<div class="lxa-row"><span>SI model</span><span class="lxa-model-slot"></span></div>` +
        `<p class="lxa-small">Same model on every page.${session.live ? ' Live uses Gemini Live.' : ''}</p>` : '') +
      `<div class="lxa-row"><span>Ask before changes</span>${seg('confirm', [['1', 'On'], ['0', 'Off']], session.autoApprove ? '0' : '1')}</div>` +
      (session.autoApprove ? `<p class="lxa-small lxa-danger">Off: no Confirm card before she creates, edits or deletes.</p>` : '') +
      `<div class="lxa-group">Screen</div>` +
      `<div class="lxa-row"><span>Talk in the background</span>${seg('background', [['1', 'On'], ['0', 'Off']], session.background ? '1' : '0')}</div>` +
      `<div class="lxa-row"><span>Keep screen on</span>${seg('screen', [['1', 'On'], ['0', 'Off']], session.keepScreenOn ? '1' : '0')}</div>` +
      (session.live ? `<p class="lxa-small">Live minutes: ${esc(session.live.usage || (B().plan() === 'free' ? 'paid plans only' : '…'))}. In Live you can talk over her.</p>` : '') +
      (window.LixaAgentSession.canListen ? '' : `<p class="lxa-small">This browser can't listen. Use Chrome, Edge or Safari to talk to her, or type.</p>`));

    // details
    const details = root.querySelector('.lxa-details');
    details.hidden = panel !== 'details';
    if (panel === 'details') {
      const body = details.querySelector('.lxa-details-body');
      const text = v.details || v.reply || '';
      if (!text) body.innerHTML = '<p class="lxa-small">Nothing to show yet. Links, numbers and lists from her answers appear here, and every answer is in your Lixa chat.</p>';
      else if (window.marked && window.RehablixSanitize && window.RehablixSanitize.html) body.innerHTML = window.RehablixSanitize.html(window.marked.parse(text));
      else body.textContent = text;
    }

    // cards: login, upgrade, confirm, found
    let cards = '';
    if (!B().user()) cards += `<div class="lxa-card"><b>Log in to talk to Lixa</b><p class="lxa-small">Her answers are saved in your Lixa chat.</p><div class="lxa-card-actions"><button type="button" class="lxa-primary" data-act="login">Log in</button></div></div>`;
    if (v.upgrade) cards += `<div class="lxa-card"><b>You've used your free tokens</b><p class="lxa-small">Upgrade to keep talking to Lixa, or wait for your tokens to reset.</p><div class="lxa-card-actions"><button type="button" data-act="notnow">Not now</button><button type="button" class="lxa-primary" data-act="upgrade">Upgrade Plan</button></div></div>`;
    const lp = session.live && session.live.prompt;
    if (lp) cards += `<div class="lxa-card"><b>${esc(lp.title)}</b><p class="lxa-small">${esc(lp.text)}</p><div class="lxa-card-actions"><button type="button" data-act="livestandard">Continue in Standard</button>${lp.upgrade ? '<button type="button" class="lxa-primary" data-act="liveupgrade">Upgrade Plan</button>' : ''}</div></div>`;
    if (warnNoConfirm) cards += `<div class="lxa-card lxa-warn"><b>Stop asking before changes?</b><p class="lxa-small">Lixa will create, edit and delete things the moment you ask, with no Confirm card first. If she mishears you, she may change something you didn't want. You can turn it back on in her settings.</p><div class="lxa-card-actions"><button type="button" data-act="stopasking">Turn off</button><button type="button" class="lxa-primary" data-act="keepasking">Keep asking</button></div></div>`;
    // her plan for a job in several parts: every step, and how far it has got
    if (v.plan && v.plan.steps && v.plan.steps.length) cards += `<div class="lxa-card lxa-plan"><b>Lixa's plan</b><ol>${v.plan.steps.map((s, i) => `<li class="${esc(s.status || 'pending')}"><span class="lxa-step-mark">${s.status === 'done' ? '✓' : s.status === 'failed' ? '✕' : i + 1}</span><span>${esc(s.what)}</span>${s.risk && s.risk !== 'READ' ? '<small>change</small>' : ''}</li>`).join('')}</ol></div>`;
    if (v.confirm) cards += `<div class="lxa-card lxa-confirm"><b>${esc(v.confirm.text)}</b><div class="lxa-card-actions"><button type="button" data-act="cancel">Cancel</button><button type="button" class="lxa-primary" data-act="confirm">${v.confirm.plan ? 'Start' : 'Confirm'}</button></div></div>`;
    if (v.found && v.found.length) cards += `<div class="lxa-card lxa-found"><b>Found</b>${v.found.map(f => `<button type="button" class="lxa-found-row" data-act="openfound" data-ref="${esc(f.ref)}"><span>${esc(f.title)}</span><small>${esc(f.label)}${f.patient ? ' <i class="fas fa-lock" title="Patient data"></i>' : ''}</small></button>`).join('')}</div>`;
    const cardsEl = root.querySelector('.lxa-cards');
    if (cardsEl.dataset.html !== cards) { cardsEl.innerHTML = cards; cardsEl.dataset.html = cards; }

    // what she heard, and the hint line (in the captions panel); what only the user can act on, always in view
    const live = session.live && session.live.on ? session.live : null;
    const alert = v.waiting || v.note || (live && live.phase === 'connecting' ? 'Connecting to Live…' : '');
    const alertEl = root.querySelector('.lxa-alert');
    alertEl.hidden = !alert || panel === 'captions';
    alertEl.textContent = alert;
    root.querySelector('.lxa-captions').hidden = panel !== 'captions';
    const hint = v.waiting || v.note || (live ? (
      live.phase === 'connecting' ? 'Connecting to Live…' : live.micMuted ? 'Microphone off. Tap the mic to talk.' :
      v.state === 'Speaking' ? 'Just talk to interrupt her, or tap her to stop.' : v.state === 'Working' ? (v.status || '') :
      v.state === 'Listening' ? 'Listening… just talk.' + (live.minutesLeft != null ? ' · ' + live.minutesLeft + ' min of Live left' : '') :
      live.minutesLeft != null ? 'Live · ' + live.minutesLeft + ' min left' : '') :
      (v.state === 'Listening' ? 'Listening…' : v.state === 'Thinking' ? (v.status || 'Thinking…') : ''));
    const heardEl = root.querySelector('.lxa-heard');
    const heardText = v.heard || (live ? (v.state === 'Listening' ? 'Listening… just talk.' : '…') : window.LixaAgentSession.canListen ? 'Tap the mic or Lixa to talk.' : 'Type below to talk to Lixa.');
    // one line that follows the words as they come (and can be scrolled back by hand)
    if (heardEl.textContent !== heardText) { heardEl.textContent = heardText; heardEl.scrollLeft = heardEl.scrollWidth; }
    root.querySelector('.lxa-hint').textContent = hint;
    // (Live: no caption of what the user says, at the user's request; the hint line stays)
    root.querySelector('.lxa-caption').hidden = !!live;
    // Standard | Live, and the red sign while Live hears the microphone
    root.querySelectorAll('.lxa-switch button').forEach(btn => { const on = (btn.dataset.act === 'live') === !!live; btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    const micLive = !!(live && live.micLive);
    root.querySelector('.lxa-miclive').hidden = !micLive;
    if (bubble) bubble.classList.toggle('mic-live', micLive);
    const mic = root.querySelector('.lxa-mic');
    if (live) {
      mic.classList.toggle('on', false);
      mic.classList.toggle('live', micLive);
      mic.querySelector('i').className = 'fas ' + (live.micMuted ? 'fa-microphone-slash' : 'fa-microphone');
      mic.setAttribute('aria-label', micLive ? 'Turn the microphone off' : live.phase === 'paused' ? 'Carry on with Live' : 'Turn the microphone on');
      mic.disabled = false;
    } else {
      mic.classList.toggle('live', false);
      mic.classList.toggle('on', !!v.listening);
      mic.querySelector('i').className = 'fas fa-microphone';
      mic.setAttribute('aria-label', v.listening ? 'Stop listening' : 'Talk to Lixa');
      mic.disabled = !window.LixaAgentSession.canListen;
    }
    root.querySelector('[data-act="skip"]').disabled = v.state !== 'Speaking';
    if (settingsNavBtn) settingsNavBtn.classList.toggle('on', panel === 'settings');
    const cc = root.querySelector('[data-act="captions"]');
    cc.classList.toggle('on', panel === 'captions');
    cc.setAttribute('aria-label', panel === 'captions' ? 'Hide captions' : 'Show captions');
    root.querySelector('[data-act="details"]').classList.toggle('on', panel === 'details');
    if (!window.LixaAgentSession.canListen) root.querySelector('.lxa-type').hidden = false;
    syncNavButton();
  }

  // ------------------------------------------------------------------ open, background, close
  function ensureSession() {
    if (!root) build();
    if (!session) {
      session = new window.LixaAgentSession(hostApi);
      B().loadMap().then(m => { map = m; render(); });
    }
  }

  function open() {
    ensureSession();
    const first = !active;
    active = true; showing = true;
    root.hidden = false; bubble.hidden = true;
    document.body.classList.add('lxa-open');
    place(); render();
    avatar.start();
    if (first) session.open();
    else if (session.handsFree && session.state === 'Idle') session.listen();
    syncWakeLock();
  }
  function minimize() {
    if (!active) return;
    showing = false; panel = null;
    root.hidden = true; bubble.hidden = false;
    document.body.classList.remove('lxa-open');
    placeBubble(); bubbleAvatar.start();
    render();
  }
  function close() {
    if (session) { session.release(); session = null; }
    active = false; showing = false; panel = null;
    if (root) root.hidden = true;
    if (bubble) bubble.hidden = true;
    document.body.classList.remove('lxa-open');
    syncNavButton();
    syncWakeLock();
  }
  function toggle() { if (showing) minimize(); else open(); }

  // ------------------------------------------------------------------ the bubble (drag anywhere; a tap brings her back)
  function placeBubble() {
    if (!bubble) return;
    const w = window.innerWidth, h = window.innerHeight;
    const bw = bubble.offsetWidth || 120, bh = bubble.offsetHeight || 84;
    const x = bubblePos ? Math.min(w - bw - 8, Math.max(8, bubblePos.x * w)) : w - bw - 16;
    const y = bubblePos ? Math.min(h - bh - 8, Math.max(8, bubblePos.y * h)) : h - bh - 96;
    bubble.style.left = x + 'px'; bubble.style.top = y + 'px';
  }
  function dragBubble() {
    let start = null, moved = false;
    bubble.addEventListener('pointerdown', e => { start = { x: e.clientX, y: e.clientY, l: bubble.offsetLeft, t: bubble.offsetTop }; moved = false; bubble.setPointerCapture(e.pointerId); });
    bubble.addEventListener('pointermove', e => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      moved = true;
      bubble.style.left = Math.min(window.innerWidth - bubble.offsetWidth - 8, Math.max(8, start.l + dx)) + 'px';
      bubble.style.top = Math.min(window.innerHeight - bubble.offsetHeight - 8, Math.max(8, start.t + dy)) + 'px';
    });
    bubble.addEventListener('pointerup', () => {
      if (!start) return;
      start = null;
      if (moved) {
        bubblePos = { x: bubble.offsetLeft / window.innerWidth, y: bubble.offsetTop / window.innerHeight };
        try { localStorage.setItem('rehab-agent-bubble', JSON.stringify(bubblePos)); } catch (e) { /* ignore */ }
      } else open();
    });
    window.addEventListener('resize', () => { if (!bubble.hidden) placeBubble(); });
  }

  // ------------------------------------------------------------------ the ways in: navbar icon, Lixa logo, empty Send
  function lixaChatEmpty() {
    const box = document.getElementById('chatMessages');
    return !!(box && box.querySelector('.empty-chat') && !box.querySelector('.message'));
  }
  /** Hidden while the agent screen is showing, and on Lixa's empty new-chat screen (the logo there opens her) unless she is running. */
  function syncNavButton() {
    if (!navBtn) return;
    navBtn.hidden = showing || (route() === 'lixa' && lixaChatEmpty() && !active);
    // her settings take the agent icon's place in the navbar while the agent screen shows
    if (settingsNavBtn) settingsNavBtn.hidden = !showing;
  }

  /** Keep screen on: the screen stays on while agent mode is open (the browser lets go while the page is hidden). */
  async function syncWakeLock() {
    const want = active && session && session.keepScreenOn && !document.hidden && navigator.wakeLock;
    if (want && !wakeLock) {
      try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } catch (e) { wakeLock = null; }
      if (!(active && session && session.keepScreenOn) && wakeLock) { const w = wakeLock; wakeLock = null; w.release().catch(() => {}); }
    } else if (!want && wakeLock) { const w = wakeLock; wakeLock = null; try { await w.release(); } catch (e) { /* already let go */ } }
  }
  document.addEventListener('visibilitychange', () => { syncWakeLock(); });
  function addNavButton() {
    const right = document.getElementById('navRight');
    if (!right || document.getElementById('lixaAgentNavBtn')) return;
    navBtn = document.createElement('button');
    navBtn.type = 'button';
    navBtn.id = 'lixaAgentNavBtn';
    navBtn.className = 'icon-btn lxa-nav-btn';
    navBtn.setAttribute('aria-label', 'Lixa Agent');
    navBtn.title = 'Talk to Lixa (agent mode)';
    navBtn.innerHTML = '<img src="img/lixa/icon_head.png" alt="" width="26" height="26">';
    const theme = document.getElementById('themeToggle');
    right.insertBefore(navBtn, theme || null);
    navBtn.addEventListener('click', toggle);
    // Lixa's settings, in the same place, while the agent screen shows
    settingsNavBtn = document.createElement('button');
    settingsNavBtn.type = 'button';
    settingsNavBtn.id = 'lixaAgentSettingsBtn';
    settingsNavBtn.className = 'icon-btn lxa-nav-btn lxa-nav-settings';
    settingsNavBtn.setAttribute('aria-label', "Lixa's settings");
    settingsNavBtn.title = "Lixa's settings";
    settingsNavBtn.innerHTML = '<i class="fas fa-sliders-h" aria-hidden="true"></i>';
    settingsNavBtn.hidden = true;
    right.insertBefore(settingsNavBtn, theme || null);
    settingsNavBtn.addEventListener('click', () => {
      if (!session || !showing) return;
      panel = panel === 'settings' ? null : 'settings';
      if (panel === 'settings' && session.live) session.live.refreshUsage();
      render();
    });
    syncNavButton();
    // the new-chat screen comes and goes with the chat's messages
    const watch = () => {
      const box = document.getElementById('chatMessages');
      if (!box || box.dataset.lxaWatched) return;
      box.dataset.lxaWatched = '1';
      new MutationObserver(syncNavButton).observe(box, { childList: true });
    };
    watch();
    document.addEventListener('rehablix:routechange', () => { watch(); syncNavButton(); });
  }

  document.addEventListener('click', e => {
    // the Lixa logo on the empty new-chat screen
    if (e.target.closest && e.target.closest('#chatMessages .empty-chat-icon')) { toggle(); return; }
  });
  document.addEventListener('click', e => {
    // Send with nothing typed and nothing attached (the chat itself does nothing then)
    const send = e.target.closest && e.target.closest('#sendBtn');
    if (!send || send.disabled) return;
    const input = document.getElementById('messageInput');
    const strip = document.getElementById('attachmentsStrip');
    if (input && !input.value.trim() && (!strip || strip.hidden || !strip.children.length)) open();
  }, true);

  function boot() { addNavButton(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  // (session: for tests and debugging in the browser console only)
  window.LixaAgentMode = { open, close, minimize, toggle, isActive: () => active, isShowing: () => showing, session: () => session };
})();
