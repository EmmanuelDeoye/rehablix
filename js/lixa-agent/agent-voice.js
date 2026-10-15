// js/lixa-agent/agent-voice.js — Lixa's voice on the web: Google Cloud
// Text-to-Speech, the same voices as the Android app (Chirp 3 HD "Aoede" per
// accent, Neural2 as backup; "Charon" for a male patient she plays), with the key
// read from the database next to the other AI keys (tokens/voice/api_key).
//
// The browser's own robotic voice is NEVER used (the user's decision): a sentence
// that cannot be made is tried again with growing pauses while the screen says she
// is waiting for a connection; after 2 minutes the rest of that answer is left
// unspoken (it is in the Lixa chat). Sentences arrive compressed (MP3, small enough
// for a slow connection), up to three are fetched ahead while one plays, and each
// is played through Web Audio so pausing, ducking and the mouth (loudness and lip
// shape, measured from the sound) all work.
//
// PRIVACY: every sentence goes through `prepare` first (the session takes patient
// names and identifiers out), so none of them reaches the cloud voice.
(function () {
  'use strict';
  const VOICES = {
    us: ['en-US-Chirp3-HD-Aoede', 'en-US-Neural2-F'], gb: ['en-GB-Chirp3-HD-Aoede', 'en-GB-Neural2-A'],
    au: ['en-AU-Chirp3-HD-Aoede', 'en-AU-Neural2-A'], in: ['en-IN-Chirp3-HD-Aoede', 'en-IN-Neural2-A']
  };
  const MALE_VOICES = {
    us: ['en-US-Chirp3-HD-Charon', 'en-US-Neural2-D'], gb: ['en-GB-Chirp3-HD-Charon', 'en-GB-Neural2-B'],
    au: ['en-AU-Chirp3-HD-Charon', 'en-AU-Neural2-B'], in: ['en-IN-Chirp3-HD-Charon', 'en-IN-Neural2-B']
  };
  const KEEP_CHARS = 48;
  const ATTEMPT_MS = 8000, MAX_ATTEMPT_MS = 14000, FIRST_RETRY_MS = 1000, MAX_RETRY_MS = 8000, MAX_WAIT_MS = 120000;
  const AHEAD = 3;
  const WINDOW_MS = 40;
  const NOTES = {
    WAITING: 'Waiting for a connection to speak…',
    GAVE_UP: "I couldn't speak: the connection didn't come back. My answer is in your Lixa chat.",
    NO_KEY: "Lixa's voice isn't set up yet (no voice key), so she can't speak. Her answers are in your Lixa chat.",
    KEY_REFUSED: "Lixa's voice key was refused, so she can't speak. Her answers are in your Lixa chat."
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let keyValue = null, keyCheckedAt = 0;
  async function voiceKey() {
    if (keyValue) return keyValue;
    if (keyCheckedAt && Date.now() - keyCheckedAt < 180000) return null;
    keyCheckedAt = Date.now();
    try {
      const snap = await Promise.race([firebase.database().ref('tokens/voice').once('value'), sleep(4000).then(() => null)]);
      const v = snap && snap.val();
      keyValue = (typeof v === 'string' ? v : v && v.api_key) || null;
      if (keyValue) keyValue = String(keyValue).trim() || null;
    } catch (e) { keyValue = null; }
    return keyValue;
  }

  /** Loudness per 40 ms (0..1, scaled to the loudest window) and lip shape per 40 ms (0 rounded .. 1 spread). */
  function analyse(buffer) {
    const data = buffer.getChannelData(0), rate = buffer.sampleRate;
    const frames = Math.max(2, Math.floor(rate * WINDOW_MS / 1000));
    const n = Math.floor(data.length / frames);
    const level = new Float32Array(n), bright = new Float32Array(n);
    let peak = 1e-6;
    for (let w = 0; w < n; w++) {
      let e = 0, d = 0, prev = 0;
      for (let i = 0; i < frames; i++) {
        const v = data[w * frames + i];
        e += v * v; if (i > 0) { const dv = v - prev; d += dv * dv; } prev = v;
      }
      level[w] = Math.sqrt(e / frames);
      if (level[w] > peak) peak = level[w];
      bright[w] = e > 0 ? d / e : 0;
    }
    const voiced = [];
    for (let w = 0; w < n; w++) if (level[w] > peak * 0.2) voiced.push(bright[w]);
    voiced.sort((a, b) => a - b);
    const lo = voiced.length >= 3 ? voiced[Math.floor(voiced.length / 10)] : 0, hi = voiced.length >= 3 ? voiced[Math.floor(voiced.length * 9 / 10)] : 0;
    const shapes = new Float32Array(n);
    for (let w = 0; w < n; w++) {
      shapes[w] = hi - lo > 1e-4 && level[w] > peak * 0.2 ? Math.min(1, Math.max(0, (bright[w] - lo) / (hi - lo))) : 0.5;
      level[w] = Math.pow(Math.min(1, level[w] / peak), 0.7);
    }
    return { level, shapes };
  }

  class CloudVoice {
    constructor(opts) {
      this.prepare = opts.prepare || (t => t);
      this.onWaiting = opts.onWaiting || (() => {});
      this.onProblem = opts.onProblem || (() => {});
      this.accent = 'us';
      this.role = null;                  // {male, rate}: a patient she plays
      this.chirpRefused = false;
      this.cache = new Map();            // short stock phrases, ready at once next time
      this.ctx = null; this.gain = null;
      this.paused = false;
      this.job = null;
      this.inFlight = 0; this.waiters = [];
    }

    /** Called from a tap/click (browsers only allow sound after one). */
    unlock() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.gain = this.ctx.createGain();
        this.gain.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended' && !this.paused) this.ctx.resume().catch(() => {});
    }

    voiceName() {
      const set = this.role && this.role.male ? MALE_VOICES : VOICES;
      const pair = set[this.accent] || set.us;
      return this.chirpRefused ? pair[1] : pair[0];
    }
    rateFor(voice) { return this.role ? Math.min(1.2, Math.max(0.7, this.role.rate || 1)) : (voice.indexOf('Chirp3') >= 0 ? 1.0 : 1.04); }

    async request(text, voice) {
      const key = await voiceKey();
      if (!key) return { noKey: true };
      const audioConfig = { audioEncoding: 'MP3', sampleRateHertz: 24000, speakingRate: this.rateFor(voice) };
      if (voice.indexOf('Chirp3') < 0) { audioConfig.pitch = 0; audioConfig.effectsProfileId = ['handset-class-device']; }
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), Math.min(MAX_ATTEMPT_MS, ATTEMPT_MS + text.length * 40));
      try {
        // (the key goes in a header, never in the address)
        const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
          method: 'POST', signal: ctl.signal,
          headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
          body: JSON.stringify({ input: { text }, voice: { languageCode: voice.split('-').slice(0, 2).join('-'), name: voice }, audioConfig })
        });
        if (!res.ok) return { status: res.status };
        const data = await res.json();
        if (!data || !data.audioContent) return { status: -2 };
        const bin = atob(data.audioContent);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return { bytes };
      } catch (e) {
        return { status: e && e.name === 'AbortError' ? -1 : 0 };
      } finally { clearTimeout(timer); }
    }

    /** One try: an AudioBuffer, {noKey}, or {status} (0 offline, -1 too slow, else the HTTP status). */
    async once(text) {
      let voice = this.voiceName();
      let r = await this.request(text, voice);
      if (r.status === 400 || r.status === 404) {
        if (this.role) { this.role = null; voice = this.voiceName(); r = await this.request(text, voice); }
      }
      if ((r.status === 400 || r.status === 403 || r.status === 404) && voice.indexOf('Chirp3') >= 0) {
        this.chirpRefused = true; voice = this.voiceName(); r = await this.request(text, voice);
      }
      if (!r.bytes) return r;
      try {
        this.unlock();
        const buffer = await this.ctx.decodeAudioData(r.bytes.buffer.slice(0));
        return { buffer };
      } catch (e) { return { status: -3 }; }
    }

    async synth(raw, job) {
      const text = String(this.prepare(raw) || '').trim();
      if (!text || job.gaveUp || job.stopped) return null;
      const keep = text.length <= KEEP_CHARS && !this.role;
      const ck = this.voiceName() + '|' + text;
      if (keep && this.cache.has(ck)) return this.cache.get(ck);
      const started = Date.now();
      let pause = FIRST_RETRY_MS, waiting = false;
      for (;;) {
        if (job.stopped) { if (waiting) this.onWaiting(null); return null; }
        const r = await this.once(text);
        if (r.buffer) {
          if (waiting) this.onWaiting(null);
          const clip = Object.assign({ buffer: r.buffer, text }, analyse(r.buffer));
          if (keep) this.cache.set(ck, clip);
          return clip;
        }
        if (r.noKey) { if (waiting) this.onWaiting(null); this.onProblem(NOTES.NO_KEY); job.gaveUp = true; return null; }
        if (r.status === 401 || (r.status === 403 && this.chirpRefused)) { if (waiting) this.onWaiting(null); this.onProblem(NOTES.KEY_REFUSED); job.gaveUp = true; return null; }
        if (Date.now() - started > MAX_WAIT_MS) { job.gaveUp = true; this.onWaiting(null); this.onProblem(NOTES.GAVE_UP); return null; }
        if (!waiting) { waiting = true; this.onWaiting(NOTES.WAITING); }
        await sleep(pause);
        pause = Math.min(MAX_RETRY_MS, pause * 2);
      }
    }

    async limited(fn) {
      while (this.inFlight >= AHEAD) await new Promise(r => this.waiters.push(r));
      this.inFlight++;
      try { return await fn(); } finally { this.inFlight--; const w = this.waiters.shift(); if (w) w(); }
    }

    /** Makes the stock phrases ready ahead of time (one quiet try each). */
    async warmUp(phrases) {
      for (const p of phrases) {
        const text = String(this.prepare(p) || '').trim();
        const ck = this.voiceName() + '|' + text;
        if (!text || this.cache.has(ck)) continue;
        const r = await this.once(text);
        if (!r.buffer) return;
        this.cache.set(ck, Object.assign({ buffer: r.buffer, text }, analyse(r.buffer)));
      }
    }

    /**
     * Starts speaking. Returns a job: add(sentence) as sentences become ready, close() when there are no more;
     * job.done resolves when the last one has been said (or it was stopped). onEvent({amplitude, shape, sentence, speaking}).
     */
    speak(onEvent) {
      this.stop();
      this.unlock();
      this.paused = false;
      if (this.gain) this.gain.gain.value = 1;
      const job = { items: [], closed: false, stopped: false, gaveUp: false, index: 0, wake: null };
      const wake = () => { const w = job.wake; job.wake = null; if (w) w(); };
      job.add = sentence => { if (job.closed || job.stopped) return; job.items.push(this.limited(() => this.synth(sentence, job))); wake(); };
      job.close = () => { job.closed = true; wake(); };
      job.done = (async () => {
        while (!job.stopped) {
          if (job.index < job.items.length) {
            const clip = await job.items[job.index];
            if (job.stopped) break;
            if (clip) await this.play(clip, job.index, onEvent, job);
            job.index++;
          } else if (job.closed) break;
          else await new Promise(r => { job.wake = r; });
        }
        onEvent({ amplitude: 0, shape: 0.5, sentence: job.index, speaking: false });
      })();
      this.job = job;
      return job;
    }

    play(clip, index, onEvent, job) {
      return new Promise(resolve => {
        if (!this.ctx) { resolve(); return; }
        const src = this.ctx.createBufferSource();
        src.buffer = clip.buffer;
        src.connect(this.gain);
        let finished = false;
        const finish = () => { if (finished) return; finished = true; clearInterval(timer); try { src.disconnect(); } catch (e) { /* ignore */ } job.current = null; resolve(); };
        src.onended = finish;
        const t0 = this.ctx.currentTime;
        job.current = { stop: () => { try { src.stop(); } catch (e) { /* ignore */ } finish(); } };
        const timer = setInterval(() => {
          if (this.paused) { onEvent({ amplitude: 0, shape: 0.5, sentence: index, speaking: false }); return; }
          const w = Math.floor((this.ctx.currentTime - t0) * 1000 / WINDOW_MS);
          onEvent({ amplitude: clip.level[w] || 0, shape: clip.shapes[w] == null ? 0.5 : clip.shapes[w], sentence: index, speaking: true });
        }, 16);
        try { src.start(); } catch (e) { finish(); }
      });
    }

    pause() { this.paused = true; if (this.ctx) this.ctx.suspend().catch(() => {}); }
    resume() { this.paused = false; if (this.ctx) this.ctx.resume().catch(() => {}); }
    skipSentence() { const j = this.job; if (j && j.current) j.current.stop(); }
    stop() {
      const j = this.job; this.job = null;
      if (j) { j.stopped = true; if (j.current) j.current.stop(); if (j.wake) { const w = j.wake; j.wake = null; w(); } }
      if (this.paused) this.resume();
    }
    duck(volume) { if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(Math.min(1, Math.max(0, volume)), this.ctx.currentTime, 0.03); }
  }

  CloudVoice.NOTES = NOTES;
  CloudVoice.ACCENTS = ['us', 'gb', 'au', 'in'];
  window.LixaAgentVoice = CloudVoice;
})();
