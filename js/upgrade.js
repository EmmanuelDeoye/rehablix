// js/upgrade.js – Country-specific fixed pricing with "slashed price" illusion, multi-gateway payments
// Registered as the "subscription" SPA view (js/router.js calls mount() after
// injecting the "subscription" template (js/view-templates.js) into #appRoot).

(function () {
  let cleanupFns = [];

  async function mount() {

  // ===== DOM Elements (with null safety) =====
  const getEl = (id) => document.getElementById(id);
  
  const plansGrid = getEl('plansGrid');
  const paymentModal = getEl('paymentModal');
  const closePaymentModal = getEl('closePaymentModal');
  const paymentMethodsContainer = getEl('paymentMethods');
  const paymentPlanBadge = getEl('paymentPlanBadge');
  const paymentCurrency = getEl('paymentCurrency');
  const paymentAmount = getEl('paymentAmount');
  const paymentPeriod = getEl('paymentPeriod');
  const paymentBilling = getEl('paymentBilling');
  const billingToggle = getEl('billingToggle');
  const locationFlag = getEl('locationFlag');
  const locationText = getEl('locationText');
  const currencyCode = getEl('currencyCode');
  const currencyNotice = getEl('currencyNotice');
  const toastContainer = getEl('toast-container');

  // ===== State =====
  let currentUser = null;
  let currentPlan = 'free';
  let selectedPlan = null;
  let isYearly = false;
  let userCountry = 'US';
  let userCurrency = 'USD';
  let countrySymbol = '$';
  let paymentGateways = [];
  let locationKnown = false;   // the user's country has been looked up (its prices can be shown)

  const database = firebase.database();
  const auth = firebase.auth();

  // ===== Country-Specific Fixed Prices with "slashed original" illusion =====
  // The built-in table lives in js/plan-config.js (the admin page starts from it); the
  // prices shown and charged are those with the admin's changes (getCountryPricing).
  const COUNTRY_PRICING = window.RehablixPlanConfig.defaultCountryPricing();
  const DEFAULT_PRICING = window.RehablixPlanConfig.defaultPricing();

  // Max plan pricing isn't hand-authored per country — it's derived as 3x
  // Pro's price (same currency/gateways), so adding it doesn't require
  // retyping ~15 countries' worth of numbers by hand.
  const MAX_PLAN_MULTIPLIER = 3;
  function deriveMaxPricing(entry) {
    if (entry.max) return entry; // already has one
    const scale = (p) => ({ original: Math.round(p.original * MAX_PLAN_MULTIPLIER * 100) / 100, current: Math.round(p.current * MAX_PLAN_MULTIPLIER * 100) / 100 });
    entry.max = {
      monthly: scale(entry.pro.monthly),
      yearly: scale(entry.pro.yearly)
    };
    return entry;
  }
  Object.values(COUNTRY_PRICING).forEach(deriveMaxPricing);
  deriveMaxPricing(DEFAULT_PRICING);

  // ===== Payment Gateway Keys =====
  // Paystack: this is a live key (pk_live_...) — correct for production.
  const PAYSTACK_PUBLIC_KEY = 'pk_live_1fd1c3c6380edae5c08ca9f1e69db8d717534af2';
  // ⚠️ FLUTTERWAVE: this was a TEST key (FLWPUBK_TEST-...), which means every
  // Flutterwave-only country (Kenya, Tanzania, Uganda, Rwanda, Cameroon,
  // Côte d'Ivoire, Senegal) was running in sandbox mode — no real money was
  // ever charged, but users were still being granted paid access. Replace
  // this with your LIVE Flutterwave public key (starts with FLWPUBK-, no
  // "_TEST") from your Flutterwave dashboard before going live.
  const FLUTTERWAVE_PUBLIC_KEY = 'FLWPUBK-a433c420ff08c5ffe8d0edb484e5b6bc-X';

  // ===== Helpers =====
  function showToast(message, type = 'success', duration = 3500) {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // The built-in prices with whatever the admin has set (admin.html > Plans & Pricing), Max included.
  function getCountryPricing(countryCode) {
    return window.RehablixPlanConfig.pricingFor(countryCode);
  }
  const PC = window.RehablixPlanConfig;
  const fmtNum = (p) => (p % 1 !== 0 ? p.toFixed(2) : p.toLocaleString());

  function formatPrice(price, symbol) {
    if (price === 0) return `${symbol}0`;
    if (price % 1 !== 0) return `${symbol}${price.toFixed(2)}`;
    return `${symbol}${price.toLocaleString()}`;
  }

  // ===== Get previous page URL for redirect =====
  function getPreviousPage() {
    const referrer = document.referrer;
    // If came from rehablix site, go back there; otherwise go to index
    if (referrer && (referrer.includes('rehablix') || referrer.includes('127.0.0.1') || referrer.includes('localhost'))) {
      return referrer;
    }
    return 'index.html';
  }

  // ===== Detect Location =====
  async function detectLocation() {
    try {
      // (at most 6 s: offline or slow, the international prices show instead of a page that keeps loading)
      const response = await fetch('https://ipapi.co/json/', (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? { signal: AbortSignal.timeout(6000) } : undefined);
      const data = await response.json();
      userCountry = data.country_code || 'US';
      const pricing = getCountryPricing(userCountry);
      userCurrency = pricing.currency;
      countrySymbol = pricing.symbol;
      paymentGateways = pricing.gateways;

      if (locationFlag) locationFlag.textContent = pricing.flag;
      if (locationText) locationText.textContent = `Prices in ${pricing.name} (${pricing.currency})`;
      locationKnown = true;
      if (currencyCode) currencyCode.textContent = pricing.currency;
      if (currencyNotice) currencyNotice.style.display = 'flex';
      
      return pricing;
    } catch (error) {
      console.error('Location detection failed:', error);
      userCountry = 'US';
      const pricing = DEFAULT_PRICING;
      userCurrency = pricing.currency;
      countrySymbol = pricing.symbol;
      paymentGateways = pricing.gateways;
      
      if (locationFlag) locationFlag.textContent = pricing.flag;
      if (locationText) locationText.textContent = `Prices in USD (International)`;
      if (currencyCode) currencyCode.textContent = 'USD';
      if (currencyNotice) currencyNotice.style.display = 'flex';
      
      return pricing;
    }
  }

  // ===== Update Plan Prices with Slashed Original Price & Discount Badge =====
  // During a promo the admin declared (appConfig/promo) the usual price is struck through and the promo price
  // shown (and charged); otherwise as before. The token lines follow the limits set on the admin page.
  function paintPrice(plan, pricing) {
    const priceEl = getEl(plan + 'Price');
    if (!priceEl) return;
    const card = priceEl.closest('.plan-price');
    const shown = PC.shownPrice(pricing, plan, isYearly);
    if (card) {
      card.querySelectorAll('.slashed-price, .discount-badge, .promo-tag').forEach(el => el.remove());
      if (shown.promo) {
        const tag = document.createElement('span');
        tag.className = 'promo-tag';
        tag.textContent = `${fmtNum(shown.promo.percent)}% OFF · ${shown.promo.title}`;
        card.insertBefore(tag, card.firstChild);
      }
      if (shown.slashed != null) {
        // Add slashed original price above current price
        const slashSpan = document.createElement('span');
        slashSpan.className = 'slashed-price';
        slashSpan.textContent = formatPrice(shown.slashed, pricing.symbol);
        slashSpan.style.cssText = `
          text-decoration: line-through;
          color: #dc2626;
          font-size: 1.5rem;
          font-weight: 500;
          opacity: 0.7;
          display: block;
          margin-bottom: -0.2rem;
        `;
        card.insertBefore(slashSpan, priceEl);
        if (shown.slashed > shown.pay) {
          // Add discount badge
          const badge = document.createElement('span');
          badge.className = 'discount-badge';
          badge.textContent = `-${Math.round((1 - shown.pay / shown.slashed) * 100)}%`;
          badge.style.cssText = `
            background: #10b981;
            color: white;
            padding: 0.15rem 0.5rem;
            border-radius: 1rem;
            font-size: 0.65rem;
            font-weight: 700;
            margin-left: 0.4rem;
            vertical-align: middle;
            animation: badgePop 0.3s ease;
          `;
          priceEl.parentNode.appendChild(badge);
        }
      }
    }
    // Update current price
    priceEl.textContent = fmtNum(shown.pay);
  }

  /** The first feature line of each paid card: its token allowance as now set (plus the daily cap, if any). */
  function paintTokenLines() {
    const tiers = window.RehabPlanTiers;
    if (!tiers) return;
    ['student', 'pro', 'max'].forEach(plan => {
      const card = document.querySelector('.plan-card[data-plan="' + plan + '"]');
      const first = card && card.querySelector('.plan-features li');
      if (!first) return;
      const budget = tiers.PLAN_TOKEN_BUDGET[plan];
      const lower = tiers.PLAN_ORDER[tiers.PLAN_ORDER.indexOf(plan) - 1];
      const lowerBudget = lower ? tiers.PLAN_TOKEN_BUDGET[lower] : null;
      const times = budget != null && lowerBudget > 0 && budget >= lowerBudget * 2 ? ` (${Math.floor(budget / lowerBudget)}x ${tiers.PLAN_LABELS[lower]})` : '';
      first.innerHTML = budget == null
        ? '<i class="fas fa-check"></i> <strong>Unlimited</strong> Lixa tokens — no reset window'
        : `<i class="fas fa-check"></i> <strong>${budget.toLocaleString()}</strong> Lixa tokens every 4 hours${times}`;
      card.querySelectorAll('.daily-cap-line').forEach(el => el.remove());
      const cap = PC.dailyCap(plan);
      if (cap) {
        const li = document.createElement('li');
        li.className = 'daily-cap-line';
        li.innerHTML = `<i class="fas fa-check"></i> Up to ${cap.toLocaleString()} tokens a day`;
        first.insertAdjacentElement('afterend', li);
      }
    });
  }

  /** The promo across the top of the plans while it runs, with how long it has left. */
  function paintPromoBanner() {
    const old = getEl('promoBanner');
    const promo = ['student', 'pro', 'max'].map(p => PC.promoFor(p)).find(Boolean);
    if (!promo) { if (old) old.remove(); return; }
    const left = Math.max(0, promo.endsAt - Date.now());
    const d = Math.floor(left / 86400000), h = Math.floor(left / 3600000) % 24, m = Math.floor(left / 60000) % 60;
    const ends = !isFinite(promo.endsAt) ? '' : d > 0 ? `Ends in ${d}d ${h}h` : h > 0 ? `Ends in ${h}h ${m}m` : `Ends in ${Math.max(1, m)}m`;
    const el = old || document.createElement('div');
    el.id = 'promoBanner';
    el.className = 'promo-banner';
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    el.innerHTML = `<span class="promo-banner-icon">🎉</span><div class="promo-banner-text"><strong>${esc(promo.title)} · ${fmtNum(promo.percent)}% off</strong>` +
      (promo.message ? `<span>${esc(promo.message)}</span>` : '') + `</div>` + (ends ? `<span class="promo-banner-ends">${ends}</span>` : '');
    if (!old && plansGrid) plansGrid.insertAdjacentElement('beforebegin', el);
  }

  function updatePlanPrices(pricing) {
    const symbol = pricing.symbol;

    const freeCurrencyEl = getEl('freeCurrency');
    if (freeCurrencyEl) freeCurrencyEl.textContent = symbol;
    ['student', 'pro', 'max'].forEach(plan => {
      const cur = getEl(plan + 'Currency');
      if (cur) cur.textContent = symbol;
      paintPrice(plan, pricing);
    });
    paintTokenLines();
    paintPromoBanner();

    // Update period labels
    document.querySelectorAll('.period').forEach(el => {
      el.textContent = isYearly ? '/year' : '/month';
    });
  }

  // ===== Loading animation (until the country and the latest plans and prices are known) =====
  function showPlansLoading(on) {
    if (!plansGrid) return;
    plansGrid.classList.toggle('plans-loading', on);
    let loader = getEl('plansLoader');
    if (on && !loader) {
      loader = document.createElement('div');
      loader.id = 'plansLoader';
      loader.className = 'plans-loader';
      loader.setAttribute('role', 'status');
      loader.innerHTML = '<div class="plans-loader-head"><span class="plans-loader-spin"></span>Loading the latest plans and prices…</div>' +
        '<div class="plans-loader-cards">' + '<div class="plans-loader-card"><i></i><b></b><b></b><em></em><s></s><s></s><s></s><s></s><u></u></div>'.repeat(3) + '</div>';
      plansGrid.insertAdjacentElement('beforebegin', loader);
    } else if (!on && loader) loader.remove();
  }

  // ===== Billing Toggle =====
  if (billingToggle) {
    billingToggle.addEventListener('change', () => {
      isYearly = billingToggle.checked;
      const pricing = getCountryPricing(userCountry);
      updatePlanPrices(pricing);
      document.querySelectorAll('.toggle-label').forEach(label => {
        label.classList.toggle('active', label.dataset.billing === (isYearly ? 'yearly' : 'monthly'));
      });
    });
  }

  document.querySelectorAll('.toggle-label').forEach(label => {
    label.addEventListener('click', () => {
      const billing = label.dataset.billing;
      isYearly = billing === 'yearly';
      if (billingToggle) billingToggle.checked = isYearly;
      const pricing = getCountryPricing(userCountry);
      updatePlanPrices(pricing);
      document.querySelectorAll('.toggle-label').forEach(l => {
        l.classList.toggle('active', l.dataset.billing === billing);
      });
    });
  });

  // ===== Plan Selection =====
  function attachPlanButtonListeners() {
    document.querySelectorAll('.plan-btn:not(.current-plan)').forEach(btn => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);

      newBtn.addEventListener('click', () => {
        const plan = newBtn.dataset.plan;
        if (!plan || plan === 'free') return;

        if (!currentUser) {
          showToast('Please log in to subscribe', 'error', 4000);
          
          const loginBtn = getEl('loginBtn');
          const authModal = getEl('authModal');
          
          if (loginBtn && loginBtn.style.display !== 'none' && loginBtn.offsetParent !== null) {
            loginBtn.click();
          } else if (authModal) {
            authModal.classList.add('show');
            document.body.style.overflow = 'hidden';
            
            const loginTab = getEl('loginTab');
            const registerTab = getEl('registerTab');
            const loginForm = getEl('loginForm');
            const registerForm = getEl('registerForm');
            
            if (loginTab && registerTab && loginForm && registerForm) {
              loginTab.classList.add('active');
              registerTab.classList.remove('active');
              loginForm.classList.add('active');
              registerForm.classList.remove('active');
            }
          } else {
            showToast('Redirecting to login page...', 'info', 2000);
            setTimeout(() => { window.location.href = 'index.html'; }, 1500);
          }
          return;
        }

        selectedPlan = plan;
        openPaymentModal(plan);
      });
    });
  }

  attachPlanButtonListeners();

  // ===== Payment Modal =====
  function openPaymentModal(plan) {
    if (!paymentModal) return;
    
    const pricing = getCountryPricing(userCountry);
    // (what is charged: a running promo's price; the struck-through price is the usual one then)
    const shown = PC.shownPrice(pricing, plan, isYearly);
    const base = isYearly ? pricing[plan].yearly : pricing[plan].monthly;
    const priceData = { original: shown.slashed != null ? shown.slashed : base.original, current: shown.pay };
    const discountPercent = Math.round((1 - priceData.current / priceData.original) * 100);
    
    const planBadges = { student: '🎓 Basic Plan', pro: '💎 Pro Plan', max: '♾️ Max Plan' };
    if (paymentPlanBadge) paymentPlanBadge.textContent = planBadges[plan] || plan;
    if (paymentCurrency) paymentCurrency.textContent = pricing.symbol;
    if (paymentAmount) paymentAmount.textContent = priceData.current % 1 !== 0 ? priceData.current.toFixed(2) : priceData.current.toLocaleString();
    if (paymentPeriod) paymentPeriod.textContent = isYearly ? '/year' : '/month';
    if (paymentBilling) {
      paymentBilling.textContent = shown.promo
        ? `${shown.promo.title}: ${fmtNum(shown.promo.percent)}% off · ${isYearly ? 'billed yearly' : 'billed monthly'}`
        : isYearly
          ? `Billed yearly (save ${discountPercent}%)`
          : 'Billed monthly';
    }
    
    // Add slashed original price in payment modal
    const paymentPriceDisplay = paymentAmount?.closest('.payment-price-display');
    if (paymentPriceDisplay) {
      // Remove existing slashed price
      const existingSlash = paymentPriceDisplay.querySelector('.payment-slashed-price');
      if (existingSlash) existingSlash.remove();
      
      // Add new slashed price above the current price
      const slashSpan = document.createElement('span');
      slashSpan.className = 'payment-slashed-price';
      slashSpan.textContent = formatPrice(priceData.original, pricing.symbol);
      slashSpan.style.cssText = `
        text-decoration: line-through;
        color: #dc2626;
        font-size: 1rem;
        font-weight: 500;
        opacity: 0.6;
        display: block;
        margin-bottom: -0.3rem;
      `;
      paymentPriceDisplay.insertBefore(slashSpan, paymentPriceDisplay.firstChild);
    }
    
    renderPaymentMethods(pricing);
    
    paymentModal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function renderPaymentMethods(pricing) {
    if (!paymentMethodsContainer) return;
    paymentMethodsContainer.innerHTML = '';
    
    pricing.gateways.forEach(gateway => {
      let iconClass, name, desc, icon;
      switch (gateway) {
        case 'paystack':
          iconClass = 'paystack';
          name = 'Paystack';
          desc = 'Card, Bank Transfer, USSD';
          icon = 'P';
          break;
        case 'flutterwave':
          iconClass = 'flutterwave';
          name = 'Flutterwave';
          desc = 'Card, Bank, Mobile Money';
          icon = 'F';
          break;
        case 'gpay':
          iconClass = 'gpay';
          name = 'Google Pay';
          desc = 'Fast checkout with Google Pay';
          icon = 'G';
          break;
      }
      
      const btn = document.createElement('button');
      btn.className = 'payment-method-btn';
      btn.dataset.gateway = gateway;
      btn.innerHTML = `
        <div class="payment-method-icon ${iconClass}">${icon}</div>
        <div class="payment-method-info">
          <div class="payment-method-name">${name}</div>
          <div class="payment-method-desc">${desc}</div>
        </div>
      `;
      
      btn.addEventListener('click', () => initiatePayment(gateway));
      paymentMethodsContainer.appendChild(btn);
    });
  }

  // ===== Initiate Payment =====
  function initiatePayment(gateway) {
    if (!selectedPlan || !currentUser) return;
    
    const pricing = getCountryPricing(userCountry);
    // (the price at the moment of paying: a promo's price while it runs)
    const priceData = { current: PC.shownPrice(pricing, selectedPlan, isYearly).pay };

    switch (gateway) {
      case 'paystack':
        initPaystack(priceData.current, pricing);
        break;
      case 'flutterwave':
        initFlutterwave(priceData.current, pricing);
        break;
      case 'gpay':
        initGooglePay(priceData.current, pricing);
        break;
    }
  }

  // ===== Paystack =====
  function initPaystack(amount, pricing) {
    // Convert to kobo (smallest unit) for Paystack
    const amountInSmallest = Math.round(amount * 100);
    
    const handler = PaystackPop.setup({
      key: PAYSTACK_PUBLIC_KEY,
      email: currentUser.email,
      amount: amountInSmallest,
      currency: pricing.currency,
      ref: `rehab_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      metadata: {
        plan: selectedPlan,
        billing: isYearly ? 'yearly' : 'monthly',
        user_id: currentUser.uid,
        country: userCountry
      },
      callback: (response) => handlePaymentSuccess('paystack', response, amount),
      onClose: () => showToast('Payment cancelled', 'warning', 2000)
    });
    handler.openIframe();
  }

  // ===== Flutterwave =====
  function initFlutterwave(amount, pricing) {
    FlutterwaveCheckout({
      public_key: FLUTTERWAVE_PUBLIC_KEY,
      tx_ref: `rehab_${Date.now()}`,
      amount: amount,
      currency: pricing.currency,
      payment_options: 'card,banktransfer,ussd,mobilemoney',
      customer: {
        email: currentUser.email,
        name: currentUser.displayName || 'User'
      },
      meta: {
        plan: selectedPlan,
        billing: isYearly ? 'yearly' : 'monthly',
        user_id: currentUser.uid,
        country: userCountry
      },
      customizations: {
        title: 'rehablix',
        description: `${selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1)} Plan - ${isYearly ? 'Yearly' : 'Monthly'}`
      },
      callback: (data) => {
        if (data.status === 'successful') {
          handlePaymentSuccess('flutterwave', data, amount);
        }
      },
      onclose: () => showToast('Payment cancelled', 'warning', 2000)
    });
  }

  // ===== Google Pay =====
  // FIX (was broken): this used to call Google's raw
  // `google.payments.api.PaymentsClient` directly with
  // `gateway: 'example'` (a placeholder Google only accepts in their own
  // demos) and `environment: 'PRODUCTION'`. Neither of those can ever work
  // for a real merchant: 'example' isn't a real payment processor, so
  // Google rejects/silently no-ops the tokenization, and 'PRODUCTION' mode
  // requires a fully Business-Console-verified Google Pay merchant account
  // or it just reports Google Pay as "not available" — which, since GPay
  // was the ONLY gateway configured for US/UK/CA/AU/DE/FR/BR, meant every
  // customer in those countries hit a dead end (or, in earlier test-mode
  // versions, got "successful" callbacks without ever being charged).
  //
  // Real fix: this static, backend-less site has no way to run its own
  // Google Pay <-> processor tokenization exchange (that requires a
  // Google-approved PSP integration id, which only an actual payment
  // processor can issue you). Flutterwave is already wired up above and
  // has first-class Google Pay support built into its own checkout
  // (Flutterwave takes care of the Google Wallet handshake, card
  // tokenization, and settlement) — so "Google Pay" in the UI now opens
  // the Flutterwave checkout pre-configured to show only the Google Pay
  // option. This is a fully working integration once you:
  //   1. Set FLUTTERWAVE_PUBLIC_KEY above to your real live key.
  //   2. In the Flutterwave dashboard -> Settings -> Checkout, enable the
  //      "Google Pay" payment option for your account (it's opt-in).
  function initGooglePay(amount, pricing) {
    if (typeof FlutterwaveCheckout !== 'function') {
      showToast('Google Pay is temporarily unavailable. Please try another payment method.', 'error');
      return;
    }

    FlutterwaveCheckout({
      public_key: FLUTTERWAVE_PUBLIC_KEY,
      tx_ref: `rehab_gpay_${Date.now()}`,
      amount: amount,
      currency: pricing.currency,
      payment_options: 'googlepay',
      customer: {
        email: currentUser.email,
        name: currentUser.displayName || 'User'
      },
      meta: {
        plan: selectedPlan,
        billing: isYearly ? 'yearly' : 'monthly',
        user_id: currentUser.uid,
        country: userCountry,
        method: 'googlepay'
      },
      customizations: {
        title: 'rehablix',
        description: `${selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1)} Plan - Google Pay`
      },
      callback: (data) => {
        if (data.status === 'successful') {
          handlePaymentSuccess('gpay', data, amount);
        }
      },
      onclose: () => showToast('Payment cancelled', 'warning', 2000)
    });
  }

  // ===== Payment Success Handler =====
  const PENDING_SUBSCRIPTION_KEY = 'rehablix_pending_subscription';

  // PAYMENT FIX (item 5): finishes a subscription write that was reported
  // successful by the gateway but didn't make it to Firebase last time
  // (network blip, tab closed mid-write, etc.) — called once auth is ready.
  // ===== Server-verified billing (window.REHABLIX_SERVER_BILLING) =====
  // The browser never writes a paid plan: it hands the gateway reference to
  // the verifyPayment function, which checks amount, currency, user and
  // reference with Paystack/Flutterwave (secret key, server-side) and writes
  // the subscription itself. Success is only shown after the server says so.
  const PENDING_VERIFICATION_KEY = 'rehablix_pending_verification';

  async function verifyWithServer(pending) {
    const token = await currentUser.getIdToken();
    const resp = await fetch(window.REHABLIX_BILLING_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ gateway: pending.gateway, reference: pending.reference, transactionId: pending.transactionId || null, plan: pending.plan, billing: pending.billing })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      const err = new Error((data.error && data.error.message) || `Verification failed (${resp.status})`);
      err.retryable = resp.status >= 500 || resp.status === 0;
      throw err;
    }
    return data.subscription;
  }

  async function completeServerVerifiedPayment(gateway, response, purchasedPlan, billing) {
    const pending = {
      uid: currentUser.uid, gateway, plan: purchasedPlan, billing,
      reference: response.reference || response.tx_ref || '',
      transactionId: response.transaction_id || response.transactionId || null
    };
    if (!pending.reference) {
      showToast('Payment could not be confirmed — no transaction reference received. Contact support if you were charged.', 'error', 7000);
      return;
    }
    try { localStorage.setItem(PENDING_VERIFICATION_KEY, JSON.stringify(pending)); } catch (e) {}
    closePaymentModalHandler();
    showToast('Confirming your payment with the provider…', 'info', 6000);
    try {
      const sub = await verifyWithServer(pending);
      try { localStorage.removeItem(PENDING_VERIFICATION_KEY); } catch (e) {}
      // plan.js's live listener also picks up the server's write.
      document.dispatchEvent(new CustomEvent('planUpdated', { detail: { plan: sub.plan } }));
      showSuccessCelebration(sub.plan, new Date(sub.ends));
    } catch (e) {
      if (e.retryable) {
        showToast('Payment received — we are still confirming it. It will apply automatically; contact support if it has not within a few minutes.', 'warning', 8000);
      } else {
        try { localStorage.removeItem(PENDING_VERIFICATION_KEY); } catch (x) {}
        showToast(e.message + ' If you were charged, contact support with your reference: ' + pending.reference, 'error', 9000);
      }
    }
  }

  async function retryPendingSubscriptionIfAny() {
    if (window.REHABLIX_SERVER_BILLING) {
      let pv;
      try { pv = JSON.parse(localStorage.getItem(PENDING_VERIFICATION_KEY) || 'null'); } catch (e) { pv = null; }
      if (!pv || !currentUser || currentUser.uid !== pv.uid) return;
      try {
        const sub = await verifyWithServer(pv);
        localStorage.removeItem(PENDING_VERIFICATION_KEY);
        document.dispatchEvent(new CustomEvent('planUpdated', { detail: { plan: sub.plan } }));
        showToast('Your previous payment has now been confirmed and applied.', 'success', 6000);
      } catch (e) {
        if (!e.retryable) { try { localStorage.removeItem(PENDING_VERIFICATION_KEY); } catch (x) {} }
      }
      return;
    }
    let pending;
    try { pending = JSON.parse(localStorage.getItem(PENDING_SUBSCRIPTION_KEY) || 'null'); } catch (e) { pending = null; }
    if (!pending || !pending.uid || !pending.payload) return;
    if (!currentUser || currentUser.uid !== pending.uid) return; // only ever retry for the account that actually paid

    try {
      await database.ref(`users/${pending.uid}/subscription`).set(pending.payload);
      localStorage.removeItem(PENDING_SUBSCRIPTION_KEY);
      document.dispatchEvent(new CustomEvent('planUpdated', { detail: { plan: pending.payload.plan } }));
      showToast('Your previous payment has now been applied to your account.', 'success', 6000);
    } catch (e) {
      console.error('Retrying pending subscription write failed, will try again next load:', e);
    }
  }

  async function handlePaymentSuccess(gateway, response, amount) {
    if (!currentUser || !selectedPlan) return;
    // PAYMENT FIX (item 5): captured up front because
    // closePaymentModalHandler() below resets the module-level
    // `selectedPlan` to null — every use after that point used to read
    // `selectedPlan` directly and silently get null, which showed "Welcome
    // to null!" in the success modal and sent a broken (plan: null)
    // 'planUpdated' event to every listener elsewhere in the app.
    const purchasedPlan = selectedPlan;

    if (window.REHABLIX_SERVER_BILLING) {
      return completeServerVerifiedPayment(gateway, response, purchasedPlan, isYearly ? 'yearly' : 'monthly');
    }

    // Minimal sanity check on the transaction reference before we grant
    // access. This does NOT replace real server-side verification (see
    // note below) — it only catches obviously broken/empty callbacks.
    const transactionRef = response.reference || response.tx_ref || response.paymentMethodData?.token || '';
    if (!transactionRef) {
      showToast('Payment could not be confirmed — no transaction reference received. You have not been charged (or if you were, contact support with your bank statement).', 'error', 7000);
      return;
    }

    // ⚠️ IMPORTANT: this app has no backend, so this is trusting the
    // gateway's browser-side callback directly — there is no server-side
    // verification of `transactionRef` against Paystack/Flutterwave's API.
    // A technically determined user could fabricate a success callback in
    // devtools and grant themselves a paid plan without paying. Closing
    // this gap for real requires a server (webhook receiver + API
    // verification call), which is outside what a static/backend-less
    // site can do. Flagging this clearly rather than pretending otherwise.

    const endDate = new Date();
    if (isYearly) {
      endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
      endDate.setMonth(endDate.getMonth() + 1);
    }

    const subscriptionPayload = {
      plan: purchasedPlan,
      billing: isYearly ? 'yearly' : 'monthly',
      starts: new Date().toISOString(),
      ends: endDate.toISOString(),
      gateway: gateway,
      transactionRef: transactionRef,
      country: userCountry,
      currency: userCurrency,
      amount: amount
    };

    // PAYMENT FIX (item 5): the gateway HAS already reported success at this
    // point — a genuinely successful payment must never be lost to a
    // transient Firebase write failure. Persist it locally first, so
    // retryPendingSubscriptionIfAny() (called on next load) can finish the
    // job even if the write below fails right now.
    try {
      localStorage.setItem(PENDING_SUBSCRIPTION_KEY, JSON.stringify({ uid: currentUser.uid, payload: subscriptionPayload }));
    } catch (e) { /* localStorage unavailable — the write below is still attempted */ }

    try {
      // Update subscription in Firebase
      await database.ref(`users/${currentUser.uid}/subscription`).set(subscriptionPayload);
      try { localStorage.removeItem(PENDING_SUBSCRIPTION_KEY); } catch (e) {}

      closePaymentModalHandler();

      // Force plan.js to reload the subscription by dispatching event
      document.dispatchEvent(new CustomEvent('planUpdated', { detail: { plan: purchasedPlan } }));

      showSuccessCelebration(purchasedPlan, endDate);

      // Rehablix Partners: credit the referring partner's 20% commission,
      // if this user was referred by one. Never let this block/undo the
      // subscription the user just paid for — failures here are swallowed
      // and logged rather than surfaced as a payment error.
      creditPartnerCommission(gateway, transactionRef, amount).catch(err => {
        console.error('Partner commission crediting failed:', err);
      });

    } catch (error) {
      console.error('Subscription update failed:', error);
      // The pending record stays in localStorage — retried automatically
      // next time this page loads for the same account, so the payment
      // isn't silently lost even though this write failed right now.
      showToast('Payment successful — we\'re finishing up your plan update. It will apply automatically the next time you open rehablix; contact support if it hasn\'t within a few minutes.', 'error', 8000);
    }
  }

  // ===== Rehablix Partners: Referral Commission =====
  const PARTNER_COMMISSION_RATE = 0.20; // 20% of every subscription payment

  async function creditPartnerCommission(gateway, transactionRef, amount) {
    if (!currentUser) return;

    const userSnap = await database.ref(`users/${currentUser.uid}/referredBy`).once('value');
    const referrerUid = userSnap.val();
    if (!referrerUid || referrerUid === currentUser.uid) return; // not referred / self-referral guard

    const partnerRef = database.ref(`partners/${referrerUid}`);
    const partnerSnap = await partnerRef.once('value');
    const partner = partnerSnap.val();
    if (!partner || partner.status !== 'approved') return; // only approved partners earn

    const commission = Math.round(amount * PARTNER_COMMISSION_RATE * 100) / 100;

    // Log the transaction
    await partnerRef.child('transactions').push({
      referredUid: currentUser.uid,
      referredName: currentUser.displayName || currentUser.email,
      referredEmail: currentUser.email,
      plan: selectedPlan,
      billing: isYearly ? 'yearly' : 'monthly',
      amount: amount,
      currency: userCurrency,
      commissionRate: PARTNER_COMMISSION_RATE,
      commission: commission,
      gateway: gateway,
      transactionRef: transactionRef,
      date: new Date().toISOString()
    });

    // Atomically increment running totals so concurrent payments never clobber each other
    await partnerRef.child('earnings/total').transaction(v => (v || 0) + commission);
    await partnerRef.child('earnings/pending').transaction(v => (v || 0) + commission);
    await partnerRef.child('earnings/count').transaction(v => (v || 0) + 1);
  }

  // ===== Success Celebration Modal =====
  function showSuccessCelebration(plan, endDate) {
    const planNames = { student: 'Basic', pro: 'Pro', max: 'Max' };
    const planIcons = { student: '🎓', pro: '💎', max: '♾️' };
    const overlay = document.createElement('div');
    overlay.className = 'sub-success-overlay';
    overlay.innerHTML = `
      <div class="sub-success-card">
        <div class="sub-success-check">
          <svg viewBox="0 0 52 52"><circle class="sub-success-check-circle" cx="26" cy="26" r="24" fill="none"/><path class="sub-success-check-mark" fill="none" d="M14 27l7 7 17-17"/></svg>
        </div>
        <div class="sub-success-icon">${planIcons[plan] || '🎉'}</div>
        <h2>Welcome to ${planNames[plan] || plan}!</h2>
        <p>Your subscription is active. Renews/expires on <strong>${endDate.toLocaleDateString()}</strong>.</p>
        <button class="btn-primary sub-success-continue" id="subSuccessContinue">Continue</button>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    const goBack = () => {
      overlay.classList.remove('show');
      setTimeout(() => {
        overlay.remove();
        window.location.href = getPreviousPage();
      }, 250);
    };
    overlay.querySelector('#subSuccessContinue').addEventListener('click', goBack);
    setTimeout(goBack, 4500); // auto-continue if they don't click
  }

  function closePaymentModalHandler() {
    if (paymentModal) {
      paymentModal.classList.remove('show');
      document.body.style.overflow = '';
    }
    selectedPlan = null;
  }

  if (closePaymentModal) closePaymentModal.addEventListener('click', closePaymentModalHandler);
  if (paymentModal) {
    paymentModal.addEventListener('click', (e) => {
      if (e.target === paymentModal) closePaymentModalHandler();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && paymentModal && paymentModal.classList.contains('show')) {
      closePaymentModalHandler();
    }
  });

  // ===== Update Current Plan UI =====
  // plan.js already auto-downgrades an expired paid subscription back to
  // 'free' (see js/plan.js's loadSubscription), so whatever getCurrentPlan()
  // returns here is guaranteed to be the user's actually-active plan — no
  // separate expiry check needed on this page.
  function updateCurrentPlanUI(plan) {
    const tiers = window.RehabPlanTiers;
    const order = tiers ? tiers.PLAN_ORDER : ['free', 'student', 'pro', 'max'];
    const currentIdx = order.indexOf(plan);
    const next = tiers ? tiers.nextPlan(plan) : null;
    const nextLabel = next && tiers ? tiers.PLAN_LABELS[next] : null;

    document.querySelectorAll('.plan-card').forEach(card => {
      const cardPlan = card.dataset.plan;

      // SUBSCRIPTION UPGRADE (item 4): Free is never a real choice on this
      // page regardless of the user's plan — always hidden.
      if (cardPlan === 'free') { card.hidden = true; return; }

      const cardIdx = order.indexOf(cardPlan);
      const btn = card.querySelector('.plan-btn');
      const isBelowCurrent = currentIdx > -1 && cardIdx > -1 && cardIdx < currentIdx;

      // Every paid tier stays visible now (previously hidden below the
      // user's active plan) — a tier below current renders inactive
      // instead, so the full lineup is always visible for context.
      card.hidden = false;
      card.classList.toggle('plan-card-inactive', isBelowCurrent);
      if (!btn) return;

      if (isBelowCurrent) {
        btn.textContent = 'Included in Your Plan';
        btn.classList.remove('current-plan');
        btn.disabled = true;
        return;
      }

      if (cardPlan === plan) {
        if (next) {
          btn.textContent = `Upgrade to ${nextLabel}`;
          btn.classList.remove('current-plan');
          btn.disabled = false;
          btn.dataset.plan = next; // clicking it starts the upgrade flow for the next tier up
        } else {
          // Already on the top tier — nothing higher to upgrade to.
          btn.textContent = 'Current Plan';
          btn.classList.add('current-plan');
          btn.disabled = true;
        }
      } else {
        btn.textContent = 'Get Started';
        btn.classList.remove('current-plan');
        btn.disabled = false;
        btn.dataset.plan = cardPlan;
      }
    });
    // Re-attach listeners after UI update
    attachPlanButtonListeners();
    renderRenewalBanner();
  }

  // ===== Renewal Reminder Banner =====
  // Since true zero-touch automatic re-billing needs a backend (to charge
  // the card while the user isn't on the site), the practical alternative
  // here is to warn paid users before they lose access, so nothing is a
  // surprise and they can manually renew in time.
  function renderRenewalBanner() {
    const existing = document.getElementById('renewalBanner');
    if (existing) existing.remove();
    if (!window.rehabPlans) return;

    const plan = window.rehabPlans.getCurrentPlan();
    const days = window.rehabPlans.daysUntilExpiry();
    if (!plan || plan === 'free' || days === null || days > 5) return;

    const planLabel = (window.RehabPlanTiers && window.RehabPlanTiers.PLAN_LABELS[plan]) || (plan.charAt(0).toUpperCase() + plan.slice(1));
    const banner = document.createElement('div');
    banner.id = 'renewalBanner';
    banner.className = 'renewal-banner';
    banner.innerHTML = days > 0
      ? `<i class="fas fa-clock"></i> Your ${planLabel} plan expires in ${days} day${days === 1 ? '' : 's'}. Renew below to avoid losing access.`
      : `<i class="fas fa-exclamation-circle"></i> Your ${planLabel} plan expires today. Renew below to keep your access.`;
    const header = document.querySelector('.sub-header');
    if (header) header.insertAdjacentElement('afterend', banner);
  }

  // ===== Auth / Plan Listener =====
  // plan.js is the single source of truth for the user's current plan
  // (it also handles expiry/auto-downgrade) — this page just reflects it,
  // instead of re-reading the subscription from Firebase a second time.
  // (The compat SDK's onAuthStateChanged returns an unsubscribe function —
  // captured so unmount() can detach it; this listener would otherwise
  // outlive the view and keep firing after navigating away.)
  const unsubscribeAuth = auth.onAuthStateChanged((user) => {
    currentUser = user;
    attachPlanButtonListeners();
    retryPendingSubscriptionIfAny();
  });
  cleanupFns.push(unsubscribeAuth);

  const onPlanUpdated = (e) => {
    currentPlan = e.detail.plan || 'free';
    updateCurrentPlanUI(currentPlan);
  };
  document.addEventListener('planUpdated', onPlanUpdated);
  cleanupFns.push(() => document.removeEventListener('planUpdated', onPlanUpdated));

  const onPlanExpired = (e) => {
    const label = (window.RehabPlanTiers && window.RehabPlanTiers.PLAN_LABELS[e.detail.previousPlan]) || e.detail.previousPlan;
    showToast(`Your ${label} plan has expired — you no longer have an active subscription.`, 'warning', 6000);
  };
  document.addEventListener('planExpired', onPlanExpired);
  cleanupFns.push(() => document.removeEventListener('planExpired', onPlanExpired));

  // Theme toggle is shared shell chrome (js/theme.js wires #themeToggle
  // globally in index.html) — no page-local listener needed here.

  // ===== Initialize =====
  async function initialize() {
    // A loading animation until the country and the latest plans and prices (admin page) are known.
    showPlansLoading(true);
    const [pricing] = await Promise.all([detectLocation(), PC.whenReady()]);
    showPlansLoading(false);
    updatePlanPrices(getCountryPricing(userCountry) || pricing);

    // The admin changes prices, limits or a promo: the page shows it at once (and the promo countdown ticks).
    const repaint = () => {
      if (!locationKnown && !PC.isReady()) return;
      const p = getCountryPricing(userCountry);
      userCurrency = p.currency; countrySymbol = p.symbol; paymentGateways = p.gateways;
      if (locationFlag) locationFlag.textContent = p.flag;
      if (locationKnown && locationText) locationText.textContent = `Prices in ${p.name} (${p.currency})`;
      if (currencyCode) currencyCode.textContent = p.currency;
      updatePlanPrices(p);
    };
    cleanupFns.push(PC.onChange(repaint));
    const tick = setInterval(repaint, 30000);
    cleanupFns.push(() => clearInterval(tick));

    // Load initial plan
    if (window.rehabPlans) {
      currentPlan = window.rehabPlans.getCurrentPlan() || 'free';
      updateCurrentPlanUI(currentPlan);
    }
  }

  initialize();
  } // end mount()

  function unmount() {
    cleanupFns.forEach(fn => fn());
    cleanupFns = [];
  }

  window.RehablixViews = window.RehablixViews || {};
  window.RehablixViews.subscription = { mount, unmount };
})();
