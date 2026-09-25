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
    const projNavBar = document.getElementById('projNavBar');
    const projBreadcrumb = document.getElementById('projBreadcrumb');
    const projBreadcrumbTitle = document.getElementById('projBreadcrumbTitle');
    // REDESIGN (item 3): the tab layout (nav bar) + breadcrumb only appear
    // once a project is actually open — the "All Projects" list is chrome-free.
    function setProjectActive(active) {
      if (projNavBar) projNavBar.style.display = active ? '' : 'none';
      if (projBreadcrumb) projBreadcrumb.style.display = active ? 'flex' : 'none';
      if (projBreadcrumbTitle) projBreadcrumbTitle.textContent = active && currentProject ? currentProject.title : '';
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
    const aiProgressModal = document.getElementById('aiProgressModal');
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
    const fontFamilySelect = document.getElementById('fontFamilySelect');
    const fontSizeSelect = document.getElementById('fontSizeSelect');

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
      if (msg.includes('api') || msg.includes('token')) return 'AI service temporarily unavailable. Please try again later.';
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
          '<div style="margin-bottom: 0.25rem; font-size: 0.78rem;"><strong>' + FREE_PROJECT_LIMIT + '</strong> project/month, Chapter 1 only, No Project AI chat</div>' +
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
      if (!str) return '';
      return str.replace(/[&<>]/g, function (m) { return m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;'; });
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

      if (name === 'projects') { if (projectsLoaded) renderProjectsListScreen(); else renderProjectsShimmer(); }
      if (name === 'dashboard') renderDashboard();
      if (name === 'setup') renderSetupScreen();
      if (name === 'review') renderReviewScreen();
      if (name === 'export') renderExportScreen();
      if (name === 'tools') renderToolsScreen();

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
        const progress = computeProgress(proj);
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
            delete projects[id];
            if (currentProjectId === id) {
              currentProjectId = null; currentProject = null;
              setProjectActive(false);
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
        section_saved: 'Saved', section_generated: 'AI generated', chapter_reviewed: 'Reviewed',
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
        projects[currentProjectId] = JSON.parse(JSON.stringify(currentProject));
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
        if (background) summary.push('BACKGROUND: ' + background.substring(0, 800));
        if (statement) summary.push('PROBLEM STATEMENT: ' + statement.substring(0, 600));
        if (objectives) summary.push('AIM & OBJECTIVES: ' + objectives.substring(0, 600));
        if (questions) summary.push('RESEARCH QUESTIONS: ' + questions.substring(0, 500));
        if (significance) summary.push('SIGNIFICANCE: ' + significance.substring(0, 400));
      }
      const ch2 = currentProject.chapters.chapter2;
      if (ch2) {
        const framework = extractPlainText(ch2.sections ? ch2.sections[0] : '');
        const empirical = extractPlainText(ch2.sections ? ch2.sections[1] : '');
        const conceptual = extractPlainText(ch2.sections ? ch2.sections[2] : '');
        if (framework) summary.push('THEORETICAL FRAMEWORK: ' + framework.substring(0, 600));
        if (empirical) summary.push('EMPIRICAL REVIEW KEY POINTS: ' + empirical.substring(0, 500));
        if (conceptual) summary.push('CONCEPTUAL FRAMEWORK: ' + conceptual.substring(0, 400));
      }
      const ch3 = currentProject.chapters.chapter3;
      if (ch3) {
        const design = extractPlainText(ch3.sections ? ch3.sections[0] : '');
        const population = extractPlainText(ch3.sections ? ch3.sections[1] : '');
        const sampling = extractPlainText(ch3.sections ? ch3.sections[2] : '');
        const instrument = extractPlainText(ch3.sections ? ch3.sections[3] : '');
        const dataCollect = extractPlainText(ch3.sections ? ch3.sections[4] : '');
        const dataAnalysis = extractPlainText(ch3.sections ? ch3.sections[5] : '');
        if (design) summary.push('RESEARCH DESIGN (MUST MATCH IN ALL CHAPTERS): ' + design.substring(0, 500));
        if (population) summary.push('POPULATION & SAMPLE SIZE (USE THESE EXACT NUMBERS IN CHAPTERS 4 & 5): ' + population.substring(0, 600));
        if (sampling) summary.push('SAMPLING TECHNIQUE: ' + sampling.substring(0, 400));
        if (instrument) summary.push('INSTRUMENTS/TOOLS (MUST MATCH IN RESULTS & DISCUSSION): ' + instrument.substring(0, 500));
        if (dataCollect) summary.push('DATA COLLECTION PROCEDURE: ' + dataCollect.substring(0, 400));
        if (dataAnalysis) summary.push('DATA ANALYSIS METHOD: ' + dataAnalysis.substring(0, 400));
      }
      const ch4 = currentProject.chapters.chapter4;
      if (ch4) {
        const dataPres = extractPlainText(ch4.sections ? ch4.sections[0] : (ch4.content || ''));
        const analysis = extractPlainText(ch4.sections ? ch4.sections[1] : '');
        const interp = extractPlainText(ch4.sections ? ch4.sections[2] : '');
        if (dataPres) summary.push('RESULTS - DATA PRESENTATION (must be consistent with Discussion): ' + dataPres.substring(0, 700));
        if (analysis) summary.push('RESULTS - ANALYSIS (do not contradict these findings): ' + analysis.substring(0, 500));
        if (interp) summary.push('RESULTS - INTERPRETATION: ' + interp.substring(0, 400));
      }
      const allText = extractPlainText(JSON.stringify(currentProject.chapters));
      const numberPatterns = allText.match(/\bn\s*=\s*\d+|\d+\s*participants?|\d+\s*patients?|\d+\.\d+\s*\(SD[\s=]*[\d.]+\)|\bp\s*[<=>]\s*[\d.]+|mean\s*(?:score\s*)?(?:was|of|=)\s*[\d.]+/gi) || [];
      const uniqueNumbers = [...new Set(numberPatterns.map(function (s) { return s.trim(); }))].slice(0, 15);
      if (uniqueNumbers.length > 0) summary.push('CONSISTENCY CRITICAL - USE THESE EXACT FIGURES (do not invent or change any): ' + uniqueNumbers.join(' | '));
      const keyTerms = extractKeyTerms(allText);
      if (keyTerms.length > 0) summary.push('KEY TERMS (use consistently, same spelling throughout): ' + keyTerms.join(', '));
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
        if (draft.trim()) parts.push('CURRENT DRAFT (what is already written in this section — build on this, do not repeat it):\n' + draft.substring(0, 3000));
      }
      const refs = buildReferencesContext();
      if (refs) parts.push(refs);
      return parts.filter(Boolean).join('\n\n');
    }

    // =========================================================================
    // CONSISTENCY CHECKER (ported) + REVIEW SCREEN (REDESIGN)
    // =========================================================================
    function checkConsistency() {
      if (!currentProject || !currentProject.chapters) return [];
      const allText = extractPlainText(JSON.stringify(currentProject.chapters));
      const findings = [];
      const sampleMatches = allText.match(/\bn\s*=\s*(\d+)/gi) || [];
      const sizes = [...new Set(sampleMatches.map(function (m) { return m.replace(/\s/g, '').toLowerCase(); }))];
      if (sizes.length > 1) findings.push({ type: 'inconsistent', note: 'Sample size conflict: ' + sizes.join(', ') + ' found across chapters.', severity: 'high' });
      const participantMatches = allText.match(/(\d+)\s*participants?/gi) || [];
      const pCounts = [...new Set(participantMatches.map(function (m) { return m.replace(/\s/g, '').toLowerCase(); }))];
      if (pCounts.length > 1) findings.push({ type: 'inconsistent', note: 'Participant count conflict: ' + pCounts.join(', ') + ' found.', severity: 'high' });
      if (findings.length) showToast(findings.map(function (f) { return f.note; }).join(' '), 'warning', 7000);
      return findings;
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
        reviewToggleBtn.innerHTML = '<i class="fas fa-robot"></i> <span>Project AI</span>';
        reviewToggleBtn.title = 'Project AI';
        if (reviewHeaderTitle) reviewHeaderTitle.innerHTML = '<i class="bx bx-check-shield"></i> Consistency Check & Chapter Review';
      } else {
        aiPanel.style.display = 'flex';
        reviewFindingsPanel.style.display = 'none';
        reviewToggleBtn.dataset.mode = 'ai';
        reviewToggleBtn.innerHTML = '<i class="bx bx-check-shield"></i> <span>Findings</span>';
        reviewToggleBtn.title = 'Consistency Check & Chapter Review';
        if (reviewHeaderTitle) reviewHeaderTitle.innerHTML = '<i class="fas fa-robot"></i> Project AI';
      }
    }
    if (reviewToggleBtn) {
      reviewToggleBtn.addEventListener('click', function () { setReviewMode(reviewToggleBtn.dataset.mode === 'ai' ? 'findings' : 'ai'); });
    }

    function renderReviewScreen() {
      if (!currentProject) { setProjectActive(false); switchScreen('projects'); return; }
      setReviewMode('ai'); // Project AI is the default view every time Review is entered
      if (currentChapter) updateSectionNav(); // keeps the Project AI "Working on:" indicator current
      const consistencyEl = document.getElementById('reviewConsistencyFindings');
      const findings = checkConsistency();
      consistencyEl.innerHTML = findings.length
        ? findings.map(function (f) { return '<div class="review-finding review-' + f.severity + '"><i class="bx bx-error-circle"></i> ' + escapeHtml(f.note) + '</div>'; }).join('')
        : '<div class="review-finding review-ok"><i class="bx bx-check-circle"></i> No sample-size or participant-count conflicts detected.</div>';

      const cached = (currentProject.reviewFindings || {})[currentChapter];
      const chapterEl = document.getElementById('reviewChapterFindings');
      chapterEl.innerHTML = cached && cached.findings && cached.findings.length
        ? cached.findings.map(function (f) { return '<div class="review-finding review-' + f.severity + '"><span class="review-tag">' + f.type + '</span> ' + escapeHtml(f.section || '') + ': ' + escapeHtml(f.note) + '</div>'; }).join('')
        : '<div class="review-finding review-empty">No review run yet for this chapter. Click "Review Current Chapter" to check for missing, weak, inconsistent, or unsupported content.</div>';
    }

    document.getElementById('reviewChapterBtn')?.addEventListener('click', function () { runProjectAIAction('reviewChapter'); });

    // =========================================================================
    // EXPORT (ported buildExportHtml/export buttons, restyled into a screen)
    // =========================================================================
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
        bodyHtml = '<h2>' + escapeHtml(secName) + '</h2>\n' + getSectionContent(currentChapter, currentSection);
      } else if (scope === 'chapter') {
        const ch = chStruct[currentChapter];
        chapterTitle = ch ? ch.title : '';
        bodyHtml = '<h2>' + escapeHtml(chapterTitle) + '</h2>\n';
        if (ch && ch.sections && ch.sections.length) {
          ch.sections.forEach(function (sec, i) {
            const content = getSectionContent(currentChapter, i);
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
            if (content && content.trim().length > 10) bodyHtml += '<h2>' + escapeHtml(ch.title) + '</h2>\n' + content + '\n';
          } else {
            let hasContent = false, sectionHtml = '';
            ch.sections.forEach(function (sec, i) {
              const content = getSectionContent(key, i);
              if (content && content.trim().length > 10) { sectionHtml += '<h3>' + escapeHtml(sec) + '</h3>\n' + content + '\n'; hasContent = true; }
            });
            if (hasContent) bodyHtml += '<h2>' + escapeHtml(ch.title) + '</h2>\n' + sectionHtml;
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

      return '<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="UTF-8">\n  <title>' + escapeHtml(title) + '</title>\n  <style>\n    @page { size: A4; margin: 2.5cm 2cm 2.5cm 2cm; }\n    body { font-family: "Times New Roman", Georgia, serif; line-height: 1.8; font-size: 12pt; color: #222; }\n    .cover-page { text-align: center; padding-top: 30%; page-break-after: always; }\n    .cover-page h1 { font-size: 22pt; color: #00695c; margin-bottom: 0.5rem; }\n    .cover-page .subtitle { font-size: 14pt; color: #555; margin-bottom: 2rem; }\n    .cover-page .meta { font-size: 11pt; color: #777; line-height: 2; }\n    .toc-page { page-break-after: always; }\n    .toc-page h2 { color: #00695c; border-bottom: 2px solid #00695c; padding-bottom: 0.3rem; }\n    .content-page { page-break-before: ' + (scope === 'section' ? 'auto' : 'always') + '; }\n    h1, h2, h3 { color: #00695c; }\n    h2 { border-bottom: 1px solid #ddd; padding-bottom: 0.3rem; margin-top: 2rem; }\n    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }\n    th, td { border: 1px solid #666; padding: 8px; text-align: left; }\n    th { background: #f0f0f0; }\n    .reference-note { font-size: 10pt; color: #666; font-style: italic; margin-top: 0.5rem; border-top: 1px solid #ddd; padding-top: 0.5rem; }\n    .resources-note { font-size: 10pt; color: #666; margin-top: 0.5rem; padding: 0.5rem; background: #f9f9f9; border-radius: 0.25rem; }\n    @media print { body { margin: 0; } .no-print { display: none; } }\n  </style>\n</head>\n<body>\n' +
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

    document.getElementById('exportWordBtn')?.addEventListener('click', async function () {
      saveCurrentSection(); await saveToFirebase();
      const scope = exportScopeSelect ? exportScopeSelect.value : 'section';
      const title = currentProject ? currentProject.title : 'Academic Project';
      const fullHtml = buildExportHtml(scope);
      const blob = new Blob([fullHtml], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
      a.download = safeName + '_' + scope + '.doc';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      logActivity('exported', scope);
      showToast((scope === 'section' ? 'Section' : scope === 'chapter' ? 'Chapter' : 'Project') + ' exported as Word', 'success');
    });

    document.getElementById('exportPdfBtn')?.addEventListener('click', function () {
      saveCurrentSection(); saveToFirebase();
      const scope = exportScopeSelect ? exportScopeSelect.value : 'section';
      const printWindow = window.open('', '_blank', 'width=800,height=600');
      printWindow.document.write(buildExportHtml(scope));
      printWindow.document.close(); printWindow.focus();
      setTimeout(function () { printWindow.print(); printWindow.onafterprint = function () { printWindow.close(); }; }, 500);
      logActivity('exported', scope + ' (PDF)');
    });

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
            : !hasAIFormat ? '<div class="reference-status reference-status-plain">Plain format &middot; <button type="button" class="ref-format-btn" data-id="' + id + '">AI-format in ' + escapeHtml(refStyle) + '</button></div>' : '') +
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
        if (!config) { showToast('AI citation formatting is not configured right now — using plain format instead.', 'warning', 4000); return; }
        await window.RehablixAIQuotaCore.checkQuotaOrThrow(currentUser.uid, currentPlan);
        const systemPrompt = 'You are a citation formatting assistant. Given a source\'s details, output ONLY the correctly formatted reference-list entry in the requested style. No commentary, no markdown, just the citation text.';
        const userPrompt = 'Style: ' + style + '\nType: ' + record.type + '\nAuthors: ' + (record.authors || []).map(function (a) { return a.family + (a.given ? ', ' + a.given : ''); }).join('; ') + '\nYear: ' + record.year + '\nTitle: ' + record.title + '\nSource: ' + record.source + (record.url ? '\nURL: ' + record.url : '');
        const response = await fetch(config.endpoint + '/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
          body: JSON.stringify({ model: config.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], max_tokens: 300, temperature: 0.3 })
        });
        if (!response.ok) throw new Error('AI service returned an error');
        const data = await response.json();
        const formatted = data.choices && data.choices[0] && data.choices[0].message.content;
        if (!formatted) throw new Error('AI service returned an empty response');
        if (!currentProject.references[refId]) return; // reference was deleted while formatting was in flight
        currentProject.references[refId].formatted = currentProject.references[refId].formatted || {};
        currentProject.references[refId].formatted[style] = formatted.trim();
        await database.ref('history/' + scopeUid + '/projects/' + currentProjectId + '/references/' + refId + '/formatted/' + style).set(formatted.trim());
        window.RehablixAIQuotaCore.reportTokenUsage(currentUser.uid, currentPlan, systemPrompt + userPrompt + formatted, config.weight);
      } catch (e) {
        reportError(e, 'reference citation formatting');
        showToast('Could not AI-format this citation — showing the plain version instead.', 'warning', 4000);
      } finally {
        formattingRefId = null;
        renderReferenceList('referenceListWorkspace'); renderReferenceList('referenceListTools');
      }
    }

    // =========================================================================
    // PROJECT TOOLS SCREEN — REDESIGN (new)
    // =========================================================================
    const DEFERRED_TOOLS = [
      { id: 'literatureMatrix', name: 'Literature Matrix', icon: 'bx-table', desc: 'Organize studies by author, year, design, population, findings, limitations, and research gap.' },
      { id: 'gapFinder', name: 'Research Gap Finder', icon: 'bx-search-alt', desc: 'Surfaces gaps in the literature your project could address.' },
      { id: 'methodologyBuilder', name: 'Methodology Builder', icon: 'bx-flask', desc: 'Step-by-step builder for research design, sampling, and procedure.' },
      { id: 'instrumentBuilder', name: 'Questionnaire / Instrument Builder', icon: 'bx-list-check', desc: 'Design and validate a data-collection instrument.' },
      { id: 'sampleSizeCalc', name: 'Sample Size Calculator', icon: 'bx-calculator', desc: 'Compute a justified sample size for your study design.' },
      { id: 'statsPlanner', name: 'Statistical Analysis Planner', icon: 'bx-line-chart', desc: 'Plan which statistical tests fit your variables and design.' },
      { id: 'claimChecker', name: 'Claim & Citation Checker', icon: 'bx-shield-quarter', desc: 'Standalone document-wide audit of claims and their citations.' },
      { id: 'researchAlignment', name: 'Research Alignment', icon: 'bx-git-branch', desc: 'Visualize objectives to research questions to hypotheses to methodology to results.' },
      { id: 'defensePrep', name: 'Defense Preparation Mode', icon: 'bx-podium', desc: 'Guided Q&A rehearsal for your project defense.' },
      { id: 'formattingProfiles', name: 'University Formatting Profiles', icon: 'bx-buildings', desc: 'Apply your institution\'s specific formatting requirements.' },
      { id: 'projectSearch', name: 'Project-wide Search', icon: 'bx-search', desc: 'Search across every chapter, section, and reference in this project.' },
      { id: 'projectHistory', name: 'Project Activity & History', icon: 'bx-history', desc: 'Full timeline of every change made to this project.' }
    ];

    function renderToolsScreen() {
      if (!currentProject) { setProjectActive(false); switchScreen('projects'); return; }
      renderReferenceList('referenceListTools');
      const grid = document.getElementById('toolsGrid');
      if (!grid) return;
      const builtCard = '<div class="tool-card-item" data-tool="referenceManager">' +
        '<div class="tool-card-icon"><i class="bx bx-bookmark"></i></div>' +
        '<div class="tool-card-name">Reference Manager</div>' +
        '<div class="tool-card-desc">Store sources and generate citations in your selected style.</div>' +
        '<button class="btn btn-primary tool-card-open" data-tool="referenceManager">Open</button></div>';
      const deferredCards = DEFERRED_TOOLS.map(function (t) {
        return '<div class="tool-card-item tool-card-deferred" data-tool="' + t.id + '">' +
          '<div class="tool-card-icon"><i class="bx ' + t.icon + '"></i></div>' +
          '<div class="tool-card-name">' + t.name + '<span class="tool-card-badge">Coming soon</span></div>' +
          '<div class="tool-card-desc">' + t.desc + '</div>' +
          '<button class="btn btn-secondary tool-card-open" data-tool="' + t.id + '">Preview</button></div>';
      }).join('');
      grid.innerHTML = builtCard + deferredCards;

      grid.querySelectorAll('.tool-card-open').forEach(function (btn) {
        btn.addEventListener('click', function () { openToolPane(btn.dataset.tool); });
      });
    }

    function openToolPane(toolId) {
      document.querySelectorAll('.tool-pane').forEach(function (p) { p.style.display = 'none'; });
      if (toolId === 'referenceManager') {
        document.getElementById('toolPaneReferenceManager').style.display = 'block';
        return;
      }
      const tool = DEFERRED_TOOLS.find(function (t) { return t.id === toolId; });
      const pane = document.getElementById('toolPanePlaceholder');
      if (pane && tool) {
        pane.style.display = 'block';
        pane.innerHTML = '<div class="glass-card"><div class="card-header"><div class="card-title"><i class="bx ' + tool.icon + '"></i> ' + tool.name + '</div></div>' +
          '<div class="card-body"><span class="tool-card-badge" style="position:static;">Coming soon</span><p style="margin-top:0.8rem;">' + tool.desc + '</p>' +
          (toolId === 'researchAlignment' ? '<button class="btn btn-secondary" id="toolLinkToSetup"><i class="bx bx-cog"></i> Go to Research Setup</button>' : '') +
          '</div></div>';
        document.getElementById('toolLinkToSetup')?.addEventListener('click', function () { switchScreen('setup'); });
      }
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

    async function callProjectAI(action, systemPrompt, userPrompt) {
      const config = await window.RehablixAIQuotaCore.resolveModelConfig(action.model);
      if (!config) throw new Error('AI service not configured');
      if (currentUser) await window.RehablixAIQuotaCore.checkQuotaOrThrow(currentUser.uid, currentPlan);
      const response = await fetch(config.endpoint + '/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
        body: JSON.stringify({ model: config.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], max_tokens: config.maxTokens, temperature: config.temperature, top_p: config.top_p })
      });
      if (!response.ok) { const err = await response.json().catch(function () { return {}; }); throw new Error((err.error && err.error.message) || 'AI service error'); }
      const data = await response.json();
      const content = data.choices && data.choices[0] && data.choices[0].message.content;
      if (currentUser) window.RehablixAIQuotaCore.reportTokenUsage(currentUser.uid, currentPlan, systemPrompt + userPrompt + (content || ''), config.weight);
      return content || '';
    }

    function appendAIChatMessage(role, content) {
      const emptyState = aiChatMessages.querySelector('.ai-empty-state');
      if (emptyState) emptyState.remove();
      const div = document.createElement('div');
      div.className = 'ai-message ' + role;
      div.innerHTML = role === 'assistant' && typeof marked !== 'undefined' ? marked.parse(content) : escapeHtml(content);
      const time = document.createElement('div');
      time.style.cssText = 'font-size: 0.65rem; color: var(--text-secondary); margin-top: 0.2rem;';
      time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      div.appendChild(time);
      aiChatMessages.appendChild(div);
      div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      updateDefaultPromptsBar();
    }

    async function runProjectAIAction(actionKey) {
      if (!currentProject || !currentChapter) { showToast('Select a chapter and section first', 'error'); return; }
      if (!canAccessAISupervisor()) { showToast('Project AI requires Student or Pro plan.', 'error'); goToSubscription(); return; }
      const action = PROJECT_AI_ACTIONS[actionKey];
      if (!action) return;
      const ch = getChaptersStructure()[currentChapter];
      const sectionName = ch && ch.sections && ch.sections.length ? ch.sections[currentSection] : (ch ? ch.title : 'Section');
      const currentDraft = extractPlainText(sectionEditor.innerHTML);
      appendAIChatMessage('user', action.label + ' — "' + sectionName + '"');
      showTypingIndicator();

      let systemPrompt = 'You are Project AI, a research-writing assistant built specifically for this academic project. You know its research setup, chapters, and current draft. Reply concisely.';
      let userPrompt = '';
      const context = buildWorkspaceContext(true);

      try {
        if (actionKey === 'continueWriting') {
          systemPrompt += ' Continue the student\'s own draft naturally from where it stops. Do not repeat what is already written. Match the existing voice and tense. Return ONLY the continuation text (plain HTML paragraphs), no preamble.';
          userPrompt = context + '\n\nContinue the "' + sectionName + '" section from where the current draft leaves off.';
          const result = await callProjectAI(action, systemPrompt, userPrompt);
          sectionEditor.innerHTML += (sectionEditor.innerHTML.trim() ? ' ' : '') + result;
          saveCurrentSection(); await saveToFirebase();
          hideTypingIndicator(); appendAIChatMessage('assistant', 'Added a continuation to your draft.');
        } else if (actionKey === 'improveWriting') {
          systemPrompt += ' Rewrite the given text for clarity and academic flow. Do NOT change any facts, numbers, statistics, sample sizes, or citations. Return ONLY the rewritten HTML.';
          userPrompt = 'TEXT TO IMPROVE:\n' + sectionEditor.innerHTML;
          const result = await callProjectAI(action, systemPrompt, userPrompt);
          sectionEditor.innerHTML = result;
          saveCurrentSection(); await saveToFirebase();
          hideTypingIndicator(); appendAIChatMessage('assistant', 'Improved the writing in this section.');
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
          appendAIChatMessage('assistant', (regexFindings.length ? regexFindings.map(function (f) { return '- ' + f.note; }).join('\n') + '\n\n' : '') + result);
        } else if (actionKey === 'addCitations') {
          systemPrompt += ' Find claims in this section that need a citation. If a matching source exists in AVAILABLE SOURCES, insert an in-text citation for it. If no matching source exists, flag the claim as needing one instead of a citation. NEVER invent a source that is not in AVAILABLE SOURCES. Return ONLY the updated section HTML.';
          userPrompt = context + '\n\nSECTION TO ADD CITATIONS TO:\n' + sectionEditor.innerHTML;
          const result = await callProjectAI(action, systemPrompt, userPrompt);
          sectionEditor.innerHTML = result;
          saveCurrentSection(); await saveToFirebase();
          hideTypingIndicator(); appendAIChatMessage('assistant', 'Checked this section for citations — review the changes in the editor.');
        } else if (actionKey === 'reviewChapter') {
          systemPrompt += ' Classify this chapter\'s content as missing, weak, inconsistent, or unsupported, section by section. Return a short bullet list, one line per finding, formatted as "TYPE (severity): section — note".';
          userPrompt = buildFullProjectSummary() + '\n\nReview chapter: "' + (ch ? ch.title : currentChapter) + '"';
          const result = await callProjectAI(action, systemPrompt, userPrompt);
          const findings = result.split('\n').map(function (l) { return l.replace(/^[-*]\s*/, '').trim(); }).filter(Boolean).map(function (l) {
            const m = l.match(/^(missing|weak|inconsistent|unsupported)\s*\(([^)]+)\)\s*:\s*([^:]*)[:—-]\s*(.*)$/i);
            return m ? { type: m[1].toLowerCase(), severity: m[2].toLowerCase(), section: m[3].trim(), note: m[4].trim() } : { type: 'weak', severity: 'medium', section: '', note: l };
          });
          if (!currentProject.reviewFindings) currentProject.reviewFindings = {};
          currentProject.reviewFindings[currentChapter] = { findings: findings, computedAt: Date.now() };
          await database.ref('history/' + scopeUid + '/projects/' + currentProjectId + '/reviewFindings/' + currentChapter).set({ findings: findings, computedAt: firebase.database.ServerValue.TIMESTAMP });
          logActivity('chapter_reviewed', ch ? ch.title : currentChapter);
          hideTypingIndicator(); appendAIChatMessage('assistant', 'Chapter review complete — see the Review screen for the full findings list.');
          if (screens.review && screens.review.classList.contains('active')) renderReviewScreen();
        }
      } catch (err) {
        hideTypingIndicator();
        reportError(err, 'project AI action: ' + actionKey);
        appendAIChatMessage('assistant', 'Sorry, that action failed: ' + (err.message || 'unknown error'));
      }
    }

    function renderProjectAIActions() {
      if (!projectAIActions) return;
      projectAIActions.innerHTML = Object.keys(PROJECT_AI_ACTIONS).map(function (key) {
        const a = PROJECT_AI_ACTIONS[key];
        return '<button type="button" class="proj-ai-action-btn" data-action="' + key + '" title="' + a.label + '"><i class="bx ' + a.icon + '"></i> ' + a.label + '</button>';
      }).join('');
      projectAIActions.querySelectorAll('.proj-ai-action-btn').forEach(function (btn) {
        btn.addEventListener('click', function () { runProjectAIAction(btn.dataset.action); });
      });
    }

    // =========================================================================
    // VERSION HISTORY (ported)
    // =========================================================================
    const MAX_VERSIONS = 10;

    async function saveVersion() {
      if (!currentProject || !currentChapter) return;
      saveCurrentSection();
      const ch = getChaptersStructure()[currentChapter];
      const content = ch && ch.sections && ch.sections.length > 0 ? currentProject.chapters[currentChapter].sections[currentSection] : currentProject.chapters[currentChapter].content;
      if (!content || content.trim().length < 50) return;
      if (!currentProject._versions) currentProject._versions = {};
      if (!currentProject._versions[currentChapter]) currentProject._versions[currentChapter] = {};
      if (!currentProject._versions[currentChapter][currentSection]) currentProject._versions[currentChapter][currentSection] = [];
      const versions = currentProject._versions[currentChapter][currentSection];
      if (versions.length > 0 && versions[0].content === content) return;
      versions.unshift({ content: content, timestamp: Date.now(), date: new Date().toLocaleString() });
      if (versions.length > MAX_VERSIONS) versions.length = MAX_VERSIONS;
      await saveToFirebase();
      updateVersionList();
    }

    function updateVersionList() {
      if (!versionList || !currentProject || !currentProject._versions) return;
      const versions = (currentProject._versions[currentChapter] || {})[currentSection] || [];
      if (versions.length === 0) { versionList.innerHTML = '<small style="color:var(--text-secondary);">No previous versions</small>'; return; }
      versionList.innerHTML = versions.map(function (v, i) { return '<div class="version-item"><span>' + v.date + '</span><button class="restore-version-btn" data-index="' + i + '">Restore</button></div>'; }).join('');
      document.querySelectorAll('.restore-version-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) { restoreVersion(parseInt(e.target.dataset.index)); });
      });
    }

    function restoreVersion(index) {
      const versions = currentProject && currentProject._versions ? (currentProject._versions[currentChapter] || {})[currentSection] : null;
      if (!versions || !versions[index]) return;
      if (!confirm('Restore this version? Current content will be saved as a new version first.')) return;
      saveVersion();
      sectionEditor.innerHTML = versions[index].content;
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
          if (scoreAILikelyEl) scoreAILikelyEl.textContent = 'AI Patterns: ' + deep.details.aiCount;
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
          if (scoreAILikelyEl) scoreAILikelyEl.textContent = 'AI-Likelihood: ' + score.aiLikelihood + '%';
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
      if (!modelId) { showToast('Humanization requires Student plan or higher.', 'error'); goToSubscription(); return; }
      const sourceHtml = sectionEditor.innerHTML;
      if (!sourceHtml || extractPlainText(sourceHtml).trim().length < 50) { showToast('Write some content in this section first.', 'error'); return; }
      await saveVersion();
      const profile = currentProject.writingProfile || 'undergraduate';
      const profileGuidance = getProfileGuidance(profile);
      const referenceStyle = getReferenceStyle();
      const humanizationRules = buildHumanizationPrompt();
      const systemPrompt = 'You are an expert at rewriting academic text to sound naturally human-written.\nYour job is to change STYLE and VOICE only, never change facts, numbers, sample sizes, statistics, or citations.\nWrite in first-person student voice.\n' + PUNCTUATION_RULES;
      const userPrompt = 'REWRITE the text below to sound like a real ' + profile + ' healthcare student wrote it.\nThe project is about: "' + currentProject.title + '"\n\nSTRICT RULES:\n- Change ONLY the writing style, voice, and phrasing.\n- Do NOT change any numbers, statistics, sample sizes, participant counts, or citations.\n- Preserve all ' + referenceStyle + ' citations exactly as written.\n\nWRITING PROFILE:\n' + profileGuidance + '\n\n' + humanizationRules + '\n\nTEXT TO REWRITE:\n' + sourceHtml.substring(0, 6000) + '\n\nReturn ONLY the rewritten HTML. No markdown fences. If the source text is empty, respond with "EMPTY_SOURCE".';
      showToast('Humanizing...', 'info', 2500);
      try {
        const config = await window.RehablixAIQuotaCore.resolveModelConfig(modelId);
        if (!config) throw new Error('AI service not configured');
        if (currentUser) await window.RehablixAIQuotaCore.checkQuotaOrThrow(currentUser.uid, currentPlan);
        const response = await fetch(config.endpoint + '/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
          body: JSON.stringify({ model: config.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], max_tokens: config.maxTokens, temperature: config.temperature, top_p: config.top_p })
        });
        if (!response.ok) { const err = await response.json().catch(function () { return {}; }); throw new Error((err.error && err.error.message) || 'AI service error'); }
        const data = await response.json();
        const raw = data.choices && data.choices[0] && data.choices[0].message.content;
        const cleaned = raw ? cleanAIResponse(raw) : '';
        if (!cleaned || cleaned.includes('EMPTY_SOURCE') || cleaned.length < 50) throw new Error('Humanization produced no usable output');
        if (currentUser) window.RehablixAIQuotaCore.reportTokenUsage(currentUser.uid, currentPlan, systemPrompt + userPrompt + cleaned, config.weight);
        sectionEditor.innerHTML = cleaned;
        saveCurrentSection(); await saveToFirebase();
        displayHumanizationScore(); updateVersionList();
        showToast('Section humanized', 'success');
      } catch (err) {
        reportError(err, 'humanize section');
        showToast('Humanization failed: ' + (err.message || 'Unknown error'), 'error', 5000);
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
      if (aiGenerateSectionBtn) aiGenerateSectionBtn.innerHTML = hasContent ? '<i class="fas fa-redo"></i> Regenerate Section' : '<i class="fas fa-magic"></i> AI Generate This Section';
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
    async function loadProjects() {
      if (!currentUser) return;
      try {
        const snap = await database.ref('history/' + scopeUid + '/projects').once('value');
        projects = snap.val() || {};
        updateProjectSelector();
      } catch (error) { reportError(error, 'project load'); }
    }

    function updateProjectSelector() {
      if (!currentProjectSelect) return;
      const ids = Object.keys(projects);
      if (ids.length === 0) { currentProjectSelect.innerHTML = '<option value="">No projects</option>'; return; }
      currentProjectSelect.innerHTML = ids.map(function (id) { return '<option value="' + id + '"' + (id === currentProjectId ? ' selected' : '') + '>' + escapeHtml(projects[id].title || 'Untitled') + '</option>'; }).join('');
    }

    async function switchToProject(id) {
      if (!projects[id]) { showToast('Project not found', 'error'); return; }
      if (currentProjectId && currentProject) { saveCurrentSection(); await saveToFirebase(); }
      currentProjectId = id;
      currentProject = projects[id];
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

      const hasChatHistory = await loadChatHistory();
      if (!hasChatHistory) clearChatHistory();

      setProjectActive(true); // REDESIGN (item 3): reveal the tab layout now that a project is open
      switchScreen('dashboard');
      showToast('Switched to "' + currentProject.title + '"', 'info');
    }

    async function createNewProject() {
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
        chapters: {}, _versions: {}, _supervisorPersonality: supervisorPersonality,
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
        projects[id] = newProject;
        if (window.RehablixCenter) window.RehablixCenter.logActivity('project', 'Created project', newProject.title || 'Untitled project').catch(function () {});
        currentProjectId = id; currentProject = newProject; currentChapter = 'chapter1'; currentSection = 0;
        incrementProjectCount();
        projectModal.classList.remove('active');
        renderChapters(); loadSectionContent(); updateProjectSelector(); updateModificationArea(); clearChatHistory();
        setProjectActive(true);
        switchScreen('setup');
        showToast('Project created. Fill in Research Setup to help Project AI understand your study.', 'success');
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
      if (!aiConfig.token) await fetchTokens();
      const systemPrompt = 'You are an academic research analyzer. Analyze the following document and extract:\n1. Key findings and conclusions\n2. Methodology used (if applicable)\n3. Important statistics, numbers, and data points\n4. Theoretical frameworks referenced\n5. Key authors and citations\n6. Relevance to healthcare/medical research\nProvide a detailed, structured summary that can be used as reference for academic writing.';
      try {
        const response = await fetch(aiConfig.endpoint + '/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + aiConfig.token },
          body: JSON.stringify({ model: aiConfig.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: 'Document: ' + fileName + '\n\nContent: ' + text.substring(0, 8000) }], max_tokens: 1500, temperature: 0.4 })
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
      if (resources.length === 0) { resourceList.innerHTML = '<div class="empty-state" style="padding:1.5rem;"><i class="bx bx-cloud-upload"></i><p style="font-size:0.85rem;">No resources uploaded</p><small>Upload articles, journals, or past projects for AI reference</small></div>'; return; }
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
          await saveToFirebase();
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
          await saveToFirebase();
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
      sectionEditor.focus();
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

    async function saveToFirebase() {
      if (!currentUser || !currentProjectId || !currentProject) return;
      try {
        const updateData = {
          chapters: currentProject.chapters, _versions: currentProject._versions || {},
          writingProfile: currentProject.writingProfile || 'undergraduate', wordCountPref: currentProject.wordCountPref || 'auto',
          customWordCount: currentProject.customWordCount || 500, referenceStyle: currentProject.referenceStyle || 'APA 7th',
          _supervisorPersonality: supervisorPersonality, updatedAt: firebase.database.ServerValue.TIMESTAMP
        };
        if (currentProject._customOutline) updateData._customOutline = currentProject._customOutline;
        await database.ref('history/' + scopeUid + '/projects/' + currentProjectId).update(updateData);
        projects[currentProjectId] = JSON.parse(JSON.stringify(currentProject));
        unsavedChanges = false; updateUnsavedIndicator();
      } catch (error) { reportError(error, 'save'); }
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
    // AI GENERATION (ported near-verbatim — legacy DeepSeek client kept for
    // this pass; see notes on migrating to ai-quota-core.js)
    // =========================================================================
    function updateProgressStage(message, detail) { if (progressStage) progressStage.textContent = message; if (progressDetail) progressDetail.textContent = detail || ''; }
    function updateProgressBar(percent) { if (progressBarFill) progressBarFill.style.width = Math.min(100, Math.max(0, percent)) + '%'; }

    async function callAIWithCancel(systemPrompt, userPrompt, maxTokens, temp, topP, freqPenalty, presPenalty) {
      const response = await fetch(aiConfig.endpoint + '/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + aiConfig.token },
        body: JSON.stringify({ model: aiConfig.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], max_tokens: maxTokens, temperature: temp, top_p: topP, frequency_penalty: freqPenalty, presence_penalty: presPenalty }),
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

    async function generateSection(sectionName, chapterKey, sectionIndex) {
      if (!aiConfig.token) { const ok = await fetchTokens(); if (!ok) throw new Error('AI service not configured'); }
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

      let content = '';
      const pass1SystemPrompt = 'You are a knowledgeable academic writer specializing in healthcare education.\nWrite well-structured academic content with proper HTML formatting and ' + referenceStyle + ' citations.\nYou MUST stay strictly on the provided project topic and use ONLY the facts, numbers, and methodology details provided in the context.\nNEVER invent sample sizes, participant counts, statistics, or instruments not mentioned in the context.\n' + (resources.length > 0 ? 'Use the uploaded resources as authoritative sources. Cite them where relevant.\n' : '') + PUNCTUATION_RULES + '\nUse ONLY standard punctuation: periods, commas, colons, semicolons, question marks. Never use dashes or special characters.';
      const pass1UserPrompt = 'CONSISTENCY RULES - NON-NEGOTIABLE:\n- The project title is "' + currentProject.title + '". Every sentence must relate to THIS specific topic.\n- Use ONLY the sample sizes, participant counts, and statistics stated in the context below. Do not invent new ones.\n- If Chapter 3 context specifies a sample of n=X participants, ALL results and discussion must use n=X.\n- Do not introduce new research instruments, designs, or theoretical frameworks not already established.\n- Maintain exactly the same research approach (' + approach + ') throughout.\n\nWrite the "' + sectionName + '" section for:\nPROJECT: "' + currentProject.title + '"\nDEPARTMENT: ' + currentProject.department + '\n\nFULL PROJECT CONTEXT (all established facts, follow exactly):\n' + contextSummary + '\n\nRESEARCH APPROACH: ' + approach + '\nREFERENCE STYLE: ' + referenceStyle + ', use proper in-text citations throughout.\n' + wordInstruction + '\n' + (modification ? '\nSPECIAL INSTRUCTIONS FROM STUDENT: ' + modification + '\n' : '') + '\nWrite comprehensive, well-argued academic content using HTML structure (h2/h3 headings, paragraphs, lists).\nReturn ONLY the HTML. No markdown fences. No preamble. Do not leave the response empty.';

      let attempts = 0;
      while (attempts < 3) {
        const pass1Response = await callAIWithCancel(pass1SystemPrompt, pass1UserPrompt, maxTokensPass1, 0.6, 0.9, 0.1, 0.1);
        content = cleanAIResponse(pass1Response.choices[0].message.content);
        if (content && content.length > 100 && /<\/?p[ >]/.test(content)) break;
        attempts++;
      }
      if (!content || content.length < 50) throw new Error('AI failed to generate a valid draft after 3 attempts. Please try again.');

      let previousContent = content;
      if (humanizeMode) {
        const pass2SystemPrompt = 'You are an expert at rewriting academic text to sound naturally human-written.\nYour job is to change STYLE and VOICE only, never change facts, numbers, sample sizes, statistics, or citations.\nWrite in first-person student voice.\n' + PUNCTUATION_RULES;
        const pass2UserPrompt = 'REWRITE the text below to sound like a real ' + profile + ' healthcare student wrote it.\nThe project is about: "' + currentProject.title + '"\n\nSTRICT RULES:\n- Change ONLY the writing style, voice, and phrasing.\n- Do NOT change any numbers, statistics, sample sizes, participant counts, or citations.\n- Preserve all ' + referenceStyle + ' citations exactly as written.\n\nWRITING PROFILE:\n' + profileGuidance + '\n\nWRITING TONE: ' + tone + '\n' + wordInstruction + '\n\n' + humanizationRules + '\n\nTEXT TO REWRITE:\n' + previousContent.substring(0, 4000) + '\n\nReturn ONLY the rewritten HTML. No markdown fences. If you see the text is empty, respond with "EMPTY_SOURCE".';
        const pass2Response = await callAIWithCancel(pass2SystemPrompt, pass2UserPrompt, maxTokensPass1 + 1000, 0.75, 0.92, 0.25, 0.2);
        const newContent = cleanAIResponse(pass2Response.choices[0].message.content);
        if (!newContent || newContent.includes('EMPTY_SOURCE') || newContent.includes('source text') || newContent.length < 100) {
          console.warn('Pass 2 produced low-quality output, keeping Pass 1 draft.');
        } else { content = newContent; previousContent = content; }
      }

      const pass3SystemPrompt = 'You are a careful academic editor. Polish text for quality while preserving all facts, numbers, and the natural human voice.\n' + PUNCTUATION_RULES + '\nEnsure all punctuation is natural. Remove any dashes or special characters.';
      const pass3UserPrompt = 'POLISH the text below. Fix grammar and formatting. Preserve all facts and tone.\n\nRULES:\n- Fix any awkward sentences or unclear transitions.\n- Ensure proper HTML heading structure (h2 for main sections, h3 for subsections).\n- Do NOT increase formality.\n- Do NOT change any numbers, sample sizes, statistics, or citations.\n- Remove any repeated phrases.\n- Use only natural punctuation.\n' + wordInstruction + '\n- All ' + referenceStyle + ' citations must be correctly formatted.\n\nTEXT TO POLISH:\n' + previousContent + '\n\nReturn ONLY the polished HTML. If the text appears empty, reply with "EMPTY_SOURCE".';
      const pass3Response = await callAIWithCancel(pass3SystemPrompt, pass3UserPrompt, 2000, 0.4, 0.9, 0.1, 0.1);
      let finalContent = cleanAIResponse(pass3Response.choices[0].message.content);
      if (!finalContent || finalContent.includes('EMPTY_SOURCE') || finalContent.includes('source text') || finalContent.length < 100) finalContent = previousContent;
      return finalContent;
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
    document.getElementById('genInstructionsSkipBtn')?.addEventListener('click', function () {
      document.getElementById('genInstructionsModal')?.classList.remove('active');
      if (genInstructionsResolver) { genInstructionsResolver(''); genInstructionsResolver = null; }
    });
    document.getElementById('closeGenInstructionsModal')?.addEventListener('click', function () {
      document.getElementById('genInstructionsModal')?.classList.remove('active');
      if (genInstructionsResolver) { genInstructionsResolver(null); genInstructionsResolver = null; } // null = cancelled entirely
    });

    aiGenerateSectionBtn.addEventListener('click', async function () {
      if (!currentProject || !currentChapter) { showToast('Select a chapter and section first', 'error'); return; }
      if (!canGenerateChapter(currentChapter)) { showToast('No active plan: Only Chapter 1 generation is available. Upgrade for full access.', 'error', 5000); goToSubscription(); return; }
      const ch = getChaptersStructure()[currentChapter];
      const hasContent = ch && ch.sections && ch.sections.length > 0
        ? (currentProject.chapters && currentProject.chapters[currentChapter] && currentProject.chapters[currentChapter].sections && (currentProject.chapters[currentChapter].sections[currentSection] || '').trim().length > 0)
        : (currentProject.chapters && currentProject.chapters[currentChapter] && (currentProject.chapters[currentChapter].content || '').trim().length > 0);
      if (hasContent && !canRegenerate()) { showToast('Regeneration requires Student or Pro plan. Upgrade for full access.', 'error', 5000); goToSubscription(); return; }
      if (!aiConfig.token) { const ok = await fetchTokens(); if (!ok) { showToast('AI service not configured', 'error'); return; } }
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
        if (!canAccessResources()) { showToast('Chapter generation requires Student plan or higher.', 'error'); goToSubscription(); return; }
        if (!currentProject || !currentChapter) return;
        const useCustom = confirm('Would you like to provide a custom outline for this chapter?\n\nClick OK to enter a custom outline, or Cancel to use the default sections.');
        let customSections = null;
        if (useCustom) { const outlineText = prompt('Enter section titles, one per line:', ''); if (outlineText && outlineText.trim()) customSections = outlineText.split('\n').filter(function (l) { return l.trim(); }); }
        const ch = getChaptersStructure()[currentChapter];
        const sections = customSections || ch.sections || [ch.title];
        if (customSections) { ensureCustomOutline(); currentProject._customOutline[currentChapter] = { title: ch.title, sections: customSections }; }
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
          if (customSections) { delete currentProject._customOutline[currentChapter]; if (Object.keys(currentProject._customOutline).length === 0) delete currentProject._customOutline; }
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

    function updateDefaultPromptsBar() {
      const hasMessages = aiChatMessages.querySelectorAll('.ai-message').length > 0;
      if (hasMessages) {
        defaultPromptsBar.style.display = 'block';
        if (defaultPromptsScroll.children.length === 0) {
          const prompts = ['Review my current section for clarity', 'Suggest improvements for this chapter', 'Help me with my methodology approach', 'What key points should I cover in this section?'];
          defaultPromptsScroll.innerHTML = prompts.map(function (t) { return '<span class="suggested-prompt-chip">' + t + '</span>'; }).join('');
          defaultPromptsScroll.querySelectorAll('.suggested-prompt-chip').forEach(function (chip) { chip.addEventListener('click', function () { aiMessageInput.value = chip.textContent; aiSendBtn.click(); }); });
        }
      } else defaultPromptsBar.style.display = 'none';
    }

    function clearChatHistory() {
      aiChatMessages.innerHTML = '<div class="ai-empty-state"><i class="fas fa-robot"></i><p>Project AI is ready</p><small>Ask about this project, or use the quick actions above for common tasks</small></div>';
      updateDefaultPromptsBar();
    }

    async function loadChatHistory() {
      if (!currentUser || !currentProjectId) return false;
      try {
        const snap = await database.ref('history/' + scopeUid + '/projects/' + currentProjectId + '/chatHistory').once('value');
        const data = snap.val();
        if (data && data.messages && data.messages.length > 0) {
          aiChatMessages.innerHTML = '';
          data.messages.forEach(function (msg) {
            const div = document.createElement('div');
            div.className = 'ai-message ' + msg.role;
            div.innerHTML = msg.role === 'assistant' && typeof marked !== 'undefined' ? marked.parse(msg.content) : msg.content;
            const time = document.createElement('div');
            time.style.cssText = 'font-size: 0.65rem; color: var(--text-secondary); margin-top: 0.2rem;';
            time.textContent = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            div.appendChild(time);
            aiChatMessages.appendChild(div);
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
          const clone = el.cloneNode(true);
          const timeEl = clone.querySelector('div[style*="font-size: 0.65rem"]');
          if (timeEl) timeEl.remove();
          messages.push({ role: isUser ? 'user' : 'assistant', content: clone.innerHTML || clone.textContent, timestamp: Date.now() });
        });
        if (messages.length > 0 && !aiChatMessages.querySelector('.ai-empty-state')) {
          await database.ref('history/' + scopeUid + '/projects/' + currentProjectId + '/chatHistory').set({ messages: messages.slice(-100), updatedAt: firebase.database.ServerValue.TIMESTAMP });
        }
      } catch (error) { console.error('Error saving chat history:', error); }
    }

    aiSendBtn.addEventListener('click', async function () {
      if (!canAccessAISupervisor()) { showToast('Project AI requires Student or Pro plan. Upgrade for full access.', 'error', 5000); goToSubscription(); return; }
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
            if (content && content.trim().length > 50) summary += '\n\n[' + ch.title + ' - ' + sec + ']:\n' + extractPlainText(content).substring(0, 500);
          });
        } else if (ch) {
          const content = getSectionContent(key, 0);
          if (content && content.trim().length > 50) summary += '\n\n[' + ch.title + ']:\n' + extractPlainText(content).substring(0, 500);
        }
      }
      return summary;
    }

    // REDESIGN: routed through js/ai-quota-core.js instead of the legacy
    // hardcoded client, since this is the primary "Project AI" surface.
    async function callProjectAIChat(userMessage) {
      const config = await window.RehablixAIQuotaCore.resolveModelConfig('corpus101');
      if (!config) throw new Error('AI not configured');
      if (currentUser) await window.RehablixAIQuotaCore.checkQuotaOrThrow(currentUser.uid, currentPlan);
      const fullContext = buildFullProjectSummary();
      const strictnessGuides = {
        easy: 'Be supportive and encouraging. Offer gentle suggestions. Focus on strengths while nudging toward improvement.',
        moderate: 'Provide balanced feedback. Acknowledge strengths but clearly point out areas that need work. Be direct but constructive.',
        strict: 'Be rigorous and demanding. Hold the student to high academic standards. Point out all weaknesses, inconsistencies, and gaps. Challenge their thinking.'
      };
      const systemPrompt = 'You are Project AI, ' + supervisorPersonality.profession + ', an assistant purpose-built for this specific academic project (not a general chatbot).\nProject: ' + (currentProject ? currentProject.title : 'N/A') + '\nDepartment: ' + (currentProject ? currentProject.department : 'N/A') + '\nApproach: ' + (currentProject && currentProject.approach === 'qualitative' ? 'Qualitative' : 'Quantitative') + '\n\nYour strictness: ' + strictnessGuides[supervisorPersonality.strictness] + '\n\nFULL PROJECT CONTENT (research setup, all chapters and sections, available references):\n' + fullContext.substring(0, 8000) + '\n\nRULES:\n1. Give concise, direct answers using key points.\n2. Reference specific chapters, sections, or research-setup fields as needed.\n3. Flag inconsistencies immediately.\n4. Use simple language, key-points format.\n5. Be thorough but brief.';
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

    // Tools icon (REDESIGN Round 3): rolls down a small dropdown with a
    // Reference shortcut (opens the Add Reference modal directly) and a
    // "More" shortcut (navigates to the full Project Tools screen) instead
    // of navigating straight to Tools like it used to.
    const toolsDropdownWrap = document.getElementById('toolsDropdownWrap');
    const toolsDropdownBtn = document.getElementById('toolsDropdownBtn');
    if (toolsDropdownBtn && toolsDropdownWrap) {
      toolsDropdownBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        const open = toolsDropdownWrap.classList.toggle('open');
        toolsDropdownBtn.setAttribute('aria-expanded', String(open));
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
        aiMessageInput.placeholder = access ? 'Ask Project AI...' : 'Upgrade to Student or Pro for Project AI chat';
      }
    }

    // =========================================================================
    // AUTH & INIT
    // =========================================================================
    let lastAuthUid = null;
    const unsubAuth = firebase.auth().onAuthStateChanged(async function (user) {
      const uidChanged = lastAuthUid !== null && (!user || user.uid !== lastAuthUid);
      if (uidChanged) { currentProjectId = null; currentProject = null; setProjectActive(false); switchScreen('projects'); }
      lastAuthUid = user ? user.uid : null;
      currentUser = user;

      if (user) {
        if (window.RehablixCenter && typeof window.RehablixCenter.getEffectiveScopeUid === 'function') {
          try { scopeUid = await window.RehablixCenter.getEffectiveScopeUid('project'); } catch (err) { scopeUid = user.uid; }
        } else scopeUid = user.uid;
        if (scopeUid === null) { showToast('Your access to Projects has been turned off by your center admin.', 'error', 6000); return; }
        else if (scopeUid !== user.uid) showToast('Working on your center shared projects', 'info', 3000);

        await fetchTokens();
        await loadProjects();
        projectsLoaded = true;

        // REDESIGN (item 3): land on the "All Projects" list rather than
        // auto-opening the most recently edited project — the student picks
        // which project to continue from the card grid (or resumes the one
        // already open, if any, via the breadcrumb/nav still being visible).
        if (!currentProjectId) {
          setProjectActive(false);
          switchScreen('projects', { suppressHistory: true });
        }
      } else {
        currentProjectId = null; currentProject = null;
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
