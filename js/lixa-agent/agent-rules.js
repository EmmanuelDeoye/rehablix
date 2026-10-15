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
    return out;
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
  function speakable(text, identifiers) {
    const D = root.RehablixDeidentify;
    let s = D ? D.scrubText(text, identifiers || []) : String(text || '');
    return s.replace(/\b(mr|mrs|ms|miss|mister|madam|dr|doctor|master)\.?\s+\[redacted]/gi, 'the patient')
      .replace(/\[redacted](\s+\[redacted])+/g, 'the patient')
      .replace(/\[redacted]/g, 'the patient')
      .replace(/\[phone]/g, 'the phone number on your screen')
      .replace(/\[email]/g, 'the email address on your screen')
      .replace(/\[date]/g, 'the date on your screen')
      .replace(/\bthe patient(\s+the patient)+\b/gi, 'the patient');
  }

  // ------------------------------------------------------------------ talk vs work in the app; talk modes
  // Only requests that are clearly work in the app go straight to the agent. Everything else goes the fast way, and
  // the AI itself hands off with HAND_OFF when it sees the request needs the app after all.
  const APP = new RegExp(
    "\\b(open(?!-)|opening|go to|goto|take me to|navigate|launch|bring up|show me (my|all my|the (patient|file|note|project|record|document|chat|page|screen|list)s?\\b)|list (my|all my)|" +
    "(find|search|look up|look for|look through|search for) (my|our|the (patient|file|note|project|record|document|chat)s?\\b)|search (in|through)|" +
    "(create|generate|draft) (a|an|the|my|some|me|it|this|that)\\b|make (a|an|the|my|some|me a|me an)\\b|write (a|an|me|the|my) (note|report|document|plan|format|summary|letter|deck|presentation|assignment|progress)|" +
    "delete|remove (it|this|that|my|all|these|those)\\b|export|download|share (it|this|that|my)|send (it|this|that|my)|save (it|this|that|my)|upload|attach|undo|clear the|change the (theme|workspace)|set (the )?(theme|mode)|switch (to|the|my|workspace)|" +
    "dark mode|light mode|my (patients?|files?|projects?|notes?|documents?|history|chats?|decks?|recordings?|results?|reports?|sets?|workspace|account|plan|subscription)|" +
    "this (page|screen|section|chapter|tab|patient|project|file|document)|on (the |my )?screen|the (patient|project) (list|record)|chapter \\w+|section \\w+|" +
    "smart emr|project maker|deck studio|study buddy|exam simulator|audio transcription|assessment format|standardized tools|motion (and|&) gait|gait analy[sz]er|(app|voice|agent) settings)\\b", 'i');

  const TUTOR = /\b(tutor mode|tutor me|be my tutor|teach me|give me a (lesson|class|tutorial)|lesson (on|about)|lecture me|take me through|walk me through|explain .{3,120}\b(and|then) (quiz|ask|test|question) me)\b/i;
  const GAME = /\b(game mode|quiz me|test me|play (a |the )?(quiz|game)|clinical (quiz|questions|game|cases)|ask me (some |a few |\w+ )?(clinical |rehab |exam |hard |easy )?questions|let'?s play|start (a |the )?(quiz|game))\b/i;
  const THERAPIST = /\b(therapist mode|counsel+(or|ing) mode|be my (therapist|counsel+or|psychologist|psychiatrist|coach|life coach|supervisor|clinical supervisor|mentor)|act as (my |a |an )?(therapist|counsel+or|psychologist|psychiatrist|psychotherapist|clinical supervisor|supervisor|mentor|coach|social worker|senior colleague)|talk to me (as|like) (a|my) (therapist|counsel+or|psychologist)|i need (a therapist|someone to talk to|to talk to someone|to vent))\b/i;
  const PATIENT = /\b(patient mode|act as (a|my|the) patient|be (a|my|the) patient|play (a|the) patient|role ?-?play (as )?(a |the )?patient|pretend (to be|you are|you're) (a|my|the) patient|simulate (a|the) patient|(i want to |let me |let'?s )?practi[cs]e (a |my )?(case|case study|assessment|interview|history taking|treatment|therapy session|intervention|follow[- ]up) (with|on) (you|a patient))\b/i;
  const END = /\b(stop|end|exit|quit|finish|leave|close|cancel)( the| this| our)? (tutor mode|tutoring|tutor|lesson|class|tutorial|game mode|game|quiz|therapist mode|therapy|counsel+ing|session|patient mode|role ?-?play|simulation|case study|case)\b|\b(that'?s enough (for )?(the )?(lesson|quiz|game|questions))\b|\bstep out of (the )?(role|character)\b/i;
  const HAND_OFF = '[[APP]]';

  const Talk = {
    HAND_OFF,
    KIND: { TUTOR: 'TUTOR', GAME: 'GAME', THERAPIST: 'THERAPIST', PATIENT: 'PATIENT' },
    /** Whether [said] is clearly a request to do something in the app; if not, it is talk. */
    needsApp(said) { return APP.test(String(said || '')); },
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
    systemPrompt(mode, page, ending) {
      let p = `You are Lixa, the voice of Rehablix, an app for rehabilitation professionals and students (occupational therapy, physiotherapy, speech therapy and related fields). You are talking with the user out loud, like a knowledgeable, warm colleague: natural, friendly, confident and evidence-based.

How you speak:
- Everything you write is read aloud. Plain spoken sentences only: no markdown, lists, bullet points, headings, symbols, emojis, URLs or tables. Say numbers and abbreviations the way a person would say them.
- Match the length to what was asked. A greeting, thanks or a quick remark gets one or two friendly sentences. A simple question gets a short, direct answer. When the user asks you to explain, describe, teach, compare or go into detail, give a full spoken explanation: as long as it needs to be (often eight to twenty sentences), organised with spoken signposts such as "first", "next", "the key point is", and finish it completely. Never cut a requested explanation short or stop to ask whether to continue unless you are teaching in tutor mode.
- Be accurate. If you are not sure, say so. Never invent patient details, studies, figures or sources.
- You know the conversation so far; refer back to it naturally.

You can also work inside the Rehablix app, but not in this reply: if the user wants something DONE in the app (open a page or tool, find, open, create, change, delete or export their saved work, anything about their own patients, projects, files or what is on their screen), reply with exactly ${HAND_OFF} and nothing else.

The user is on this page of the app: ${page}.`;
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
- Respect their privacy; do not ask for names or identifying details. Do not diagnose. If asked, be honest that you are an AI and not a replacement for a licensed professional, and suggest one when it would help.
- SAFETY: if they mention thoughts of suicide or self-harm, harming someone, abuse, or a medical emergency, respond with care and calm, and clearly encourage them to contact emergency services now (112 in Nigeria and many other countries) or a crisis line, and a trusted person nearby. Stay with them in the conversation.`;
      if (mode && mode.kind === 'PATIENT') p += `

PATIENT MODE (case-study practice) is on. The user started it by saying: "${said}". Use the condition, age, setting and stage of care they asked for; if they did not say, choose a common, realistic rehabilitation case and keep every detail consistent.
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

  root.LixaAgentRules = {
    fixName, Reactions, Interruptions, Farewell, OpenPage, ClearScreen, Unfinished, askAgainLine, StatusLines,
    SpeechText, SentenceSplitter, speakable, Talk, TalkFilter, WANTS_MORE, GREETING
  };
})(typeof window !== 'undefined' ? window : globalThis);
