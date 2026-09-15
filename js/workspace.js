// js/workspace.js — Workspace page: tool search/filter (migrated from the
// old homepage's main.js), plan card rendering, FAQ accordion, and the
// footer star-rating feedback form (writes to feedback/{uid}/{pushId}).

document.addEventListener('DOMContentLoaded', function () {
  const toolCards = document.querySelectorAll('.tool-card-link');
  const emptyMessage = document.getElementById('emptyMessage');
  const searchInput = document.getElementById('searchInput');
  const searchToggle = document.getElementById('searchToggle');

  function filterTools(searchText) {
    const searchTerm = searchText.trim().toLowerCase();
    let visibleCount = 0;
    toolCards.forEach(card => {
      const title = card.querySelector('.tool-title').textContent.toLowerCase();
      const description = card.querySelector('.tool-description').textContent.toLowerCase();
      const meta = card.querySelector('.tool-meta').textContent.toLowerCase();
      const matches = searchTerm === '' || title.includes(searchTerm) || description.includes(searchTerm) || meta.includes(searchTerm);
      card.style.display = matches ? 'block' : 'none';
      if (matches) visibleCount++;
    });
    if (emptyMessage) emptyMessage.classList.toggle('hidden', visibleCount !== 0);
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

  // ----- FAQ accordion: one open at a time -----
  document.querySelectorAll('.faq-item').forEach(item => {
    item.addEventListener('toggle', function () {
      if (this.open) {
        document.querySelectorAll('.faq-item').forEach(other => { if (other !== this) other.open = false; });
      }
    });
  });

  // ----- Current plan card (same rendering as the old homepage) -----
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
      free: { icon: '🚀', name: 'Free Plan', desc: 'Basic access with monthly usage limits', badgeClass: 'free', btnText: 'Upgrade Plan' },
      student: { icon: '🎓', name: 'Student Plan', desc: 'Full access for healthcare students', badgeClass: 'student', btnText: 'Upgrade to Pro' },
      pro: { icon: '💎', name: 'Pro Plan', desc: 'Unlimited everything for professionals', badgeClass: 'pro', btnText: 'Manage Plan' }
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
  document.addEventListener('planUpdated', updatePlanCard);
  setTimeout(updatePlanCard, 500);
  if (typeof firebase !== 'undefined') {
    firebase.auth().onAuthStateChanged(() => setTimeout(updatePlanCard, 500));
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
});
