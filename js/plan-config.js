// js/plan-config.js — plan settings the admin page can change at any time
// (admin.html > Plans & Pricing), read live from the database:
//
//   appConfig/plans/limits/<plan>  { tokens4h, dailyCap }   tokens per 4-hour window and per day;
//                                                          -1 = unlimited, missing = the built-in default (dailyCap: none)
//   appConfig/plans/live/<plan>    { day, month }           Lixa Live minutes
//   appConfig/pricing/<CC|DEFAULT> { currency, symbol, flag, name, gateways: [..in order of preference..],
//                                    student|pro|max: { monthly|yearly: { original, current } } }
//   appConfig/promo                { active, title, message, percent, startsAt, endsAt, plans: { student, pro, max } }
//   appConfig/ai                   the AI limits the SERVER enforces (rehablix-android/backend/functions/ai-config.js):
//                                  { timezone, verifyEmailFrom, plans: { <plan>: { blixDaily, usdDaily, visionDaily,
//                                    searchDaily, motionMonthly, audioMinutesMonthly } }, models, caps, prices, ... }
//                                  read here only to show what is left and what is locked (-1 = unlimited).
//
// Whatever is missing falls back to the built-in values below (and in plan-tiers.js), so
// everything works the same with nothing set. Android: data/PlanConfig.kt, the same rules.
(function () {
  // ===== AI limits (the server's defaults, functions/ai-config.js DEFAULTS: keep in step) =====
  const AI_DEFAULTS = {
    timezone: 'Africa/Lagos',
    verifyEmailFrom: '2026-10-28T00:00:00Z',
    plans: {
      free:    { blixDaily: 0,  usdDaily: 0.03, visionDaily: 2,  searchDaily: 2,   motionMonthly: 5,  audioMinutesMonthly: 10 },
      student: { blixDaily: 0,  usdDaily: 0.20, visionDaily: -1, searchDaily: 20,  motionMonthly: -1, audioMinutesMonthly: -1 },
      pro:     { blixDaily: 25, usdDaily: 0.75, visionDaily: -1, searchDaily: 50,  motionMonthly: -1, audioMinutesMonthly: -1 },
      max:     { blixDaily: 75, usdDaily: 2.00, visionDaily: -1, searchDaily: 100, motionMonthly: -1, audioMinutesMonthly: -1 }
    }
  };
  const AI_KEYS = ['blixDaily', 'usdDaily', 'visionDaily', 'searchDaily', 'motionMonthly', 'audioMinutesMonthly'];
  // ===== Built-in prices (the admin page's starting point) =====
  // "original" = the crossed-out price, "current" = the price paid. Max = 3x Pro unless set.
  // ===== Country-Specific Fixed Prices with "slashed original" illusion =====
  // "original" = crossed-out price shown for discount illusion
  // "current" = actual price user pays
  const COUNTRY_PRICING = {
    // Nigeria (NGN ₦)
    NG: {
      currency: 'NGN', symbol: '₦', flag: '🇳🇬', name: 'Nigeria',
      gateways: ['paystack', 'gpay'],
      student: { 
        monthly: { original: 3699, current: 1999 }, 
        yearly: { original: 36999, current: 18599 } 
      },
      pro: { 
        monthly: { original: 6499, current: 3499 }, 
        yearly: { original: 64999, current: 34499 } 
      }
    },
    // Ghana (GHS GH₵)
    GH: {
      currency: 'GHS', symbol: 'GH₵', flag: '🇬🇭', name: 'Ghana',
      gateways: ['paystack', 'gpay'],
      student: { 
        monthly: { original: 54.99, current: 29.99 }, 
        yearly: { original: 539.99, current: 289.99 } 
      },
      pro: { 
        monthly: { original: 269.99, current: 149.99 }, 
        yearly: { original: 2649.99, current: 1479.99 } 
      }
    },
    // Kenya (KES KSh)
    KE: {
      currency: 'KES', symbol: 'KSh', flag: '🇰🇪', name: 'Kenya',
      gateways: ['flutterwave'],
      student: { 
        monthly: { original: 749, current: 399 }, 
        yearly: { original: 7299, current: 3899 } 
      },
      pro: { 
        monthly: { original: 3699, current: 1999 }, 
        yearly: { original: 35999, current: 19599 } 
      }
    },
    // South Africa (ZAR R)
    ZA: {
      currency: 'ZAR', symbol: 'R', flag: '🇿🇦', name: 'South Africa',
      gateways: ['paystack', 'flutterwave'],
      student: { 
        monthly: { original: 89.99, current: 49.99 }, 
        yearly: { original: 879.99, current: 479.99 } 
      },
      pro: { 
        monthly: { original: 449.99, current: 249.99 }, 
        yearly: { original: 4399.99, current: 2459.99 } 
      }
    },
    // Tanzania (TZS TSh)
    TZ: {
      currency: 'TZS', symbol: 'TSh', flag: '🇹🇿', name: 'Tanzania',
      gateways: ['flutterwave'],
      student: { 
        monthly: { original: 12999, current: 6999 }, 
        yearly: { original: 127999, current: 68999 } 
      },
      pro: { 
        monthly: { original: 64999, current: 34999 }, 
        yearly: { original: 639999, current: 345999 } 
      }
    },
    // Uganda (UGX USh)
    UG: {
      currency: 'UGX', symbol: 'USh', flag: '🇺🇬', name: 'Uganda',
      gateways: ['flutterwave'],
      student: { 
        monthly: { original: 19999, current: 10999 }, 
        yearly: { original: 195999, current: 107999 } 
      },
      pro: { 
        monthly: { original: 99999, current: 54999 }, 
        yearly: { original: 979999, current: 539999 } 
      }
    },
    // Rwanda (RWF RF)
    RW: {
      currency: 'RWF', symbol: 'RF', flag: '🇷🇼', name: 'Rwanda',
      gateways: ['flutterwave'],
      student: { 
        monthly: { original: 6499, current: 3499 }, 
        yearly: { original: 62999, current: 33999 } 
      },
      pro: { 
        monthly: { original: 32499, current: 17499 }, 
        yearly: { original: 317999, current: 171999 } 
      }
    },
    // Cameroon (XAF FCFA)
    CM: {
      currency: 'XAF', symbol: 'FCFA', flag: '🇨🇲', name: 'Cameroon',
      gateways: ['flutterwave'],
      student: { 
        monthly: { original: 3299, current: 1799 }, 
        yearly: { original: 31999, current: 17499 } 
      },
      pro: { 
        monthly: { original: 16499, current: 8999 }, 
        yearly: { original: 160999, current: 87999 } 
      }
    },
    // Côte d'Ivoire (XOF CFA)
    CI: {
      currency: 'XOF', symbol: 'CFA', flag: '🇨🇮', name: "Côte d'Ivoire",
      gateways: ['flutterwave'],
      student: { 
        monthly: { original: 3299, current: 1799 }, 
        yearly: { original: 31999, current: 17499 } 
      },
      pro: { 
        monthly: { original: 16499, current: 8999 }, 
        yearly: { original: 160999, current: 87999 } 
      }
    },
    // Senegal (XOF CFA)
    SN: {
      currency: 'XOF', symbol: 'CFA', flag: '🇸🇳', name: 'Senegal',
      gateways: ['flutterwave'],
      student: { 
        monthly: { original: 3299, current: 1799 }, 
        yearly: { original: 31999, current: 17499 } 
      },
      pro: { 
        monthly: { original: 16499, current: 8999 }, 
        yearly: { original: 160999, current: 87999 } 
      }
    },
    // India (INR ₹)
    IN: {
      currency: 'INR', symbol: '₹', flag: '🇮🇳', name: 'India',
      gateways: ['paystack','gpay'],
      student: { 
        monthly: { original: 549, current: 299 }, 
        yearly: { original: 5399, current: 2899 } 
      },
      pro: { 
        monthly: { original: 1849, current: 999 }, 
        yearly: { original: 17999, current: 9799 } 
      }
    },
    // United States (USD $)
    US: {
      currency: 'USD', symbol: '$', flag: '🇺🇸', name: 'United States',
      gateways: ['gpay'],
      student: { 
        monthly: { original: 5.99, current: 2.99 }, 
        yearly: { original: 59.99, current: 28.99 } 
      },
      pro: { 
        monthly: { original: 19.99, current: 9.99 }, 
        yearly: { original: 199.99, current: 99.99 } 
      }
    },
    // United Kingdom (GBP £)
    GB: {
      currency: 'GBP', symbol: '£', flag: '🇬🇧', name: 'United Kingdom',
      gateways: ['gpay'],
      student: { 
        monthly: { original: 4.99, current: 2.49 }, 
        yearly: { original: 48.99, current: 23.99 } 
      },
      pro: { 
        monthly: { original: 15.99, current: 7.99 }, 
        yearly: { original: 156.99, current: 78.99 } 
      }
    },
    // Canada (CAD CA$)
    CA: {
      currency: 'CAD', symbol: 'CA$', flag: '🇨🇦', name: 'Canada',
      gateways: ['gpay'],
      student: { 
        monthly: { original: 7.99, current: 3.99 }, 
        yearly: { original: 77.99, current: 38.99 } 
      },
      pro: { 
        monthly: { original: 24.99, current: 12.99 }, 
        yearly: { original: 249.99, current: 127.99 } 
      }
    },
    // Australia (AUD A$)
    AU: {
      currency: 'AUD', symbol: 'A$', flag: '🇦🇺', name: 'Australia',
      gateways: ['gpay'],
      student: { 
        monthly: { original: 8.99, current: 4.49 }, 
        yearly: { original: 87.99, current: 43.99 } 
      },
      pro: { 
        monthly: { original: 29.99, current: 14.99 }, 
        yearly: { original: 294.99, current: 147.99 } 
      }
    },
    // Germany (EUR €)
    DE: {
      currency: 'EUR', symbol: '€', flag: '🇩🇪', name: 'Germany',
      gateways: ['gpay'],
      student: { 
        monthly: { original: 5.99, current: 2.99 }, 
        yearly: { original: 57.99, current: 28.99 } 
      },
      pro: { 
        monthly: { original: 18.99, current: 9.49 }, 
        yearly: { original: 184.99, current: 92.99 } 
      }
    },
    // France (EUR €)
    FR: {
      currency: 'EUR', symbol: '€', flag: '🇫🇷', name: 'France',
      gateways: ['gpay'],
      student: { 
        monthly: { original: 5.99, current: 2.99 }, 
        yearly: { original: 57.99, current: 28.99 } 
      },
      pro: { 
        monthly: { original: 18.99, current: 9.49 }, 
        yearly: { original: 184.99, current: 92.99 } 
      }
    },
    // Brazil (BRL R$)
    BR: {
      currency: 'BRL', symbol: 'R$', flag: '🇧🇷', name: 'Brazil',
      gateways: ['gpay'],
      student: { 
        monthly: { original: 29.99, current: 14.99 }, 
        yearly: { original: 289.99, current: 144.99 } 
      },
      pro: { 
        monthly: { original: 99.99, current: 49.99 }, 
        yearly: { original: 979.99, current: 489.99 } 
      }
    },
  };

  // Default/fallback pricing (USD)
  const DEFAULT_PRICING = {
    currency: 'USD', symbol: '$', flag: '🌍', name: 'International',
    gateways: ['gpay'],
    student: { 
      monthly: { original: 5.99, current: 2.99 }, 
      yearly: { original: 59.99, current: 28.99 } 
    },
    pro: { 
      monthly: { original: 19.99, current: 9.99 }, 
      yearly: { original: 199.99, current: 99.99 } 
    }
  };

  const GATEWAYS = ['paystack', 'flutterwave', 'gpay'];
  const MAX_PLAN_MULTIPLIER = 3;
  const READY_TIMEOUT_MS = 6000;

  let limits = {}, live = {}, pricing = {}, promo = null, ai = {};
  let started = false, ready = false;
  const arrived = { plans: false, pricing: false, promo: false };
  const listeners = [];
  let readyResolve;
  const readyPromise = new Promise(r => { readyResolve = r; });

  function changed() { listeners.slice().forEach(fn => { try { fn(); } catch (e) { /* a listener's own problem */ } }); }
  function markReady() { if (!ready) { ready = true; readyResolve(); } changed(); }
  function check() { if (arrived.plans && arrived.pricing && arrived.promo) markReady(); else changed(); }

  /** Starts listening (once); later changes from the admin page arrive at once. */
  function start() {
    if (started) return;
    started = true;
    setTimeout(() => { if (!ready) markReady(); }, READY_TIMEOUT_MS);        // (offline or slow: built-in values)
    let db;
    try { db = firebase.database(); } catch (e) { markReady(); return; }
    const on = (path, fn, key) => db.ref(path).on('value', s => { fn(s.val()); arrived[key] = true; check(); }, () => { arrived[key] = true; check(); });
    on('appConfig/plans', v => { v = v || {}; limits = v.limits || {}; live = v.live || {}; }, 'plans');
    on('appConfig/pricing', v => { pricing = v || {}; }, 'pricing');
    on('appConfig/promo', v => { promo = parsePromo(v || {}); }, 'promo');
    // (not waited for: the built-in AI limits are shown until it arrives)
    db.ref('appConfig/ai').on('value', s => { ai = s.val() || {}; changed(); }, () => {});
  }

  // ===== AI limits (what the server enforces; -1 = unlimited) =====
  /** { blixDaily, usdDaily, visionDaily, searchDaily, motionMonthly, audioMinutesMonthly } for plan. */
  function aiLimits(plan) {
    const d = AI_DEFAULTS.plans[plan] || AI_DEFAULTS.plans.free;
    const set = (ai.plans && ai.plans[plan]) || {};
    const out = {};
    AI_KEYS.forEach(k => {
      const n = Number(set[k]);
      out[k] = set[k] != null && set[k] !== '' && isFinite(n) && (n === -1 || n >= 0) ? n : d[k];
    });
    return out;
  }
  /** The server's clock and the email-verification cutoff. */
  function aiSettings() {
    let tz = AI_DEFAULTS.timezone;
    if (typeof ai.timezone === 'string') { try { new Intl.DateTimeFormat('en-CA', { timeZone: ai.timezone }); tz = ai.timezone; } catch (e) { /* invalid: default */ } }
    const from = typeof ai.verifyEmailFrom === 'string' && isFinite(Date.parse(ai.verifyEmailFrom)) ? ai.verifyEmailFrom : AI_DEFAULTS.verifyEmailFrom;
    // the lowest plan with Blix 360's Deep switch (ai-config.js minPlan.blixDeep)
    const dp = ai.minPlan && ai.minPlan.blixDeep;
    const deepPlan = ['free', 'student', 'pro', 'max'].includes(dp) ? dp : 'max';
    return { timezone: tz, verifyEmailFrom: from, deepPlan };
  }
  /** appConfig/ai as saved (the admin page edits it). */
  function aiRaw() { return JSON.parse(JSON.stringify(ai || {})); }

  function parsePromo(m) {
    if (m.active !== true) return null;
    const percent = Number(m.percent);
    if (!isFinite(percent)) return null;
    const plans = Object.keys(m.plans || {}).filter(k => m.plans[k] === true);
    return {
      title: String(m.title || '').trim() || 'Special offer', message: String(m.message || '').trim(), percent,
      startsAt: Number(m.startsAt) || 0, endsAt: Number(m.endsAt) || Infinity, plans
    };
  }

  // ===== token limits =====
  /** Tokens per 4-hour window for plan (null = unlimited); dflt when the admin has not set it. */
  function tokenBudget(plan, dflt) {
    const v = limits[plan] && Number(limits[plan].tokens4h);
    if (limits[plan] == null || limits[plan].tokens4h == null || !isFinite(v)) return dflt;
    return v < 0 ? null : Math.floor(v);
  }
  /** Tokens per day for plan, or null when there is no daily cap. */
  function dailyCap(plan) {
    const v = limits[plan] && Number(limits[plan].dailyCap);
    return v > 0 ? Math.floor(v) : null;
  }
  /** Lixa Live minutes for plan set by the admin ({day, month}), or null. */
  function liveLimits(plan) { return live[plan] && typeof live[plan] === 'object' ? live[plan] : null; }

  // ===== prices =====
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function triple(t) {
    const s = p => ({ original: Math.round(p.original * MAX_PLAN_MULTIPLIER * 100) / 100, current: Math.round(p.current * MAX_PLAN_MULTIPLIER * 100) / 100 });
    return { monthly: s(t.monthly), yearly: s(t.yearly) };
  }
  /** The prices for a country now: the built-in ones with whatever the admin has set (DEFAULT for unlisted countries). */
  function pricingFor(code) {
    const known = Object.prototype.hasOwnProperty.call(COUNTRY_PRICING, code);
    const base = clone(known ? COUNTRY_PRICING[code] : DEFAULT_PRICING);
    let m = pricing[code];
    if (!m && !known) m = pricing.DEFAULT;
    if (!m) { if (!base.max) base.max = triple(base.pro); return base; }
    const num = v => { const n = Number(v); return isFinite(n) && n > 0 ? n : null; };
    const pair = (o, b) => { o = o || {}; const cur = num(o.current) || b.current; const orig = num(o.original) || b.original; return { original: Math.max(orig, cur), current: cur }; };
    const tier = (o, b) => { o = o || {}; return { monthly: pair(o.monthly, b.monthly), yearly: pair(o.yearly, b.yearly) }; };
    const str = (v, d) => (typeof v === 'string' && v.trim() ? v.trim() : d);
    const gw = (Array.isArray(m.gateways) ? m.gateways : Object.values(m.gateways || {})).filter(g => GATEWAYS.indexOf(g) >= 0);
    const out = {
      currency: str(m.currency, base.currency), symbol: str(m.symbol, base.symbol), flag: str(m.flag, base.flag), name: str(m.name, base.name),
      gateways: gw.length ? gw.filter((g, i) => gw.indexOf(g) === i) : base.gateways,
      student: tier(m.student, base.student), pro: tier(m.pro, base.pro)
    };
    out.max = m.max ? tier(m.max, triple(out.pro)) : (base.max || triple(out.pro));
    return out;
  }

  /** The promo running now for plan, if any. */
  function promoFor(plan, now) {
    now = now || Date.now();
    if (!promo || !(promo.percent > 0 && promo.percent < 100) || now < promo.startsAt || now >= promo.endsAt) return null;
    return promo.plans.length && promo.plans.indexOf(plan) < 0 ? null : promo;
  }
  /** price with percent off: whole amounts stay whole, others keep two decimals. */
  function promoPrice(price, percent) {
    const p = price * (1 - percent / 100);
    return price % 1 === 0 ? Math.max(1, Math.round(p)) : Math.max(0.01, Math.round(p * 100) / 100);
  }
  /** What a plan costs now: { slashed (or null), pay, promo }. During a promo the usual price is struck through. */
  function shownPrice(prices, plan, yearly, now) {
    const p = yearly ? prices[plan].yearly : prices[plan].monthly;
    const pr = promoFor(plan, now);
    if (pr) return { slashed: p.current, pay: promoPrice(p.current, pr.percent), promo: pr };
    return { slashed: plan === 'max' ? null : p.original, pay: p.current, promo: null };
  }

  window.RehablixPlanConfig = {
    start, isReady: () => ready, whenReady: () => { start(); return readyPromise; },
    onChange(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    tokenBudget, dailyCap, liveLimits, pricingFor, promoFor, promoPrice, shownPrice, triple,
    aiLimits, aiSettings, aiRaw, AI_DEFAULTS,
    defaultCountryPricing: () => clone(COUNTRY_PRICING), defaultPricing: () => clone(DEFAULT_PRICING),
    GATEWAYS, MAX_PLAN_MULTIPLIER
  };
  // (the quota and the plans need the admin's limits as soon as the app opens)
  if (typeof firebase !== 'undefined') { try { if (firebase.apps && firebase.apps.length) start(); } catch (e) { /* started on first use */ } }
})();
