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
  const PREFS = { short: 'rehab-agent-short', muted: 'rehab-agent-muted', accent: 'rehab-agent-accent', bargeIn: 'rehab-agent-bargein' };
  const STOCK_LINES = ['On it!', 'Let me check.', 'One moment.', 'Shall I go on?', 'Done, the screen is clear.'].concat(['Still working on it.', 'Nearly there, just a moment.']);
  const pref = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  class HandOff extends Error {}

  class AgentSession {
    constructor(host) {
      this.host = host;                      // {route(), open(href), minimize(), close(), pageTitle(), pageDetail(), onChange()}
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
      this.handsFree = false;
      this.history = [];
      this.turnBusy = false;
      this.flow = []; this.statusIdx = new Set(); this.playingIndex = -1; this.spoken = new Set();
      this.remainder = []; this.interruptNote = null; this.turnRequest = ''; this.turnLogged = false;
      this.lastSoundAt = 0; this.patientIds = null; this.released = false;
      this.found = { found: {}, n: 0, lines: [] };      // saved items found in this conversation (refs r1, r2, …)
      this.voice = new window.LixaAgentVoice({
        prepare: t => R().speakable(t, this.patientIds || []),
        onWaiting: w => this.set({ waiting: w }),
        onProblem: msg => this.set({ note: msg })
      });
      this.voice.accent = this.accent;
      this.recog = null; this.ears = 'off'; this.said = ''; this.holdTimer = null;
      B().loadMap().then(m => { this.map = m; });
      // Live mode (agent-live.js): a live voice conversation next to this one, with the same tools and chat
      this.live = window.LixaAgentLive ? new window.LixaAgentLive(this) : null;
    }

    set(patch) { Object.assign(this.view, patch); this.host.onChange(); }
    get state() { return this.view.state; }
    setState(s) { if (this.view.state !== s) { this.view.state = s; this.syncEars(); this.host.onChange(); } }

    // ------------------------------------------------------------------ settings
    setMuted(on) { this.muted = on; setPref(PREFS.muted, on ? '1' : '0'); if (on) this.voice.stop(); this.host.onChange(); }
    setShort(on) { this.shortAnswers = on; setPref(PREFS.short, on ? '1' : '0'); this.host.onChange(); }
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
      if (this.live) this.live.release();
      this.stop();
      this.handsFree = false;
      this.stopRecog();
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
      this.stop();
      this.micDenied = false;                 // (a tap on the mic tries the microphone again)
      this.handsFree = true;
      this.set({ note: null });
      this.setState('Listening');
      this.syncEars();
    }
    /** The mic button while listening: stop listening (she stays). */
    stopListening() { this.handsFree = false; this.said = ''; clearTimeout(this.holdTimer); this.set({ heard: '' }); if (this.state === 'Listening') this.setState('Idle'); this.syncEars(); }

    /** What the recogniser should be doing now. */
    wantedEars() {
      if (this.released || !SR || this.micDenied) return 'off';
      if (this.view.confirm) return 'confirm';
      const s = this.state;
      if (s === 'Listening' || s === 'Idle') return this.handsFree && !this.turnBusy ? 'listen' : 'off';
      if (s === 'Speaking') return this.bargeIn && !this.muted ? 'interrupt' : 'off';
      if ((s === 'Thinking' || s === 'Working') && this.turnBusy) return this.bargeIn && this.handsFree ? 'add' : 'off';
      return 'off';
    }
    syncEars() {
      const want = this.wantedEars();
      if (want !== this.ears) { this.ears = want; this.said = ''; clearTimeout(this.holdTimer); }
      if (want === 'off') this.stopRecog(); else this.startRecog();
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
      r.onresult = e => this.onResult(e);
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
        if (this.wantedEars() !== 'off') setTimeout(() => { if (!this.recog && this.wantedEars() !== 'off') this.startRecog(); }, 250);
      };
      this.recog = r;
      try { r.start(); } catch (e) { this.recog = null; }
    }
    stopRecog() { const r = this.recog; this.recog = null; if (r) { try { r.abort(); } catch (e) { /* ignore */ } } }

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

    async answer(said, cutOff, again, signal) {
      signal = signal || (this.job && this.job.signal);
      this.currentSaid = said;
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
      const direct = !!talk || !Rr.Talk.needsApp(said);
      const reaction = this.muted || direct || again ? null : Rr.Reactions.pick(said);
      const job = this.startSpeaking();
      this.turnRequest = request; this.turnLogged = false;
      const keepShort = this.shortAnswers && !talk;
      const limit = keepShort ? SHORT_SENTENCES : Infinity;
      let streamCall = -1, streamedLength = 0, splitter = new Rr.SentenceSplitter(), queued = 0, saidForTool = false;
      const pushText = (shown) => {
        if (shown.length <= streamedLength) return;
        const delta = shown.slice(streamedLength); streamedLength = shown.length;
        splitter.push(delta).forEach(s => { if (queued < limit) { this.queue(job, s); queued++; } });
        if (this.view.status) this.set({ status: null });
      };
      if (reaction) this.queueStatus(job, reaction);

      let outcome = null;
      if (direct) {
        // talk: a short spoken-style prompt, the reply streamed straight to her voice (null: it needs the app after all)
        const page = (this.map && this.map.entry(this.host.route()) || {}).title || 'Lixa';
        const messages = [{ role: 'system', content: Rr.Talk.systemPrompt(talk, page, ending) }].concat(this.history.slice(talk ? -24 : -10), [{ role: 'user', content: request }]);
        const filter = new Rr.TalkFilter();
        try {
          const full = await Br.stream(messages, { maxTokens: TALK_MAX_TOKENS, temperature: talk ? 0.6 : 0.5 }, f => {
            const shown = filter.visible(f);
            if (filter.handOff) throw new HandOff();
            if (talk && talk.kind === 'PATIENT' && !ending && filter.voice && !this.voice.role) this.voice.role = filter.voice;
            pushText(shown);
          }, signal);
          if (filter.score) this.set({ talkScore: filter.score });
          const text = filter.visible(full).trim();
          outcome = { reply: text || 'Sorry, I lost my train of thought there. Could you say that again?' };
        } catch (e) {
          if (!(e instanceof HandOff)) throw e;
          streamedLength = 0; splitter = new Rr.SentenceSplitter();
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
          confirm: text => this.askToConfirm(text)
        }, signal, this.found);
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
    askToConfirm(text) {
      return new Promise(resolve => {
        this.confirmResolve = resolve;
        this.set({ confirm: { text } });
        this.setState('NeedsConfirmation');
        // (said within this turn's own speech, so nothing of the answer is cut off)
        const job = this.speechJob;
        if (job && !job.closed && !job.stopped) this.queueStatus(job, text.replace(/\?$/, '') + '? Just tell me, or tap Confirm.');
        this.syncEars();
        clearTimeout(this.confirmTimer);
        this.confirmTimer = setTimeout(() => this.answerConfirm(false), 60000);
      });
    }
    answerConfirm(yes) {
      clearTimeout(this.confirmTimer);
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
      if (/^(yes|yeah|yep|sure|ok(ay)?|go ahead|do it|confirm|please do|yes please)\b/.test(t)) this.answerConfirm(true);
      else if (/^(no|nope|cancel|don'?t|stop|not now|never mind)\b/.test(t)) this.answerConfirm(false);
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
        patientIds: () => this.patientIds || [],
        pageDetail: () => this.host.pageDetail(this.patientIds || [])
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
