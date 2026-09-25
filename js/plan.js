// js/plan.js – Feature gating based on subscription plan

(function () {
  const database = firebase.database();
  const auth = firebase.auth();

  // Minimum plan required for each feature
  const featureMinPlans = {
    assessment: 'free',
    standardized: 'free',
    documentation: 'free',
    rom: 'free',        // free with limited usage (1/mo)
    gait: 'student',    // student gets 5/mo, pro unlimited
    // presentation: no longer plan-gated — it shares Lixa's model choice
    // and token quota (js/plan-tiers.js) instead.
    assignment: 'student',
    project: 'student',
    study: 'student',
    exam: 'student',

    // Project Maker sub-features (Project Maker redesign) — finer-grained
    // than the umbrella 'project' key above, replacing what used to be a
    // set of local can*() checks hardcoded inside project.js itself.
    'project.aiSupervisor': 'student',
    'project.generateBeyondCh1': 'student',
    'project.regenerate': 'student',
    'project.resources': 'student',
    'project.deepScan': 'pro',
    'project.customOutline': 'student',
    'project.referenceManager': 'student',
    'project.chapterReview': 'student',
  };

  // Numeric level for comparison — single source of truth in plan-tiers.js
  // (adds the 'max' tier above 'pro'); falls back locally if that script
  // hasn't loaded for some reason.
  const planLevel = (window.RehabPlanTiers && window.RehabPlanTiers.PLAN_LEVEL) || { free: 0, student: 1, pro: 2, max: 3 };

  let currentPlan = null; // 'free' | 'student' | 'pro' | null
  let currentSubscription = null; // full record: {plan, starts, ends, renewal, ...}
  let subscriptionRef = null; // the live .on('value') ref for whichever user is currently signed in

  // Check whether a feature is allowed
  function isFeatureAllowed(feature) {
    if (!currentPlan) return false;
    const required = featureMinPlans[feature];
    if (!required) return false;
    return (planLevel[currentPlan] || 0) >= (planLevel[required] || 0);
  }

  // Expose current plan
  function getCurrentPlan() {
    return currentPlan;
  }

  // Fetch and cache user's subscription.
  //
  // PAYMENT FIX (item 5): this used to be a one-time `.once('value')` read.
  // js/upgrade.js writes the new plan straight to this same path after a
  // successful payment and manually dispatches 'planUpdated' for immediate
  // UI feedback, but this module — the actual source of truth behind
  // getCurrentPlan()/daysUntilExpiry() — never listened for that event, so
  // its own cache stayed stale until the next full auth reload. A live
  // `.on('value', ...)` listener means currentPlan/currentSubscription
  // self-correct the instant Firebase's copy changes, from any source
  // (this tab's own payment, another tab, another device), closing that
  // staleness bug everywhere in the app that calls into this module.
  function loadSubscription(user) {
    // Detach whatever the previously signed-in user's listener was —
    // otherwise switching accounts could keep reacting to the wrong uid's data.
    if (subscriptionRef) { subscriptionRef.off('value'); subscriptionRef = null; }

    if (!user) {
      currentPlan = null;
      currentSubscription = null;
      dispatchUpdate();
      return;
    }

    subscriptionRef = database.ref(`users/${user.uid}/subscription`);
    subscriptionRef.on('value', async (snap) => {
      try {
        const sub = snap.val();
        if (sub && sub.plan && planLevel[sub.plan] !== undefined) {
          // A paid plan that has passed its "ends" date is no longer valid —
          // this is the check that was missing, which let expired Pro/Student
          // subscriptions keep working forever. Free plans use a far-future
          // "ends" date on purpose, so they never trip this.
          const isExpired = sub.plan !== 'free' && sub.ends && new Date(sub.ends).getTime() < Date.now();

          if (isExpired) {
            const downgraded = {
              plan: 'free',
              starts: new Date().toISOString(),
              ends: new Date(2099, 11, 31).toISOString(),
              renewal: 'manual',
              downgradedFrom: sub.plan,
              downgradedAt: new Date().toISOString()
            };
            // This write re-triggers this same listener once more; the second
            // pass sees plan:'free' (not expired) and just re-confirms it —
            // harmless, not an infinite loop.
            await subscriptionRef.set(downgraded);
            currentPlan = 'free';
            currentSubscription = downgraded;
            // Let pages show a "your plan expired" notice if they want to,
            // without forcing every page that loads plan.js to handle it.
            document.dispatchEvent(new CustomEvent('planExpired', { detail: { previousPlan: sub.plan } }));
          } else {
            currentPlan = sub.plan;
            currentSubscription = sub;
          }
        } else {
          // No subscription → treat as free & persist it (also re-triggers
          // this listener once, harmlessly, same as above).
          const fresh = {
            plan: 'free',
            starts: new Date().toISOString(),
            ends: new Date(2099, 11, 31).toISOString(),
            renewal: 'manual',
          };
          await subscriptionRef.set(fresh);
          currentPlan = 'free';
          currentSubscription = fresh;
        }
      } catch (error) {
        console.error('[plan.js] Subscription fetch failed:', error);
        currentPlan = 'free'; // fallback
        currentSubscription = null;
      }
      dispatchUpdate();
    }, (error) => {
      console.error('[plan.js] Subscription listener error:', error);
      currentPlan = 'free';
      currentSubscription = null;
      dispatchUpdate();
    });
  }

  // Days left until the current paid plan expires (null if free or unknown)
  function daysUntilExpiry() {
    if (!currentSubscription || currentPlan === 'free' || !currentSubscription.ends) return null;
    const ms = new Date(currentSubscription.ends).getTime() - Date.now();
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
  }

  // Fire custom event so pages can react
  function dispatchUpdate() {
    document.dispatchEvent(
      new CustomEvent('planUpdated', { detail: { plan: currentPlan } })
    );
  }

  // Listen to auth changes and load subscription
  auth.onAuthStateChanged((user) => loadSubscription(user));

  // Expose public API
  window.rehabPlans = {
    isFeatureAllowed,
    getCurrentPlan,
    getSubscription: () => currentSubscription,
    daysUntilExpiry,
    planLevel,
    featureMinPlans,

    // Default upgrade prompt (can be overridden by page)
    showUpgradePrompt(feature) {
      const required = featureMinPlans[feature] || 'pro';
      const names = (window.RehabPlanTiers && window.RehabPlanTiers.PLAN_LABELS) || { free: 'Free', student: 'Basic', pro: 'Pro', max: 'Max' };
      const msg = `This feature requires the ${names[required]} plan. Please upgrade to continue.`;
      // Use a toast if available, otherwise alert
      if (typeof showToast === 'function') {
        showToast(msg, 'error', 5000);
      } else {
        alert(msg);
      }
    },
  };
})();