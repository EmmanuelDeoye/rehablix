// Names for the files Lixa makes (chat and agent), so each is easy to find again in History > Files and in
// Downloads: never just "Lixa Response", "Transcript – <date>" or "Patient". The same rules as the Android
// app's lixa/FileTitles.kt.
(function () {
  'use strict';

  const HEADING = /^\s*#{1,3}\s+(.+)$/m;
  const BOLD_LINE = /^\s*\*\*(.{4,90}?)\*\*\s*:?\s*$/m;
  // the request words in front of what the question was about
  const ASKING = /^(?:\s*(?:hi|hello|hey|ok(?:ay)?|so|lixa|please|kindly|can you|could you|would you|will you|i need|i want|i'?d like|help me(?: with)?|give me|tell me(?: about)?|explain(?: to me)?|describe|write(?: me)?|draft|make|create|prepare|summari[sz]e|list|outline|show me|what(?:'s| is| are)|how (?:do|does|to|can)|why (?:do|does|is|are)|a|an|the|some|about|on|for)\b[\s,:]*)+/i;
  const MARKUP = /[*_`#>|[\]]/g;
  const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with']);

  function clean(s) {
    return String(s || '').replace(MARKUP, '').replace(/\s+/g, ' ').trim().replace(/^[.:\- ]+|[.:\- ]+$/g, '');
  }
  function firstLine(s) { return String(s || '').split('\n').find(l => l.trim()) || ''; }

  /** Every word starting with a capital (short joining words kept small, except the first). */
  function titleCase(s) {
    return String(s || '').split(' ').filter(Boolean).map((w, i) => {
      if (/[A-Z]/.test(w) && /[A-Z]/.test(w.slice(1))) return w;            // keep "ROM", "ADLs", "McKenzie"
      if (i > 0 && SMALL.has(w.toLowerCase())) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  /** What a question or request was about, as a short title ("can you explain spasticity in stroke?" -> "Spasticity in Stroke"). */
  function topicOf(question) {
    const q = clean(firstLine(question)).replace(/[?!]+$/, '');
    const t = q.replace(ASKING, '').trim();
    return titleCase(t.split(' ').slice(0, 10).join(' ')).slice(0, 70).trim();
  }

  /** A written answer's title: its first heading, else its first bold title line, else what the question asked. */
  function fromAnswer(markdown, question) {
    const md = String(markdown || '');
    let m = md.match(HEADING);
    if (m && clean(m[1]).length >= 4) return clean(m[1]).slice(0, 90);
    m = md.match(BOLD_LINE);
    if (m && clean(m[1]).length >= 4) return clean(m[1]).slice(0, 90);
    const asked = question ? topicOf(question) : '';
    if (asked.length >= 4) return asked;
    const first = clean(firstLine(md)).split(' ').slice(0, 8).join(' ');
    return (first || 'Lixa document').slice(0, 70);
  }

  /**
   * A short title written by the AI for `what` (for example "session transcript") from `text`: its main topic.
   * Names, dates of birth and phone numbers are scrubbed out before it is sent, and no name is asked for.
   * Null when the AI cannot be used (the caller keeps its own name). One small call on the user's own model and
   * token budget.
   */
  async function aiTitle(what, text) {
    if (!text || !String(text).trim()) return null;
    try {
      const core = window.LixaCore;
      const config = await core.resolveToolModelConfig().catch(() => null);
      if (!config) return null;
      const quotaOk = await core.checkToolQuota().then(() => true).catch(() => false);
      if (!quotaOk) return null;
      const D = window.RehablixDeidentify;
      const sys = `Write a short, specific title (3 to 8 words) for this ${what}, so it is easy to find in a list. Name the main topic, condition or activity. Do not include any person's name. Reply with the title only: no quotes, no full stop, no date.`;
      const usr = D ? D.scrubText(String(text).slice(0, 4000)) : String(text).slice(0, 4000).replace(/\+?\d[\d\s-]{6,}\d/g, '');
      const response = await fetch(`${config.endpoint.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.token}` },
        body: JSON.stringify({ model: config.model, messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }], max_tokens: 60, temperature: 0.3 })
      });
      if (!response.ok) return null;
      const data = await response.json();
      const out = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      core.reportToolTokenUsage(sys + usr + out, config.weight);
      const title = clean(firstLine(out).trim().replace(/^["'“”]+|["'“”]+$/g, '')).slice(0, 80);
      const words = title.split(' ').filter(Boolean).length;
      return words >= 2 && words <= 12 ? title : null;
    } catch (e) { return null; }
  }

  window.RehablixFileTitles = { titleCase, topicOf, fromAnswer, aiTitle };
})();
