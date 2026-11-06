// js/views/project-view.js — Project Maker, migrated from the old standalone
// project.html/js/project.js into a native SPA view (js/router.js calls
// mount() after injecting the "project" template — js/view-templates.js —
// into #appRoot), following the exact pattern used for Smart EMR's
// doc.html -> js/views/emr-view.js migration. Registered as a keep-alive
// route (like Lixa/Workspace/EMR) for the same reason EMR is: this is one
// big closure with many one-time listener bindings, exactly like the
// original page had.
//
// REDESIGN: the old flat 3-column editor is now one of six screens
// (Dashboard / Setup / Chapter Workspace / Review / Export / Project
// Tools), switched via switchScreen() — see the "project" template's
// #projScreen* containers. The original editor's logic (chapters render,
// generation pipeline, AI Supervisor chat, export, resources, version
// history, humanization scoring) is carried over as-is inside the
// Workspace screen wherever possible ("reuse working logic, don't rewrite
// it") — changes are marked "SPA:" or "REDESIGN:".
(function () {
  let cleanupFns = [];
  let onShow = function () {};

  async function mount() {
    console.log('[Project] Initializing...');

    // =========================================================================
    // DOM Elements
    // =========================================================================
    const navItems = document.querySelectorAll('.proj-nav-item[data-screen]');
    const screens = {
      projects: document.getElementById('projScreenProjects'),
      dashboard: document.getElementById('projScreenDashboard'),
      setup: document.getElementById('projScreenSetup'),
      workspace: document.getElementById('projScreenWorkspace'),
      review: document.getElementById('projScreenReview'),
      export: document.getElementById('projScreenExport'),
      tools: document.getElementById('projScreenTools')
    };
    // REDESIGN (Round 4 item 1): the breadcrumb ("All Projects" back-link +
    // truncated title) was removed from the template — the shared navbar
    // back button (js/bottom-nav.js) already provides back-navigation, and
    // the title is already shown in Dashboard/Workspace. setProjectActive()
    // is kept as a no-op call site (harmless — every element it touches is
    // now null) rather than stripping every call site across this file.
    const projNavBar = document.getElementById('projNavBar');
    const projBreadcrumb = document.getElementById('projBreadcrumb');
    const projBreadcrumbTitle = document.getElementById('projBreadcrumbTitle');
    function setProjectActive(active) {
      if (projNavBar) projNavBar.style.display = active ? '' : 'none';
      if (projBreadcrumb) projBreadcrumb.style.display = active ? 'flex' : 'none';
      if (projBreadcrumbTitle) projBreadcrumbTitle.textContent = active && currentProject ? currentProject.title : '';
    }

    // REDESIGN (Round 4 item 3): persist which project/screen is open so a
    // sudden browser reload lands back where the student was instead of
    // always restarting at the "All Projects" list. Chapter/section within
    // a project is already restored via Firebase's dashboard.lastOpenedChapter/
    // lastOpenedSection (persistLastOpened(), below) — this only adds the
    // missing piece: which project, and which of its screens, was open.
    const ACTIVE_STATE_KEY = 'rehab_project_active_state';
    function saveActiveState(screenName) {
      try {
        if (currentProjectId && screenName && screenName !== 'projects') {
          localStorage.setItem(ACTIVE_STATE_KEY, JSON.stringify({ projectId: currentProjectId, screen: screenName }));
        } else if (screenName === 'projects') {
          localStorage.removeItem(ACTIVE_STATE_KEY);
        }
      } catch (e) { /* localStorage unavailable — restoration simply won't happen */ }
    }
    function loadActiveState() {
      try { return JSON.parse(localStorage.getItem(ACTIVE_STATE_KEY) || 'null'); } catch (e) { return null; }
    }
    function clearActiveState() {
      try { localStorage.removeItem(ACTIVE_STATE_KEY); } catch (e) {}
    }
    // REDESIGN (item 3): 'projects' (the "All Projects" list) is the true
    // root screen now — was still 'dashboard' here from before that screen
    // existed, which desynced this stack from switchScreen('projects', {
    // suppressHistory: true })'s actual initial screen and made the shared
    // back button skip straight past "All Projects" when stepping back out
    // of an open project.
    let screenHistory = ['projects'];

    const chaptersList = document.getElementById('chaptersList');
    const sectionEditor = document.getElementById('sectionEditor');
    const currentSectionTitle = document.getElementById('currentSectionTitle');
    const workspaceProgressFill = document.getElementById('workspaceProgressFill');
    const workspaceProgressLabel = document.getElementById('workspaceProgressLabel');
    const prevSectionBtn = document.getElementById('prevSectionBtn');
    const nextSectionBtn = document.getElementById('nextSectionBtn');
    const aiGenerateSectionBtn = document.getElementById('aiGenerateSectionBtn');
    const aiGenerateChapterBtn = document.getElementById('aiGenerateChapterBtn');
    const chapterGenBtnText = document.getElementById('chapterGenBtnText');
    const aiChatMessages = document.getElementById('aiChatMessages');
    const aiMessageInput = document.getElementById('aiMessageInput');
    const aiSendBtn = document.getElementById('aiSendBtn');
    const saveSectionBtn = document.getElementById('saveSectionBtn');
    const exportWordBtn = document.getElementById('exportWordBtn');
    const exportPdfBtn = document.getElementById('exportPdfBtn');
    const toggleChaptersBtn = document.getElementById('toggleChaptersBtn');
    const toggleAIPanelBtn = document.getElementById('toggleAIPanelBtn');
    const chaptersSidebar = document.getElementById('chaptersSidebar');
    const aiPanel = document.getElementById('aiPanel');
    const closeChaptersBtn = document.getElementById('closeChaptersBtn');
    const closeAIPanelBtn = document.getElementById('closeAIPanelBtn');
    const projectModal = document.getElementById('projectModal');
    const closeProjectModalBtn = document.getElementById('closeProjectModal');
    const createProjectBtn = document.getElementById('createProjectBtn');
    const nextToOutlineBtn = document.getElementById('nextToOutlineBtn');
    const backToStep1Btn = document.getElementById('backToStep1Btn');
    const projectTitleInput = document.getElementById('projectTitle');
    const projectTypeSelect = document.getElementById('projectType');
    const projectDeptSelect = document.getElementById('projectDept');
    const projectApproachSelect = document.getElementById('projectApproach');
    const projectOutlineType = document.getElementById('projectOutlineType');
    const customOutlineInput = document.getElementById('customOutlineInput');
    const currentProjectSelect = document.getElementById('currentProjectSelect');
    const newProjectBtn = document.getElementById('newProjectBtn');
    // FIX: this id used to be "aiProgressModal", which Smart EMR's template
    // also uses (its Progress-tab AI panel). EMR is keep-alive, so once it had
    // been opened getElementById() returned EMR's hidden panel and the
    // generation progress modal never appeared here (reported on desktop).
    const aiProgressModal = document.getElementById('projAiProgressModal');
    const cancelGenerateBtn = document.getElementById('cancelGenerateBtn');
    const closeProgressModal = document.getElementById('closeProgressModal');
    const progressStage = document.getElementById('progressStage');
    const progressBarFill = document.getElementById('progressBarFill');
    const progressDetail = document.getElementById('progressDetail');
    const aiToneSelect = document.getElementById('aiToneSelect');
    const humanizeCheckbox = document.getElementById('humanizeCheckbox');
    const humanizeWarningModal = document.getElementById('humanizeWarningModal');
    const closeHumanizeWarning = document.getElementById('closeHumanizeWarning');
    const confirmHumanizeBtn = document.getElementById('confirmHumanizeBtn');
    const cancelHumanizeBtn = document.getElementById('cancelHumanizeBtn');
    const modificationInput = document.getElementById('modificationInput');
    const modificationArea = document.getElementById('modificationArea');
    const writingProfileSelect = document.getElementById('writingProfileSelect');
    const saveVersionBtn = document.getElementById('saveVersionBtn');
    const versionList = document.getElementById('versionList');
    const aiScoreDisplay = document.getElementById('aiScoreDisplay');
    const humanizationScoreEl = document.getElementById('humanizationScore');
    const scoreFillEl = document.getElementById('scoreFill');
    const scoreSentenceVarEl = document.getElementById('scoreSentenceVar');
    const scorePredictabilityEl = document.getElementById('scorePredictability');
    const scoreAILikelyEl = document.getElementById('scoreAILikely');
    const scorePlanBadge = document.getElementById('scorePlanBadge');
    const badgeFree = scorePlanBadge ? scorePlanBadge.querySelector('.badge-free') : null;
    const badgePremium = scorePlanBadge ? scorePlanBadge.querySelector('.badge-premium') : null;
    const toastContainer = document.getElementById('toast-container');
    const unsavedOverlay = document.getElementById('unsavedOverlay');
    const saveNowBtn = document.getElementById('saveNowBtn');
    const resourceFileInput = document.getElementById('resourceFileInput');
    const uploadStatus = document.getElementById('uploadStatus');
    const resourceList = document.getElementById('resourceList');
    const supervisorStrictness = document.getElementById('supervisorStrictness');
    const supervisorProfession = document.getElementById('supervisorProfession');
    const resourceToggleBtn = document.getElementById('resourceToggleBtn');
    const resourcesPanel = document.getElementById('resourcesPanel');
    const backToChaptersBtn = document.getElementById('backToChaptersBtn');
    const defaultPromptsBar = document.getElementById('defaultPromptsBar');
    const defaultPromptsScroll = document.getElementById('defaultPromptsScroll');
    const advancedToggleBtn = document.getElementById('advancedToggleBtn');
    const advancedPanel = document.getElementById('advancedPanel');
    const projectAIActions = document.getElementById('projectAIActions');

    const wordCountSelect = document.getElementById('wordCountSelect');
    const customWordCountInput = document.getElementById('customWordCount');
    const referenceStyleSelect = document.getElementById('referenceStyleSelect');
    const exportScopeSelect = document.getElementById('exportScopeSelect');

    const formatBtns = document.querySelectorAll('.format-btn');
    // Unique ids (result/docresult also have #fontFamilySelect/#fontSizeSelect).
    const fontFamilySelect = document.getElementById('projFontFamilySelect');
    const fontSizeSelect = document.getElementById('projFontSizeSelect');

    // =========================================================================
    // State
    // =========================================================================
    let currentUser = null;
    let scopeUid = null;
    let projects = {};
    let currentProjectId = null;
    let currentProject = null;
    let currentChapter = null;
    let currentSection = null;
    let humanizeMode = false;
    let resources = [];
    let supervisorPersonality = { strictness: 'moderate', profession: 'Academic Supervisor' };
    // Legacy hardcoded DeepSeek client — kept as-is for the 3 pre-existing AI
    // call sites (resource analysis, section generation, supervisor chat) to
    // minimize behavior-change risk in this pass. New Project AI actions (see
    // §Project AI below) go through js/ai-quota-core.js's shared tiered/
    // quota-aware model resolution instead.
    let aiConfig = { token: null, endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash' };
    let aiAbortController = null;
    let autoSaveTimer = null;
    let unsavedChanges = false;
    let chapterGenerationActive = false;
    let typingIndicator = null;
    const database = firebase.database();

    // Plan gating state
    let currentPlan = 'free';
    let projectCreationCount = 0;
    let creationResetDate = null;
    const FREE_PROJECT_LIMIT = 1;
    const LIMIT_DAYS = 30;

    // =========================================================================
    // NATURAL PUNCTUATION RULES
    // =========================================================================
    const PUNCTUATION_RULES = `PUNCTUATION RULES - STRICT ENFORCEMENT:
1. Use ONLY natural punctuation: periods (.), commas (,), colons (:), semicolons (;), question marks (?), exclamation marks (!), parentheses (), quotation marks (""), and apostrophes (').
2. NEVER use em dashes or en dashes or any special dash characters. Use commas or semicolons instead.
3. NEVER use ellipsis characters. Use three periods (...) if absolutely necessary, but prefer complete sentences.
4. Use commas naturally, as a human would when pausing in speech. Do not overuse them.
5. Use periods to end sentences. Keep sentences at a natural length, not too short, not too long.
6. Use question marks only for actual questions, not rhetorical ones unless they fit naturally.
7. Colons should introduce lists or explanations. Semicolons should connect related independent clauses sparingly.
8. Avoid excessive punctuation of any kind. If a sentence works without a comma, leave it out.
9. Write as a human would type, natural, flowing, with occasional minor imperfections in punctuation that make it feel real.
10. Parentheses should be used sparingly for brief clarifications only.`;

    // =========================================================================
    // ERROR REPORTER
    // =========================================================================
    function reportError(error, context) {
      context = context || '';
      const timestamp = new Date().toISOString();
      const errorDetails = {
        message: error.message || String(error), stack: error.stack || 'No stack trace',
        context: context, timestamp: timestamp,
        user: currentUser ? currentUser.email : 'anonymous', projectId: currentProjectId || 'none'
      };
      console.error('[ERROR][' + timestamp + '] ' + context + ':', errorDetails);
      if (currentUser && scopeUid) {
        try {
          database.ref('errorLogs/' + scopeUid).push({
            message: errorDetails.message, stack: errorDetails.stack, context: errorDetails.context,
            timestamp: errorDetails.timestamp, userAgent: navigator.userAgent
          }).catch(function () {});
        } catch (e) { console.warn('Could not log error to Firebase:', e); }
      }
      if (!error.message || !error.message.includes('AbortError')) {
        showToast(getErrorMessage(error, context), 'error', 5000);
      }
    }

    function getErrorMessage(error, context) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout')) return 'Network error. Please check your connection and try again.';
      if (msg.includes('permission') || msg.includes('unauthorized')) return 'You do not have permission to perform this action.';
      if (msg.includes('quota') || msg.includes('rate limit')) return 'Too many requests. Please wait a moment and try again.';
      if (msg.includes('api') || msg.includes('token')) return 'SI service temporarily unavailable. Please try again later.';
      if (context.includes('save')) return 'Failed to save your work. Please try again.';
      if (context.includes('generate')) return 'Content generation failed. Please try again.';
      return 'An error occurred' + (context ? ' during ' + context : '') + '. Please try again.';
    }

    // =========================================================================
    // PLAN GATING — REDESIGN: replaced project.js's 7 hand-rolled can*()
    // checks with window.rehabPlans.isFeatureAllowed('project.xxx') so
    // Project Maker's gating lives in the same place every other tool's
    // does (js/plan.js). Function NAMES are kept identical so every call
    // site below (near-verbatim port of the original) needs no changes.
    // The free-tier project-creation counter is the one piece intentionally
    // LEFT AS localStorage-based for this pass (a Firebase-backed counter
    // is a well-scoped, independent follow-up — see project notes).
    // =========================================================================
    function isAllowed(feature) {
      return window.rehabPlans ? window.rehabPlans.isFeatureAllowed(feature) : (currentPlan === 'student' || currentPlan === 'pro');
    }

    function loadPlanData() {
      try {
        const data = JSON.parse(localStorage.getItem('rehab_project_plan_data') || '{}');
        projectCreationCount = data.count || 0;
        creationResetDate = data.resetDate ? new Date(data.resetDate) : null;
        const now = new Date();
        if (!creationResetDate || (now - creationResetDate) >= LIMIT_DAYS * 86400000) {
          projectCreationCount = 0; creationResetDate = now; savePlanData();
        }
      } catch (e) {
        projectCreationCount = 0; creationResetDate = new Date(); savePlanData();
      }
    }

    function savePlanData() {
      localStorage.setItem('rehab_project_plan_data', JSON.stringify({
        count: projectCreationCount, resetDate: creationResetDate ? creationResetDate.toISOString() : new Date().toISOString()
      }));
    }

    function canCreateProject() {
      if (isAllowed('project')) return true;
      loadPlanData();
      const now = new Date();
      if (!creationResetDate || (now - creationResetDate) >= LIMIT_DAYS * 86400000) {
        projectCreationCount = 0; creationResetDate = now; savePlanData();
        return true;
      }
      return projectCreationCount < FREE_PROJECT_LIMIT;
    }

    function incrementProjectCount() {
      if (isAllowed('project')) return;
      projectCreationCount++;
      savePlanData();
      updatePlanUI();
    }

    function canAccessAISupervisor() { return isAllowed('project.aiSupervisor'); }
    function canGenerateChapter(chapterKey) { return isAllowed('project.generateBeyondCh1') || chapterKey === 'chapter1'; }
    function canRegenerate() { return isAllowed('project.regenerate'); }
    function canAccessResources() { return isAllowed('project.resources'); }
    function canAccessDeepScan() { return isAllowed('project.deepScan'); }
    function canUseCustomOutline() { return isAllowed('project.customOutline'); }
    function canAccessReferenceManager() { return isAllowed('project.referenceManager'); }
    function canAccessChapterReview() { return isAllowed('project.chapterReview'); }

    function getDaysUntilReset() {
      if (!creationResetDate) return 0;
      const diffTime = LIMIT_DAYS * 86400000 - (new Date() - creationResetDate);
      return Math.max(0, Math.ceil(diffTime / 86400000));
    }

    function goToSubscription() { window.RehablixRouter.go('#/subscription'); }

    // =========================================================================
    // PLAN UI
    // =========================================================================
    function updatePlanUI() {
      updateChapterGenButton();
      if (badgeFree && badgePremium) {
        if (canAccessDeepScan()) { badgeFree.style.display = 'none'; badgePremium.style.display = 'inline-flex'; }
        else { badgeFree.style.display = 'inline-block'; badgePremium.style.display = 'none'; }
      }
      updateSupervisorAccess();
      const existingNotice = document.getElementById('projectPlanNotice');
      if (existingNotice) existingNotice.remove();
      if (!isAllowed('project')) {
        const notice = document.createElement('div');
        notice.id = 'projectPlanNotice';
        const remaining = FREE_PROJECT_LIMIT - projectCreationCount;
        const daysLeft = getDaysUntilReset();
        notice.style.cssText = 'background: #fef3c7; border: 2px solid #fbbf24; border-radius: 1rem; padding: 0.8rem 1rem; margin: 0 0 0.75rem 0; text-align: center; font-size: 0.82rem; color: #92400e;';
        notice.innerHTML = '<div style="font-weight: 600; font-size: 0.9rem; margin-bottom: 0.25rem;">No Active Plan</div>' +
          '<div style="margin-bottom: 0.25rem; font-size: 0.78rem;"><strong>' + FREE_PROJECT_LIMIT + '</strong> project/month, Chapter 1 only, No Project SI chat</div>' +
          (remaining <= 0 ? '<div style="color: #dc2626; font-size: 0.75rem; margin-bottom: 0.3rem;">Resets in <strong>' + daysLeft + '</strong> days</div>' : '') +
          '<button id="upgradeProjectBtn" style="margin-top: 0.3rem; padding: 0.4rem 1.2rem; border-radius: 2rem; background: linear-gradient(135deg, #f59e0b, #d97706); color: white; border: none; cursor: pointer; font-weight: 600; font-size: 0.8rem;">Upgrade for Full Access</button>';
        const dashActivity = document.getElementById('dashRecentActivity');
        if (dashActivity && dashActivity.parentElement) dashActivity.parentElement.insertBefore(notice, dashActivity);
        const upgradeBtn = document.getElementById('upgradeProjectBtn');
        if (upgradeBtn) upgradeBtn.addEventListener('click', goToSubscription);
      }
    }

    // =========================================================================
    // HELPERS
    // =========================================================================
    function showToast(message, type, duration) {
      type = type || 'success'; duration = duration || 3500;
      const toast = document.createElement('div');
      toast.className = 'toast ' + type;
      toast.textContent = message;
      toastContainer.appendChild(toast);
      setTimeout(function () {
        toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s';
        setTimeout(function () { toast.remove(); }, 300);
      }, duration);
    }

    function escapeHtml(str) {
      if (str == null || str === '') return '';
      // quotes too: tool panes put escaped text inside attributes (data-quote="…", option values)
      return String(str).replace(/[&<>"]/g, function (m) { return m === '&' ? '&amp;' : m === '<' ? '&lt;' : m === '>' ? '&gt;' : '&quot;'; });
    }

    async function fetchTokens() {
      try {
        const snap = await database.ref('tokens/deepseek').once('value');
        const data = snap.val();
        if (data && data.api_key) { aiConfig.token = data.api_key; return true; }
        console.warn('DeepSeek API key missing');
        return false;
      } catch (error) { reportError(error, 'token fetch'); return false; }
    }

    function extractPlainText(html) {
      if (!html) return '';
      const div = document.createElement('div');
      div.innerHTML = html;
      return div.textContent || div.innerText || '';
    }

    function extractKeyTerms(text) {
      const terms = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || [];
      const unique = [...new Set(terms)].filter(function (t) { return t.length > 10 && t.length < 80; });
      return unique.slice(0, 8);
    }

    async function readFileAsText(file) {
      return new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.onload = function (e) { resolve(e.target.result); };
        reader.onerror = function () { reject(new Error('File read failed')); };
        if (file.type === 'application/pdf') {
          resolve('[PDF file: ' + file.name + ' - Full text extraction requires server-side processing. Basic metadata only.]');
        } else {
          reader.readAsText(file);
        }
      });
    }

    // =========================================================================
    // SCREEN SWITCHER — REDESIGN: the core new-UX piece. Modeled on
    // js/views/emr-view.js's switchScreen() (toggle .active, maintain a
    // back-stack, call a per-screen loader on entry).
    // =========================================================================
    function switchScreen(name, opts) {
      opts = opts || {};
      if (!screens[name]) return;
      Object.values(screens).forEach(function (s) { if (s) s.classList.remove('active'); });
      screens[name].classList.add('active');
      navItems.forEach(function (item) { item.classList.toggle('active', item.dataset.screen === name); });
      if (!opts.suppressHistory && screenHistory[screenHistory.length - 1] !== name) screenHistory.push(name);

      if (name === 'projects') { if (projectsLoaded) renderProjectsListScreen(); else if (signedOut) renderSignedOutProjects(); else renderProjectsShimmer(); }
      if (name === 'dashboard') renderDashboard();
      if (name === 'workspace' && typeof maybeShowCollapseTutorial === 'function') maybeShowCollapseTutorial();
      if (name === 'setup') renderSetupScreen();
      if (name === 'review') renderReviewScreen();
      if (name === 'export') renderExportScreen();
      if (name === 'tools') renderToolsScreen();
      saveActiveState(name);

      window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    }

    navItems.forEach(function (item) {
      item.addEventListener('click', function () {
        if (item.dataset.screen === 'workspace' || item.dataset.screen === 'setup' || item.dataset.screen === 'review' || item.dataset.screen === 'export') {
          if (!currentProjectId) { showToast('Select or create a project first', 'error'); return; }
        }
        if (screens.workspace && screens.workspace.classList.contains('active')) { saveCurrentSection(); saveToFirebase(); }
        switchScreen(item.dataset.screen);
      });
    });

    // REDESIGN (item 3): "All Projects" list — the new landing screen.
    // REDESIGN (Round 3 items 1-2): a shimmer placeholder shows while
    // loadProjects()'s Firebase read is in flight (see the `projectsLoaded`
    // flag below), and a search bar filters the grid by title.
    let projectsLoaded = false;
    let signedOut = false; // auth has answered and nobody is signed in
    function renderSignedOutProjects() {
      const grid = document.getElementById('projectsListGrid');
      if (!grid) return;
      grid.innerHTML = '<div class="emr-empty-state"><i class="bx bx-lock-alt"></i><p>Log in to see your projects</p><small>Your projects are saved to your account, on the web and the Android app.</small><button type="button" class="btn btn-primary" id="projectsLoginBtn" style="margin-top:0.8rem;">Log in</button></div>';
      document.getElementById('projectsLoginBtn')?.addEventListener('click', function () { document.getElementById('loginBtn')?.click(); });
    }
    function renderProjectsShimmer() {
      const grid = document.getElementById('projectsListGrid');
      if (!grid) return;
      grid.innerHTML = Array.from({ length: 3 }).map(function () {
        return '<div class="project-card-item project-card-shimmer"><div class="shimmer-line shimmer-title"></div><div class="shimmer-line shimmer-title-2"></div><div class="shimmer-line shimmer-meta"></div><div class="shimmer-line shimmer-bar"></div><div class="shimmer-line shimmer-footer"></div></div>';
      }).join('');
    }

    function renderProjectsListScreen() {
      const grid = document.getElementById('projectsListGrid');
      if (!grid) return;
      const searchInput = document.getElementById('projectsSearchInput');
      const query = ((searchInput && searchInput.value) || '').trim().toLowerCase();
      let entries = Object.entries(projects).sort(function (a, b) { return (b[1].updatedAt || b[1].createdAt || 0) - (a[1].updatedAt || a[1].createdAt || 0); });
      if (query) entries = entries.filter(function (entry) { return (entry[1].title || '').toLowerCase().includes(query); });
      if (!entries.length) {
        grid.innerHTML = query
          ? '<div class="emr-empty-state"><i class="bx bx-search-alt"></i><p>No projects match "' + escapeHtml(query) + '"</p></div>'
          : '<div class="emr-empty-state"><i class="bx bx-folder-open"></i><p>No projects yet</p><small>Create your first academic project to get started</small></div>';
        return;
      }
      grid.innerHTML = entries.map(function (entry) {
        const id = entry[0], proj = entry[1];
        // Index entries carry a precomputed progress; full records compute it.
        const progress = proj.chapters ? computeProgress(proj) : { pct: proj.progressPct || 0 };
        const date = proj.createdAt ? new Date(proj.createdAt).toLocaleDateString() : 'Unknown date';
        const approachLabel = proj.approach === 'qualitative' ? 'Qualitative' : 'Quantitative';
        const isCurrent = id === currentProjectId;
        return '<div class="project-card-item' + (isCurrent ? ' project-card-current' : '') + '" data-id="' + id + '">' +
          (isCurrent ? '<span class="project-card-badge">Currently open</span>' : '') +
          '<div class="project-card-title">' + escapeHtml(proj.title || 'Untitled Project') + '</div>' +
          '<div class="project-card-meta">' + escapeHtml(proj.type || 'N/A') + ' &middot; ' + approachLabel + ' &middot; ' + escapeHtml(proj.department || 'N/A') + '</div>' +
          '<div class="progress-bar-mini"><div class="progress-fill" style="width:' + progress.pct + '%;background:var(--project-accent);"></div></div>' +
          '<div class="project-card-footer"><small>' + progress.pct + '% complete &middot; ' + date + '</small>' +
          '<button class="icon-btn-sm project-card-delete" data-id="' + id + '" title="Delete project"><i class="fas fa-trash-alt"></i></button></div></div>';
      }).join('');

      grid.querySelectorAll('.project-card-item').forEach(function (card) {
        card.addEventListener('click', function (e) {
          if (e.target.closest('.project-card-delete')) return;
          switchToProject(card.dataset.id);
        });
      });
      grid.querySelectorAll('.project-card-delete').forEach(function (btn) {
        btn.addEventListener('click', async function (e) {
          e.stopPropagation();
          const id = btn.dataset.id;
          if (!confirm('Permanently delete this project? This cannot be undone.')) return;
          try {
            await database.ref('history/' + scopeUid + '/projects/' + id).remove();
            database.ref('history/' + scopeUid + '/projectIndex/' + id).remove().catch(function () {});
            database.ref('history/' + scopeUid + '/projectVersions/' + id).remove().catch(function () {});
            delete projects[id];
            if (currentProjectId === id) {
              currentProjectId = null; currentProject = null;
              setProjectActive(false);
              clearActiveState();
              switchScreen('projects');
            }
            renderProjectsListScreen();
            updateProjectSelector();
            showToast('Project deleted', 'success');
          } catch (error) { reportError(error, 'project delete'); }
        });
      });
    }
    document.getElementById('projectsNewBtn')?.addEventListener('click', function () { createNewProject(); });
    document.getElementById('projectsSearchInput')?.addEventListener('input', function () { renderProjectsListScreen(); });
    document.getElementById('backToProjectsBtn')?.addEventListener('click', function () {
      if (screens.workspace && screens.workspace.classList.contains('active')) { saveCurrentSection(); saveToFirebase(); }
      setProjectActive(false);
      switchScreen('projects');
    });

    // =========================================================================
    // CHAPTER STRUCTURES
    // =========================================================================
    const quantitativeChapters = {
      chapter1: { title: 'Chapter 1: Introduction', sections: ['Background of Study', 'Statement of Problem', 'Aim & Objectives', 'Research Questions', 'Significance of Study', 'Scope of Study', 'Operational Definitions'] },
      chapter2: { title: 'Chapter 2: Literature Review', sections: ['Theoretical Framework', 'Empirical Review', 'Conceptual Framework', 'Summary of Literature'] },
      chapter3: { title: 'Chapter 3: Methodology', sections: ['Research Design', 'Population of Study', 'Sample & Sampling Technique', 'Instrumentation', 'Data Collection Procedure', 'Data Analysis'] },
      chapter4: { title: 'Chapter 4: Results', sections: ['Data Presentation', 'Analysis of Results', 'Interpretation of Findings'] },
      chapter5: { title: 'Chapter 5: Discussion & Conclusion', sections: ['Discussion of Findings', 'Conclusion', 'Recommendations', 'Limitations of Study'] },
      references: { title: 'References', sections: [] },
      questionnaire: { title: 'Questionnaire', sections: [] },
      abstract: { title: 'Abstract', sections: [] },
      appendix: { title: 'Appendix', sections: [] },
      defense_prep: { title: 'Defense Preparation', sections: [] }
    };

    const qualitativeChapters = {
      chapter1: { title: 'Chapter 1: Introduction', sections: ['Background of Study', 'Statement of Problem', 'Aim & Objectives', 'Research Questions', 'Significance of Study', 'Scope of Study'] },
      chapter2: { title: 'Chapter 2: Literature Review', sections: ['Theoretical Framework', 'Review of Related Studies', 'Conceptual Framework', 'Summary'] },
      chapter3: { title: 'Chapter 3: Methodology', sections: ['Research Design', 'Case Selection / Participant Profile', 'Data Collection Methods', 'Data Analysis Approach', 'Ethical Considerations'] },
      chapter4: { title: 'Chapter 4: Findings', sections: ['Case Presentation', 'Thematic Analysis', 'Interpretation of Findings'] },
      chapter5: { title: 'Chapter 5: Discussion & Conclusion', sections: ['Discussion of Findings', 'Conclusion', 'Recommendations', 'Limitations of Study'] },
      references: { title: 'References', sections: [] },
      abstract: { title: 'Abstract', sections: [] },
      appendix: { title: 'Appendix', sections: [] },
      defense_prep: { title: 'Defense Preparation', sections: [] }
    };

    function getChaptersStructure() {
      if (!currentProject) return quantitativeChapters;
      if (currentProject._customOutline) return currentProject._customOutline;
      return currentProject.approach === 'qualitative' ? qualitativeChapters : quantitativeChapters;
    }

    function getSectionContent(chKey, secIndex) {
      const chStruct = getChaptersStructure();
      if (chStruct[chKey] && chStruct[chKey].sections && chStruct[chKey].sections.length) {
        return (currentProject && currentProject.chapters && currentProject.chapters[chKey] && currentProject.chapters[chKey].sections) ?
          (currentProject.chapters[chKey].sections[secIndex] || '') : '';
      }
      return (currentProject && currentProject.chapters && currentProject.chapters[chKey]) ? (currentProject.chapters[chKey].content || '') : '';
    }

    // Flattened [{chapterKey, sectionIndex, hasSections}] list across the whole
    // outline, in document order — used by Dashboard progress, Workspace
    // Prev/Next navigation, and Review/Export's full-project walks.
    function flattenSections() {
      const chStruct = getChaptersStructure();
      const out = [];
      for (const key in chStruct) {
        if (!chStruct.hasOwnProperty(key)) continue;
        const ch = chStruct[key];
        if (ch.sections && ch.sections.length) {
          ch.sections.forEach(function (name, i) { out.push({ chapterKey: key, chapterTitle: ch.title, sectionIndex: i, sectionName: name, hasSections: true }); });
        } else {
          out.push({ chapterKey: key, chapterTitle: ch.title, sectionIndex: 0, sectionName: ch.title, hasSections: false });
        }
      }
      return out;
    }

    function computeProgress(project) {
      if (!project) return { pct: 0, completed: 0, total: 0, chapters: [] };
      const savedProject = currentProject; currentProject = project; // reuse getChaptersStructure()/getSectionContent() against `project`
      const flat = flattenSections();
      let completed = 0;
      const chapterStatus = {};
      flat.forEach(function (item) {
        const content = getSectionContent(item.chapterKey, item.sectionIndex);
        const filled = content && extractPlainText(content).trim().length > 20;
        if (filled) completed++;
        if (!chapterStatus[item.chapterKey]) chapterStatus[item.chapterKey] = { title: item.chapterTitle, total: 0, filled: 0 };
        chapterStatus[item.chapterKey].total++;
        if (filled) chapterStatus[item.chapterKey].filled++;
      });
      currentProject = savedProject;
      const chapters = Object.keys(chapterStatus).map(function (key) {
        const c = chapterStatus[key];
        return { key: key, title: c.title, status: c.filled === 0 ? 'upcoming' : c.filled >= c.total ? 'completed' : 'current' };
      });
      return { pct: flat.length ? Math.round((completed / flat.length) * 100) : 0, completed: completed, total: flat.length, chapters: chapters, flat: flat };
    }

    // =========================================================================
    // ACTIVITY LOG — REDESIGN: feeds Dashboard's Recent Activity + is the
    // seed data for the (Phase 2, deferred) Project activity/history tool.
    // =========================================================================
    function logActivity(type, summary) {
      if (!currentUser || !scopeUid || !currentProjectId) return;
      database.ref('history/' + scopeUid + '/projects/' + currentProjectId + '/activity').push({
        type: type, chapterKey: currentChapter || '', sectionIndex: currentSection || 0,
        summary: summary || '', at: firebase.database.ServerValue.TIMESTAMP
      }).catch(function () {});
    }

    function describeActivity(entry) {
      const labels = {
        section_saved: 'Saved', section_generated: 'SI generated', chapter_reviewed: 'Reviewed',
        reference_added: 'Added reference', exported: 'Exported'
      };
      return (labels[entry.type] || entry.type) + (entry.summary ? ': ' + entry.summary : '');
    }

    // =========================================================================
    // DASHBOARD — REDESIGN (new screen)
    // =========================================================================
    function renderDashboard() {
      const el = document.getElementById('dashboardContent');
      if (!el) return;
      const emptyStateEl = document.getElementById('dashEmptyState');
      const realContentEl = document.getElementById('dashRealContent');
      if (!currentProject) {
        // REDESIGN fix: toggle visibility instead of replacing #dashboardContent's
        // innerHTML — that used to permanently destroy dashProjectTitle/
        // dashProgressFill/etc., breaking every later render once a project
        // did load (those ids would never exist again).
        if (emptyStateEl) emptyStateEl.style.display = 'block';
        if (realContentEl) realContentEl.style.display = 'none';
        const newBtn = document.getElementById('dashNewProjectBtn');
        if (newBtn) newBtn.style.display = 'inline-flex';
        return;
      }
      if (emptyStateEl) emptyStateEl.style.display = 'none';
      if (realContentEl) realContentEl.style.display = '';
      const progress = computeProgress(currentProject);
      const nextStep = progress.flat.find(function (item) {
        const content = getSectionContent(item.chapterKey, item.sectionIndex);
        return !content || extractPlainText(content).trim().length < 50;
      });

      document.getElementById('dashProjectTitle').textContent = currentProject.title || 'Untitled Project';
      document.getElementById('dashProgressFill').style.width = progress.pct + '%';
      document.getElementById('dashProgressLabel').textContent = progress.pct + '% complete (' + progress.completed + '/' + progress.total + ' sections)';

      document.getElementById('dashChapterRail').innerHTML = progress.chapters.map(function (c) {
        const icon = c.status === 'completed' ? 'bx-check-circle' : c.status === 'current' ? 'bx-loader-circle' : 'bx-circle';
        return '<div class="dash-rail-chapter dash-rail-' + c.status + '"><i class="bx ' + icon + '"></i> ' + escapeHtml(c.title) + '</div>';
      }).join('');

      const nextStepEl = document.getElementById('dashNextStep');
      if (nextStep) {
        nextStepEl.innerHTML = '<i class="bx bx-right-arrow-circle"></i> Next: <strong>' + escapeHtml(nextStep.chapterTitle) + (nextStep.hasSections ? ' — ' + escapeHtml(nextStep.sectionName) : '') + '</strong>';
      } else {
        nextStepEl.innerHTML = '<i class="bx bx-check-circle"></i> Every section has a draft. Time to review.';
      }

      const activityEl = document.getElementById('dashRecentActivity');
      database.ref('history/' + scopeUid + '/projects/' + currentProjectId + '/activity').limitToLast(8).once('value').then(function (snap) {
        const data = snap.val() || {};
        const entries = Object.values(data).sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
        activityEl.innerHTML = entries.length
          ? entries.map(function (e) { return '<div class="dash-activity-item"><i class="bx bx-time-five"></i> ' + escapeHtml(describeActivity(e)) + '</div>'; }).join('')
          : '<div class="dash-activity-item" style="color:var(--text-secondary);">No activity yet — start writing to see it here.</div>';
      }).catch(function () { activityEl.innerHTML = ''; });

      updatePlanUI();
    }

    document.getElementById('dashContinueBtn')?.addEventListener('click', function () {
      if (!currentProject) { document.getElementById('dashNewProjectBtn')?.click(); return; }
      const dash = (currentProject.dashboard) || {};
      if (dash.lastOpenedChapter) { currentChapter = dash.lastOpenedChapter; currentSection = dash.lastOpenedSection || 0; }
      switchScreen('workspace');
      renderChapters(); loadSectionContent();
    });

    document.getElementById('dashNewProjectBtn')?.addEventListener('click', function () { createNewProject(); });

    // Dashboard shortcuts: Setup, Review and Export straight from the project's home (they used to be
    // reachable only from inside the writing screen). Review works on the last section opened.
    document.querySelectorAll('[data-dash-go]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!currentProject) { showToast('Select or create a project first', 'error'); return; }
        const go = btn.dataset.dashGo;
        if (go === 'review') {
          const dash = currentProject.dashboard || {};
          if (dash.lastOpenedChapter) { currentChapter = dash.lastOpenedChapter; currentSection = dash.lastOpenedSection || 0; }
          if (!currentChapter) currentChapter = 'chapter1';
          renderChapters(); loadSectionContent();
        }
        switchScreen(go);
      });
    });

    // =========================================================================
    // RESEARCH SETUP — REDESIGN (new data + UI, part of the Setup screen)
    // =========================================================================
    const RESEARCH_SETUP_LIST_FIELDS = ['objectives', 'researchQuestions', 'hypotheses', 'keyConcepts'];

    function emptyResearchSetup() {
      return { problem: '', aim: '', objectives: [''], researchQuestions: [''], hypotheses: [''],
        variables: { independent: [''], dependent: [''], confounding: [''] }, population: '', setting: '', keyConcepts: [''] };
    }

    function renderListField(containerId, values, placeholder) {
      const container = document.getElementById(containerId);
      if (!container) return;
      const list = (values && values.length) ? values : [''];
      container.innerHTML = list.map(function (v, i) {
        return '<div class="rs-list-row"><input type="text" class="rs-list-input" data-index="' + i + '" value="' + escapeHtml(v) + '" placeholder="' + placeholder + '"><button type="button" class="rs-list-remove" data-index="' + i + '" title="Remove"><i class="fas fa-times"></i></button></div>';
      }).join('') + '<button type="button" class="rs-list-add" data-target="' + containerId + '"><i class="fas fa-plus"></i> Add</button>';
    }

    function readListField(containerId) {
      const container = document.getElementById(containerId);
      if (!container) return [];
      return Array.from(container.querySelectorAll('.rs-list-input')).map(function (i) { return i.value.trim(); }).filter(Boolean);
    }

    function renderResearchSetupForm() {
      if (!currentProject) return;
      const rs = currentProject.researchSetup || emptyResearchSetup();
      document.getElementById('rsProblem').value = rs.problem || '';
      document.getElementById('rsAim').value = rs.aim || '';
      document.getElementById('rsPopulation').value = rs.population || '';
      document.getElementById('rsSetting').value = rs.setting || '';
      renderListField('rsObjectives', rs.objectives, 'e.g. To assess...');
      renderListField('rsQuestions', rs.researchQuestions, 'e.g. What is the effect of...');
      renderListField('rsHypotheses', rs.hypotheses, 'e.g. H1: There is a significant...');
      renderListField('rsKeyConcepts', rs.keyConcepts, 'e.g. Vestibular rehabilitation');
      const vars = rs.variables || { independent: [''], dependent: [''], confounding: [''] };
      renderListField('rsVarIndependent', vars.independent, 'Independent variable');
      renderListField('rsVarDependent', vars.dependent, 'Dependent variable');
      renderListField('rsVarConfounding', vars.confounding, 'Confounding variable');
    }

    document.getElementById('researchSetupForm')?.addEventListener('click', function (e) {
      const addBtn = e.target.closest('.rs-list-add');
      const removeBtn = e.target.closest('.rs-list-remove');
      if (addBtn) {
        const container = document.getElementById(addBtn.dataset.target);
        const row = document.createElement('div');
        row.className = 'rs-list-row';
        row.innerHTML = '<input type="text" class="rs-list-input" value=""><button type="button" class="rs-list-remove" title="Remove"><i class="fas fa-times"></i></button>';
        container.insertBefore(row, addBtn);
      } else if (removeBtn) {
        removeBtn.closest('.rs-list-row').remove();
      }
    });

    async function saveResearchSetup() {
      if (!currentProject || !currentProjectId) return;
      const researchSetup = {
        problem: document.getElementById('rsProblem').value.trim(),
        aim: document.getElementById('rsAim').value.trim(),
        population: document.getElementById('rsPopulation').value.trim(),
        setting: document.getElementById('rsSetting').value.trim(),
        objectives: readListField('rsObjectives'),
        researchQuestions: readListField('rsQuestions'),
        hypotheses: readListField('rsHypotheses'),
        keyConcepts: readListField('rsKeyConcepts'),
        variables: { independent: readListField('rsVarIndependent'), dependent: readListField('rsVarDependent'), confounding: readListField('rsVarConfounding') },
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      };
      currentProject.researchSetup = researchSetup;
      try {
        await database.ref('history/' + scopeUid + '/projects/' + currentProjectId + '/researchSetup').set(researchSetup);
        showToast('Research Setup saved', 'success');
      } catch (err) { reportError(err, 'research setup save'); }
    }

    document.getElementById('saveResearchSetupBtn')?.addEventListener('click', saveResearchSetup);

    // "Draft with SI": drafts the Research Setup from the title, department and approach. Fills only the
    // fields that are still empty (never overwrites the student's own words); nothing is saved until they
    // press Save Research Setup.
    async function draftResearchSetup() {
      if (!currentProject) return;
      if (!requireSignIn()) return;
      const btn = document.getElementById('rsDraftBtn');
      const listIds = { objectives: 'rsObjectives', researchQuestions: 'rsQuestions', hypotheses: 'rsHypotheses', keyConcepts: 'rsKeyConcepts', independent: 'rsVarIndependent', dependent: 'rsVarDependent', confounding: 'rsVarConfounding' };
      const textIds = { problem: 'rsProblem', aim: 'rsAim', population: 'rsPopulation', setting: 'rsSetting' };
      const emptyText = Object.keys(textIds).filter(function (k) { return !document.getElementById(textIds[k]).value.trim(); });
      const emptyList = Object.keys(listIds).filter(function (k) { return !readListField(listIds[k]).length; });
      if (!emptyText.length && !emptyList.length) { showToast('Every field is filled in already', 'info'); return; }
      const qual = currentProject.approach === 'qualitative';
      if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> Drafting…'; }
      try {
        const system = 'You help a ' + (currentProject.type || 'undergraduate') + ' student in ' + (currentProject.department || 'rehabilitation') + ' set up a research project. Write realistic, specific, examinable content for THIS title, in plain academic English, British spelling. Do not invent results or statistics. Return ONLY a JSON object, no prose, no code fences.';
        const user = 'PROJECT TITLE: "' + currentProject.title + '"\nDEPARTMENT: ' + (currentProject.department || '') + '\nAPPROACH: ' + (qual ? 'Qualitative' : 'Quantitative') + '\n\nReturn JSON with these keys:\n' +
          '{"problem": "2-3 sentences: the gap or problem this study addresses", "aim": "one sentence", "objectives": ["3-4 objectives starting with To ..."], "researchQuestions": ["3-4 questions"], ' +
          '"hypotheses": [' + (qual ? '] (leave empty for a qualitative study), ' : '"2-3 testable hypotheses, H1: ... and matching H0 where sensible"], ') +
          '"independent": [' + (qual ? '] (empty for qualitative), ' : '"the independent variable(s)"], ') + '"dependent": [' + (qual ? '] (empty for qualitative), ' : '"the dependent variable(s)"], ') +
          '"confounding": ["likely confounding variables"' + (qual ? ' (may be empty)' : '') + '], "population": "who is studied", "setting": "where", "keyConcepts": ["4-6 key concepts"]}';
        const raw = await callProjectAI(PROJECT_AI_ACTIONS.findMissing, system, user);
        const d = parseJsonLoose(raw);
        if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('The draft could not be read. Please try again.');
        const asList = function (v) { return (Array.isArray(v) ? v : (v ? [v] : [])).map(function (x) { return String(x || '').trim(); }).filter(Boolean); };
        let filled = 0;
        emptyText.forEach(function (k) { const v = String(d[k] || '').trim(); if (v) { document.getElementById(textIds[k]).value = v; filled++; } });
        const placeholders = { objectives: 'e.g. To assess...', researchQuestions: 'e.g. What is the effect of...', hypotheses: 'e.g. H1: There is a significant...', keyConcepts: 'e.g. Vestibular rehabilitation', independent: 'Independent variable', dependent: 'Dependent variable', confounding: 'Confounding variable' };
        emptyList.forEach(function (k) { const v = asList(d[k]); if (v.length) { renderListField(listIds[k], v, placeholders[k]); filled++; } });
        showToast(filled ? 'Draft ready: ' + filled + ' field' + (filled === 1 ? '' : 's') + ' filled in. Check and edit them, then tap Save Research Setup.' : 'No fields could be drafted. Please try again.', filled ? 'success' : 'error', 6000);
      } catch (err) {
        reportError(err, 'research setup draft');
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bx bx-bulb"></i> Draft with SI'; }
      }
    }
    document.getElementById('rsDraftBtn')?.addEventListener('click', draftResearchSetup);

    // =========================================================================
    // SETUP SCREEN — REDESIGN (new screen; Project Details tab reuses the
    // existing wizard fields, Research Setup tab is entirely new)
    // =========================================================================
    function renderSetupScreen() {
      if (!currentProject) { setProjectActive(false); switchScreen('projects'); return; }
      document.getElementById('setupProjectTitle').value = currentProject.title || '';
      document.getElementById('setupProjectType').value = currentProject.type || 'Undergraduate Project';
      document.getElementById('setupProjectDept').value = currentProject.department || 'Occupational Therapy';
      document.getElementById('setupProjectApproach').value = currentProject.approach || 'quantitative';
      renderResearchSetupForm();
      // REDESIGN (item 6): Writing Profile/Word Count/Reference Style/AI
      // Tone moved here from Workspace's Advanced panel — they already
      // auto-save via their own `change` listeners (below), this just
      // makes sure the Setup screen shows the project's current values.
      if (writingProfileSelect) writingProfileSelect.value = currentProject.writingProfile || 'undergraduate';
      if (wordCountSelect) {
        wordCountSelect.value = currentProject.wordCountPref || 'auto';
        if (wordCountSelect.value === 'custom' && customWordCountInput) {
          customWordCountInput.style.display = 'inline-block';
          customWordCountInput.value = currentProject.customWordCount || 500;
        }
      }
      if (referenceStyleSelect) referenceStyleSelect.value = currentProject.referenceStyle || 'APA 7th';
    }

    document.querySelectorAll('.setup-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.setup-tab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.setup-tab-pane').forEach(function (p) { p.classList.remove('active'); });
        tab.classList.add('active');
        document.getElementById('setupPane' + tab.dataset.setupTab)?.classList.add('active');
      });
    });

    document.getElementById('saveProjectDetailsBtn')?.addEventListener('click', async function () {
      if (!currentProject || !currentProjectId) return;
      currentProject.title = document.getElementById('setupProjectTitle').value.trim() || currentProject.title;
      currentProject.type = document.getElementById('setupProjectType').value;
      currentProject.department = document.getElementById('setupProjectDept').value;
      currentProject.approach = document.getElementById('setupProjectApproach').value;
      try {
        await database.ref('history/' + scopeUid + '/projects/' + currentProjectId).update({
          title: currentProject.title, type: currentProject.type, department: currentProject.department, approach: currentProject.approach
        });
        updateProjectIndex();
        updateProjectSelector();
        showToast('Project details saved', 'success');
      } catch (err) { reportError(err, 'project details save'); }
    });

    // =========================================================================
    // RICH TEXT FORMATTING
    // =========================================================================
    function execFormatCmd(command, value) {
      if (value === undefined) value = null;
      document.execCommand(command, false, value);
      sectionEditor.focus();
    }

    formatBtns.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        const cmd = btn.dataset.command;
        if (cmd === 'createLink') { const url = prompt('Enter URL:', 'https://'); if (url) execFormatCmd('createLink', url); }
        else if (cmd === 'unlink') execFormatCmd('unlink');
        else if (cmd === 'undo') { document.execCommand('undo'); sectionEditor.focus(); }
        else if (cmd === 'redo') { document.execCommand('redo'); sectionEditor.focus(); }
        else execFormatCmd(cmd);
      });
    });
    if (fontFamilySelect) fontFamilySelect.addEventListener('change', function () { execFormatCmd('fontName', fontFamilySelect.value); });
    if (fontSizeSelect) fontSizeSelect.addEventListener('change', function () { execFormatCmd('fontSize', fontSizeSelect.value); });

    // =========================================================================
    // CONTEXT MEMORY — extended (REDESIGN) with researchSetup + current
    // draft + references, per buildWorkspaceContext() below; the original
    // buildContextSummary() is kept as its base, unchanged.
    // =========================================================================
    function buildResourceContext() {
      if (!resources || resources.length === 0) return '';
      return '\n\nUPLOADED RESOURCES (Use these as authoritative sources):\n' +
        resources.map(function (r, i) { return 'RESOURCE ' + (i + 1) + ' - "' + r.name + '":\n' + r.analysis + '\n'; }).join('\n');
    }

    function buildResearchSetupContext() {
      const rs = currentProject && currentProject.researchSetup;
      if (!rs) return '';
      const lines = ['RESEARCH SETUP (the authoritative source of truth for this project — every chapter must align with this):'];
      if (rs.problem) lines.push('Problem: ' + rs.problem);
      if (rs.aim) lines.push('Aim: ' + rs.aim);
      if (rs.objectives && rs.objectives.length) lines.push('Objectives: ' + rs.objectives.join(' | '));
      if (rs.researchQuestions && rs.researchQuestions.length) lines.push('Research Questions: ' + rs.researchQuestions.join(' | '));
      if (rs.hypotheses && rs.hypotheses.length) lines.push('Hypotheses: ' + rs.hypotheses.join(' | '));
      if (rs.variables) {
        if (rs.variables.independent && rs.variables.independent.length) lines.push('Independent variable(s): ' + rs.variables.independent.join(', '));
        if (rs.variables.dependent && rs.variables.dependent.length) lines.push('Dependent variable(s): ' + rs.variables.dependent.join(', '));
      }
      if (rs.population) lines.push('Population: ' + rs.population);
      if (rs.setting) lines.push('Setting: ' + rs.setting);
      if (rs.keyConcepts && rs.keyConcepts.length) lines.push('Key concepts: ' + rs.keyConcepts.join(', '));
      return lines.length > 1 ? lines.join('\n') : '';
    }

    function buildReferencesContext() {
      const refs = currentProject && currentProject.references;
      if (!refs) return '';
      const entries = Object.values(refs);
      if (!entries.length) return '';
      return '\n\nAVAILABLE SOURCES (cite these when relevant; never fabricate a source not in this list):\n' +
        entries.map(function (r) {
          const authorNames = (r.authors || []).map(function (a) { return a.family; }).filter(Boolean).join(', ');
          return '- ' + (authorNames || 'Unknown') + ' (' + (r.year || 'n.d.') + '). ' + (r.title || 'Untitled');
        }).join('\n');
    }

    // Context excerpts are cut to keep requests small; the cut is marked so the SI never mistakes a
    // shortened excerpt for the student's text being unfinished.
    function clip(text, n) { text = String(text || ''); return text.length > n ? text.substring(0, n).replace(/\s+\S*$/, '') + ' […excerpt shortened]' : text; }

    function buildContextSummary() {
      const summary = [];
      if (currentProject) {
        summary.push('PROJECT TITLE: "' + currentProject.title + '"');
        summary.push('DEPARTMENT: ' + (currentProject.department || 'Healthcare'));
        summary.push('PROJECT TYPE: ' + (currentProject.type || 'Academic Project'));
        summary.push('RESEARCH APPROACH: ' + (currentProject.approach === 'qualitative' ? 'Qualitative (Case Study)' : 'Quantitative'));
        summary.push('WRITING PROFILE: ' + (currentProject.writingProfile || 'undergraduate'));
      }
      if (!currentProject || !currentProject.chapters) return summary.join('\n');

      const ch1 = currentProject.chapters.chapter1;
      if (ch1) {
        const background = extractPlainText(ch1.sections ? ch1.sections[0] : '');
        const statement = extractPlainText(ch1.sections ? ch1.sections[1] : '');
        const objectives = extractPlainText(ch1.sections ? ch1.sections[2] : '');
        const questions = extractPlainText(ch1.sections ? ch1.sections[3] : '');
        const significance = extractPlainText(ch1.sections ? ch1.sections[4] : '');
        if (background) summary.push('BACKGROUND: ' + clip(background, 800));
        if (statement) summary.push('PROBLEM STATEMENT: ' + clip(statement, 600));
        if (objectives) summary.push('AIM & OBJECTIVES: ' + clip(objectives, 600));
        if (questions) summary.push('RESEARCH QUESTIONS: ' + clip(questions, 500));
        if (significance) summary.push('SIGNIFICANCE: ' + clip(significance, 400));
      }
      const ch2 = currentProject.chapters.chapter2;
      if (ch2) {
        const framework = extractPlainText(ch2.sections ? ch2.sections[0] : '');
        const empirical = extractPlainText(ch2.sections ? ch2.sections[1] : '');
        const conceptual = extractPlainText(ch2.sections ? ch2.sections[2] : '');
        if (framework) summary.push('THEORETICAL FRAMEWORK: ' + clip(framework, 600));
        if (empirical) summary.push('EMPIRICAL REVIEW KEY POINTS: ' + clip(empirical, 500));
        if (conceptual) summary.push('CONCEPTUAL FRAMEWORK: ' + clip(conceptual, 400));
      }
      const ch3 = currentProject.chapters.chapter3;
      if (ch3) {
        const design = extractPlainText(ch3.sections ? ch3.sections[0] : '');
        const population = extractPlainText(ch3.sections ? ch3.sections[1] : '');
        const sampling = extractPlainText(ch3.sections ? ch3.sections[2] : '');
        const instrument = extractPlainText(ch3.sections ? ch3.sections[3] : '');
        const dataCollect = extractPlainText(ch3.sections ? ch3.sections[4] : '');
        const dataAnalysis = extractPlainText(ch3.sections ? ch3.sections[5] : '');
        if (design) summary.push('RESEARCH DESIGN (MUST MATCH IN ALL CHAPTERS): ' + clip(design, 500));
        if (population) summary.push('POPULATION & SAMPLE SIZE (USE THESE EXACT NUMBERS IN CHAPTERS 4 & 5): ' + clip(population, 600));
        if (sampling) summary.push('SAMPLING TECHNIQUE: ' + clip(sampling, 400));
        if (instrument) summary.push('INSTRUMENTS/TOOLS (MUST MATCH IN RESULTS & DISCUSSION): ' + clip(instrument, 500));
        if (dataCollect) summary.push('DATA COLLECTION PROCEDURE: ' + clip(dataCollect, 400));
        if (dataAnalysis) summary.push('DATA ANALYSIS METHOD: ' + clip(dataAnalysis, 400));
      }
      const ch4 = currentProject.chapters.chapter4;
      if (ch4) {
        const dataPres = extractPlainText(ch4.sections ? ch4.sections[0] : (ch4.content || ''));
        const analysis = extractPlainText(ch4.sections ? ch4.sections[1] : '');
        const interp = extractPlainText(ch4.sections ? ch4.sections[2] : '');
        if (dataPres) summary.push('RESULTS - DATA PRESENTATION (must be consistent with Discussion): ' + clip(dataPres, 700));
        if (analysis) summary.push('RESULTS - ANALYSIS (do not contradict these findings): ' + clip(analysis, 500));
        if (interp) summary.push('RESULTS - INTERPRETATION: ' + clip(interp, 400));
      }
      const allText = extractPlainText(JSON.stringify(currentProject.chapters));
      const numberPatterns = allText.match(/\bn\s*=\s*\d+|\d+\s*participants?|\d+\s*patients?|\d+\.\d+\s*\(SD[\s=]*[\d.]+\)|\bp\s*[<=>]\s*[\d.]+|mean\s*(?:score\s*)?(?:was|of|=)\s*[\d.]+/gi) || [];
      const uniqueNumbers = [...new Set(numberPatterns.map(function (s) { return s.trim(); }))].slice(0, 15);
      if (uniqueNumbers.length > 0) summary.push('CONSISTENCY CRITICAL - USE THESE EXACT FIGURES (do not invent or change any): ' + uniqueNumbers.join(' | '));
      // the student's own key concepts when they set them; otherwise recurring terms from the text
      // (names of journals, associations and publishers are left out — they are reference-list noise)
      const ownConcepts = ((currentProject.researchSetup && currentProject.researchSetup.keyConcepts) || []).filter(Boolean);
      if (ownConcepts.length) summary.push('KEY TERMS (set by the student; use consistently, same spelling throughout): ' + ownConcepts.join(', '));
      else {
        const keyTerms = extractKeyTerms(allText).filter(function (t) { return !/\b(Journal|Association|Press|University|Review|Publishing|Publishers|Organization|Organisation|Society|Institute|Programs?)\b/.test(t); });
        if (keyTerms.length > 0) summary.push('RECURRING TERMS (detected automatically in the draft, not set by the student; keep spelling consistent): ' + keyTerms.join(', '));
      }
      const resourceContext = buildResourceContext();
      if (resourceContext) summary.push(resourceContext);
      return summary.join('\n\n');
    }

    // REDESIGN: Project AI's context builder — the concrete thing that makes
    // it "understand the project" rather than only pattern-match filled
    // chapters (see the plan's "why this isn't a Lixa duplicate" note).
    function buildWorkspaceContext(includeCurrentDraft) {
      const parts = [buildResearchSetupContext(), buildContextSummary()];
      if (includeCurrentDraft && sectionEditor) {
        const draft = extractPlainText(sectionEditor.innerHTML);
        if (draft.trim()) parts.push('CURRENT DRAFT (what is already written in this section — build on this, do not repeat it):\n' + clip(draft, 3000));
      }
      const refs = buildReferencesContext();
      if (refs) parts.push(refs);
      return parts.filter(Boolean).join('\n\n');
    }

    // =========================================================================
    // CONSISTENCY CHECKER (ported) + REVIEW SCREEN (REDESIGN)
    // =========================================================================
    // IMPROVED: every conflicting figure is now traced back to the exact
    // chapter, section and sentence it appears in (not just "n=30, n=45 found
    // somewhere"), so the Review screen can point the student at it and the
    // Fix flow can target those passages precisely.
    function sentenceAround(text, index, length) {
      let start = index, end = index + length;
      while (start > 0 && !/[.!?\n]/.test(text[start - 1])) start--;
      while (end < text.length && !/[.!?\n]/.test(text[end])) end++;
      if (end < text.length) end++;
      return text.slice(start, end).replace(/\s+/g, ' ').trim();
    }

    function scanFigureOccurrences() {
      const out = [];
      flattenSections().forEach(function (item) {
        const text = extractPlainText(getSectionContent(item.chapterKey, item.sectionIndex));
        if (!text.trim()) return;
        [{ kind: 'sample', re: /\bn\s*=\s*(\d+)/gi }, { kind: 'participants', re: /(\d+)\s*participants?/gi }].forEach(function (p) {
          let m;
          p.re.lastIndex = 0;
          while ((m = p.re.exec(text)) !== null) {
            out.push({
              kind: p.kind, value: m[0].replace(/\s/g, '').toLowerCase(), match: m[0],
              chapterKey: item.chapterKey, sectionIndex: item.sectionIndex, hasSections: item.hasSections,
              chapterTitle: item.chapterTitle, sectionName: item.sectionName,
              sentence: sentenceAround(text, m.index, m[0].length)
            });
          }
        });
      });
      return out;
    }

    function checkConsistency(silent) {
      if (!currentProject || !currentProject.chapters) return [];
      const occ = scanFigureOccurrences();
      const findings = [];
      [['sample', 'Sample size conflict'], ['participants', 'Participant count conflict']].forEach(function (k) {
        const list = occ.filter(function (o) { return o.kind === k[0]; });
        const values = [...new Set(list.map(function (o) { return o.value; }))];
        if (values.length > 1) {
          findings.push({
            id: 'consistency_' + k[0], type: 'inconsistent', severity: 'high', kind: k[0], values: values, occurrences: list,
            note: k[1] + ': ' + values.join(', ') + ' found across ' + [...new Set(list.map(function (o) { return o.chapterKey + ':' + o.sectionIndex; }))].length + ' sections.'
          });
        }
      });
      if (findings.length && !silent) showToast(findings.map(function (f) { return f.note; }).join(' '), 'warning', 7000);
      return findings;
    }

    function locationLabel(chapterKey, sectionIndex) {
      const ch = getChaptersStructure()[chapterKey];
      if (!ch) return chapterKey;
      return ch.title + (ch.sections && ch.sections.length ? ' › ' + (ch.sections[sectionIndex] || 'Section ' + (sectionIndex + 1)) : '');
    }

    // REDESIGN (Round 3): Review is now a single-panel toggle — Project AI
    // fills the whole screen by default (like Lixa), and this button swaps
    // it for Consistency Check + Chapter Review (full width) and back.
    const reviewToggleBtn = document.getElementById('reviewToggleBtn');
    const reviewFindingsPanel = document.getElementById('reviewFindingsPanel');
    const reviewHeaderTitle = document.getElementById('reviewHeaderTitle');
    // BUG FIX: the toggle button used to live inside #aiPanel's own header,
    // so hiding #aiPanel to show findings also hid the only way to toggle
    // back — it now lives in a persistent header bar above both panels.
    function setReviewMode(mode) {
      if (!reviewToggleBtn || !reviewFindingsPanel || !aiPanel) return;
      if (mode === 'findings') {
        aiPanel.style.display = 'none';
        reviewFindingsPanel.style.display = 'block';
        reviewToggleBtn.dataset.mode = 'findings';
        reviewToggleBtn.innerHTML = '<i class="fas fa-robot"></i> <span>Project SI</span>';
        reviewToggleBtn.title = 'Project SI';
        if (reviewHeaderTitle) reviewHeaderTitle.innerHTML = '<i class="bx bx-check-shield"></i> Consistency Check & Chapter Review';
      } else {
        aiPanel.style.display = 'flex';
        reviewFindingsPanel.style.display = 'none';
        reviewToggleBtn.dataset.mode = 'ai';
        reviewToggleBtn.innerHTML = '<i class="bx bx-check-shield"></i> <span>Findings</span>';
        reviewToggleBtn.title = 'Consistency Check & Chapter Review';
        if (reviewHeaderTitle) reviewHeaderTitle.innerHTML = '<i class="fas fa-robot"></i> Project SI';
      }
    }
    if (reviewToggleBtn) {
      reviewToggleBtn.addEventListener('click', function () { setReviewMode(reviewToggleBtn.dataset.mode === 'ai' ? 'findings' : 'ai'); });
    }

    function renderReviewScreen() {
      if (!currentProject) { setProjectActive(false); switchScreen('projects'); return; }
      setReviewMode('ai'); // Project AI is the default view every time Review is entered
      if (currentChapter) updateSectionNav(); // keeps the Project AI "Working on:" indicator current
      renderConsistencyFindings(checkConsistency());
      renderChapterFindings();
    }

    // Findings: compact, expandable (<details>) items — the summary line shows
    // severity/type and the note; expanding reveals the location, the quoted
    // passage, the suggestion and the actions (Discuss with Project AI / Fix).
    let lastConsistencyFindings = [];
    let reviewSeverityFilter = 'all';

    function sevOf(f) { const s = String(f.severity || 'medium').toLowerCase(); return ['high', 'medium', 'low'].indexOf(s) >= 0 ? s : 'medium'; }

    function renderConsistencyFindings(findings) {
      lastConsistencyFindings = findings;
      const consistencyEl = document.getElementById('reviewConsistencyFindings');
      if (!consistencyEl) return;
      consistencyEl.innerHTML = findings.length
        ? findings.map(function (f, fi) {
          return '<details class="review-finding review-' + sevOf(f) + ' review-finding-rich" data-sev="' + sevOf(f) + '">' +
            '<summary class="review-finding-head"><span class="review-sev-dot" aria-hidden="true"></span><span class="review-summary-text">' + escapeHtml(f.note) + '</span><i class="bx bx-chevron-down review-chevron" aria-hidden="true"></i></summary>' +
            '<div class="review-finding-body"><ul class="review-occurrences">' + f.occurrences.map(function (o) {
              return '<li><button type="button" class="review-goto" data-ch="' + o.chapterKey + '" data-sec="' + o.sectionIndex + '" data-quote="' + escapeHtml(o.sentence).replace(/"/g, '&quot;') + '" title="Open this passage">' +
                '<i class="bx bx-link-external" aria-hidden="true"></i> ' + escapeHtml(locationLabel(o.chapterKey, o.sectionIndex)) + '</button>' +
                '<span class="review-value">' + escapeHtml(o.match) + '</span>' +
                '<blockquote class="review-quote">' + escapeHtml(o.sentence) + '</blockquote></li>';
            }).join('') + '</ul>' +
            '<div class="review-finding-actions"><button type="button" class="review-discuss-btn" data-discuss-consistency="' + fi + '"><i class="bx bx-message-rounded-dots" aria-hidden="true"></i> Discuss</button>' +
            '<button type="button" class="review-fix-btn" data-consistency="' + fi + '"><i class="bx bx-wrench" aria-hidden="true"></i> Fix with SI</button></div></div></details>';
        }).join('')
        : '<div class="review-finding review-ok" data-sev="ok"><i class="bx bx-check-circle"></i> No sample-size or participant-count conflicts detected.</div>';
      applyReviewFilter();
    }

    function renderChapterFindings() {
      const chapterEl = document.getElementById('reviewChapterFindings');
      if (!chapterEl || !currentProject) return;
      const cached = (currentProject.reviewFindings || {})[currentChapter];
      const list = cached && cached.findings ? cached.findings : [];
      if (!list.length) {
        chapterEl.innerHTML = '<div class="review-finding review-empty" data-sev="ok">No review run yet for this chapter. Tap "Review Current Chapter" to check for missing, weak, inconsistent, or unsupported content.</div>';
        applyReviewFilter();
        return;
      }
      chapterEl.innerHTML = list.map(function (f, i) {
        const loc = (typeof f.sectionIndex === 'number' && f.sectionIndex >= 0) ? locationLabel(currentChapter, f.sectionIndex) : ((getChaptersStructure()[currentChapter] || {}).title || '') + (f.section ? ' › ' + f.section : '');
        return '<details class="review-finding review-' + sevOf(f) + ' review-' + escapeHtml(f.type || '') + ' review-finding-rich' + (f.fixed ? ' review-fixed' : '') + '" data-sev="' + sevOf(f) + '">' +
          '<summary class="review-finding-head"><span class="review-sev-dot" aria-hidden="true"></span><span class="review-tag">' + escapeHtml(f.type || 'issue') + '</span>' +
          '<span class="review-summary-text">' + escapeHtml(f.note || '') + '</span>' +
          (f.fixed ? '<span class="review-fixed-badge"><i class="bx bx-check"></i> Fixed</span>' : '') + '<i class="bx bx-chevron-down review-chevron" aria-hidden="true"></i></summary>' +
          '<div class="review-finding-body">' +
          '<button type="button" class="review-goto" data-ch="' + currentChapter + '" data-sec="' + (typeof f.sectionIndex === 'number' && f.sectionIndex >= 0 ? f.sectionIndex : 0) + '" data-quote="' + escapeHtml(f.excerpt || '').replace(/"/g, '&quot;') + '"><i class="bx bx-link-external" aria-hidden="true"></i> ' + escapeHtml(loc) + '</button>' +
          (f.excerpt ? '<blockquote class="review-quote">' + escapeHtml(f.excerpt) + '</blockquote>' : '') +
          (f.suggestion ? '<div class="review-suggestion"><i class="bx bx-bulb" aria-hidden="true"></i> ' + escapeHtml(f.suggestion) + '</div>' : '') +
          '<div class="review-finding-actions"><button type="button" class="review-discuss-btn" data-discuss-finding="' + i + '"><i class="bx bx-message-rounded-dots" aria-hidden="true"></i> Discuss</button>' +
          (f.fixed ? '' : '<button type="button" class="review-fix-btn" data-finding="' + i + '"><i class="bx bx-wrench" aria-hidden="true"></i> Fix with SI</button>') +
          '</div></div></details>';
      }).join('');
      applyReviewFilter();
    }

    // Severity filter + counts.
    function applyReviewFilter() {
      const panel = document.getElementById('reviewFindingsPanel');
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll('.review-finding-rich[data-sev]'));
      items.forEach(function (el) { el.hidden = reviewSeverityFilter !== 'all' && el.dataset.sev !== reviewSeverityFilter; });
      panel.querySelectorAll('.review-filter-count').forEach(function (c) {
        const k = c.dataset.count;
        const n = k === 'all' ? items.length : items.filter(function (el) { return el.dataset.sev === k; }).length;
        c.textContent = n ? String(n) : '';
      });
    }
    document.getElementById('reviewFilterBar')?.addEventListener('click', function (e) {
      const b = e.target.closest('.review-filter');
      if (!b) return;
      reviewSeverityFilter = b.dataset.sev;
      this.querySelectorAll('.review-filter').forEach(function (x) { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-pressed', String(on)); });
      applyReviewFilter();
    });

    // Send one finding back into Project AI for discussion.
    function discussFinding(text) {
      setReviewMode('ai');
      aiMessageInput.value = text;
      aiSendBtn.click();
    }

    // Delegated clicks for both findings panels: jump to the passage, discuss, or open the AI fix flow.
    document.getElementById('reviewFindingsPanel')?.addEventListener('click', function (e) {
      const go = e.target.closest('.review-goto');
      if (go) { goToPassage(go.dataset.ch, parseInt(go.dataset.sec, 10) || 0, go.dataset.quote || ''); return; }
      const discuss = e.target.closest('.review-discuss-btn');
      if (discuss) {
        if (discuss.dataset.discussConsistency !== undefined) {
          const f = lastConsistencyFindings[parseInt(discuss.dataset.discussConsistency, 10)];
          if (f) discussFinding('Let\'s discuss this consistency issue: ' + f.note + '\n' + f.occurrences.map(function (o) { return '- ' + locationLabel(o.chapterKey, o.sectionIndex) + ': "' + o.sentence + '"'; }).join('\n') + '\nWhich figure is correct, and how should I fix the others?');
        } else {
          const cached = (currentProject.reviewFindings || {})[currentChapter];
          const f = cached && cached.findings ? cached.findings[parseInt(discuss.dataset.discussFinding, 10)] : null;
          if (f) discussFinding('Let\'s discuss this review finding (' + f.type + ', ' + sevOf(f) + ') in ' + locationLabel(currentChapter, f.sectionIndex >= 0 ? f.sectionIndex : 0) + ': ' + f.note + (f.excerpt ? '\nPassage: "' + f.excerpt + '"' : '') + '\nWhy is this a problem, and how should I improve it?');
        }
        return;
      }
      const fix = e.target.closest('.review-fix-btn');
      if (!fix) return;
      if (fix.dataset.consistency !== undefined) openFixForConsistency(lastConsistencyFindings[parseInt(fix.dataset.consistency, 10)]);
      else if (fix.dataset.finding !== undefined) {
        const cached = (currentProject.reviewFindings || {})[currentChapter];
        const f = cached && cached.findings ? cached.findings[parseInt(fix.dataset.finding, 10)] : null;
        if (f) openFixForFinding(f, parseInt(fix.dataset.finding, 10));
      }
    });

    // "Refer the user": open the section in Chapter Workspace, scroll the
    // passage into view and select it (a selection, not markup, so nothing
    // stray is ever saved into the section's HTML).
    function goToPassage(chapterKey, sectionIndex, quote) {
      if (!currentProject || !getChaptersStructure()[chapterKey]) return;
      if (screens.workspace && screens.workspace.classList.contains('active')) { saveCurrentSection(); saveToFirebase(); }
      currentChapter = chapterKey; currentSection = sectionIndex;
      switchScreen('workspace');
      loadSectionContent(); renderChapters(); persistLastOpened();
      if (quote) setTimeout(function () { highlightInEditor(quote); }, 120);
    }

    // =========================================================================
    // REVIEW → FIX (deep search + fix modal)
    // =========================================================================
    // A chapter's sections in full, each tagged with its index so the AI can
    // point at exact locations.
    function buildChapterFullText(chapterKey, maxPerSection) {
      const ch = getChaptersStructure()[chapterKey];
      if (!ch) return '';
      const cap = maxPerSection || 3500;
      let out = 'CHAPTER UNDER REVIEW: ' + ch.title + '\nSECTIONS (full text):';
      if (ch.sections && ch.sections.length) {
        ch.sections.forEach(function (sec, i) {
          const text = extractPlainText(getSectionContent(chapterKey, i)).replace(/\n{3,}/g, '\n\n').trim();
          out += '\n\n### [' + i + '] ' + sec + '\n' + (text ? clip(text, cap) : '(this section is empty)');
        });
      } else {
        const text = extractPlainText(getSectionContent(chapterKey, 0)).trim();
        out += '\n\n### [0] ' + ch.title + '\n' + (text ? clip(text, cap * 3) : '(empty)');
      }
      return out;
    }

    function parseJsonLoose(raw) {
      if (!raw) return null;
      const cleaned = raw.replace(/```json|```/gi, '').trim();
      try { return JSON.parse(cleaned); } catch (e) { /* fall through */ }
      const firstArr = cleaned.indexOf('['), lastArr = cleaned.lastIndexOf(']');
      const firstObj = cleaned.indexOf('{'), lastObj = cleaned.lastIndexOf('}');
      const tryParse = function (a, b) { if (a < 0 || b <= a) return null; try { return JSON.parse(cleaned.slice(a, b + 1)); } catch (e) { return null; } };
      if (firstArr >= 0 && (firstObj < 0 || firstArr < firstObj)) return tryParse(firstArr, lastArr) || tryParse(firstObj, lastObj);
      return tryParse(firstObj, lastObj) || tryParse(firstArr, lastArr);
    }

    function sectionIndexByName(ch, name) {
      if (!ch || !ch.sections || !ch.sections.length) return 0;
      const n = (name || '').toLowerCase().replace(/^\[\d+\]\s*/, '').trim();
      let idx = ch.sections.findIndex(function (s) { return s.toLowerCase() === n; });
      if (idx < 0) idx = ch.sections.findIndex(function (s) { return n && (s.toLowerCase().includes(n) || n.includes(s.toLowerCase())); });
      return idx;
    }

    function parseChapterReview(raw, ch) {
      const parsed = parseJsonLoose(raw);
      const arr = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.findings) ? parsed.findings : null);
      if (arr) {
        return arr.filter(function (f) { return f && (f.note || f.excerpt); }).map(function (f) {
          const type = String(f.type || 'weak').toLowerCase();
          return {
            type: ['missing', 'weak', 'inconsistent', 'unsupported'].indexOf(type) >= 0 ? type : 'weak',
            severity: ['high', 'medium', 'low'].indexOf(String(f.severity || '').toLowerCase()) >= 0 ? String(f.severity).toLowerCase() : 'medium',
            section: String(f.section || ''), sectionIndex: sectionIndexByName(ch, f.section),
            excerpt: String(f.excerpt || '').trim(), note: String(f.note || '').trim(), suggestion: String(f.suggestion || '').trim()
          };
        });
      }
      // Legacy line format fallback ("TYPE (severity): section — note").
      return raw.split('\n').map(function (l) { return l.replace(/^[-*]\s*/, '').trim(); }).filter(Boolean).map(function (l) {
        const m = l.match(/^(missing|weak|inconsistent|unsupported)\s*\(([^)]+)\)\s*:\s*([^:]*)[:—-]\s*(.*)$/i);
        return m ? { type: m[1].toLowerCase(), severity: m[2].toLowerCase(), section: m[3].trim(), sectionIndex: sectionIndexByName(ch, m[3]), excerpt: '', note: m[4].trim(), suggestion: '' }
          : { type: 'weak', severity: 'medium', section: '', sectionIndex: -1, excerpt: '', note: l, suggestion: '' };
      });
    }

    const FIX_ACTION = { label: 'Fix issue', model: 'corpus101' };
    let fixState = null; // { edits: [...], onApplied: fn }

    function sectionText(chapterKey, sectionIndex) {
      return extractPlainText(getSectionContent(chapterKey, sectionIndex)).replace(/\n{3,}/g, '\n\n').trim();
    }

    // Deep search: hands the AI the exact passages involved and asks for
    // precise, verbatim-anchored edits.
    async function requestFixEdits(problem, targets) {
      const system = 'You are Project SI\'s fix engine for a student\'s academic project. You receive one specific problem and the FULL text of the sections involved (each tagged [chapterKey|sectionIndex]). Locate the exact passage(s) responsible and write corrected text.\n\nRules:\n- "original" MUST be copied VERBATIM, character-for-character, from the section text given (a whole sentence or a few sentences). Never paraphrase it.\n- "replacement" is the corrected text that replaces "original" exactly — same language, voice and citation style, no markdown.\n- For something MISSING, set "original" to "" and give "insertAfter": a verbatim sentence from that section after which the new text belongs (or "" to add it at the end of the section); "replacement" is the new text to insert.\n- Treat the Research Setup and the Methodology chapter as the source of truth for figures, design and instruments. Never invent sources, statistics or sample sizes that are not already established.\n- Keep edits minimal: change only what fixes the problem.\n\nReturn ONLY JSON (no code fences): {"summary":"<one or two sentences: what is wrong and exactly where>","edits":[{"chapterKey":"...","sectionIndex":0,"original":"...","insertAfter":"...","replacement":"...","reason":"<why this edit fixes it>"}]}';
      const blocks = targets.map(function (t) {
        return '### [' + t.chapterKey + '|' + t.sectionIndex + '] ' + locationLabel(t.chapterKey, t.sectionIndex) + '\n' + clip(sectionText(t.chapterKey, t.sectionIndex) || '(this section is empty)', 6000);
      }).join('\n\n');
      const user = buildResearchSetupContext() + '\n\nPROJECT: "' + currentProject.title + '" (' + (currentProject.approach === 'qualitative' ? 'qualitative' : 'quantitative') + ', reference style ' + getReferenceStyle() + ')\n\nPROBLEM TO FIX:\n' + problem + '\n\nSECTIONS INVOLVED:\n' + blocks;
      const raw = await callProjectAI(FIX_ACTION, system, user);
      const parsed = parseJsonLoose(raw);
      if (!parsed || !Array.isArray(parsed.edits)) throw new Error('Project SI could not produce a precise fix. Please try again.');
      const valid = {};
      targets.forEach(function (t) { valid[t.chapterKey + '|' + t.sectionIndex] = true; });
      const edits = parsed.edits.map(function (e) {
        const key = String(e.chapterKey || targets[0].chapterKey) + '|' + (parseInt(e.sectionIndex, 10) || 0);
        const target = valid[key] ? { chapterKey: key.split('|')[0], sectionIndex: parseInt(key.split('|')[1], 10) } : targets[0];
        return { chapterKey: target.chapterKey, sectionIndex: target.sectionIndex, original: String(e.original || '').trim(), insertAfter: String(e.insertAfter || '').trim(), replacement: String(e.replacement || '').trim(), reason: String(e.reason || '').trim(), apply: true };
      }).filter(function (e) { return e.replacement; });
      return { summary: String(parsed.summary || ''), edits: edits };
    }

    function openFixModalLoading(title, where) {
      const modal = document.getElementById('projFixModal');
      document.getElementById('projFixTitle').textContent = title;
      document.getElementById('projFixBody').innerHTML = '<div class="proj-fix-loading"><div class="spinner"></div><p>Deep-searching ' + escapeHtml(where) + '…</p><small>Project SI is reading the exact passages involved and drafting a precise fix.</small></div>';
      document.getElementById('projFixApplyBtn').style.display = 'none';
      modal.classList.add('active');
    }

    function renderFixModal(result) {
      const body = document.getElementById('projFixBody');
      if (!result.edits.length) {
        body.innerHTML = '<p class="proj-fix-summary">' + escapeHtml(result.summary || 'No change is needed here.') + '</p><div class="review-finding review-ok"><i class="bx bx-check-circle"></i> Project SI found nothing to change for this issue.</div>';
        document.getElementById('projFixApplyBtn').style.display = 'none';
        return;
      }
      body.innerHTML = (result.summary ? '<p class="proj-fix-summary">' + escapeHtml(result.summary) + '</p>' : '') +
        result.edits.map(function (e, i) {
          return '<div class="proj-fix-edit">' +
            '<div class="proj-fix-edit-head"><label><input type="checkbox" class="proj-fix-apply" data-i="' + i + '" checked> Apply</label>' +
            '<button type="button" class="review-goto" data-fix-goto="' + i + '"><i class="bx bx-link-external"></i> ' + escapeHtml(locationLabel(e.chapterKey, e.sectionIndex)) + '</button></div>' +
            (e.original ? '<div class="proj-fix-label">Current text</div><blockquote class="proj-fix-original">' + escapeHtml(e.original) + '</blockquote>'
              : '<div class="proj-fix-label">Missing — will be inserted ' + (e.insertAfter ? 'after: <em>“' + escapeHtml(e.insertAfter.substring(0, 120)) + (e.insertAfter.length > 120 ? '…' : '') + '”</em>' : 'at the end of the section') + '</div>') +
            '<div class="proj-fix-label">Suggested ' + (e.original ? 'replacement' : 'text') + ' <small>(you can edit it)</small></div>' +
            '<textarea class="proj-fix-replacement" data-i="' + i + '" rows="4">' + escapeHtml(e.replacement) + '</textarea>' +
            (e.reason ? '<div class="proj-fix-reason"><i class="bx bx-info-circle"></i> ' + escapeHtml(e.reason) + '</div>' : '') +
            '</div>';
        }).join('');
      document.getElementById('projFixApplyBtn').style.display = '';
    }

    async function runFix(title, where, problem, targets, onApplied) {
      if (!currentProject) return;
      if (!canAccessAISupervisor()) { showToast('Fixing with Project SI requires Student or Pro plan.', 'error'); goToSubscription(); return; }
      saveCurrentSection();
      openFixModalLoading(title, where);
      fixState = { edits: [], onApplied: onApplied };
      try {
        const result = await requestFixEdits(problem, targets);
        if (!fixState) return; // closed while loading
        fixState.edits = result.edits;
        renderFixModal(result);
      } catch (err) {
        reportError(err, 'project fix');
        document.getElementById('projFixBody').innerHTML = '<div class="review-finding review-high"><i class="bx bx-error-circle"></i> ' + escapeHtml(err.message || 'Fix failed') + '</div>';
      }
    }

    function openFixForConsistency(f) {
      if (!f) return;
      const seen = {}; const targets = [];
      f.occurrences.forEach(function (o) { const k = o.chapterKey + '|' + o.sectionIndex; if (!seen[k]) { seen[k] = true; targets.push({ chapterKey: o.chapterKey, sectionIndex: o.sectionIndex }); } });
      // Always let the AI see the methodology's sample description as the reference point.
      const methodKey = getChaptersStructure().chapter3 ? 'chapter3' : null;
      if (methodKey) [1, 2].forEach(function (i) { const k = methodKey + '|' + i; if (!seen[k] && getSectionContent(methodKey, i).trim()) { seen[k] = true; targets.push({ chapterKey: methodKey, sectionIndex: i }); } });
      const problem = f.note + '\nOccurrences:\n' + f.occurrences.map(function (o) { return '- ' + o.match + ' in [' + o.chapterKey + '|' + o.sectionIndex + '] ' + locationLabel(o.chapterKey, o.sectionIndex) + ': "' + o.sentence + '"'; }).join('\n') +
        '\nDecide the single correct figure (from the Research Setup / methodology) and correct every passage that uses a different one.';
      runFix('Fix: ' + (f.kind === 'sample' ? 'sample size conflict' : 'participant count conflict'), targets.length + ' section' + (targets.length === 1 ? '' : 's'), problem, targets, function () {
        renderConsistencyFindings(checkConsistency(true));
      });
    }

    function openFixForFinding(f, index) {
      const ch = getChaptersStructure()[currentChapter];
      const secIdx = typeof f.sectionIndex === 'number' && f.sectionIndex >= 0 ? f.sectionIndex : 0;
      const targets = [{ chapterKey: currentChapter, sectionIndex: secIdx }];
      const problem = f.type.toUpperCase() + ' (' + f.severity + ') in ' + locationLabel(currentChapter, secIdx) + ': ' + f.note +
        (f.excerpt ? '\nProblem passage (verbatim): "' + f.excerpt + '"' : '') + (f.suggestion ? '\nReviewer suggestion: ' + f.suggestion : '');
      const chapterKeyAtOpen = currentChapter;
      runFix('Fix: ' + f.type + ' — ' + (ch && ch.sections && ch.sections.length ? ch.sections[secIdx] : (ch ? ch.title : '')), locationLabel(currentChapter, secIdx), problem, targets, async function () {
        const cached = (currentProject.reviewFindings || {})[chapterKeyAtOpen];
        if (cached && cached.findings && cached.findings[index]) {
          cached.findings[index].fixed = true;
          try { await database.ref('history/' + scopeUid + '/projects/' + currentProjectId + '/reviewFindings/' + chapterKeyAtOpen + '/findings/' + index + '/fixed').set(true); } catch (e) { /* best-effort */ }
        }
        renderChapterFindings();
      });
    }

    // Applies one edit to a section's HTML. Tries an exact match first, then
    // matches inside the smallest block whose text contains the passage
    // (keeps every other paragraph's formatting intact).
    function applyEditToHtml(html, edit) {
      const esc = function (s) { return escapeHtml(s); };
      const norm = function (s) { return s.replace(/\s+/g, ' ').trim(); };
      const div = document.createElement('div');
      div.innerHTML = html || '';
      const blocks = Array.from(div.querySelectorAll('p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote'));
      if (edit.original) {
        const rep = function () { return esc(edit.replacement); }; // function form: no "$&"-style substitutions
        if (html.indexOf(edit.original) >= 0) return { html: html.replace(edit.original, rep), ok: true };
        if (html.indexOf(esc(edit.original)) >= 0) return { html: html.replace(esc(edit.original), rep), ok: true };
        const target = norm(edit.original);
        const block = blocks.filter(function (b) { return norm(b.textContent).indexOf(target) >= 0; }).sort(function (a, b) { return a.textContent.length - b.textContent.length; })[0];
        if (block) { block.textContent = norm(block.textContent).replace(target, function () { return edit.replacement; }); return { html: div.innerHTML, ok: true }; }
        if (norm(div.textContent) === target) return { html: '<p>' + esc(edit.replacement) + '</p>', ok: true };
        return { html: html, ok: false };
      }
      const paras = edit.replacement.split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
      if (edit.insertAfter) {
        const t = norm(edit.insertAfter);
        const block = blocks.filter(function (b) { return norm(b.textContent).indexOf(t) >= 0; }).sort(function (a, b) { return a.textContent.length - b.textContent.length; })[0];
        if (block) { block.insertAdjacentHTML('afterend', paras); return { html: div.innerHTML, ok: true }; }
      }
      return { html: (html || '') + paras, ok: true };
    }

    function setSectionHtml(chapterKey, sectionIndex, html) {
      const ch = getChaptersStructure()[chapterKey];
      if (!currentProject.chapters) currentProject.chapters = {};
      if (!currentProject.chapters[chapterKey]) currentProject.chapters[chapterKey] = { sections: {} };
      if (ch && ch.sections && ch.sections.length) {
        if (!currentProject.chapters[chapterKey].sections) currentProject.chapters[chapterKey].sections = {};
        currentProject.chapters[chapterKey].sections[sectionIndex] = html;
      } else currentProject.chapters[chapterKey].content = html;
      if (chapterKey === currentChapter && sectionIndex === currentSection) sectionEditor.innerHTML = html;
    }

    document.getElementById('projFixBody')?.addEventListener('click', function (e) {
      const go = e.target.closest('[data-fix-goto]');
      if (!go || !fixState) return;
      const edit = fixState.edits[parseInt(go.dataset.fixGoto, 10)];
      document.getElementById('projFixModal').classList.remove('active');
      if (edit) goToPassage(edit.chapterKey, edit.sectionIndex, edit.original || edit.insertAfter);
    });

    document.getElementById('projFixApplyBtn')?.addEventListener('click', async function () {
      if (!fixState || !fixState.edits.length) return;
      const body = document.getElementById('projFixBody');
      body.querySelectorAll('.proj-fix-apply').forEach(function (cb) { fixState.edits[parseInt(cb.dataset.i, 10)].apply = cb.checked; });
      body.querySelectorAll('.proj-fix-replacement').forEach(function (ta) { fixState.edits[parseInt(ta.dataset.i, 10)].replacement = ta.value.trim(); });
      const chosen = fixState.edits.filter(function (e) { return e.apply && e.replacement; });
      if (!chosen.length) { showToast('Select at least one fix to apply', 'info'); return; }
      saveCurrentSection();
      await saveVersion(); // the currently open section can be restored from Version History
      let applied = 0; const missed = [];
      chosen.forEach(function (e) {
        const before = getSectionContent(e.chapterKey, e.sectionIndex);
        const r = applyEditToHtml(before, e);
        if (r.ok) { setSectionHtml(e.chapterKey, e.sectionIndex, r.html); applied++; } else missed.push(e);
      });
      await saveToFirebase({ sections: chosen.map(function (e) { return [e.chapterKey, e.sectionIndex]; }) });
      renderChapters(); updateSectionNav(); displayHumanizationScore();
      logActivity('section_saved', 'Applied ' + applied + ' SI fix' + (applied === 1 ? '' : 'es'));
      document.getElementById('projFixModal').classList.remove('active');
      const onApplied = fixState.onApplied; fixState = null;
      if (applied && onApplied) await onApplied();
      if (missed.length) {
        const m = missed[0];
        try { await navigator.clipboard.writeText(m.replacement); } catch (err) { /* clipboard may be blocked */ }
        showToast('Applied ' + applied + ' fix' + (applied === 1 ? '' : 'es') + '. One passage had changed and could not be located — its suggested text is on your clipboard.', 'warning', 7000);
        goToPassage(m.chapterKey, m.sectionIndex, m.original);
      } else showToast('Applied ' + applied + ' fix' + (applied === 1 ? '' : 'es'), 'success');
    });

    document.getElementById('closeProjFixModal')?.addEventListener('click', function () { document.getElementById('projFixModal').classList.remove('active'); fixState = null; });
    document.getElementById('projFixCancelBtn')?.addEventListener('click', function () { document.getElementById('projFixModal').classList.remove('active'); fixState = null; });

    function highlightInEditor(quote) {
      const needle = quote.replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!needle) return;
      const walker = document.createTreeWalker(sectionEditor, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const idx = node.nodeValue.replace(/\s+/g, ' ').indexOf(needle);
        const raw = idx >= 0 ? idx : node.nodeValue.indexOf(needle.slice(0, 25));
        if (raw >= 0) {
          const range = document.createRange();
          range.setStart(node, Math.min(raw, node.nodeValue.length));
          range.setEnd(node, Math.min(raw + needle.length, node.nodeValue.length));
          const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
          (node.parentElement || sectionEditor).scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
      }
    }

    document.getElementById('reviewChapterBtn')?.addEventListener('click', function () { runProjectAIAction('reviewChapter'); });

    // =========================================================================
    // EXPORT (ported buildExportHtml/export buttons, restyled into a screen)
    // =========================================================================
    // University Formatting Profiles: a project with a saved profile exports in that layout; one without keeps the original look.
    function projectFormat() { return currentProject && currentProject.formatProfile && window.RehablixProjectTools ? window.RehablixProjectTools.normalizeFormat(currentProject.formatProfile) : null; }
    function projectLayout() { const f = projectFormat(); return f ? window.RehablixProjectTools.docxLayout(f) : null; }
    function pdfMargins() { const f = projectFormat(); return f ? [f.margins.top * 10, f.margins.right * 10, f.margins.bottom * 10 + 3, f.margins.left * 10] : [15, 15, 18, 15]; }
    function chapterH1(title, tag) {
      tag = tag || 'h1';
      const f = projectFormat();
      if (!f) return '<' + tag + '>' + escapeHtml(title) + '</' + tag + '>';
      return window.RehablixProjectTools.chapterHeading(title, f).map(function (l) { return '<' + tag + ' class="chapter-title">' + escapeHtml(l) + '</' + tag + '>'; }).join('');
    }

    function buildExportHtml(scope) {
      const title = currentProject ? currentProject.title : 'Academic Project';
      const department = currentProject ? currentProject.department : '';
      const type = currentProject ? currentProject.type : '';
      const approach = currentProject && currentProject.approach === 'qualitative' ? 'Qualitative Study' : 'Quantitative Study';
      const refStyle = currentProject ? currentProject.referenceStyle || 'APA 7th' : 'APA 7th';
      const chStruct = getChaptersStructure();
      let bodyHtml = '', tocHtml = '', chapterTitle = '';

      if (scope === 'section') {
        const ch = chStruct[currentChapter];
        const secName = ch && ch.sections ? ch.sections[currentSection] : (ch ? ch.title : '');
        chapterTitle = ch ? ch.title : '';
        bodyHtml = '<h2>' + escapeHtml(secName) + '</h2>\n' + stripLeadingTitle(getSectionContent(currentChapter, currentSection), secName);
      } else if (scope === 'chapter') {
        const ch = chStruct[currentChapter];
        chapterTitle = ch ? ch.title : '';
        bodyHtml = '<h2>' + escapeHtml(chapterTitle) + '</h2>\n';
        if (ch && ch.sections && ch.sections.length) {
          ch.sections.forEach(function (sec, i) {
            const content = stripLeadingTitle(getSectionContent(currentChapter, i), sec);
            if (content && content.trim().length > 10) bodyHtml += '<h3>' + escapeHtml(sec) + '</h3>\n' + content + '\n';
          });
        } else bodyHtml += getSectionContent(currentChapter, 0);
        tocHtml = '<h2>Table of Contents</h2><ol><li><strong>' + escapeHtml(chapterTitle) + '</strong></li>';
        if (ch && ch.sections && ch.sections.length) { tocHtml += '<ul>'; ch.sections.forEach(function (sec) { tocHtml += '<li>' + escapeHtml(sec) + '</li>'; }); tocHtml += '</ul>'; }
        tocHtml += '</ol>';
      } else {
        for (const key in chStruct) {
          if (!chStruct.hasOwnProperty(key)) continue;
          const ch = chStruct[key];
          if (!ch.sections || !ch.sections.length) {
            const content = getSectionContent(key, 0);
            if (content && content.trim().length > 10) bodyHtml += chapterH1(ch.title, 'h2') + '\n' + content + '\n';
          } else {
            let hasContent = false, sectionHtml = '';
            ch.sections.forEach(function (sec, i) {
              const content = stripLeadingTitle(getSectionContent(key, i), sec);
              if (content && content.trim().length > 10) { sectionHtml += '<h3>' + escapeHtml(sec) + '</h3>\n' + content + '\n'; hasContent = true; }
            });
            if (hasContent) bodyHtml += chapterH1(ch.title, 'h2') + '\n' + sectionHtml;
          }
        }
        tocHtml = '<h2>Table of Contents</h2><ol>';
        for (const key in chStruct) {
          if (!chStruct.hasOwnProperty(key)) continue;
          const ch = chStruct[key];
          tocHtml += '<li><strong>' + escapeHtml(ch.title) + '</strong>';
          if (ch.sections && ch.sections.length) { tocHtml += '<ul>'; ch.sections.forEach(function (sec) { tocHtml += '<li>' + escapeHtml(sec) + '</li>'; }); tocHtml += '</ul>'; }
          tocHtml += '</li>';
        }
        tocHtml += '</ol>';
      }

      // REDESIGN: append a References section from the structured Reference
      // Manager store (js/docx-export.js integration is a scoped follow-up;
      // this HTML export already benefits from real citation data today).
      let referencesHtml = '';
      if (scope === 'project' && currentProject && currentProject.references) {
        const entries = Object.values(currentProject.references);
        if (entries.length) {
          referencesHtml = '<h2>References</h2><p>' + entries.map(function (r) { return escapeHtml((r.formatted && r.formatted[refStyle]) || formatReferencePlain(r)); }).join('</p><p>') + '</p>';
        }
      }

      return '<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="UTF-8">\n  <title>' + escapeHtml(title) + '</title>\n  <style>\n    @page { size: A4; margin: 2.5cm 2cm 2.5cm 2cm; }\n    body { font-family: "Times New Roman", Georgia, serif; line-height: 1.8; font-size: 12pt; color: #222; }\n    .cover-page { text-align: center; padding-top: 30%; page-break-after: always; }\n    .cover-page h1 { font-size: 22pt; color: #00695c; margin-bottom: 0.5rem; }\n    .cover-page .subtitle { font-size: 14pt; color: #555; margin-bottom: 2rem; }\n    .cover-page .meta { font-size: 11pt; color: #777; line-height: 2; }\n    .toc-page { page-break-after: always; }\n    .toc-page h2 { color: #00695c; border-bottom: 2px solid #00695c; padding-bottom: 0.3rem; }\n    .content-page { page-break-before: ' + (scope === 'section' ? 'auto' : 'always') + '; }\n    h1, h2, h3 { color: #00695c; }\n    h2 { border-bottom: 1px solid #ddd; padding-bottom: 0.3rem; margin-top: 2rem; }\n    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }\n    th, td { border: 1px solid #666; padding: 8px; text-align: left; }\n    th { background: #f0f0f0; }\n    .reference-note { font-size: 10pt; color: #666; font-style: italic; margin-top: 0.5rem; border-top: 1px solid #ddd; padding-top: 0.5rem; }\n    .resources-note { font-size: 10pt; color: #666; margin-top: 0.5rem; padding: 0.5rem; background: #f9f9f9; border-radius: 0.25rem; }\n    @media print { body { margin: 0; } .no-print { display: none; } }\n  </style>\n' + (projectFormat() ? '  <style>\n' + window.RehablixProjectTools.formatCss(projectFormat()) + '    .cover-page h1, .toc-page h2, h1, h2, h3 { color: #111; border: 0; }\n    h2.chapter-title { text-align: center; margin: 0.2em 0; }\n  </style>\n' : '') + '</head>\n<body>\n' +
        (scope === 'project' ? '\n  <div class="cover-page">\n    <h1>' + escapeHtml(title) + '</h1>\n    <p class="subtitle">' + escapeHtml(approach) + '</p>\n    <div class="meta">\n      <p><strong>Department:</strong> ' + escapeHtml(department) + '</p>\n      <p><strong>Type:</strong> ' + escapeHtml(type) + '</p>\n      <p><strong>Date:</strong> ' + new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }) + '</p>\n      <p><strong>Reference Style:</strong> ' + escapeHtml(refStyle) + '</p>\n      <p style="margin-top: 3rem;"><em>Generated by rehablix Academic Project Maker</em></p>\n    </div>\n  </div>\n  <div class="toc-page">' + tocHtml + '</div>\n  ' : (scope === 'chapter' ? '\n  <div class="toc-page">' + tocHtml + '</div>\n  ' : '')) +
        '\n  <div class="content-page">\n    ' + (scope === 'chapter' ? '<h1>' + escapeHtml(chapterTitle) + '</h1>\n    ' : '') + bodyHtml + '\n    ' + referencesHtml + '\n    ' + (resources.length > 0 ? '<div class="resources-note"><strong>Resources Referenced:</strong> ' + resources.map(function (r) { return r.name; }).join(', ') + '</div>' : '') + '\n    ' + (scope === 'section' ? '<p class="reference-note">Reference Style: ' + escapeHtml(refStyle) + '</p>' : '') + '\n  </div>\n</body>\n</html>';
    }

    function renderExportScreen() {
      if (!currentProject) { setProjectActive(false); switchScreen('projects'); return; }
      const preview = document.getElementById('exportPreview');
      if (preview) {
        preview.innerHTML = '<div class="export-preview-title">' + escapeHtml(currentProject.title || 'Untitled') + '</div>' +
          '<div class="export-preview-meta">' + escapeHtml(currentProject.department || '') + ' &middot; ' + escapeHtml(currentProject.type || '') + ' &middot; ' + (currentProject.referenceStyle || 'APA 7th') + '</div>';
      }
    }

    // Structured export content shared by Word (.docx), PDF and Print: cover
    // lines, a contents list, the body split into page-broken parts, and the
    // formatted references.
    function buildExportParts(scope) {
      const chStruct = getChaptersStructure();
      const refStyle = (currentProject && currentProject.referenceStyle) || 'APA 7th';
      const parts = [];
      let toc = null, coverLines = null;
      if (scope === 'section') {
        const ch = chStruct[currentChapter];
        const secName = ch && ch.sections && ch.sections.length ? ch.sections[currentSection] : (ch ? ch.title : '');
        parts.push({ html: '<h2>' + escapeHtml(secName) + '</h2>' + stripLeadingTitle(getSectionContent(currentChapter, currentSection), secName), pageBreakBefore: false });
      } else if (scope === 'chapter') {
        const ch = chStruct[currentChapter];
        let html = chapterH1(ch ? ch.title : '');
        if (ch && ch.sections && ch.sections.length) {
          ch.sections.forEach(function (sec, i) { const c = stripLeadingTitle(getSectionContent(currentChapter, i), sec); if (c && c.trim().length > 10) html += '<h2>' + escapeHtml(sec) + '</h2>' + c; });
        } else html += getSectionContent(currentChapter, 0);
        parts.push({ html: html, pageBreakBefore: false });
        toc = ch ? [{ title: ch.title, sections: ch.sections || [] }] : null;
      } else {
        coverLines = [
          currentProject && currentProject.approach === 'qualitative' ? 'Qualitative Study' : 'Quantitative Study',
          'Department: ' + ((currentProject && currentProject.department) || ''),
          'Type: ' + ((currentProject && currentProject.type) || ''),
          'Date: ' + new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }),
          'Reference Style: ' + refStyle
        ];
        toc = [];
        for (const key in chStruct) {
          if (!chStruct.hasOwnProperty(key)) continue;
          const ch = chStruct[key];
          toc.push({ title: ch.title, sections: ch.sections || [] });
          let html = '';
          if (!ch.sections || !ch.sections.length) {
            const c = getSectionContent(key, 0);
            if (c && c.trim().length > 10) html = chapterH1(ch.title) + c;
          } else {
            ch.sections.forEach(function (sec, i) { const c = stripLeadingTitle(getSectionContent(key, i), sec); if (c && c.trim().length > 10) html += '<h2>' + escapeHtml(sec) + '</h2>' + c; });
            if (html) html = chapterH1(ch.title) + html;
          }
          if (html) parts.push({ html: html, pageBreakBefore: true }); // each chapter starts on a new page
        }
      }
      const references = scope === 'project' && currentProject && currentProject.references
        ? Object.values(currentProject.references).map(function (r) { return (r.formatted && r.formatted[refStyle]) || formatReferencePlain(r); })
        : [];
      return { coverLines: coverLines, toc: toc, parts: parts, references: references };
    }

    function exportFileBase(scope) {
      const title = (currentProject && currentProject.title) || 'Academic Project';
      return title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50) + '_' + scope;
    }

    // REPLACED the HTML-saved-as-.doc export with a real .docx (js/docx-export.js):
    // Word heading styles, a page break per chapter, page numbers, references.
    document.getElementById('exportWordBtn')?.addEventListener('click', async function () {
      saveCurrentSection(); await saveToFirebase();
      const scope = exportScopeSelect ? exportScopeSelect.value : 'section';
      try {
        const p = buildExportParts(scope);
        await window.RehablixDocx.downloadProject(Object.assign({ title: (currentProject && currentProject.title) || 'Academic Project', fileBase: exportFileBase(scope), layout: projectLayout() }, p));
        logActivity('exported', scope);
        showToast((scope === 'section' ? 'Section' : scope === 'chapter' ? 'Chapter' : 'Project') + ' exported as Word (.docx)', 'success');
      } catch (err) {
        reportError(err, 'export');
        showToast('Word export failed: ' + (err.message || 'unknown error'), 'error', 5000);
      }
    });

    // PDF without popup windows (blocked on most phones): rendered in-page with
    // html2pdf.js, with "Page X of Y" stamped on every page, then downloaded.
    document.getElementById('exportPdfBtn')?.addEventListener('click', async function () {
      saveCurrentSection(); saveToFirebase();
      const scope = exportScopeSelect ? exportScopeSelect.value : 'section';
      if (typeof html2pdf === 'undefined') { showToast('PDF library is still loading — try again in a moment.', 'info'); return; }
      const btn = this; btn.disabled = true;
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#fff;';
      host.innerHTML = extractExportBody(buildExportHtml(scope));
      document.body.appendChild(host);
      try {
        await html2pdf().set({
          margin: pdfMargins(), filename: exportFileBase(scope) + '.pdf',
          image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'], before: '.content-page, .toc-page, .pdf-page-break' }
        }).from(host).toPdf().get('pdf').then(function (pdf) {
          const total = pdf.internal.getNumberOfPages();
          for (let i = 1; i <= total; i++) {
            pdf.setPage(i); pdf.setFontSize(9); pdf.setTextColor(120);
            pdf.text('Page ' + i + ' of ' + total, pdf.internal.pageSize.getWidth() / 2, pdf.internal.pageSize.getHeight() - 8, { align: 'center' });
          }
        }).save();
        logActivity('exported', scope + ' (PDF)');
        showToast('PDF downloaded', 'success');
      } catch (err) {
        reportError(err, 'export');
        showToast('PDF export failed — try Print instead.', 'error', 5000);
      } finally { host.remove(); btn.disabled = false; }
    });

    // Print through a hidden iframe (no popup window).
    document.getElementById('exportPrintBtn')?.addEventListener('click', function () {
      saveCurrentSection(); saveToFirebase();
      const scope = exportScopeSelect ? exportScopeSelect.value : 'section';
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
      document.body.appendChild(frame);
      const doc = frame.contentWindow.document;
      doc.open(); doc.write(buildExportHtml(scope)); doc.close();
      setTimeout(function () {
        try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { showToast('Printing is not available in this browser.', 'error'); }
        setTimeout(function () { frame.remove(); }, 60000);
      }, 400);
      logActivity('exported', scope + ' (print)');
    });

    // The <style> + body of the print document, for the in-page PDF renderer.
    function extractExportBody(fullHtml) {
      const d = new DOMParser().parseFromString(fullHtml, 'text/html');
      const style = d.querySelector('style');
      return (style ? '<style>' + style.textContent.replace(/@page[^}]*}/g, '').replace(/body\s*\{/g, '.pdf-root{') + '</style>' : '') +
        '<div class="pdf-root">' + d.body.innerHTML + '</div>';
    }

    // =========================================================================
    // REFERENCE MANAGER — REDESIGN (new): structured source CRUD + AI
    // citation formatting. Rendered both inline in Workspace (compact) and
    // as its own Project Tools screen (full list) — same functions, two
    // containers.
    // =========================================================================
    function formatReferencePlain(r) {
      const authorNames = (r.authors || []).map(function (a) { return a.family + (a.given ? ', ' + a.given.charAt(0) + '.' : ''); }).join(', ');
      return (authorNames || 'Unknown author') + ' (' + (r.year || 'n.d.') + '). ' + (r.title || 'Untitled') + '. ' + (r.source || '');
    }

    function renderReferenceList(containerId) {
      const container = document.getElementById(containerId);
      if (!container) return;
      const refs = (currentProject && currentProject.references) || {};
      const entries = Object.entries(refs);
      if (!entries.length) {
        container.innerHTML = '<div class="emr-empty-state" style="padding:1rem;"><i class="bx bx-bookmark"></i><p style="font-size:0.85rem;">No references yet</p></div>';
        return;
      }
      const refStyle = (currentProject && currentProject.referenceStyle) || 'APA 7th';
      container.innerHTML = entries.map(function (entry) {
        const id = entry[0], r = entry[1];
        const hasAIFormat = !!(r.formatted && r.formatted[refStyle]);
        const formatted = hasAIFormat ? r.formatted[refStyle] : formatReferencePlain(r);
        const isFormatting = formattingRefId === id;
        return '<div class="reference-item" data-id="' + id + '">' +
          '<div>' +
          '<div class="reference-text">' + escapeHtml(formatted) + '</div>' +
          (isFormatting ? '<div class="reference-status"><i class="bx bx-loader-alt bx-spin"></i> Formatting citation...</div>'
            : !hasAIFormat ? '<div class="reference-status reference-status-plain">Plain format &middot; <button type="button" class="ref-format-btn" data-id="' + id + '">SI-format in ' + escapeHtml(refStyle) + '</button></div>' : '') +
          '</div>' +
          '<div class="reference-actions"><button class="icon-btn-sm ref-edit-btn" data-id="' + id + '" title="Edit"><i class="fas fa-edit"></i></button>' +
          '<button class="icon-btn-sm ref-delete-btn" data-id="' + id + '" title="Delete"><i class="fas fa-trash"></i></button></div></div>';
      }).join('');

      container.querySelectorAll('.ref-delete-btn').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          if (!confirm('Delete this reference?')) return;
          const id = btn.dataset.id;
          delete currentProject.references[id];
          await database.ref('history/' + scopeUid + '/projects/' + currentProjectId + '/references/' + id).remove();
          renderReferenceList('referenceListWorkspace'); renderReferenceList('referenceListTools');
          showToast('Reference removed', 'success');
        });
      });
      container.querySelectorAll('.ref-edit-btn').forEach(function (btn) {
        btn.addEventListener('click', function () { openReferenceForm(btn.dataset.id); });
      });
      container.querySelectorAll('.ref-format-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const id = btn.dataset.id;
          const record = currentProject.references[id];
          if (record) formatReferenceWithAI(id, record).catch(function () {});
        });
      });
    }

    function openReferenceForm(refId) {
      const modal = document.getElementById('referenceModal');
      const r = refId && currentProject.references ? currentProject.references[refId] : {};
      document.getElementById('refFormId').value = refId || '';
      document.getElementById('refFormType').value = (r && r.type) || 'journal';
      document.getElementById('refFormAuthors').value = (r && r.authors) ? r.authors.map(function (a) { return a.family + (a.given ? ', ' + a.given : ''); }).join('; ') : '';
      document.getElementById('refFormYear').value = (r && r.year) || '';
      document.getElementById('refFormTitle').value = (r && r.title) || '';
      document.getElementById('refFormSource').value = (r && r.source) || '';
      document.getElementById('refFormUrl').value = (r && r.url) || '';
      modal.classList.add('active');
    }

    document.getElementById('addReferenceBtnWorkspace')?.addEventListener('click', function () { openReferenceForm(null); });
    document.getElementById('addReferenceBtnTools')?.addEventListener('click', function () { openReferenceForm(null); });
    document.getElementById('closeReferenceModal')?.addEventListener('click', function () { document.getElementById('referenceModal').classList.remove('active'); });

    document.getElementById('saveReferenceBtn')?.addEventListener('click', async function () {
      if (!currentProject || !currentProjectId) return;
      if (!canAccessReferenceManager()) { showToast('Reference Manager requires Student plan or higher.', 'error'); goToSubscription(); return; }
      const id = document.getElementById('refFormId').value || database.ref('history/' + scopeUid + '/projects/' + currentProjectId + '/references').push().key;
      const authorsRaw = document.getElementById('refFormAuthors').value.trim();
      const authors = authorsRaw ? authorsRaw.split(';').map(function (s) {
        const parts = s.trim().split(',');
        return { family: (parts[0] || '').trim(), given: (parts[1] || '').trim() };
      }) : [];
      const record = {
        type: document.getElementById('refFormType').value,
        authors: authors,
        year: document.getElementById('refFormYear').value.trim(),
        title: document.getElementById('refFormTitle').value.trim(),
        source: document.getElementById('refFormSource').value.trim(),
        url: document.getElementById('refFormUrl').value.trim(),
        formatted: {},
        createdAt: (currentProject.references && currentProject.references[id] && currentProject.references[id].createdAt) || firebase.database.ServerValue.TIMESTAMP,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      };
      if (!currentProject.references) currentProject.references = {};
      currentProject.references[id] = record;
      try {
        await database.ref('history/' + scopeUid + '/projects/' + currentProjectId + '/references/' + id).set(record);
        document.getElementById('referenceModal').classList.remove('active');
        renderReferenceList('referenceListWorkspace'); renderReferenceList('referenceListTools');
        logActivity('reference_added', record.title);
        showToast('Reference saved', 'success');
        formatReferenceWithAI(id, record).catch(function () {});
      } catch (err) { reportError(err, 'reference save'); }
    });

    // AI-assisted citation formatting into the project's selected reference
    // style — cached on the reference record so it doesn't need re-formatting
    // on every render/export.
    // REDESIGN (item 9): made every failure path visible instead of silent
    // — a reference used to just sit on the plain-text fallback forever with
    // no indication AI formatting ever ran or why it didn't, which read as
    // "this doesn't work." Also exposed a manual retry (formatBtn below).
    let formattingRefId = null;
    async function formatReferenceWithAI(refId, record) {
      const style = (currentProject && currentProject.referenceStyle) || 'APA 7th';
      formattingRefId = refId;
      renderReferenceList('referenceListWorkspace'); renderReferenceList('referenceListTools');
      try {
        const config = await window.RehablixAIQuotaCore.resolveModelConfig('basal100');
        if (!config) { showToast('SI citation formatting is not configured right now — using plain format instead.', 'warning', 4000); return; }
        await window.RehablixAIQuotaCore.checkQuotaOrThrow(currentUser.uid, currentPlan);
        const systemPrompt = 'You are a citation formatting assistant. Given a source\'s details, output ONLY the correctly formatted reference-list entry in the requested style. No commentary, no markdown, just the citation text.';
        const userPrompt = 'Style: ' + style + '\nType: ' + record.type + '\nAuthors: ' + (record.authors || []).map(function (a) { return a.family + (a.given ? ', ' + a.given : ''); }).join('; ') + '\nYear: ' + record.year + '\nTitle: ' + record.title + '\nSource: ' + record.source + (record.url ? '\nURL: ' + record.url : '');
        const response = await fetch(config.endpoint + '/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
          body: JSON.stringify({ model: config.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], max_tokens: 300, temperature: 0.3 })
        });
        if (!response.ok) throw new Error('SI service returned an error');
        const data = await response.json();
        const formatted = data.choices && data.choices[0] && data.choices[0].message.content;
        if (!formatted) throw new Error('SI service returned an empty response');
        if (!currentProject.references[refId]) return; // reference was deleted while formatting was in flight
        currentProject.references[refId].formatted = currentProject.references[refId].formatted || {};
        currentProject.references[refId].formatted[style] = formatted.trim();
        await database.ref('history/' + scopeUid + '/projects/' + currentProjectId + '/references/' + refId + '/formatted/' + style).set(formatted.trim());
        window.RehablixAIQuotaCore.reportTokenUsage(currentUser.uid, currentPlan, systemPrompt + userPrompt + formatted, config.weight);
      } catch (e) {
        reportError(e, 'reference citation formatting');
        showToast('Could not SI-format this citation — showing the plain version instead.', 'warning', 4000);
      } finally {
        formattingRefId = null;
        renderReferenceList('referenceListWorkspace'); renderReferenceList('referenceListTools');
      }
    }

    // =========================================================================
    // PROJECT TOOLS SCREEN — REDESIGN (new)
    // =========================================================================
    // Phase 1 tools are built (calculations in js/project-tools-core.js); the rest are still to come.
    const BUILT_TOOLS = [
      { id: 'referenceManager', name: 'Reference Manager', icon: 'bx-bookmark', desc: 'Store sources and generate citations in your selected style.' },
      { id: 'projectSearch', name: 'Project-wide Search', icon: 'bx-search', desc: 'Search every chapter, section and reference, and jump straight to the passage.' },
      { id: 'sampleSizeCalc', name: 'Sample Size Calculator', icon: 'bx-calculator', desc: 'A justified sample size for your design (Yamane, Cochran, t-tests, proportions, correlation), with a ready-written paragraph.' },
      { id: 'statsPlanner', name: 'Statistical Analysis Planner', icon: 'bx-line-chart', desc: 'Which test fits each research question, with its non-parametric alternative, and your Data Analysis paragraph.' },
      { id: 'researchAlignment', name: 'Research Alignment', icon: 'bx-git-branch', desc: 'Objectives → research questions → hypotheses → method → results → discussion, with the gaps shown.' },
      { id: 'claimChecker', name: 'Claim & Citation Checker', icon: 'bx-shield-quarter', desc: 'Citations missing from your reference lists, references never cited, and claims that need a source.' },
      { id: 'projectHistory', name: 'Project Activity & History', icon: 'bx-history', desc: 'A timeline of what changed and when, with a way back to any saved version.' },
      { id: 'methodologyBuilder', name: 'Methodology Builder', icon: 'bx-flask', desc: 'Answer a few questions and get every Chapter 3 section written: design, setting, population, sampling, instrument, procedure, ethics, analysis.' },
      { id: 'instrumentBuilder', name: 'Questionnaire Builder', icon: 'bx-list-check', desc: 'Build your questionnaire with rating scales, get the layout examiners expect, and the validity and reliability paragraph.' },
      { id: 'literatureMatrix', name: 'Literature Matrix & Gap Finder', icon: 'bx-table', desc: 'Organise studies by author, design, population and findings, see how recent your evidence is, and find the gaps your study fills.' },
      { id: 'defensePrep', name: 'Defense Preparation', icon: 'bx-podium', desc: 'Practise the questions examiners ask about your own project, and get each answer scored with feedback.' },
      { id: 'formattingProfiles', name: 'Formatting Profiles', icon: 'bx-buildings', desc: 'Font, spacing, margins, chapter headings and page numbers for your export, from common university layouts or your own.' }
    ];
    const DEFERRED_TOOLS = [];
    const PT = window.RehablixProjectTools;

    function renderToolsScreen() {
      if (!currentProject) { setProjectActive(false); switchScreen('projects'); return; }
      renderReferenceList('referenceListTools');
      document.querySelectorAll('.tool-pane').forEach(function (p) { p.style.display = 'none'; });
      const grid = document.getElementById('toolsGrid');
      if (!grid) return;
      grid.style.display = '';
      const card = function (t, built) {
        return '<div class="tool-card-item' + (built ? '' : ' tool-card-deferred') + '" data-tool="' + t.id + '">' +
          '<div class="tool-card-icon"><i class="bx ' + t.icon + '"></i></div>' +
          '<div class="tool-card-name">' + t.name + (built ? '' : '<span class="tool-card-badge">Coming soon</span>') + '</div>' +
          '<div class="tool-card-desc">' + t.desc + '</div>' +
          '<button class="btn ' + (built ? 'btn-primary' : 'btn-secondary') + ' tool-card-open" data-tool="' + t.id + '">' + (built ? 'Open' : 'Preview') + '</button></div>';
      };
      grid.innerHTML = BUILT_TOOLS.map(function (t) { return card(t, true); }).join('') + DEFERRED_TOOLS.map(function (t) { return card(t, false); }).join('');
      grid.querySelectorAll('.tool-card-open').forEach(function (btn) {
        btn.addEventListener('click', function () { openToolPane(btn.dataset.tool); });
      });
    }

    function closeToolPane() {
      document.querySelectorAll('.tool-pane').forEach(function (p) { p.style.display = 'none'; });
      const grid = document.getElementById('toolsGrid'); if (grid) grid.style.display = '';
      window.scrollTo({ top: 0 });
    }

    function openToolPane(toolId) {
      document.querySelectorAll('.tool-pane').forEach(function (p) { p.style.display = 'none'; });
      if (toolId === 'referenceManager') {
        document.getElementById('toolPaneReferenceManager').style.display = 'block';
        return;
      }
      const tool = BUILT_TOOLS.concat(DEFERRED_TOOLS).find(function (t) { return t.id === toolId; });
      const pane = document.getElementById('toolPanePlaceholder');
      if (!pane || !tool) return;
      const grid = document.getElementById('toolsGrid'); if (grid) grid.style.display = 'none';
      pane.style.display = 'block';
      // (each tool pane has its own Back button: the template's two "toolsBackBtn" shared one id, so this one never worked)
      const head = '<button class="btn btn-secondary pt-back"><i class="fas fa-arrow-left"></i> Back to Tools</button>' +
        '<div class="glass-card" style="margin-top:0.8rem;"><div class="card-header"><div class="card-title"><i class="bx ' + tool.icon + '"></i> ' + tool.name + '</div></div><div class="card-body" id="ptBody">';
      const isBuilt = BUILT_TOOLS.some(function (t) { return t.id === toolId; });
      pane.innerHTML = head + (isBuilt ? '' : '<span class="tool-card-badge" style="position:static;">Coming soon</span><p style="margin-top:0.8rem;">' + tool.desc + '</p>') + '</div></div>';
      pane.querySelector('.pt-back').addEventListener('click', closeToolPane);
      window.scrollTo({ top: 0 });
      if (!isBuilt) return;
      if (!PT) { document.getElementById('ptBody').innerHTML = '<p>This tool could not load. Please refresh the page.</p>'; return; }
      const body = document.getElementById('ptBody');
      ({ projectSearch: renderSearchTool, projectHistory: renderHistoryTool, sampleSizeCalc: renderSampleSizeTool, statsPlanner: renderStatsTool,
        researchAlignment: renderAlignmentTool, claimChecker: renderClaimTool, methodologyBuilder: renderMethodologyTool, instrumentBuilder: renderInstrumentTool,
        literatureMatrix: renderMatrixTool, defensePrep: renderDefenseTool, formattingProfiles: renderFormatTool })[toolId](body);
    }

    // ----- shared helpers for the tools -----------------------------------------------------
    // Every section of the project as { chapterKey, sectionIndex, label, html } (the open section's latest edits included).
    function toolSections() {
      if (currentChapter && sectionEditor) saveCurrentSection();
      const out = [];
      const st = getChaptersStructure();
      Object.keys(st).forEach(function (key) {
        const ch = st[key];
        const secs = ch.sections && ch.sections.length ? ch.sections : [null];
        secs.forEach(function (sec, i) {
          out.push({ chapterKey: key, sectionIndex: i, label: sec ? ch.title + ' — ' + sec : ch.title, html: getSectionContent(key, i) || '',
            isReferenceSection: /^(references?|bibliography|reference list)$/i.test(String(sec || ch.title).trim()) });
        });
      });
      return out;
    }
    function managerRefs() {
      return Object.entries((currentProject && currentProject.references) || {}).map(function (e) {
        const r = e[1] || {};
        const first = (r.authors || [])[0] || {};
        return { id: e[0], author: first.family || '', year: r.year || '', raw: formatReferencePlain(r), text: formatReferencePlain(r) };
      });
    }
    // A <select> of every section, the first one whose name matches `prefer` (a RegExp) chosen.
    function sectionSelectHtml(id, prefer, fallback) {
      const secs = toolSections().filter(function (s) { return !s.isReferenceSection; });
      let chosen = secs.findIndex(function (s) { return prefer && prefer.test(s.label); });
      if (chosen < 0 && fallback) chosen = secs.findIndex(function (s) { return fallback.test(s.label); });
      if (chosen < 0) chosen = 0;
      return '<select id="' + id + '" class="pt-input">' + secs.map(function (s, i) {
        return '<option value="' + s.chapterKey + '|' + s.sectionIndex + '"' + (i === chosen ? ' selected' : '') + '>' + escapeHtml(s.label) + '</option>';
      }).join('') + '</select>';
    }
    // Tools write their text into a section: the section opens, a version is saved (undo), then the text is added at the end.
    const textToHtml = function (text) { return String(text || '').split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean).map(function (p) { return '<p>' + escapeHtml(p).replace(/\n/g, '<br>') + '</p>'; }).join(''); };
    function parseTarget(target) { const parts = String(target || '').split('|'); return [parts[0], parseInt(parts[1], 10) || 0]; }
    // Adds HTML to the end of several sections at once: each section's previous text is saved as a version first.
    // items: [{ target: 'chapterKey|index', html }]. Returns the [chapterKey, index] pairs written.
    async function appendToSections(items, what) {
      const st = getChaptersStructure();
      const list = (items || []).map(function (it) { const t = parseTarget(it.target); return { ch: t[0], sec: t[1], html: it.html }; })
        .filter(function (it) { return st[it.ch] && String(it.html || '').trim(); });
      if (!list.length) return [];
      if (currentChapter) saveCurrentSection();
      const written = [];
      for (const it of list) {
        let existing = getSectionContent(it.ch, it.sec) || '';
        if (!PT.plain(existing) && !/<(img|table)\b/i.test(existing)) existing = ''; // only an empty line: replaced, not kept
        if (existing.trim().length >= 50) {
          const versions = await loadVersions(it.ch, it.sec);
          if (!versions.length || versions[0].content !== existing) {
            versions.unshift({ content: existing, timestamp: Date.now(), date: new Date().toLocaleString() });
            if (versions.length > MAX_VERSIONS) versions.length = MAX_VERSIONS;
            try { await versionsRef(it.ch, it.sec).set(versions); } catch (e) { reportError(e, 'save'); }
          }
        }
        setSectionHtml(it.ch, it.sec, (existing.trim() ? existing + '\n' : '') + it.html);
        if (!written.some(function (w) { return w[0] === it.ch && w[1] === it.sec; })) written.push([it.ch, it.sec]);
      }
      await saveToFirebase({ sections: written });
      logActivity('section_saved', what || 'Inserted from Project Tools');
      return written;
    }
    // One section: add the text, then open it in the workspace with the new text selected.
    async function insertIntoSection(target, text, what, isHtml) {
      const html = isHtml ? text : textToHtml(text);
      const done = await appendToSections([{ target: target, html: html }], what);
      if (!done.length) return;
      currentChapter = done[0][0]; currentSection = done[0][1];
      loadSectionContent(); renderChapters();
      switchScreen('workspace'); persistLastOpened(); updateSectionNav(); displayHumanizationScore();
      if (!isHtml) setTimeout(function () { highlightInEditor(String(text).trim().slice(0, 60)); }, 300);
      showToast('Added to "' + locationLabel(done[0][0], done[0][1]) + '". The previous text is in Version History.', 'success', 5000);
    }
    // Saves one tool's data on the project (history/{scope}/projects/{id}/{field}).
    function saveProjectField(field, value) {
      if (!currentProject || !currentProjectId || !scopeUid) return Promise.resolve();
      currentProject[field] = value;
      return database.ref('history/' + scopeUid + '/projects/' + currentProjectId + '/' + field).set(value == null ? null : JSON.parse(JSON.stringify(value))).catch(function (e) { reportError(e, 'save'); });
    }
    const debounced = function (fn, ms) { let t = null; return function () { clearTimeout(t); t = setTimeout(fn, ms || 800); }; };
    function copyText(text) {
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { showToast('Copied', 'success', 1500); }, function () { showToast('Could not copy — select the text and copy it', 'info'); });
    }
    // The written-output box every tool ends with: editable text, a section to put it in, Insert and Copy.
    function outputBoxHtml(prefix, text, prefer) {
      return '<div class="pt-output"><label class="pt-label">Text for your project (you can edit it)</label>' +
        '<textarea id="' + prefix + 'Text" class="pt-input" rows="7">' + escapeHtml(text) + '</textarea>' +
        '<div class="pt-row"><label class="pt-label" style="flex:1 1 100%;">Add it to</label>' + sectionSelectHtml(prefix + 'Target', prefer) + '</div>' +
        '<div class="pt-row"><button class="btn btn-primary" id="' + prefix + 'Insert"><i class="bx bx-down-arrow-circle"></i> Insert into section</button>' +
        '<button class="btn btn-secondary" id="' + prefix + 'Copy"><i class="bx bx-copy"></i> Copy</button></div></div>';
    }
    function wireOutputBox(prefix, what) {
      document.getElementById(prefix + 'Insert')?.addEventListener('click', function () { insertIntoSection(document.getElementById(prefix + 'Target').value, document.getElementById(prefix + 'Text').value, what); });
      document.getElementById(prefix + 'Copy')?.addEventListener('click', function () { copyText(document.getElementById(prefix + 'Text').value); });
    }
    function needsSI(feature) {
      if (isAllowed(feature)) return true;
      showToast('This check uses Project SI, which needs the Student plan or higher.', 'error', 5000); goToSubscription(); return false;
    }

    const optsHtml = function (pairs, val) { return pairs.map(function (p) { return '<option value="' + escapeHtml(String(p[0])) + '"' + (String(p[0]) === String(val) ? ' selected' : '') + '>' + escapeHtml(String(p[1])) + '</option>'; }).join(''); };
    const linesOf = function (s) { return String(s || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); };
    const fieldHtml = function (label, inner, hint) { return '<div class="pt-field"><label class="pt-label">' + label + '</label>' + inner + (hint ? '<small class="pt-muted">' + hint + '</small>' : '') + '</div>'; };

    // ----- Methodology Builder ----------------------------------------------------------------
    function renderMethodologyTool(body) {
      const rs = currentProject.researchSetup || {};
      const qual = currentProject.approach === 'qualitative';
      const a = Object.assign({ design: qual ? 'phenomenology' : 'crossSectional', sampling: qual ? 'purposive' : 'simpleRandom', setting: rs.setting || '', population: rs.population || '',
        populationSize: '', sampleSize: '', sampleNote: '', inclusion: [], exclusion: [], instrument: '', instrumentNote: '', procedure: '', duration: '', ethicsBody: '', analysis: '' }, currentProject.methodology || {});
      const save = debounced(function () { saveProjectField('methodology', a); }, 900);
      const draw = function () {
        const blocks = PT.methodologyBlocks(a);
        body.innerHTML = '<p class="pt-muted">Answer what you can; every answer is saved as you type. The text below updates as you go, and you can edit it before inserting.</p>' +
          '<div class="pt-grid">' +
          fieldHtml('Research design', '<select class="pt-input" data-m="design">' + optsHtml(Object.keys(PT.STUDY_DESIGNS).map(function (k) { return [k, PT.STUDY_DESIGNS[k].label]; }), a.design) + '</select>') +
          fieldHtml('Sampling technique', '<select class="pt-input" data-m="sampling">' + optsHtml(Object.keys(PT.SAMPLING).map(function (k) { return [k, PT.SAMPLING[k].label]; }), a.sampling) + '</select>') +
          fieldHtml('Setting (where the study took place)', '<input class="pt-input" data-m="setting" placeholder="e.g. the Occupational Therapy clinic, ... Teaching Hospital, Ibadan">') +
          fieldHtml('Population', '<input class="pt-input" data-m="population" placeholder="e.g. adults with stroke attending the OT clinic">') +
          fieldHtml('Population size (if known)', '<input class="pt-input" type="number" data-m="populationSize">') +
          fieldHtml('Sample size', '<input class="pt-input" type="number" data-m="sampleSize">', '<a href="#" class="pt-link" id="mbCalc">Work it out with the Sample Size Calculator</a>') +
          fieldHtml('How the sample size was decided (optional)', '<input class="pt-input" data-m="sampleNote" placeholder="e.g. calculated with Yamane\'s formula at a 5% margin of error">') +
          fieldHtml('Instrument', '<input class="pt-input" data-m="instrument" placeholder="e.g. a self-structured questionnaire / the Barthel Index">') +
          fieldHtml('About the instrument (optional)', '<input class="pt-input" data-m="instrumentNote" placeholder="e.g. It has 20 items in 3 sections.">') +
          fieldHtml('Ethics committee', '<input class="pt-input" data-m="ethicsBody" placeholder="e.g. the Health Research Ethics Committee of ...">') +
          fieldHtml('Data collection period (optional)', '<input class="pt-input" data-m="duration" placeholder="e.g. six weeks">') +
          '</div>' +
          '<div class="pt-grid">' + fieldHtml('Inclusion criteria (one per line)', '<textarea class="pt-input" rows="3" data-m="inclusion" placeholder="were aged 18 years and above"></textarea>') +
          fieldHtml('Exclusion criteria (one per line)', '<textarea class="pt-input" rows="3" data-m="exclusion" placeholder="had a cognitive impairment"></textarea>') + '</div>' +
          fieldHtml('Procedure (optional — leave empty for a standard paragraph)', '<textarea class="pt-input" rows="3" data-m="procedure"></textarea>') +
          fieldHtml('Method of data analysis', '<textarea class="pt-input" rows="3" data-m="analysis"></textarea>', '<a href="#" class="pt-link" id="mbStats">Write it with the Statistical Analysis Planner</a>') +
          '<h4 class="pt-h">Your Chapter 3 text</h4>' +
          blocks.map(function (b, i) {
            return '<div class="pt-analysis" style="margin-bottom:0.6rem;"><strong>' + escapeHtml(b.label) + '</strong>' +
              '<textarea class="pt-input" rows="4" id="mbText' + i + '" style="margin-top:0.4rem;">' + escapeHtml(b.text) + '</textarea>' +
              '<div class="pt-row" style="margin-top:0.4rem;"><span class="pt-label" style="margin:0;">Add to</span>' + sectionSelectHtml('mbTarget' + i, new RegExp('method[^—]*—[^—]*(' + b.prefer + ')', 'i'), b.key === 'ethics' ? /method[^—]*—[^—]*(procedure|collection)/i : /method/i) +
              '<button class="btn btn-secondary pt-small" data-mb-insert="' + i + '">Insert</button></div></div>';
          }).join('') +
          '<button class="btn btn-primary" id="mbAll"><i class="bx bx-down-arrow-circle"></i> Insert all ' + blocks.length + ' into their sections</button>';
        body.querySelectorAll('[data-m]').forEach(function (el) {
          const k = el.dataset.m;
          el.value = Array.isArray(a[k]) ? a[k].join('\n') : (a[k] == null ? '' : a[k]);
          el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () {
            a[k] = (k === 'inclusion' || k === 'exclusion') ? linesOf(el.value) : el.value;
            save();
            // refresh only the generated text, so the field being typed in keeps its focus
            PT.methodologyBlocks(a).forEach(function (b, i) { const t = document.getElementById('mbText' + i); if (t) t.value = b.text; });
            if (el.tagName === 'SELECT' || PT.methodologyBlocks(a).length !== blocks.length) {
              const pos = el.selectionStart; draw();
              const again = body.querySelector('[data-m="' + k + '"]');
              if (again && el.tagName !== 'SELECT') { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) { /* number inputs */ } }
            }
          });
        });
        document.getElementById('mbCalc').addEventListener('click', function (e) { e.preventDefault(); openToolPane('sampleSizeCalc'); });
        document.getElementById('mbStats').addEventListener('click', function (e) { e.preventDefault(); openToolPane('statsPlanner'); });
        body.querySelectorAll('[data-mb-insert]').forEach(function (b) {
          b.addEventListener('click', function () { const i = b.dataset.mbInsert; insertIntoSection(document.getElementById('mbTarget' + i).value, document.getElementById('mbText' + i).value, 'Methodology Builder: ' + blocks[i].label); });
        });
        document.getElementById('mbAll').addEventListener('click', async function () {
          const btn = this; btn.disabled = true;
          const items = blocks.map(function (b, i) { return { target: document.getElementById('mbTarget' + i).value, html: textToHtml(document.getElementById('mbText' + i).value) }; });
          const done = await appendToSections(items, 'Methodology Builder: Chapter 3');
          btn.disabled = false;
          if (done.length) showToast('Added to ' + done.length + ' section' + (done.length === 1 ? '' : 's') + '. Earlier text is in each section\'s Version History.', 'success', 5000);
        });
      };
      draw();
    }

    // ----- Questionnaire Builder ----------------------------------------------------------------
    function renderInstrumentTool(body) {
      const inst = currentProject.instrument ? JSON.parse(JSON.stringify(currentProject.instrument)) : PT.newInstrument(currentProject);
      (inst.sections || (inst.sections = [])).forEach(function (s) { s.items = s.items || []; });
      const save = debounced(function () { saveProjectField('instrument', inst); }, 900);
      const meta = currentProject.instrumentMeta || { experts: 3, pilotN: '', alpha: '' };
      const typeOpts = PT.ITEM_TYPES;
      const scaleOpts = [['', 'No rating scale']].concat(Object.keys(PT.SCALES).map(function (k) { return [k, PT.SCALES[k].label]; }));
      const draw = function () {
        const st = PT.instrumentStats(inst);
        body.innerHTML = '<p class="pt-muted">' + st.items + ' item' + (st.items === 1 ? '' : 's') + ' in ' + st.sections + ' section' + (st.sections === 1 ? '' : 's') + '. Changes are saved as you go.</p>' +
          fieldHtml('Title', '<input class="pt-input" data-i="title">') + fieldHtml('Introduction / consent note', '<textarea class="pt-input" rows="5" data-i="intro"></textarea>') +
          inst.sections.map(function (s, si) {
            return '<div class="pt-analysis" style="margin-bottom:0.8rem;"><div class="pt-row" style="justify-content:space-between;"><strong>Section ' + (si + 1) + '</strong><span class="pt-row">' +
              (si > 0 ? '<button class="btn btn-secondary pt-small" data-sec-up="' + si + '">Move up</button>' : '') + '<button class="btn btn-secondary pt-small" data-sec-del="' + si + '">Remove section</button></span></div>' +
              '<div class="pt-grid" style="margin-top:0.4rem;">' + fieldHtml('Section title', '<input class="pt-input" data-s="' + si + '" data-k="title">') +
              fieldHtml('Rating scale for this section', '<select class="pt-input" data-s="' + si + '" data-k="scale">' + optsHtml(scaleOpts, s.scale || '') + '</select>') + '</div>' +
              fieldHtml('Instructions', '<input class="pt-input" data-s="' + si + '" data-k="instructions">') +
              s.items.map(function (it, ii) {
                return '<div class="pt-row" style="align-items:flex-start;margin-top:0.4rem;"><span class="pt-muted" style="padding-top:0.6rem;min-width:1.5rem;">' + (ii + 1) + '.</span>' +
                  '<div style="flex:1;min-width:200px;"><input class="pt-input" data-s="' + si + '" data-it="' + ii + '" data-k="text" placeholder="Question or statement">' +
                  ((it.type === 'choice' || it.type === 'multi') ? '<input class="pt-input" style="margin-top:0.3rem;" data-s="' + si + '" data-it="' + ii + '" data-k="options" placeholder="Options, separated by commas">' : '') + '</div>' +
                  '<select class="pt-input" style="max-width:190px;" data-s="' + si + '" data-it="' + ii + '" data-k="type">' + optsHtml(typeOpts, it.type) + '</select>' +
                  '<button class="btn btn-secondary pt-small" data-item-del="' + si + '|' + ii + '" title="Remove">✕</button></div>';
              }).join('') +
              '<button class="btn btn-secondary pt-small" style="margin-top:0.5rem;" data-item-add="' + si + '"><i class="bx bx-plus"></i> Add item</button></div>';
          }).join('') +
          '<div class="pt-row"><button class="btn btn-secondary" id="ibAddSec"><i class="bx bx-plus"></i> Add section</button>' +
          '<button class="btn btn-primary" id="ibDraft"><i class="bx bx-bulb"></i> Draft items from my objectives (Project SI)</button></div>' +
          '<h4 class="pt-h">Preview</h4><div class="pt-preview" id="ibPreview">' + PT.instrumentHtml(inst) + '</div>' +
          '<div class="pt-row" style="margin-top:0.5rem;"><span class="pt-label" style="margin:0;">Add the questionnaire to</span>' + sectionSelectHtml('ibTarget', /appendi|questionnaire|instrument/i) +
          '<button class="btn btn-primary" id="ibInsert"><i class="bx bx-down-arrow-circle"></i> Insert questionnaire</button></div>' +
          '<h4 class="pt-h">Validity and reliability</h4><div class="pt-grid">' +
          fieldHtml('Experts who reviewed it', '<input class="pt-input" type="number" id="ibExperts">') + fieldHtml('Pilot study respondents', '<input class="pt-input" type="number" id="ibPilot">') +
          fieldHtml("Cronbach's alpha (after the pilot)", '<input class="pt-input" type="number" step="0.01" id="ibAlpha" placeholder="e.g. 0.82">') + '</div>' +
          outputBoxHtml('ib', PT.instrumentParagraph(inst, meta), /instrument|validity|reliab/i);
        body.querySelector('[data-i="title"]').value = inst.title || '';
        body.querySelector('[data-i="intro"]').value = inst.intro || '';
        document.getElementById('ibExperts').value = meta.experts; document.getElementById('ibPilot').value = meta.pilotN; document.getElementById('ibAlpha').value = meta.alpha;
        const refresh = function () { document.getElementById('ibPreview').innerHTML = PT.instrumentHtml(inst); document.getElementById('ibText').value = PT.instrumentParagraph(inst, meta); save(); };
        body.querySelectorAll('[data-i]').forEach(function (el) { el.addEventListener('input', function () { inst[el.dataset.i] = el.value; refresh(); }); });
        body.querySelectorAll('[data-s]').forEach(function (el) {
          const s = inst.sections[el.dataset.s], k = el.dataset.k;
          const target = el.dataset.it != null ? s.items[el.dataset.it] : s;
          el.value = k === 'options' ? (target.options || []).join(', ') : (target[k] || '');
          el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () {
            target[k] = k === 'options' ? el.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean) : el.value;
            if (k === 'type' && (el.value === 'choice' || el.value === 'multi') && !target.options) target.options = [];
            if (el.tagName === 'SELECT') { save(); draw(); } else refresh();
          });
        });
        ['ibExperts', 'ibPilot', 'ibAlpha'].forEach(function (id, i) {
          document.getElementById(id).addEventListener('input', function (e) { meta[['experts', 'pilotN', 'alpha'][i]] = e.target.value; document.getElementById('ibText').value = PT.instrumentParagraph(inst, meta); saveProjectField('instrumentMeta', meta); });
        });
        body.querySelectorAll('[data-item-add]').forEach(function (b) { b.addEventListener('click', function () { const s = inst.sections[b.dataset.itemAdd]; s.items.push({ text: '', type: s.scale ? 'scale' : 'choice', options: s.scale ? undefined : [] }); save(); draw(); }); });
        body.querySelectorAll('[data-item-del]').forEach(function (b) { b.addEventListener('click', function () { const p = b.dataset.itemDel.split('|'); inst.sections[p[0]].items.splice(p[1], 1); save(); draw(); }); });
        body.querySelectorAll('[data-sec-del]').forEach(function (b) { b.addEventListener('click', function () { if (!confirm('Remove this section and its items?')) return; inst.sections.splice(b.dataset.secDel, 1); save(); draw(); }); });
        body.querySelectorAll('[data-sec-up]').forEach(function (b) { b.addEventListener('click', function () { const i = +b.dataset.secUp; const x = inst.sections.splice(i, 1)[0]; inst.sections.splice(i - 1, 0, x); save(); draw(); }); });
        document.getElementById('ibAddSec').addEventListener('click', function () {
          const letter = String.fromCharCode(65 + inst.sections.length);
          inst.sections.push({ title: 'Section ' + letter + ': ', instructions: 'Please tick (✓) the option that best describes your view.', scale: 'agree5', items: [{ text: '', type: 'scale' }] }); save(); draw();
        });
        document.getElementById('ibInsert').addEventListener('click', function () { insertIntoSection(document.getElementById('ibTarget').value, PT.instrumentHtml(inst), 'Questionnaire Builder', true); });
        wireOutputBox('ib', 'Validity and reliability of the instrument');
        document.getElementById('ibDraft').addEventListener('click', async function () {
          if (!needsSI('project.instrumentDraft')) return;
          const objs = (rs().objectives || []).filter(Boolean), qs = (rs().researchQuestions || []).filter(Boolean);
          if (!objs.length && !qs.length) { showToast('Add your objectives or research questions in Setup → Research Setup first.', 'info', 5000); return; }
          const btn = this; btn.disabled = true; btn.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> Drafting items…';
          try {
            const vars = (rs().variables || {});
            const system = 'You design data-collection questionnaires for student health research projects. Return ONLY JSON, no prose. Items must be short, clear, neutral (not leading), one idea per item, suitable for the population. Do not include demographic questions.';
            const user = 'TITLE: ' + (currentProject.title || '') + '\nPOPULATION: ' + (rs().population || '') + '\nOBJECTIVES:\n' + (objs.length ? objs : qs).map(function (o, i) { return (i + 1) + '. ' + o; }).join('\n') +
              (vars.dependent && vars.dependent.filter(Boolean).length ? '\nOUTCOME VARIABLES: ' + vars.dependent.filter(Boolean).join(', ') : '') +
              '\n\nReturn {"sections":[{"title":"Section B: <topic of objective 1>","instructions":"<one line>","scale":"agree5|agree4|freq5|sat5|know3|","items":[{"text":"<item>","type":"scale|choice|multi|yesno|number|open","options":["only for choice/multi"]}]}]}. One section per objective, 5 to 8 items each. Use "scale" items with a scale for attitudes, practice frequency or knowledge.';
            const d = parseJsonLoose(await callProjectAI(PROJECT_AI_ACTIONS.findMissing, system, user));
            const secs = d && Array.isArray(d.sections) ? d.sections : null;
            if (!secs || !secs.length) throw new Error('The draft could not be read. Please try again.');
            secs.forEach(function (s) {
              const scale = PT.SCALES[s.scale] ? s.scale : '';
              inst.sections.push({ title: String(s.title || 'Section'), instructions: String(s.instructions || ''), scale: scale,
                items: (s.items || []).filter(function (it) { return it && it.text; }).map(function (it) {
                  const type = PT.ITEM_TYPES.some(function (t) { return t[0] === it.type; }) ? it.type : 'open';
                  return { text: String(it.text), type: type === 'scale' && !scale ? 'open' : type, options: Array.isArray(it.options) ? it.options.map(String) : undefined };
                }) });
            });
            save(); draw();
            showToast('Added ' + secs.length + ' drafted section' + (secs.length === 1 ? '' : 's') + '. Check every item with your supervisor before use.', 'success', 6000);
          } catch (err) { reportError(err, 'questionnaire draft'); btn.disabled = false; btn.innerHTML = '<i class="bx bx-bulb"></i> Draft items from my objectives (Project SI)'; }
        });
      };
      const rs = function () { return currentProject.researchSetup || {}; };
      draw();
    }

    // ----- Literature Matrix & Gap Finder ---------------------------------------------------------
    function renderMatrixTool(body) {
      const rows = (Array.isArray(currentProject.litMatrix) ? currentProject.litMatrix : Object.values(currentProject.litMatrix || {})).filter(Boolean).map(function (r) { return Object.assign({}, r); });
      const save = debounced(function () { saveProjectField('litMatrix', rows); }, 900);
      const fields = PT.MATRIX_FIELDS;
      const draw = function () {
        const sum = PT.matrixSummary(rows);
        const gaps = currentProject.litGaps || null;
        body.innerHTML = '<div class="pt-row"><button class="btn btn-secondary" id="lmAdd"><i class="bx bx-plus"></i> Add study</button>' +
          '<button class="btn btn-secondary" id="lmFromRefs"><i class="bx bx-bookmark"></i> Add from Reference Manager</button>' +
          '<button class="btn btn-primary" id="lmFill"><i class="bx bx-bulb"></i> Fill from my Chapter 2 (Project SI)</button></div>' +
          (sum.total ? '<div class="pt-stats" style="margin-top:0.6rem;"><div><strong>' + sum.total + '</strong><span>studies</span></div><div><strong>' + sum.recent + '</strong><span>from the last 5 years</span></div>' +
            '<div class="' + (sum.old ? 'pt-warn' : '') + '"><strong>' + sum.old + '</strong><span>older than 10 years</span></div><div><strong>' + Object.keys(sum.byDesign).length + '</strong><span>kinds of design</span></div></div>' +
            '<p class="pt-muted">' + Object.keys(sum.byDesign).map(function (k) { return escapeHtml(k) + ': ' + sum.byDesign[k]; }).join(' · ') + '</p>' +
            (sum.notes.length ? '<div class="pt-note">' + sum.notes.map(function (n) { return '<p>• ' + escapeHtml(n) + '</p>'; }).join('') + '</div>' : '') : '<p class="pt-muted">No studies yet. Add the empirical studies you reviewed; the matrix becomes the "Summary of empirical studies" table examiners like, and the basis for your research gap.</p>') +
          rows.map(function (r, i) {
            return '<details class="pt-analysis" style="margin-top:0.5rem;"' + (r._open ? ' open' : '') + '><summary><strong>' + (i + 1) + '. ' + escapeHtml((r.author || 'New study') + (r.year ? ' (' + r.year + ')' : '')) + '</strong>' +
              (r.design ? ' <span class="pt-muted">· ' + escapeHtml(r.design) + '</span>' : '') + '</summary><div class="pt-grid" style="margin-top:0.5rem;">' +
              fields.map(function (f) {
                const long = f[0] === 'findings' || f[0] === 'limitations' || f[0] === 'gap' || f[0] === 'title';
                return fieldHtml(f[1], (long ? '<textarea class="pt-input" rows="2"' : '<input class="pt-input"' + (f[0] === 'design' ? ' list="lmDesigns"' : '')) + ' data-r="' + i + '" data-f="' + f[0] + '">' + (long ? '</textarea>' : ''));
              }).join('') + '</div><button class="btn btn-secondary pt-small" data-lm-del="' + i + '">Remove study</button></details>';
          }).join('') +
          '<datalist id="lmDesigns">' + PT.DESIGNS.map(function (d) { return '<option value="' + escapeHtml(d) + '">'; }).join('') + '</datalist>' +
          (sum.total ? '<div class="pt-row" style="margin-top:0.8rem;"><span class="pt-label" style="margin:0;">Add the summary table to</span>' + sectionSelectHtml('lmTarget', /empirical|review of related/i, /literature/i) +
            '<button class="btn btn-primary" id="lmInsert"><i class="bx bx-down-arrow-circle"></i> Insert table</button></div>' : '') +
          '<h4 class="pt-h" style="margin-top:1.2rem;">Research gaps (Project SI)</h4>' +
          '<p class="pt-muted">Reads the matrix and suggests the gaps your study fills, in the words you can use in your Statement of the Problem and the end of Chapter 2.</p>' +
          '<button class="btn btn-primary" id="lmGaps"' + (sum.total < 3 ? ' disabled title="Add at least 3 studies first"' : '') + '><i class="bx bx-search-alt"></i> Find the gaps</button>' +
          (gaps ? '<ul class="pt-list" style="margin-top:0.6rem;">' + (gaps.gaps || []).map(function (g) { return '<li><strong>' + escapeHtml(g.gap) + '</strong>' + (g.evidence ? '<div class="pt-muted">' + escapeHtml(g.evidence) + '</div>' : '') + '</li>'; }).join('') + '</ul>' +
            (gaps.paragraph ? outputBoxHtml('lg', gaps.paragraph, /gap|summary of (the )?review|appraisal/i) : '') : '');
        body.querySelectorAll('[data-r]').forEach(function (el) {
          const r = rows[el.dataset.r];
          el.value = r[el.dataset.f] || '';
          el.addEventListener('input', function () { r[el.dataset.f] = el.value; save(); });
          el.addEventListener('change', function () { r._open = true; draw(); });
        });
        body.querySelectorAll('details').forEach(function (d, i) { d.addEventListener('toggle', function () { if (rows[i]) rows[i]._open = d.open; }); });
        body.querySelectorAll('[data-lm-del]').forEach(function (b) { b.addEventListener('click', function () { rows.splice(+b.dataset.lmDel, 1); save(); draw(); }); });
        document.getElementById('lmAdd').addEventListener('click', function () { rows.push({ author: '', year: '', _open: true }); save(); draw(); });
        document.getElementById('lmFromRefs').addEventListener('click', function () {
          const have = new Set(rows.map(function (r) { return (r.author + '|' + r.year).toLowerCase(); }));
          let added = 0;
          Object.values(currentProject.references || {}).forEach(function (ref) { const r = PT.matrixRowFromReference(ref); if (r.author && !have.has((r.author + '|' + r.year).toLowerCase())) { rows.push(r); added++; } });
          save(); draw(); showToast(added ? 'Added ' + added + ' stud' + (added === 1 ? 'y' : 'ies') + '. Fill in the design, population and findings.' : 'Every Reference Manager entry is already in the matrix.', added ? 'success' : 'info');
        });
        document.getElementById('lmInsert')?.addEventListener('click', function () { insertIntoSection(document.getElementById('lmTarget').value, PT.matrixHtml(rows), 'Literature Matrix table', true); });
        wireOutputBox('lg', 'Research gap');
        document.getElementById('lmFill').addEventListener('click', async function () {
          if (!needsSI('project.literatureMatrix')) return;
          const ch2 = chapterKeyLike(/literature/i);
          if (!ch2) { showToast('No Literature Review chapter found.', 'info'); return; }
          const btn = this; btn.disabled = true; btn.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> Reading Chapter 2…';
          try {
            const system = 'You extract empirical studies a student has reviewed in their literature review. Use ONLY what the chapter text says about each study; never invent details. Return ONLY a JSON array, no prose.';
            const user = buildChapterFullText(ch2, 4000) + '\n\nReturn [{"author":"<as cited, e.g. Smith et al.>","year":"<yyyy>","design":"<design if stated, else empty>","population":"<sample if stated>","setting":"<country/setting if stated>","findings":"<what the chapter says they found>","limitations":"<if stated>"}]. Only primary studies and reviews cited with a year. At most 25.';
            const list = parseJsonLoose(await callProjectAI(PROJECT_AI_ACTIONS.reviewChapter, system, user));
            if (!Array.isArray(list)) throw new Error('The chapter could not be read. Please try again.');
            const have = new Set(rows.map(function (r) { return (String(r.author).split(/\s/)[0] + '|' + r.year).toLowerCase(); }));
            let added = 0;
            list.forEach(function (s) {
              if (!s || !s.author) return;
              const k = (String(s.author).split(/\s/)[0] + '|' + (s.year || '')).toLowerCase();
              if (have.has(k)) return; have.add(k);
              rows.push({ author: String(s.author), year: String(s.year || ''), title: '', design: String(s.design || ''), population: String(s.population || ''), setting: String(s.setting || ''), findings: String(s.findings || ''), limitations: String(s.limitations || ''), gap: '' });
              added++;
            });
            save(); draw();
            showToast(added ? 'Added ' + added + ' stud' + (added === 1 ? 'y' : 'ies') + ' from Chapter 2. Check each against the original paper.' : 'No new studies found in Chapter 2.', added ? 'success' : 'info', 6000);
          } catch (err) { reportError(err, 'literature matrix fill'); btn.disabled = false; btn.innerHTML = '<i class="bx bx-bulb"></i> Fill from my Chapter 2 (Project SI)'; }
        });
        document.getElementById('lmGaps').addEventListener('click', async function () {
          if (!needsSI('project.literatureMatrix')) return;
          const btn = this; btn.disabled = true; btn.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> Finding gaps…';
          try {
            const system = 'You are an academic supervisor identifying research gaps from a student\'s literature matrix. Base every gap ONLY on the studies listed (what is missing across them: population, setting, design, outcome, recency). Return ONLY JSON, no prose.';
            const user = 'STUDY TITLE: ' + (currentProject.title || '') + '\nSTUDY POPULATION/SETTING: ' + ((currentProject.researchSetup || {}).population || '') + ' ' + ((currentProject.researchSetup || {}).setting || '') +
              '\n\nMATRIX:\n' + rows.map(function (r, i) { return (i + 1) + '. ' + [r.author + ' (' + r.year + ')', r.design, r.population, r.setting, r.findings, r.limitations].filter(Boolean).join(' | '); }).join('\n') +
              '\n\nReturn {"gaps":[{"gap":"<one sentence>","evidence":"<which studies show it, by author and year>"}],"paragraph":"<a 120-180 word paragraph for the end of the literature review stating the gaps and how this study addresses them, citing the studies by author and year>"}. 2 to 4 gaps.';
            const d = parseJsonLoose(await callProjectAI(PROJECT_AI_ACTIONS.reviewChapter, system, user));
            if (!d || !Array.isArray(d.gaps)) throw new Error('The gaps could not be read. Please try again.');
            await saveProjectField('litGaps', { gaps: d.gaps.map(function (g) { return { gap: String(g.gap || ''), evidence: String(g.evidence || '') }; }), paragraph: String(d.paragraph || ''), at: Date.now() });
            draw();
          } catch (err) { reportError(err, 'gap finder'); btn.disabled = false; btn.innerHTML = '<i class="bx bx-search-alt"></i> Find the gaps'; }
        });
      };
      draw();
    }

    // ----- Defense Preparation -------------------------------------------------------------------
    function renderDefenseTool(body) {
      const answers = Object.assign({}, currentProject.defensePrep || {});
      const extra = (Array.isArray(currentProject.defenseExtra) ? currentProject.defenseExtra : Object.values(currentProject.defenseExtra || {})).filter(Boolean);
      let filter = 'all', open = null;
      const draw = function () {
        const questions = PT.defenseQuestions(currentProject).concat(extra);
        const r = PT.defenseReadiness(questions, answers);
        const cats = Object.keys(r.categories);
        body.innerHTML = '<div class="pt-stats"><div><strong>' + r.readiness + '%</strong><span>readiness</span></div><div><strong>' + r.answered + ' / ' + r.total + '</strong><span>questions practised</span></div>' +
          '<div><strong>' + (r.average == null ? '—' : r.average + '/10') + '</strong><span>average score</span></div></div>' +
          '<p class="pt-muted">Answer out loud first, then type your answer. Project SI scores it like an examiner and shows a stronger answer. Questions come from your own project.</p>' +
          '<div class="pt-row"><select class="pt-input" id="dpFilter" style="max-width:240px;">' + optsHtml([['all', 'All categories']].concat(cats.map(function (c) { return [c, c + ' (' + r.categories[c].answered + '/' + r.categories[c].total + ')']; })), filter) + '</select>' +
          '<button class="btn btn-secondary" id="dpMore"><i class="bx bx-bulb"></i> Tougher questions on my chapters (Project SI)</button></div>' +
          questions.filter(function (q) { return filter === 'all' || q.category === filter; }).map(function (q) {
            const a = answers[q.id];
            return '<div class="pt-analysis" style="margin-top:0.5rem;"><div class="pt-row" style="justify-content:space-between;align-items:flex-start;"><div style="flex:1;min-width:0;"><span class="pt-muted">' + escapeHtml(q.category) + '</span><div><strong>' + escapeHtml(q.q) + '</strong></div></div>' +
              (a && a.score != null ? '<span class="pt-score ' + (a.score >= 7 ? 'pt-good' : a.score >= 5 ? 'pt-warn' : 'pt-bad') + '">' + a.score + '/10</span>' : '') + '</div>' +
              (open === q.id ? '<p class="pt-muted" style="margin:0.4rem 0;">Tip: ' + escapeHtml(q.tip || '') + '</p>' +
                '<textarea class="pt-input" rows="5" id="dpAnswer" placeholder="Your answer…">' + escapeHtml((a && a.answer) || '') + '</textarea>' +
                '<div class="pt-row" style="margin-top:0.4rem;"><button class="btn btn-primary" id="dpScore" data-q="' + q.id + '"><i class="bx bx-check-circle"></i> Score my answer</button><button class="btn btn-secondary" id="dpClose">Close</button></div>' +
                (a && a.feedback ? '<div class="pt-note" style="margin-top:0.6rem;"><p><strong>Feedback:</strong> ' + escapeHtml(a.feedback) + '</p>' + (a.better ? '<p><strong>A stronger answer:</strong> ' + escapeHtml(a.better) + '</p>' : '') + '</div>' : '')
                : '<button class="btn btn-secondary pt-small" style="margin-top:0.4rem;" data-dp-open="' + q.id + '">' + (a ? 'Practise again' : 'Practise') + '</button>') + '</div>';
          }).join('');
        document.getElementById('dpFilter').addEventListener('change', function (e) { filter = e.target.value; draw(); });
        body.querySelectorAll('[data-dp-open]').forEach(function (b) { b.addEventListener('click', function () { open = b.dataset.dpOpen; draw(); document.getElementById('dpAnswer')?.focus(); }); });
        document.getElementById('dpClose')?.addEventListener('click', function () { open = null; draw(); });
        document.getElementById('dpScore')?.addEventListener('click', async function () {
          const q = questions.find(function (x) { return x.id === this.dataset.q; }, this);
          const ans = document.getElementById('dpAnswer').value.trim();
          if (ans.length < 20) { showToast('Write a fuller answer first (a few sentences).', 'info'); return; }
          if (!needsSI('project.defensePrep')) return;
          const btn = this; btn.disabled = true; btn.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> Scoring…';
          try {
            const system = 'You are a fair but demanding external examiner at a student\'s ' + (currentProject.type || 'project') + ' defense in ' + (currentProject.department || 'a health profession') + '. Judge the answer against the student\'s own project summary. Return ONLY JSON.';
            const user = 'PROJECT SUMMARY:\n' + clip(fullProjectSummaryForTools(), 6000) + '\n\nQUESTION: ' + q.q + '\nSTUDENT\'S ANSWER: ' + ans +
              '\n\nReturn {"score":<0-10 integer>,"feedback":"<2-3 sentences: what was good, what was missing or wrong>","better":"<a model answer of 60-120 words, in the first person, consistent with the project; never invent results the project does not contain>"}';
            const d = parseJsonLoose(await callProjectAI(PROJECT_AI_ACTIONS.checkSection, system, user));
            if (!d || !isFinite(Number(d.score))) throw new Error('The score could not be read. Please try again.');
            answers[q.id] = { answer: ans, score: Math.max(0, Math.min(10, Math.round(Number(d.score)))), feedback: String(d.feedback || ''), better: String(d.better || ''), at: Date.now() };
            await saveProjectField('defensePrep', answers);
            draw();
          } catch (err) { reportError(err, 'defense practice'); btn.disabled = false; btn.innerHTML = '<i class="bx bx-check-circle"></i> Score my answer'; }
        });
        document.getElementById('dpMore').addEventListener('click', async function () {
          if (!needsSI('project.defensePrep')) return;
          const btn = this; btn.disabled = true; btn.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> Reading your project…';
          try {
            const system = 'You are an external examiner preparing questions for a student\'s project defense. Ask about weaknesses, choices and specific claims IN THIS PROJECT. Return ONLY a JSON array.';
            const user = clip(fullProjectSummaryForTools(), 8000) + '\n\nReturn [{"category":"Methodology|Results|Discussion|Literature|Background","q":"<a pointed question about something specific in this project>","tip":"<what a strong answer should cover>"}]. 6 questions, the hardest first.';
            const list = parseJsonLoose(await callProjectAI(PROJECT_AI_ACTIONS.reviewChapter, system, user));
            if (!Array.isArray(list)) throw new Error('The questions could not be read. Please try again.');
            const have = new Set(questions.map(function (q) { return q.q; }));
            list.forEach(function (x) { if (x && x.q && !have.has(x.q)) extra.push({ id: PT.questionId(x.q), category: String(x.category || 'Examiner'), q: String(x.q), tip: String(x.tip || '') }); });
            await saveProjectField('defenseExtra', extra);
            filter = 'all'; draw();
          } catch (err) { reportError(err, 'defense questions'); btn.disabled = false; btn.innerHTML = '<i class="bx bx-bulb"></i> Tougher questions on my chapters (Project SI)'; }
        });
      };
      draw();
    }
    // A compact project summary for the tools: research setup, then each section's opening.
    function fullProjectSummaryForTools() {
      const rs = currentProject.researchSetup || {};
      const lines = ['TITLE: ' + (currentProject.title || ''), 'APPROACH: ' + (currentProject.approach || 'quantitative')];
      if (rs.aim) lines.push('AIM: ' + rs.aim);
      (rs.objectives || []).filter(Boolean).forEach(function (o, i) { lines.push('OBJECTIVE ' + (i + 1) + ': ' + o); });
      (rs.hypotheses || []).filter(Boolean).forEach(function (h, i) { lines.push('HYPOTHESIS ' + (i + 1) + ': ' + h); });
      toolSections().forEach(function (s) { const t = PT.plain(s.html); if (t.length > 40) lines.push('\n[' + s.label + ']\n' + clip(t, 700)); });
      return lines.join('\n');
    }

    // ----- Formatting Profiles -------------------------------------------------------------------
    function renderFormatTool(body) {
      let f = currentProject.formatProfile ? PT.normalizeFormat(currentProject.formatProfile) : PT.formatFromPreset('nigerian');
      const using = !!currentProject.formatProfile;
      const draw = function () {
        const m = f.margins;
        const num = function (k, v, step, min, max) { return '<input class="pt-input" type="number" step="' + step + '" min="' + min + '" max="' + max + '" data-fm="' + k + '" value="' + v + '">'; };
        const lines = PT.chapterHeading('Chapter 1: Introduction', f);
        const scale = 0.32;
        const fam = '"' + f.font + '", ' + (/Arial|Calibri/.test(f.font) ? 'sans-serif' : 'serif');
        body.innerHTML = '<p class="pt-note">' + (using ? 'Your Word, PDF and Print exports use this layout: ' + escapeHtml(PT.formatSummary(currentProject.formatProfile)) + '.' : 'Exports currently use the standard Rehablix layout. Choose a profile and save it to export in your institution\'s layout.') +
          ' Always check your department\'s handbook: requirements differ between universities.</p>' +
          fieldHtml('Start from', '<select class="pt-input" id="fmPreset">' + optsHtml(Object.keys(PT.FORMAT_PRESETS).map(function (k) { return [k, PT.FORMAT_PRESETS[k].name]; }).concat([['custom', 'Custom']]), f.preset) + '</select>') +
          '<div class="pt-grid">' +
          fieldHtml('Font', '<select class="pt-input" data-fm="font">' + optsHtml(PT.FORMAT_FONTS.map(function (x) { return [x, x]; }), f.font) + '</select>') +
          fieldHtml('Font size (pt)', num('size', f.size, 1, 10, 14)) +
          fieldHtml('Line spacing', '<select class="pt-input" data-fm="lineSpacing">' + optsHtml([[1, 'Single'], [1.15, '1.15'], [1.5, '1.5'], [2, 'Double']], f.lineSpacing) + '</select>') +
          fieldHtml('Text alignment', '<select class="pt-input" data-fm="align">' + optsHtml([['justify', 'Justified'], ['left', 'Left']], f.align) + '</select>') +
          fieldHtml('Top margin (cm)', num('m.top', m.top, 0.01, 1, 5)) + fieldHtml('Bottom margin (cm)', num('m.bottom', m.bottom, 0.01, 1, 5)) +
          fieldHtml('Left margin (cm)', num('m.left', m.left, 0.01, 1, 5), '1.5 inches = 3.81 cm (binding side)') + fieldHtml('Right margin (cm)', num('m.right', m.right, 0.01, 1, 5)) +
          fieldHtml('First-line indent (cm)', num('firstLineIndent', f.firstLineIndent, 0.01, 0, 3)) +
          fieldHtml('Chapter headings', '<select class="pt-input" data-fm="chapterStyle">' + optsHtml([['words', 'CHAPTER ONE / INTRODUCTION'], ['numbers', 'CHAPTER 1 / Introduction'], ['title', 'Chapter 1: Introduction']], f.chapterStyle) + '</select>') +
          fieldHtml('Heading capitals', '<select class="pt-input" data-fm="headingCase">' + optsHtml([['upper', 'ALL CAPITALS'], ['title', 'As written']], f.headingCase) + '</select>') +
          fieldHtml('Section headings', '<select class="pt-input" data-fm="headingAlign">' + optsHtml([['left', 'Left'], ['center', 'Centred']], f.headingAlign) + '</select>') +
          fieldHtml('Page numbers', '<select class="pt-input" data-fm="pageNumbers">' + optsHtml([['bottom-center', 'Bottom centre'], ['bottom-right', 'Bottom right'], ['top-right', 'Top right']], f.pageNumbers) + '</select>') +
          fieldHtml('Page number style', '<select class="pt-input" data-fm="pageFormat">' + optsHtml([['n', '1'], ['of', 'Page 1 of 20']], f.pageFormat) + '</select>') +
          '</div>' +
          '<h4 class="pt-h">Preview</h4><div class="pt-page" style="padding:' + (m.top * 10 * scale * 3.78).toFixed(0) + 'px ' + (m.right * 10 * scale * 3.78).toFixed(0) + 'px ' + (m.bottom * 10 * scale * 3.78).toFixed(0) + 'px ' + (m.left * 10 * scale * 3.78).toFixed(0) + 'px;font-family:' + escapeHtml(fam) + ';">' +
          '<div class="pt-page-num" style="' + (f.pageNumbers === 'top-right' ? 'top:6px;right:10px;' : 'bottom:6px;' + (f.pageNumbers === 'bottom-right' ? 'right:10px;' : 'left:0;right:0;text-align:center;')) + '">' + (f.pageFormat === 'of' ? 'Page 1 of 20' : '1') + '</div>' +
          lines.map(function (l) { return '<div style="text-align:center;font-weight:700;font-size:' + ((f.size + 2) * 0.62).toFixed(1) + 'px;">' + escapeHtml(l) + '</div>'; }).join('') +
          '<div style="font-weight:700;margin-top:6px;text-align:' + (f.headingAlign === 'center' ? 'center' : 'left') + ';font-size:' + (f.size * 0.62).toFixed(1) + 'px;">' + escapeHtml(f.headingCase === 'upper' ? '1.1 BACKGROUND OF THE STUDY' : '1.1 Background of the Study') + '</div>' +
          [0, 1].map(function () { return '<p style="margin:4px 0;text-align:' + f.align + ';text-indent:' + (f.firstLineIndent * 10 * scale * 3.78).toFixed(0) + 'px;font-size:' + (f.size * 0.62).toFixed(1) + 'px;line-height:' + (f.lineSpacing * 1.15).toFixed(2) + ';">Occupational therapy supports people to take part in the everyday activities that matter to them. This preview shows your chosen font, spacing, margins and alignment on an A4 page, at about a third of the real size.</p>'; }).join('') +
          '</div>' +
          '<div class="pt-row" style="margin-top:0.8rem;"><button class="btn btn-primary" id="fmSave"><i class="bx bx-save"></i> Use this layout for exports</button>' +
          (using ? '<button class="btn btn-secondary" id="fmOff">Go back to the standard layout</button>' : '') + '<button class="btn btn-secondary" id="fmExport"><i class="bx bx-export"></i> Go to Export</button></div>';
        document.getElementById('fmPreset').addEventListener('change', function (e) { if (e.target.value !== 'custom') f = PT.formatFromPreset(e.target.value); else f.preset = 'custom'; draw(); });
        body.querySelectorAll('[data-fm]').forEach(function (el) {
          el.addEventListener('change', function () {
            const k = el.dataset.fm, v = el.type === 'number' || k === 'lineSpacing' ? Number(el.value) : el.value;
            if (k.indexOf('m.') === 0) f.margins[k.slice(2)] = v; else f[k] = v;
            f.preset = 'custom'; f = PT.normalizeFormat(f); f.preset = 'custom'; draw();
          });
        });
        document.getElementById('fmSave').addEventListener('click', async function () { await saveProjectField('formatProfile', f); showToast('Saved. Word, PDF and Print exports now use this layout.', 'success'); renderFormatTool(body); });
        document.getElementById('fmOff')?.addEventListener('click', async function () { await saveProjectField('formatProfile', null); delete currentProject.formatProfile; showToast('Exports are back to the standard layout.', 'info'); renderFormatTool(body); });
        document.getElementById('fmExport').addEventListener('click', function () { switchScreen('export'); });
      };
      draw();
    }

    // ----- Project-wide Search ---------------------------------------------------------------
    function renderSearchTool(body) {
      body.innerHTML = '<input id="ptSearchInput" class="pt-input" type="search" placeholder="Search every chapter, section and reference…" autocomplete="off">' +
        '<div id="ptSearchCount" class="pt-muted" style="margin:0.6rem 0;"></div><div id="ptSearchResults"></div>';
      const input = document.getElementById('ptSearchInput');
      let timer = null;
      const run = function () {
        const q = input.value.trim();
        const resEl = document.getElementById('ptSearchResults'), countEl = document.getElementById('ptSearchCount');
        if (q.length < 2) { resEl.innerHTML = ''; countEl.textContent = 'Type at least 2 letters.'; return; }
        const hits = PT.searchProject(toolSections(), managerRefs(), q, 150);
        const places = new Set(hits.map(function (h) { return h.kind === 'section' ? h.chapterKey + '|' + h.sectionIndex : 'refs'; }));
        countEl.textContent = hits.length ? hits.length + (hits.length >= 150 ? '+' : '') + ' match' + (hits.length === 1 ? '' : 'es') + ' in ' + places.size + ' place' + (places.size === 1 ? '' : 's') : 'No matches.';
        resEl.innerHTML = hits.map(function (h, i) {
          return '<button class="pt-hit" data-i="' + i + '"><span class="pt-hit-where">' + escapeHtml(h.label) + '</span>' +
            '<span class="pt-hit-text">' + escapeHtml(h.before) + '<mark>' + escapeHtml(h.match) + '</mark>' + escapeHtml(h.after) + '</span></button>';
        }).join('');
        resEl.querySelectorAll('.pt-hit').forEach(function (b) {
          b.addEventListener('click', function () {
            const h = hits[parseInt(b.dataset.i, 10)];
            if (h.kind === 'reference') openToolPane('referenceManager');
            else goToPassage(h.chapterKey, h.sectionIndex, h.quote);
          });
        });
      };
      input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 200); });
      input.focus();
    }

    // ----- Project Activity & History ---------------------------------------------------------
    async function renderHistoryTool(body) {
      body.innerHTML = '<p class="pt-muted"><i class="bx bx-loader-alt bx-spin"></i> Loading the timeline…</p>';
      let entries = [];
      try {
        const snap = await database.ref('history/' + scopeUid + '/projects/' + currentProjectId + '/activity').limitToLast(400).once('value');
        entries = Object.values(snap.val() || {});
      } catch (e) { reportError(e, 'project history load'); }
      const rows = PT.groupActivity(entries);
      if (!rows.length) { body.innerHTML = '<p class="pt-muted">Nothing recorded yet. Every save, SI generation, review and export will appear here.</p>'; return; }
      const verb = { section_saved: 'Edited', section_generated: 'SI generated', chapter_reviewed: 'Reviewed', reference_added: 'Added reference', exported: 'Exported' };
      let day = '';
      body.innerHTML = '<p class="pt-muted">Autosaves of the same section are grouped. Each section keeps its last ' + MAX_VERSIONS + ' saved versions — open one to restore it.</p>' +
        rows.map(function (r, i) {
          const d = new Date(r.lastAt), dayStr = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
          const head = dayStr !== day ? '<div class="pt-day">' + escapeHtml(dayStr) + '</div>' : '';
          day = dayStr;
          const hasSection = r.chapterKey && getChaptersStructure()[r.chapterKey] && (r.type === 'section_saved' || r.type === 'section_generated');
          const where = hasSection ? locationLabel(r.chapterKey, r.sectionIndex || 0) : '';
          const what = r.type === 'section_saved' ? (where || r.summary) : (r.summary || where);
          const times = r.count > 1 ? new Date(r.firstAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '–' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          return head + '<div class="pt-event"><span class="pt-event-time">' + times + '</span><div class="pt-event-main"><strong>' + escapeHtml(verb[r.type] || r.type) + '</strong> ' + escapeHtml(what || '') +
            (r.count > 1 ? ' <span class="pt-muted">(' + r.count + ' saves)</span>' : '') +
            (hasSection ? '<div class="pt-row" style="margin-top:0.35rem;"><button class="btn btn-secondary pt-small" data-open="' + i + '">Open</button><button class="btn btn-secondary pt-small" data-versions="' + i + '"><i class="bx bx-history"></i> Versions</button></div>' : '') +
            '</div></div>';
        }).join('');
      body.addEventListener('click', function (e) {
        const o = e.target.closest('[data-open]'), v = e.target.closest('[data-versions]');
        if (!o && !v) return;
        const r = rows[parseInt(o ? o.dataset.open : v.dataset.versions, 10)];
        if (!r) return;
        goToPassage(r.chapterKey, r.sectionIndex || 0, '');
        if (v) setTimeout(function () { document.getElementById('versionHistoryIconBtn')?.click(); }, 400);
      });
    }

    // ----- Sample Size Calculator -------------------------------------------------------------
    function renderSampleSizeTool(body) {
      const qual = currentProject.approach === 'qualitative';
      const methods = PT.SAMPLE_METHODS.map(function (m) { return '<option value="' + m.id + '">' + escapeHtml(m.label) + '</option>'; }).join('');
      const num = function (id, label, value, hint) { return '<div class="pt-field" data-for="' + id + '"><label class="pt-label">' + label + '</label><input id="' + id + '" class="pt-input" type="number" step="any" value="' + value + '">' + (hint ? '<small class="pt-muted">' + hint + '</small>' : '') + '</div>'; };
      const sel = function (id, label, opts, value) { return '<div class="pt-field" data-for="' + id + '"><label class="pt-label">' + label + '</label><select id="' + id + '" class="pt-input">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(o[0]) === String(value) ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>'; };
      body.innerHTML = (qual ? '<p class="pt-note">Qualitative studies usually justify their sample by <strong>data saturation</strong> (interviewing until no new themes appear), not a formula. Use this only if your supervisor asks for a calculated number.</p>' : '') +
        '<div class="pt-field"><label class="pt-label">What is your study doing?</label><select id="ssMethod" class="pt-input">' + methods + '</select></div>' +
        '<div class="pt-grid">' +
        num('ssPopulation', 'Population size (N)', '', 'How many people the sample is drawn from. Optional for Cochran.') +
        num('ssMargin', 'Margin of error (%)', 5) +
        num('ssProportion', 'Expected proportion (%)', 50, 'Use 50% if unknown: it gives the largest, safest sample.') +
        sel('ssConfidence', 'Confidence level', [[90, '90%'], [95, '95% (usual)'], [99, '99%']], 95) +
        sel('ssPower', 'Power', [[80, '80% (usual)'], [85, '85%'], [90, '90%'], [95, '95%']], 80) +
        sel('ssEffect', "Expected effect size (Cohen's d)", [[0.2, '0.2 — small'], [0.5, '0.5 — medium (usual)'], [0.8, '0.8 — large']], 0.5) +
        num('ssP1', 'Proportion in group 1 (%)', 60) + num('ssP2', 'Proportion in group 2 (%)', 40) +
        num('ssR', 'Expected correlation (r)', 0.3, '0.1 small, 0.3 medium, 0.5 large') +
        num('ssAttrition', 'Expected drop-out / non-response (%)', 10) +
        '</div><button class="btn btn-primary" id="ssCalc" style="margin-top:0.6rem;"><i class="bx bx-calculator"></i> Calculate</button><div id="ssResult"></div>';
      const visible = { yamane: ['ssPopulation', 'ssMargin'], cochran: ['ssProportion', 'ssMargin', 'ssConfidence', 'ssPopulation'], twoMeans: ['ssEffect', 'ssConfidence', 'ssPower'], paired: ['ssEffect', 'ssConfidence', 'ssPower'],
        twoProportions: ['ssP1', 'ssP2', 'ssConfidence', 'ssPower'], correlation: ['ssR', 'ssConfidence', 'ssPower'] };
      const methodSel = document.getElementById('ssMethod');
      // a sensible starting method from the design
      const rs = currentProject.researchSetup || {};
      const setupText = [rs.aim, rs.problem].concat(rs.researchQuestions || []).join(' ').toLowerCase();
      methodSel.value = /before|after|pre-?test|post-?test|change over/.test(setupText) ? 'paired' : /compar|differen|versus|vs\.?|control group|effect of/.test(setupText) ? 'twoMeans' : /relationship|correlat|associat/.test(setupText) ? 'correlation' : 'yamane';
      const sync = function () {
        const show = visible[methodSel.value] || [];
        body.querySelectorAll('.pt-field[data-for]').forEach(function (f) { f.style.display = show.indexOf(f.dataset.for) >= 0 || f.dataset.for === 'ssAttrition' ? '' : 'none'; });
        document.getElementById('ssResult').innerHTML = '';
      };
      methodSel.addEventListener('change', sync); sync();
      document.getElementById('ssCalc').addEventListener('click', function () {
        const v = function (id) { const el = document.getElementById(id); return el ? el.value : ''; };
        const r = PT.sampleSize({ method: methodSel.value, population: v('ssPopulation'), margin: v('ssMargin'), proportion: v('ssProportion'), confidence: v('ssConfidence'), power: v('ssPower'),
          effect: v('ssEffect'), p1: v('ssP1'), p2: v('ssP2'), r: v('ssR'), attrition: v('ssAttrition') });
        const out = document.getElementById('ssResult');
        if (!r.ok) { out.innerHTML = '<p class="pt-bad">' + escapeHtml(r.error) + '</p>'; return; }
        out.innerHTML = '<div class="pt-big">' + r.finalN + ' <span>participants' + (r.finalPerGroup ? ' (' + r.finalPerGroup + ' per group)' : '') + '</span></div>' +
          (r.attrition ? '<p class="pt-muted">' + r.n + (r.perGroup ? ' (' + r.perGroup + ' per group)' : '') + ' before adding ' + r.attrition + '% for drop-out.</p>' : '') +
          '<p class="pt-formula">' + escapeHtml(r.formula) + '<br>' + escapeHtml(r.steps) + '</p>' +
          outputBoxHtml('ss', r.paragraph, /sampl/i);
        wireOutputBox('ss', 'Sample size justification');
      });
    }

    // ----- Statistical Analysis Planner ---------------------------------------------------------
    function renderStatsTool(body) {
      const rs = currentProject.researchSetup || {};
      if (currentProject.approach === 'qualitative') {
        const para = 'Data will be analysed using reflexive thematic analysis following Braun and Clarke\'s (2006) six phases: familiarisation with the data, generating initial codes, searching for themes, reviewing themes, defining and naming themes, and producing the report. Interviews will be transcribed verbatim and coded with the support of NVivo. Trustworthiness will be enhanced through member checking, an audit trail and reflexive notes (Lincoln and Guba, 1985).';
        body.innerHTML = '<p class="pt-note">This is a <strong>qualitative</strong> project, so statistical tests do not apply. The usual approach is <strong>thematic analysis</strong> (Braun and Clarke, 2006).</p>' + outputBoxHtml('st', para, /analysis/i);
        wireOutputBox('st', 'Data analysis plan'); return;
      }
      const questions = (rs.researchQuestions || []).filter(Boolean);
      const hyps = (rs.hypotheses || []).filter(Boolean);
      const labels = questions.map(function (q, i) { return { text: q, short: 'research question ' + (i + 1) }; }).concat(hyps.map(function (h, i) { return { text: h, short: 'hypothesis ' + (i + 1) }; }));
      const guess = function (t) {
        t = String(t || '').toLowerCase();
        return { goal: /predict|factors? (that|which)|determinant/.test(t) ? 'predict' : /relationship|correlat|associat/.test(t) ? 'relate' : /differ|compar|effect|improv|reduc|increase|change|versus|than/.test(t) ? 'compare' : 'describe',
          design: /before|after|pre-?test|post-?test|baseline|follow-?up|over time|change/.test(t) ? 'paired' : 'independent', groups: /three|3 groups|groups? \(|among the groups/.test(t) ? 3 : 2, outcome: 'continuous', normal: 'unsure' };
      };
      let rows = (labels.length ? labels.slice(0, 4) : [{ text: '', short: '' }]).map(function (l) { return Object.assign({ label: l.short, text: l.text }, guess(l.text)); });
      const opt = function (pairs, val) { return pairs.map(function (p) { return '<option value="' + p[0] + '"' + (String(p[0]) === String(val) ? ' selected' : '') + '>' + p[1] + '</option>'; }).join(''); };
      const draw = function () {
        body.innerHTML = (labels.length ? '' : '<p class="pt-note">Tip: fill in your research questions in <strong>Setup → Research Setup</strong> (or tap Draft with SI) and they will appear here.</p>') +
          rows.map(function (r, i) {
            const plan = PT.planTest(r);
            return '<div class="pt-analysis" data-i="' + i + '">' +
              '<div class="pt-row" style="justify-content:space-between;"><strong>Analysis ' + (i + 1) + (r.label ? ' — ' + escapeHtml(r.label) : '') + '</strong>' + (rows.length > 1 ? '<button class="btn btn-secondary pt-small" data-remove="' + i + '">Remove</button>' : '') + '</div>' +
              (r.text ? '<p class="pt-muted" style="margin:0.2rem 0 0.5rem;">' + escapeHtml(r.text) + '</p>' : '') +
              '<div class="pt-grid">' +
              '<div><label class="pt-label">What does it ask?</label><select class="pt-input" data-k="goal">' + opt([['describe', 'Describe a level or extent'], ['compare', 'Compare groups or time points'], ['relate', 'A relationship between two variables'], ['predict', 'What predicts an outcome']], r.goal) + '</select></div>' +
              (r.goal === 'compare' ? '<div><label class="pt-label">Who is compared?</label><select class="pt-input" data-k="design">' + opt([['independent', 'Different people in each group'], ['paired', 'The same people measured again (before/after)']], r.design) + '</select></div>' +
                '<div><label class="pt-label">How many groups / time points?</label><select class="pt-input" data-k="groups">' + opt([[2, 'Two'], [3, 'Three or more']], r.groups) + '</select></div>' : '') +
              '<div><label class="pt-label">The outcome is measured as</label><select class="pt-input" data-k="outcome">' + opt([['continuous', 'A score or measurement (e.g. ROM, BBS score)'], ['ordinal', 'A rating or Likert scale'], ['categorical', 'Categories (yes/no, groups)']], r.outcome) + '</select></div>' +
              (r.outcome === 'continuous' && r.goal !== 'describe' && r.goal !== 'predict' ? '<div><label class="pt-label">Normally distributed?</label><select class="pt-input" data-k="normal">' + opt([['unsure', "Don't know yet"], ['yes', 'Yes'], ['no', 'No']], r.normal) + '</select></div>' : '') +
              '</div><div class="pt-plan"><div><span class="pt-label">Use</span> <strong>' + escapeHtml(plan.primary) + '</strong></div>' +
              (plan.alternative ? '<div><span class="pt-label">Alternative</span> ' + escapeHtml(plan.alternative) + '</div>' : '') +
              (plan.posthoc ? '<div><span class="pt-label">Post hoc</span> ' + escapeHtml(plan.posthoc) + '</div>' : '') +
              (plan.effectSize ? '<div><span class="pt-label">Effect size</span> ' + escapeHtml(plan.effectSize) + '</div>' : '') +
              '<div><span class="pt-label">Describe with</span> ' + escapeHtml(plan.descriptive) + '</div>' +
              (plan.reason ? '<div class="pt-muted">' + escapeHtml(plan.reason) + '</div>' : '') +
              (plan.assumptions.length ? '<ul class="pt-list">' + plan.assumptions.map(function (a) { return '<li>' + escapeHtml(a) + '</li>'; }).join('') + '</ul>' : '') + '</div></div>';
          }).join('') +
          '<button class="btn btn-secondary" id="stAdd"><i class="bx bx-plus"></i> Add another analysis</button>' +
          '<div class="pt-row" style="margin-top:0.8rem;"><label class="pt-label">Software</label><select id="stSoftware" class="pt-input" style="max-width:260px;">' + opt([['IBM SPSS Statistics', 'SPSS'], ['R', 'R'], ['Stata', 'Stata'], ['JASP', 'JASP'], ['Microsoft Excel', 'Excel']], 'IBM SPSS Statistics') + '</select></div>' +
          outputBoxHtml('st', PT.analysisParagraph(rows.map(function (r) { return { label: r.label, plan: PT.planTest(r) }; })), /data analysis|analysis/i);
        wireOutputBox('st', 'Data analysis plan');
        body.querySelectorAll('.pt-analysis select').forEach(function (s) {
          s.addEventListener('change', function () { const i = parseInt(s.closest('.pt-analysis').dataset.i, 10); rows[i][s.dataset.k] = s.dataset.k === 'groups' ? parseInt(s.value, 10) : s.value; draw(); });
        });
        body.querySelectorAll('[data-remove]').forEach(function (b) { b.addEventListener('click', function () { rows.splice(parseInt(b.dataset.remove, 10), 1); draw(); }); });
        document.getElementById('stAdd').addEventListener('click', function () { rows.push(Object.assign({ label: 'analysis ' + (rows.length + 1), text: '' }, guess(''))); draw(); });
        document.getElementById('stSoftware').addEventListener('change', function (e) {
          document.getElementById('stText').value = PT.analysisParagraph(rows.map(function (r) { return { label: r.label, plan: PT.planTest(r) }; }), { software: e.target.value });
        });
      };
      draw();
    }

    // ----- Research Alignment ---------------------------------------------------------------
    function chapterKeyLike(re) { const st = getChaptersStructure(); return Object.keys(st).find(function (k) { return re.test(st[k].title); }) || null; }
    function renderAlignmentTool(body) {
      const rs = currentProject.researchSetup || {};
      const objs = (rs.objectives || []).filter(Boolean), qs = (rs.researchQuestions || []).filter(Boolean), hs = (rs.hypotheses || []).filter(Boolean);
      const quant = currentProject.approach !== 'qualitative';
      if (!objs.length && !qs.length) {
        body.innerHTML = '<p class="pt-note">Alignment starts from your objectives and research questions. Add them in <strong>Setup → Research Setup</strong> (Draft with SI can fill them from your title).</p><button class="btn btn-primary" id="alGoSetup"><i class="bx bx-cog"></i> Go to Research Setup</button>';
        document.getElementById('alGoSetup').addEventListener('click', function () { switchScreen('setup'); document.querySelector('.setup-tab[data-setup-tab="Research"]')?.click(); });
        return;
      }
      const flags = [];
      if (qs.length !== objs.length) flags.push('You have ' + objs.length + ' objective' + (objs.length === 1 ? '' : 's') + ' and ' + qs.length + ' research question' + (qs.length === 1 ? '' : 's') + '. Examiners usually expect one question per objective.');
      if (quant && hs.length && hs.length < qs.length) flags.push('Only ' + hs.length + ' hypothes' + (hs.length === 1 ? 'is' : 'es') + ' for ' + qs.length + ' research questions. Descriptive questions need none; every comparison or relationship question needs one.');
      if (quant && !hs.length) flags.push('No hypotheses yet. Quantitative studies that compare groups or test relationships should state them.');
      const saved = currentProject.alignmentCheck || null;
      const n = Math.max(objs.length, qs.length);
      const cell = function (v) { return v ? escapeHtml(v) : '<span class="pt-bad">Missing</span>'; };
      const found = function (row, part) {
        if (!saved || !saved.rows) return '<span class="pt-muted">Not checked</span>';
        const r = saved.rows[row]; const f = r && r[part];
        if (!f || !f.section) return '<span class="pt-bad">Not found</span>';
        return '<button class="pt-link" data-ch="' + escapeHtml(f.chapterKey) + '" data-sec="' + f.sectionIndex + '" data-quote="' + escapeHtml(f.quote || '') + '">✓ ' + escapeHtml(f.section) + '</button>';
      };
      body.innerHTML = (flags.length ? '<div class="pt-note">' + flags.map(function (f) { return '<p>• ' + escapeHtml(f) + '</p>'; }).join('') + '</div>' : '<p class="pt-good">Objectives, questions' + (quant ? ' and hypotheses' : '') + ' line up one to one.</p>') +
        '<div class="pt-table-wrap"><table class="pt-table"><thead><tr><th>#</th><th>Objective</th><th>Research question</th>' + (quant ? '<th>Hypothesis</th>' : '') + '<th>Method (Ch 3)</th><th>Result (Ch 4)</th><th>Discussion (Ch 5)</th></tr></thead><tbody>' +
        Array.from({ length: n }).map(function (_, i) {
          return '<tr><td>' + (i + 1) + '</td><td>' + cell(objs[i]) + '</td><td>' + cell(qs[i]) + '</td>' + (quant ? '<td>' + (hs[i] ? escapeHtml(hs[i]) : '<span class="pt-muted">—</span>') + '</td>' : '') +
            '<td>' + found(i, 'method') + '</td><td>' + found(i, 'result') + '</td><td>' + found(i, 'discussion') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        (saved && saved.note ? '<p class="pt-muted">' + escapeHtml(saved.note) + '</p>' : '') +
        '<div class="pt-row" style="margin-top:0.8rem;"><button class="btn btn-primary" id="alCheck"><i class="bx bx-search-alt"></i> ' + (saved ? 'Check the chapters again' : 'Check the chapters with Project SI') + '</button>' +
        '<span class="pt-muted">Finds where each objective is handled in your Methodology, Results and Discussion.' + (saved && saved.at ? ' Last checked ' + new Date(saved.at).toLocaleString() + '.' : '') + '</span></div>';
      body.querySelectorAll('.pt-link').forEach(function (b) { b.addEventListener('click', function () { goToPassage(b.dataset.ch, parseInt(b.dataset.sec, 10) || 0, b.dataset.quote || ''); }); });
      document.getElementById('alCheck').addEventListener('click', async function () {
        if (!needsSI('project.alignmentCheck')) return;
        const btn = this; btn.disabled = true; btn.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> Reading your chapters…';
        try {
          const parts = { method: chapterKeyLike(/method/i), result: chapterKeyLike(/result|finding/i), discussion: chapterKeyLike(/discussion|conclusion/i) };
          const text = ['method', 'result', 'discussion'].filter(function (p) { return parts[p]; }).map(function (p) { return buildChapterFullText(parts[p], 2500); }).join('\n\n');
          const system = 'You check the alignment of a student research project. For each objective, find the section of the Methodology, Results and Discussion chapters that addresses it. Use ONLY the chapter text given. Return ONLY JSON, no prose.';
          const user = 'OBJECTIVES:\n' + Array.from({ length: n }).map(function (_, i) { return (i + 1) + '. ' + (objs[i] || qs[i] || ''); }).join('\n') +
            '\n\nCHAPTERS (each section is marked "### [index] title"):\n' + text +
            '\n\nReturn {"rows":[{"objective":1,"method":{"chapter":"method","section":"<exact section title>","quote":"<verbatim sentence from that section>"}|null,"result":{...}|null,"discussion":{...}|null}],"note":"<one sentence on the biggest gap, or empty>"}. Use null when an objective is not addressed in that chapter or the chapter is empty. Never invent a quote.';
          const raw = await callProjectAI(PROJECT_AI_ACTIONS.reviewChapter, system, user);
          const d = parseJsonLoose(raw);
          if (!d || !Array.isArray(d.rows)) throw new Error('The check could not be read. Please try again.');
          const st = getChaptersStructure();
          const locate = function (part, v) {
            if (!v || !v.section || !parts[part]) return null;
            const ch = st[parts[part]]; const idx = sectionIndexByName(ch, v.section);
            return { chapterKey: parts[part], sectionIndex: idx, section: (ch.sections && ch.sections[idx]) || ch.title, quote: String(v.quote || '').slice(0, 200) };
          };
          const rowsOut = Array.from({ length: n }).map(function (_, i) {
            const r = d.rows.find(function (x) { return Number(x.objective) === i + 1; }) || d.rows[i] || {};
            return { method: locate('method', r.method), result: locate('result', r.result), discussion: locate('discussion', r.discussion) };
          });
          currentProject.alignmentCheck = { rows: rowsOut, note: String(d.note || ''), at: Date.now() };
          await database.ref('history/' + scopeUid + '/projects/' + currentProjectId + '/alignmentCheck').set(JSON.parse(JSON.stringify(currentProject.alignmentCheck)));
          renderAlignmentTool(body);
        } catch (err) { reportError(err, 'research alignment check'); btn.disabled = false; btn.innerHTML = '<i class="bx bx-search-alt"></i> Check the chapters with Project SI'; }
      });
    }

    // ----- Claim & Citation Checker -------------------------------------------------------------
    function renderClaimTool(body) {
      const style = currentProject.referenceStyle || 'APA 7th';
      const audit = PT.auditCitations(toolSections(), managerRefs(), style);
      const st = getChaptersStructure();
      const chapterOpts = Object.keys(st).filter(function (k) { return !/^(references?|questionnaire|appendix|abstract|defen[cs]e)/i.test(st[k].title); })
        .map(function (k) { return '<option value="' + k + '"' + (k === currentChapter ? ' selected' : '') + '>' + escapeHtml(st[k].title) + '</option>'; }).join('');
      const where = function (x) { return '<button class="pt-link" data-ch="' + escapeHtml(x.chapterKey) + '" data-sec="' + x.sectionIndex + '" data-quote="' + escapeHtml((x.raw || '').slice(0, 60)) + '">' + escapeHtml(x.label || x.source || '') + '</button>'; };
      body.innerHTML = (audit.supported
        ? '<div class="pt-stats"><div><strong>' + audit.citations.length + '</strong><span>citations in your text</span></div><div><strong>' + audit.references.length + '</strong><span>reference entries</span></div>' +
          '<div class="' + (audit.missing.length ? 'pt-bad' : 'pt-good') + '"><strong>' + audit.missing.length + '</strong><span>cited but not listed</span></div><div class="' + (audit.uncited.length ? 'pt-warn' : 'pt-good') + '"><strong>' + audit.uncited.length + '</strong><span>listed but never cited</span></div></div>' +
          '<h4 class="pt-h">Cited but missing from every reference list</h4>' + (audit.missing.length ? '<ul class="pt-list">' + audit.missing.map(function (m) { return '<li><strong>' + escapeHtml(m.author + ' (' + m.year + ')') + '</strong> in ' + where(m) + '</li>'; }).join('') + '</ul>' : '<p class="pt-good">None — every citation has a reference entry.</p>') +
          '<h4 class="pt-h">In a reference list but never cited</h4>' + (audit.uncited.length ? '<ul class="pt-list">' + audit.uncited.map(function (u) { return '<li>' + escapeHtml(u.raw.slice(0, 160)) + (u.chapterKey ? ' <span class="pt-muted">— listed in</span> ' + where(u) : ' <span class="pt-muted">— Reference Manager</span>') + '</li>'; }).join('') + '</ul>' : '<p class="pt-good">None.</p>') +
          '<p class="pt-muted">Matching uses the first author\'s surname and the year, as in ' + escapeHtml(style) + '. Reference lists are read from your Reference Manager and from any "References" heading inside your sections.</p>'
        : '<p class="pt-note">Your reference style (' + escapeHtml(style) + ') uses numbers, so author–year matching does not apply. The claim check below still works.</p>') +
        '<h4 class="pt-h" style="margin-top:1.2rem;">Claims that need a source (Project SI)</h4>' +
        '<div class="pt-row"><select id="ccChapter" class="pt-input" style="max-width:320px;">' + chapterOpts + '</select><button class="btn btn-primary" id="ccRun"><i class="bx bx-shield-quarter"></i> Find unsupported claims</button></div><div id="ccClaims"></div>';
      body.querySelectorAll('.pt-link').forEach(function (b) { b.addEventListener('click', function () { goToPassage(b.dataset.ch, parseInt(b.dataset.sec, 10) || 0, b.dataset.quote || ''); }); });
      document.getElementById('ccRun').addEventListener('click', async function () {
        if (!needsSI('project.claimCheck')) return;
        const chKey = document.getElementById('ccChapter').value, ch = st[chKey];
        const out = document.getElementById('ccClaims'), btn = this;
        btn.disabled = true; out.innerHTML = '<p class="pt-muted"><i class="bx bx-loader-alt bx-spin"></i> Reading ' + escapeHtml(ch.title) + '…</p>';
        try {
          const system = 'You audit a student\'s academic chapter for claims that need evidence. Return ONLY a JSON array, no prose. Include ONLY sentences that state a fact, statistic, prevalence, effect or established finding AND have no in-text citation in or right after them. Do not include the student\'s own aims, plans, opinions, definitions of their own study, or sentences that already carry a citation. Copy each sentence VERBATIM.';
          const user = buildChapterFullText(chKey, 4000) + '\n\nReturn [{"section":"<exact section title>","excerpt":"<verbatim sentence>","why":"<what kind of source it needs>"}]. At most 15, most important first. Return [] if every claim is supported.';
          const raw = await callProjectAI(PROJECT_AI_ACTIONS.reviewChapter, system, user);
          const list = parseJsonLoose(raw);
          if (!Array.isArray(list)) throw new Error('The check could not be read. Please try again.');
          out.innerHTML = list.length ? '<ul class="pt-list">' + list.map(function (c, i) {
            const idx = sectionIndexByName(ch, c.section);
            return '<li><button class="pt-link" data-ch="' + chKey + '" data-sec="' + idx + '" data-quote="' + escapeHtml(String(c.excerpt || '').slice(0, 80)) + '">“' + escapeHtml(c.excerpt || '') + '”</button><div class="pt-muted">' + escapeHtml((ch.sections && ch.sections[idx]) || ch.title) + (c.why ? ' · needs ' + escapeHtml(c.why) : '') + '</div></li>';
          }).join('') + '</ul><p class="pt-muted">Add a citation from a real source you have read. Project SI never invents references.</p>' : '<p class="pt-good">No unsupported claims found in this chapter.</p>';
          out.querySelectorAll('.pt-link').forEach(function (b) { b.addEventListener('click', function () { goToPassage(b.dataset.ch, parseInt(b.dataset.sec, 10) || 0, b.dataset.quote || ''); }); });
        } catch (err) { reportError(err, 'claim checker'); out.innerHTML = ''; }
        finally { btn.disabled = false; }
      });
    }

    document.getElementById('toolsBackBtn')?.addEventListener('click', function () {
      document.querySelectorAll('.tool-pane').forEach(function (p) { p.style.display = 'none'; });
    });

    // =========================================================================
    // PROJECT AI — REDESIGN: the 8 contextual actions, purpose-built for the
    // current project (not a Lixa duplicate — see buildWorkspaceContext()).
    // Routed through js/ai-quota-core.js so this counts against the same
    // shared token budget every other AI feature does.
    // =========================================================================
    const PROJECT_AI_ACTIONS = {
      continueWriting: { label: 'Continue writing', icon: 'bx-play-circle', model: 'corpus101' },
      improveWriting: { label: 'Improve writing', icon: 'bx-edit-alt', model: 'corpus101' },
      explain: { label: 'Explain', icon: 'bx-bulb', model: 'basal100' },
      checkSection: { label: 'Check section', icon: 'bx-check-square', model: 'basal100' },
      findMissing: { label: 'Find what\'s missing', icon: 'bx-search', model: 'corpus101' },
      checkConsistencyAI: { label: 'Check consistency', icon: 'bx-git-compare', model: 'corpus101' },
      addCitations: { label: 'Add citations', icon: 'bx-bookmark-plus', model: 'basal100' },
      reviewChapter: { label: 'Review chapter', icon: 'bx-list-check', model: 'medulla200' }
    };

    // The model chosen on any page (js/model-choice.js); `fallbackId` when that module is unavailable.
    // (with the model chosen on any page; past today's Blix 360 allowance it writes with Medulla 200: js/model-choice.js)
    function chosenModelConfig(fallbackId) {
      return window.RehablixModelChoice ? window.RehablixModelChoice.resolve() : window.RehablixAIQuotaCore.resolveModelConfig(fallbackId);
    }

    async function callProjectAI(action, systemPrompt, userPrompt) {
      return (await callProjectAIReply(action, systemPrompt, userPrompt)).text;
    }
    // The reply with its finish_reason, so a reply that ran out of room is never mistaken for a whole one.
    async function callProjectAIReply(action, systemPrompt, userPrompt) {
      const config = await chosenModelConfig(action.model);
      if (!config) throw new Error('SI service not configured');
      if (currentUser) await window.RehablixAIQuotaCore.checkQuotaOrThrow(currentUser.uid, currentPlan);
      const response = await fetch(config.endpoint + '/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
        body: JSON.stringify({ model: config.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], max_tokens: config.maxTokens, temperature: config.temperature, top_p: config.top_p })
      });
      if (!response.ok) { const err = await response.json().catch(function () { return {}; }); throw new Error((err.error && err.error.message) || 'SI service error'); }
      const reply = replyOf(await response.json());
      if (currentUser) window.RehablixAIQuotaCore.reportTokenUsage(currentUser.uid, currentPlan, systemPrompt + userPrompt + reply.text, config.weight);
      return reply;
    }
    // Improve writing / Add citations rewrite the section in place: a version is saved first (Version History
    // can undo it), and the section is rewritten part by part so its end is never lost.
    async function rewriteSectionWith(action, systemPrompt, buildUserPrompt) {
      if (extractPlainText(sectionEditor.innerHTML).trim().length < 50) throw new Error('Write some content in this section first.');
      await saveVersion();
      const res = await rewriteInPieces(sectionEditor.innerHTML, function (piece, i, n) {
        return callProjectAIReply(action, systemPrompt + partNote(i, n).replace(/^\n/, ' '), buildUserPrompt(piece));
      });
      if (res.kept === res.pieces) throw new Error('No usable rewrite came back, so your section was left as it was.');
      sectionEditor.innerHTML = res.html;
      saveCurrentSection(); await saveToFirebase(); updateVersionList();
      return res;
    }

    // Lixa's message structure (.message > .message-bubble + .message-time) so
    // Project AI shares Lixa's bubbles, spacing and typography. `.ai-message`
    // is kept for chat-history compatibility. `opts.openFindings` adds a
    // clickable "View findings" button that survives save/reload (data attr).
    function renderMarkdownSafe(md) {
      const html = typeof marked !== 'undefined' ? marked.parse(md) : escapeHtml(md);
      return window.RehablixSanitize ? window.RehablixSanitize.html(html) : html;
    }
    function buildChatMessage(role, bubbleHtml, timeText) {
      const div = document.createElement('div');
      div.className = 'message ai-message ' + role;
      const bubble = document.createElement('div');
      bubble.className = 'message-bubble';
      bubble.innerHTML = bubbleHtml;
      const time = document.createElement('div');
      time.className = 'message-time';
      time.textContent = timeText || '';
      div.appendChild(bubble); div.appendChild(time);
      return div;
    }
    function appendAIChatMessage(role, content, opts) {
      opts = opts || {};
      const emptyState = aiChatMessages.querySelector('.ai-empty-state');
      if (emptyState) emptyState.remove();
      let html = role === 'assistant' ? renderMarkdownSafe(content) : escapeHtml(content);
      if (opts.openFindings) html += '<button type="button" class="proj-open-findings" data-open-findings="1"><i class="bx bx-check-shield"></i> View findings</button>';
      const div = buildChatMessage(role, html, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      aiChatMessages.appendChild(div);
      div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      updateDefaultPromptsBar();
    }
    // Completed Chapter Review / Consistency results in the chat are clickable.
    aiChatMessages.addEventListener('click', function (e) {
      if (e.target.closest('[data-open-findings]')) setReviewMode('findings');
    });

    async function runProjectAIAction(actionKey) {
      if (!currentProject || !currentChapter) { showToast('Select a chapter and section first', 'error'); return; }
      if (!canAccessAISupervisor()) { showToast('Project SI requires Student or Pro plan.', 'error'); goToSubscription(); return; }
      const action = PROJECT_AI_ACTIONS[actionKey];
      if (!action) return;
      const ch = getChaptersStructure()[currentChapter];
      const sectionName = ch && ch.sections && ch.sections.length ? ch.sections[currentSection] : (ch ? ch.title : 'Section');
      const currentDraft = extractPlainText(sectionEditor.innerHTML);
      appendAIChatMessage('user', action.label + ' — "' + sectionName + '"');
      showTypingIndicator();

      let systemPrompt = 'You are Project SI, a research-writing assistant built specifically for this academic project. You know its research setup, chapters, and current draft. Reply concisely.';
      let userPrompt = '';
      const context = buildWorkspaceContext(true);

      try {
        if (actionKey === 'continueWriting') {
          systemPrompt += ' Continue the student\'s own draft naturally from where it stops. Do not repeat what is already written. Match the existing voice and tense. Return ONLY the continuation text (plain HTML paragraphs), no preamble.';
          userPrompt = context + '\n\nContinue the "' + sectionName + '" section from where the current draft leaves off.';
          const result = cleanAIResponse(await callProjectAI(action, systemPrompt, userPrompt));
          sectionEditor.innerHTML += (sectionEditor.innerHTML.trim() ? ' ' : '') + result;
          saveCurrentSection(); await saveToFirebase();
          hideTypingIndicator(); appendAIChatMessage('assistant', 'Added a continuation to your draft.');
        } else if (actionKey === 'improveWriting') {
          systemPrompt += ' Rewrite the given text for clarity and academic flow. Do NOT change any facts, numbers, statistics, sample sizes, or citations. Keep about the same length. Return ONLY the rewritten HTML.';
          const res = await rewriteSectionWith(action, systemPrompt, function (piece) { return 'TEXT TO IMPROVE:\n' + piece; });
          hideTypingIndicator(); appendAIChatMessage('assistant', 'Improved the writing in this section' + (res.kept ? ' (' + res.kept + ' of ' + res.pieces + ' parts kept as they were)' : '') + '. Your previous text is saved in Version History.');
        } else if (actionKey === 'explain') {
          systemPrompt += ' Explain in plain language what the given passage argues or means, in the context of this specific study. Keep it brief.';
          userPrompt = context + '\n\nExplain this passage:\n' + (currentDraft || '(the section is currently empty)');
          const result = await callProjectAI(action, systemPrompt, userPrompt);
          hideTypingIndicator(); appendAIChatMessage('assistant', result);
        } else if (actionKey === 'checkSection') {
          systemPrompt += ' Check whether this section actually addresses what the project\'s Research Setup says it should. Return a short bullet list of findings only, no long prose.';
          userPrompt = context + '\n\nSection being checked: "' + sectionName + '"\nSection content:\n' + (currentDraft || '(empty)');
          const result = await callProjectAI(action, systemPrompt, userPrompt);
          hideTypingIndicator(); appendAIChatMessage('assistant', result);
        } else if (actionKey === 'findMissing') {
          systemPrompt += ' Identify what is missing from this section given its expected remit (its own title/topic) and the project\'s established facts. Return a short bullet list only.';
          userPrompt = context + '\n\nSection: "' + sectionName + '"\nCurrent content:\n' + (currentDraft || '(empty)');
          const result = await callProjectAI(action, systemPrompt, userPrompt);
          hideTypingIndicator(); appendAIChatMessage('assistant', result);
        } else if (actionKey === 'checkConsistencyAI') {
          const regexFindings = checkConsistency();
          systemPrompt += ' Check the whole project for inconsistencies AI regex checks would miss (e.g. a design called one thing in one chapter and another thing elsewhere). Return a short bullet list only. If nothing is found, say so briefly.';
          userPrompt = buildFullProjectSummary();
          const result = await callProjectAI(action, systemPrompt, userPrompt);
          hideTypingIndicator();
          appendAIChatMessage('assistant', (regexFindings.length ? regexFindings.map(function (f) { return '- ' + f.note; }).join('\n') + '\n\n' : '') + result, { openFindings: regexFindings.length > 0 });
          renderConsistencyFindings(regexFindings);
        } else if (actionKey === 'addCitations') {
          systemPrompt += ' Find claims in this section that need a citation. If a matching source exists in AVAILABLE SOURCES, insert an in-text citation for it. If no matching source exists, flag the claim as needing one instead of a citation. NEVER invent a source that is not in AVAILABLE SOURCES. Keep all the existing text. Return ONLY the updated section HTML.';
          const res = await rewriteSectionWith(action, systemPrompt, function (piece) { return context + '\n\nSECTION TO ADD CITATIONS TO:\n' + piece; });
          hideTypingIndicator(); appendAIChatMessage('assistant', 'Checked this section for citations' + (res.kept ? ' (' + res.kept + ' of ' + res.pieces + ' parts kept as they were)' : '') + ' — review the changes in the editor. Your previous text is saved in Version History.');
        } else if (actionKey === 'reviewChapter') {
          const reviewEl = document.getElementById('reviewChapterFindings');
          if (reviewEl) reviewEl.innerHTML = '<div class="review-finding review-empty"><i class="bx bx-loader-alt bx-spin"></i> Reviewing ' + escapeHtml(ch ? ch.title : 'this chapter') + ' — reading every section in full…</div>';
          // IMPROVED: the reviewer now sees each section's full text (not a
          // 500-char digest) and must return structured, specific findings —
          // the exact section, a verbatim quote of the problem passage, what
          // precisely is wrong, and how to fix it — so every finding can be
          // located in the editor and fixed with one click.
          systemPrompt += ' You are reviewing ONE chapter of a student\'s academic project with the rigor of a strict examiner. Find concrete problems only: content that is missing from what a section of this title must contain, weak or vague argument, statements inconsistent with the Research Setup or other chapters (designs, figures, instruments, variables), and claims that need evidence or a citation. Be specific: name the exact problem, never generic advice.\n\nReturn ONLY a JSON array (no prose, no code fences). Each element:\n{"type":"missing|weak|inconsistent|unsupported","severity":"high|medium|low","section":"<exact section title from the list given>","excerpt":"<a VERBATIM quote, copied character-for-character from that section, of the sentence(s) with the problem; empty string when the problem is something missing>","note":"<specific explanation of what is wrong and why, referring to the actual content>","suggestion":"<specific, actionable fix>"}\nReturn [] if the chapter has no real problems. At most 12 findings, most important first.';
          userPrompt = buildWorkspaceContext(false) + '\n\n' + buildChapterFullText(currentChapter) + '\n\nReview chapter: "' + (ch ? ch.title : currentChapter) + '"';
          const result = await callProjectAI(action, systemPrompt, userPrompt);
          const findings = parseChapterReview(result, ch);
          if (!currentProject.reviewFindings) currentProject.reviewFindings = {};
          currentProject.reviewFindings[currentChapter] = { findings: findings, computedAt: Date.now() };
          await database.ref('history/' + scopeUid + '/projects/' + currentProjectId + '/reviewFindings/' + currentChapter).set({ findings: findings, computedAt: firebase.database.ServerValue.TIMESTAMP });
          logActivity('chapter_reviewed', ch ? ch.title : currentChapter);
          hideTypingIndicator();
          appendAIChatMessage('assistant', findings.length
            ? 'Chapter review complete — ' + findings.length + ' specific issue' + (findings.length === 1 ? '' : 's') + ' found.'
            : 'Chapter review complete — no real problems found in this chapter.', { openFindings: findings.length > 0 });
          renderChapterFindings();
        }
      } catch (err) {
        hideTypingIndicator();
        reportError(err, 'project AI action: ' + actionKey);
        appendAIChatMessage('assistant', 'Sorry, that action failed: ' + (err.message || 'unknown error'));
      }
    }

    function renderProjectAIActions() {
      if (!projectAIActions) return;
      // One horizontal strip: the 8 quick actions, then the suggested prompts.
      projectAIActions.innerHTML = Object.keys(PROJECT_AI_ACTIONS).map(function (key) {
        const a = PROJECT_AI_ACTIONS[key];
        return '<button type="button" class="proj-ai-action-btn" data-action="' + key + '" title="' + a.label + '"><i class="bx ' + a.icon + '" aria-hidden="true"></i> ' + a.label + '</button>';
      }).join('') + SUGGESTED_PROMPTS.map(function (t) {
        return '<button type="button" class="proj-ai-action-btn proj-ai-prompt-chip" data-prompt="' + escapeHtml(t) + '"><i class="bx bx-message-rounded-dots" aria-hidden="true"></i> ' + escapeHtml(t) + '</button>';
      }).join('');
      projectAIActions.querySelectorAll('.proj-ai-action-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (btn.dataset.prompt) { aiMessageInput.value = btn.dataset.prompt; aiSendBtn.click(); }
          else runProjectAIAction(btn.dataset.action);
        });
      });
    }

    // =========================================================================
    // VERSION HISTORY (ported)
    // =========================================================================
    const MAX_VERSIONS = 10;
    // VERSION HISTORY (reworked): versions no longer ride along inside the
    // project record (every autosave used to rewrite all of them). They live at
    // history/{scope}/projectVersions/{projectId}/{chapterKey}/{sectionIndex}
    // and are only read when the Version History modal (or a restore) needs them.
    let versionsCache = {};
    function versionsRef(chKey, sec) { return database.ref('history/' + scopeUid + '/projectVersions/' + currentProjectId + '/' + chKey + '/' + sec); }
    function toVersionList(v) { return (Array.isArray(v) ? v : Object.values(v || {})).filter(Boolean); }
    async function loadVersions(chKey, sec) {
      const key = chKey + '|' + sec;
      if (versionsCache[key]) return versionsCache[key];
      let list = [];
      try { list = toVersionList((await versionsRef(chKey, sec).once('value')).val()); } catch (e) { list = []; }
      versionsCache[key] = list;
      return list;
    }

    // One-time move of a project's legacy `_versions` blob to its own path.
    async function migrateVersionsOut(id, full) {
      if (!full || !full._versions || typeof full._versions !== 'object' || !Object.keys(full._versions).length) { if (full) delete full._versions; return; }
      try {
        await database.ref('history/' + scopeUid + '/projectVersions/' + id).update(full._versions);
        await database.ref('history/' + scopeUid + '/projects/' + id + '/_versions').remove();
      } catch (e) { console.warn('[project] version migration deferred:', e); }
      delete full._versions;
    }

    async function saveVersion() {
      if (!currentProject || !currentChapter) return;
      saveCurrentSection();
      const ch = getChaptersStructure()[currentChapter];
      const data = (currentProject.chapters || {})[currentChapter] || {};
      const content = ch && ch.sections && ch.sections.length > 0 ? (data.sections || {})[currentSection] : data.content;
      if (!content || content.trim().length < 50) return;
      const chKey = currentChapter, sec = currentSection;
      const versions = await loadVersions(chKey, sec);
      if (versions.length > 0 && versions[0].content === content) return;
      versions.unshift({ content: content, timestamp: Date.now(), date: new Date().toLocaleString() });
      if (versions.length > MAX_VERSIONS) versions.length = MAX_VERSIONS;
      try { await versionsRef(chKey, sec).set(versions); } catch (e) { reportError(e, 'save'); }
      updateVersionList();
    }

    async function updateVersionList() {
      if (!versionList || !currentProject || !currentChapter) return;
      const chKey = currentChapter, sec = currentSection;
      const versions = await loadVersions(chKey, sec);
      if (chKey !== currentChapter || sec !== currentSection) return; // moved on while loading
      if (versions.length === 0) { versionList.innerHTML = '<small style="color:var(--text-secondary);">No previous versions</small>'; return; }
      versionList.innerHTML = versions.map(function (v, i) { return '<div class="version-item"><span>' + escapeHtml(v.date || '') + '</span><button class="restore-version-btn" data-index="' + i + '" aria-label="Restore version from ' + escapeHtml(v.date || '') + '">Restore</button></div>'; }).join('');
      versionList.querySelectorAll('.restore-version-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) { restoreVersion(parseInt(e.currentTarget.dataset.index, 10)); });
      });
    }

    async function restoreVersion(index) {
      const versions = await loadVersions(currentChapter, currentSection);
      if (!versions || !versions[index]) return;
      if (!confirm('Restore this version? Current content will be saved as a new version first.')) return;
      const target = versions[index].content;
      await saveVersion();
      sectionEditor.innerHTML = target;
      saveCurrentSection(); saveToFirebase(); displayHumanizationScore(); updateVersionList();
      showToast('Version restored', 'success');
    }
    if (saveVersionBtn) saveVersionBtn.addEventListener('click', function () { saveVersion(); showToast('Version saved', 'success'); });

    // =========================================================================
    // HUMANIZE / SCORING / SUPERVISOR PERSONALITY / WORD COUNT+REF STYLE
    // (all ported near-verbatim)
    // =========================================================================
    function buildHumanizationPrompt() {
      return 'HUMANIZATION REQUIREMENTS - READ ALL CAREFULLY:\n\n' +
        '1. SENTENCE VARIETY (most important signal of human writing):\n   - Mix sentence lengths naturally.\n   - Do NOT start consecutive sentences with the same word or phrase.\n   - Vary paragraph length.\n\n' +
        '2. VOCABULARY:\n   - Use natural clinical language.\n   - BANNED words/phrases: moreover, furthermore, notably, consequently, thus, hence, therein, hereby, whereby, aforementioned, it is imperative, it should be noted that, it is worth mentioning, the findings revealed that, the results indicated that, it can be argued that, it is evident that, needless to say, it must be emphasized.\n   - Prefer direct simple verbs.\n\n' +
        '3. STUDENT VOICE - SPECIFIC PERSONAL TOUCHES: include 1-2 genuine personal reflections grounded in a specific clinical detail.\n\n' +
        '4. ZERO REPETITIVE TEMPLATES.\n\n5. NATURAL IMPERFECTION (subtle).\n\n6. NIGERIAN HEALTHCARE CONTEXT (where relevant).\n\n' + PUNCTUATION_RULES;
    }

    function getProfileGuidance(profile) {
      const profiles = {
        undergraduate: '- Vocabulary: Basic to intermediate clinical terminology\n- Tone: Curious, still learning',
        final_year: '- Vocabulary: Solid clinical terminology\n- Tone: Confident but not expert-level',
        msc: '- Vocabulary: Advanced clinical and research terminology\n- Tone: Confident, analytical',
        phd: '- Vocabulary: Expert-level\n- Tone: Scholarly, authoritative',
        nigerian_ug: '- Vocabulary: Nigerian English academic style\n- Tone: Respectful, slightly formal with local flavor'
      };
      return profiles[profile] || profiles.undergraduate;
    }

    function calculateHumanizationScore(htmlContent) {
      const text = extractPlainText(htmlContent);
      if (!text || text.length < 100) return null;
      const sentences = text.split(/[.!?]+/).filter(function (s) { return s.trim().length > 5; });
      if (sentences.length < 5) return null;
      const lengths = sentences.map(function (s) { return s.trim().split(/\s+/).length; });
      const avgLength = lengths.reduce(function (a, b) { return a + b; }, 0) / lengths.length;
      const variance = lengths.reduce(function (sum, len) { return sum + Math.pow(len - avgLength, 2); }, 0) / lengths.length;
      const stdDev = Math.sqrt(variance);
      const variationScore = Math.min(100, Math.round((stdDev / (avgLength || 1)) * 100));
      const bannedPhrases = ['moreover', 'furthermore', 'notably', 'consequently', 'thus', 'hence', 'in conclusion', 'it should be noted that', 'the findings revealed that', 'the results indicated that'];
      let predictablePatterns = 0;
      const totalSentences = sentences.length;
      bannedPhrases.forEach(function (phrase) { const m = text.match(new RegExp(phrase, 'gi')); if (m) predictablePatterns += m.length; });
      const starts = sentences.map(function (s) { return s.trim().split(/\s+/).slice(0, 2).join(' ').toLowerCase(); });
      const startVariety = new Set(starts).size / totalSentences;
      const predictabilityScore = Math.max(0, Math.round((predictablePatterns / totalSentences) * 50 + (1 - startVariety) * 50));
      const aiIndicators = [/it is (important|essential|crucial|necessary) to/gi, /(moreover|furthermore|consequently|thus|hence)/gi, /in (conclusion|summary|essence)/gi];
      let aiIndicatorCount = 0;
      aiIndicators.forEach(function (pattern) { const m = text.match(pattern); if (m) aiIndicatorCount += m.length; });
      const aiLikelihoodScore = Math.min(100, Math.round((aiIndicatorCount / totalSentences) * 40 + (predictablePatterns / totalSentences) * 30 + (1 - startVariety) * 30));
      const overallScore = Math.round(variationScore * 0.3 + (100 - predictabilityScore) * 0.35 + (100 - aiLikelihoodScore) * 0.35);
      return { overall: Math.min(100, Math.max(0, overallScore)), variation: variationScore, predictability: predictabilityScore, aiLikelihood: aiLikelihoodScore, sentenceCount: totalSentences };
    }

    function deepScanContent(html) {
      const text = extractPlainText(html);
      if (!text || text.length < 200) return null;
      const sentences = text.split(/[.!?]+/).filter(function (s) { return s.trim().length > 5; });
      const words = text.split(/\s+/).filter(function (w) { return w.length > 1; });
      const uniqueWords = new Set(words.map(function (w) { return w.toLowerCase().replace(/[^a-z]/g, ''); }));
      const lengths = sentences.map(function (s) { return s.length; });
      const meanLen = lengths.reduce(function (a, b) { return a + b; }, 0) / lengths.length;
      const variance = lengths.reduce(function (s, l) { return s + Math.pow(l - meanLen, 2); }, 0) / lengths.length;
      const burstiness = meanLen > 0 ? Math.sqrt(variance) / meanLen : 0;
      const freqMap = {};
      words.forEach(function (w) { const c = w.toLowerCase().replace(/[^a-z]/g, ''); if (c.length > 1) freqMap[c] = (freqMap[c] || 0) + 1; });
      const sortedFreqs = Object.values(freqMap).sort(function (a, b) { return b - a; });
      let rankSum = 0, wordCount = 0;
      words.forEach(function (w) { const c = w.toLowerCase().replace(/[^a-z]/g, ''); if (c.length > 1 && freqMap[c]) { rankSum += sortedFreqs.indexOf(freqMap[c]) + 1; wordCount++; } });
      const avgRank = wordCount > 0 ? rankSum / wordCount : 500;
      const ttr = words.length > 0 ? uniqueWords.size / words.length : 0;
      const aiPhrases = /(moreover|furthermore|consequently|thus|hence|it is important to note|the results indicated that|in conclusion)/gi;
      const aiCount = (text.match(aiPhrases) || []).length;
      const starters = sentences.map(function (s) { return s.trim().split(/\s+/).slice(0, 2).join(' ').toLowerCase(); });
      const starterVariety = sentences.length > 0 ? new Set(starters).size / sentences.length : 0;
      const humanScore = Math.min(100, Math.round((1 - Math.min(burstiness, 1.5) / 1.5) * 20 + (ttr > 0.75 ? 25 : ttr * 33) + (1 - Math.min(avgRank / 1500, 1)) * 15 + (starterVariety > 0.6 ? 20 : starterVariety * 33) + (1 - Math.min(aiCount / Math.max(sentences.length, 1), 1)) * 20));
      return { score: Math.max(0, humanScore), details: { burstiness: Math.round(burstiness * 100) / 100, ttr: Math.round(ttr * 100) / 100, avgRank: Math.round(avgRank), aiCount: aiCount, starterVariety: Math.round(starterVariety * 100) / 100, sentenceCount: sentences.length } };
    }

    function displayHumanizationScore() {
      if (!aiScoreDisplay) return;
      if (canAccessDeepScan()) {
        const deep = deepScanContent(sectionEditor.innerHTML);
        if (deep && deep.details.sentenceCount >= 5) {
          aiScoreDisplay.style.display = 'block';
          if (humanizationScoreEl) humanizationScoreEl.textContent = deep.score + '%';
          if (scoreFillEl) { scoreFillEl.style.width = deep.score + '%'; scoreFillEl.style.background = deep.score >= 70 ? '#10b981' : deep.score >= 50 ? '#f59e0b' : '#dc2626'; }
          if (scoreSentenceVarEl) scoreSentenceVarEl.textContent = 'Burstiness: ' + deep.details.burstiness;
          if (scorePredictabilityEl) scorePredictabilityEl.textContent = 'Vocabulary: ' + deep.details.ttr;
          if (scoreAILikelyEl) scoreAILikelyEl.textContent = 'Repetitive patterns: ' + deep.details.aiCount;
          if (badgeFree) badgeFree.style.display = 'none'; if (badgePremium) badgePremium.style.display = 'inline-flex';
        } else aiScoreDisplay.style.display = 'none';
      } else {
        const score = calculateHumanizationScore(sectionEditor.innerHTML);
        if (score && score.sentenceCount >= 5) {
          aiScoreDisplay.style.display = 'block';
          if (humanizationScoreEl) humanizationScoreEl.textContent = score.overall + '%';
          if (scoreFillEl) { scoreFillEl.style.width = score.overall + '%'; scoreFillEl.style.background = score.overall >= 70 ? '#10b981' : score.overall >= 50 ? '#f59e0b' : '#dc2626'; }
          if (scoreSentenceVarEl) scoreSentenceVarEl.textContent = 'Sentence Variation: ' + score.variation + '%';
          if (scorePredictabilityEl) scorePredictabilityEl.textContent = 'Predictability: ' + score.predictability + '%';
          if (scoreAILikelyEl) scoreAILikelyEl.textContent = 'Repetitive patterns: ' + score.aiLikelihood + '%';
          if (badgeFree) badgeFree.style.display = 'inline-block'; if (badgePremium) badgePremium.style.display = 'none';
        } else aiScoreDisplay.style.display = 'none';
      }
    }

    // REDESIGN (Round 3): the old pre-generation "Humanize content" checkbox
    // (advanced panel, now removed) is replaced by a standalone post-hoc
    // action — a Humanize icon in the editor header opens a score modal
    // with a "Humanize" button, which reuses this SAME academic-integrity
    // warning modal; on confirmation it rewrites the section that is
    // already written instead of flipping a flag consumed mid-generation.
    if (closeHumanizeWarning) closeHumanizeWarning.addEventListener('click', function () { humanizeWarningModal.classList.remove('active'); });
    if (cancelHumanizeBtn) cancelHumanizeBtn.addEventListener('click', function () { humanizeWarningModal.classList.remove('active'); });
    if (confirmHumanizeBtn) confirmHumanizeBtn.addEventListener('click', function () {
      humanizeWarningModal.classList.remove('active');
      humanizeCurrentSection();
    });

    // Only blix360 (OpenAI, requires Pro) and medulla200 (DeepSeek, requires
    // Student) are capable/allowed models for this action — prefers the
    // stronger blix360 when the plan unlocks it, falls back to medulla200,
    // and returns null (blocked) below Student.
    function pickHumanizeModelId() {
      const tiers = window.RehabPlanTiers;
      if (!tiers || typeof tiers.isModelUnlocked !== 'function') return 'medulla200';
      if (tiers.isModelUnlocked('blix360', currentPlan)) return 'blix360';
      if (tiers.isModelUnlocked('medulla200', currentPlan)) return 'medulla200';
      return null;
    }

    async function humanizeCurrentSection() {
      if (!currentProject || !currentChapter) { showToast('Select a chapter and section first', 'error'); return; }
      const modelId = pickHumanizeModelId();
      if (!modelId) { showToast('Natural voice editing requires Student plan or higher.', 'error'); goToSubscription(); return; }
      const sourceHtml = sectionEditor.innerHTML;
      if (!sourceHtml || extractPlainText(sourceHtml).trim().length < 50) { showToast('Write some content in this section first.', 'error'); return; }
      await saveVersion();
      const profile = currentProject.writingProfile || 'undergraduate';
      const profileGuidance = getProfileGuidance(profile);
      const referenceStyle = getReferenceStyle();
      const humanizationRules = buildHumanizationPrompt();
      const systemPrompt = 'You are an expert at rewriting academic text to sound naturally human-written.\nYour job is to change STYLE and VOICE only, never change facts, numbers, sample sizes, statistics, or citations.\nWrite in first-person student voice.\n' + PUNCTUATION_RULES;
      showToast('Applying natural voice editing...', 'info', 2500);
      try {
        // (Student plan or higher, as before; it writes with the model chosen on any page)
        const config = await chosenModelConfig(modelId);
        if (!config) throw new Error('SI service not configured');
        if (currentUser) await window.RehablixAIQuotaCore.checkQuotaOrThrow(currentUser.uid, currentPlan);
        // the whole section, part by part (it used to rewrite only the first 6,000 characters and drop the rest)
        const res = await rewriteInPieces(sourceHtml, async function (piece, i, n) {
          const userPrompt = 'REWRITE the text below to sound like a real ' + profile + ' healthcare student wrote it.\nThe project is about: "' + currentProject.title + '"\n\nSTRICT RULES:\n- Change ONLY the writing style, voice, and phrasing.\n- Do NOT change any numbers, statistics, sample sizes, participant counts, or citations.\n- Preserve all ' + referenceStyle + ' citations exactly as written.\n- Keep about the same length.\n\nWRITING PROFILE:\n' + profileGuidance + '\n\n' + humanizationRules + partNote(i, n) + '\n\nTEXT TO REWRITE:\n' + piece + '\n\nReturn ONLY the rewritten HTML. No markdown fences. If the source text is empty, respond with "EMPTY_SOURCE".';
          const response = await fetch(config.endpoint + '/chat/completions', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
            body: JSON.stringify({ model: config.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], max_tokens: Math.min(config.maxTokens || 6000, 6000), temperature: config.temperature, top_p: config.top_p })
          });
          if (!response.ok) { const err = await response.json().catch(function () { return {}; }); throw new Error((err.error && err.error.message) || 'SI service error'); }
          const reply = replyOf(await response.json());
          if (currentUser) window.RehablixAIQuotaCore.reportTokenUsage(currentUser.uid, currentPlan, systemPrompt + userPrompt + reply.text, config.weight);
          return reply;
        });
        if (res.kept === res.pieces) throw new Error('Natural voice editing produced no usable output');
        sectionEditor.innerHTML = res.html;
        saveCurrentSection(); await saveToFirebase();
        displayHumanizationScore(); updateVersionList();
        showToast(res.kept ? 'Natural voice editing applied (' + res.kept + ' of ' + res.pieces + ' parts kept as they were). The previous text is in Version History.' : 'Natural voice editing applied. The previous text is in Version History.', 'success', 5000);
      } catch (err) {
        reportError(err, 'humanize section');
        showToast('Natural voice editing failed: ' + (err.message || 'Unknown error'), 'error', 5000);
      }
    }

    const humanizeScoreModal = document.getElementById('humanizeScoreModal');
    document.getElementById('humanizeIconBtn')?.addEventListener('click', function () {
      if (!currentProject || !currentChapter) { showToast('Select a chapter and section first', 'error'); return; }
      displayHumanizationScore();
      humanizeScoreModal?.classList.add('active');
    });
    document.getElementById('closeHumanizeScoreModal')?.addEventListener('click', function () { humanizeScoreModal?.classList.remove('active'); });
    document.getElementById('humanizeModalSaveVersionBtn')?.addEventListener('click', function () { saveVersion(); showToast('Version saved', 'success'); });
    document.getElementById('humanizeNowBtn')?.addEventListener('click', function () {
      humanizeScoreModal?.classList.remove('active');
      humanizeWarningModal.classList.add('active');
    });
    document.getElementById('genInstructionsSaveVersionBtn')?.addEventListener('click', function () { saveVersion(); showToast('Version saved', 'success'); });

    // REDESIGN (Round 4 item 4c): Version History moved off the base of
    // Workspace entirely into its own modal, opened via the new icon after
    // Tools in editor-actions.
    const versionHistoryModal = document.getElementById('versionHistoryModal');
    document.getElementById('versionHistoryIconBtn')?.addEventListener('click', function () {
      if (!currentProject || !currentChapter) { showToast('Select a chapter and section first', 'error'); return; }
      updateVersionList();
      versionHistoryModal?.classList.add('active');
    });
    document.getElementById('closeVersionHistoryModal')?.addEventListener('click', function () { versionHistoryModal?.classList.remove('active'); });

    if (supervisorStrictness) supervisorStrictness.addEventListener('change', function (e) { supervisorPersonality.strictness = e.target.value; if (currentProject) { currentProject._supervisorPersonality = supervisorPersonality; saveToFirebase(); } });
    if (supervisorProfession) supervisorProfession.addEventListener('input', function (e) { supervisorPersonality.profession = e.target.value || 'Academic Supervisor'; if (currentProject) { currentProject._supervisorPersonality = supervisorPersonality; saveToFirebase(); } });

    if (advancedToggleBtn && advancedPanel) {
      advancedToggleBtn.addEventListener('click', function () {
        const open = advancedPanel.classList.toggle('open');
        advancedToggleBtn.setAttribute('aria-expanded', String(open));
        advancedToggleBtn.classList.toggle('open', open);
      });
    }

    function updateModificationArea() {
      if (!currentProject || !currentChapter) { if (modificationArea) modificationArea.style.display = 'none'; return; }
      const ch = getChaptersStructure()[currentChapter];
      let hasContent = false;
      if (ch && ch.sections && ch.sections.length > 0) {
        hasContent = currentProject.chapters && currentProject.chapters[currentChapter] && currentProject.chapters[currentChapter].sections && (currentProject.chapters[currentChapter].sections[currentSection] || '').trim().length > 0;
      } else if (ch) {
        hasContent = currentProject.chapters && currentProject.chapters[currentChapter] && (currentProject.chapters[currentChapter].content || '').trim().length > 0;
      }
      if (modificationArea) modificationArea.style.display = hasContent ? 'block' : 'none';
      if (aiGenerateSectionBtn) aiGenerateSectionBtn.innerHTML = hasContent ? '<i class="fas fa-redo"></i> Regenerate Section' : '<i class="fas fa-magic"></i> SI Generate This Section';
    }

    function updateChapterGenButton() {
      if (!aiGenerateChapterBtn) return;
      if (!canAccessResources()) { aiGenerateChapterBtn.style.display = 'none'; return; }
      if (!currentProject || !currentChapter) { aiGenerateChapterBtn.style.display = 'none'; return; }
      const ch = getChaptersStructure()[currentChapter];
      if (!ch || !ch.sections || ch.sections.length === 0) { aiGenerateChapterBtn.style.display = 'none'; return; }
      const allFilled = ch.sections.every(function (_, i) { return currentProject.chapters && currentProject.chapters[currentChapter] && currentProject.chapters[currentChapter].sections && (currentProject.chapters[currentChapter].sections[i] || '').trim().length > 0; });
      aiGenerateChapterBtn.style.display = 'inline-flex';
      if (chapterGenBtnText) chapterGenBtnText.textContent = allFilled ? 'Regenerate Entire Chapter' : 'Generate Entire Chapter';
    }

    if (wordCountSelect) {
      wordCountSelect.addEventListener('change', function () {
        if (wordCountSelect.value === 'custom') { customWordCountInput.style.display = 'inline-block'; customWordCountInput.focus(); }
        else customWordCountInput.style.display = 'none';
        if (currentProject) { currentProject.wordCountPref = wordCountSelect.value; if (wordCountSelect.value === 'custom') currentProject.customWordCount = parseInt(customWordCountInput.value) || 500; saveToFirebase(); }
      });
    }
    if (customWordCountInput) customWordCountInput.addEventListener('change', function () { if (currentProject) { currentProject.customWordCount = parseInt(customWordCountInput.value) || 500; saveToFirebase(); } });
    if (referenceStyleSelect) referenceStyleSelect.addEventListener('change', function () { if (currentProject) { currentProject.referenceStyle = referenceStyleSelect.value; saveToFirebase(); renderReferenceList('referenceListWorkspace'); renderReferenceList('referenceListTools'); } });

    function getTargetWordCount() {
      if (wordCountSelect.value === 'auto') return null;
      if (wordCountSelect.value === 'custom') { const c = parseInt(customWordCountInput ? customWordCountInput.value : 0, 10); if (c && c >= 100 && c <= 5000) return c; }
      return parseInt(wordCountSelect.value, 10) || 500;
    }
    function getReferenceStyle() { return referenceStyleSelect ? referenceStyleSelect.value : 'APA 7th'; }

    // =========================================================================
    // PROJECT MANAGEMENT (ported)
    // =========================================================================
    // Lists read the lightweight index only. First run for an account (no index
    // yet) builds it once from the full projects — transparent migration. A
    // daily background reconcile picks up projects created by older app
    // versions that don't maintain the index.
    const INDEX_RECONCILE_KEY = 'rehab_project_index_reconciled_';
    async function buildIndexFromFullProjects() {
      const snap = await database.ref('history/' + scopeUid + '/projects').once('value');
      const full = snap.val() || {};
      const idx = {};
      Object.keys(full).forEach(function (id) { idx[id] = indexEntryFrom(full[id]); });
      try { localStorage.setItem(INDEX_RECONCILE_KEY + scopeUid, String(Date.now())); } catch (e) {}
      return idx;
    }
    async function loadProjects() {
      if (!currentUser) return;
      try {
        const idxSnap = await database.ref('history/' + scopeUid + '/projectIndex').once('value');
        let idx = idxSnap.val();
        if (!idx) {
          idx = await buildIndexFromFullProjects();
          if (Object.keys(idx).length) database.ref('history/' + scopeUid + '/projectIndex').set(idx).catch(function () {});
        } else {
          let last = 0;
          try { last = parseInt(localStorage.getItem(INDEX_RECONCILE_KEY + scopeUid) || '0', 10); } catch (e) {}
          if (Date.now() - last > 24 * 3600 * 1000) {
            buildIndexFromFullProjects().then(function (full) {
              const missing = Object.keys(full).filter(function (id) { return !projects[id]; });
              const stale = Object.keys(projects).filter(function (id) { return !full[id]; });
              if (!missing.length && !stale.length) return;
              const upd = {};
              missing.forEach(function (id) { upd[id] = full[id]; projects[id] = full[id]; });
              stale.forEach(function (id) { upd[id] = null; delete projects[id]; });
              database.ref('history/' + scopeUid + '/projectIndex').update(upd).catch(function () {});
              updateProjectSelector();
              if (screens.projects && screens.projects.classList.contains('active')) renderProjectsListScreen();
            }).catch(function () {});
          }
        }
        projects = idx || {};
        updateProjectSelector();
      } catch (error) { reportError(error, 'project load'); }
    }

    function updateProjectSelector() {
      if (!currentProjectSelect) return;
      const ids = Object.keys(projects);
      if (ids.length === 0) { currentProjectSelect.innerHTML = '<option value="">No projects</option>'; return; }
      currentProjectSelect.innerHTML = ids.map(function (id) { return '<option value="' + id + '"' + (id === currentProjectId ? ' selected' : '') + '>' + escapeHtml(projects[id].title || 'Untitled') + '</option>'; }).join('');
    }

    async function switchToProject(id, opts) {
      opts = opts || {};
      if (!projects[id]) { showToast('Project not found', 'error'); return; }
      // Save the OUTGOING project in the background instead of awaiting it —
      // this used to block opening the NEW project on a full network round
      // trip for the old one (and, since saveToFirebase() has no timeout,
      // could leave the screen stuck indefinitely on a slow/stalled
      // connection — the "sometimes doesn't open at all" bug). The switch
      // below is a JS deprioritization only? — no: kicking off the write
      // and moving on is safe because saveToFirebase() reads its data from
      // the (still-current-at-call-time) `currentProject`/`currentProjectId`
      // closure variables synchronously before its first await, so
      // reassigning them on the next lines does not race with what gets
      // written.
      if (currentProjectId && currentProject) { saveCurrentSection(); saveToFirebase(); }
      // Full project data is loaded only now (the list holds index entries).
      let full;
      try {
        const snap = await database.ref('history/' + scopeUid + '/projects/' + id).once('value');
        full = snap.val();
      } catch (err) { reportError(err, 'project load'); return; }
      if (!full) { showToast('Project not found', 'error'); delete projects[id]; database.ref('history/' + scopeUid + '/projectIndex/' + id).remove().catch(function () {}); updateProjectSelector(); return; }
      await migrateVersionsOut(id, full);
      versionsCache = {};
      currentProjectId = id;
      currentProject = full;
      currentChapter = (currentProject.dashboard && currentProject.dashboard.lastOpenedChapter) || 'chapter1';
      currentSection = (currentProject.dashboard && currentProject.dashboard.lastOpenedSection) || 0;

      if (currentProject._supervisorPersonality) {
        supervisorPersonality = currentProject._supervisorPersonality;
        if (supervisorStrictness) supervisorStrictness.value = supervisorPersonality.strictness;
        if (supervisorProfession) supervisorProfession.value = supervisorPersonality.profession;
      }
      resources = [];
      if (currentProject.resources) {
        for (const rid in currentProject.resources) {
          if (currentProject.resources.hasOwnProperty(rid)) { const r = currentProject.resources[rid]; resources.push({ id: rid, name: r.name, analysis: r.analysis, uploadedAt: r.uploadedAt, size: r.size }); }
        }
      }
      renderResourceList();
      if (currentProject.wordCountPref && wordCountSelect) {
        wordCountSelect.value = currentProject.wordCountPref;
        if (currentProject.wordCountPref === 'custom') { customWordCountInput.style.display = 'inline-block'; customWordCountInput.value = currentProject.customWordCount || 500; }
        else customWordCountInput.style.display = 'none';
      }
      if (currentProject.referenceStyle && referenceStyleSelect) referenceStyleSelect.value = currentProject.referenceStyle;

      renderChapters(); loadSectionContent(); updateProjectSelector(); updateModificationArea(); updateVersionList();
      renderReferenceList('referenceListWorkspace');

      // Show the project right away from the already-loaded local `projects`
      // cache — chat history is a nice-to-have for the AI panel, not
      // something worth making the student wait on a network round trip to
      // see their own project (previously `await`ed here, so a slow/stalled
      // read blocked the screen switch below — the other half of the
      // "reopening a project takes forever / sometimes doesn't open at all"
      // bug, alongside the saveToFirebase() await removed above). Default to
      // the empty state immediately; loadChatHistory() replaces it once it
      // resolves, same as it always did.
      clearChatHistory();
      setProjectActive(true); // REDESIGN (item 3): reveal the tab layout now that a project is open
      switchScreen('dashboard');
      if (!opts.silent) showToast('Switched to "' + currentProject.title + '"', 'info');

      loadChatHistory();
    }

    // Signed out: ask to log in first, instead of letting the form fail with a permission error.
    function requireSignIn() {
      if (currentUser) return true;
      showToast('Log in to create and save your projects', 'info');
      document.getElementById('loginBtn')?.click();
      return false;
    }

    async function createNewProject() {
      if (!requireSignIn()) return;
      if (!canCreateProject()) {
        const daysLeft = getDaysUntilReset();
        showToast('No active plan: 1 project/month. You have used yours. Resets in ' + daysLeft + ' days. Upgrade for unlimited.', 'error', 6000);
        goToSubscription();
        return;
      }
      document.getElementById('projectCreateStep1').style.display = 'block';
      document.getElementById('projectCreateStep2').style.display = 'none';
      projectModal.classList.add('active');
      if (projectTitleInput) projectTitleInput.value = '';
      if (projectTypeSelect) projectTypeSelect.selectedIndex = 0;
      if (projectDeptSelect) projectDeptSelect.selectedIndex = 0;
      if (projectApproachSelect) projectApproachSelect.value = 'quantitative';
      if (projectOutlineType) projectOutlineType.value = 'default';
      if (customOutlineInput) customOutlineInput.value = '';
      if (projectTitleInput) projectTitleInput.focus();
    }

    if (nextToOutlineBtn) {
      nextToOutlineBtn.addEventListener('click', function () {
        const title = projectTitleInput ? projectTitleInput.value.trim() : '';
        if (!title) { showToast('Please enter a project title', 'error'); return; }
        if (projectOutlineType && projectOutlineType.value === 'custom') {
          if (!canUseCustomOutline()) { showToast('Custom outline requires Student plan or higher.', 'error'); goToSubscription(); return; }
          document.getElementById('projectCreateStep1').style.display = 'none';
          document.getElementById('projectCreateStep2').style.display = 'block';
          const approach = projectApproachSelect ? projectApproachSelect.value : 'quantitative';
          const defaultStruct = approach === 'qualitative' ? qualitativeChapters : quantitativeChapters;
          let outlineText = '';
          for (const key in defaultStruct) {
            if (!defaultStruct.hasOwnProperty(key)) continue;
            const ch = defaultStruct[key];
            outlineText += ch.title + '\n';
            if (ch.sections) ch.sections.forEach(function (s) { outlineText += '- ' + s + '\n'; });
            outlineText += '\n';
          }
          customOutlineInput.value = outlineText.trim();
        } else createProjectFromForm();
      });
    }
    if (backToStep1Btn) backToStep1Btn.addEventListener('click', function () { document.getElementById('projectCreateStep1').style.display = 'block'; document.getElementById('projectCreateStep2').style.display = 'none'; });

    function parseCustomOutline(text) {
      const chapters = {};
      let currentChapterKey = null, chapterIndex = 0;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed) continue;
        if (!trimmed.startsWith('-') && !trimmed.startsWith('*')) {
          chapterIndex++;
          currentChapterKey = 'chapter' + chapterIndex;
          chapters[currentChapterKey] = { title: trimmed, sections: [] };
        } else if (currentChapterKey && (trimmed.startsWith('-') || trimmed.startsWith('*'))) {
          const sectionName = trimmed.replace(/^[-*]\s*/, '').trim();
          if (sectionName) chapters[currentChapterKey].sections.push(sectionName);
        }
      }
      return Object.keys(chapters).length > 0 ? chapters : null;
    }

    async function createProjectFromForm() {
      const title = projectTitleInput ? projectTitleInput.value.trim() : '';
      if (!title) { showToast('Please enter a project title', 'error'); return; }
      const newProject = {
        title: title, type: projectTypeSelect ? projectTypeSelect.value : 'Undergraduate Project',
        department: projectDeptSelect ? projectDeptSelect.value : 'Occupational Therapy',
        approach: projectApproachSelect ? projectApproachSelect.value : 'quantitative',
        writingProfile: 'undergraduate', wordCountPref: 'auto', customWordCount: 500, referenceStyle: 'APA 7th',
        chapters: {}, _supervisorPersonality: supervisorPersonality,
        createdAt: firebase.database.ServerValue.TIMESTAMP, updatedAt: firebase.database.ServerValue.TIMESTAMP
      };
      if (projectOutlineType && projectOutlineType.value === 'custom') {
        const customText = customOutlineInput ? customOutlineInput.value.trim() : '';
        if (customText) { const parsed = parseCustomOutline(customText); if (parsed) newProject._customOutline = parsed; }
      }
      try {
        const ref = await database.ref('history/' + scopeUid + '/projects').push(newProject);
        const id = ref.key;
        newProject.id = id;
        newProject.createdAt = Date.now(); newProject.updatedAt = Date.now();
        updateProjectIndex(id, newProject);
        if (window.RehablixCenter) window.RehablixCenter.logActivity('project', 'Created project', newProject.title || 'Untitled project').catch(function () {});
        currentProjectId = id; currentProject = newProject; currentChapter = 'chapter1'; currentSection = 0;
        incrementProjectCount();
        projectModal.classList.remove('active');
        renderChapters(); loadSectionContent(); updateProjectSelector(); updateModificationArea(); clearChatHistory();
        setProjectActive(true);
        // the new project's dashboard sits under Setup, so Back leads into the project, not out of it
        switchScreen('dashboard');
        switchScreen('setup');
        document.querySelector('.setup-tab[data-setup-tab="Research"]')?.click();
        showToast('Project created. Fill in Research Setup, or tap "Draft with SI" to start from your title.', 'success', 5000);
      } catch (error) { reportError(error, 'project creation'); }
    }

    createProjectBtn.addEventListener('click', createProjectFromForm);
    if (closeProjectModalBtn) closeProjectModalBtn.addEventListener('click', function () { projectModal.classList.remove('active'); });
    if (newProjectBtn) newProjectBtn.addEventListener('click', createNewProject);
    if (currentProjectSelect) currentProjectSelect.addEventListener('change', function (e) { if (e.target.value && e.target.value !== currentProjectId) switchToProject(e.target.value); });
    if (projectModal) projectModal.addEventListener('click', function (e) { if (e.target === projectModal) projectModal.classList.remove('active'); });

    // =========================================================================
    // RESOURCE UPLOAD & MANAGEMENT (ported)
    // =========================================================================
    if (resourceFileInput) {
      resourceFileInput.addEventListener('change', async function () {
        if (!canAccessResources()) { showToast('Resource upload requires Student plan or higher.', 'error'); goToSubscription(); return; }
        const files = resourceFileInput.files;
        if (!files.length) return;
        if (uploadStatus) uploadStatus.textContent = 'Processing...';
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          try {
            const text = await readFileAsText(file);
            const analysis = await analyzeResource(text, file.name);
            const resourceData = { name: file.name, analysis: analysis, uploadedAt: Date.now(), size: file.size };
            const ref = await database.ref('history/' + scopeUid + '/projects/' + currentProjectId + '/resources').push(resourceData);
            resources.push({ id: ref.key, name: resourceData.name, analysis: resourceData.analysis, uploadedAt: resourceData.uploadedAt, size: resourceData.size });
            if (!currentProject.resources) currentProject.resources = {};
            currentProject.resources[ref.key] = resourceData;
          } catch (error) { reportError(error, 'resource upload'); showToast('Failed to process ' + file.name, 'error'); }
        }
        if (uploadStatus) uploadStatus.textContent = 'Uploaded ' + resources.length + ' resource(s)';
        renderResourceList();
        showToast('Resources processed successfully', 'success');
      });
    }

    async function analyzeResource(text, fileName) {
      const systemPrompt = 'You are an academic research analyzer. Analyze the following document and extract:\n1. Key findings and conclusions\n2. Methodology used (if applicable)\n3. Important statistics, numbers, and data points\n4. Theoretical frameworks referenced\n5. Key authors and citations\n6. Relevance to healthcare/medical research\nProvide a detailed, structured summary that can be used as reference for academic writing.';
      try {
        // the model chosen on any page (js/model-choice.js); this page's DeepSeek client if that is unavailable
        let cfg = window.RehablixModelChoice ? await window.RehablixModelChoice.resolve() : null;
        if (!cfg) { if (!aiConfig.token) await fetchTokens(); cfg = { token: aiConfig.token, endpoint: aiConfig.endpoint, model: aiConfig.model, maxTokens: 1500 }; }
        const response = await fetch(cfg.endpoint.replace(/\/$/, '') + '/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.token },
          body: JSON.stringify({ model: cfg.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: 'Document: ' + fileName + '\n\nContent: ' + text.substring(0, 8000) }], max_tokens: Math.min(1500, cfg.maxTokens || 1500), temperature: 0.4 })
        });
        if (!response.ok) throw new Error('Analysis API error');
        const data = await response.json();
        return data.choices[0].message.content;
      } catch (error) {
        console.warn('AI analysis failed, using basic extraction:', error);
        return 'Document: ' + fileName + '\nLength: ' + text.length + ' characters\nFirst 500 chars: ' + text.substring(0, 500) + '...';
      }
    }

    function renderResourceList() {
      if (!resourceList) return;
      if (resources.length === 0) { resourceList.innerHTML = '<div class="empty-state" style="padding:1.5rem;"><i class="bx bx-cloud-upload"></i><p style="font-size:0.85rem;">No resources uploaded</p><small>Upload articles, journals, or past projects for SI reference</small></div>'; return; }
      resourceList.innerHTML = resources.map(function (r, i) {
        return '<div class="resource-item"><div class="file-icon"><i class="fas fa-file-alt"></i></div>' +
          '<div class="file-info"><div class="file-name">' + escapeHtml(r.name) + '</div><div class="file-date">' + new Date(r.uploadedAt).toLocaleDateString() + '</div></div>' +
          '<button class="delete-resource-btn" data-index="' + i + '" title="Remove resource"><i class="fas fa-times"></i></button></div>';
      }).join('');
      document.querySelectorAll('.delete-resource-btn').forEach(function (btn) {
        btn.addEventListener('click', async function (e) {
          const index = parseInt(e.target.closest('.delete-resource-btn').dataset.index);
          const resource = resources[index];
          if (confirm('Remove "' + resource.name + '"?')) {
            try {
              if (resource.id) { await database.ref('history/' + scopeUid + '/projects/' + currentProjectId + '/resources/' + resource.id).remove(); if (currentProject && currentProject.resources) delete currentProject.resources[resource.id]; }
              resources.splice(index, 1); renderResourceList(); showToast('Resource removed', 'success');
            } catch (error) { reportError(error, 'resource delete'); }
          }
        });
      });
    }

    if (resourceToggleBtn) {
      resourceToggleBtn.addEventListener('click', function () {
        if (!canAccessResources()) { showToast('Resources require Student plan or higher.', 'error'); goToSubscription(); return; }
        chaptersList.style.display = 'none'; resourcesPanel.style.display = 'flex'; document.getElementById('projectSelector').style.display = 'none';
      });
    }
    if (backToChaptersBtn) backToChaptersBtn.addEventListener('click', function () { resourcesPanel.style.display = 'none'; chaptersList.style.display = ''; document.getElementById('projectSelector').style.display = ''; });

    // =========================================================================
    // CHAPTERS & SECTIONS (ported, + Prev/Next nav + progress bar REDESIGN)
    // =========================================================================
    function renderChapters() {
      if (!currentProject || !chaptersList) return;
      const chStruct = getChaptersStructure();
      let html = '';
      for (const key in chStruct) {
        if (!chStruct.hasOwnProperty(key)) continue;
        const ch = chStruct[key];
        html += '<div class="chapter-item' + (currentChapter === key ? ' active' : '') + '" data-chapter="' + key + '">' +
          '<i class="fas fa-' + (currentChapter === key ? 'folder-open' : 'folder') + '"></i>' +
          '<span class="chapter-title-text">' + escapeHtml(ch.title) + '</span>' +
          '<div class="edit-controls"><button class="edit-outline-btn" data-action="rename-chapter" data-chapter="' + key + '" title="Rename"><i class="fas fa-pencil-alt"></i></button>' +
          '<button class="edit-outline-btn" data-action="delete-chapter" data-chapter="' + key + '" title="Delete"><i class="fas fa-trash"></i></button></div></div>';
        if (currentChapter === key && ch.sections && ch.sections.length > 0) {
          ch.sections.forEach(function (sec, i) {
            const hasContent = currentProject.chapters && currentProject.chapters[key] && currentProject.chapters[key].sections && currentProject.chapters[key].sections[i] && currentProject.chapters[key].sections[i].trim().length > 0;
            html += '<div class="section-item' + (currentSection === i ? ' active' : '') + '" data-section="' + i + '" data-chapter="' + key + '">' +
              '<i class="fas fa-' + (hasContent ? 'check-circle' : 'circle') + '" style="font-size: 0.6rem; opacity: ' + (hasContent ? '1' : '0.3') + ';"></i>' +
              '<span class="section-title-text">' + escapeHtml(sec) + '</span>' +
              '<div class="edit-controls"><button class="edit-outline-btn" data-action="rename-section" data-chapter="' + key + '" data-section="' + i + '" title="Rename"><i class="fas fa-pencil-alt"></i></button>' +
              '<button class="edit-outline-btn" data-action="delete-section" data-chapter="' + key + '" data-section="' + i + '" title="Delete"><i class="fas fa-trash"></i></button></div></div>';
          });
          html += '<div class="section-item add-section-item" data-action="add-section" data-chapter="' + key + '"><i class="fas fa-plus-circle" style="color: var(--project-accent);"></i> Add Section</div>';
        } else if (currentChapter === key) {
          const hasContent = currentProject.chapters && currentProject.chapters[key] && currentProject.chapters[key].content && currentProject.chapters[key].content.trim().length > 0;
          html += '<div class="section-item active" data-section="0" data-chapter="' + key + '"><i class="fas fa-' + (hasContent ? 'check-circle' : 'circle') + '" style="font-size: 0.6rem; opacity: ' + (hasContent ? '1' : '0.3') + ';"></i> Content</div>';
        }
      }
      chaptersList.innerHTML = html;

      document.querySelectorAll('.chapter-item').forEach(function (el) {
        el.addEventListener('click', function (e) {
          if (e.target.closest('.edit-outline-btn') || e.target.closest('.edit-controls')) return;
          const ch = e.target.closest('.chapter-item').dataset.chapter;
          if (currentChapter === ch) return;
          saveCurrentSection(); saveToFirebase();
          currentChapter = ch; currentSection = 0;
          loadSectionContent(); renderChapters(); updateModificationArea(); updateVersionList(); updateChapterGenButton();
          persistLastOpened();
          // REDESIGN (item 4): section clicks already closed the drawer on
          // mobile — chapter clicks silently didn't, leaving the drawer
          // covering the very chapter/section just navigated to.
          if (window.innerWidth < 992) chaptersSidebar.classList.remove('open');
        });
      });
      document.querySelectorAll('.section-item:not(.add-section-item)').forEach(function (el) {
        el.addEventListener('click', function (e) {
          if (e.target.closest('.edit-outline-btn') || e.target.closest('.edit-controls')) return;
          const sec = parseInt(e.target.closest('.section-item').dataset.section);
          if (currentSection === sec) return;
          saveCurrentSection(); saveToFirebase();
          currentSection = sec;
          loadSectionContent(); renderChapters(); updateModificationArea(); updateVersionList();
          persistLastOpened();
          if (window.innerWidth < 992) chaptersSidebar.classList.remove('open');
        });
      });
      updateChapterGenButton();
      updateSectionNav();
    }

    function persistLastOpened() {
      if (!currentUser || !currentProjectId) return;
      database.ref('history/' + scopeUid + '/projects/' + currentProjectId + '/dashboard').update({
        lastOpenedChapter: currentChapter, lastOpenedSection: currentSection
      }).catch(function () {});
    }

    // REDESIGN: Prev/Next section navigation across the whole flattened
    // outline, and the slim chapter/section progress bar in Workspace's header.
    function updateSectionNav() {
      const flat = flattenSections();
      const idx = flat.findIndex(function (f) { return f.chapterKey === currentChapter && f.sectionIndex === currentSection; });
      if (prevSectionBtn) prevSectionBtn.disabled = idx <= 0;
      if (nextSectionBtn) nextSectionBtn.disabled = idx === -1 || idx >= flat.length - 1;

      const ch = getChaptersStructure()[currentChapter];
      if (ch && ch.sections && ch.sections.length) {
        const filled = ch.sections.filter(function (_, i) { return getSectionContent(currentChapter, i).trim().length > 20; }).length;
        if (workspaceProgressFill) workspaceProgressFill.style.width = Math.round((filled / ch.sections.length) * 100) + '%';
        if (workspaceProgressLabel) workspaceProgressLabel.textContent = filled + '/' + ch.sections.length + ' sections';
      } else {
        if (workspaceProgressFill) workspaceProgressFill.style.width = getSectionContent(currentChapter, 0).trim().length > 20 ? '100%' : '0%';
        if (workspaceProgressLabel) workspaceProgressLabel.textContent = '';
      }

      // REDESIGN (item 4): Project AI's actions operate on whatever chapter/
      // section was last opened in Workspace, but the panel itself now lives
      // on the Review screen where the editor isn't visible — this keeps
      // that implicit target legible instead of hidden.
      const contextText = document.getElementById('projAIContextText');
      if (contextText && ch) {
        const sectionName = ch.sections && ch.sections.length ? ch.sections[currentSection] : ch.title;
        contextText.textContent = 'Working on: ' + ch.title + (ch.sections && ch.sections.length ? ' — ' + sectionName : '');
      }
    }

    function goToFlatIndex(idx) {
      const flat = flattenSections();
      if (idx < 0 || idx >= flat.length) return;
      saveCurrentSection(); saveToFirebase();
      currentChapter = flat[idx].chapterKey; currentSection = flat[idx].sectionIndex;
      loadSectionContent(); renderChapters(); updateModificationArea(); updateVersionList(); persistLastOpened();
    }
    if (prevSectionBtn) prevSectionBtn.addEventListener('click', function () { const flat = flattenSections(); const idx = flat.findIndex(function (f) { return f.chapterKey === currentChapter && f.sectionIndex === currentSection; }); goToFlatIndex(idx - 1); });
    if (nextSectionBtn) nextSectionBtn.addEventListener('click', function () { const flat = flattenSections(); const idx = flat.findIndex(function (f) { return f.chapterKey === currentChapter && f.sectionIndex === currentSection; }); goToFlatIndex(idx + 1); });

    chaptersList.addEventListener('click', async function (e) {
      const btn = e.target.closest('.edit-outline-btn');
      if (!btn && !e.target.closest('.add-section-item')) return;
      if (e.target.closest('.add-section-item')) {
        const addChKey = e.target.closest('.add-section-item').dataset.chapter;
        const newName = prompt('New section name:');
        if (newName && newName.trim()) { ensureCustomOutline(); currentProject._customOutline[addChKey].sections.push(newName.trim()); await saveToFirebase(); renderChapters(); showToast('Section added', 'success'); }
        return;
      }
      const action = btn.dataset.action, chKey = btn.dataset.chapter, secIndex = btn.dataset.section ? parseInt(btn.dataset.section) : null;
      if (action === 'rename-chapter') {
        const ch = getChaptersStructure()[chKey];
        const newTitle = prompt('Rename chapter:', ch ? ch.title : '');
        if (newTitle && newTitle.trim()) { ensureCustomOutline(); currentProject._customOutline[chKey].title = newTitle.trim(); await saveToFirebase(); renderChapters(); showToast('Chapter renamed', 'success'); }
      } else if (action === 'delete-chapter') {
        const ch = getChaptersStructure()[chKey];
        if (confirm('Delete chapter "' + (ch ? ch.title : '') + '" and all its content?')) {
          ensureCustomOutline(); delete currentProject._customOutline[chKey];
          if (currentProject.chapters && currentProject.chapters[chKey]) delete currentProject.chapters[chKey];
          await saveToFirebase({ chapterKey: chKey });
          const keys = Object.keys(getChaptersStructure());
          if (currentChapter === chKey) currentChapter = keys[0] || 'chapter1';
          currentSection = 0; renderChapters(); loadSectionContent(); showToast('Chapter deleted', 'success');
        }
      } else if (action === 'rename-section') {
        const ch = getChaptersStructure()[chKey];
        const newName = prompt('Rename section:', ch ? ch.sections[secIndex] : '');
        if (newName && newName.trim()) { ensureCustomOutline(); currentProject._customOutline[chKey].sections[secIndex] = newName.trim(); await saveToFirebase(); renderChapters(); showToast('Section renamed', 'success'); }
      } else if (action === 'delete-section') {
        if (confirm('Delete this section and its content?')) {
          ensureCustomOutline(); currentProject._customOutline[chKey].sections.splice(secIndex, 1);
          if (currentProject.chapters && currentProject.chapters[chKey] && currentProject.chapters[chKey].sections) currentProject.chapters[chKey].sections.splice(secIndex, 1);
          await saveToFirebase({ chapterKey: chKey });
          if (currentSection >= currentProject._customOutline[chKey].sections.length) currentSection = Math.max(0, currentProject._customOutline[chKey].sections.length - 1);
          renderChapters(); loadSectionContent(); showToast('Section deleted', 'success');
        }
      }
    });

    function ensureCustomOutline() { if (!currentProject._customOutline) currentProject._customOutline = JSON.parse(JSON.stringify(getChaptersStructure())); }

    function loadSectionContent() {
      if (!currentProject || !currentChapter) return;
      const ch = getChaptersStructure()[currentChapter];
      if (ch && ch.sections && ch.sections.length > 0) {
        currentSectionTitle.textContent = ch.sections[currentSection] || ch.title;
        sectionEditor.innerHTML = (currentProject.chapters && currentProject.chapters[currentChapter] && currentProject.chapters[currentChapter].sections) ? (currentProject.chapters[currentChapter].sections[currentSection] || '') : '';
      } else if (ch) {
        currentSectionTitle.textContent = ch.title;
        sectionEditor.innerHTML = (currentProject.chapters && currentProject.chapters[currentChapter]) ? (currentProject.chapters[currentChapter].content || '') : '';
      }
      // REDESIGN (item 3): auto-focusing the contenteditable on every section
      // switch (chapter/section click, Prev/Next) used to pop the on-screen
      // keyboard open on touch devices even when the user only meant to
      // navigate — skip it there; desktop keeps the convenience since focus
      // never summons a keyboard.
      const isTouchDevice = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
      if (!isTouchDevice) sectionEditor.focus();
      updateModificationArea(); updateVersionList(); updateSectionNav();
      setTimeout(displayHumanizationScore, 300);
      if (writingProfileSelect && currentProject && currentProject.writingProfile) writingProfileSelect.value = currentProject.writingProfile;
    }

    function saveCurrentSection() {
      if (!currentProject || !currentChapter) return;
      if (!currentProject.chapters) currentProject.chapters = {};
      if (!currentProject.chapters[currentChapter]) currentProject.chapters[currentChapter] = { sections: {} };
      const ch = getChaptersStructure()[currentChapter];
      if (ch && ch.sections && ch.sections.length > 0) {
        if (!currentProject.chapters[currentChapter].sections) currentProject.chapters[currentChapter].sections = {};
        currentProject.chapters[currentChapter].sections[currentSection] = sectionEditor.innerHTML;
      } else if (ch) currentProject.chapters[currentChapter].content = sectionEditor.innerHTML;
      currentProject.updatedAt = firebase.database.ServerValue.TIMESTAMP;
      unsavedChanges = false; updateUnsavedIndicator();
    }

    // PERSISTENCE (reworked): writes only what changed instead of rewriting the
    // whole project. By default the open section + the project's settings;
    // opts.chapterKey rewrites one chapter (outline edits); opts.sections =
    // [[chapterKey, sectionIndex], …] writes those sections (AI fixes);
    // opts.fullChapters rewrites every chapter (rarely needed). Versions no
    // longer live in the project record at all (see VERSION HISTORY).
    function sectionValue(chKey, secIndex) {
      const ch = getChaptersStructure()[chKey];
      const data = (currentProject.chapters || {})[chKey] || {};
      if (ch && ch.sections && ch.sections.length) {
        const v = data.sections ? data.sections[secIndex] : undefined;
        return ['chapters/' + chKey + '/sections/' + secIndex, v === undefined ? null : v];
      }
      return ['chapters/' + chKey + '/content', data.content === undefined ? null : data.content];
    }

    async function saveToFirebase(opts) {
      opts = opts || {};
      if (!currentUser || !currentProjectId || !currentProject) return;
      // Captured now: callers may switch projects before this write resolves.
      const pid = currentProjectId, proj = currentProject;
      try {
        const updateData = {
          writingProfile: currentProject.writingProfile || 'undergraduate', wordCountPref: currentProject.wordCountPref || 'auto',
          customWordCount: currentProject.customWordCount || 500, referenceStyle: currentProject.referenceStyle || 'APA 7th',
          _supervisorPersonality: supervisorPersonality, updatedAt: firebase.database.ServerValue.TIMESTAMP
        };
        if (currentProject._customOutline) updateData._customOutline = currentProject._customOutline;
        if (opts.fullChapters) updateData.chapters = currentProject.chapters || {};
        else {
          if (opts.chapterKey) updateData['chapters/' + opts.chapterKey] = (currentProject.chapters || {})[opts.chapterKey] || null;
          const targets = (opts.sections || []).slice();
          if (currentChapter && opts.chapterKey !== currentChapter) targets.push([currentChapter, currentSection]);
          targets.forEach(function (t) {
            if (opts.chapterKey && t[0] === opts.chapterKey) return;
            const kv = sectionValue(t[0], t[1]);
            updateData[kv[0]] = kv[1];
          });
        }
        await database.ref('history/' + scopeUid + '/projects/' + pid).update(updateData);
        updateProjectIndex(pid, proj);
        if (pid === currentProjectId) { unsavedChanges = false; updateUnsavedIndicator(); }
      } catch (error) { reportError(error, 'save'); }
    }

    // Lightweight list index: history/{scope}/projectIndex/{id} — the project
    // list and selector read only this; full data loads when a project opens.
    function indexEntryFrom(p) {
      const saved = currentProject; currentProject = p;
      let pct = 0;
      try { pct = computeProgress(p).pct; } catch (e) { pct = 0; }
      currentProject = saved;
      return {
        title: p.title || '', type: p.type || '', department: p.department || '', approach: p.approach || 'quantitative',
        createdAt: typeof p.createdAt === 'number' ? p.createdAt : null,
        updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : (typeof p.createdAt === 'number' ? p.createdAt : null),
        progressPct: pct
      };
    }
    function updateProjectIndex(id, p) {
      id = id || currentProjectId; p = p || currentProject;
      if (!id || !p || !scopeUid) return;
      const entry = indexEntryFrom(p);
      projects[id] = Object.assign({}, entry, { updatedAt: Date.now() });
      database.ref('history/' + scopeUid + '/projectIndex/' + id).update(Object.assign({}, entry, { updatedAt: firebase.database.ServerValue.TIMESTAMP })).catch(function () {});
    }

    // =========================================================================
    // AUTOSAVE & UNSAVED CHANGES (ported)
    // =========================================================================
    sectionEditor.addEventListener('input', function () {
      unsavedChanges = true; updateUnsavedIndicator();
      clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(async function () { saveCurrentSection(); await saveToFirebase(); displayHumanizationScore(); updateSectionNav(); renderChapters(); logActivity('section_saved', currentSectionTitle.textContent); }, 3000);
    });
    sectionEditor.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveCurrentSection(); saveToFirebase(); updateSectionNav(); renderChapters(); showToast('Saved', 'success', 1500); } });
    function updateUnsavedIndicator() { if (unsavedOverlay) unsavedOverlay.style.display = unsavedChanges ? 'block' : 'none'; }
    if (saveNowBtn) saveNowBtn.addEventListener('click', async function () { saveCurrentSection(); await saveToFirebase(); updateSectionNav(); renderChapters(); showToast('Saved successfully', 'success'); });
    // REDESIGN fix: this button's click listener was never wired during the
    // router migration — autosave still worked (the input listener below),
    // but the explicit Save button silently did nothing.
    if (saveSectionBtn) saveSectionBtn.addEventListener('click', async function () { saveCurrentSection(); await saveToFirebase(); updateSectionNav(); renderChapters(); showToast('Saved successfully', 'success'); });
    const beforeUnloadHandler = function (e) { if (unsavedChanges) { e.preventDefault(); e.returnValue = 'You have unsaved changes. Are you sure you want to leave?'; return e.returnValue; } };
    window.addEventListener('beforeunload', beforeUnloadHandler);
    cleanupFns.push(function () { window.removeEventListener('beforeunload', beforeUnloadHandler); });

    // =========================================================================
    // AI GENERATION (ported near-verbatim; it now writes with the model chosen
    // on any page, js/model-choice.js, and keeps the legacy DeepSeek client
    // only as the fallback)
    // =========================================================================
    function updateProgressStage(message, detail) { if (progressStage) progressStage.textContent = message; if (progressDetail) progressDetail.textContent = detail || ''; }
    function updateProgressBar(percent) { if (progressBarFill) progressBarFill.style.width = Math.min(100, Math.max(0, percent)) + '%'; }

    // Writes with the model chosen on any page (js/model-choice.js); this page's DeepSeek client if that is unavailable.
    async function callAIWithCancel(systemPrompt, userPrompt, maxTokens, temp, topP, freqPenalty, presPenalty) {
      let cfg = window.RehablixModelChoice ? await window.RehablixModelChoice.resolve() : null;
      if (!cfg) {
        if (!aiConfig.token && !(await fetchTokens())) throw new Error('SI service not configured');
        cfg = { token: aiConfig.token, endpoint: aiConfig.endpoint, model: aiConfig.model, maxTokens: maxTokens };
      }
      const response = await fetch(cfg.endpoint.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.token },
        body: JSON.stringify({ model: cfg.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], max_tokens: Math.min(maxTokens, cfg.maxTokens || maxTokens), temperature: temp, top_p: topP, frequency_penalty: freqPenalty, presence_penalty: presPenalty }),
        signal: aiAbortController.signal
      });
      if (!response.ok) { const errData = await response.json().catch(function () { return {}; }); throw new Error((errData.error && errData.error.message) || 'API error (' + response.status + ')'); }
      return response.json();
    }

    function cleanAIResponse(raw) {
      let cleaned = raw.replace(/```html?/g, '').replace(/```/g, '').trim();
      if (typeof marked !== 'undefined' && (cleaned.includes('##') || cleaned.includes('**') || cleaned.includes('- '))) cleaned = marked.parse(cleaned);
      return cleaned;
    }

    // A generated section often opens with its own title as a heading; the section title is already shown
    // (and exported) above it, so that first heading is dropped when it just repeats the title.
    function stripLeadingTitle(html, title) {
      const m = String(html || '').match(/^\s*<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>\s*/i);
      // ("Statement of the Problem" = "Statement of Problem": small linking words are ignored)
      const norm = function (s) { return String(s || '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|of|a|an|and|to|for|in)\b/g, ' ').replace(/\s+/g, ' ').trim(); };
      if (m && title && norm(extractPlainText(m[1])) === norm(title)) return html.slice(m[0].length);
      return html;
    }

    // Long sections are rewritten piece by piece (split between paragraphs, headings, lists and tables),
    // so no rewrite step can drop the end of a section when a reply runs out of room. A piece whose rewrite
    // comes back cut off, empty, or under half its length is kept exactly as it was.
    const PIECE_CHARS = 5000;
    function splitHtmlPieces(html) {
      const blocks = String(html || '').replace(/(<\/(?:p|h[1-6]|ul|ol|table|blockquote)>)/gi, '$1\u0000').split('\u0000').filter(function (b) { return b.trim(); });
      const pieces = []; let cur = '';
      blocks.forEach(function (b) { if (cur && cur.length + b.length > PIECE_CHARS) { pieces.push(cur); cur = ''; } cur += b; });
      if (cur.trim()) pieces.push(cur);
      return pieces.length ? pieces : [String(html || '')];
    }
    function plainLength(html) { return extractPlainText(html).replace(/\s+/g, ' ').trim().length; }
    // rewrite(piece, i, n) → { text, finish } (finish = the reply's finish_reason). Returns { html, kept, pieces }.
    async function rewriteInPieces(html, rewrite) {
      const pieces = splitHtmlPieces(html), out = [];
      let kept = 0;
      for (let i = 0; i < pieces.length; i++) {
        let r = null;
        try { r = await rewrite(pieces[i], i, pieces.length); } catch (e) { if (e && e.name === 'AbortError') throw e; console.warn('[project] rewrite of a part failed, kept as it was:', e); }
        const text = r && r.text ? cleanAIResponse(r.text) : '';
        const ok = text && !/EMPTY_SOURCE/.test(text) && r.finish !== 'length' && plainLength(text) >= plainLength(pieces[i]) * 0.5;
        if (ok) out.push(text); else { out.push(pieces[i]); kept++; }
      }
      return { html: out.join('\n'), kept: kept, pieces: pieces.length };
    }
    const partNote = function (i, n) { return n > 1 ? '\n(This is part ' + (i + 1) + ' of ' + n + ' of a longer section: work on this part only. Do not add an introduction, a summary or a conclusion that is not already in it.)' : ''; };
    const replyOf = function (json) { const c = json && json.choices && json.choices[0]; return { text: (c && c.message && c.message.content) || '', finish: c && c.finish_reason }; };

    async function generateSection(sectionName, chapterKey, sectionIndex) {
      if (!aiConfig.token) { const ok = await fetchTokens(); if (!ok) throw new Error('SI service not configured'); }
      const tone = aiToneSelect ? aiToneSelect.value : 'imperfect';
      const modification = modificationInput ? modificationInput.value.trim() : '';
      const approach = currentProject.approach === 'qualitative' ? 'qualitative (single case study / small sample / interview-based)' : 'quantitative (multiple cases / statistics / questionnaires)';
      const profile = currentProject.writingProfile || 'undergraduate';
      const contextSummary = buildWorkspaceContext(false); // REDESIGN: now includes researchSetup + references
      const profileGuidance = getProfileGuidance(profile);
      const humanizationRules = buildHumanizationPrompt();
      const targetWordCount = getTargetWordCount();
      const referenceStyle = getReferenceStyle();
      const tokenMap = { 300: 3000, 500: 4500, 1000: 7000, 2000: 12000, 5000: 18000 };
      let maxTokensPass1 = 10000;
      if (targetWordCount) maxTokensPass1 = tokenMap[targetWordCount] || Math.max(2500, Math.min(18000, Math.round(targetWordCount * 4)));
      let wordInstruction = targetWordCount ? ('TARGET LENGTH: approximately ' + targetWordCount + ' words.') : 'Determine the appropriate length based on the section and context. Write as much as needed to thoroughly cover the topic. No strict word limit.';
      // Each section stays in its own lane: the other sections of this chapter are named so their content
      // (e.g. the aim and research questions, which have their own sections) is not written here as well.
      const chSiblings = ((getChaptersStructure()[chapterKey] || {}).sections || []).filter(function (s) { return s !== sectionName; });
      const scopeNote = chSiblings.length ? '\nSECTION SCOPE: this chapter also has these separate sections: ' + chSiblings.join('; ') + '. Write ONLY what belongs under "' + sectionName + '". Do not write out the content of those other sections (you may refer to them briefly).' : '';

      let content = '';
      const pass1SystemPrompt = 'You are a knowledgeable academic writer specializing in healthcare education.\nWrite well-structured academic content with proper HTML formatting and ' + referenceStyle + ' citations.\nYou MUST stay strictly on the provided project topic and use ONLY the facts, numbers, and methodology details provided in the context.\nNEVER invent sample sizes, participant counts, statistics, or instruments not mentioned in the context.\n' + (resources.length > 0 ? 'Use the uploaded resources as authoritative sources. Cite them where relevant.\n' : '') + PUNCTUATION_RULES + '\nUse ONLY standard punctuation: periods, commas, colons, semicolons, question marks. Never use dashes or special characters.';
      const pass1UserPrompt = 'CONSISTENCY RULES - NON-NEGOTIABLE:\n- The project title is "' + currentProject.title + '". Every sentence must relate to THIS specific topic.\n- Use ONLY the sample sizes, participant counts, and statistics stated in the context below. Do not invent new ones.\n- If Chapter 3 context specifies a sample of n=X participants, ALL results and discussion must use n=X.\n- Do not introduce new research instruments, designs, or theoretical frameworks not already established.\n- Maintain exactly the same research approach (' + approach + ') throughout.\n\nWrite the "' + sectionName + '" section for:\nPROJECT: "' + currentProject.title + '"\nDEPARTMENT: ' + currentProject.department + '\n\nFULL PROJECT CONTEXT (all established facts, follow exactly):\n' + contextSummary + '\n\nRESEARCH APPROACH: ' + approach + '\nREFERENCE STYLE: ' + referenceStyle + ', use proper in-text citations throughout.\n' + wordInstruction + scopeNote + '\n' + (modification ? '\nSPECIAL INSTRUCTIONS FROM STUDENT: ' + modification + '\n' : '') + '\nWrite comprehensive, well-argued academic content using HTML structure (h2/h3 headings, paragraphs, lists).\nReturn ONLY the HTML. No markdown fences. No preamble. Do not leave the response empty.';

      let attempts = 0;
      while (attempts < 3) {
        const pass1Response = await callAIWithCancel(pass1SystemPrompt, pass1UserPrompt, maxTokensPass1, 0.6, 0.9, 0.1, 0.1);
        content = cleanAIResponse(pass1Response.choices[0].message.content);
        if (content && content.length > 100 && /<\/?p[ >]/.test(content)) break;
        attempts++;
      }
      if (!content || content.length < 50) throw new Error('SI failed to generate a valid draft after 3 attempts. Please try again.');

      // (passes 2 and 3 work on the whole draft, part by part: nothing after a length limit is dropped)
      if (humanizeMode) {
        const pass2SystemPrompt = 'You are an expert at rewriting academic text to sound naturally human-written.\nYour job is to change STYLE and VOICE only, never change facts, numbers, sample sizes, statistics, or citations.\nWrite in first-person student voice.\n' + PUNCTUATION_RULES;
        const pass2 = await rewriteInPieces(content, async function (piece, i, n) {
          const pass2UserPrompt = 'REWRITE the text below to sound like a real ' + profile + ' healthcare student wrote it.\nThe project is about: "' + currentProject.title + '"\n\nSTRICT RULES:\n- Change ONLY the writing style, voice, and phrasing.\n- Do NOT change any numbers, statistics, sample sizes, participant counts, or citations.\n- Preserve all ' + referenceStyle + ' citations exactly as written.\n- Keep about the same length.\n\nWRITING PROFILE:\n' + profileGuidance + '\n\nWRITING TONE: ' + tone + '\n\n' + humanizationRules + partNote(i, n) + '\n\nTEXT TO REWRITE:\n' + piece + '\n\nReturn ONLY the rewritten HTML. No markdown fences. If you see the text is empty, respond with "EMPTY_SOURCE".';
          return replyOf(await callAIWithCancel(pass2SystemPrompt, pass2UserPrompt, 4000, 0.75, 0.92, 0.25, 0.2));
        });
        if (pass2.kept) console.warn('[project] natural-voice pass: ' + pass2.kept + ' of ' + pass2.pieces + ' parts kept as drafted');
        content = pass2.html;
      }

      const pass3SystemPrompt = 'You are a careful academic editor. Polish text for quality while preserving all facts, numbers, and the natural human voice.\n' + PUNCTUATION_RULES + '\nEnsure all punctuation is natural. Remove any dashes or special characters.';
      const pass3 = await rewriteInPieces(content, async function (piece, i, n) {
        const pass3UserPrompt = 'POLISH the text below. Fix grammar and formatting. Preserve all facts and tone.\n\nRULES:\n- Fix any awkward sentences or unclear transitions.\n- Ensure proper HTML heading structure (h2 for main sections, h3 for subsections).\n- Do NOT increase formality.\n- Do NOT change any numbers, sample sizes, statistics, or citations.\n- Remove any repeated phrases.\n- Use only natural punctuation.\n- Keep about the same length: do not shorten or summarise.\n- All ' + referenceStyle + ' citations must be correctly formatted.' + partNote(i, n) + '\n\nTEXT TO POLISH:\n' + piece + '\n\nReturn ONLY the polished HTML. If the text appears empty, reply with "EMPTY_SOURCE".';
        return replyOf(await callAIWithCancel(pass3SystemPrompt, pass3UserPrompt, 4000, 0.4, 0.9, 0.1, 0.1));
      });
      if (pass3.kept) console.warn('[project] polish pass: ' + pass3.kept + ' of ' + pass3.pieces + ' parts kept as drafted');
      return stripLeadingTitle(pass3.html, sectionName);
    }

    // REDESIGN (item 7): a lightweight "any instructions?" prompt shown
    // before every generate/regenerate, instead of relying on the student
    // to discover the (still-present, for edits mid-draft) Modification
    // Instructions field buried in Workspace's Advanced panel. Resolves to
    // the entered text (already written into modificationInput so the
    // existing generateSection()/prompt-building code needs no changes),
    // or '' if skipped/closed.
    let genInstructionsResolver = null;
    function askForInstructions(title, hasExistingContent) {
      const titleEl = document.getElementById('genInstructionsTitle');
      const input = document.getElementById('genInstructionsInput');
      if (titleEl) titleEl.textContent = title;
      if (input) input.value = '';
      document.getElementById('genInstructionsModal')?.classList.add('active');
      return new Promise(function (resolve) {
        genInstructionsResolver = resolve;
      });
    }
    document.getElementById('genInstructionsGoBtn')?.addEventListener('click', function () {
      const text = document.getElementById('genInstructionsInput')?.value.trim() || '';
      document.getElementById('genInstructionsModal')?.classList.remove('active');
      if (genInstructionsResolver) { genInstructionsResolver(text); genInstructionsResolver = null; }
    });
    document.getElementById('closeGenInstructionsModal')?.addEventListener('click', function () {
      document.getElementById('genInstructionsModal')?.classList.remove('active');
      if (genInstructionsResolver) { genInstructionsResolver(null); genInstructionsResolver = null; } // null = cancelled entirely
    });

    aiGenerateSectionBtn.addEventListener('click', async function () {
      document.getElementById('genDropdownWrap')?.classList.remove('open');
      if (!currentProject || !currentChapter) { showToast('Select a chapter and section first', 'error'); return; }
      if (!canGenerateChapter(currentChapter)) { showToast('No active plan: Only Chapter 1 generation is available. Upgrade for full access.', 'error', 5000); goToSubscription(); return; }
      const ch = getChaptersStructure()[currentChapter];
      const hasContent = ch && ch.sections && ch.sections.length > 0
        ? (currentProject.chapters && currentProject.chapters[currentChapter] && currentProject.chapters[currentChapter].sections && (currentProject.chapters[currentChapter].sections[currentSection] || '').trim().length > 0)
        : (currentProject.chapters && currentProject.chapters[currentChapter] && (currentProject.chapters[currentChapter].content || '').trim().length > 0);
      if (hasContent && !canRegenerate()) { showToast('Regeneration requires Student or Pro plan. Upgrade for full access.', 'error', 5000); goToSubscription(); return; }
      if (!aiConfig.token) { const ok = await fetchTokens(); if (!ok) { showToast('SI service not configured', 'error'); return; } }
      const sectionNameForModal = ch && ch.sections && ch.sections.length > 0 ? ch.sections[currentSection] : (ch ? ch.title : 'Section');
      const instructions = await askForInstructions((hasContent ? 'Regenerate: ' : 'Generate: ') + sectionNameForModal, hasContent);
      if (instructions === null) return; // cancelled
      if (modificationInput) modificationInput.value = instructions;
      await saveVersion();
      const sectionName = ch && ch.sections && ch.sections.length > 0 ? ch.sections[currentSection] : (ch ? ch.title : 'Section');
      aiProgressModal.classList.add('active'); aiGenerateSectionBtn.disabled = true; aiAbortController = new AbortController(); updateProgressBar(0);
      try {
        updateProgressStage('Pass 1/3: Generating academic draft...', ''); updateProgressBar(20);
        const content = await generateSection(sectionName, currentChapter, currentSection);
        updateProgressBar(90); updateProgressStage('Finalizing...', 'Inserting content into editor');
        sectionEditor.innerHTML = content;
        saveCurrentSection(); await saveToFirebase();
        if (modificationInput) modificationInput.value = '';
        updateProgressBar(100); showToast('Section generated successfully', 'success');
        renderChapters(); updateModificationArea(); displayHumanizationScore(); updateVersionList(); updateChapterGenButton();
        logActivity('section_generated', sectionName);
        setTimeout(checkConsistency, 500);
      } catch (err) {
        if (err.name === 'AbortError') showToast('Generation cancelled', 'info');
        else { reportError(err, 'section generation'); showToast('Generation failed: ' + (err.message || 'Unknown error'), 'error', 5000); }
      } finally { aiProgressModal.classList.remove('active'); aiGenerateSectionBtn.disabled = false; aiAbortController = null; updateProgressBar(0); }
    });

    if (aiGenerateChapterBtn) {
      aiGenerateChapterBtn.addEventListener('click', async function () {
        document.getElementById('genDropdownWrap')?.classList.remove('open');
        if (!canAccessResources()) { showToast('Chapter generation requires Student plan or higher.', 'error'); goToSubscription(); return; }
        if (!currentProject || !currentChapter) return;
        // The old confirm()/prompt() custom-outline detour is gone: the
        // chapter's outline is edited in the chapters drawer (rename / add /
        // delete section), so generation always follows the current outline.
        const ch = getChaptersStructure()[currentChapter];
        const sections = (ch.sections && ch.sections.length) ? ch.sections.slice() : [ch.title];
        const chapterInstructions = await askForInstructions('Generate chapter: ' + ch.title, false);
        if (chapterInstructions === null) return; // cancelled
        if (modificationInput) modificationInput.value = chapterInstructions;
        aiProgressModal.classList.add('active'); aiAbortController = new AbortController(); chapterGenerationActive = true; updateProgressBar(0);
        try {
          for (let i = 0; i < sections.length; i++) {
            if (!chapterGenerationActive) break;
            currentSection = i;
            updateProgressBar(Math.round((i / sections.length) * 100));
            updateProgressStage('Generating section ' + (i + 1) + '/' + sections.length, sections[i]);
            const content = await generateSection(sections[i], currentChapter, i);
            if (!currentProject.chapters) currentProject.chapters = {};
            if (!currentProject.chapters[currentChapter]) currentProject.chapters[currentChapter] = { sections: {} };
            if (!currentProject.chapters[currentChapter].sections) currentProject.chapters[currentChapter].sections = {};
            currentProject.chapters[currentChapter].sections[i] = content;
            await saveToFirebase();
          }
          updateProgressBar(100);
          sectionEditor.innerHTML = (currentProject.chapters[currentChapter].sections && currentProject.chapters[currentChapter].sections[0]) || '';
          currentSection = 0;
          renderChapters(); loadSectionContent(); showToast('Chapter generated successfully', 'success');
          updateModificationArea(); displayHumanizationScore(); updateChapterGenButton();
          logActivity('section_generated', 'entire chapter');
        } catch (err) {
          if (err.name === 'AbortError') showToast('Chapter generation cancelled', 'info');
          else { reportError(err, 'chapter generation'); showToast('Chapter generation failed: ' + (err.message || 'Unknown error'), 'error'); }
        } finally {
          aiProgressModal.classList.remove('active'); aiAbortController = null; chapterGenerationActive = false; updateProgressBar(0);
        }
      });
    }
    if (cancelGenerateBtn) cancelGenerateBtn.addEventListener('click', function () { chapterGenerationActive = false; if (aiAbortController) aiAbortController.abort(); });
    if (closeProgressModal) closeProgressModal.addEventListener('click', function () { chapterGenerationActive = false; if (aiAbortController) aiAbortController.abort(); aiProgressModal.classList.remove('active'); });

    if (writingProfileSelect) writingProfileSelect.addEventListener('change', function () { if (currentProject) { currentProject.writingProfile = writingProfileSelect.value; saveToFirebase(); } });

    // =========================================================================
    // PROJECT AI CHAT (ported "AI Supervisor" chat, kept alongside the 8 new
    // contextual actions — REDESIGN renamed panel, preserved functionality)
    // =========================================================================
    function showTypingIndicator() {
      if (typingIndicator) return;
      typingIndicator = document.createElement('div');
      typingIndicator.className = 'typing-indicator';
      typingIndicator.innerHTML = '<span></span><span></span><span></span>';
      aiChatMessages.appendChild(typingIndicator);
      typingIndicator.scrollIntoView({ behavior: 'smooth' });
    }
    function hideTypingIndicator() { if (typingIndicator) { typingIndicator.remove(); typingIndicator = null; } }

    // The suggested prompts now live in the same horizontal strip as the
    // quick actions (see renderProjectAIActions) — the old separate bar stays hidden.
    const SUGGESTED_PROMPTS = ['Review my current section for clarity', 'Suggest improvements for this chapter', 'Help me with my methodology approach', 'What key points should I cover in this section?'];
    function updateDefaultPromptsBar() { if (defaultPromptsBar) defaultPromptsBar.style.display = 'none'; }

    function clearChatHistory() {
      aiChatMessages.innerHTML = '<div class="ai-empty-state empty-chat"><i class="fas fa-robot"></i><p>Project SI is ready</p><small>Ask about this project, or tap a quick action below</small></div>';
      updateDefaultPromptsBar();
    }

    // Strictness / Profession: a real modal (moved to <body>) so it can never
    // be clipped or hidden behind the review/chat panels.
    const projAISettingsBtn = document.getElementById('projAISettingsBtn');
    const supervisorPersonalityEl = document.getElementById('supervisorPersonality');
    if (projAISettingsBtn && supervisorPersonalityEl) {
      const overlay = document.createElement('div');
      overlay.className = 'proj-settings-overlay';
      overlay.hidden = true;
      overlay.innerHTML = '<div class="proj-settings-modal" role="dialog" aria-modal="true" aria-labelledby="projSettingsTitle">' +
        '<div class="proj-settings-head"><h3 id="projSettingsTitle"><i class="bx bx-slider-alt" aria-hidden="true"></i> Project SI preferences</h3>' +
        '<button type="button" class="proj-settings-close" aria-label="Close preferences">&times;</button></div>' +
        '<p class="proj-settings-sub">How the SI supervisor reviews and responds to your work.</p>' +
        '<div class="proj-settings-body"></div>' +
        '<div class="proj-settings-foot"><button type="button" class="generate-btn proj-settings-done">Done</button></div></div>';
      document.body.appendChild(overlay);
      overlay.querySelector('.proj-settings-body').appendChild(supervisorPersonalityEl);
      supervisorPersonalityEl.hidden = false;
      supervisorPersonalityEl.classList.remove('proj-ai-settings-pop');
      const closeSettings = function () {
        overlay.hidden = true;
        document.body.classList.remove('proj-settings-open');
        projAISettingsBtn.setAttribute('aria-expanded', 'false');
        projAISettingsBtn.focus();
      };
      projAISettingsBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        overlay.hidden = false;
        document.body.classList.add('proj-settings-open');
        projAISettingsBtn.setAttribute('aria-expanded', 'true');
        if (supervisorStrictness) supervisorStrictness.focus();
      });
      overlay.addEventListener('click', function (e) { if (e.target === overlay) closeSettings(); });
      overlay.querySelector('.proj-settings-close').addEventListener('click', closeSettings);
      overlay.querySelector('.proj-settings-done').addEventListener('click', closeSettings);
      overlay.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSettings(); });
      cleanupFns.push(function () { overlay.remove(); });
    }
    async function loadChatHistory() {
      if (!currentUser || !currentProjectId) return false;
      try {
        const snap = await database.ref('history/' + scopeUid + '/projects/' + currentProjectId + '/chatHistory').once('value');
        const data = snap.val();
        if (data && data.messages && data.messages.length > 0) {
          aiChatMessages.innerHTML = '';
          data.messages.forEach(function (msg) {
            // Stored content is the bubble's HTML — sanitized before it is shown again.
            const raw = msg.role === 'assistant' && typeof marked !== 'undefined' ? marked.parse(msg.content || '') : (msg.content || '');
            const html = window.RehablixSanitize ? window.RehablixSanitize.html(raw) : raw;
            aiChatMessages.appendChild(buildChatMessage(msg.role, html, msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''));
          });
          aiChatMessages.scrollTop = aiChatMessages.scrollHeight;
          updateDefaultPromptsBar();
          return true;
        }
      } catch (error) { console.error('Error loading chat history:', error); }
      return false;
    }

    async function saveChatHistory() {
      if (!currentUser || !currentProjectId) return;
      try {
        const messages = [];
        aiChatMessages.querySelectorAll('.ai-message').forEach(function (el) {
          const isUser = el.classList.contains('user');
          const bubble = el.querySelector('.message-bubble');
          let content;
          if (bubble) content = bubble.innerHTML;
          else { // pre-redesign markup (time div inline)
            const clone = el.cloneNode(true);
            const timeEl = clone.querySelector('div[style*="font-size: 0.65rem"]');
            if (timeEl) timeEl.remove();
            content = clone.innerHTML || clone.textContent;
          }
          messages.push({ role: isUser ? 'user' : 'assistant', content: content, timestamp: Date.now() });
        });
        if (messages.length > 0 && !aiChatMessages.querySelector('.ai-empty-state')) {
          await database.ref('history/' + scopeUid + '/projects/' + currentProjectId + '/chatHistory').set({ messages: messages.slice(-100), updatedAt: firebase.database.ServerValue.TIMESTAMP });
        }
      } catch (error) { console.error('Error saving chat history:', error); }
    }

    aiSendBtn.addEventListener('click', async function () {
      if (!canAccessAISupervisor()) { showToast('Project SI requires Student or Pro plan. Upgrade for full access.', 'error', 5000); goToSubscription(); return; }
      const text = aiMessageInput.value.trim();
      if (!text) return;
      appendAIChatMessage('user', text);
      aiMessageInput.value = ''; aiMessageInput.style.height = 'auto';
      showTypingIndicator();
      try {
        const reply = await callProjectAIChat(text);
        hideTypingIndicator();
        appendAIChatMessage('assistant', reply);
        saveChatHistory();
      } catch (err) { hideTypingIndicator(); reportError(err, 'project AI chat'); appendAIChatMessage('assistant', 'Sorry, I encountered an error. Please try again.'); }
    });
    aiMessageInput.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiSendBtn.click(); } });
    aiMessageInput.addEventListener('input', function () { aiMessageInput.style.height = 'auto'; aiMessageInput.style.height = Math.min(aiMessageInput.scrollHeight, 120) + 'px'; });

    function buildFullProjectSummary() {
      let summary = buildWorkspaceContext(false);
      const chStruct = getChaptersStructure();
      for (const key in chStruct) {
        if (!chStruct.hasOwnProperty(key)) continue;
        const ch = chStruct[key];
        if (ch.sections && ch.sections.length > 0) {
          ch.sections.forEach(function (sec, i) {
            const content = getSectionContent(key, i);
            if (content && content.trim().length > 50) summary += '\n\n[' + ch.title + ' - ' + sec + ']:\n' + clip(extractPlainText(content), 500);
          });
        } else if (ch) {
          const content = getSectionContent(key, 0);
          if (content && content.trim().length > 50) summary += '\n\n[' + ch.title + ']:\n' + clip(extractPlainText(content), 500);
        }
      }
      return summary;
    }

    // REDESIGN: routed through js/ai-quota-core.js instead of the legacy
    // hardcoded client, since this is the primary "Project AI" surface.
    async function callProjectAIChat(userMessage) {
      const config = await chosenModelConfig('corpus101');
      if (!config) throw new Error('SI not configured');
      if (currentUser) await window.RehablixAIQuotaCore.checkQuotaOrThrow(currentUser.uid, currentPlan);
      const fullContext = buildFullProjectSummary();
      const strictnessGuides = {
        easy: 'Be supportive and encouraging. Offer gentle suggestions. Focus on strengths while nudging toward improvement.',
        moderate: 'Provide balanced feedback. Acknowledge strengths but clearly point out areas that need work. Be direct but constructive.',
        strict: 'Be rigorous and demanding. Hold the student to high academic standards. Point out all weaknesses, inconsistencies, and gaps. Challenge their thinking.'
      };
      const systemPrompt = 'You are Project SI, ' + supervisorPersonality.profession + ', an assistant purpose-built for this specific academic project (not a general chatbot).\nProject: ' + (currentProject ? currentProject.title : 'N/A') + '\nDepartment: ' + (currentProject ? currentProject.department : 'N/A') + '\nApproach: ' + (currentProject && currentProject.approach === 'qualitative' ? 'Qualitative' : 'Quantitative') + '\n\nYour strictness: ' + strictnessGuides[supervisorPersonality.strictness] + '\n\nFULL PROJECT CONTENT (research setup, all chapters and sections, available references):\n' + fullContext.substring(0, 8000) + '\n\nRULES:\n1. Give concise, direct answers using key points.\n2. Reference specific chapters, sections, or research-setup fields as needed.\n3. Flag inconsistencies immediately.\n4. Use simple language, key-points format.\n5. Be thorough but brief.';
      const response = await fetch(config.endpoint + '/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
        body: JSON.stringify({ model: config.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }], max_tokens: config.maxTokens, temperature: 0.7 })
      });
      if (!response.ok) throw new Error('API error');
      const data = await response.json();
      const content = data.choices[0].message.content;
      if (currentUser) window.RehablixAIQuotaCore.reportTokenUsage(currentUser.uid, currentPlan, systemPrompt + userMessage + content, config.weight);
      return content;
    }

    // =========================================================================
    // WORKSPACE TOP BAR (REDESIGN Round 3): chapter-drawer toggle + Setup/
    // Review shortcuts now that the global tab layout is gone.
    // =========================================================================
    if (toggleChaptersBtn) toggleChaptersBtn.addEventListener('click', function () { chaptersSidebar.classList.toggle('open'); });
    document.getElementById('workspaceSetupBtn')?.addEventListener('click', function () {
      if (!currentProjectId) { showToast('Select or create a project first', 'error'); return; }
      saveCurrentSection(); saveToFirebase();
      switchScreen('setup');
    });
    document.getElementById('workspaceReviewBtn')?.addEventListener('click', function () {
      if (!currentProjectId) { showToast('Select or create a project first', 'error'); return; }
      saveCurrentSection(); saveToFirebase();
      switchScreen('review');
    });
    document.getElementById('exportSectionBtn')?.addEventListener('click', function () {
      if (!currentProjectId) { showToast('Select or create a project first', 'error'); return; }
      saveCurrentSection(); saveToFirebase();
      switchScreen('export');
    });

    // REDESIGN (Round 5 item 2): .editor-actions is now horizontally
    // scrollable (overflow-x:auto), which per spec forces overflow-y to
    // 'auto' too — an absolutely-positioned dropdown menu popping below a
    // scrolling ancestor would get clipped by that ancestor's own box. Both
    // dropdown menus below switch to position:fixed (escapes ANY ancestor's
    // overflow clipping) with their top/left computed from the trigger
    // button's live position the moment they open.
    function positionDropdownMenu(btn, menu) {
      const rect = btn.getBoundingClientRect();
      menu.style.position = 'fixed';
      menu.style.top = (rect.bottom + 6) + 'px';
      menu.style.bottom = 'auto';
      const menuWidth = menu.offsetWidth || 180;
      let left = rect.right - menuWidth;
      if (left < 8) left = 8;
      const maxLeft = window.innerWidth - menuWidth - 8;
      if (left > maxLeft) left = Math.max(8, maxLeft);
      menu.style.left = left + 'px';
      menu.style.right = 'auto';
    }

    // Tools icon (REDESIGN Round 3): rolls down a small dropdown with a
    // Reference shortcut (opens the Add Reference modal directly) and a
    // "More" shortcut (navigates to the full Project Tools screen) instead
    // of navigating straight to Tools like it used to.
    const toolsDropdownWrap = document.getElementById('toolsDropdownWrap');
    const toolsDropdownBtn = document.getElementById('toolsDropdownBtn');
    const toolsDropdownMenu = document.getElementById('toolsDropdownMenu');
    if (toolsDropdownBtn && toolsDropdownWrap) {
      // The spanner goes straight to Project Tools (the Reference Manager is the first tool there).
      toolsDropdownBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        toolsDropdownWrap.classList.remove('open');
        if (!currentProjectId) { showToast('Select or create a project first', 'error'); return; }
        saveCurrentSection(); saveToFirebase();
        switchScreen('tools');
      });
      document.addEventListener('click', function () {
        toolsDropdownWrap.classList.remove('open');
        toolsDropdownBtn.setAttribute('aria-expanded', 'false');
      });
    }
    document.getElementById('toolsDropdownReferenceBtn')?.addEventListener('click', function (e) {
      e.stopPropagation();
      if (toolsDropdownWrap) toolsDropdownWrap.classList.remove('open');
      if (!currentProject) { showToast('Select or create a project first', 'error'); return; }
      openReferenceForm(null);
    });
    document.getElementById('toolsDropdownMoreBtn')?.addEventListener('click', function (e) {
      e.stopPropagation();
      if (toolsDropdownWrap) toolsDropdownWrap.classList.remove('open');
      if (!currentProjectId) { showToast('Select or create a project first', 'error'); return; }
      saveCurrentSection(); saveToFirebase();
      switchScreen('tools');
    });

    // REDESIGN (Round 5 item 2): the "Generate" dropdown reuses the exact
    // same open/close pattern as the Tools dropdown above — click toggles it
    // open, any outside click closes it.
    const genDropdownWrap = document.getElementById('genDropdownWrap');
    const genDropdownBtn = document.getElementById('genDropdownBtn');
    const genDropdownMenu = document.getElementById('genDropdownMenu');
    if (genDropdownBtn && genDropdownWrap) {
      genDropdownBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        const open = genDropdownWrap.classList.toggle('open');
        genDropdownBtn.setAttribute('aria-expanded', String(open));
        if (open && genDropdownMenu) positionDropdownMenu(genDropdownBtn, genDropdownMenu);
      });
      document.addEventListener('click', function () {
        genDropdownWrap.classList.remove('open');
        genDropdownBtn.setAttribute('aria-expanded', 'false');
      });
    }

    // REDESIGN (Round 4 item 2, revised Round 5 item 1): mobile-only icon
    // that collapses the section title/progress row + editor-actions +
    // formatting toolbar, freeing up scroll space for the text itself.
    // Round 5: the auto scroll-collapse behavior was removed (it surprised
    // users mid-scroll) — collapsing is now manual-only, discovered via a
    // one-time highlighted tutorial the first time a student opens Workspace
    // on a narrow screen.
    const toggleHeaderCollapseBtn = document.getElementById('toggleHeaderCollapseBtn');
    const editorAreaEl = document.getElementById('editorArea');
    function setHeaderCollapsed(collapsed) {
      if (!editorAreaEl) return;
      editorAreaEl.classList.toggle('editor-header-collapsed', collapsed);
      if (toggleHeaderCollapseBtn) {
        toggleHeaderCollapseBtn.innerHTML = collapsed ? '<i class="fas fa-chevron-down"></i>' : '<i class="fas fa-chevron-up"></i>';
        toggleHeaderCollapseBtn.setAttribute('aria-expanded', String(!collapsed));
      }
    }
    const COLLAPSE_TUTORIAL_KEY = 'rehab_project_collapse_tutorial_seen';
    let collapseTutorialShown = false;
    function maybeShowCollapseTutorial() {
      if (collapseTutorialShown || !toggleHeaderCollapseBtn) return;
      if (window.innerWidth > 768) return; // only relevant where the icon itself is visible
      let seen = false;
      try { seen = localStorage.getItem(COLLAPSE_TUTORIAL_KEY) === '1'; } catch (e) {}
      if (seen) return;
      collapseTutorialShown = true;
      const tip = document.getElementById('workspaceCollapseTutorial');
      toggleHeaderCollapseBtn.classList.add('workspace-topbar-btn-pulse');
      if (tip) tip.hidden = false;
      function dismiss() {
        toggleHeaderCollapseBtn.classList.remove('workspace-topbar-btn-pulse');
        if (tip) tip.hidden = true;
        try { localStorage.setItem(COLLAPSE_TUTORIAL_KEY, '1'); } catch (e) {}
        toggleHeaderCollapseBtn.removeEventListener('click', dismiss);
        document.removeEventListener('click', onOutsideTutorialClick, true);
      }
      function onOutsideTutorialClick(e) {
        if (e.target === toggleHeaderCollapseBtn || toggleHeaderCollapseBtn.contains(e.target)) return;
        dismiss();
      }
      toggleHeaderCollapseBtn.addEventListener('click', dismiss);
      document.addEventListener('click', onOutsideTutorialClick, true);
      setTimeout(dismiss, 8000);
    }
    if (toggleHeaderCollapseBtn) {
      toggleHeaderCollapseBtn.addEventListener('click', function () {
        setHeaderCollapsed(!editorAreaEl.classList.contains('editor-header-collapsed'));
      });
    }
    // REDESIGN (item 4): toggleAIPanelBtn/closeAIPanelBtn's slide-in-overlay
    // behavior no longer applies now that Project AI lives on the Review
    // screen (a normal-flowing sticky column, not a Workspace overlay).
    if (closeChaptersBtn) closeChaptersBtn.addEventListener('click', function () { chaptersSidebar.classList.remove('open'); });
    if (closeAIPanelBtn) closeAIPanelBtn.addEventListener('click', function () { aiPanel.classList.remove('open'); });

    // =========================================================================
    // PLAN UPDATE LISTENER
    // =========================================================================
    const onPlanUpdated = function (e) {
      const newPlan = (e.detail && e.detail.plan) || 'free';
      if (newPlan !== currentPlan) { currentPlan = newPlan; loadPlanData(); updatePlanUI(); }
    };
    document.addEventListener('planUpdated', onPlanUpdated);
    cleanupFns.push(function () { document.removeEventListener('planUpdated', onPlanUpdated); });

    if (window.rehabPlans) currentPlan = window.rehabPlans.getCurrentPlan() || 'free';

    function updateSupervisorAccess() {
      if (aiMessageInput && aiSendBtn) {
        const access = canAccessAISupervisor();
        aiMessageInput.disabled = !access; aiSendBtn.disabled = !access;
        aiMessageInput.placeholder = access ? 'Ask Project SI...' : 'Upgrade to Student or Pro for Project SI chat';
      }
    }

    // =========================================================================
    // AUTH & INIT
    // =========================================================================
    let lastAuthUid = null;
    const unsubAuth = firebase.auth().onAuthStateChanged(async function (user) {
      const wasLoggedIn = lastAuthUid !== null;
      const uidChanged = lastAuthUid !== null && (!user || user.uid !== lastAuthUid);
      if (uidChanged) { currentProjectId = null; currentProject = null; setProjectActive(false); switchScreen('projects'); }
      lastAuthUid = user ? user.uid : null;
      currentUser = user;

      if (user) {
        signedOut = false;
        if (!projectsLoaded) renderProjectsShimmer();
        if (window.RehablixCenter && typeof window.RehablixCenter.getEffectiveScopeUid === 'function') {
          try { scopeUid = await window.RehablixCenter.getEffectiveScopeUid('project'); } catch (err) { scopeUid = user.uid; }
        } else scopeUid = user.uid;
        if (scopeUid === null) { showToast('Your access to Projects has been turned off by your group admin.', 'error', 6000); return; }
        else if (scopeUid !== user.uid) showToast('Working on your group shared projects', 'info', 3000);

        await fetchTokens();
        await loadProjects();
        projectsLoaded = true;

        // REDESIGN (Round 4 item 3): restore whichever project/screen was
        // open before a sudden reload, instead of always landing on "All
        // Projects" — the student's place in their work survives a crash
        // or an accidental refresh.
        const savedState = loadActiveState();
        if (!currentProjectId && savedState && savedState.projectId && projects[savedState.projectId]) {
          await switchToProject(savedState.projectId, { silent: true });
          switchScreen(savedState.screen || 'dashboard', { suppressHistory: true });
        } else if (!currentProjectId) {
          setProjectActive(false);
          switchScreen('projects', { suppressHistory: true });
        }
      } else {
        // Only a genuine sign-out (we previously knew a real uid) should
        // wipe the restore-on-reload state — the very first callback this
        // view ever receives also arrives with user===null while real auth
        // is still resolving the persisted session, and must not be
        // mistaken for a sign-out (same distinction uidChanged already
        // makes, above).
        if (wasLoggedIn) clearActiveState();
        currentProjectId = null; currentProject = null;
        signedOut = true; projectsLoaded = false; projects = {};
        renderSignedOutProjects(); // say so on the projects list instead of loading forever
        if (chaptersList) chaptersList.innerHTML = '';
        if (sectionEditor) sectionEditor.innerHTML = '';
        if (currentSectionTitle) currentSectionTitle.textContent = 'Select a section';
        if (modificationArea) modificationArea.style.display = 'none';
        if (aiScoreDisplay) aiScoreDisplay.style.display = 'none';
        renderDashboard();
      }
    });
    cleanupFns.push(unsubAuth);

    loadPlanData();
    updatePlanUI();
    updateDefaultPromptsBar();
    renderProjectAIActions();
    setProjectActive(false);
    switchScreen('projects', { suppressHistory: true });

    // REDESIGN (item 1): register with the shared navbar's existing back
    // button (js/bottom-nav.js's #navBackBtn) instead of Project Maker
    // growing its own dedicated back button — reuses this screenHistory stack.
    if (window.RehablixNav) {
      window.RehablixNav.registerInternalBack('project', function () {
        if (screenHistory.length <= 1) return false;
        screenHistory.pop();
        const prev = screenHistory[screenHistory.length - 1];
        if (screens.workspace && screens.workspace.classList.contains('active')) { saveCurrentSection(); saveToFirebase(); }
        setProjectActive(prev !== 'projects');
        switchScreen(prev, { suppressHistory: true });
        return true;
      });
    }

    console.log('[Project] Ready');

    // SPA: handoff navbar slot (router clears #navbarViewSlot on every nav).
    onShow = function () {
      if (screens.workspace && screens.workspace.classList.contains('active')) {
        // realtime data already current — nothing to reload, this view is kept alive.
      }
    };
  } // end mount()

  function unmount() {
    cleanupFns.forEach(function (fn) { try { fn(); } catch (e) { /* best-effort */ } });
    cleanupFns = [];
  }

  window.RehablixViews = window.RehablixViews || {};
  window.RehablixViews.project = { mount: mount, unmount: unmount, onShow: function () { onShow(); } };
})();
