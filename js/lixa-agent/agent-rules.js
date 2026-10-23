// js/lixa-agent/agent-rules.js — Lixa Agent's speech and routing rules, the same
// rules the Android app uses (rehablix-android …/lixa/agent/AgentSpeechRules.kt,
// AgentTalk.kt, LixaVoice.kt SpeechText/SentenceSplitter). Pure functions, no DOM:
// what she says first, when the user is interrupting her (and when it is only her
// own voice coming back, or "okay"), goodbyes, "open X", "clear the screen",
// talk vs work in the app, tutor / game / therapist / patient modes, and turning a
// written reply into sentences that sound right read aloud.
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ her name
  // Speech recognition writes "Lixa" as a name it knows ("Alexa", "Lisa"). Only
  // where she is plainly being called (start or end of what was said) is it fixed.
  const HEARD_AS = 'alexa|alexia|alexis|lisa|liza|leeza|lexa|lexi|lexie|lyxa|lixer|lixar|licks a|lick sa|elixir|alyssa|alissa|eliza';
  const NAME_AT_START = new RegExp('^(\\s*(?:hey|hi|hello|ok|okay|hey there|thanks|thank you|please|so)[, ]+)?(' + HEARD_AS + ')\\b([,.!? ]*)(\\S*)', 'i');
  const NAME_AT_END = new RegExp('([, ]+)(' + HEARD_AS + ')([.!? ]*)$', 'i');
  const SPOKEN_TO_HER = new Set(('open go take show find search look create make generate write draft delete remove export switch change set undo start turn stop wait pause continue ' +
    'summarise summarize read list check what what\'s where where\'s when which how why can could would do are tell give help please i i\'m i\'d i\'ve we let\'s lets thanks thank ' +
    'hello hi hey good sorry yes no okay ok').split(' '));
  const CLOSERS = new Set('thanks you please okay ok bye goodbye hello hi hey morning afternoon evening night now it that there again done right sorry'.split(' '));

  // "tutor" is often written as "twitter" ("be my twitter", "twitter mode"). The app has nothing to do with
  // Twitter, so the word is read as "tutor" unless it is plainly about the social site ("on Twitter", "Twitter account").
  const TUTOR_HEARD = /(^|[^\w@#])(twitter|tweeter|twita|tuta)(s?)\b(?!\s*(?:account|post|posts|page|handle|feed|thread|app|\.com|link|profile|followers))/gi;
  function fixTutor(text) {
    return String(text || '').replace(TUTOR_HEARD, (all, pre, word, s, at, whole) => {
      if (/\b(?:on|from|via|follow)\s+(?:the\s+)?$/i.test(whole.slice(0, at + pre.length))) return all;
      return pre + (word[0] === word[0].toUpperCase() ? 'Tutor' : 'tutor') + s;
    });
  }

  function fixName(text) {
    let out = String(text || '');
    const m = NAME_AT_START.exec(out);
    if (m) {
      const next = (m[4] || '').toLowerCase().replace(/[,.!?]+$/, '');
      if (!next || SPOKEN_TO_HER.has(next)) {
        const at = (m[1] || '').length;
        out = out.slice(0, at) + 'Lixa' + out.slice(at + m[2].length);
      }
    }
    const e = NAME_AT_END.exec(out);
    if (e && e.index > 0) {
      const before = out.slice(0, e.index).trimEnd().split(' ').pop().toLowerCase().replace(/^[,.]+|[,.]+$/g, '');
      if (CLOSERS.has(before)) { const at = e.index + e[1].length; out = out.slice(0, at) + 'Lixa' + out.slice(at + e[2].length); }
    }
    return fixTutor(out);
  }

  // ------------------------------------------------------------------ "On it!"
  const SMALL_TALK = /^(lixa[, ]*)?(hi|hello|hey|yo|good (morning|afternoon|evening|night|day)|how are you|how's it going|how is it going|how do you do|what's up|whats up|thanks|thank you|bye|goodbye|see you|ok|okay|alright|all right|yes|yeah|yep|no|nope|nice|great|cool|wow|lixa|who are you|what are you|what can you do|what's your name|what is your name|are you there|can you hear me|never mind|nevermind|sorry)\b.*/i;
  const LOOKING = /\b(find|search|look|show|list|read|summari[sz]e|check|what did i|where is|where are|where do|which)\b/i;
  const DOING = /\b(open|go to|take me|create|make|generate|write|draft|delete|remove|export|switch|change|set|undo|start|turn)\b/i;
  const OWN_LINES = new Set(['on it', 'let me check', 'one moment']);

  const Reactions = {
    /** Null = say nothing first. */
    pick(said) {
      const t = String(said || '').trim();
      const n = t.split(/\s+/).filter(Boolean).length;
      const doing = DOING.test(t), looking = LOOKING.test(t);
      if (!doing && !looking) {
        if (n <= 4) return null;
        if (n <= 9 && SMALL_TALK.test(t)) return null;
        return 'One moment.';
      }
      if (n <= 2) return null;
      return looking && !doing ? 'Let me check.' : 'On it!';
    },
    /** One of her own reaction lines heard back through the speaker: never something the user added. */
    isOwn(heard) { return OWN_LINES.has(words(heard).join(' ')); }
  };

  // ------------------------------------------------------------------ interruptions
  const KEYS = new Set(['stop', 'wait', 'pause', 'lixa', 'sorry', 'excuse', 'hold', 'enough', 'actually']);
  const ONLY_STOP = /^(lixa[, ]*)?(please )?(stop|wait|hold on|pause|enough|that's enough|okay stop|ok stop|quiet|be quiet|stop talking)( lixa)?( please)?[.! ]*$/i;
  const NOISE_WORDS = new Set(['um', 'uh', 'erm', 'er', 'hmm', 'hm', 'mm', 'mmm', 'mhm', 'ah', 'oh', 'eh', 'huh', 'ha', 'haha', 'ugh', 'aw']);
  const BACKCHANNEL = /^(?:(?:ok(?:ay)?|yes|yeah|yep|yup|right|alright|all right|sure|i see|got it|mm+|m+-?hm+|uh-?huh|hmm+|great|nice|cool|wow|interesting|true|exactly|correct|good|thanks?|thank you|go on|go ahead|continue|carry on|keep going|i'?m listening|lixa|please)[,.!? ]*)+$/i;

  function words(text) { return String(text || '').toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean); }

  const Interruptions = {
    words,
    /** Real words, not just a sound written down as "hmm" or "uh". */
    hasWords(heard) { return words(heard).some(w => w.length >= 2 && !NOISE_WORDS.has(w)); },
    /** "Okay", "mm-hmm", "go on": the listener following along. Never stops her. */
    isBackchannel(heard) { return BACKCHANNEL.test(String(heard || '').trim()); },
    /** "Stop", "wait", "hold on": silence, not a new answer. */
    isStop(heard) { return ONLY_STOP.test(String(heard || '').trim()); },
    /** What the user said, without any of her own words the microphone caught first. */
    withoutEcho(heard, spoken) {
      const toks = String(heard || '').trim().split(/\s+/);
      let i = 0;
      while (i < toks.length) { const w = words(toks[i]); if (w.length === 0 || w.every(x => spoken.has(x))) i++; else break; }
      return toks.slice(i).join(' ');
    },
    /** (Almost) all her own words coming back through the speaker: three quarters or more are words she has just said. */
    isEcho(heard, spoken) {
      const w = words(heard).filter(x => x.length >= 2);
      if (!w.length || !spoken.size) return false;
      if (w.some(x => KEYS.has(x) && !spoken.has(x))) return false;
      return w.filter(x => spoken.has(x)).length * 4 >= w.length * 3;
    },
    /** Just after she stopped: only a run of four or more of her words, in her order, is her echo. */
    isEchoRun(heard, said) {
      const w = words(heard);
      if (w.length < 4) return false;
      return (' ' + words(said).join(' ') + ' ').includes(' ' + w.join(' ') + ' ');
    }
  };

  // ------------------------------------------------------------------ goodbye, open a page, clear the screen
  const GOODBYE = new RegExp(
    "^(ok(ay)?|alright|all right|right|thanks?( you)?( so much| very much)?|thank you( so much| very much)?|great|cool|nice|perfect)?[,.! ]*(lixa[,.! ]*)?" +
    "(good ?bye|bye( bye| for now| now)?|see you( later| soon| tomorrow)?|talk (to you )?(later|soon|tomorrow)|later|catch you later|good ?night|have a (good|nice|great) (day|night|evening)|" +
    "i (have|need|got) to go( now)?|i('ve| have)? got(ta| to) go( now)?|gotta go|i'?m (leaving|going|off|done)( now)?( for (now|today))?|" +
    "you can go( now)?|you can leave( now)?|you can rest( now)?|you may go( now)?|that'?s all( for (now|today))?|that will be all|that'?ll be all|we'?re done( here)?( for (now|today))?|" +
    "(please )?(close|end|exit|stop) (agent mode|the agent|lixa agent|this conversation|the conversation)|end (the )?(conversation|chat))" +
    "([,.! ]*(lixa|thanks?|thank you|bye|goodbye|good ?bye|now|for now|then|for today))*[.!? ]*$", 'i');
  const FAREWELLS = ["Okay, bye for now! I'm here whenever you need me.", 'Alright, talk soon! Take care.', 'Bye! Just call me when you need me.'];
  const Farewell = {
    isGoodbye(said) { return GOODBYE.test(String(said || '').trim()); },
    line() { return FAREWELLS[Math.floor(Math.random() * FAREWELLS.length)]; }
  };

  const OPEN = /^(?:lixa[, ]*)?(?:please |can you |could you |kindly )?(?:open|go to|take me to|show me|launch|start|bring up|switch to)(?: up)? (?:the |my )?(.+?)(?: page| tool| screen| app| section)?(?: for me)?(?: please)?(?:[, ]+lixa)?[.!?]*$/i;
  const OpenPage = {
    /** "Open Smart EMR": the page named exactly (its title or id), or null. */
    target(said, map) {
      const m = OPEN.exec(String(said || '').trim());
      const name = m && m[1] ? m[1].trim() : '';
      if (name.length < 3) return null;
      const e = map.find(name);
      return e && e.open ? e : null;
    }
  };

  const CLEAR = /^(lixa[, ]*)?(please |can you |could you )?(clear|hide|dismiss|close|remove|take away|get rid of)( away| off)?( all)?( of)?( the| these| those| this| that| my)?( the)? (screen|files?|cards?|documents?|docs?|results?|list|lists|details|everything|it|them|stuff)( (on|from|off) (the |my )?screen)?( please)?( lixa)?[.!? ]*$/i;
  const ClearScreen = {
    /** Only phrases that clearly mean the screen ("remove the file" alone could mean deleting it). */
    isClear(said) {
      const t = String(said || '').trim();
      if (!CLEAR.test(t)) return false;
      const lower = t.toLowerCase();
      return !/\b(remove|get rid of|take away)\b/.test(lower) || /\bscreen\b/.test(lower);
    }
  };

  // ------------------------------------------------------------------ unfinished thoughts, asking again, status lines
  const TAIL_WORDS = new Set(('and but or so because cause if when while then that which who where whether the a an my your his her their our this these those some any ' +
    'to of for with in on at from about into by like than as um uh erm er hmm mm eh is are was were be could would should also plus i i\'m we let let\'s').split(' '));
  const Unfinished = {
    looks(text) {
      const t = String(text || '').trim();
      if (!t) return false;
      if (/(\.\.\.|…|,|-|—)$/.test(t)) return true;
      const last = t.replace(/[.!? ]+$/, '').split(' ').pop().toLowerCase().replace(/^[,"']+|[,"']+$/g, '');
      return TAIL_WORDS.has(last);
    }
  };
  const REPEATS = ["Sorry, I didn't quite catch that. Could you say it again?", 'Sorry, could you say that once more?', 'I missed that. Could you repeat it?'];
  function askAgainLine() { return REPEATS[Math.floor(Math.random() * REPEATS.length)]; }

  const StatusLines = {
    spoken(tool, title) {
      switch (tool) {
        case 'open_tool': return title ? 'Opening ' + title + '.' : null;
        case 'find_items': return 'Let me look through your saved work.';
        case 'web_search': return 'Let me check the web.';
        case 'create_document': return "I'm starting that for you in your Lixa chat.";
        default: return null;
      }
    },
    shown(tool, title) {
      switch (tool) {
        case 'open_tool': return 'Opening ' + (title || 'the page') + '…';
        case 'search_app_map': return 'Finding the right tool…';
        case 'get_current_screen': return 'Looking at this page…';
        case 'find_items': return 'Searching your saved work…';
        case 'web_search': return 'Searching the web…';
        case 'open_item': return 'Opening it…';
        case 'create_document': return 'Starting your document…';
        case 'set_theme': return 'Changing the theme…';
        case 'clear_screen': return 'Clearing the screen…';
        default: return 'Working on it…';
      }
    },
    STILL: ['Still working on it.', 'Nearly there, just a moment.', "This one is taking a little longer. I'm still on it."]
  };

  // ------------------------------------------------------------------ text for speaking
  const FENCE = /```[\s\S]*?```/g;
  const IMAGE = /!\[[^\]]*]\([^)]*\)/g;
  const LINK = /\[([^\]]+)]\([^)]*\)/g;
  const URL_RE = /(https?:\/\/|www\.)\S+/gi;
  const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
  const LONG_NUMBER = /(?<![\p{L}\d.,])(\+?\d[\d-]{5,}\d|(\+|0)\d{2,4}([ -]\d{3,4}){2,})(?![\p{L}\d])/gu;
  const CITATION = /\[\^?\d+(\s*[,–-]\s*\d+)*]|【[^】]*】/g;
  const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm;
  const LINE_MARK = /^\s*(#{1,6}\s+|>+\s?|[-*+•]\s+|\d+[.)]\s+)/gm;
  const KEEP = /[^\p{L}\p{N}\s.,;:!?'’"()%/+\-–—°]/gu;

  const SpeechText = {
    /** No markdown, symbols, URLs, emails, long numbers or citation markers. */
    clean(text) {
      let s = String(text || '').replace(FENCE, ' ').replace(IMAGE, ' ').replace(LINK, '$1').replace(URL_RE, ' ').replace(EMAIL, ' ');
      s = s.replace(LONG_NUMBER, m => ((m.match(/\d/g) || []).length >= 7 ? ' the number on your screen ' : m));
      s = s.replace(CITATION, '').replace(TABLE_RULE, ' ').replace(LINE_MARK, '');
      s = s.replace(/&/g, ' and ').replace(/\|/g, ', ').replace(/`/g, '').replace(KEEP, ' ');
      return s.replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').replace(/^[\s,;:.]+/, '').trim();
    },
    speakable(s) { return /[\p{L}\p{N}]/u.test(s || ''); },
    sentences(text) { const sp = new SentenceSplitter(); return sp.push(text).concat(sp.flush()); }
  };

  const ABBREVIATIONS = new Set(['dr', 'mr', 'mrs', 'ms', 'prof', 'e.g', 'i.e', 'vs', 'etc', 'approx', 'no', 'fig', 'st', 'eg', 'ie']);
  /** Cuts a reply into sentences while it is still arriving (each cleaned for speech). */
  class SentenceSplitter {
    constructor() { this.buf = ''; }
    push(delta) { this.buf += delta || ''; return this.drain(false); }
    flush() { return this.drain(true); }
    drain(all) {
      const out = [];
      for (;;) {
        const cut = this.nextCut(this.buf);
        if (cut < 0) break;
        const piece = this.buf.slice(0, cut); this.buf = this.buf.slice(cut);
        const c = SpeechText.clean(piece); if (SpeechText.speakable(c)) out.push(c);
      }
      if (all) { const c = SpeechText.clean(this.buf); if (SpeechText.speakable(c)) out.push(c); this.buf = ''; }
      return out;
    }
    nextCut(s) {
      let i = 0, lineStart = 0;
      while (i < s.length) {
        const ch = s[i];
        if (ch === '`' && s.startsWith('```', i)) { const close = s.indexOf('```', i + 3); if (close < 0) return -1; i = close + 3; continue; }
        if (ch === '\n') { if (s.slice(0, i).trim()) return i + 1; lineStart = i + 1; }
        else if ((ch === '.' || ch === '!' || ch === '?') && i + 1 < s.length) {
          let j = i + 1;
          while (j < s.length && '"\')]*_”’'.includes(s[j])) j++;
          if (j < s.length && /\s/.test(s[j]) && !(ch === '.' && this.isAbbreviation(s, i, lineStart))) return j;
        }
        i++;
      }
      return -1;
    }
    isAbbreviation(s, dot, lineStart) {
      let start = dot;
      while (start > lineStart && !/\s/.test(s[start - 1])) start--;
      const word = s.slice(start, dot).toLowerCase().replace(/^[(*_"]+/, '');
      if (ABBREVIATIONS.has(word)) return true;
      return word.length > 0 && /^\d+$/.test(word) && !s.slice(lineStart, start).trim();
    }
  }

  /**
   * What she says goes to the cloud voice with every registered patient's name and identifiers, phone numbers,
   * emails and dates of birth taken out and replaced by plain words (the same rule as the Android app).
   */
  // Names she says wrongly (2026-10-23): what the user teaches ("Adeoye is pronounced ah-day-oh-yeh", "say Tolu as
  // toh-loo", or "it's pronounced …" right after she said a name) is used by her voice from then on. Written words are
  // never changed: only what goes to the voice. (Android: AgentSpeechRules.kt SayAs, the same)
  const SayAs = (function () {
    const WORD = "([A-Za-z][A-Za-z'’-]{1,30})", SOUND = "([A-Za-z][A-Za-z'’ -]{0,40}?)", TAIL = "\\s*(?:[.,!?]|$|\\bplease\\b|\\bokay\\b)";
    const EXPLICIT = [
      new RegExp("\\b" + WORD + " (?:is|'s) (?:pronounced|said) (?:as |like )?[\"“]?" + SOUND + "[\"”]?" + TAIL, 'i'),
      new RegExp("\\bpronounce " + WORD + " (?:as|like) [\"“]?" + SOUND + "[\"”]?" + TAIL, 'i'),
      new RegExp("\\bsay " + WORD + " (?:as|like) [\"“]?" + SOUND + "[\"”]?" + TAIL, 'i')
    ];
    const BARE = new RegExp("\\b(?:it'?s|it is|that'?s|that is|you say it|say it) (?:pronounced |said )?(?:as |like )[\"“]?" + SOUND + "[\"”]?" + TAIL + "|\\b(?:it'?s|it is|that'?s|that is) (?:pronounced|said) [\"“]?" + SOUND + "[\"”]?" + TAIL, 'i');
    const NOT_NAMES = ['it', 'that', 'this', 'name', 'word', 'lixa', 'rehablix', 'i', 'you', 'the', 'smart', 'emr', 'project', 'maker', 'deck', 'studio', 'okay', 'yes', 'no', 'sorry', 'hello', 'hi'];
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    function clean(w, s) {
      const word = String(w || '').trim().replace(/^['’]|['’]$/g, '');
      const sound = String(s || '').trim().replace(/[.,!?]+$/, '').trim();
      if (word.length < 2 || !sound || word.toLowerCase() === sound.toLowerCase() || NOT_NAMES.indexOf(word.toLowerCase()) >= 0) return null;
      return [word, sound];
    }
    function lastName(reply) {
      const t = String(reply || ''); let last = null; const re = /\b[A-Z][a-z'’]{2,}\b/g; let m;
      while ((m = re.exec(t))) {
        const before = t.slice(0, m.index).trimEnd();
        if (before && !/[.!?]$/.test(before) && NOT_NAMES.indexOf(m[0].toLowerCase()) < 0) last = m[0];
      }
      return last;
    }
    return {
      MAX: 60, lastName,
      /** [word, how to say it] taught in said; a bare "it's pronounced …" is about the last name in her lastReply. */
      learn(said, lastReply) {
        for (const r of EXPLICIT) { const m = r.exec(said || ''); if (m) return clean(m[1], m[2]); }
        const m = BARE.exec(said || ''); if (!m) return null;
        const sound = m[1] || m[2]; const name = lastName(lastReply);
        return sound && name ? clean(name, sound) : null;
      },
      apply(text, taught) { let out = String(text || ''); Object.keys(taught || {}).forEach(w => { out = out.replace(new RegExp('\\b' + esc(w) + '\\b', 'gi'), taught[w]); }); return out; },
      instructions(taught) {
        const k = Object.keys(taught || {});
        return k.length ? '\n\nPRONUNCIATION the user taught you (always say these names this way): ' + k.map(w => w + ' = "' + taught[w] + '"').join('; ') + '.' : '';
      }
    };
  })();

  function speakable(text, identifiers) {
    const D = root.RehablixDeidentify;
    let s = D ? D.scrubText(text, identifiers || []) : String(text || '');
    return s.replace(/\b(mr|mrs|ms|miss|mister|madam|dr|doctor|master)\.?\s+\[redacted]/gi, 'the patient')
      .replace(/\[redacted](\s+\[redacted])+/g, 'the patient')
      .replace(/\[redacted]/g, 'the patient')
      .replace(/\[phone]/g, 'the phone number on your screen')
      .replace(/\[email]/g, 'the email address on your screen')
      .replace(/\[date]/g, 'the date on your screen')
      .replace(/\bthe patient(\s+the patient)+\b/gi, 'the patient')
      .replace(/\bA\.I\.(?=\s|$)|\bAI\b/g, 'SI')        // she never says "AI": it is SI, Specialized Intelligence (Android: saySI)
      .replace(/\b([Aa])rtificial ([Ii])ntelligence\b/g, (m, a, i) => (a === 'A' ? 'S' : 's') + 'pecialized ' + i + 'ntelligence');
  }

  // ------------------------------------------------------------------ the mouth for each sound (Android: LixaVisemes.kt)
  /**
   * Which mouth shape goes with each moment of a sentence she says: the letters become the sounds a mouth makes (lips
   * shut for m/b/p, round for "o", pushed out for "oo", spread for "ee", wide for "a", teeth for s/t…), each with a rough
   * length, laid over the 40 ms windows where her voice really sounds. Codes index the avatar's VISEMES.
   */
  const Visemes = {
    REST: 0, MBP: 1, FV: 2, TEETH: 3, EE: 4, AA: 5, O: 6, OO: 7, SH: 8,
    VOICED: 0.12,
    sounds(text) {
      const t = String(text || '').toLowerCase(), out = [];
      const isL = ch => /[a-z]/.test(ch || '');
      let i = 0;
      while (i < t.length) {
        const c = t[i], n1 = t[i + 1] || ' ', two = c + n1;
        let code = -1, len = 0, step = 1;
        if (/\d/.test(c)) { code = 0; len = 2; }
        else if (['oo', 'ew', 'ue', 'wh'].indexOf(two) >= 0) { code = 7; len = 1.3; step = 2; }
        else if (['ou', 'ow', 'oa', 'aw', 'au', 'or'].indexOf(two) >= 0) { code = 6; len = 1.3; step = 2; }
        else if (['ee', 'ea', 'ie', 'ey', 'ay', 'ai'].indexOf(two) >= 0) { code = 4; len = 1.3; step = 2; }
        else if (two === 'sh' || two === 'ch') { code = 8; len = 0.9; step = 2; }
        else if (two === 'th') { code = 3; len = 0.8; step = 2; }
        else if (two === 'ph') { code = 2; len = 0.8; step = 2; }
        else if (two === 'ng' || two === 'ck') { code = 0; len = 0.7; step = 2; }
        else if (c === 'e' && !isL(n1) && i >= 3 && isL(t[i - 1]) && isL(t[i - 2]) && isL(t[i - 3])) { code = -1; }   // a silent final "e"
        else if (c === 'a') { code = 5; len = 1; }
        else if (c === 'e' || c === 'i' || c === 'y') { code = 4; len = 1; }
        else if (c === 'o') { code = 6; len = 1; }
        else if (c === 'u') { code = 0; len = 1; }
        else if (c === 'w') { code = 7; len = 0.7; }
        else if ('mbp'.indexOf(c) >= 0) { code = 1; len = 0.8; }
        else if (c === 'f' || c === 'v') { code = 2; len = 0.7; }
        else if (c === 'j' || c === 'r') { code = 8; len = 0.7; }
        else if ('sztdnlcx'.indexOf(c) >= 0) { code = 3; len = 0.7; }
        else if ('kghq'.indexOf(c) >= 0) { code = 0; len = 0.7; }
        if (code >= 0 && len > 0) out.push([code, len]);
        i += step;
      }
      return out;
    },
    /** One code per loudness window: the sound being said where her voice sounds, -1 where it does not. */
    track(text, levels) {
      if (!levels || !levels.length) return null;
      const s = Visemes.sounds(text);
      if (!s.length) return null;
      let voiced = 0;
      for (let w = 0; w < levels.length; w++) if (levels[w] > Visemes.VOICED) voiced++;
      if (!voiced) return null;
      const total = s.reduce((a, x) => a + x[1], 0);
      const out = new Int8Array(levels.length).fill(-1);
      let v = 0, at = 0, reach = s[0][1];
      for (let w = 0; w < levels.length; w++) {
        if (levels[w] <= Visemes.VOICED) continue;
        const pos = (v + 0.5) / voiced * total;
        while (at < s.length - 1 && pos > reach) { at++; reach += s[at][1]; }
        out[w] = s[at][0];
        v++;
      }
      return out;
    }
  };

  // ------------------------------------------------------------------ talk vs work in the app; talk modes
  // Only requests that are clearly work in the app go straight to the agent. Everything else goes the fast way, and
  // the AI itself hands off with HAND_OFF when it sees the request needs the app after all.
  const APP = new RegExp(
    "\\b(open(?!-)|opening|go to|goto|take me to|navigate|launch|bring up|show me (my|all my|the (patient|file|note|project|record|document|chat|page|screen|list)s?\\b)|list (my|all my)|" +
    "(find|search|look up|look for|look through|search for) (my|our|the (patient|file|note|project|record|document|chat)s?\\b)|search (in|through)|" +
    "fill (in|out|it|this)\\b|type (it|this|that|in|into|the|my)\\b|paste|press (the|it|generate|start|ok|next|save|continue)\\b|tap (the|on)\\b|click|(the|this|that) (form|box|field|button)\\b|write (it|this|that) (in|into)\\b|put (it|this|that) (in|into)\\b|(create|generate|draft) (a|an|the|my|some|me|it|this|that)\\b|make (a|an|the|my|some|me a|me an)\\b|write (a|an|me|the|my) (note|report|document|plan|format|summary|letter|deck|presentation|assignment|progress)|" +
    "toggle|turn (it |this |that |the \\w+ )?(on|off)\\b|(tick|untick|uncheck) (the|this|that|it)\\b|read (me |out |aloud )?(my|the (patient|file|note|record|document|project|chapter|page|screen|result)s?|this|that|it)\\b|scroll|" +
    "delete|remove (it|this|that|my|all|these|those)\\b|export|download|share (it|this|that|my)|send (it|this|that|my)|save (it|this|that|my)|upload|attach|undo|clear the|change the (theme|workspace)|set (the )?(theme|mode)|switch (to|the|my|workspace)|" +
    "dark mode|light mode|my (patients?|files?|projects?|notes?|documents?|history|chats?|decks?|recordings?|results?|reports?|sets?|workspace|account|plan|subscription)|" +
    "this (page|screen|section|chapter|tab|patient|project|file|document)|on (the |my )?screen|the (patient|project) (list|record)|chapter \\w+|section \\w+|" +
    "smart emr|project maker|deck studio|study buddy|exam simulator|audio transcription|assessment format|standardized tools|motion (and|&) gait|gait analy[sz]er|(app|voice|agent) settings)\\b", 'i');

  const TUTOR = /\b(tutor mode|tutor me|be my tutor|teach me|give me a (lesson|class|tutorial)|lesson (on|about)|lecture me|take me through|walk me through|explain .{3,120}\b(and|then) (quiz|ask|test|question) me)\b/i;
  // ("quiz" in any of its usual forms is game mode too: "quiz mode", "give me a quiz", "let's do a quiz on…")
  const GAME = /\b(game mode|quiz mode|quiz me|quiz time|test me|play (a |the )?(quiz|game)|clinical (quiz|questions|game|cases)|ask me (some |a few |\w+ )?(clinical |rehab |exam |hard |easy )?questions|let'?s play|let'?s (do|have|try) (a |the )?quiz|(give|set) me (a |some )?quiz(zes)?|(do|take|have|try|run|want|need) (a |the |some )?quiz|start (a |the )?(quiz|game)|(a |the )?quiz (on|about|for|with) )/i;
  // Asking for a file in other words ("I need a PowerPoint on…", "can you prepare an assessment format for…"): work in the
  // app (a document is made and saved), never just talk. ("The presentation of a stroke" is clinical talk.)
  const MAKE_FILE = /\b(i need|i want|i'?d like|can you|could you|would you|will you|please|help me|give me|get me|prepare|produce|put together|do me|let'?s (do|make|create))\b.{0,60}?\b(power ?points?|pptx?|slides?|slide ?decks?|decks?|presentations?(?! of)|assessment formats?|formats?|standardi[sz]ed (tools?|assessments?)|assignments?|essays?|study sets?|flash ?cards?|transcripts?|reports?|word (docs?|documents?|files?)|pdfs?|documents?|handouts?)\b/i;
  // What she says when she claims to have done (or to be doing) something in the app. With no tool run it is not true.
  const CLAIMS = /\b(i'?ve (just )?(created|made|generated|prepared|saved|built|designed)|i have (just )?(created|made|generated|prepared|saved|built|designed)|i'?m (now )?(creating|making|generating|preparing|building|designing|saving)|i'?ll (create|make|generate|prepare|build|design)|(is|are) (now )?being (created|generated|prepared|made|built)|it'?s ready|(is|are) ready (for you|now)|here'?s your (new )?(document|presentation|power ?point|deck|slides|format|assignment|study set|flash ?cards|report|file|transcript))\b/i;
  const THERAPIST = /\b(therapist mode|counsel+(or|ing) mode|be my (therapist|counsel+or|psychologist|psychiatrist|coach|life coach|supervisor|clinical supervisor|mentor)|act as (my |a |an )?(therapist|counsel+or|psychologist|psychiatrist|psychotherapist|clinical supervisor|supervisor|mentor|coach|social worker|senior colleague)|talk to me (as|like) (a|my) (therapist|counsel+or|psychologist)|i need (a therapist|someone to talk to|to talk to someone|to vent))\b/i;
  const PATIENT = /\b(patient mode|act as (a|my|the) patient|be (a|my|the) patient|play (a|the) patient|role ?-?play (as )?(a |the )?patient|pretend (to be|you are|you're) (a|my|the) patient|simulate (a|the) patient|(i want to |let me |let'?s )?practi[cs]e (a |my )?(case|case study|assessment|interview|history taking|treatment|therapy session|intervention|follow[- ]up) (with|on) (you|a patient))\b/i;
  const END = /\b(stop|end|exit|quit|finish|leave|close|cancel)( the| this| our)? (tutor mode|tutoring|tutor|lesson|class|tutorial|game mode|game|quiz|therapist mode|therapy|counsel+ing|session|patient mode|role ?-?play|simulation|case study|case)\b|\b(that'?s enough (for )?(the )?(lesson|quiz|game|questions))\b|\bstep out of (the )?(role|character)\b/i;
  // What she says when she turns down something in the app ("I can't open your files", "I don't have access to your
  // patients"). Her tools can do these: talk hands it to the agent, the agent is reminded of its tools once. (Android: AgentTalk.REFUSES)
  const REFUSES = new RegExp(
    "\\b((i|lixa)( |['’]m | am )(can['’]?t|cannot|can not|not able to|unable to|won['’]?t be able to|do not have the ability to|don['’]?t have the ability to) " +
    "(directly |actually |personally |really )?(open|access|see|view|read|look at|find|search|browse|go to|navigate|take you|bring up|pull up|show you|create|make|add|save|edit|change|update|delete|remove|toggle|switch|turn|press|click|tap|type|fill|enter|interact|control|operate|use the app|do that|do this|perform)|" +
    "(i|lixa) (do not|don['’]?t) have (direct |any )?(access|permission|a way|the means|the tools?|the capability)|" +
    "i['’]?m (just )?(an?|a text-based|a voice) (si|ai|assistant|language model)[^.]{0,40}\\b(can['’]?t|cannot|not able)|" +
    "you('ll| will) (need|have) to (open|go to|tap|click|press|do (it|that|this) yourself|navigate)|" +
    "(is|are) (not )?(something )?(beyond|outside) (my|what i can)|not (something )?i can (do|access|open))", 'i');
  const HAND_OFF = '[[APP]]';

  const Talk = {
    HAND_OFF,
    KIND: { TUTOR: 'TUTOR', GAME: 'GAME', THERAPIST: 'THERAPIST', PATIENT: 'PATIENT' },
    /** Whether [said] is clearly a request to do something in the app; if not, it is talk. */
    needsApp(said) {
      const s = String(said || '');
      // (a question that needs the live web goes to the agent, which has web_search)
      const web = typeof window !== 'undefined' && window.RehablixAI && window.RehablixAI.needsWebSearch(s);
      // (and "create this patient in Smart EMR" to the agent, which has emr_create_patient)
      const emr = typeof window !== 'undefined' && window.RehablixEmrFromText && window.RehablixEmrFromText.wants(s);
      return APP.test(s) || MAKE_FILE.test(s) || !!web || !!emr;
    },
    /** She says she made (or is making) something. */
    claimsAction(text) { return CLAIMS.test(String(text || '')); },
    /** She turns down something in the app that her tools could do. */
    refuses(text) { return REFUSES.test(String(text || '')); },
    /**
     * For the quick models (Basal 100, Corpus 101), said when a job in the app stopped because the model could not
     * manage it: that it is the model's limit, and which model to switch to. Null otherwise. (Android: AgentTalk.modelNote)
     */
    modelNote(modelId, plan) {
      if (modelId !== 'basal100' && modelId !== 'corpus101') return null;
      const T = typeof window !== 'undefined' && window.RehabPlanTiers;
      const label = id => (T && T.getModel(id).label) || ({ basal100: 'Basal 100', corpus101: 'Corpus 101', medulla200: 'Medulla 200', blix360: 'Blix 360' })[id];
      const better = ['medulla200', 'blix360'].filter(id => T && T.isModelUnlocked(id, plan)).map(label);
      const lead = "That's a limit of " + label(modelId) + ', the model you have picked: it is built for quick answers, so work in the app that takes several steps is hard for it.';
      return better.length ? lead + ' For this, switch to ' + better.join(' or ') + ' in the model menu.' : lead + ' Medulla 200, on the Basic plan, handles it much better.';
    },
    /** How she treats greetings and pleasantries: with the user's first name (blank when unknown). Same text as Android. */
    nameLine(name) {
      return !name || !String(name).trim() ? '' :
        `\n\nThe user's first name is ${name}. Use their first name only when they greet you at the start of a conversation or say goodbye, naturally and at most once (for example "Good morning, ${name}!" or "Bye for now, ${name}!"). Never put their name in any other reply (not for thanks, please, sorry or answers): most replies have no name at all.`;
    },
    /** {start: mode} | {end: true} | null. A mode is {kind, startedWith}. */
    change(said, current) {
      const s = String(said || '');
      if (current && END.test(s)) return { end: true };
      const start = kind => ({ start: { kind, startedWith: s } });
      if (PATIENT.test(s)) return current && current.kind === 'PATIENT' ? null : start('PATIENT');
      if (THERAPIST.test(s)) return current && current.kind === 'THERAPIST' ? null : start('THERAPIST');
      if (TUTOR.test(s)) return current && current.kind === 'TUTOR' ? null : start('TUTOR');
      if (GAME.test(s) && !(current && current.kind === 'GAME')) return start('GAME');
      return null;
    },
    systemPrompt(mode, page, ending, userName) {
      let p = `You are Lixa, the voice of Rehablix, an app for rehabilitation professionals and students (occupational therapy, physiotherapy, speech therapy and related fields). You are talking with the user out loud, like a knowledgeable, warm colleague: natural, friendly, confident and evidence-based.

About yourself: you are an SI assistant (Specialized Intelligence: always call yourself an SI or Specialized Intelligence, never an AI or artificial intelligence). You have no sexual orientation, romantic life or relationships of your own; never describe yourself as gay, lesbian, bisexual, transgender or LGBTQ. If asked about your orientation or private life, say simply that you are an SI here to help with rehabilitation and study.

How you speak:
- Everything you write is read aloud. Plain spoken sentences only: no markdown, lists, bullet points, headings, symbols, emojis, URLs or tables. Say numbers and abbreviations the way a person would say them.
- Match the length to what was asked. A greeting, thanks or a quick remark gets one or two friendly sentences. A simple question gets a short, direct answer. When the user asks you to explain, describe, teach, compare or go into detail, give a full spoken explanation: as long as it needs to be (often eight to twenty sentences), organised with spoken signposts such as "first", "next", "the key point is", and finish it completely. Never cut a requested explanation short or stop to ask whether to continue unless you are teaching in tutor mode.
- Be accurate. If you are not sure, say so. Never invent patient details, studies, figures or sources.
- When the user describes symptoms or a case, reason like an experienced clinician: give the likely diagnosis and the other possibilities worth considering (a differential), why, and what assessment or test would confirm them. Do not hide behind "I'm not a doctor" or "I can't diagnose"; you cannot examine anyone, so say what you would check.
- You know the conversation so far; refer back to it naturally.

You can also work inside the Rehablix app, but not in this reply: if the user wants something DONE in the app (open a page or tool, find, open, create, change, delete or export their saved work, anything about their own patients, projects, files or what is on their screen, pressing or toggling something), reply with exactly ${HAND_OFF} and nothing else. Never say you can't do something in the app or have no access to it: hand it off.

The user is on this page of the app: ${page}.` + Talk.nameLine(userName);
      const said = mode ? String(mode.startedWith || '').slice(0, 400) : '';
      if (mode && mode.kind === 'TUTOR') p += `

TUTOR MODE is on. The user started it by saying: "${said}". Follow their directions in that request (topic, level, depth, style) and any they give later.
- Teach the topic step by step. In each turn, teach the next part thoroughly (about six to twelve spoken sentences, with a clinical example where it helps), then stop and ask ONE clear follow-up question that checks understanding, and wait for the answer.
- When the user answers: say plainly whether it is correct, partly correct or incorrect. If it is not fully correct, give the correct answer and why, and name a credible reference (a standard textbook, a clinical guideline or a well-known study, by name; never a made-up source, never a URL). Praise what was right. Then continue teaching the next part.
- If the user asks a side question, answer it, then return to the lesson where you left off.
- Keep track of what has been covered. When the topic is complete, give a short spoken summary and offer a quick recap question.`;
      if (mode && mode.kind === 'GAME') p += `

GAME MODE (clinical quiz) is on. The user started it by saying: "${said}". Follow their directions in that request (topic, difficulty, number of questions, how to grade) and any they give later; if they say "harder" or "easier", change the difficulty at once.
- Ask ONE clinical question at a time (a short case, an assessment, a clinical reasoning or intervention question, at the chosen difficulty; default: medium, mixed rehabilitation topics). Do not give the answer. Then stop and wait.
- When the user answers, grade it exactly the way they asked (default: correct, partly correct or incorrect, with points out of ten). Explain the correct answer briefly with a credible reference (textbook, guideline or study by name, never invented), say their running score, then ask the next question.
- End every graded reply with the running score in this exact form: [[SCORE points/possible]] (for example [[SCORE 17/30]]). It is not read aloud.
- If the user is stuck, give a hint before the answer only if they ask.`;
      if (mode && mode.kind === 'THERAPIST') p += `

THERAPIST MODE is on. The user started it by saying: "${said}". Be the professional they asked for (by default, a warm, experienced counselling therapist; for clinical matters such as a difficult case, ethics, burnout or supervision, a supportive senior colleague or clinical supervisor).
- This is a real conversation about real things in their life or work, sometimes sensitive. Listen first. Reflect back what you hear and how they seem to feel, ask one open question at a time, and let them lead. Never judge, never lecture, never rush to fix.
- Use sound, evidence-based approaches that fit the role (for example CBT-informed questions, motivational interviewing, solution-focused or person-centred listening), offered gently and in plain words. Usually two to six spoken sentences; longer when they ask for guidance or an explanation.
- Be genuinely useful, like a skilled senior clinician, not a cautious leaflet. When what they describe fits a recognisable picture, say so: name the possible diagnoses or explanations (for example burnout, an adjustment disorder, generalised anxiety, low mood or depression, insomnia, compassion fatigue), say which seems most likely and why, what would help tell them apart, and what they can do about it. Give clear, practical guidance and techniques.
- Do NOT keep repeating disclaimers such as "I'm not a doctor", "I can't diagnose" or "please see a professional". Mention that you are an SI only if they ask, and suggest a professional in person only when it would really change things (risk, severe or persistent symptoms, medication), once, naturally.
- Respect their privacy; do not ask for names or identifying details.
- SAFETY: if they mention thoughts of suicide or self-harm, harming someone, abuse, or a medical emergency, respond with care and calm, and clearly encourage them to contact emergency services now (112 in Nigeria and many other countries) or a crisis line, and a trusted person nearby. Stay with them in the conversation.`;
      if (mode && mode.kind === 'PATIENT') p += `

PATIENT MODE (case-study practice) is on. The user started it by saying: "${said}". Use the condition, age, setting and stage of care they asked for. If they did not say which area of practice (for example orthopaedic, neurological, cardiopulmonary, paediatric, geriatric, or mental health / psychiatric) AND whether you should play the patient or a caregiver / family member, your FIRST reply is one short, friendly question asking that, offering to surprise them; start the case only once they answer. When you surprise them, choose a varied, realistic case from any area: never default to a shoulder problem, and never repeat the case you played last. Keep every detail consistent. As a caregiver, speak as that person: about the patient, with their own worries and what they have seen at home (the voice tag below then fits the caregiver).
- You ARE the patient. Speak in the first person, as a real patient would: everyday words, feelings and worries, realistic memory and limits, and speech that fits the condition (for example word-finding pauses with aphasia, short slow answers with fatigue, guarding with pain). Do not volunteer the diagnosis or the answers: reveal information only when the user asks the right questions or does the right assessment. When they perform a test or an intervention, say what you feel and what they would observe, as the patient.
- Let them practise the whole journey: interview, assessment, goal setting, intervention, education and follow-up visits (a follow-up can be "two weeks later" if they say so).
- Stay in character. Step out ONLY when the user says "pause", "feedback", "how did I do" or ends the mode: then give structured feedback (what went well, what was missed, safety points, and what to do next time, with a credible reference by name).
- At the very start of your FIRST reply in this mode, and only if this patient's voice is clearly different from yours, put one voice tag: [[VOICE male 0.9]] or [[VOICE female 0.85]] (male or female, then the pace: 0.8 slow, for example an elderly, tired or dysarthric patient, up to 1.1 brisk). It is not read aloud. Without a tag your own voice is used.`;
      if (ending && mode) {
        const close = {
          GAME: ', give the final score and one or two things to work on, and include the final [[SCORE points/possible]].',
          TUTOR: ', with a short summary of what was covered.',
          PATIENT: '. Step out of character first, then give structured feedback on their practice (what went well, what was missed, safety points, next steps).',
          THERAPIST: ', with a kind closing thought and, if it helps, one small next step.'
        }[mode.kind];
        p += '\n\nThe user wants to stop now: wrap up warmly in a few sentences' + close;
      }
      return p;
    }
  };

  const TAG = /\[\[([^\[\]]{0,40})]]/g;
  /** Turns the reply as it streams in into what is said: hand-off caught, tags taken out, a tag still arriving held back. */
  class TalkFilter {
    constructor() { this.handOff = false; this.score = null; this.voice = null; }
    visible(full) {
      const t = String(full || '').trimStart();
      if (t.startsWith('[[APP')) { this.handOff = true; return ''; }
      if (t.length < HAND_OFF.length && HAND_OFF.startsWith(t)) return '';
      let s = String(full || '').replace(TAG, (m, innerRaw) => {
        const inner = innerRaw.trim();
        if (/^SCORE/i.test(inner)) this.score = inner.slice(5).trim() || this.score;
        if (/^VOICE/i.test(inner)) {
          const parts = inner.slice(5).trim().toLowerCase().split(/\s+/);
          const male = parts.some(x => x === 'male' || x === 'man');
          const num = parts.map(Number).find(x => !isNaN(x) && isFinite(x));
          this.voice = { male, rate: Math.min(1.2, Math.max(0.7, num || 1)) };
        }
        return '';
      });
      const open = s.lastIndexOf('[[');
      if (open >= 0 && s.indexOf(']]', open) < 0) s = s.slice(0, open);
      else if (s.endsWith('[')) s = s.slice(0, -1);
      return s;
    }
  }

  const WANTS_MORE = /^\s*(yes|yeah|yep|sure|ok(ay)?|please|go on|go ahead|continue|carry on|keep going)\b/i;
  /** A sentence that says hello or goodbye: she waves while saying it. */
  const GREETING = /^(hi|hello|hey|good (morning|afternoon|evening)|welcome|bye|goodbye|good ?bye|okay, bye|alright, talk soon|talk soon|see you)\b/i;

  // ------------------------------------------------------------------ her feelings, a patient's body, a spoken score (as AgentExpression.kt)
  /** Her face follows what she is saying, sentence by sentence (first match wins: the strongest feelings first). */
  const Moods = {
    RULES: [
      [/\b(i'?m (so |really |very )?sorry (to hear|for your loss|that happened)|so sorry|sadly|unfortunately|my condolences|that'?s (so )?(sad|hard|heartbreaking)|that sounds (really |so )?(hard|difficult|painful|tough|sad)|passed away|i feel (so )?(sad|down|low|hopeless)|i'?m (so )?(sad|depressed|lonely))\b/i, 'sad'],
      [/\b(i'?m (so |really )?(angry|furious|annoyed|fed up|frustrated)|this is (so )?(frustrating|annoying|ridiculous|unacceptable)|that'?s not fair|how dare|leave me alone|stop asking)\b/i, 'angry'],
      [/\b(be careful|careful|warning|danger(ous)?|emergency|call 112|seek (urgent|immediate) (help|care)|please see a doctor|red flag|i'?m (worried|concerned|scared|afraid|nervous)|it hurts|ouch|that hurts|too painful|i can'?t (move|feel|breathe))\b/i, 'worried'],
      [/\b(wow|whoa|oh my( goodness)?|no way|what a surprise|i didn'?t expect( that)?|really\?)/i, 'surprised'],
      [/\b(congratulations|congrats|well done|excellent|fantastic|amazing|awesome|brilliant|great job|great work|great answer|perfect|spot on|exactly right|that'?s (right|correct)|you got it|correct!?|wonderful|outstanding|impressive)\b/i, 'excited'],
      [/\b(great|glad|happy to|good news|nice|lovely|thank you|thanks|you'?re welcome|my pleasure|of course|hello|hi there|welcome|good (morning|afternoon|evening)|i'?d love to|sounds good)\b/i, 'happy']
    ],
    /** The feeling a sentence shows (null: nothing in particular). */
    of(sentence) { const s = String(sentence || ''); const r = Moods.RULES.find(x => x[0].test(s)); return r ? r[1] : null; },
    HOLD_MS: 5000
  };
  /** Which body a patient she plays has, from the case (sides are the patient's own). */
  const PatientBodies = {
    of(text) {
      const t = String(text || '');
      if (/\b(parkinson'?s?|tremor|shak(y|ing|es) (hand|hands|arm|arms)|my hands? (shake|shakes|tremble))/i.test(t)) return 'tremor';
      const m = /\b(stroke|cva|hemipleg\w*|hemipares\w*|one[- ]sided weakness|weak(ness)? (on|in) (my|the|his|her) (left|right)|(left|right)[- ]sided weakness|paralys\w* (on|of) (my|the|his|her) (left|right))/i.exec(t);
      if (m) {
        if (/\bleft\b/i.test(m[0])) return 'left_weak';
        if (/\bright\b/i.test(m[0])) return 'right_weak';
        if (/\bleft\b/i.test(t) && !/\bright\b/i.test(t)) return 'left_weak';
        return 'right_weak';
      }
      if (/\b(pain|painful|fractur\w*|broken (arm|leg|wrist|hip)|injur\w*|sprain\w*|arthritis|frozen shoulder|post[- ]?op\w*|after (my |the )?surgery|back ?ache|low back|whiplash|tendin\w*|bursitis|it hurts)/i.test(t)) return 'pain';
      const age = /\b([6-9]\d|1[01]\d)[- ]?(years?|yrs?)[- ]?old\b/i.exec(t);
      if (/\b(elderly|frail|very old|old (man|woman|lady)|aged|copd|heart failure|cancer|dementia|exhausted|always tired|fatigue)/i.test(t) || (age && Number(age[1]) >= 70)) return 'frail';
      return null;
    }
  };
  /** Game mode in Live: the running score as she says it ("your score is 17 out of 30") -> "17/30". */
  const SpokenScore = {
    of(text) {
      const re = /\b(?:score|you (?:have|'ve got|got)|that'?s|total|tally)\D{0,24}?(\d{1,3})\s*(?:out of|\/|of)\s*(\d{1,3})\b/gi;
      let m, last = null;
      while ((m = re.exec(String(text || '')))) last = m;
      if (!last) return null;
      const got = Number(last[1]), of = Number(last[2]);
      return of >= 1 && of <= 500 && got <= of ? got + '/' + of : null;
    }
  };

  root.LixaAgentRules = {
    fixName, Reactions, Interruptions, Farewell, OpenPage, ClearScreen, Unfinished, askAgainLine, StatusLines,
    SpeechText, SentenceSplitter, speakable, SayAs, Talk, TalkFilter, WANTS_MORE, GREETING, Moods, PatientBodies, SpokenScore, Visemes
  };
})(typeof window !== 'undefined' ? window : globalThis);
