// js/workspace.js — the "workspace" SPA view: tool search/filter, plan
// card rendering, FAQ accordion, the footer star-rating feedback form, and
// (merged in from the old js/index-center.js) the center/workspace context
// banner + workspace switcher. Registered with js/router.js.

(function () {
  let cleanupFns = [];
  // Assigned inside mount() (needs its closure) but exposed from this outer
  // scope — see window.RehablixViews.workspace.
  let onShow = function () {};

  function mount() {
    const toolGrid = document.getElementById('toolGrid');
    const moreToolsGridEl = document.getElementById('moreToolsGrid');
    const emptyMessage = document.getElementById('emptyMessage');
    const searchInput = document.getElementById('searchInput');
    const searchToggle = document.getElementById('searchToggle');
    const moreToolsToggle = document.getElementById('moreToolsToggle');
    const moreToolsGrid = document.getElementById('moreToolsGrid');

    // Workspace personalization (item 1b): "more tools" is expanded by
    // default now, so the original reason for scoping search to #toolGrid
    // only (its cards would "match" while staying hidden behind the
    // collapsed toggle) no longer applies — search covers every card.
    function getToolCards() {
      return document.querySelectorAll('#toolGrid .tool-card-link, #moreToolsGrid .tool-card-link');
    }

    function filterTools(searchText) {
      const searchTerm = searchText.trim().toLowerCase();
      let visibleCount = 0;
      getToolCards().forEach(card => {
        const title = card.querySelector('.tool-title').textContent.toLowerCase();
        const description = card.querySelector('.tool-description').textContent.toLowerCase();
        const meta = card.querySelector('.tool-meta').textContent.toLowerCase();
        const matches = searchTerm === '' || title.includes(searchTerm) || description.includes(searchTerm) || meta.includes(searchTerm);
        card.style.display = matches ? 'block' : 'none';
        if (matches) visibleCount++;
      });
      if (emptyMessage) emptyMessage.classList.toggle('hidden', visibleCount !== 0);
    }

    // Workspace personalization (item 1c, refined): Smart EMR/Motion/
    // Project Maker are core tools that must never leave the always-visible
    // grid, so only the 4th slot is actually competitive — the single
    // most-used tool among everything else, by the same per-user counts
    // js/tool-usage.js tracks. Redistributes by moving the existing DOM
    // nodes (not rewriting them), so nothing about the cards changes.
    const PINNED_TOOLS = ['documentation', 'rom', 'project']; // Smart EMR, Motion, Project Maker
    const RANKING_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // refined: re-rank at most once/day, not on every visit

    function computeOrder(cards, usage) {
      const nonPinned = cards.filter(c => !PINNED_TOOLS.includes(c.dataset.tool));
      const ranked = nonPinned
        .map((card, index) => ({ tool: card.dataset.tool, index, count: usage[card.dataset.tool] || 0 }))
        .sort((a, b) => (b.count - a.count) || (a.index - b.index))
        .map(r => r.tool);
      return [...PINNED_TOOLS, ...ranked];
    }

    function applyOrder(cards, order) {
      // Skip entirely if this is already the on-screen order. appendChild()
      // detaches+reattaches a node even when "moving" it to the same spot,
      // which is what caused the tool grid to visibly flicker/"reload" on
      // every workspace revisit — onShow() calls this on every visit, but
      // the cached order is normally unchanged within the same 24h window.
      const currentOrder = cards.map(c => c.dataset.tool);
      const unchanged = currentOrder.length === order.length && currentOrder.every((tool, i) => tool === order[i]);
      if (unchanged) return;

      const byTool = new Map(cards.map(c => [c.dataset.tool, c]));
      order.forEach((tool, i) => {
        const card = byTool.get(tool);
        if (card) (i < 4 ? toolGrid : moreToolsGridEl).appendChild(card);
      });
    }

    async function applyUsageRanking() {
      if (!window.RehablixToolUsage || !toolGrid || !moreToolsGridEl) return;
      const user = firebase.auth().currentUser;
      if (!user) return;
      const cards = Array.from(getToolCards());

      try {
        const cacheRef = firebase.database().ref(`users/${user.uid}/toolRankingCache`);
        const cacheSnap = await cacheRef.once('value');
        const cache = cacheSnap.val();
        const now = Date.now();
        if (cache && cache.computedAt && Array.isArray(cache.order) && (now - cache.computedAt) < RANKING_CACHE_TTL_MS) {
          applyOrder(cards, cache.order);
          return;
        }
        const usage = await window.RehablixToolUsage.getUsage(user.uid);
        const order = computeOrder(cards, usage || {});
        applyOrder(cards, order);
        await cacheRef.set({ computedAt: now, order });
      } catch (e) {
        // Best-effort personalization — leave the curated order alone on any failure.
      }
    }

    if (searchInput) {
      searchInput.addEventListener('input', (e) => filterTools(e.target.value));
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const value = searchInput.value.trim();
          if (value) window.location.href = 'index.html?q=' + encodeURIComponent(value);
        }
      });
    }
    if (searchToggle && searchInput) {
      searchToggle.addEventListener('click', () => searchInput.focus());
    }

    // ----- "More tools" collapsible section -----
    if (moreToolsToggle && moreToolsGrid) {
      moreToolsToggle.addEventListener('click', () => {
        const willOpen = moreToolsGrid.hidden;
        moreToolsGrid.hidden = !willOpen;
        moreToolsToggle.setAttribute('aria-expanded', String(willOpen));
        moreToolsToggle.classList.toggle('open', willOpen);
      });
    }

    // ----- FAQ accordion: one open at a time -----
    document.querySelectorAll('.faq-item').forEach(item => {
      item.addEventListener('toggle', function () {
        if (this.open) {
          document.querySelectorAll('.faq-item').forEach(other => { if (other !== this) other.open = false; });
        }
      });
    });

    // ----- Current plan card -----
    function updatePlanCard() {
      const card = document.getElementById('planGlassCard');
      const section = document.getElementById('currentPlanSection');
      if (!card || !section) return;
      section.style.display = 'block';

      const badge = document.getElementById('planStatusBadge');
      const nameDisplay = document.getElementById('planNameDisplay');
      const descDisplay = document.getElementById('planDescriptionDisplay');
      const iconLarge = document.querySelector('.plan-icon-large');
      const upgradeBtn = document.getElementById('planUpgradeBtn');
      const expiryDiv = document.getElementById('planExpiry');
      const expiryDate = document.getElementById('planExpiryDate');
      const expiryDays = document.getElementById('planExpiryDays');
      const renewalBadge = document.getElementById('planRenewalBadge');

      const plan = window.rehabPlans ? window.rehabPlans.getCurrentPlan() : 'free';
      const config = {
        free: { icon: '🚀', name: 'No Active Plan', desc: 'Basic access with monthly usage limits — subscribe to unlock more', badgeClass: 'free', btnText: 'Upgrade Plan' },
        student: { icon: '🎓', name: 'Basic Plan', desc: 'Full access for healthcare students', badgeClass: 'student', btnText: 'Upgrade to Pro' },
        pro: { icon: '💎', name: 'Pro Plan', desc: 'Unlimited everything for professionals', badgeClass: 'pro', btnText: 'Manage Plan' },
        max: { icon: '♾️', name: 'Max Plan', desc: 'Everything in Pro, with the highest usage ceiling', badgeClass: 'max', btnText: 'Manage Plan' }
      };
      const planConfig = config[plan] || config.free;

      if (badge) { badge.textContent = planConfig.name; badge.className = `plan-status-badge ${planConfig.badgeClass}`; }
      if (iconLarge) iconLarge.textContent = planConfig.icon;
      if (nameDisplay) nameDisplay.textContent = planConfig.name;
      if (descDisplay) descDisplay.textContent = planConfig.desc;
      if (upgradeBtn) { const t = upgradeBtn.querySelector('.btn-text'); if (t) t.textContent = planConfig.btnText; }

      if (plan !== 'free') {
        const user = firebase.auth().currentUser;
        if (user) {
          firebase.database().ref(`users/${user.uid}/subscription`).once('value').then(snap => {
            const sub = snap.val();
            if (sub && sub.ends) {
              const endDate = new Date(sub.ends);
              const diffDays = Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24));
              if (expiryDiv) expiryDiv.style.display = 'flex';
              if (expiryDate) expiryDate.textContent = endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
              if (expiryDays) {
                expiryDays.textContent = diffDays > 0 ? `${diffDays} days left` : 'Expired';
                expiryDays.style.background = diffDays <= 7 && diffDays > 0 ? '#fef3c7' : '#fef2f2';
                expiryDays.style.color = diffDays <= 7 && diffDays > 0 ? '#92400e' : '#dc2626';
              }
            } else if (expiryDiv) expiryDiv.style.display = 'none';
            if (renewalBadge) renewalBadge.style.display = 'inline-flex';
          }).catch(() => {
            if (expiryDiv) expiryDiv.style.display = 'none';
            if (renewalBadge) renewalBadge.style.display = 'none';
          });
        }
      } else {
        if (expiryDiv) expiryDiv.style.display = 'none';
        if (renewalBadge) renewalBadge.style.display = 'none';
      }
    }
    const onPlanUpdated = () => updatePlanCard();
    document.addEventListener('planUpdated', onPlanUpdated);
    cleanupFns.push(() => document.removeEventListener('planUpdated', onPlanUpdated));
    setTimeout(updatePlanCard, 500);
    if (typeof firebase !== 'undefined') {
      const unsubPlan = firebase.auth().onAuthStateChanged(() => { setTimeout(updatePlanCard, 500); applyUsageRanking(); });
      cleanupFns.push(unsubPlan);
    }

    // ----- Footer feedback form -----
    const starsWrap = document.getElementById('feedbackStars');
    const commentEl = document.getElementById('feedbackComment');
    const submitBtn = document.getElementById('feedbackSubmitBtn');
    const thanksEl = document.getElementById('feedbackThanks');
    let selectedRating = 0;

    if (starsWrap) {
      const stars = Array.from(starsWrap.querySelectorAll('.feedback-star'));
      function paintStars(value) {
        stars.forEach(s => s.classList.toggle('selected', parseInt(s.dataset.value, 10) <= value));
      }
      stars.forEach(star => {
        star.addEventListener('mouseenter', () => {
          stars.forEach(s => s.classList.toggle('hovered', parseInt(s.dataset.value, 10) <= parseInt(star.dataset.value, 10)));
        });
        star.addEventListener('mouseleave', () => stars.forEach(s => s.classList.remove('hovered')));
        star.addEventListener('click', () => {
          selectedRating = parseInt(star.dataset.value, 10);
          paintStars(selectedRating);
        });
      });
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', async () => {
        if (selectedRating === 0) {
          if (typeof showToast === 'function') showToast('Pick a star rating first', 'error');
          return;
        }
        const user = typeof firebase !== 'undefined' ? firebase.auth().currentUser : null;
        submitBtn.disabled = true;
        try {
          if (user) {
            await firebase.database().ref(`feedback/${user.uid}`).push({
              rating: selectedRating,
              comment: (commentEl && commentEl.value.trim()) || '',
              createdAt: firebase.database.ServerValue.TIMESTAMP
            });
          }
          thanksEl.hidden = false;
          document.getElementById('feedbackFooter').querySelectorAll('.feedback-stars, .feedback-comment, .feedback-submit-btn').forEach(el => el.style.display = 'none');
        } catch (err) {
          console.error('Feedback save failed:', err);
          submitBtn.disabled = false;
        }
      });
    }

    // =========================================================================
    // Center/workspace context (merged from the old js/index-center.js):
    // "Welcome to {center}" banner, per-tool visibility gating, and the
    // navbar workspace switcher. The switcher markup lives in this view's template
    // but visually belongs in the shared navbar — relocate it into the
    // shell's #navbarViewSlot, same pattern as ask.js's new-chat button.
    // =========================================================================
    const banner = document.getElementById('centerContextBanner');
    const switcherWrap = document.getElementById('workspaceSwitcher');
    const switcherBtn = document.getElementById('workspaceSwitcherBtn');
    const switcherLabel = document.getElementById('workspaceSwitcherLabel');
    const switcherMenu = document.getElementById('workspaceSwitcherMenu');
    const navbarSlot = document.getElementById('navbarViewSlot');
    if (navbarSlot && switcherWrap) navbarSlot.appendChild(switcherWrap);

    const CARD_TOOL_MAP = {
      documentation: 'doc', audio: 'audio', rom: 'rom', presentation: 'presentation',
      assignment: 'assignment', project: 'project', study: 'study', exam: 'exam'
    };

    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str == null ? '' : String(str);
      return div.innerHTML;
    }

    function applyToolVisibility(ctx) {
      document.querySelectorAll('.tool-card-link').forEach(card => {
        const permKey = CARD_TOOL_MAP[card.getAttribute('data-tool')];
        let visible = true;
        if (permKey && ctx.isActiveContextCenter && ctx.centerId !== ctx.ownCenterId) {
          visible = !(ctx.permissions && ctx.permissions[permKey] === false);
        }
        card.style.display = visible ? '' : 'none';
      });
    }

    function showWelcomeBanner(centerName) {
      if (!banner) return;
      banner.style.display = 'block';
      banner.innerHTML = `🏢 Welcome to <strong>${escapeHtml(centerName)}</strong>`;
    }
    function hideWelcomeBanner() {
      if (!banner) return;
      banner.style.display = 'none';
      banner.innerHTML = '';
    }

    async function renderSwitcher(ctx) {
      if (!switcherWrap) return;
      const options = await window.RehablixCenter.getAvailableContexts();
      if (options.length <= 1) { switcherWrap.style.display = 'none'; return; }

      switcherWrap.style.display = 'block';
      const current = options.find(o => o.id === ctx.activeContext) || options[0];
      if (switcherLabel) switcherLabel.textContent = current.label;

      switcherMenu.innerHTML = options.map(o => `
        <button type="button" class="workspace-option ${o.id === ctx.activeContext ? 'active' : ''}" data-context="${o.id}">
          <span class="workspace-option-icon">${o.type === 'individual' ? '👤' : o.type === 'owner' ? '👑' : '🏥'}</span>
          <span>${escapeHtml(o.label)}</span>
          ${o.id === ctx.activeContext ? '<span class="workspace-option-check">✓</span>' : ''}
        </button>
      `).join('');

      switcherMenu.querySelectorAll('.workspace-option').forEach(btn => {
        btn.addEventListener('click', async () => {
          const contextId = btn.getAttribute('data-context');
          if (contextId === ctx.activeContext) { switcherMenu.classList.remove('open'); return; }
          try {
            await window.RehablixCenter.switchActiveContext(contextId);
            window.location.reload();
          } catch (err) {
            console.error('Could not switch workspace:', err);
          }
        });
      });
    }

    if (switcherBtn) switcherBtn.addEventListener('click', () => switcherMenu.classList.toggle('open'));
    const onDocClickCloseSwitcher = (e) => {
      if (switcherWrap && !switcherWrap.contains(e.target)) switcherMenu?.classList.remove('open');
    };
    document.addEventListener('click', onDocClickCloseSwitcher);
    cleanupFns.push(() => document.removeEventListener('click', onDocClickCloseSwitcher));

    let centerInitTimer = null;
    async function initCenterContext() {
      if (!window.RehablixCenter) { centerInitTimer = setTimeout(initCenterContext, 150); return; }
      const ctx = await window.RehablixCenter.getContext();
      if (!ctx.loggedIn) { hideWelcomeBanner(); return; }
      if (ctx.isActiveContextCenter) showWelcomeBanner(ctx.activeCenterName || 'your center');
      else hideWelcomeBanner();
      applyToolVisibility(ctx);
      renderSwitcher(ctx);
    }
    cleanupFns.push(() => { if (centerInitTimer) clearTimeout(centerInitTimer); });
    const unsubCenterAuth = firebase.auth().onAuthStateChanged(() => initCenterContext());
    cleanupFns.push(unsubCenterAuth);

    // Workspace is kept alive by js/router.js — mount() only runs on the
    // first visit. Every later visit calls onShow() instead: re-attach the
    // switcher (the router clears #navbarViewSlot on every navigation) and
    // refresh its content, without re-running the rest of mount() or losing
    // scroll position/search text/anything else already on screen.
    onShow = function () {
      if (navbarSlot && switcherWrap) navbarSlot.appendChild(switcherWrap);
      initCenterContext();
      applyUsageRanking(); // item 1c — counts may have changed since the tab was last shown
    };
  }

  function unmount() {
    cleanupFns.forEach(fn => { try { fn(); } catch (e) { /* best-effort */ } });
    cleanupFns = [];
  }

  window.RehablixViews = window.RehablixViews || {};
  window.RehablixViews.workspace = { mount, unmount, onShow: () => onShow() };
})();
