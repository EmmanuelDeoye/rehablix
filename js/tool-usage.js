// js/tool-usage.js — tracks how often each clinician actually uses each
// workspace tool, so js/workspace.js can rank cards by "most used first"
// instead of a fixed curated order (Workspace personalization, item 1c).
//
// Hooks the SPA router's existing global signal (js/router.js dispatches
// "rehablix:routechange" on every navigation, both the fast keep-alive path
// and the full-mount path) rather than adding tracking calls to every tool
// individually.
(function () {
  // Route name (js/router.js's `routes` keys) -> the `data-tool` value the
  // matching workspace card uses (js/view-templates.js). Project Maker used
  // to be a standalone project.html page outside the router and couldn't be
  // tracked this way; now that it's migrated to the router (js/views/
  // project-view.js), it's trackable like every other tool.
  const ROUTE_TO_TOOL = {
    emr: 'documentation',
    motion: 'rom',
    format: 'format',
    standardized: 'standardized',
    audio: 'audio',
    presentation: 'presentation',
    assignment: 'assignment',
    study: 'study',
    exam: 'exam',
    project: 'project'
  };

  document.addEventListener('rehablix:routechange', (e) => {
    const tool = ROUTE_TO_TOOL[e.detail && e.detail.route];
    if (!tool) return;
    const user = firebase.auth().currentUser;
    if (!user) return;
    firebase.database().ref(`users/${user.uid}/toolUsage/${tool}`)
      .set(firebase.database.ServerValue.increment(1))
      .catch(() => {}); // best-effort — a missed count never breaks the page
  });

  // One-time read for the workspace page to sort cards by. Returns {} for
  // logged-out users or on any error, so callers can just fall back to the
  // existing curated order.
  async function getUsage(uid) {
    if (!uid) return {};
    try {
      const snap = await firebase.database().ref(`users/${uid}/toolUsage`).once('value');
      return snap.val() || {};
    } catch (e) {
      return {};
    }
  }

  window.RehablixToolUsage = { getUsage };
})();
