// js/study.js
// Study Buddy: turns notes/files into a summary + flashcards + quiz, tracks
// real spaced-repetition (Leitner system) per flashcard, and maintains a
// shared per-subject topic-mastery record in Firebase that Exam Simulator
// (exam.js) reads from and writes back to — that shared record is the sync
// between the two tools.

(function () {
  let cleanupFns = [];

  function mount() {
  const database = firebase.database();
  const auth = firebase.auth();

  // ===== AI Config =====
  let aiConfig = { token: null, endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash' };
  async function fetchTokens() {
    if (aiConfig.token) return true;
    try {
      const snap = await database.ref('tokens/deepseek').once('value');
      const data = snap.val();
      if (data?.api_key) { aiConfig.token = data.api_key; return true; }
      return false;
    } catch (err) {
      console.error('Token fetch error:', err);
      return false;
    }
  }

  async function callAI(systemPrompt, userPrompt, maxTokens = 2500) {
    if (!aiConfig.token) {
      const ok = await fetchTokens();
      if (!ok) throw new Error('AI service is not configured.');
    }
    const response = await fetch(`${aiConfig.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiConfig.token}` },
      body: JSON.stringify({
        model: aiConfig.model,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        max_tokens: maxTokens,
        temperature: 0.5
      })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `AI service error (${response.status})`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
  }

  function parseAIJson(text) {
    let cleaned = (text || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1) cleaned = cleaned.slice(start, end + 1);
    return JSON.parse(cleaned);
  }

  // ===== State =====
  let currentUser = null;
  let scopeUid = null; // center owner's uid for center members, so study sets/subjects are shared
  let subjects = {};          // subjectId -> {name, topics:{topicId:{name,masteryScore,timesReviewed,lastActivity}}, createdAt}
  let studySets = {};         // setId -> {subjectId, title, summary, flashcards:[], quiz:[], createdAt}
  let activeSubjectId = null;
  let activeSetIds = [];      // all study set ids belonging to the active subject
  let flashcardQueue = [];    // working queue for the review session
  let currentCardIndex = 0;
  let quizState = null;       // {questions, index, answers, score, topicResults}

  // ===== DOM refs =====
  const $ = (id) => document.getElementById(id);
  // History lives in the shell's single global drawer (js/history-drawer.js);
  // this view registers its data source as a provider (see the History section).
  const viewDashboard = $('viewDashboard');
  const viewCreate = $('viewCreate');
  const viewSubject = $('viewSubject');

  function showView(view) {
    [viewDashboard, viewCreate, viewSubject].forEach(v => v.style.display = 'none');
    view.style.display = '';
  }

  function showLoading(text) {
    $('loadingText').textContent = text || 'Working…';
    $('loadingOverlay').style.display = 'flex';
  }
  function hideLoading() { $('loadingOverlay').style.display = 'none'; }

  // ===== Toast =====
  function showToast(message, type = 'success', duration = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.cssText = 'background:var(--study-surface,#fff);border:1px solid var(--study-border,#e5e7eb);color:var(--study-text,#111);padding:0.8rem 1.1rem;border-radius:0.7rem;box-shadow:0 8px 24px rgba(0,0,0,0.15);margin-top:0.5rem;font-size:0.85rem;max-width:320px;';
    if (type === 'error') toast.style.borderColor = '#dc2626';
    if (type === 'success') toast.style.borderColor = '#16a34a';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, duration);
  }

  // =========================================================================
  // Spaced repetition (Leitner system, 5 boxes, day-based intervals)
  // =========================================================================
  const LEITNER_INTERVALS_DAYS = [0, 1, 2, 4, 8, 16]; // index = box (1-5)

  function gradeCard(card, grade) {
    // grade: 'again' | 'hard' | 'good' | 'easy'
    let box = card.box || 1;
    if (grade === 'again') box = 1;
    else if (grade === 'hard') box = Math.max(1, box - 1) || 1;
    else if (grade === 'good') box = Math.min(5, box + 1);
    else if (grade === 'easy') box = Math.min(5, box + 2);
    const intervalDays = LEITNER_INTERVALS_DAYS[box] || 1;
    const nextReview = Date.now() + intervalDays * 24 * 60 * 60 * 1000;
    return { box, nextReview, timesReviewed: (card.timesReviewed || 0) + 1 };
  }

  // =========================================================================
  // Shared subject/topic mastery — this is what synchronizes with exam.js
  // =========================================================================
  async function loadSubjects() {
    if (!currentUser) return;
    const snap = await database.ref(`history/${scopeUid}/subjects`).once('value');
    subjects = snap.val() || {};
  }

  async function loadStudySets() {
    if (!currentUser) return;
    const snap = await database.ref(`history/${scopeUid}/study/sets`).once('value');
    studySets = snap.val() || {};
  }

  async function getOrCreateSubject(name) {
    const trimmed = name.trim();
    const existingId = Object.keys(subjects).find(id => (subjects[id].name || '').toLowerCase() === trimmed.toLowerCase());
    if (existingId) return existingId;
    const ref = database.ref(`history/${scopeUid}/subjects`).push();
    const record = { name: trimmed, topics: {}, createdAt: firebase.database.ServerValue.TIMESTAMP };
    await ref.set(record);
    subjects[ref.key] = { name: trimmed, topics: {}, createdAt: Date.now() };
    return ref.key;
  }

  // Blends the new performance into the topic's existing mastery score
  // rather than overwriting it, so a single bad quiz doesn't erase progress
  // and a single lucky guess doesn't inflate it.
  async function updateTopicMastery(subjectId, topicName, correct, total) {
    if (!subjectId || !topicName || total === 0) return;
    const topicId = topicName.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40) || 'general';
    const path = `history/${scopeUid}/subjects/${subjectId}/topics/${topicId}`;
    const snap = await database.ref(path).once('value');
    const existing = snap.val() || { name: topicName, masteryScore: 50, timesReviewed: 0 };
    const newPerformance = (correct / total) * 100;
    const blended = existing.timesReviewed > 0
      ? Math.round(existing.masteryScore * 0.65 + newPerformance * 0.35)
      : Math.round(newPerformance);
    const updated = {
      name: topicName,
      masteryScore: Math.max(0, Math.min(100, blended)),
      timesReviewed: (existing.timesReviewed || 0) + 1,
      lastActivity: new Date().toISOString()
    };
    await database.ref(path).set(updated);
    if (!subjects[subjectId].topics) subjects[subjectId].topics = {};
    subjects[subjectId].topics[topicId] = updated;
  }

  function subjectOverallMastery(subjectId) {
    const topics = subjects[subjectId]?.topics || {};
    const scores = Object.values(topics).map(t => t.masteryScore || 0);
    if (scores.length === 0) return null;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }

  function masteryColor(score) {
    if (score === null) return '#9ca3af';
    if (score >= 75) return 'var(--study-green)';
    if (score >= 45) return 'var(--study-amber)';
    return 'var(--study-red)';
  }

  // =========================================================================
  // Due-card calculation (across all subjects)
  // =========================================================================
  function allFlashcards() {
    const cards = [];
    Object.entries(studySets).forEach(([setId, set]) => {
      (set.flashcards || []).forEach((c, i) => cards.push({ ...c, setId, cardIndex: i, subjectId: set.subjectId }));
    });
    return cards;
  }

  function dueCardsCount() {
    const now = Date.now();
    return allFlashcards().filter(c => !c.nextReview || c.nextReview <= now).length;
  }

  function refreshDueBanner() {
    const due = dueCardsCount();
    const banner = $('dueBanner');
    if (due > 0) {
      $('dueCount').textContent = due;
      $('duePlural').textContent = due === 1 ? '' : 's';
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }
  }

  // =========================================================================
  // Dashboard rendering
  // =========================================================================
  function renderDashboard() {
    const grid = $('subjectsGrid');
    if (!grid) return; // view was unmounted (navigated away) before this async callback resolved
    const ids = Object.keys(subjects);
    if (ids.length === 0) {
      grid.innerHTML = `<div class="empty-state"><i class="fas fa-book-open"></i><p>No subjects yet — create your first study set to get started.</p></div>`;
      refreshDueBanner();
      return;
    }
    grid.innerHTML = ids.map(id => {
      const s = subjects[id];
      const mastery = subjectOverallMastery(id);
      const cardCount = allFlashcards().filter(c => c.subjectId === id).length;
      const dueCount = allFlashcards().filter(c => c.subjectId === id && (!c.nextReview || c.nextReview <= Date.now())).length;
      return `
      <div class="subject-card" data-id="${id}">
        <div>
          <div class="subject-card-title">${escapeHtml(s.name)}</div>
          <div class="subject-card-meta">${cardCount} card${cardCount === 1 ? '' : 's'} · ${Object.keys(s.topics || {}).length} topic${Object.keys(s.topics || {}).length === 1 ? '' : 's'}</div>
        </div>
        <div class="mastery-bar-track"><div class="mastery-bar-fill" style="width:${mastery ?? 0}%;"></div></div>
        <div class="subject-card-footer">
          <span>${mastery === null ? 'Not tested yet' : mastery + '% mastery'}</span>
          ${dueCount > 0 ? `<span class="subject-due-badge">${dueCount} due</span>` : ''}
        </div>
      </div>`;
    }).join('');
    grid.querySelectorAll('.subject-card').forEach(card => {
      card.addEventListener('click', () => openSubject(card.dataset.id));
    });
    refreshDueBanner();
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // =========================================================================
  // Create Study Set flow
  // =========================================================================
  let uploadedText = '';

  $('newSubjectBtn').addEventListener('click', () => {
    if (!currentUser) { showToast('Please log in to create a study set', 'info'); document.getElementById('loginBtn')?.click(); return; }
    if (window.rehabPlans && !window.rehabPlans.isFeatureAllowed('study')) {
      window.rehabPlans.showUpgradePrompt('study');
      return;
    }
    const datalist = $('existingSubjectsList');
    datalist.innerHTML = Object.values(subjects).map(s => `<option value="${escapeHtml(s.name)}"></option>`).join('');
    showView(viewCreate);
  });

  $('cancelCreateBtn').addEventListener('click', () => showView(Object.keys(subjects).length ? viewDashboard : viewDashboard));

  $('studyAttachBtn').addEventListener('click', () => $('studyFileInput').click());
  $('studyFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    $('fileInfo').style.display = 'inline-flex';
    $('fileInfo').innerHTML = `<i class="fas fa-spinner fa-spin"></i> Extracting ${escapeHtml(file.name)}…`;
    try {
      uploadedText = await extractFileText(file);
      $('fileInfo').innerHTML = `<i class="fas fa-check"></i> ${escapeHtml(file.name)} <button id="removeFileBtn"><i class="fas fa-times"></i></button>`;
      $('removeFileBtn').addEventListener('click', () => { uploadedText = ''; $('fileInfo').style.display = 'none'; e.target.value = ''; });
    } catch (err) {
      console.error(err);
      $('fileInfo').innerHTML = `<i class="fas fa-exclamation-triangle"></i> Could not read file`;
      showToast('Could not extract text from that file', 'error');
    }
  });

  async function extractFileText(file) {
    const name = file.name.toLowerCase();
    if (file.type === 'text/plain' || name.endsWith('.txt')) return await file.text();
    if (name.endsWith('.pdf')) {
      if (typeof pdfjsLib !== 'undefined') pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      let text = '';
      const maxPages = Math.min(pdf.numPages, 20);
      for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(it => it.str).join(' ') + '\n';
      }
      return text.trim();
    }
    if (name.endsWith('.docx') || name.endsWith('.doc')) {
      const buf = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: buf });
      return (result.value || '').trim();
    }
    if (file.type.startsWith('image/')) {
      const result = await Tesseract.recognize(file, 'eng');
      return (result.data.text || '').trim();
    }
    throw new Error('Unsupported file type');
  }

  $('generateSetBtn').addEventListener('click', async () => {
    const subjectName = $('subjectInput').value.trim();
    const notes = ($('notesInput').value.trim() || uploadedText || '').trim();
    if (!subjectName) { showToast('Please enter a subject name', 'warning'); return; }
    if (!notes) { showToast('Please paste some notes or attach a file', 'warning'); return; }

    const flashcardCount = Math.min(40, Math.max(5, parseInt($('flashcardCount').value, 10) || 15));
    const quizCount = Math.min(20, Math.max(3, parseInt($('quizCount').value, 10) || 8));

    showLoading('Analyzing your material…');
    try {
      // EMR UPGRADE (item 9): quota check — Study had no token-cap enforcement at all before this (its monthly generation-count limit is separate).
      if (currentUser && window.RehabPlanTiers) {
        const plan = (window.rehabPlans && window.rehabPlans.getCurrentPlan()) || 'free';
        const quota = window.RehablixQuotaModal
          ? await window.RehablixQuotaModal.checkAndWarn(currentUser.uid, plan)
          : await window.RehabPlanTiers.hasQuota(currentUser.uid, plan);
        if (!quota.allowed) {
          const resetMins = Math.max(1, Math.ceil((quota.resetAt - Date.now()) / 60000));
          throw new Error(`You've used your token budget for this window. It resets in about ${resetMins} minute(s).`);
        }
      }
      const systemPrompt = `You are an expert study coach for rehabilitation/healthcare students. From the material given, produce a JSON object with EXACTLY these keys and nothing else (no markdown, no code fences, no commentary):
{
  "summary": "a well-structured markdown summary (headings, bullet points) of the key concepts, 200-400 words",
  "topics": ["3-6 short topic names that organize the material"],
  "flashcards": [{"front": "question or term", "back": "concise answer", "topic": "one of the topic names above"}],
  "quiz": [{"question": "...", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "why that's correct", "topic": "one of the topic names above"}]
}
Generate exactly ${flashcardCount} flashcards and exactly ${quizCount} quiz questions. Flashcards should test recall of specific facts/definitions. Quiz questions should test understanding, not just memorization. Every topic value must exactly match one of the strings in "topics".`;
      const userPrompt = `Subject: ${subjectName}\n\nMaterial:\n${notes.slice(0, 12000)}`;

      const response = await callAI(systemPrompt, userPrompt, 4000);
      if (currentUser && window.RehabPlanTiers) { // EMR UPGRADE (item 9)
        const plan = (window.rehabPlans && window.rehabPlans.getCurrentPlan()) || 'free';
        window.RehabPlanTiers.consumeQuota(currentUser.uid, plan, window.RehabPlanTiers.estimateTokens(systemPrompt + userPrompt + response), 1).catch(() => {});
      }
      const parsed = parseAIJson(response);

      if (!parsed.flashcards || !parsed.quiz || !parsed.topics) throw new Error('AI response was missing required fields');

      const subjectId = await getOrCreateSubject(subjectName);

      // Register any new topics with a neutral starting mastery score.
      for (const topicName of parsed.topics) {
        const topicId = topicName.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40) || 'general';
        if (!subjects[subjectId].topics || !subjects[subjectId].topics[topicId]) {
          await database.ref(`history/${scopeUid}/subjects/${subjectId}/topics/${topicId}`).set({ name: topicName, masteryScore: 50, timesReviewed: 0, lastActivity: new Date().toISOString() });
        }
      }
      await loadSubjects();

      const flashcards = parsed.flashcards.map((c, i) => ({
        id: 'c_' + Date.now() + '_' + i,
        front: c.front, back: c.back, topic: c.topic || parsed.topics[0],
        box: 1, nextReview: Date.now(), timesReviewed: 0
      }));

      const setRef = database.ref(`history/${scopeUid}/study/sets`).push();
      const setRecord = {
        subjectId,
        title: `${subjectName} — ${new Date().toLocaleDateString()}`,
        summary: parsed.summary,
        topics: parsed.topics,
        flashcards,
        quiz: parsed.quiz,
        createdAt: firebase.database.ServerValue.TIMESTAMP
      };
      await setRef.set(setRecord);
      studySets[setRef.key] = { ...setRecord, createdAt: Date.now() };

      hideLoading();
      showToast('Study set generated!', 'success');
      $('subjectInput').value = '';
      $('notesInput').value = '';
      uploadedText = '';
      $('fileInfo').style.display = 'none';
      openSubject(subjectId);
    } catch (error) {
      console.error(error);
      hideLoading();
      showToast('Error generating study set: ' + (error.message || 'unknown error'), 'error', 6000);
    }
  });

  // =========================================================================
  // Subject view
  // =========================================================================
  function setsOf(subjectId) {
    return Object.keys(studySets).filter(id => studySets[id].subjectId === subjectId)
      .sort((a, b) => (studySets[b].createdAt || 0) - (studySets[a].createdAt || 0));
  }

  function openSubject(subjectId, tab) {
    activeSubjectId = subjectId;
    activeSetIds = setsOf(subjectId);
    reviewAllSubjects = false;
    $('subjectTitle').textContent = subjects[subjectId]?.name || 'Subject';
    showView(viewSubject);
    switchTab(tab || 'overview');
  }

  $('backToDashboardBtn').addEventListener('click', () => { renderDashboard(); showView(viewDashboard); });

  $('practiceExamBtn').addEventListener('click', () => {
    if (!activeSubjectId) return;
    window.RehablixRouter.go(`index.html?subject=${activeSubjectId}&subjectName=${encodeURIComponent(subjects[activeSubjectId].name)}#/exam`);
  });

  const studyTabButtons = document.querySelectorAll('.study-main .tab-btn');
  studyTabButtons.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  function switchTab(tab) {
    studyTabButtons.forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
    document.querySelectorAll('.study-main .tab-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === tab));
    if (tab === 'flashcards') renderFlashcardArea();
    if (tab === 'quiz') renderQuizIntro();
    if (tab === 'summary') renderSummaryTab();
    if (tab === 'overview') renderOverviewTab();
  }

  function renderOverviewTab() {
    const topics = subjects[activeSubjectId]?.topics || {};
    const list = $('topicMasteryList');
    const topicIds = Object.keys(topics).sort((a, b) => (topics[a].masteryScore || 0) - (topics[b].masteryScore || 0)); // weakest first
    list.innerHTML = topicIds.length === 0
      ? `<p class="study-muted">No topics tracked yet. Review some flashcards or take the quiz.</p>`
      : topicIds.map(id => {
          const t = topics[id];
          return `<div class="topic-mastery-row">
            <div class="topic-mastery-name">${escapeHtml(t.name)}</div>
            <div class="topic-mastery-track"><div class="topic-mastery-fill" style="width:${t.masteryScore}%;background:${masteryColor(t.masteryScore)};"></div></div>
            <div class="topic-mastery-pct">${t.masteryScore}%</div>
          </div>`;
        }).join('');

    const setsList = $('subjectSetsList');
    setsList.innerHTML = activeSetIds.length === 0 ? `<p class="study-muted">No study sets yet.</p>` :
      activeSetIds.map(id => {
        const s = studySets[id];
        return `<div class="set-row" data-id="${id}">
          <div class="set-row-text"><span class="set-row-name">${escapeHtml(s.title)}</span><span class="set-row-meta">${(s.flashcards || []).length} cards · ${(s.quiz || []).length} questions</span></div>
          <button type="button" class="set-row-delete" aria-label="Delete ${escapeHtml(s.title)}" title="Delete this set"><i class="fas fa-trash"></i></button>
        </div>`;
      }).join('');
  }

  $('subjectSetsList').addEventListener('click', async (e) => {
    const btn = e.target.closest('.set-row-delete'); if (!btn) return;
    const id = btn.closest('.set-row').dataset.id;
    const set = studySets[id]; if (!set) return;
    if (!window.confirm(`Delete "${set.title}" and its flashcards and quiz? This cannot be undone.`)) return;
    try {
      await database.ref(`history/${scopeUid}/study/sets/${id}`).remove();
      delete studySets[id];
      activeSetIds = setsOf(activeSubjectId);
      renderOverviewTab();
      refreshDueBanner();
      showToast('Study set deleted');
    } catch (err) { showToast('Could not delete that set. Please try again.', 'error'); }
  });

  function renderSummaryTab() {
    const sets = activeSetIds.map(id => studySets[id]).filter(s => s && s.summary);
    const md = (t) => (typeof marked !== 'undefined' ? marked.parse(t || '') : escapeHtml(t));
    $('summaryContent').innerHTML = sets.length === 0 ? '<p class="study-muted">No summary yet.</p>'
      : sets.length === 1 ? md(sets[0].summary)
      : sets.map((s, i) => `<details class="summary-set" ${i === 0 ? 'open' : ''}><summary>${escapeHtml(s.title)}</summary>${md(s.summary)}</details>`).join('');
  }

  // =========================================================================
  // Flashcard review session
  // =========================================================================
  let reviewAllSubjects = false;                                   // "Review Now" on the dashboard: due cards from every subject
  let sessionTally = { again: 0, hard: 0, good: 0, easy: 0 };
  let sessionTotal = 0;
  const isDue = (c) => !c.nextReview || c.nextReview <= Date.now();

  $('flashcardFilter').addEventListener('change', renderFlashcardArea);
  $('shuffleCardsBtn').addEventListener('click', () => {
    // Fisher–Yates over what is left of the session
    for (let i = flashcardQueue.length - 1; i > currentCardIndex; i--) {
      const j = currentCardIndex + Math.floor(Math.random() * (i - currentCardIndex + 1));
      [flashcardQueue[i], flashcardQueue[j]] = [flashcardQueue[j], flashcardQueue[i]];
    }
    renderCard();
  });

  function refreshFlashcardStats() {
    const all = allFlashcards().filter(c => reviewAllSubjects || c.subjectId === activeSubjectId);
    $('flashcardStats').textContent = `${all.filter(isDue).length} due · ${all.length} total`;
  }

  function renderFlashcardArea() {
    const filter = $('flashcardFilter').value;
    const all = allFlashcards().filter(c => reviewAllSubjects || c.subjectId === activeSubjectId);
    flashcardQueue = filter === 'due' ? all.filter(isDue) : all;
    currentCardIndex = 0;
    sessionTally = { again: 0, hard: 0, good: 0, easy: 0 };
    sessionTotal = flashcardQueue.length;
    refreshFlashcardStats();
    renderCard();
  }

  function renderCard() {
    const area = $('flashcardArea');
    if (!area) return;
    if (flashcardQueue.length === 0) {
      const any = allFlashcards().some(c => reviewAllSubjects || c.subjectId === activeSubjectId);
      area.innerHTML = `<div class="empty-state"><i class="fas fa-check-circle"></i><p>${any ? 'Nothing due right now. Nice work!' : 'No flashcards in this subject yet.'}</p>
        ${any ? '<button type="button" class="btn-secondary" id="reviewAllCardsBtn">Review all cards anyway</button>' : ''}</div>`;
      const b = $('reviewAllCardsBtn');
      if (b) b.addEventListener('click', () => { $('flashcardFilter').value = 'all'; renderFlashcardArea(); });
      return;
    }
    if (currentCardIndex >= flashcardQueue.length) {
      const t = sessionTally, done = t.again + t.hard + t.good + t.easy;
      area.innerHTML = `<div class="flashcard-done">
        <i class="fas fa-trophy"></i>
        <h3>Session complete</h3>
        <p>${done} review${done === 1 ? '' : 's'} · ${t.good + t.easy} knew it · ${t.again + t.hard} to revisit</p>
        <div class="flashcard-done-actions">
          <button type="button" class="btn-secondary" id="reviewAgainBtn"><i class="fas fa-redo"></i> Review all cards</button>
          <button type="button" class="btn-primary" id="reviewToQuizBtn"><i class="fas fa-clipboard-question"></i> Take the quiz</button>
        </div></div>`;
      $('reviewAgainBtn').addEventListener('click', () => { $('flashcardFilter').value = 'all'; renderFlashcardArea(); });
      $('reviewToQuizBtn').addEventListener('click', () => switchTab('quiz'));
      refreshFlashcardStats();
      refreshDueBanner();
      return;
    }
    const card = flashcardQueue[currentCardIndex];
    const pct = Math.round((currentCardIndex / flashcardQueue.length) * 100);
    area.innerHTML = `
      <div class="flashcard-progress"><span>Card ${currentCardIndex + 1} of ${flashcardQueue.length}</span>
        <div class="flashcard-progress-track"><div style="width:${pct}%"></div></div></div>
      <div class="flashcard" id="activeFlashcard" role="button" tabindex="0" aria-pressed="false" aria-label="Flashcard. Press Space to flip.">
        <div class="flashcard-inner">
          <div class="flashcard-face flashcard-face-front">
            ${card.topic ? `<span class="flashcard-topic-tag">${escapeHtml(card.topic)}</span>` : ''}
            <div class="flashcard-text">${escapeHtml(card.front)}</div>
            <span class="flashcard-hint"><i class="fas fa-hand-pointer"></i> Tap to see the answer</span>
          </div>
          <div class="flashcard-face flashcard-face-back">
            <span class="flashcard-topic-tag">Answer</span>
            <div class="flashcard-text">${escapeHtml(card.back)}</div>
          </div>
        </div>
      </div>
      <p class="flashcard-ask" id="gradeAsk" hidden>How well did you know it?</p>
      <div class="grade-buttons" id="gradeButtons" hidden>
        <button type="button" class="grade-btn grade-again" data-grade="again">Again<small>Shown again today</small></button>
        <button type="button" class="grade-btn grade-hard" data-grade="hard">Hard<small>Sooner</small></button>
        <button type="button" class="grade-btn grade-good" data-grade="good">Good<small>On schedule</small></button>
        <button type="button" class="grade-btn grade-easy" data-grade="easy">Easy<small>Later</small></button>
      </div>
    `;
    const cardEl = $('activeFlashcard');
    const flip = () => {
      const flipped = cardEl.classList.toggle('flipped');
      cardEl.setAttribute('aria-pressed', String(flipped));
      $('gradeButtons').hidden = !flipped;
      $('gradeAsk').hidden = !flipped;
    };
    cardEl.addEventListener('click', flip);
    cardEl.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
    let grading = false;
    area.querySelectorAll('.grade-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (grading) return;
        grading = true;
        const grade = btn.dataset.grade;
        sessionTally[grade]++;
        try { await applyGrade(card, grade); } catch (err) { console.warn('[study] could not save the grade', err); showToast('Could not save that review (offline?). It will count next time.', 'error'); }
        // "Again" comes back at the end of this session, like a real deck.
        if (grade === 'again' && flashcardQueue.filter(c => c === card).length < 3) flashcardQueue.push(card);
        currentCardIndex++;
        refreshFlashcardStats();
        renderCard();
        const next = $('activeFlashcard'); if (next) next.focus({ preventScroll: true });
      });
    });
  }

  async function applyGrade(card, grade) {
    const update = gradeCard(card, grade);
    Object.assign(card, update);
    const set = studySets[card.setId];
    if (!set || !set.flashcards || !set.flashcards[card.cardIndex]) return;
    Object.assign(set.flashcards[card.cardIndex], update);
    await database.ref(`history/${scopeUid}/study/sets/${card.setId}/flashcards/${card.cardIndex}`).update(update);
    // Flashcard performance nudges topic mastery too (lighter weight than a full quiz).
    const correctish = grade === 'good' || grade === 'easy';
    if (card.topic) await updateTopicMastery(card.subjectId, card.topic, correctish ? 1 : 0, 1);
  }

  $('dueReviewBtn').addEventListener('click', () => {
    const due = allFlashcards().filter(isDue);
    if (due.length === 0) return;
    const subjectIds = [...new Set(due.map(c => c.subjectId))];
    if (subjectIds.length === 1) {
      openSubject(subjectIds[0], 'flashcards');
    } else {
      // Due cards across several subjects: one mixed review session.
      activeSubjectId = subjectIds[0];
      activeSetIds = setsOf(activeSubjectId);
      $('subjectTitle').textContent = 'Due for review';
      showView(viewSubject);
      switchTab('flashcards');
      reviewAllSubjects = true;
    }
    $('flashcardFilter').value = 'due';
    renderFlashcardArea();
  });

  // Keyboard shortcuts while a card is up: 1–4 grade it once it is flipped.
  const onStudyKey = (e) => {
    const cardEl = $('activeFlashcard');
    if (!cardEl || !cardEl.isConnected || !cardEl.classList.contains('flipped')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) return;
    const grade = { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' }[e.key];
    if (!grade) return;
    const btn = document.querySelector('.study-main .grade-btn[data-grade="' + grade + '"]');
    if (btn) btn.click();
  };
  document.addEventListener('keydown', onStudyKey);
  cleanupFns.push(() => document.removeEventListener('keydown', onStudyKey));

  // =========================================================================
  // Quiz
  // =========================================================================
  const QUIZ_MAX = 10;
  function quizPool() {
    const pool = [];
    activeSetIds.forEach(id => (studySets[id].quiz || []).forEach(q => {
      if (q && q.question && Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(q.correctIndex) && q.options[q.correctIndex] != null) pool.push(q);
    }));
    return pool;
  }

  function renderQuizIntro() {
    const pool = quizPool();
    const area = $('quizArea');
    if (pool.length === 0) {
      area.innerHTML = `<div class="empty-state"><i class="fas fa-question-circle"></i><p>No quiz available for this subject yet.</p></div>`;
      return;
    }
    const n = Math.min(QUIZ_MAX, pool.length);
    area.innerHTML = `
      <div class="glass-card quiz-intro">
        <h3><i class="fas fa-clipboard-question"></i> Ready to test yourself?</h3>
        <p class="study-muted">${n} question${n === 1 ? '' : 's'}${pool.length > n ? ` picked from ${pool.length}` : ''} on ${escapeHtml(subjects[activeSubjectId]?.name || 'this subject')}. You get the explanation after each answer.</p>
        <button type="button" class="btn-primary" id="startQuizBtn"><i class="fas fa-play"></i> Start Quiz</button>
      </div>
    `;
    $('startQuizBtn').addEventListener('click', () => startQuiz(pool));
  }

  function startQuiz(pool) {
    const shuffled = pool.slice();
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    quizState = { questions: shuffled.slice(0, QUIZ_MAX), index: 0, answers: [], topicResults: {} };
    renderQuizQuestion();
  }

  function renderQuizQuestion() {
    const { questions, index } = quizState;
    const q = questions[index];
    const area = $('quizArea');
    area.innerHTML = `
      <div class="quiz-progress-track"><div class="quiz-progress-fill" style="width:${(index / questions.length) * 100}%;"></div></div>
      <div class="quiz-question-card">
        <div class="quiz-question-topic">${q.topic ? escapeHtml(q.topic) + ' · ' : ''}Question ${index + 1} of ${questions.length}</div>
        <div class="quiz-question-text" id="quizQuestionText">${escapeHtml(q.question)}</div>
        <div id="quizOptions" role="group" aria-labelledby="quizQuestionText">
          ${q.options.map((opt, i) => `
            <button type="button" class="quiz-option" data-index="${i}">
              <span class="quiz-option-letter">${String.fromCharCode(65 + i)}</span>
              <span>${escapeHtml(opt)}</span>
            </button>`).join('')}
        </div>
        <div id="quizExplanation" aria-live="polite"></div>
        <div class="quiz-nav">
          <span></span>
          <button type="button" class="btn-primary" id="quizNextBtn" hidden>${index === questions.length - 1 ? 'See Results' : 'Next Question'}</button>
        </div>
      </div>
    `;
    area.querySelectorAll('.quiz-option').forEach(opt => {
      opt.addEventListener('click', () => selectAnswer(parseInt(opt.dataset.index, 10)));
    });
  }

  function selectAnswer(selectedIndex) {
    const { questions, index } = quizState;
    const q = questions[index];
    if (quizState.answers[index] !== undefined) return; // already answered
    quizState.answers[index] = selectedIndex;

    document.querySelectorAll('.study-main .quiz-option').forEach((opt, i) => {
      opt.disabled = true;
      if (i === selectedIndex) opt.classList.add('selected');
      if (i === q.correctIndex) opt.classList.add('correct');
      else if (i === selectedIndex) opt.classList.add('incorrect');
    });
    const right = selectedIndex === q.correctIndex;
    $('quizExplanation').innerHTML = `<div class="quiz-explanation ${right ? 'is-right' : 'is-wrong'}"><strong>${right ? 'Correct!' : 'Not quite.'}</strong> ${escapeHtml(q.explanation || '')}</div>`;

    const topic = q.topic || 'General';
    if (!quizState.topicResults[topic]) quizState.topicResults[topic] = { correct: 0, total: 0 };
    quizState.topicResults[topic].total++;
    if (right) quizState.topicResults[topic].correct++;

    const nextBtn = $('quizNextBtn');
    nextBtn.hidden = false;
    nextBtn.focus({ preventScroll: true });
    nextBtn.onclick = () => {
      if (index === questions.length - 1) finishQuiz();
      else { quizState.index++; renderQuizQuestion(); }
    };
  }

  async function finishQuiz() {
    const { questions, answers, topicResults } = quizState;
    const correctCount = questions.filter((q, i) => answers[i] === q.correctIndex).length;
    const scorePct = Math.round((correctCount / questions.length) * 100);

    $('quizArea').innerHTML = `
      <div class="quiz-results">
        <div class="quiz-score-ring" style="background:conic-gradient(${masteryColor(scorePct)} ${scorePct * 3.6}deg, var(--study-border) 0deg);">
          <div class="quiz-score-inner">${scorePct}%</div>
        </div>
        <h2>${correctCount} / ${questions.length} correct</h2>
        <p>Your topic mastery has been updated.</p>
        <div class="flashcard-done-actions">
          <button type="button" class="btn-secondary" id="quizOverviewBtn">Back to Overview</button>
          <button type="button" class="btn-primary" id="retakeQuizBtn"><i class="fas fa-redo"></i> Try another round</button>
        </div>
        <div id="quizReviewList" class="quiz-review-list"></div>
      </div>
    `;
    $('quizReviewList').innerHTML = questions.map((q, i) => `
      <div class="quiz-review-item">
        <div class="quiz-review-q"><i class="fas ${answers[i] === q.correctIndex ? 'fa-circle-check is-right' : 'fa-circle-xmark is-wrong'}"></i> ${i + 1}. ${escapeHtml(q.question)}</div>
        <div class="study-muted">Correct answer: ${escapeHtml(q.options[q.correctIndex])}${answers[i] !== q.correctIndex ? ' · Your answer: ' + escapeHtml(q.options[answers[i]] ?? '(skipped)') : ''}</div>
      </div>
    `).join('');
    $('quizOverviewBtn').addEventListener('click', () => switchTab('overview'));
    $('retakeQuizBtn').addEventListener('click', () => renderQuizIntro());

    try {
      for (const [topic, result] of Object.entries(topicResults)) await updateTopicMastery(activeSubjectId, topic, result.correct, result.total);
    } catch (err) { console.warn('[study] could not update mastery', err); }
    renderDashboard();
  }

  // =========================================================================
  // History Drawer
  // =========================================================================
  function historyDrawerItems() {
    return Object.keys(studySets)
      .sort((a, b) => (studySets[b].createdAt || 0) - (studySets[a].createdAt || 0))
      .map(id => {
        const s = studySets[id];
        return {
          id,
          title: s.title || 'Untitled',
          meta: `${(s.flashcards || []).length} cards · ${(s.quiz || []).length} questions`,
          time: s.createdAt,
          raw: s
        };
      });
  }

  // Same data (history/{scopeUid}/study/sets) and the same "open its
  // subject" behaviour as the old private drawer — now rendered by the
  // shell's one global drawer (js/history-drawer.js).
  if (window.RehablixHistoryDrawer) {
    window.RehablixHistoryDrawer.register('study', {
      label: 'Study Sets',
      icon: '🧠',
      searchPlaceholder: 'Search study sets...',
      emptyText: 'No study sets yet',
      async load() {
        await loadStudySets();
        return historyDrawerItems();
      },
      open: (item) => openSubject(item.raw.subjectId)
    });
    cleanupFns.push(() => window.RehablixHistoryDrawer.unregister('study'));
  }

  // =========================================================================
  // Init
  // =========================================================================
  async function refreshAllData() {
    await loadSubjects();
    await loadStudySets();
    renderDashboard();
    if (window.RehablixHistoryDrawer) window.RehablixHistoryDrawer.refresh('study');
  }

  const unsubAuth = auth.onAuthStateChanged(async (user) => {
    currentUser = user;
    if (!user) return;

    if (window.RehablixCenter && typeof window.RehablixCenter.getEffectiveScopeUid === 'function') {
      try { scopeUid = await window.RehablixCenter.getEffectiveScopeUid('study'); }
      catch (err) { scopeUid = user.uid; }
    } else {
      scopeUid = user.uid;
    }
    if (scopeUid === null) {
      showToast('Your access to Study Buddy has been turned off by your center admin.', 'error', 6000);
      return;
    } else if (scopeUid !== user.uid) {
      showToast('Working on your center\'s shared study sets', 'info', 3000);
    }

    await refreshAllData();

    // Deep links: from Exam Simulator (?subject=…&focus=…) or from Lixa's
    // Files list / a Lixa file card (?openSet=<study set id>, resolved to its
    // subject here — a Files entry is a set, not a subject).
    const params = new URLSearchParams(window.location.search);
    let subjectParam = params.get('subject');
    const setParam = params.get('openSet');
    if (setParam && studySets[setParam]) subjectParam = studySets[setParam].subjectId;
    if (subjectParam && subjects[subjectParam]) {
      openSubject(subjectParam);
      const focusParam = params.get('focus');
      if (focusParam) showToast('Focus on the highlighted weak topics below', 'info', 5000);
    }
    // Consume the link so a later login/logout (which re-runs this
    // callback) or a refresh doesn't jump back to it.
    if (subjectParam || setParam) {
      if (window.RehablixRouter) window.RehablixRouter.clearQuery();
    }
  });
  cleanupFns.push(unsubAuth);
  } // end mount()

  function unmount() {
    cleanupFns.forEach(fn => { try { fn(); } catch (e) { /* best-effort */ } });
    cleanupFns = [];
  }

  window.RehablixViews = window.RehablixViews || {};
  window.RehablixViews.study = { mount, unmount };
})();
