// js/lixa-agent/agent-session.js — one Lixa Agent conversation on the web: she
// listens (the browser's speech recognition, live words like the Lixa composer's
// mic), thinks, works in the app and speaks, hands-free, the way the Android app
// does (…/lixa/agent/AgentVoiceSession.kt):
// - talk (greetings, questions, explanations, lessons, quizzes, therapist and
//   patient modes) goes the fast way, streamed straight to her voice; clear work
//   in the app goes to the agent; the AI hands talk over to the agent when needed;
// - Standard waits until she has finished (talking over her is Live mode's, in
//   agent-live.js, which this session hosts: enterLive / leaveLive / liveExchange);
// - every exchange is written into the Lixa chat, as a voice conversation leaves
//   its transcript behind.
// The UI (agent-ui.js) renders `session.view` whenever onChange fires.
(function () {
  'use strict';
  const R = () => window.LixaAgentRules;
  const B = () => window.LixaAgentBrain;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const ANDROID = /Android/i.test(navigator.userAgent || '');

  const SHORT_SENTENCES = 3;
  const HOLD_MS = 900, HOLD_UNFINISHED_MS = 1000, TALK_EXTRA_WAIT_MS = 600;
  const ECHO_WINDOW_MS = 1500;
  const STILL_FIRST_MS = 8000, STILL_NEXT_MS = 15000;
  const TALK_MAX_TOKENS = 1800;
  const PREFS = { short: 'rehab-agent-short', muted: 'rehab-agent-muted', accent: 'rehab-agent-accent', bargeIn: 'rehab-agent-bargein', noConfirm: 'rehab-agent-no-confirm', background: 'rehab-agent-background', screenOn: 'rehab-agent-screen-on' };
  const STOCK_LINES = ['On it!', 'Let me check.', 'One moment.', 'Shall I go on?', 'Done, the screen is clear.'].concat(['Still working on it.', 'Nearly there, just a moment.']);
  const pref = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // The names the user taught her to say (Rules.SayAs), kept on this device.
  const SAY_AS_KEY = 'rehab-agent-say-as';
  // A sentence heard while she rests ends after this much quiet.
  const REST_END_MS = 1000;

  /**
   * The sentence that woke her (restSentence), written down by OpenAI's transcription in English with her vocabulary
   * (through the server's aiTranscribe when the keys are kept there). '' if it can't be.
   */
  async function transcribeSentence(blob, type) {
    if (!blob || blob.size < 1500) return '';
    // (one spoken sentence for the agent: the server's short-clip rule, not the Audio tool's monthly minutes)
    const headers = window.REHABLIX_SERVER_AI ? { 'X-Rehablix-Feature': 'agent' } : {};
    if (!window.REHABLIX_SERVER_AI) {
      const key = await firebase.database().ref('tokens/open_ai').once('value').then(s => (s.val() || {}).api_key).catch(() => null);
      if (!key) return '';
      headers.Authorization = 'Bearer ' + key;
    }
    const fd = new FormData();
    fd.append('file', blob, 'speech.' + (/mp4/.test(type) ? 'm4a' : 'webm'));
    fd.append('model', 'gpt-4o-transcribe');
    fd.append('language', 'en');
    fd.append('prompt', 'Lixa, Rehablix, Smart EMR, Project Maker, Deck Studio, tutor mode, occupational therapy, physiotherapy, rehabilitation.');
    const url = 'https://api.openai.com/v1/audio/transcriptions';
    let res = await fetch(url, { method: 'POST', headers, body: fd });
    if (!res.ok) { fd.set('model', 'whisper-1'); res = await fetch(url, { method: 'POST', headers, body: fd }); }
    if (!res.ok) return '';
    const j = await res.json().catch(() => ({}));
    return j.text || '';
  }

  class HandOff extends Error {}

  class AgentSession {
    constructor(host) {
      this.host = host;
      try { this.sayAs = JSON.parse(pref(SAY_AS_KEY, '{}')) || {}; } catch (e) { this.sayAs = {}; }                      // {route(), open(href), minimize(), close(), pageTitle(), pageDetail(), onChange()}
      this.view = {
        state: 'Idle', heard: '', note: null, status: null, waiting: null, mouth: 0, shape: 0.5, asking: false, waving: false,
        talkMode: null, talkScore: null, details: null, found: [], confirm: null, upgrade: false, reply: '', listening: false,
        canListen: !!SR, moreWaiting: false,
        emotion: 'neutral', body: 'normal'          // her feeling (from what she says) and, in patient mode, the patient's body
      };
      this.muted = pref(PREFS.muted, '0') === '1';
      this.shortAnswers = pref(PREFS.short, '0') === '1';
      // Standard never listens for the user talking over her: since 2026-10-16 (the user's decision) that is Live
      // mode's job (agent-live.js). The interruption code below is kept but never runs while this is false.
      this.bargeIn = false;
      this.accent = pref(PREFS.accent, 'us');
      this.autoApprove = pref(PREFS.noConfirm, '0') === '1';   // ("Ask before changes" off: see setAutoApprove)
      // Talk in the background: Live carries on in another tab or app (as far as the browser lets the page run);
      // Keep screen on: the screen stays on while agent mode is open (agent-ui.js). Both on unless turned off.
      this.background = pref(PREFS.background, '1') !== '0';
      this.keepScreenOn = pref(PREFS.screenOn, '1') !== '0';
      this.handsFree = false;
      this.history = [];
      this.turnBusy = false;
      this.flow = []; this.statusIdx = new Set(); this.playingIndex = -1; this.spoken = new Set();
      this.remainder = []; this.interruptNote = null; this.turnRequest = ''; this.turnLogged = false;
      this.lastSoundAt = 0; this.patientIds = null; this.released = false;
      this.found = { found: {}, n: 0, lines: [] };      // saved items found in this conversation (refs r1, r2, …)
      this.voice = new window.LixaAgentVoice({
        prepare: t => R().SayAs.apply(R().speakable(t, this.patientIds || []), this.sayAs),
        onWaiting: w => this.set({ waiting: w }),
        onProblem: msg => this.set({ note: msg })
      });
      this.voice.accent = this.accent;
      this.recog = null; this.ears = 'off'; this.said = ''; this.holdTimer = null;
      B().loadMap().then(m => { this.map = m; });
      // Live mode (agent-live.js): a live voice conversation next to this one, with the same tools and chat
      this.live = window.LixaAgentLive ? new window.LixaAgentLive(this) : null;
      // one voice for both modes: Standard speaks with the voice chosen for Live (Leda by default)
      if (this.live && this.live.voice) this.voice.herVoice = this.live.voice;
      // Another part of the app is recording (Audio Transcription, js/audio.js): she lets go of the microphone
      // until it is done, so the recording gets the microphone to itself.
      this.micBusy = false;
      this.onMicBusy = e => {
        const busy = !!(e && e.detail && e.detail.busy);
        if (busy === this.micBusy) return;
        this.micBusy = busy;
        if (busy && this.live && this.live.on) this.live.end(false);
        this.set({ note: busy ? "I've stopped listening while Audio Transcription records." : null });
        if (!busy && this.handsFree && this.state === 'Idle') this.setState('Listening');
        this.syncEars();
      };
      window.addEventListener('rehablix:mic-busy', this.onMicBusy);
    }

    /** Her voice, for Standard and Live together. */
    setVoice(name) {
      if (this.live) this.live.chooseVoice(name);
      const v = this.live ? this.live.voice : name;
      if (v && v !== this.voice.herVoice) { this.voice.herVoice = v; this.voice.warmUp(STOCK_LINES).catch(() => {}); }
      this.host.onChange();
    }

    set(patch) { Object.assign(this.view, patch); this.host.onChange(); }
    get state() { return this.view.state; }
    setState(s) { if (this.view.state !== s) { this.view.state = s; this.syncEars(); this.host.onChange(); } }

    // ------------------------------------------------------------------ settings
    setMuted(on) { this.muted = on; setPref(PREFS.muted, on ? '1' : '0'); if (on) this.voice.stop(); this.host.onChange(); }
    setShort(on) { this.shortAnswers = on; setPref(PREFS.short, on ? '1' : '0'); this.host.onChange(); }
    setBackground(on) { this.background = on; setPref(PREFS.background, on ? '1' : '0'); this.host.onChange(); }
    setKeepScreenOn(on) { this.keepScreenOn = on; setPref(PREFS.screenOn, on ? '1' : '0'); this.host.onChange(); }
    setAccent(a) {
      if (window.LixaAgentVoice.ACCENTS.indexOf(a) < 0) return;
      this.accent = a; this.voice.accent = a; setPref(PREFS.accent, a);
      this.voice.warmUp(STOCK_LINES).catch(() => {});
      this.host.onChange();
    }

    /** Agent mode opened (from a tap: the browser now allows her voice and the microphone). */
    open() {
      this.voice.unlock();
      this.loadPatientIds();
      this.voice.warmUp(STOCK_LINES).catch(() => {});
      if (SR) this.listen(); else this.set({ note: "This browser can't listen. Type to Lixa below, or use Chrome, Edge or Safari." });
    }

    release() {
      this.released = true;
      window.removeEventListener('rehablix:mic-busy', this.onMicBusy);
      if (this.live) this.live.release();
      this.stop();
      this.handsFree = false;
      this.stopRest();
      this.stopRecog();
      if (this.restCtx) { try { this.restCtx.close(); } catch (e) { /* ignore */ } this.restCtx = null; }
    }

    // ------------------------------------------------------------------ patients' identifiers (never said aloud by the cloud voice)
    async loadPatientIds() {
      if (this.patientIds) return this.patientIds;
      const u = B().user();
      if (!u) { this.patientIds = []; return this.patientIds; }
      const scopes = [u.uid];
      try { const c = window.RehablixCenter && await window.RehablixCenter.getEffectiveScopeUid('doc'); if (c && scopes.indexOf(c) < 0) scopes.push(c); } catch (e) { /* personal only */ }
      const ids = [];
      await Promise.all(scopes.map(async sc => {
        try {
          const idx = (await firebase.database().ref('history/' + sc + '/patientIndex').once('value')).val() || {};
          Object.values(idx).forEach(p => { if (p) ids.push.apply(ids, window.RehablixDeidentify.identifiersOf(p)); });
        } catch (e) { /* no access */ }
      }));
      this.patientIds = ids;
      return ids;
    }

    // ------------------------------------------------------------------ listening (the browser's recogniser)
    /** Start listening and keep listening (hands-free). */
    listen() {
      if (!SR) return;
      if (this.view.confirm) return;
      if (this.micBusy) { this.set({ note: 'Audio Transcription is using the microphone. I can listen again once it stops recording.' }); return; }
      this.stop();
      this.micDenied = false;                 // (a tap on the mic tries the microphone again)
      this.handsFree = true;
      this.stopRest();                        // (a tap means the user is about to speak: the recogniser starts at once)
      this.set({ note: null });
      this.setState('Listening');
      this.syncEars();
    }
    /** A whiteboard lesson starts or stops talking through her (js/whiteboard/whiteboard-service.js). */
    setNarrating(on) { this.narrating = !!on; this.syncEars(); }
    /** The mic button while listening: stop listening (she stays). */
    stopListening() { this.handsFree = false; this.said = ''; clearTimeout(this.holdTimer); this.set({ heard: '' }); if (this.state === 'Listening') this.setState('Idle'); this.syncEars(); }

    /** What the recogniser should be doing now. */
    wantedEars() {
      if (this.released || !SR || this.micDenied || this.micBusy) return 'off';
      // (Live has the microphone: a yes or no to a Confirm card is heard by Live itself)
      if (this.live && this.live.on) return 'off';
      if (this.view.confirm) return 'confirm';
      // (a whiteboard lesson is talking through her: she does not hear the lesson as the user)
      if (this.narrating) return 'off';
      const s = this.state;
      if (s === 'Listening' || s === 'Idle') return this.handsFree && !this.turnBusy ? 'listen' : 'off';
      if (s === 'Speaking') return this.bargeIn && !this.muted ? 'interrupt' : 'off';
      if ((s === 'Thinking' || s === 'Working') && this.turnBusy) return this.bargeIn && this.handsFree ? 'add' : 'off';
      return 'off';
    }
    syncEars() {
      const want = this.wantedEars();
      if (want !== this.ears) { this.ears = want; this.said = ''; clearTimeout(this.holdTimer); }
      if (want !== 'listen') this.stopRest();
      if (want === 'off') this.stopRecog(); else if (!this.resting) this.startRecog();
      this.view.listening = want === 'listen';
    }
    startRecog() {
      if (this.recog) return;
      const r = new SR();
      const lang = (navigator.language || 'en-US');
      r.lang = /^en\b/i.test(lang) ? lang : 'en-US';
      // (Chrome on Android repeats earlier words in "continuous" mode — the caption showed words said once several times —
      // so there it listens one sentence at a time and starts again by itself, as the Lixa chat's mic does)
      r.continuous = !ANDROID; r.interimResults = true; r.maxAlternatives = 1;
      r.onresult = e => { r.heard = true; this.onResult(e); };
      r.onerror = e => {
        const noMic = e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture';
        if (noMic) {
          // (no more tries until the user taps the mic; what she is doing now carries on)
          this.micDenied = true; this.handsFree = false;
          this.set({ note: e.error === 'audio-capture' ? 'No microphone was found. You can type to Lixa below.' : 'Lixa needs your microphone. Allow it in the browser, or type below.' });
          if (this.state === 'Listening') this.setState('Idle'); else this.syncEars();
        } else if (e.error === 'network') this.set({ note: "Listening needs the internet, and it can't be reached right now." });
      };
      r.onend = () => {
        if (this.recog !== r) return;
        this.recog = null;
        // (browsers end a session after a while of silence or on errors: it starts again while it is still wanted)
        if (this.wantedEars() === 'off') return;
        // (on Android, nobody spoke in that session: she rests, without the recogniser and its tones, until somebody does)
        if (ANDROID && !r.heard && this.ears === 'listen' && !this.said) { this.rest(); return; }
        this.restartRecogSoon();
      };
      this.recog = r;
      try { r.start(); } catch (e) { this.recog = null; }
    }
    stopRecog() { const r = this.recog; this.recog = null; if (r) { try { r.abort(); } catch (e) { /* ignore */ } } }
    restartRecogSoon(ms) { setTimeout(() => { if (!this.recog && !this.resting && this.wantedEars() !== 'off') this.startRecog(); }, ms || 250); }

    // ------------------------------------------------------------------ resting (no tones while nobody speaks)
    // Chrome on Android plays a tone each time its recogniser starts and stops, and with nobody speaking a session
    // ends after a few seconds and has to be started again: a tone every few seconds in a quiet room (a page cannot
    // mute it). So after a silent session she rests: the microphone is only read for its loudness (no recogniser, no
    // tone, nothing sent anywhere), and the recogniser starts the moment somebody begins to speak.
    rest() {
      if (this.resting || this.released) return;
      const md = navigator.mediaDevices;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!md || !md.getUserMedia || !Ctx) { this.restartRecogSoon(); return; }
      this.resting = true;
      const token = this.restToken = {};
      md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } }).then(stream => {
        if (this.restToken !== token) { stream.getTracks().forEach(t => t.stop()); return; }
        const ctx = this.restCtx || (this.restCtx = new Ctx());
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser(); an.fftSize = 1024; src.connect(an);
        const buf = new Float32Array(an.fftSize);
        this.restStream = stream; this.restSrc = src;
        // 2026-10-23: the microphone is also RECORDED while she rests, so the sentence that wakes her is kept whole
        // (starting the recogniser when speech began lost its start: "…give some lessons to me" heard as "me", and short
        // words like "yes"). That sentence is written down by the transcription service; the recogniser starts after it.
        const recording = this.startRestRecorder(stream);
        let floor = -55, frames = 0;
        const recent = [];
        let speaking = false, voiced = 0, quiet = 0, lastLoud = 0;
        this.restTimer = setInterval(() => {
          an.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const db = 10 * Math.log10(sum / buf.length + 1e-12);
          // the first fifth of a second only measures the room
          if (++frames <= 7) { floor += 0.5 * (db - floor); return; }
          const loud = db > floor + 9 && db > -50;
          if (!loud) floor += (db < floor ? 0.3 : 0.02) * (db - floor);
          else lastLoud = Date.now();
          recent.push(loud); if (recent.length > 8) recent.shift();
          // a voice: loud for about 150 ms of the last 240 ms (a click or a knock is shorter)
          const voice = recent.filter(Boolean).length >= 5;
          if (!recording) { if (voice) this.wake(); return; }
          if (!speaking) {
            if (voice) { speaking = true; voiced = 0; quiet = 0; this.set({ heard: '…' }); }
            // (a long quiet stretch is not kept: the recording starts afresh, never in the middle of a sound)
            else if (Date.now() - this.restRec.startedAt > 8000 && Date.now() - lastLoud > 600) this.restRec = this.startRestRecorder(stream, true) || this.restRec;
            return;
          }
          if (loud) { voiced++; quiet = 0; } else quiet++;
          // the sentence is over after about a second of quiet (or after 30 seconds of talking)
          if (quiet * 30 >= REST_END_MS || Date.now() - this.restRec.startedAt > 30000) {
            if (voiced * 30 >= 200) this.restSentence();
            else { speaking = false; this.set({ heard: '' }); }        // (a cough, a knock: she keeps resting)
          }
        }, 30);
      }, () => {
        // (the microphone can't be read this way: the recogniser as before)
        if (this.restToken === token) { this.resting = false; this.restToken = null; this.restartRecogSoon(); }
      });
    }
    /** Somebody began to speak while she rested: the recogniser takes over (once the microphone is let go). */
    wake() {
      if (!this.resting) return;
      this.stopRest();
      this.restartRecogSoon(150);
    }
    /** Records the resting microphone (null where the browser can't). [again]: the previous recording is dropped. */
    startRestRecorder(stream, again) {
      if (typeof MediaRecorder === 'undefined') return null;
      if (again && this.restRec) { try { this.restRec.rec.onstop = null; this.restRec.rec.stop(); } catch (e) { /* ignore */ } }
      try {
        const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
        const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
        const r = { rec, chunks: [], startedAt: Date.now(), type: rec.mimeType || type || 'audio/webm' };
        rec.ondataavailable = e => { if (e.data && e.data.size) r.chunks.push(e.data); };
        rec.start(250);
        this.restRec = r;
        return r;
      } catch (e) { return null; }
    }
    /** The sentence that woke her: written down, then taken like anything the recogniser hears; it listens again after. */
    restSentence() {
      const r = this.restRec;
      this.restRec = null;
      clearInterval(this.restTimer); this.restTimer = null;
      if (!r) { this.wake(); return; }
      r.rec.onstop = async () => {
        const blob = new Blob(r.chunks, { type: r.type });
        this.stopRest();
        let text = '';
        try { text = await transcribeSentence(blob, r.type); } catch (e) { text = ''; }
        if (this.released) return;
        text = R().fixName(String(text || '').trim());
        if (text && this.ears === 'listen' && !this.view.confirm) {
          clearTimeout(this.holdTimer);
          this.said = (this.said + ' ' + text).trim();
          this.set({ heard: this.said, note: null });
          const wait = HOLD_MS + (R().Unfinished.looks(this.said) ? HOLD_UNFINISHED_MS : 0) + (this.view.talkMode ? TALK_EXTRA_WAIT_MS : 0);
          this.holdTimer = setTimeout(() => { const t = this.said; this.said = ''; if (t) this.ask(t); }, wait);
        } else if (!text) this.set({ heard: '' });
        this.restartRecogSoon(150);          // (more may follow: the recogniser listens now, started before it is said)
      };
      try { r.rec.stop(); } catch (e) { this.wake(); }
    }
    stopRest() {
      this.resting = false; this.restToken = null;
      if (this.restRec) { try { this.restRec.rec.onstop = null; this.restRec.rec.stop(); } catch (e) { /* ignore */ } this.restRec = null; }
      clearInterval(this.restTimer); this.restTimer = null;
      if (this.restSrc) { try { this.restSrc.disconnect(); } catch (e) { /* ignore */ } this.restSrc = null; }
      if (this.restStream) { this.restStream.getTracks().forEach(t => { try { t.stop(); } catch (e) { /* ignore */ } }); this.restStream = null; }
    }

    onResult(e) {
      let finals = '', interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finals += t; else interim += t;
      }
      finals = finals.trim(); interim = interim.trim();
      const mode = this.ears;
      if (mode === 'confirm') { const t = finals || ''; if (t) this.hearConfirm(t); return; }
      if (mode === 'interrupt') { this.hearOverHer(finals, interim); return; }
      if (mode === 'add') { if (finals) this.addToRequest(finals); return; }
      if (mode !== 'listen') return;
      // her own voice coming back just after she stopped (a long run of her words in her order) is not the user
      if (finals && Date.now() - this.lastSoundAt < ECHO_WINDOW_MS && R().Interruptions.isEchoRun(finals, this.flow.join(' '))) return;
      clearTimeout(this.holdTimer);
      if (finals) {
        // the same words delivered twice (some browsers do) are kept once
        const f = R().fixName(finals), low = this.said.toLowerCase();
        if (!low.endsWith(f.toLowerCase())) this.said = (f.toLowerCase().startsWith(low) && low ? f : this.said + ' ' + f).trim();
      }
      const shown = (this.said + ' ' + R().fixName(interim)).trim();
      this.set({ heard: shown, note: null });
      if (!this.said || interim) return;
      // the user may only be pausing: wait a moment for more (longer when it sounds unfinished, or in a lesson/quiz)
      const wait = HOLD_MS + (R().Unfinished.looks(this.said) ? HOLD_UNFINISHED_MS : 0) + (this.view.talkMode ? TALK_EXTRA_WAIT_MS : 0);
      this.holdTimer = setTimeout(() => { const t = this.said; this.said = ''; if (t) this.ask(t); }, wait);
    }

    /** Words over her voice: she stops only for real words from the user. */
    hearOverHer(finals, interim) {
      const text = R().fixName((finals || interim || '').trim());
      if (!text) return;
      if (!finals && R().Interruptions.words(text).length < 3) return;          // (wait for a little more)
      if (!this.isRealInterruption(text)) return;
      const I = R().Interruptions;
      const said = I.withoutEcho(text, this.spoken);
      if (I.isStop(said) || I.isStop(text)) { this.rememberCutOff(); this.stop(); this.settle(); return; }
      // she stops at once and takes it in, knowing where she was cut off
      this.interruptNote = this.rememberCutOff();
      this.voice.stop();
      if (this.job) this.job.abort();
      this.turnBusy = false;
      this.handsFree = true;
      this.said = finals ? said : '';
      this.set({ heard: said, mouth: 0 });
      this.ears = 'listen';
      this.setState('Listening');
      if (finals) { clearTimeout(this.holdTimer); this.holdTimer = setTimeout(() => { const t = this.said; this.said = ''; if (t) this.ask(t); }, HOLD_MS); }
    }

    isRealInterruption(text) {
      const I = R().Interruptions;
      if (!I.hasWords(text) || I.isEcho(text, this.spoken) || R().Reactions.isOwn(text)) return false;
      const said = I.withoutEcho(text, this.spoken);
      return I.hasWords(said) && !I.isBackchannel(said);
    }

    /** Said while she thinks or works: added to the request, which starts again with both. */
    addToRequest(raw) {
      const I = R().Interruptions;
      const text = R().fixName(raw).trim();
      if (!text || R().Reactions.isOwn(text) || I.isEcho(text, this.spoken) || I.isEchoRun(text, this.flow.join(' ')) || !I.hasWords(text) || I.isBackchannel(text)) return;
      if (!this.turnBusy) { this.ask(text); return; }
      const base = this.currentSaid || '';
      this.set({ heard: text, note: 'Adding that to your request.' });
      this.restarting = true;
      this.ask(base ? base + '\n(While you were working on this, I added: ' + text + ')' : text);
    }

    // ------------------------------------------------------------------ a turn
    stop() {
      clearTimeout(this.holdTimer); this.said = '';
      if (this.job) { this.job.abort(); this.job = null; }
      clearTimeout(this.stillTimer);
      this.voice.stop();
      this.turnBusy = false;
      if (this.confirmResolve) { const r = this.confirmResolve; this.confirmResolve = null; r(false); }
      this.set({ status: null, waiting: null, mouth: 0, confirm: null });
    }

    /** After a turn: back to listening (hands-free) or idle. */
    settle() {
      this.turnBusy = false;
      this.set({ status: null, mouth: 0 });
      this.setState(this.handsFree ? 'Listening' : 'Idle');
      this.syncEars();
    }

    typed(text) {
      const t = String(text || '').trim();
      if (!t) return;
      // in Live, what is typed goes to her there
      if (this.live && this.live.on) { if (this.live.typed(t)) this.set({ heard: t }); return; }
      this.voice.unlock();
      this.stop();
      this.set({ heard: t });
      // A pasted presentation or report: kept here as it is (emr_create_patient reads it on this device), and the SI
      // gets it with the patient's name, date of birth and phone taken out.
      const F = window.RehablixEmrFromText;
      if (F && t.length >= 200) {
        this.pastedReport = t;
        this.ask(F.deidentify(t, F.identifiers(t)));
        return;
      }
      this.ask(t);
    }

    ask(text) {
      const cutOff = this.interruptNote; this.interruptNote = null;
      const again = !!this.restarting; this.restarting = false;
      const Rr = R();
      if (this.view.confirm) { this.hearConfirm(text); return; }
      if (this.view.moreWaiting && Rr.WANTS_MORE.test(text)) { this.continueReply(); return; }
      if (Rr.Farewell.isGoodbye(text)) { this.sayAndDo(text, Rr.Farewell.line(), true); return; }
      const page = this.map && Rr.OpenPage.target(text, this.map);
      if (page) { this.openPage(text, page); return; }
      if (Rr.ClearScreen.isClear(text)) { this.host.clearScreen(); this.sayAndDo(text, 'Done, the screen is clear.', false); return; }
      const change = Rr.Talk.change(text, this.view.talkMode);
      if (change && change.start) { this.voice.role = null; this.set({ talkMode: change.start, talkScore: null, body: 'normal' }); this.learnPatientBody(text); this.endingTalk = false; }
      else if (change && change.end) this.endingTalk = true;
      this.set({ moreWaiting: false }); this.remainder = [];
      this.run(signal => this.answer(text, cutOff, again, signal));
    }

    /** Runs one turn (cancelling the one before), with the shared failure handling. */
    run(fn) {
      if (this.job) this.job.abort();
      const ctl = new AbortController();
      this.job = ctl;
      this.turnBusy = true;
      this.syncEars();
      fn(ctl.signal).catch(e => {
        if (ctl.signal.aborted || (e && e.name === 'AbortError')) return;
        clearTimeout(this.stillTimer);
        this.voice.stop();
        if (e instanceof B().QuotaError) { this.inviteToUpgrade(); this.fail(e.message); return; }
        this.fail(e instanceof B().AiError && e.status === 0 ? "I can't reach the internet right now. Nothing was changed." : "Sorry, that didn't work. Nothing was changed.");
      }).finally(() => { if (this.job === ctl) this.job = null; });
    }

    fail(message) {
      this.turnBusy = false;
      this.set({ note: message, status: null, mouth: 0 });
      this.setState('Error');
      clearTimeout(this.errorTimer);
      this.errorTimer = setTimeout(() => { if (this.state === 'Error') this.settle(); }, 4000);
    }

    inviteToUpgrade() { if (B().plan() === 'free') this.set({ upgrade: true }); }

    newFlow() { this.flow = []; this.statusIdx = new Set(); this.playingIndex = -1; }
    queue(job, sentence) { R().Interruptions.words(sentence).forEach(w => this.spoken.add(w)); this.flow.push(sentence); if (job) job.add(sentence); }
    queueStatus(job, sentence) { this.statusIdx.add(this.flow.length); this.queue(job, sentence); }

    /** Plays what is queued on the returned job; the mascot speaks from the first sentence of the answer on. */
    startSpeaking() {
      if (this.muted) { this.speechJob = null; return null; }
      return (this.speechJob = this.voice.speak(ev => {
        const v = this.view;
        v.mouth = ev.amplitude; v.shape = ev.shape;
        v.viseme = ev.speaking && ev.viseme != null ? ev.viseme : -1;        // (the sound being said: "m" shuts her lips, "o" rounds them)
        if (ev.speaking) {
          this.lastSoundAt = Date.now();
          if (ev.sentence !== this.playingIndex) {
            const s = this.flow[ev.sentence] || '';
            v.asking = /\?\s*$/.test(s); v.waving = R().GREETING.test(s);
            this.showMood(s);
            this.playingIndex = Math.max(this.playingIndex, ev.sentence);
          }
          if (!this.statusIdx.has(ev.sentence) && (this.state === 'Thinking')) { this.setState('Speaking'); return; }
        } else { v.asking = false; v.waving = false; }
      }));
    }

    /** She was cut off: the conversation remembers what she said and had not said yet. */
    rememberCutOff() {
      if (!this.turnRequest) return null;
      const answerAt = this.flow.map((s, i) => i).filter(i => !this.statusIdx.has(i));
      const said = answerAt.filter(i => i <= this.playingIndex).map(i => this.flow[i]).join(' ');
      const unsaid = answerAt.filter(i => i > this.playingIndex).map(i => this.flow[i]).concat(this.remainder).join(' ');
      const note = "(You were answering the user's previous message when they interrupted you." +
        (said ? ' You had already said aloud: "' + said.slice(0, 1500) + '".' : ' You had not started your answer yet.') +
        (unsaid ? ' You had not yet said: "' + unsaid.slice(0, 1500) + '".' : '') +
        ' Take what they say now into account. If it adds to or corrects their request, answer that request again with it, without repeating what you already said. If it is a new question, answer it. If they ask you to go on, continue from where you stopped.)';
      const text = (said || '(I had not started my answer yet.)') + ' [The user interrupted me here.' + (unsaid ? ' I had not yet said: ' + unsaid + ']' : ']');
      if (this.turnLogged) { for (let i = this.history.length - 1; i >= 0; i--) if (this.history[i].role === 'assistant') { this.history[i] = { role: 'assistant', content: text }; break; } }
      else { this.history.push({ role: 'user', content: this.turnRequest }, { role: 'assistant', content: text }); this.turnLogged = true; }
      this.turnRequest = '';
      return note;
    }

    /** Remembers a pronunciation taught in said (Rules.SayAs), on this device. */
    learnSayAs(said, lastReply) {
      const t = R().SayAs.learn(said, lastReply);
      if (!t) return;
      Object.keys(this.sayAs).forEach(k => { if (k.toLowerCase() === t[0].toLowerCase()) delete this.sayAs[k]; });
      this.sayAs[t[0]] = t[1];
      const keys = Object.keys(this.sayAs);
      while (keys.length > R().SayAs.MAX) delete this.sayAs[keys.shift()];
      setPref(SAY_AS_KEY, JSON.stringify(this.sayAs));
    }

    async answer(said, cutOff, again, signal) {
      signal = signal || (this.job && this.job.signal);
      this.currentSaid = said;
      // "Adeoye is pronounced …": her voice says it that way from now on (about a name in her last answer if unsaid)
      this.learnSayAs(said, this.view.reply);
      this.set({ status: 'Thinking…', reply: '', note: null, mouth: 0 });
      this.setState('Thinking');
      if (!again) this.spoken = new Set();
      this.newFlow();
      if (!this.patientIds) await Promise.race([this.loadPatientIds(), sleep(700)]);
      const Rr = R(), Br = B();
      const ids = this.patientIds || [];
      const request = (cutOff ? cutOff + '\n\nWhat the user says now: ' : '') + window.RehablixDeidentify.scrubText(said, ids);
      const talk = this.view.talkMode;
      const ending = !!(this.endingTalk && talk); this.endingTalk = false;
      // (a whiteboard lesson on screen: everything goes through the agent, which sees the lesson and can answer a
      // question about it on the board as a new scene)
      const lessonOnScreen = !talk && this.host.route() === 'whiteboard' && !!(window.RehablixWhiteboardView && window.RehablixWhiteboardView.player && window.RehablixWhiteboardView.player());
      const direct = !!talk || (!lessonOnScreen && !Rr.Talk.needsApp(said));
      const reaction = this.muted || direct || again ? null : Rr.Reactions.pick(said);
      const job = this.startSpeaking();
      this.turnRequest = request; this.turnLogged = false;
      // (a request to read something aloud is read in full, whatever the "short answers" setting)
      const keepShort = this.shortAnswers && !talk && !/\b(read|recite|go through|dictate)\b/i.test(said);
      const limit = keepShort ? SHORT_SENTENCES : Infinity;
      let streamCall = -1, streamedLength = 0, splitter = new Rr.SentenceSplitter(), queued = 0, saidForTool = false;
      const pushText = (shown) => {
        if (shown.length <= streamedLength) return;
        const delta = shown.slice(streamedLength); streamedLength = shown.length;
        splitter.push(delta).forEach(s => { if (queued < limit) { this.queue(job, s); queued++; } });
        if (this.view.status) this.set({ status: null });
      };
      if (reaction) this.queueStatus(job, reaction);
      // A reasoning model (Medulla 200, Blix 360) can think in silence for a while: after a few quiet seconds she says so.
      const thinkTimer = !this.muted && !reaction && ['medulla200', 'blix360'].indexOf(Br.agentModelId()) >= 0
        ? setTimeout(() => { if (!streamedLength && !queued && !saidForTool) { try { this.queueStatus(job, 'Let me think that through.'); } catch (e) { /* the turn is over */ } } }, 5000) : null;

      let outcome = null;
      if (direct) {
        // talk: a short spoken-style prompt, the reply streamed straight to her voice (null: it needs the app after all)
        const page = (this.map && this.map.entry(this.host.route()) || {}).title || 'Lixa';
        const messages = [{ role: 'system', content: Rr.Talk.systemPrompt(talk, page, ending, B().userName()) }].concat(this.history.slice(talk ? -24 : -10), [{ role: 'user', content: request }]);
        const filter = new Rr.TalkFilter();
        try {
          const full = await Br.stream(messages, { maxTokens: TALK_MAX_TOKENS, temperature: talk ? 0.6 : 0.5 }, f => {
            const shown = filter.visible(f);
            if (filter.handOff) throw new HandOff();
            // She turns down something in the app ("I can't open…"): her tools can, so the agent takes it (before it is said).
            if (!talk && Rr.Talk.refuses(shown)) throw new HandOff();
            if (talk && talk.kind === 'PATIENT' && !ending && filter.voice && !this.voice.role) this.voice.role = filter.voice;
            pushText(shown);
          }, signal);
          if (filter.score) this.set({ talkScore: filter.score });
          const text = filter.visible(full).trim();
          // She said she made (or is making) something, but talk cannot make anything: the agent does it now.
          if (!talk && Rr.Talk.claimsAction(text)) throw new HandOff();
          outcome = { reply: text || 'Sorry, I lost my train of thought there. Could you say that again?' };
        } catch (e) {
          if (!(e instanceof HandOff)) throw e;
          streamedLength = 0; queued = 0; splitter = new Rr.SentenceSplitter();
        }
        if (ending) { this.voice.role = null; this.set({ talkMode: null, body: 'normal' }); }
        if (outcome) this.learnPatientBody(outcome.reply);       // patient mode: the patient's body, once they describe themselves
        if (!outcome && !this.muted && !again && !reaction) { const r = Rr.Reactions.pick(said); if (r) this.queueStatus(job, r); }
      }
      if (!outcome) {
        if (!this.map) this.map = await Br.loadMap();
        outcome = await Br.runAgent(request, this.history.slice(-8), this.map, this.toolHost(), {
          onReplyText: (call, text) => { if (this.muted) return; if (call !== streamCall) { streamCall = call; streamedLength = 0; splitter = new Rr.SentenceSplitter(); } pushText(text); },
          onSay: text => { saidForTool = true; Rr.SpeechText.sentences(text).forEach(s => this.queueStatus(job, s)); },
          onToolStart: (name, args, title) => {
            this.setState('Working');
            this.set({ status: Rr.StatusLines.shown(name, title) });
            if (!saidForTool && !this.muted) { const l = Rr.StatusLines.spoken(name, title); if (l) this.queueStatus(job, l); }
            saidForTool = false;
            clearTimeout(this.stillTimer);
            let i = 0;
            const still = () => { if (this.state !== 'Working' || this.muted || i >= Rr.StatusLines.STILL.length) return; this.queueStatus(job, Rr.StatusLines.STILL[i++]); this.stillTimer = setTimeout(still, STILL_NEXT_MS); };
            this.stillTimer = setTimeout(still, STILL_FIRST_MS);
          },
          onToolEnd: () => { clearTimeout(this.stillTimer); this.set({ status: 'Thinking…' }); if (this.state === 'Working') this.setState('Thinking'); },
          confirm: (text, tapOnly) => this.askToConfirm(text, tapOnly ? text.replace(/\?$/, '') + '? This can\'t be undone: tap Confirm if you want me to go ahead.' : null, false, tapOnly),
          approvePlan: steps => this.askToStart(steps),
          onPlanProgress: steps => this.set({ plan: { steps: steps.map(s => Object.assign({}, s)), awaiting: false } })
        }, signal, this.found);
        if (thinkTimer) clearTimeout(thinkTimer);
      }
      clearTimeout(this.stillTimer);
      if (signal && signal.aborted) return;
      this.set({ status: null });

      const sentences = Rr.SpeechText.sentences(outcome.reply);
      const held = [];
      sentences.forEach((s, i) => { if (i < queued) return; if (keepShort && i >= SHORT_SENTENCES) held.push(s); else this.queue(job, s); });
      if (held.length) { this.remainder = held; this.set({ moreWaiting: true }); this.queue(job, 'Shall I go on?'); }
      const written = outcome.reply + (outcome.details ? '\n\n' + outcome.details : '');
      this.set({ reply: written, details: outcome.details || this.view.details });
      if (!this.turnLogged) { this.history.push({ role: 'user', content: request }, { role: 'assistant', content: written }); this.turnLogged = true; }
      this.recordInChat(said, written);
      if (job) { job.close(); await job.done; }
      if (signal && signal.aborted) return;
      if (this.muted && outcome.reply) this.set({ note: outcome.reply.slice(0, 600) });
      if (outcome.close) { this.host.close(); return; }
      this.settle();
    }

    continueReply() {
      const rest = this.remainder; this.remainder = [];
      this.set({ moreWaiting: false });
      this.run(async signal => {
        this.newFlow();
        this.spoken = new Set();
        const job = this.startSpeaking();
        this.setState('Thinking');
        rest.forEach(s => this.queue(job, s));
        if (job) { job.close(); await job.done; }
        if (!signal.aborted) this.settle();
      });
    }

    sayAndDo(said, line, close) {
      this.set({ moreWaiting: false }); this.remainder = [];
      this.run(async signal => {
        this.history.push({ role: 'user', content: said }, { role: 'assistant', content: line });
        this.recordInChat(said, line);
        this.newFlow(); this.spoken = new Set();
        this.setState('Thinking');
        const job = this.startSpeaking();
        this.queue(job, line);
        if (job) { job.close(); await job.done; }
        if (signal.aborted) return;
        if (close) this.host.close(); else this.settle();
      });
    }

    openPage(said, e) {
      this.run(async signal => {
        this.setState('Working');
        this.set({ status: 'Opening ' + e.title + '…' });
        let line;
        if (e.needsLogin && !B().user()) line = 'Please log in first to use ' + e.title + '.';
        else { this.host.open(e.route); line = 'Opening ' + e.title + '.'; }
        this.set({ status: null });
        this.history.push({ role: 'user', content: said }, { role: 'assistant', content: line });
        this.recordInChat(said, line);
        this.newFlow(); this.spoken = new Set();
        this.setState('Thinking');
        const job = this.startSpeaking();
        this.queue(job, line);
        if (job) { job.close(); await job.done; }
        if (!signal.aborted) this.settle();
      });
    }

    // ------------------------------------------------------------------ confirming a change (tap, or a spoken yes / no)
    /** "Ask before changes" off (the user was warned first): changes go ahead without the Confirm card. */
    setAutoApprove(on) { this.autoApprove = !!on; setPref(PREFS.noConfirm, on ? '1' : '0'); this.host.onChange(); }

    /** A plan for a job in several parts: on screen and said aloud; Start / Cancel (or a spoken yes / no). */
    askToStart(steps) {
      const said = steps.slice(0, 5).map((s, i) => (i === 0 ? 'first, ' : i === steps.length - 1 ? 'and finally, ' : 'then, ') + String(s.what).trim().replace(/\.$/, ''));
      const told = 'Here is my plan, in ' + steps.length + ' steps: ' + said.join('; ') + (steps.length > 5 ? '; and ' + (steps.length - 5) + ' more on your screen. ' : '. ');
      this.set({ plan: { steps: steps.map(s => Object.assign({}, s)), awaiting: !this.autoApprove } });
      const job = this.speechJob;
      const say = line => { if (job && !job.closed && !job.stopped && !this.muted) R().SpeechText.sentences(line).forEach(x => this.queueStatus(job, x)); };
      if (this.autoApprove) { say(told + "I'm starting now."); return Promise.resolve(true); }
      return this.askToConfirm('Start this plan?', told + 'Shall I start?', true).then(yes => {
        this.set({ plan: yes ? Object.assign({}, this.view.plan, { awaiting: false }) : null });
        return yes;
      });
    }

    askToConfirm(text, spoken, isPlan, tapOnly) {
      // (confirmations turned off: it goes ahead, as if the user had tapped Confirm)
      if (this.autoApprove && !isPlan) return Promise.resolve(true);
      return new Promise(resolve => {
        this.confirmResolve = resolve;
        // tapOnly: a change that cannot be undone; a spoken yes does not count for it (hearConfirm)
        this.set({ confirm: { text, plan: !!isPlan, tapOnly: !!tapOnly } });
        this.setState('NeedsConfirmation');
        // (said within this turn's own speech, so nothing of the answer is cut off)
        const job = this.speechJob;
        if (job && !job.closed && !job.stopped && !this.muted) {
          R().SpeechText.sentences(spoken || (text.replace(/\?$/, '') + '? Just tell me, or tap Confirm.')).forEach(x => this.queueStatus(job, x));
          // (the question's last sentence: once it is answered, whatever of it is still to be said is skipped)
          this.confirmSpeech = { job, through: this.flow.length - 1 };
        }
        this.syncEars();
        clearTimeout(this.confirmTimer);
        this.confirmTimer = setTimeout(() => this.answerConfirm(false), 60000);
      });
    }
    answerConfirm(yes) {
      clearTimeout(this.confirmTimer);
      // answered (a tap, or a yes / no) while she is still asking: she stops asking at once
      const cs = this.confirmSpeech; this.confirmSpeech = null;
      if (cs && cs.job.skipThrough) cs.job.skipThrough(cs.through);
      const r = this.confirmResolve; this.confirmResolve = null;
      this.set({ confirm: null });
      this.setState(yes ? 'Working' : 'Thinking');
      this.syncEars();
      if (r) r(!!yes);
    }
    hearConfirm(text) {
      const t = String(text || '').trim().toLowerCase();
      // (her own question never contains "yes" or "no", so her voice coming back cannot answer it; a sentence that is
      // neither, heard while or just after she spoke, is her voice and is left alone)
      const recent = Date.now() - this.lastSoundAt < ECHO_WINDOW_MS;
      if (/^(no|nope|cancel|don'?t|stop|abort|not now|never ?mind|leave it|forget it|hold on|wait)\b/.test(t)) this.answerConfirm(false);
      else if (/^(please )?(yes|yeah|yep|yup|sure|ok(ay)?|alright|all right|go ahead|do it|confirm|please do|yes please|proceed|go on|continue|carry on)\b/.test(t)) {
        if (this.view.confirm && this.view.confirm.tapOnly) this.set({ note: 'This one needs a tap: Confirm or Cancel.' });
        else this.answerConfirm(true);
      }
      else if (!recent) this.set({ note: "I didn't catch that. Tap Confirm or Cancel, or say yes or no." });
    }

    // ------------------------------------------------------------------ the app, for the tools
    toolHost() {
      return {
        route: () => this.host.route(),
        open: href => this.host.open(href),
        loggedIn: () => !!B().user(),
        showFound: list => this.set({ found: list }),
        clearScreen: () => this.host.clearScreen(),
        // (typing and pressing on the page: the agent screen steps back so the user sees it happen)
        minimize: () => { if (this.host.minimize) this.host.minimize(); },
        patientIds: () => this.patientIds || [],
        pageDetail: () => this.host.pageDetail(this.patientIds || []),
        // the presentation or report the user pasted here, as typed (identifiers included: read on this device only)
        pastedReport: () => this.pastedReport || ''
      };
    }

    /** One exchange into the Lixa chat (when the chat is loaded), saved with the chat's own functions. */
    recordInChat(said, answer) {
      const core = window.LixaCore;
      if (!core || !said) return;
      try {
        const first = !core.getMessages().some(m => m.role === 'user');
        core.pushMessage({ role: 'user', content: said, displayContent: said, timestamp: Date.now() });
        core.pushMessage({ role: 'assistant', content: answer, timestamp: Date.now() });
        core.render();
        if (core.getCurrentUser()) { if (first) core.refineTitleAndSave(said, answer); else core.save(); }
      } catch (e) { /* the chat is not ready: the exchange stays in the agent's own history */ }
    }

    /** A tap on an item in the found list: opened at once (no AI needed). */
    openFound(ref) { const r = B().openFound(this.found, ref, this.toolHost()); if (!r.ok) this.set({ note: r.text }); }

    endTalkMode() {
      const was = this.view.talkMode;
      this.voice.role = null; this.endingTalk = false; this.set({ talkMode: null, talkScore: null, body: 'normal' });
      // Live: she is told the lesson, quiz or role-play is over (she wraps up in a few words)
      if (was && this.live && this.live.on) this.live.modeEnded(was.kind);
    }

    // ------------------------------------------------------------------ her feelings and a patient's body (see LixaAgentRules.Moods / PatientBodies)
    /** Her face follows a sentence she is saying (the feeling stays a few seconds, then her normal face returns). */
    showMood(sentence) {
      const m = R().Moods.of(sentence);
      if (!m) return;
      this.view.emotion = m;
      clearTimeout(this.moodTimer);
      this.moodTimer = setTimeout(() => { this.view.emotion = 'neutral'; }, R().Moods.HOLD_MS);
    }
    /** Patient mode: the patient's body from the case (what the user asked for, then how the patient describes it). */
    learnPatientBody(text) {
      const mode = this.view.talkMode;
      if (!mode || mode.kind !== 'PATIENT' || this.view.body !== 'normal') return;
      const b = R().PatientBodies.of(text);
      if (b) this.view.body = b;
    }

    // ------------------------------------------------------------------ Live mode (agent-live.js) uses these
    /** Live starts: Standard stops listening and speaking. */
    enterLive() {
      this.handsFree = false;
      this.stop();
      this.stopRecog();
      this.set({ heard: '', moreWaiting: false });     // (a lesson, quiz or role-play under way carries on in Live)
      this.setState('Idle');
      this.loadPatientIds();
    }
    /** Live has ended: Standard again, listening hands-free when [listen]. */
    leaveLive(listen) {
      this.set({ mouth: 0, shape: 0.5, status: null });
      if (listen && SR && !this.micDenied && !this.released) this.listen(); else this.setState('Idle');
    }
    /**
     * Live wants to change something: the same Confirm / Cancel card, without holding Live up (she carries on talking).
     * Answered by a tap, or a spoken yes or no that Live heard (answerLive); no answer in 60 seconds is a no.
     */
    liveAsk(text, tapOnly) {
      if (this.confirmResolve) this.answerConfirm(false);
      return new Promise(resolve => {
        this.confirmResolve = resolve;
        // (in the background, the card floats over the page and any box open on it: agent-ui.js)
        this.set({ confirm: { text, tapOnly: !!tapOnly } });
        clearTimeout(this.confirmTimer);
        this.confirmTimer = setTimeout(() => { this.set({ note: 'No answer, so I left it. Nothing was changed.' }); this.answerConfirm(false); }, 60000);
      });
    }
    /** Live heard the user say yes or no while a Confirm card is up. */
    answerLive(yes) {
      if (!this.confirmResolve) return;
      // (a change that cannot be undone needs a tap: a spoken yes does not count for it)
      if (yes && this.view.confirm && this.view.confirm.tapOnly) { this.set({ note: 'This one needs a tap: Confirm or Cancel.' }); return; }
      this.answerConfirm(!!yes);
    }

    /** One exchange from Live: into this conversation (so Standard carries on from it) and into the Lixa chat. */
    liveExchange(said, answer) {
      const D = window.RehablixDeidentify;
      this.history.push({ role: 'user', content: D ? D.scrubText(said, this.patientIds || []) : said }, { role: 'assistant', content: answer });
      if (this.history.length > 60) this.history.splice(0, this.history.length - 60);
      this.set({ reply: answer });
      this.recordInChat(said, answer);
    }
  }

  AgentSession.canListen = !!SR;
  window.LixaAgentSession = AgentSession;
})();
