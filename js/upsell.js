// js/upsell.js — one strip just below the top navbar, showing the one thing that matters most for this person now:
//
//  1. "Verify your email"        email/password accounts made after the cutoff (appConfig/ai verifyEmailFrom) whose
//                                email is not verified yet: until then the SI works at the visitor level (server rule).
//  2. "Sign in free"             visitors: on the Workspace, and after their second SI request.
//  3. "Get more with Rehablix Pro"  signed-in Free accounts. Gone once they send a prompt or use a tool (a request the
//                                person started: a click or key press just before it), or close it; back when the app
//                                is opened again (kept per browser tab session).
//
// Each can be closed for the rest of the session. Android: ui/shell/UpsellStrip.kt, the same rules.
(function () {
  if (window.RehablixUpsell) return;
  const KEY = { pro: 'rx-upsell-pro-off', guest: 'rx-upsell-guest-off', verify: 'rx-upsell-verify-off' };
  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return mem[k] || null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { mem[k] = v; } }
  };
  const mem = {};
  let guestAsks = 0;
  let el = null;

  function user() { try { return firebase.auth().currentUser; } catch (e) { return null; } }
  function plan() { return (window.rehabPlans && window.rehabPlans.getCurrentPlan && window.rehabPlans.getCurrentPlan()) || null; }
  function route() { return (document.body && document.body.dataset.route) || ''; }
  /** An email account that must verify (made after the cutoff, not verified yet). */
  function mustVerify(u) {
    if (!u || u.emailVerified) return false;
    if (!(u.providerData || []).some(p => p && p.providerId === 'password')) return false;
    const from = window.RehablixPlanConfig ? Date.parse(window.RehablixPlanConfig.aiSettings().verifyEmailFrom) : Date.parse('2026-10-28T00:00:00Z');
    const made = Date.parse((u.metadata && u.metadata.creationTime) || '') || 0;
    return made >= from;
  }

  function ensure() {
    if (el) return el;
    const style = document.createElement('style');
    style.textContent = `
      #rxUpsell { margin:-2px 10px 8px; border-radius:12px; padding:10px 12px 10px 14px; display:flex; align-items:center; gap:12px;
        font-size:.86rem; line-height:1.35; color:#fff; box-shadow:0 8px 22px -12px rgba(0,105,92,.6); animation:rxUpsellIn .25s ease; position:relative; z-index:19; }
      #rxUpsell[hidden] { display:none; }
      #rxUpsell.pro { background:linear-gradient(120deg,#00796b 0%,#009688 45%,#26a69a 100%); }
      #rxUpsell.guest { background:linear-gradient(120deg,#37474f 0%,#455a64 50%,#546e7a 100%); }
      #rxUpsell.verify { background:linear-gradient(120deg,#b45309 0%,#d97706 100%); }
      #rxUpsell .rx-up-icon { font-size:1.2rem; flex:none; }
      #rxUpsell .rx-up-text { flex:1; min-width:0; }
      #rxUpsell .rx-up-text b { font-weight:700; }
      #rxUpsell .rx-up-text span { opacity:.92; }
      #rxUpsell .rx-up-btn { flex:none; border:none; border-radius:999px; padding:7px 14px; font:inherit; font-size:.8rem; font-weight:700; cursor:pointer;
        background:#fff; color:#00695c; white-space:nowrap; }
      #rxUpsell.guest .rx-up-btn { color:#37474f; } #rxUpsell.verify .rx-up-btn { color:#92400e; }
      #rxUpsell .rx-up-btn.ghost { background:rgba(255,255,255,.18); color:#fff; }
      #rxUpsell .rx-up-x { flex:none; background:none; border:none; color:#fff; opacity:.8; font-size:1.2rem; line-height:1; cursor:pointer; padding:2px 4px; }
      @keyframes rxUpsellIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:none; } }
      @media (max-width: 520px) { #rxUpsell .rx-up-text span { display:none; } }`;
    document.head.appendChild(style);
    el = document.createElement('div');
    el.id = 'rxUpsell';
    el.hidden = true;
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Account notice');
    const nav = document.querySelector('nav.navbar');
    if (nav && nav.parentNode) nav.parentNode.insertBefore(el, nav.nextSibling); else document.body.insertBefore(el, document.body.firstChild);
    return el;
  }

  function paint(kind, icon, html, buttons) {
    const box = ensure();
    box.className = kind;
    box.innerHTML = '';
    const i = document.createElement('span'); i.className = 'rx-up-icon'; i.textContent = icon; i.setAttribute('aria-hidden', 'true');
    const t = document.createElement('div'); t.className = 'rx-up-text'; t.innerHTML = html;
    box.appendChild(i); box.appendChild(t);
    buttons.forEach(b => {
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'rx-up-btn' + (b.ghost ? ' ghost' : ''); btn.textContent = b.label;
      btn.addEventListener('click', b.run);
      box.appendChild(btn);
    });
    const x = document.createElement('button'); x.type = 'button'; x.className = 'rx-up-x'; x.setAttribute('aria-label', 'Close'); x.textContent = '×';
    x.addEventListener('click', () => { ss.set(KEY[kind], '1'); refresh(); });
    box.appendChild(x);
    box.hidden = false;
  }
  function hide() { if (el) el.hidden = true; }

  const signIn = () => { const b = document.getElementById('loginBtn'); if (b) b.click(); };
  const goPlans = () => { if (window.RehablixRouter) window.RehablixRouter.go('index.html#/subscription'); else location.href = 'index.html#/subscription'; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function refresh() {
    const u = user();
    if (route() === 'subscription') { hide(); return; }
    if (u && mustVerify(u)) {
      if (ss.get(KEY.verify)) { hide(); return; }
      paint('verify', '✉️', `<b>Verify your email to unlock everything.</b> <span>We sent a link to ${esc(u.email)}.</span>`, [
        { label: 'Resend', ghost: true, run: () => window.RehablixQuotaModal && window.RehablixQuotaModal.resendVerification() },
        { label: 'I\'ve verified', run: async () => { if (window.RehablixQuotaModal && await window.RehablixQuotaModal.checkVerified()) refresh(); } }
      ]);
      return;
    }
    if (!u) {
      if (ss.get(KEY.guest) || !(route() === 'workspace' || guestAsks >= 2)) { hide(); return; }
      paint('guest', '🔓', '<b>Sign in free to get more.</b> <span>Image analysis, Medulla 200, Motion AI, transcription and your saved history.</span>', [{ label: 'Sign in free', run: signIn }]);
      return;
    }
    if (plan() === 'free' && !ss.get(KEY.pro)) {
      paint('pro', '✨', '<b>Get more with Rehablix Pro</b> <span>— Blix 360, unlimited image analysis, Medulla 200, more web search and transcription.</span>', [{ label: 'See Pro', run: goPlans }]);
      return;
    }
    hide();
  }

  // a prompt sent or a tool used by the person (not a request the app makes on its own)
  window.addEventListener('rehablix:ai-used', () => {
    const started = !navigator.userActivation || navigator.userActivation.isActive;
    if (!started) return;
    if (user()) { if (plan() === 'free' && !ss.get(KEY.pro)) { ss.set(KEY.pro, '1'); refresh(); } }
    else { guestAsks++; if (guestAsks === 2) refresh(); }
  });
  document.addEventListener('planUpdated', refresh);
  document.addEventListener('rehablix:email-verified', refresh);
  window.addEventListener('hashchange', () => setTimeout(refresh, 50));
  if (window.RehablixPlanConfig) window.RehablixPlanConfig.onChange(refresh);
  function start() {
    try { firebase.auth().onAuthStateChanged(() => refresh()); } catch (e) { refresh(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.RehablixUpsell = { refresh, mustVerify };
})();
