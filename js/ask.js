// js/ask.js – Ask AI: chat with history, file attachments (incl. real
// image/video vision), voice input, editable prompts, link/URL reading,
// site-aware system knowledge, cross-page handoff, and "export to
// result.html" for AI answers.
//
// Registered as the "lixa" SPA view (js/router.js calls mount() after
// injecting views/lixa.fragment.html into #appRoot, and unmount() before
// navigating away) rather than running once on DOMContentLoaded, since the
// fragment can be mounted/unmounted repeatedly across a single page load.

(function () {
  // Marked configuration
  if (typeof marked !== 'undefined') {
    marked.setOptions({
      breaks: true,
      gfm: true,
      headerIds: false,
      mangle: false
    });
  }

  // Cleanup for listeners attached to long-lived targets (document/window/
  // firebase.auth) that outlive this view's own DOM — anything attached to
  // an element inside the fragment needs no cleanup, it's GC'd when the
  // router replaces #appRoot's content on the next navigation.
  let cleanupFns = [];

  async function mount() {

  // =========================================================================
  // DOM Elements
  // =========================================================================
  const chatMessages = document.getElementById('chatMessages');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const newChatBtn = document.getElementById('newChatBtn');
  const attachBtn = document.getElementById('attachBtn');
  const attachMenu = document.getElementById('attachMenu');
  const fileInput = document.getElementById('fileInput');
  const attachmentsStrip = document.getElementById('attachmentsStrip');
  const micBtn = document.getElementById('micBtn');
  const inputHint = document.getElementById('inputHint');

  const historyDrawer = document.getElementById('historyDrawer');
  const historyNavBtn = document.getElementById('historyNavBtn');
  // This button visually belongs in the shared shell navbar, not the
  // fragment body — relocate it into the shell's nav slot on mount. The
  // router destroys/recreates #navbarViewSlot's contents on every
  // navigation, so this never needs explicit unmount cleanup.
  const navbarSlot = document.getElementById('navbarViewSlot');
  if (navbarSlot && historyNavBtn) navbarSlot.appendChild(historyNavBtn);
  const closeDrawerBtn = document.getElementById('closeDrawerBtn');
  const historyList = document.getElementById('historyList');
  const historySearchInput = document.getElementById('historySearchInput');

  const toastContainer = document.getElementById('toast-container');

  // =========================================================================
  // State
  // =========================================================================
  let currentUser = null;
  // Text-only model (fast, cheap) – used whenever nothing in the turn needs vision.
  let aiConfig = { token: null, endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash' };
  // Vision-capable model (GPT-4.1 via GitHub Models marketplace) – used when
  // an image or a video (sampled as frames) is attached.
  let visionConfig = { token: null, endpoint: null, model: 'gpt-4.1' };

  let currentConversationId = null;
  let conversationTitle = null;
  let titleIsFinal = false;
  let messages = [];                     // [{role, content, displayContent, attachmentMeta, timestamp, visionImages?, _rawFiles?}]
  let isWaiting = false;
  let attachedFiles = [];                // [{id, file, name, type, status, extractedText, visionImages, error}]

  const database = firebase.database();

  const isMobile = window.matchMedia('(pointer: coarse)').matches ||
                    /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  if (inputHint) {
    inputHint.textContent = isMobile
      ? 'Tap ➤ to send · Enter adds a new line'
      : 'Shift+Enter for a new line · Enter to send';
  }

  const TOOL_PAGES = ['doc.html', 'index.html#/motion', 'project.html', 'index.html#/exam', 'index.html#/workspace'];

  // =========================================================================
  // Helpers
  // =========================================================================
  function showToast(message, type = 'success', duration = 3500) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i><span>${message}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(20px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;');
  }

  async function fetchTokens() {
    try {
      const snapshot = await database.ref('tokens/deepseek').once('value');
      const data = snapshot.val();
      if (data?.api_key) {
        aiConfig.token = data.api_key;
        return true;
      }
      console.warn('DeepSeek API key missing');
      return false;
    } catch (error) {
      console.error('Token fetch error:', error);
      return false;
    }
  }

  async function fetchVisionTokens() {
    if (visionConfig.token) return true;
    try {
      const snapshot = await database.ref('tokens/open_ai').once('value');
      const data = snapshot.val();
      if (data?.api_key) {
        visionConfig.token = data.api_key;
        visionConfig.endpoint = 'https://api.openai.com/v1';
        return true;
      }
      console.warn('Vision (OpenAI) credentials missing');
      return false;
    } catch (error) {
      console.error('Vision token fetch error:', error);
      return false;
    }
  }

  // Lazy-load a third-party script only when actually needed
  const loadedScripts = {};
  function loadScript(src) {
    if (loadedScripts[src]) return loadedScripts[src];
    loadedScripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
    return loadedScripts[src];
  }

  // Render markdown for AI messages, style + classify links, and make
  // internal tool-page links hand off context instead of navigating cold.
  function renderAssistantHtml(content) {
    const html = marked.parse(content || '');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    wrapper.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href') || '';
      const isExternal = /^https?:\/\//i.test(href) && !href.includes(window.location.hostname);
      if (isExternal) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        a.classList.add('external-link');
      } else if (TOOL_PAGES.some(p => href === p || href.startsWith(p + '?'))) {
        a.classList.add('internal-link');
        a.dataset.handoffPage = TOOL_PAGES.find(p => href === p || href.startsWith(p + '?'));
      }
    });
    return wrapper.innerHTML;
  }

  // Generic renderer for a Lixa-generated file result card. `card` shape:
  // { icon, title, meta, snippet, actions:[{type:'link'|'button', href?, id?, label, primary?, external?}] }
  function renderFileCard(card) {
    const wrap = document.createElement('div');
    wrap.className = 'lixa-file-card';
    const actionsHtml = (card.actions || []).map(a => {
      const cls = 'lixa-file-action' + (a.primary ? ' lixa-file-primary-action' : '');
      if (a.type === 'button') {
        return `<button type="button" class="${cls}" data-file-action="${escapeHtml(a.id || '')}"><i class="fas ${a.icon || 'fa-arrow-up-right-from-square'}"></i> ${escapeHtml(a.label)}</button>`;
      }
      const target = a.external ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a class="${cls}" href="${a.href}"${target}><i class="fas ${a.icon || 'fa-arrow-up-right-from-square'}"></i> ${escapeHtml(a.label)}</a>`;
    }).join('');
    wrap.innerHTML = `
      <div class="lixa-file-icon">${card.icon || '📄'}</div>
      <div class="lixa-file-body">
        <div class="lixa-file-title">${escapeHtml(card.title || 'Generated file')}</div>
        ${card.meta ? `<div class="lixa-file-meta">${escapeHtml(card.meta)}</div>` : ''}
        ${card.snippet ? `<div class="lixa-file-snippet">${escapeHtml(card.snippet)}</div>` : ''}
        <div class="lixa-file-actions">${actionsHtml}</div>
      </div>
    `;
    return wrap;
  }

  // =========================================================================
  // Site & company knowledge baked into the system prompt (feature 7 & 8)
  // =========================================================================
  function buildSystemPrompt() {
    return `You are "Lixa", the AI copilot embedded as the home page of rehablix (rehablix.com), an AI toolkit for rehabilitation professionals and healthcare students. You provide accurate, evidence-based answers about rehabilitation, medical conditions, treatments, clinical reasoning, and academic work. Use clear language and markdown formatting (headings, bullet points, bold, tables) to keep answers readable. Be concise but thorough.

Unlike a typical chatbot, you can also personally CREATE things for the user directly in this conversation — an assessment format, a standardized assessment tool, an audio transcript, a presentation/report, a study set (flashcards/quiz), or an academic assignment. That routing happens automatically outside of you (by keyword detection or the user typing "@toolname"), so you never need to tell the user to go to a separate page for any of those six things — if they ask for one, the app will already be handling it as a generation request, not a chat question. Never suggest visiting format.html, standardized.html, audio.html, presentation.html, study.html, or assignment.html — you ARE that functionality now.

A few things genuinely still live on separate pages (in the "Workspace" tab, reachable via the bottom nav) because they're too complex for chat — only recommend these, and only when truly relevant:
- [Smart EMR](doc.html) – AI-powered workspace for documentation, patient management, treatment planning, progress tracking.
- [Motion & Gait Analyzer](index.html#/motion) – a full-screen camera scanner that measures joint range of motion or analyzes gait via a voice-guided scan.
- [Project Maker](project.html) – builds an academic project chapter by chapter (literature review, methodology, references, defense prep).
- [Exam Simulator](index.html#/exam) – timed, AI-generated practice exams with performance analytics.

When a user's need clearly matches one of these four, say so directly and link to it. Don't link a page unless it's actually relevant.

STRICT RULE: most messages do NOT need a page recommendation. Do not mention or link ANY of these pages in greetings, small talk, general knowledge questions, or when you're already able to fully answer the question yourself in chat. Only bring one up when the user is explicitly trying to do something one of these four tools is specifically built for — and even then, mention at most one page per response. If in doubt, don't mention a page at all.

About rehablix itself: rehablix was built by rehabverve enterprise, founded by Emmanuel Adeoye — an occupational therapist by profession and a programmer by passion. Only share this if asked about the creator, company, or "who made this."

You should also know about two related businesses and point users to them when relevant (always as a clickable markdown link, opening in a new tab):
- **rehabverve.com.ng** — for anyone who wants to hire a rehabilitation professional directly, or needs bespoke professional/consulting help beyond what the AI tools can do. Link: [rehabverve.com.ng](https://rehabverve.com.ng)
- **rehabace.com** — for sensory room construction/design or therapy equipment and supplies. Link: [rehabace.com](https://rehabace.com)

Only mention rehabverve.com.ng or rehabace.com when the user's request genuinely matches (e.g. "I need to hire a therapist", "who can build a sensory room", "where can I buy therapy equipment") — don't force them into unrelated answers.

If the user's message includes content extracted from an uploaded file, an image, video frames, or a URL they shared (you'll see it clearly marked, e.g. "[Attached file: ...]" or "[Content from URL: ...]"), use that content as context to answer their actual question — don't just describe it back to them unless asked to.`;
  }

  // =========================================================================
  // URL detection & reading (feature 9)
  // =========================================================================
  function extractUrls(text) {
    const matches = text.match(/(https?:\/\/[^\s)]+)/g) || [];
    return [...new Set(matches)].slice(0, 2);
  }

  async function fetchUrlContent(url) {
    const readerUrl = `https://r.jina.ai/${url}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(readerUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error('reader error ' + res.status);
      const text = await res.text();
      return text.slice(0, 3000);
    } catch (err) {
      clearTimeout(timeout);
      console.warn('URL fetch failed for', url, err);
      return null;
    }
  }

  // =========================================================================
  // File attachments (feature 1) + real image/video vision (feature 5)
  // =========================================================================
  function fileTypeIcon(file) {
    const t = file.type;
    const n = file.name.toLowerCase();
    if (t.startsWith('image/')) return 'fa-file-image';
    if (t.startsWith('video/')) return 'fa-file-video';
    if (t.startsWith('audio/')) return 'fa-file-audio';
    if (n.endsWith('.pdf')) return 'fa-file-pdf';
    if (n.endsWith('.doc') || n.endsWith('.docx')) return 'fa-file-word';
    if (n.endsWith('.zip')) return 'fa-file-zipper';
    if (n.endsWith('.csv')) return 'fa-file-csv';
    return 'fa-file-lines';
  }

  function renderAttachmentsStrip() {
    if (!attachmentsStrip) return;
    if (attachedFiles.length === 0) {
      attachmentsStrip.hidden = true;
      attachmentsStrip.innerHTML = '';
      return;
    }
    attachmentsStrip.hidden = false;
    attachmentsStrip.innerHTML = '';
    attachedFiles.forEach(att => {
      const chip = document.createElement('div');
      chip.className = 'attachment-chip';
      const statusText = att.status === 'reading' ? 'Reading…' : att.status === 'error' ? 'Not readable' : 'Ready';
      const statusIcon = att.status === 'reading' ? '<i class="fas fa-spinner fa-spin"></i> ' : '';
      chip.innerHTML = `
        <i class="fas ${fileTypeIcon(att.file)} file-type-icon"></i>
        <span class="attachment-name" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}</span>
        <span class="attachment-status">${statusIcon}${statusText}</span>
        <button class="remove-attachment" data-id="${att.id}" aria-label="Remove attachment"><i class="fas fa-times"></i></button>
      `;
      attachmentsStrip.appendChild(chip);
    });
    attachmentsStrip.querySelectorAll('.remove-attachment').forEach(btn => {
      btn.addEventListener('click', () => {
        attachedFiles = attachedFiles.filter(a => a.id !== btn.dataset.id);
        renderAttachmentsStrip();
      });
    });
    // Real-time feedback: don't let the user fire off a send while a file
    // is still being read/OCR'd — the 45s wait in handleSend is a safety
    // net, this is what actually prevents the premature-send race in the
    // first place for anyone who clicks Send quickly.
    const stillReading = attachedFiles.some(a => a.status === 'reading');
    if (sendBtn) sendBtn.disabled = stillReading || isWaiting || (messageInput.value.trim() === '' && attachedFiles.length === 0);
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  // Resize/compress an image (or a canvas frame) down to a sane size before
  // sending it to the vision model, to keep payloads fast and cheap.
  function downscaleImage(source, maxDim = 1024, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = source;
    });
  }

  async function extractPdfText(file) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const buf = await readFileAsArrayBuffer(file);
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    let text = '';
    const maxPages = Math.min(pdf.numPages, 15);
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(it => it.str).join(' ') + '\n';
      if (text.length > 8000) break;
    }
    return text.trim();
  }

  async function extractDocxText(file) {
    await loadScript('https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js');
    const buf = await readFileAsArrayBuffer(file);
    const result = await window.mammoth.extractRawText({ arrayBuffer: buf });
    return (result.value || '').trim();
  }

  async function extractZipText(file) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    const buf = await readFileAsArrayBuffer(file);
    const zip = await window.JSZip.loadAsync(buf);
    const entries = Object.values(zip.files).filter(f => !f.dir);
    let summary = `Zip archive with ${entries.length} file(s): ${entries.slice(0, 30).map(f => f.name).join(', ')}\n\n`;
    let charsUsed = summary.length;
    for (const entry of entries) {
      if (charsUsed > 6000) break;
      if (/\.(txt|md|csv|json|log)$/i.test(entry.name) && entry._data && entry._data.uncompressedSize < 200000) {
        try {
          const content = await entry.async('text');
          const snippet = content.slice(0, 1500);
          summary += `--- ${entry.name} ---\n${snippet}\n\n`;
          charsUsed += snippet.length;
        } catch (e) { /* skip unreadable entry */ }
      }
    }
    return summary.trim();
  }

  // Real vision path: downscale the image for the model, and also run OCR
  // so any legible text still ends up in the text-only fallback/context.
  async function processImageAttachment(file) {
    const dataUrl = await readFileAsDataUrl(file);
    const visionUrl = await downscaleImage(dataUrl).catch(() => dataUrl);
    let ocrText = '';
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
      const { data } = await window.Tesseract.recognize(dataUrl, 'eng');
      ocrText = (data.text || '').trim();
    } catch (e) { /* OCR is best-effort */ }
    return {
      visionImages: [visionUrl],
      text: `[Image attached: ${file.name}]` + (ocrText ? ` Detected text: ${ocrText}` : ' (analyzed visually)')
    };
  }

  // Sample a handful of frames from a video so the vision model can "see"
  // it, since there's no direct video-understanding endpoint available here.
  function extractVideoFrames(file, frameCount = 4) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      const url = URL.createObjectURL(file);
      video.src = url;

      video.onloadedmetadata = async () => {
        try {
          const duration = video.duration;
          const canvas = document.createElement('canvas');
          canvas.width = Math.min(video.videoWidth, 960) || 640;
          canvas.height = Math.round(canvas.width * (video.videoHeight / video.videoWidth || 0.5625));
          const ctx = canvas.getContext('2d');
          const frames = [];
          for (let i = 0; i < frameCount; i++) {
            const t = (duration / (frameCount + 1)) * (i + 1);
            await new Promise((res) => {
              video.currentTime = t;
              video.onseeked = res;
            });
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            frames.push(canvas.toDataURL('image/jpeg', 0.75));
          }
          URL.revokeObjectURL(url);
          resolve(frames);
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('video load failed')); };
    });
  }

  async function processAttachment(att) {
    try {
      const file = att.file;
      const name = file.name.toLowerCase();
      if (file.type === 'text/plain' || /\.(txt|md|csv|log)$/i.test(name)) {
        att.extractedText = (await readFileAsText(file)).slice(0, 6000);
      } else if (name.endsWith('.pdf')) {
        att.extractedText = await extractPdfText(file);
      } else if (name.endsWith('.docx') || name.endsWith('.doc')) {
        att.extractedText = await extractDocxText(file);
      } else if (name.endsWith('.zip')) {
        att.extractedText = await extractZipText(file);
      } else if (file.type.startsWith('image/')) {
        const result = await processImageAttachment(file);
        att.extractedText = result.text;
        att.visionImages = result.visionImages;
      } else if (file.type.startsWith('video/')) {
        const frames = await extractVideoFrames(file, 4).catch(() => []);
        if (frames.length > 0) {
          att.visionImages = frames;
          att.extractedText = `[Video attached: ${file.name} — ${frames.length} frames sampled across its duration for visual analysis.]`;
        } else {
          att.extractedText = `[Video file "${file.name}" attached, but frames could not be extracted in this browser.]`;
        }
      } else if (file.type.startsWith('audio/')) {
        att.extractedText = `[Audio file "${file.name}" attached. Its contents cannot be transcribed automatically here — ask the user to describe what's in it if you need details.]`;
      } else {
        att.extractedText = `[File "${file.name}" attached — this file type can't be read automatically.]`;
      }
      att.status = 'ready';
    } catch (err) {
      console.warn('Attachment extraction failed:', err);
      att.status = 'error';
      att.extractedText = `[File "${att.name}" was attached but could not be read.]`;
    }
    renderAttachmentsStrip();
  }

  function handleFilesSelected(fileList) {
    Array.from(fileList).forEach(file => {
      if (file.size > 25 * 1024 * 1024) {
        showToast(`${file.name} is too large (max 25MB)`, 'error');
        return;
      }
      const att = {
        id: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        file,
        name: file.name,
        type: file.type,
        status: 'reading',
        extractedText: '',
        visionImages: null
      };
      attachedFiles.push(att);
      processAttachment(att);
    });
    renderAttachmentsStrip();
  }

  // ---- Attach menu (Camera / Photos / Videos / Files) ----
  function closeAttachMenu() {
    if (attachMenu) attachMenu.hidden = true;
    if (attachBtn) attachBtn.classList.remove('active');
  }

  if (attachBtn && attachMenu) {
    attachBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = attachMenu.hidden;
      closeAttachMenu();
      if (willOpen) {
        attachMenu.hidden = false;
        attachBtn.classList.add('active');
      }
    });

    attachMenu.querySelectorAll('button[data-mode]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = btn.dataset.mode;
        if (mode === 'camera') {
          fileInput.setAttribute('accept', 'image/*');
          fileInput.setAttribute('capture', 'environment');
        } else if (mode === 'photos') {
          fileInput.setAttribute('accept', 'image/*');
          fileInput.removeAttribute('capture');
        } else if (mode === 'videos') {
          fileInput.setAttribute('accept', 'video/*');
          fileInput.removeAttribute('capture');
        } else {
          fileInput.setAttribute('accept', 'image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.zip,.csv,.md');
          fileInput.removeAttribute('capture');
        }
        closeAttachMenu();
        fileInput.click();
      });
    });

    const onDocClickCloseAttachMenu = (e) => {
      if (!attachMenu.hidden && !attachMenu.contains(e.target) && e.target !== attachBtn) closeAttachMenu();
    };
    const onDocKeydownCloseAttachMenu = (e) => {
      if (e.key === 'Escape') closeAttachMenu();
    };
    document.addEventListener('click', onDocClickCloseAttachMenu);
    document.addEventListener('keydown', onDocKeydownCloseAttachMenu);
    cleanupFns.push(() => document.removeEventListener('click', onDocClickCloseAttachMenu));
    cleanupFns.push(() => document.removeEventListener('keydown', onDocKeydownCloseAttachMenu));
  }

  if (fileInput) fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) handleFilesSelected(e.target.files);
    fileInput.value = '';
  });

  // Drag & drop onto the chat area
  chatMessages.addEventListener('dragover', (e) => e.preventDefault());
  chatMessages.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) handleFilesSelected(e.dataTransfer.files);
  });

  // =========================================================================
  // Voice input (feature 3)
  // =========================================================================
  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let isRecording = false;

  if (SpeechRecognitionAPI && micBtn) {
    recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let baseText = '';

    recognition.onresult = (event) => {
      let finalTranscript = '';
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += transcript;
        else interimTranscript += transcript;
      }
      const sep = baseText && !baseText.endsWith(' ') ? ' ' : '';
      messageInput.value = baseText + sep + finalTranscript + interimTranscript;
      messageInput.dispatchEvent(new Event('input'));
    };

    recognition.onerror = (event) => {
      console.warn('Speech recognition error:', event.error);
      if (event.error !== 'no-speech') showToast('Voice input error: ' + event.error, 'error');
      stopRecording();
    };

    recognition.onend = () => stopRecording();

    function startRecording() {
      baseText = messageInput.value.trim();
      if (baseText) baseText += ' ';
      isRecording = true;
      micBtn.classList.add('recording');
      micBtn.querySelector('i').className = 'fas fa-stop';
      try { recognition.start(); } catch (e) { /* already started */ }
      showToast('Listening… tap the mic to stop', 'info', 2000);
    }

    function stopRecording() {
      isRecording = false;
      micBtn.classList.remove('recording');
      micBtn.querySelector('i').className = 'fas fa-microphone';
      try { recognition.stop(); } catch (e) { /* ignore */ }
    }

    micBtn.addEventListener('click', () => {
      if (isRecording) stopRecording();
      else startRecording();
    });
  } else if (micBtn) {
    micBtn.addEventListener('click', () => {
      showToast('Voice input is not supported in this browser', 'error');
    });
  }

  // =========================================================================
  // Render messages (with action buttons, attachments, and suggestions)
  // =========================================================================
  function renderMessages() {
    chatMessages.innerHTML = '';
    if (messages.length === 0) {
      chatMessages.innerHTML = `
        <div class="empty-chat">
          <div class="empty-chat-icon">✨</div>
          <p>Hi, I'm Lixa. Ask me anything, or tell me what to build — an assessment format, a standardized tool, a transcript, a presentation, a study set, or an assignment.</p>
          <p class="empty-chat-hint">Type <strong>@</strong> to jump straight to a tool, or just describe what you need.</p>
        </div>
      `;
      return;
    }

    messages.forEach((msg, index) => {
      const msgDiv = document.createElement('div');
      msgDiv.className = `message ${msg.role}`;
      msgDiv.setAttribute('data-index', index);
      if (msg.role === 'assistant') {
        msgDiv.setAttribute('data-raw-content', msg.content);
      }

      const bubble = document.createElement('div');
      bubble.className = 'message-bubble';
      if (msg.role === 'assistant') {
        bubble.innerHTML = renderAssistantHtml(msg.content);
      } else {
        bubble.textContent = msg.displayContent || msg.content;
      }
      msgDiv.appendChild(bubble);

      if (msg.role === 'assistant' && msg.fileCard) {
        bubble.appendChild(renderFileCard(msg.fileCard));
      }

      if (msg.role === 'user') {
        const editBox = document.createElement('div');
        editBox.className = 'user-edit-box';
        editBox.innerHTML = `
          <textarea class="edit-textarea">${escapeHtml(msg.displayContent || msg.content)}</textarea>
          <div class="edit-actions">
            <button class="cancel-edit-btn">Cancel</button>
            <button class="save-edit-btn">Save &amp; resend</button>
          </div>
        `;
        msgDiv.appendChild(editBox);

        if (msg.attachmentMeta && msg.attachmentMeta.length > 0) {
          const attWrap = document.createElement('div');
          attWrap.className = 'message-attachments';
          msg.attachmentMeta.forEach(a => {
            const chip = document.createElement('div');
            chip.className = 'attachment-chip';
            chip.innerHTML = `<i class="fas ${a.icon || 'fa-file-lines'} file-type-icon"></i><span class="attachment-name">${escapeHtml(a.name)}</span>`;
            attWrap.appendChild(chip);
          });
          msgDiv.appendChild(attWrap);
        }
      }

      if (msg.role === 'assistant') {
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'message-actions';
        actionsDiv.innerHTML = `
          <button class="action-btn copy-btn" title="Copy response"><i class="fas fa-copy"></i> Copy</button>
          <button class="action-btn download-btn" title="Open in editor to export"><i class="fas fa-download"></i> Word</button>
          <button class="action-btn regenerate-btn" title="Regenerate response"><i class="fas fa-redo"></i> Regenerate</button>
        `;
        msgDiv.appendChild(actionsDiv);

        const isLastAiMessage = index === messages.length - 1 && msg.role === 'assistant';
        if (isLastAiMessage && msg.suggestions && msg.suggestions.length > 0) {
          const suggestionsDiv = document.createElement('div');
          suggestionsDiv.className = 'suggestions-container';

          const suggestionsLabel = document.createElement('p');
          suggestionsLabel.className = 'suggestions-label';
          suggestionsLabel.textContent = '💡 Suggested follow‑up questions:';
          suggestionsDiv.appendChild(suggestionsLabel);

          const suggestionsRow = document.createElement('div');
          suggestionsRow.className = 'suggestions-row';

          msg.suggestions.forEach(suggestion => {
            const chip = document.createElement('button');
            chip.className = 'suggestion-chip';
            chip.textContent = suggestion;
            chip.title = 'Click to ask this question';
            chip.addEventListener('click', () => {
              if (isWaiting) return;
              messageInput.value = suggestion;
              handleSend();
            });
            suggestionsRow.appendChild(chip);
          });

          suggestionsDiv.appendChild(suggestionsRow);
          msgDiv.appendChild(suggestionsDiv);
        }
      }

      const time = document.createElement('div');
      time.className = 'message-time';
      if (msg.timestamp) {
        const date = new Date(msg.timestamp);
        time.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      msgDiv.appendChild(time);

      chatMessages.appendChild(msgDiv);
    });

    setTimeout(() => {
      const lastAssistantMsg = chatMessages.querySelector('.message.assistant:last-of-type');
      if (lastAssistantMsg) {
        lastAssistantMsg.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    }, 50);
  }

  // =========================================================================
  // Long-press to edit/copy a previous user prompt (feature 4)
  // =========================================================================
  let longPressTimer = null;
  let activePopover = null;

  function closeActivePopover() {
    if (activePopover) {
      activePopover.remove();
      activePopover = null;
    }
  }

  function openUserMsgPopover(msgDiv, index) {
    closeActivePopover();
    const popover = document.createElement('div');
    popover.className = 'user-msg-popover';
    popover.innerHTML = `
      <button class="popover-copy-btn" title="Copy"><i class="fas fa-copy"></i></button>
      <button class="popover-edit-btn" title="Edit"><i class="fas fa-pen"></i></button>
    `;
    msgDiv.appendChild(popover);
    activePopover = popover;

    popover.querySelector('.popover-copy-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const text = messages[index].displayContent || messages[index].content;
      navigator.clipboard.writeText(text)
        .then(() => showToast('Prompt copied', 'success'))
        .catch(() => showToast('Copy failed', 'error'));
      closeActivePopover();
    });

    popover.querySelector('.popover-edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      closeActivePopover();
      msgDiv.classList.add('editing');
      const textarea = msgDiv.querySelector('.edit-textarea');
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }

  chatMessages.addEventListener('mousedown', (e) => startLongPress(e));
  chatMessages.addEventListener('touchstart', (e) => startLongPress(e), { passive: true });
  chatMessages.addEventListener('mouseup', cancelLongPress);
  chatMessages.addEventListener('mouseleave', cancelLongPress);
  chatMessages.addEventListener('touchend', cancelLongPress);
  chatMessages.addEventListener('touchmove', cancelLongPress);

  function startLongPress(e) {
    const msgDiv = e.target.closest('.message.user');
    if (!msgDiv || msgDiv.classList.contains('editing')) return;
    const index = parseInt(msgDiv.getAttribute('data-index'), 10);
    longPressTimer = setTimeout(() => {
      openUserMsgPopover(msgDiv, index);
    }, 550);
  }

  function cancelLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  const onDocClickClosePopover = (e) => {
    if (activePopover && !activePopover.contains(e.target)) closeActivePopover();
  };
  document.addEventListener('click', onDocClickClosePopover);
  cleanupFns.push(() => document.removeEventListener('click', onDocClickClosePopover));

  chatMessages.addEventListener('click', (e) => {
    const cancelBtn = e.target.closest('.cancel-edit-btn');
    if (cancelBtn) {
      cancelBtn.closest('.message.user').classList.remove('editing');
      return;
    }
    const saveBtn = e.target.closest('.save-edit-btn');
    if (saveBtn) {
      const msgDiv = saveBtn.closest('.message.user');
      const index = parseInt(msgDiv.getAttribute('data-index'), 10);
      const newText = msgDiv.querySelector('.edit-textarea').value.trim();
      if (!newText) { showToast('Prompt cannot be empty', 'error'); return; }
      editAndResend(index, newText);
      return;
    }

    // --- Internal tool-page link: hand off context, then navigate (feature 7) ---
    const link = e.target.closest('a.internal-link');
    if (link) {
      e.preventDefault();
      handoffAndNavigate(link);
    }

    // --- File-result card button action (e.g. "Export to PPTX") ---
    const fileActionBtn = e.target.closest('[data-file-action]');
    if (fileActionBtn && window.LixaOrchestrator) {
      const msgDiv = fileActionBtn.closest('.message.assistant');
      const idx = msgDiv ? parseInt(msgDiv.getAttribute('data-index'), 10) : -1;
      const card = idx >= 0 && messages[idx] ? messages[idx].fileCard : null;
      window.LixaOrchestrator.handleFileAction(fileActionBtn.dataset.fileAction, card);
    }
  });

  async function editAndResend(index, newText) {
    if (isWaiting) { showToast('Please wait for the current response to finish', 'error'); return; }
    messages = messages.slice(0, index);
    messages.push({ role: 'user', content: newText, displayContent: newText, timestamp: Date.now() });
    renderMessages();
    if (currentUser) await saveConversation();
    await runAssistantTurn(newText);
  }

  // Gather context from the most recent user turn and send it ahead of
  // navigating to the chosen tool page.
  async function handoffAndNavigate(link) {
    const targetPage = link.dataset.handoffPage || link.getAttribute('href');
    let text = '';
    let rawFile = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        text = messages[i].displayContent || messages[i].content || '';
        if (messages[i]._rawFiles && messages[i]._rawFiles.length) rawFile = messages[i]._rawFiles[0];
        break;
      }
    }
    const payload = { text };
    if (rawFile && window.RehablixHandoff) {
      try {
        payload.fileDataUrl = await readFileAsDataUrl(rawFile);
        payload.fileName = rawFile.name;
        payload.fileMime = rawFile.type;
      } catch (e) { /* file transfer is best-effort */ }
    }
    if (window.RehablixHandoff) window.RehablixHandoff.send(targetPage, payload);
    window.location.href = link.getAttribute('href');
  }

  // =========================================================================
  // Event delegation for AI response action buttons (Copy, Word, Regenerate)
  // =========================================================================
  chatMessages.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.classList.contains('suggestion-chip')) return;
    if (btn.classList.contains('cancel-edit-btn') || btn.classList.contains('save-edit-btn')) return;

    const messageDiv = btn.closest('.message.assistant');
    if (!messageDiv) return;

    const index = parseInt(messageDiv.getAttribute('data-index'), 10);
    if (isNaN(index) || !messages[index]) return;

    if (btn.classList.contains('copy-btn')) {
      const rawContent = messageDiv.getAttribute('data-raw-content') || messages[index].content;
      navigator.clipboard.writeText(rawContent)
        .then(() => {
          btn.classList.add('copied');
          const icon = btn.querySelector('i');
          if (icon) icon.className = 'fas fa-check';
          showToast('Copied to clipboard', 'success');
          setTimeout(() => {
            btn.classList.remove('copied');
            if (icon) icon.className = 'fas fa-copy';
          }, 2000);
        })
        .catch(() => showToast('Copy failed', 'error'));
    }

    if (btn.classList.contains('download-btn')) {
      openInResultEditor(index);
    }

    if (btn.classList.contains('regenerate-btn')) {
      if (isWaiting) {
        showToast('Please wait for the current response to finish', 'error');
        return;
      }
      let userMessageIndex = index - 1;
      while (userMessageIndex >= 0 && messages[userMessageIndex].role !== 'user') {
        userMessageIndex--;
      }
      if (userMessageIndex < 0) {
        showToast('No previous user message to regenerate from', 'error');
        return;
      }
      const userMessageContent = messages[userMessageIndex].content;
      messages.splice(index, 1);
      renderMessages();
      if (currentUser) saveConversation();
      runAssistantTurn(userMessageContent, { isRegenerate: true });
    }
  });

  async function openInResultEditor(index) {
    const msg = messages[index];
    if (!msg) return;
    if (!currentUser) {
      showToast('Log in to open this in the editor and export it', 'info');
      const loginBtn = document.getElementById('loginBtn');
      if (loginBtn) loginBtn.click();
      return;
    }
    let question = '';
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { question = messages[i].displayContent || messages[i].content; break; }
    }
    try {
      const resultsMarkdown = msg.content;
      const resultsHtml = marked.parse(resultsMarkdown);
      const ref = await database.ref(`history/${currentUser.uid}/askResults`).push({
        question: question.slice(0, 200),
        resultsMarkdown,
        resultsHtml,
        date: new Date().toLocaleDateString(),
        createdAt: firebase.database.ServerValue.TIMESTAMP
      });
      window.open(`result.html?type=ask&id=${ref.key}`, '_blank');
    } catch (err) {
      console.error('Failed to open in editor:', err);
      showToast('Could not open the editor. Please try again.', 'error');
    }
  }

  // =========================================================================
  // Typing indicator
  // =========================================================================
  function showTyping() {
    const existingTyping = document.getElementById('typingIndicator');
    if (existingTyping) existingTyping.remove();
    const typingDiv = document.createElement('div');
    typingDiv.className = 'typing-indicator';
    typingDiv.id = 'typingIndicator';
    typingDiv.innerHTML = '<span></span><span></span><span></span>';
    chatMessages.appendChild(typingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function removeTyping() {
    const el = document.getElementById('typingIndicator');
    if (el) el.remove();
  }

  // =========================================================================
  // Generate suggested follow‑up questions
  // =========================================================================
  async function generateSuggestions(lastUserMessage, lastAiResponse) {
    if (!aiConfig.token) {
      const ok = await fetchTokens();
      if (!ok) return [];
    }

    const systemPrompt = `You are a helpful assistant that generates short, natural follow‑up questions based on a conversation.

Given the user's last question and the AI's response, suggest exactly 3 follow‑up questions the user might want to ask next. The questions should:
- Be concise (one sentence each, max 15 words)
- Cover different aspects of the topic
- Sound natural and conversational
- Not repeat the original question

Return ONLY a JSON array of strings. Example format:
["What are the common causes of this condition?","How long does recovery typically take?","Are there any exercises I should avoid?"]

Do NOT include any other text, explanations, or markdown. Return ONLY the JSON array.`;

    try {
      const response = await fetch(`${aiConfig.endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiConfig.token}`
        },
        body: JSON.stringify({
          model: aiConfig.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `User asked: "${lastUserMessage}"\n\nAI responded: "${lastAiResponse.substring(0, 500)}"\n\nGenerate 3 follow‑up questions as a JSON array.` }
          ],
          max_tokens: 200,
          temperature: 0.8,
          top_p: 0.95
        })
      });

      if (!response.ok) return [];
      const data = await response.json();
      const content = data.choices[0].message.content.trim();

      const jsonMatch = content.match(/\[.*\]/s);
      if (jsonMatch) {
        const suggestions = JSON.parse(jsonMatch[0]);
        if (Array.isArray(suggestions) && suggestions.length > 0) return suggestions.slice(0, 3);
      }

      const lines = content.split('\n')
        .map(l => l.replace(/^[\d.\-•*]+\s*/, '').replace(/^["']|["']$/g, '').trim())
        .filter(l => l.length > 10 && l.endsWith('?'))
        .slice(0, 3);

      return lines.length > 0 ? lines : [];
    } catch (error) {
      console.warn('Failed to generate suggestions:', error);
      return [];
    }
  }

  // Turns the first exchange into a short, professional conversation title,
  // instead of just truncating the user's raw first message (feature 3).
  //
  // FIX: this used to request only max_tokens: 30 and simply give up (falling
  // back to the literal string "New Conversation") on any failure — including
  // the AI backend returning a 200 OK with empty content, which happens more
  // often than you'd expect with a tight token budget. It now retries once
  // with more headroom, and if the AI is genuinely unavailable, falls back to
  // a title derived from the user's own first message instead of a useless
  // generic placeholder.
  async function generateConversationTitle(userText, aiReply) {
    if (!aiConfig.token) {
      const ok = await fetchTokens();
      if (!ok) {
        console.warn('[generateConversationTitle] No API token available');
        return localTitleFallback(userText);
      }
    }
    
    // Make sure we have enough text to work with
    const userSnippet = (userText || '').slice(0, 300);
    const aiSnippet = (aiReply || '').slice(0, 300);
    
    if (!userSnippet || !aiSnippet) {
      console.warn('[generateConversationTitle] Insufficient text for title generation');
      return localTitleFallback(userText);
    }

    const aiTitle = await requestTitleFromAI(userSnippet, aiSnippet, 1)
      || await requestTitleFromAI(userSnippet, aiSnippet, 2);

    return aiTitle || localTitleFallback(userText);
  }

  // Derives a readable title straight from the user's own message when the
  // AI is unavailable/empty, so the history list never shows the generic
  // "New Conversation" placeholder just because a single API call failed.
  function localTitleFallback(userText) {
    const cleaned = (userText || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return 'New Conversation';
    const words = cleaned.split(' ').slice(0, 8).join(' ');
    const title = words.length < cleaned.length ? `${words}…` : words;
    return title.charAt(0).toUpperCase() + title.slice(1);
  }

  async function requestTitleFromAI(userSnippet, aiSnippet, attempt) {
    try {
      console.log(`[generateConversationTitle] Calling API for title generation (attempt ${attempt})...`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout
      
      const response = await fetch(`${aiConfig.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${aiConfig.token}` 
        },
        body: JSON.stringify({
          model: aiConfig.model,
          messages: [
            { 
              role: 'system', 
              content: 'Generate a short, professional conversation title (4-7 words, title case, no quotes, no trailing period) that summarizes what the user is asking about. Return ONLY the title text, nothing else.' 
            },
            { 
              role: 'user', 
              content: `User asked: "${userSnippet}"\n\nAI answered about: "${aiSnippet}"` 
            }
          ],
          // Bumped from 30: too tight a budget is exactly what let a 200 OK
          // response come back with zero visible content on the first attempt.
          max_tokens: attempt === 1 ? 60 : 150,
          temperature: 0.5
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        console.error('[generateConversationTitle] API returned error:', response.status);
        return null;
      }
      
      const data = await response.json();
      const choice = data.choices && data.choices[0];
      let title = (choice && choice.message && choice.message.content ? choice.message.content : '')
        .trim().replace(/^["']|["']$/g, '');
      
      // Validate the title
      if (!title || title.length < 3 || title.length > 50) {
        console.warn(`[generateConversationTitle] Invalid/empty title on attempt ${attempt}:`, title);
        return null;
      }
      
      console.log('[generateConversationTitle] Generated title:', title);
      return title;
    } catch (err) {
      if (err.name === 'AbortError') {
        console.warn('[generateConversationTitle] Title generation timed out');
      } else {
        console.error('[generateConversationTitle] Error:', err);
      }
      return null;
    }
  }

  // =========================================================================
  // AI Call (auto-switches to the vision model when images/video frames are present)
  // =========================================================================
  function buildApiContent(msg) {
    if (msg.visionImages && msg.visionImages.length > 0) {
      const parts = [{ type: 'text', text: msg.content }];
      msg.visionImages.forEach(url => parts.push({ type: 'image_url', image_url: { url } }));
      return parts;
    }
    return msg.content;
  }

  // Streams a chat completion via SSE, calling onToken(deltaText, fullSoFar)
  // as chunks arrive. Falls back to a plain buffered response if the
  // provider/browser doesn't give us a readable stream body. Returns the
  // final accumulated text (possibly '' if the provider genuinely sent
  // nothing — callers decide whether/how to retry on that).
  async function streamChatCompletion(config, apiMessages, needsVision, onToken) {
    const url = `${config.endpoint}/chat/completions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: apiMessages,
        max_tokens: 1500,
        temperature: 0.7,
        top_p: 0.9,
        stream: true
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const msg = errData?.error?.message || `API error (${response.status})`;
      if (window.reportApiError) {
        window.reportApiError({
          status: response.status,
          bodyText: JSON.stringify(errData),
          tool: 'ask',
          context: `chat completion (${needsVision ? 'vision' : 'text'})`
        });
      }
      throw new Error(msg);
    }

    if (!response.body || !response.body.getReader) {
      // No streaming support in this environment — fall back to a normal
      // buffered read so the feature still degrades gracefully.
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      if (text) onToken(text, text);
      return text;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) {
            full += delta;
            onToken(delta, full);
          }
        } catch (e) {
          // Ignore partial/malformed SSE chunks — the buffer handles
          // reassembly of split lines; a genuinely bad line is skippable.
        }
      }
    }
    return full;
  }

  // Empty completions happen intermittently with these providers (a 200 OK
  // with no visible content). Retrying once, silently, fixes the vast
  // majority of "Lixa just shows a blank reply" complaints without the user
  // needing to notice or manually hit regenerate.
  async function callAI(onToken) {
    const recentMessages = messages.slice(-20);
    const needsVision = recentMessages.some(m => m.visionImages && m.visionImages.length > 0);

    let config = aiConfig;
    if (needsVision) {
      const ok = await fetchVisionTokens();
      if (ok) {
        config = visionConfig;
      } else {
        showToast('Vision model is not configured — answering from extracted text only.', 'info', 4000);
      }
    }
    if (!config.token) {
      const ok = await fetchTokens();
      if (!ok) throw new Error('AI service is not configured.');
      config = aiConfig;
    }

    const apiMessages = [
      { role: 'system', content: buildSystemPrompt() },
      ...recentMessages.map(m => ({ role: m.role, content: buildApiContent(m) }))
    ];

    let full = await streamChatCompletion(config, apiMessages, needsVision, onToken);
    if (!full || !full.trim()) {
      // Retry once — onToken hasn't fired yet on a genuinely empty attempt,
      // so this is a clean second try, not a duplicate/garbled render.
      full = await streamChatCompletion(config, apiMessages, needsVision, onToken);
    }
    if (!full || !full.trim()) {
      throw new Error('The AI returned an empty response. Please try again.');
    }
    return full;
  }

  // Shared "ask the AI and append its reply" logic, used by send/edit/regenerate.
  // Streams the reply into a live bubble as tokens arrive (raw text, since
  // partial markdown mid-stream renders oddly), then does one final
  // full renderMessages() pass once complete to get proper markdown,
  // action buttons, and suggestions.
  async function runAssistantTurn(promptTextForSuggestions) {
    isWaiting = true;
    sendBtn.disabled = true;
    showTyping();

    let assistantMsg = null;
    let bubbleEl = null;

    function handleToken(deltaText, fullSoFar) {
      if (!assistantMsg) {
        removeTyping();
        assistantMsg = { role: 'assistant', content: '', timestamp: Date.now() };
        messages.push(assistantMsg);
        renderMessages();
        const msgDiv = chatMessages.querySelector('.message.assistant:last-of-type');
        bubbleEl = msgDiv ? msgDiv.querySelector('.message-bubble') : null;
        if (bubbleEl) bubbleEl.classList.add('streaming-text');
      }
      assistantMsg.content = fullSoFar;
      if (bubbleEl) {
        bubbleEl.textContent = fullSoFar;
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    }

    try {
      const reply = await callAI(handleToken);
      removeTyping();
      if (!assistantMsg) {
        // Defensive fallback: streaming produced no visible tokens (e.g. a
        // non-streaming provider path) but callAI still returned text.
        assistantMsg = { role: 'assistant', content: reply, timestamp: Date.now() };
        messages.push(assistantMsg);
      } else {
        assistantMsg.content = reply;
      }
      const suggestions = await generateSuggestions(promptTextForSuggestions, reply);
      assistantMsg.suggestions = suggestions;
      renderMessages();

      // ---- Generate title BEFORE saving, with retry + local fallback ----
      if (currentUser && !titleIsFinal && messages.filter(m => m.role === 'user').length === 1) {
        console.log('[runAssistantTurn] Attempting to generate title for new conversation...');
        try {
          const generatedTitle = await generateConversationTitle(promptTextForSuggestions, reply);
          conversationTitle = generatedTitle && generatedTitle.trim().length > 0
            ? generatedTitle
            : localTitleFallback(promptTextForSuggestions);
          titleIsFinal = true;
          console.log('[runAssistantTurn] Title finalized:', conversationTitle);
        } catch (titleError) {
          console.error('[runAssistantTurn] Title generation failed with error:', titleError);
          conversationTitle = localTitleFallback(promptTextForSuggestions);
          titleIsFinal = true;
        }
      } else if (currentUser && titleIsFinal) {
        console.log('[runAssistantTurn] Title already finalized:', conversationTitle);
      } else if (!currentUser) {
        console.log('[runAssistantTurn] No user logged in, skipping title generation');
      }

      if (currentUser) {
        console.log('[runAssistantTurn] Saving conversation with title:', conversationTitle || 'New Conversation');
        const saved = await saveConversation();
        if (!saved) {
          console.warn('[runAssistantTurn] First save attempt failed, retrying...');
          setTimeout(async () => {
            await saveConversation();
          }, 500);
        } else {
          console.log('[runAssistantTurn] Conversation saved successfully');
          // Refresh the history list to show the new title
          await loadHistoryList();
        }
      }
    } catch (error) {
      removeTyping();
      if (assistantMsg) {
        // Drop the partially-streamed reply rather than leaving/saving a
        // broken half-response — the user sees a clear error toast instead.
        const idx = messages.indexOf(assistantMsg);
        if (idx !== -1) messages.splice(idx, 1);
      }
      const errorMsg = (error.message || '').includes('Service error') ? 'AI service error. Please try again.' : error.message;
      showToast(`Error: ${errorMsg}`, 'error', 5000);
      renderMessages();
      if (currentUser) saveConversation();
    } finally {
      isWaiting = false;
      sendBtn.disabled = false;
      messageInput.disabled = false;
      // Don't force the mobile keyboard back open right after a reply lands —
      // it's disruptive while the user is trying to read (feature 4).
      if (!isMobile) messageInput.focus();
    }
  }

  // =========================================================================
  // Conversation persistence
  // =========================================================================
  async function saveConversation() {
    if (!currentUser) {
      console.warn('[saveConversation] No user logged in – skipping save');
      return false;
    }
    if (messages.length === 0) {
      console.warn('[saveConversation] No messages to save');
      return false;
    }

    const cleanMessages = messages.map(m => ({
      role: m.role,
      content: m.content,
      displayContent: m.displayContent || null,
      attachmentMeta: m.attachmentMeta || null,
      fileCard: m.fileCard || null,
      timestamp: m.timestamp || Date.now()
    }));

    // Use the AI-refined title if we have one; otherwise derive something
    // useful from the conversation itself rather than a generic placeholder.
    let title = conversationTitle;
    if (!title) {
      const firstUserMsg = messages.find(m => m.role === 'user');
      title = localTitleFallback(firstUserMsg ? firstUserMsg.content : '');
    }

    try {
      const refPath = `history/${currentUser.uid}/askConversations`;
      
      if (currentConversationId) {
        // Update existing conversation
        await database.ref(`${refPath}/${currentConversationId}`).update({
          title,
          messages: cleanMessages,
          updatedAt: firebase.database.ServerValue.TIMESTAMP
        });
        console.log('[saveConversation] Updated conversation:', currentConversationId);
        return true;
      } else {
        // Create new conversation
        const newRef = await database.ref(refPath).push({
          title,
          messages: cleanMessages,
          createdAt: firebase.database.ServerValue.TIMESTAMP,
          updatedAt: firebase.database.ServerValue.TIMESTAMP
        });
        currentConversationId = newRef.key;
        console.log('[saveConversation] Created new conversation:', currentConversationId);
        return true;
      }
    } catch (error) {
      console.error('[saveConversation] Error:', error);
      showToast('Failed to save conversation. Check console for details.', 'error', 4000);
      return false;
    }
  }

  // =========================================================================
  // LOAD CONVERSATION - FIXED: No automatic save/update timestamp
  // =========================================================================
  async function loadConversation(convId) {
    if (!currentUser) return;
    try {
      const snap = await database.ref(`history/${currentUser.uid}/askConversations/${convId}`).once('value');
      const data = snap.val();
      if (data) {
        currentConversationId = convId;
        conversationTitle = data.title || null;
        titleIsFinal = true;
        messages = data.messages || [];
        
        // Generate suggestions for the last assistant message
        if (messages.length >= 2) {
          const lastAi = messages[messages.length - 1];
          const lastUser = messages[messages.length - 2];
          if (lastAi.role === 'assistant' && lastUser.role === 'user') {
            try {
              const suggestions = await generateSuggestions(
                lastUser.displayContent || lastUser.content, 
                lastAi.content
              );
              lastAi.suggestions = suggestions;
            } catch (e) {
              // Suggestions are non-critical
              console.warn('Could not generate suggestions for loaded conversation:', e);
            }
          }
        }
        
        renderMessages();
        historyDrawer.classList.remove('active');
        showToast('Conversation loaded', 'success');
        
        // FIXED: Do NOT automatically save/update the timestamp.
        // Only update the timestamp when the user actually sends a new message.
        // Removed the setTimeout(() => saveConversation(), 1000) call.
      }
    } catch (error) {
      console.error('[loadConversation] Error:', error);
      showToast('Failed to load conversation', 'error');
    }
  }

  async function deleteConversation(convId, event) {
    event.stopPropagation();
    if (!currentUser) return;
    if (!confirm('Delete this conversation?')) return;
    try {
      await database.ref(`history/${currentUser.uid}/askConversations/${convId}`).remove();
      if (currentConversationId === convId) newChat();
      loadHistoryList();
      showToast('Conversation deleted', 'success');
    } catch (error) {
      showToast('Failed to delete', 'error');
    }
  }

  function newChat() {
    currentConversationId = null;
    conversationTitle = null;
    titleIsFinal = false;
    messages = [];
    attachedFiles = [];
    renderAttachmentsStrip();
    renderMessages();
    if (!isMobile) messageInput.focus();
  }

  // =========================================================================
  // History list
  // =========================================================================
  let allConversations = [];

  async function loadHistoryList() {
    if (!currentUser) {
      console.warn('[loadHistoryList] No user logged in');
      return;
    }
    try {
      console.log('[loadHistoryList] Fetching conversations for user:', currentUser.uid);
      const snap = await database.ref(`history/${currentUser.uid}/askConversations`).orderByChild('updatedAt').once('value');
      const data = snap.val();
      allConversations = [];
      if (data) {
        allConversations = Object.entries(data).map(([id, item]) => ({ id, ...item }));
        allConversations.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
        console.log('[loadHistoryList] Loaded', allConversations.length, 'conversations');
        allConversations.forEach(c => {
          console.log('  -', c.title, '(ID:', c.id, ')');
        });
      } else {
        console.log('[loadHistoryList] No conversations found');
      }
      renderHistoryList(allConversations);
    } catch (error) {
      console.error('[loadHistoryList] Error:', error);
    }
  }

  function renderHistoryList(conversations) {
    if (!historyList) return;
    historyList.innerHTML = '';
    if (conversations.length === 0) {
      historyList.innerHTML = `
        <div class="empty-state">
          <i class='bx bx-folder-open'></i>
          <p>No conversations yet</p>
        </div>
      `;
      return;
    }

    const searchTerm = historySearchInput?.value.toLowerCase().trim() || '';
    const filtered = conversations.filter(c =>
      !searchTerm || (c.title || '').toLowerCase().includes(searchTerm)
    );

    if (filtered.length === 0) {
      historyList.innerHTML = `
        <div class="empty-state">
          <i class='bx bx-search'></i>
          <p>No matching conversations</p>
        </div>
      `;
      return;
    }

    filtered.forEach(conv => {
      const div = document.createElement('div');
      div.className = 'history-item';
      const date = new Date(conv.updatedAt || conv.createdAt);
      div.innerHTML = `
        <button class="delete-btn" data-id="${conv.id}" title="Delete conversation">
          <i class="fas fa-trash-alt"></i>
        </button>
        <span class="history-title">${escapeHtml(conv.title || 'Untitled')}</span>
        <div class="history-meta">
          <span><i class="far fa-calendar-alt"></i> ${date.toLocaleDateString()}</span>
          <span><i class="far fa-clock"></i> ${date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
          <span>${conv.messages?.length || 0} messages</span>
        </div>
      `;
      div.addEventListener('click', (e) => {
        if (e.target.closest('.delete-btn')) return;
        loadConversation(conv.id);
      });
      div.querySelector('.delete-btn').addEventListener('click', (e) => deleteConversation(conv.id, e));
      historyList.appendChild(div);
    });
  }

  // =========================================================================
  // Send message (assembles text + attachments + URL context)
  // =========================================================================
  async function handleSend() {
    const text = messageInput.value.trim();
    if ((!text && attachedFiles.length === 0) || isWaiting) return;

    if (!currentUser) showToast('Log in to save your conversation', 'info');

    // Lixa tool routing: an "@tool" prefix, an in-progress slot-filling
    // conversation, or a confidently-detected intent takes over the turn
    // instead of going to the general chat model.
    if (window.LixaOrchestrator) {
      const handled = await window.LixaOrchestrator.tryHandle(text, attachedFiles);
      if (handled) {
        messageInput.value = '';
        messageInput.style.height = 'auto';
        attachedFiles = [];
        renderAttachmentsStrip();
        return;
      }
    }

    isWaiting = true;
    sendBtn.disabled = true;
    messageInput.disabled = true;

    messages.forEach(m => { if (m.role === 'assistant') delete m.suggestions; });

    // Attachments (especially OCR on images and multi-page PDFs) can
    // legitimately take longer than a few seconds, particularly on the
    // first use when the extraction library is still downloading from its
    // CDN. Sending before extraction finished was the reason files/images
    // sometimes reached the AI as "(no content extracted)" — wait properly
    // and tell the user why, instead of racing ahead after a short timeout.
    if (attachedFiles.some(a => a.status === 'reading')) {
      showToast('Finishing up your file(s) — this can take a bit longer for scanned images or PDFs…', 'info', 4000);
    }
    const waitStart = Date.now();
    while (attachedFiles.some(a => a.status === 'reading') && Date.now() - waitStart < 45000) {
      await new Promise(r => setTimeout(r, 250));
    }
    if (attachedFiles.some(a => a.status === 'reading')) {
      showToast('Still processing a file — sending now with what\'s ready so far.', 'warning', 4000);
    }

    let fullContent = text || '(see attached file)';
    const attachmentMeta = [];
    const visionImages = [];
    const rawFiles = [];
    if (attachedFiles.length > 0) {
      let block = '\n\n';
      attachedFiles.forEach(att => {
        attachmentMeta.push({ name: att.name, icon: fileTypeIcon(att.file) });
        block += `[Attached file: ${att.name}]\n${att.extractedText || '(no content extracted)'}\n\n`;
        if (att.visionImages) visionImages.push(...att.visionImages);
        rawFiles.push(att.file);
      });
      fullContent += block;
    }

    const urls = extractUrls(text);
    if (urls.length > 0) {
      showToast('Reading linked page(s)…', 'info', 2000);
      for (const url of urls) {
        const content = await fetchUrlContent(url);
        if (content) {
          fullContent += `\n\n[Content from URL: ${url}]\n${content}\n`;
        } else {
          fullContent += `\n\n[Could not read URL: ${url}]\n`;
        }
      }
    }

    const userMsg = {
      role: 'user',
      content: fullContent,
      displayContent: text,
      attachmentMeta,
      timestamp: Date.now(),
      _rawFiles: rawFiles // in-memory only; not persisted (see saveConversation)
    };
    if (visionImages.length > 0) userMsg.visionImages = visionImages;

    messages.push(userMsg);
    renderMessages();
    messageInput.value = '';
    messageInput.style.height = 'auto';
    attachedFiles = [];
    renderAttachmentsStrip();

    if (currentUser) {
      const saved = await saveConversation();
      if (!saved) {
        console.warn('[handleSend] First save attempt failed – will retry after AI response');
      }
    }

    // Store the conversation ID so runAssistantTurn can use it
    const convIdBefore = currentConversationId;
    await runAssistantTurn(text || 'this file');

    // If the conversation ID changed (new conversation), make sure we have it
    if (!convIdBefore && currentConversationId) {
      console.log('[handleSend] New conversation created with ID:', currentConversationId);
    }
  }

  // =========================================================================
  // Event listeners
  // =========================================================================
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
    const stillReading = attachedFiles.some(a => a.status === 'reading');
    sendBtn.disabled = stillReading || isWaiting || (messageInput.value.trim() === '' && attachedFiles.length === 0);
  });

  // Enter-to-send behavior differs on mobile so multi-paragraph prompts are easy to type (feature 2)
  messageInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (isMobile) return; // let Enter insert a newline; only the send button sends
    if (!e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  sendBtn.addEventListener('click', handleSend);

  // If arriving from the homepage search bar (index.html?…redirect to ask.html?q=...),
  // prefill the question and send it automatically.
  (function prefillFromQueryParam() {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q && q.trim()) {
      messageInput.value = q.trim();
      messageInput.dispatchEvent(new Event('input'));
      // Clean the URL so a refresh doesn't resend the same question.
      window.history.replaceState({}, '', 'index.html#/lixa');
      setTimeout(() => handleSend(), 300);
    }
  })();

  newChatBtn.addEventListener('click', () => {
    if (messages.length > 0 && !confirm('Start a new chat? Current conversation will be saved.')) return;
    newChat();
    historyDrawer.classList.remove('active');
    showToast('New conversation started', 'info');
  });

  // =========================================================================
  // History drawer controls
  // =========================================================================
  if (historyNavBtn) {
    historyNavBtn.addEventListener('click', () => {
      if (!currentUser) {
        showToast('Please log in to view history', 'error');
        const loginBtn = document.getElementById('loginBtn');
        if (loginBtn) loginBtn.click();
        return;
      }
      historyDrawer.classList.add('active');
      loadHistoryList();
    });
  }

  if (closeDrawerBtn) {
    closeDrawerBtn.addEventListener('click', () => {
      historyDrawer.classList.remove('active');
    });
  }

  const onDocClickCloseHistoryDrawer = (e) => {
    if (historyDrawer?.classList.contains('active') &&
        !historyDrawer.contains(e.target) &&
        e.target !== historyNavBtn &&
        !historyNavBtn?.contains(e.target)) {
      historyDrawer.classList.remove('active');
    }
  };
  const onDocKeydownCloseHistoryDrawer = (e) => {
    if (e.key === 'Escape' && historyDrawer?.classList.contains('active')) {
      historyDrawer.classList.remove('active');
    }
  };
  document.addEventListener('click', onDocClickCloseHistoryDrawer);
  document.addEventListener('keydown', onDocKeydownCloseHistoryDrawer);
  cleanupFns.push(() => document.removeEventListener('click', onDocClickCloseHistoryDrawer));
  cleanupFns.push(() => document.removeEventListener('keydown', onDocKeydownCloseHistoryDrawer));

  if (historySearchInput) {
    historySearchInput.addEventListener('input', () => renderHistoryList(allConversations));
  }

  // =========================================================================
  // Auth & initialization
  // =========================================================================
  const unsubAuth = firebase.auth().onAuthStateChanged(user => {
    currentUser = user;
    if (user) {
      historyNavBtn.style.display = 'block';
      loadHistoryList();
    } else {
      historyNavBtn.style.display = 'none';
    }
  });
  cleanupFns.push(unsubAuth);

  // =========================================================================
  // Expose a small surface for js/lixa.js to drive the same chat core
  // (append tool-generated messages/file-cards, trigger saves, etc.)
  // without duplicating the message state or the save/render logic here.
  // =========================================================================
  window.LixaCore = {
    getMessages: () => messages,
    pushMessage: (msg) => messages.push(msg),
    render: () => renderMessages(),
    save: () => saveConversation(),
    getCurrentUser: () => currentUser,
    getDatabase: () => database,
    showToast,
    escapeHtml,
    renderFileCard,
    showTyping,
    removeTyping,
    setWaiting: (waiting) => {
      isWaiting = waiting;
      sendBtn.disabled = waiting;
      messageInput.disabled = waiting;
    },
    isWaiting: () => isWaiting,
    scrollToBottom: () => { chatMessages.scrollTop = chatMessages.scrollHeight; },
    refreshHistoryList: () => loadHistoryList()
  };

  async function initialize() {
    await fetchTokens();
    renderMessages();
    // Skip auto-focus on mobile so the keyboard doesn't pop up unprompted
    // the moment the page loads (feature 4).
    if (!isMobile) messageInput.focus();
    console.log('[INIT] Ask AI ready: attachments+vision, voice input, editable prompts, link reading, handoff');
  }

  initialize();
  } // end mount()

  function unmount() {
    cleanupFns.forEach(fn => { try { fn(); } catch (e) { /* best-effort */ } });
    cleanupFns = [];
  }

  // Registered under a distinct name (not window.RehablixViews.lixa) —
  // js/lixa.js is the one that registers the "lixa" route, and calls into
  // this mount()/unmount() pair first before wiring up its own @mention/
  // intent-routing layer on top of the chat core this sets up.
  window.RehablixAskView = { mount, unmount };
})();