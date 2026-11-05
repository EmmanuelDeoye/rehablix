// js/project-tools-core.js — the calculations behind Project Maker's research tools (Project Tools screen):
// sample size, statistical test choice, citation ⇄ reference cross-check, project-wide search, and the
// activity timeline. PURE: plain data in, plain data out — no DOM, no Firebase, no AI — so every number can be
// checked in Node (tests/project-tools-core.test.js) and the Android app (project/ProjectTools.kt) gives the
// same answers. The UI lives in js/views/project-view.js.
(function () {
  const T = {};

  // ------------------------------------------------------------------ shared
  const round1 = (v) => Math.round(v * 10) / 10;
  const stripTags = (h) => String(h || '').replace(/<[^>]+>/g, ' ');
  function decode(s) {
    return String(s || '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&ndash;|&mdash;/g, '-');
  }
  const clean = (h) => decode(stripTags(h)).replace(/\s+/g, ' ').trim();
  // Block-level pieces of an HTML section (headings, paragraphs, list items) as plain text, in order.
  function blocksOf(html) {
    const out = [];
    const re = /<(h[1-6]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let m, any = false;
    while ((m = re.exec(String(html || '')))) { any = true; const text = clean(m[2]); if (text) out.push({ tag: m[1].toLowerCase(), text }); }
    if (!any) { const text = clean(html); if (text) out.push({ tag: 'p', text }); }
    return out;
  }
  T.blocksOf = blocksOf;
  T.plain = clean;

  // ------------------------------------------------------------------ sample size
  // Normal quantiles for the usual choices (two-sided α, one-sided β).
  const Z_CONF = { 90: 1.6449, 95: 1.96, 99: 2.5758 };
  const Z_POWER = { 80: 0.8416, 85: 1.0364, 90: 1.2816, 95: 1.6449 };
  const zConf = (c) => Z_CONF[c] || 1.96;
  const zPow = (p) => Z_POWER[p] || 0.8416;
  T.Z_CONF = Z_CONF; T.Z_POWER = Z_POWER;
  const up = (v) => Math.ceil(v - 1e-9);
  // Inflate for expected drop-out / non-response: n / (1 − rate).
  function inflate(n, attritionPct) {
    const a = Math.max(0, Math.min(90, Number(attritionPct) || 0)) / 100;
    return a > 0 ? up(n / (1 - a)) : n;
  }
  T.inflate = inflate;

  // Each method returns { n, perGroup?, groups, formula, steps, citation, paragraph(ctx) }.
  const METHODS = {
    yamane: {
      label: 'Survey: known population (Yamane)',
      calc(i) {
        const N = Number(i.population), e = Number(i.margin) / 100;
        if (!(N > 0) || !(e > 0 && e < 1)) return null;
        const raw = N / (1 + N * e * e);
        return { n: up(raw), groups: 1, raw, formula: 'n = N / (1 + N·e²)', steps: `n = ${N} / (1 + ${N} × ${e}²) = ${round1(raw)}`, citation: 'Yamane (1967)' };
      }
    },
    cochran: {
      label: 'Survey: estimate a proportion (Cochran)',
      calc(i) {
        const z = zConf(i.confidence), p = Number(i.proportion) / 100, e = Number(i.margin) / 100, N = Number(i.population) || 0;
        if (!(p > 0 && p < 1) || !(e > 0 && e < 1)) return null;
        const n0 = (z * z * p * (1 - p)) / (e * e);
        const raw = N > 0 ? n0 / (1 + (n0 - 1) / N) : n0;
        return { n: up(raw), groups: 1, raw, formula: N > 0 ? 'n₀ = Z²·p(1−p) / e²;  n = n₀ / (1 + (n₀ − 1)/N)' : 'n = Z²·p(1−p) / e²',
          steps: `n₀ = ${z}² × ${p} × ${+(1 - p).toFixed(4)} / ${e}² = ${round1(n0)}` + (N > 0 ? `;  n = ${round1(n0)} / (1 + (${round1(n0)} − 1)/${N}) = ${round1(raw)}` : ''),
          citation: 'Cochran (1977)' };
      }
    },
    twoMeans: {
      label: 'Compare two groups (independent t-test)',
      calc(i) {
        const d = Number(i.effect), za = zConf(i.confidence), zb = zPow(i.power);
        if (!(d > 0)) return null;
        // normal approximation with Guenther's small-sample correction (z²/4 per group): matches G*Power closely
        const raw = (2 * Math.pow(za + zb, 2)) / (d * d) + (za * za) / 4;
        const per = up(raw);
        return { n: per * 2, perGroup: per, groups: 2, raw, formula: 'n per group = 2(Z₁₋α/₂ + Z₁₋β)² / d²  (+ Z²/4 small-sample correction)',
          steps: `n per group = 2 × (${za} + ${zb})² / ${d}² + ${za}²/4 = ${round1(raw)}`, citation: 'Cohen (1988)' };
      }
    },
    paired: {
      label: 'Before and after in one group (paired t-test)',
      calc(i) {
        const d = Number(i.effect), za = zConf(i.confidence), zb = zPow(i.power);
        if (!(d > 0)) return null;
        const raw = Math.pow(za + zb, 2) / (d * d) + (za * za) / 2;
        return { n: up(raw), groups: 1, raw, formula: 'n = (Z₁₋α/₂ + Z₁₋β)² / d²  (+ Z²/2 small-sample correction)',
          steps: `n = (${za} + ${zb})² / ${d}² + ${za}²/2 = ${round1(raw)}`, citation: 'Cohen (1988)' };
      }
    },
    twoProportions: {
      label: 'Compare two proportions (chi-square)',
      calc(i) {
        const p1 = Number(i.p1) / 100, p2 = Number(i.p2) / 100, za = zConf(i.confidence), zb = zPow(i.power);
        if (!(p1 > 0 && p1 < 1 && p2 > 0 && p2 < 1) || p1 === p2) return null;
        const pb = (p1 + p2) / 2;
        const raw = Math.pow(za * Math.sqrt(2 * pb * (1 - pb)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)), 2) / Math.pow(p1 - p2, 2);
        const per = up(raw);
        return { n: per * 2, perGroup: per, groups: 2, raw, formula: 'n per group = [Z₁₋α/₂√(2p̄(1−p̄)) + Z₁₋β√(p₁(1−p₁) + p₂(1−p₂))]² / (p₁ − p₂)²',
          steps: `p̄ = ${round1(pb * 100) / 100};  n per group = ${round1(raw)}`, citation: 'Fleiss, Levin and Paik (2003)' };
      }
    },
    correlation: {
      label: 'Relationship between two variables (correlation)',
      calc(i) {
        const r = Math.abs(Number(i.r)), za = zConf(i.confidence), zb = zPow(i.power);
        if (!(r > 0 && r < 1)) return null;
        const C = 0.5 * Math.log((1 + r) / (1 - r));
        const raw = Math.pow((za + zb) / C, 2) + 3;
        return { n: up(raw), groups: 1, raw, formula: 'n = [(Z₁₋α/₂ + Z₁₋β) / C]² + 3,  C = ½ ln[(1 + r)/(1 − r)]',
          steps: `C = ${C.toFixed(4)};  n = ((${za} + ${zb}) / ${C.toFixed(4)})² + 3 = ${round1(raw)}`, citation: 'Hulley et al. (2013)' };
      }
    }
  };
  T.SAMPLE_METHODS = Object.keys(METHODS).map((k) => ({ id: k, label: METHODS[k].label }));

  // inputs: { method, population, margin (%), proportion (%), confidence (90|95|99), power (80|85|90|95),
  //           effect (d), p1, p2 (%), r, attrition (%) }
  function sampleSize(inputs) {
    const m = METHODS[inputs && inputs.method];
    if (!m) return { ok: false, error: 'Choose a method.' };
    const r = m.calc(inputs);
    if (!r) return { ok: false, error: 'Check the numbers: some values are missing or out of range.' };
    const att = Number(inputs.attrition) || 0;
    const final = r.groups === 2 ? inflate(r.perGroup, att) * 2 : inflate(r.n, att);
    const finalPer = r.groups === 2 ? final / 2 : null;
    return Object.assign({ ok: true, method: inputs.method, label: m.label, attrition: att, finalN: final, finalPerGroup: finalPer }, r,
      { paragraph: sampleParagraph(inputs, r, final, finalPer, att) });
  }
  T.sampleSize = sampleSize;

  function sampleParagraph(i, r, final, finalPer, att) {
    const conf = Number(i.confidence) || 95, pow = Number(i.power) || 80;
    const attTxt = att > 0 ? ` To allow for an anticipated ${att}% attrition or non-response, the sample was increased to ${finalPer ? finalPer + ' participants per group (' + final + ' in total)' : final + ' participants'}.` : '';
    switch (i.method) {
      case 'yamane':
        return `The sample size was determined using Yamane's (1967) formula, n = N / (1 + N·e²), where N is the population size (${i.population}) and e is the margin of error (${i.margin}%). This gave a minimum sample size of ${r.n} participants.${attTxt}`;
      case 'cochran':
        return `The sample size was calculated using Cochran's (1977) formula for estimating a proportion, at a ${conf}% confidence level (Z = ${zConf(conf)}), an expected proportion of ${i.proportion}% and a margin of error of ${i.margin}%${Number(i.population) > 0 ? ', with a finite population correction for a population of ' + i.population : ''}. The minimum sample size required was ${r.n} participants.${attTxt}`;
      case 'twoMeans':
        return `An a priori sample size calculation was performed for an independent-samples comparison of two groups. Assuming a ${i.effect >= 0.8 ? 'large' : i.effect >= 0.5 ? 'medium' : 'small'} effect size (Cohen's d = ${i.effect}; Cohen, 1988), a two-sided significance level of α = ${conf === 95 ? '0.05' : conf === 99 ? '0.01' : '0.10'} and ${pow}% power, a minimum of ${r.perGroup} participants per group (${r.n} in total) was required.${attTxt}`;
      case 'paired':
        return `An a priori sample size calculation was performed for a within-group (pre-test/post-test) comparison. Assuming an effect size of d = ${i.effect} (Cohen, 1988), a two-sided significance level of α = ${conf === 95 ? '0.05' : conf === 99 ? '0.01' : '0.10'} and ${pow}% power, a minimum of ${r.n} participants was required.${attTxt}`;
      case 'twoProportions':
        return `The sample size was calculated to detect a difference between two proportions (${i.p1}% and ${i.p2}%), with a two-sided significance level of α = ${conf === 95 ? '0.05' : conf === 99 ? '0.01' : '0.10'} and ${pow}% power (Fleiss, Levin and Paik, 2003). A minimum of ${r.perGroup} participants per group (${r.n} in total) was required.${attTxt}`;
      case 'correlation':
        return `The sample size was calculated to detect a correlation of r = ${i.r} between the study variables, with a two-sided significance level of α = ${conf === 95 ? '0.05' : conf === 99 ? '0.01' : '0.10'} and ${pow}% power, using Fisher's z transformation (Hulley et al., 2013). A minimum of ${r.n} participants was required.${attTxt}`;
      default: return '';
    }
  }

  // ------------------------------------------------------------------ statistical analysis planner
  // a: { goal: describe|compare|relate|predict, design: independent|paired, groups: 2|3, outcome: continuous|ordinal|categorical,
  //      normal: yes|no|unsure, outcomeBinary?: bool }
  function planTest(a) {
    a = a || {};
    const out = { primary: '', alternative: '', descriptive: '', assumptions: [], posthoc: '', effectSize: '', reason: '' };
    const normal = a.normal === 'yes', unsure = a.normal !== 'yes' && a.normal !== 'no';
    const cont = a.outcome === 'continuous', ord = a.outcome === 'ordinal', cat = a.outcome === 'categorical';
    out.descriptive = cont ? 'Mean and standard deviation (median and interquartile range if not normally distributed)' : ord ? 'Median and interquartile range; frequencies and percentages per response category' : 'Frequencies and percentages';
    const param = (p, np) => {
      if (cont && (normal || unsure)) { out.primary = p; out.alternative = np; if (unsure) out.assumptions.push('Test normality first (Shapiro–Wilk; histograms/Q–Q plots). If the data are not normal, use ' + np + ' instead.'); }
      else { out.primary = np; out.alternative = cont ? p + ' (only if the data turn out to be normally distributed)' : ''; }
    };
    if (a.goal === 'describe') {
      out.primary = 'Descriptive statistics only'; out.reason = 'The question describes the sample or a level of something, without comparing groups or testing a relationship.';
    } else if (a.goal === 'compare') {
      const three = Number(a.groups) >= 3;
      if (a.design === 'paired') {
        if (cat) { out.primary = three ? "Cochran's Q test" : "McNemar's test"; out.reason = 'A categorical (yes/no) outcome measured on the same people at ' + (three ? 'three or more' : 'two') + ' time points.'; }
        else {
          param(three ? 'Repeated-measures ANOVA' : 'Paired-samples t-test', three ? 'Friedman test' : 'Wilcoxon signed-rank test');
          out.reason = 'The same participants are measured ' + (three ? 'three or more times' : 'twice (e.g. before and after)') + '.';
          if (three) out.posthoc = out.primary === 'Repeated-measures ANOVA' ? 'Bonferroni-adjusted pairwise comparisons; check sphericity (Mauchly) and use the Greenhouse–Geisser correction if violated' : 'Wilcoxon signed-rank tests with a Bonferroni correction';
        }
        out.effectSize = cat ? 'Odds ratio' : three ? 'Partial eta squared (η²)' : "Cohen's d (or r for Wilcoxon)";
      } else {
        if (cat) { out.primary = 'Chi-square test of independence'; out.alternative = "Fisher's exact test (when any expected cell count is below 5)"; out.reason = 'A categorical outcome compared between independent groups.'; out.effectSize = "Cramér's V (or phi for a 2 × 2 table)"; }
        else {
          param(three ? 'One-way ANOVA' : 'Independent-samples t-test', three ? 'Kruskal–Wallis H test' : 'Mann–Whitney U test');
          out.reason = 'Different participants in ' + (three ? 'three or more' : 'two') + ' groups are compared on the outcome.';
          if (out.primary === 'Independent-samples t-test') out.assumptions.push("Check equal variances (Levene's test); report Welch's t-test if they are unequal.");
          if (three) { out.posthoc = out.primary === 'One-way ANOVA' ? "Tukey's HSD post hoc test (Games–Howell if variances are unequal)" : "Dunn's pairwise tests with a Bonferroni correction"; out.assumptions.push("Check equal variances (Levene's test)."); }
          out.effectSize = three ? 'Eta squared (η²)' : "Cohen's d (or r for Mann–Whitney)";
        }
      }
    } else if (a.goal === 'relate') {
      if (cat) { out.primary = 'Chi-square test of independence'; out.alternative = "Fisher's exact test (small expected counts)"; out.reason = 'Both variables are categories.'; out.effectSize = "Cramér's V"; }
      else if (cont && (normal || unsure)) { out.primary = "Pearson's correlation (r)"; out.alternative = "Spearman's rank correlation (ρ)"; out.reason = 'Both variables are measured on a continuous scale.'; out.effectSize = 'r itself (0.1 small, 0.3 medium, 0.5 large)';
        out.assumptions.push('Check for a straight-line relationship (scatter plot) and outliers.'); if (unsure) out.assumptions.push("Test normality first; if not normal, use Spearman's ρ."); }
      else { out.primary = "Spearman's rank correlation (ρ)"; out.alternative = ord ? "Kendall's tau-b (many tied ranks)" : ''; out.reason = 'At least one variable is ordinal (e.g. a Likert scale) or not normally distributed.'; out.effectSize = 'ρ itself'; }
    } else if (a.goal === 'predict') {
      if (cat) { out.primary = a.outcomeBinary === false ? 'Multinomial logistic regression' : 'Binary logistic regression'; out.reason = 'Predicting a categorical outcome from one or more predictors.'; out.effectSize = 'Odds ratios with 95% confidence intervals; Nagelkerke R²'; out.assumptions.push('At least about 10 outcome events per predictor; check multicollinearity (VIF).'); }
      else if (ord) { out.primary = 'Ordinal logistic regression'; out.reason = 'Predicting an ordered outcome (e.g. a Likert rating).'; out.effectSize = 'Odds ratios'; out.assumptions.push('Check the proportional odds assumption.'); }
      else { out.primary = 'Multiple linear regression'; out.reason = 'Predicting a continuous outcome from one or more predictors.'; out.effectSize = 'R² and standardised coefficients (β)'; out.assumptions.push('Check linearity, normality of residuals, homoscedasticity and multicollinearity (VIF).'); }
    }
    return out;
  }
  T.planTest = planTest;

  // analyses: [{ label, plan }]; opts: { software, alpha }
  // Lower-case a phrase's first letter for use mid-sentence, unless it starts with a name (Pearson's, Mann–Whitney…).
  const NAMED = /^(Pearson|Spearman|Kendall|Fisher|McNemar|Cochran|Cohen|Cramér|Tukey|Dunn|Wilcoxon|Mann|Kruskal|Friedman|Welch|Levene|Bonferroni|Nagelkerke|Games|Shapiro|R²)/;
  const mid = (s) => (NAMED.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
  T.mid = mid;

  function analysisParagraph(analyses, opts) {
    opts = opts || {};
    const sw = opts.software || 'IBM SPSS Statistics';
    const alpha = opts.alpha || '0.05';
    const parts = [`Data will be entered, cleaned and analysed using ${sw}.`];
    const desc = [...new Set(analyses.map((x) => x.plan.descriptive).filter(Boolean))];
    if (desc.length) parts.push(`Descriptive statistics will be used to summarise participants' characteristics and the study variables: ${desc.map(mid).join('; ')}.`);
    if (analyses.some((x) => x.plan.assumptions.some((s) => /normal/i.test(s)))) parts.push('The normality of continuous variables will be assessed with the Shapiro–Wilk test and by inspecting histograms and Q–Q plots.');
    analyses.filter((x) => x.plan.primary && x.plan.primary !== 'Descriptive statistics only').forEach((x) => {
      const name = mid(x.plan.primary);
      let s = `To ${x.label ? 'address ' + x.label.replace(/[.?]+$/, '') : 'test the study hypothesis'}, ${NAMED.test(name) ? '' : /^[aeiou]/i.test(name) ? 'an ' : 'a '}${name} will be used`;
      if (x.plan.alternative) s += ` (${mid(x.plan.alternative)} if its assumptions are not met)`;
      s += '.';
      if (x.plan.posthoc) s += ` Where the overall test is significant, ${mid(x.plan.posthoc)} will identify which groups differ.`;
      if (x.plan.effectSize) s += ` Effect sizes will be reported as ${mid(x.plan.effectSize)}.`;
      parts.push(s);
    });
    parts.push(`Statistical significance will be set at p < ${alpha}, and results will be presented in tables and figures.`);
    return parts.join(' ');
  }
  T.analysisParagraph = analysisParagraph;

  // ------------------------------------------------------------------ citations ⇄ references (author–date styles)
  const SURNAME = "[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’\\-]+";
  const YEAR = '(?:1[89]\\d{2}|20\\d{2})[a-z]?|n\\.d\\.';
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  const keyOf = (surname, year) => norm(surname) + '|' + String(year || '').toLowerCase().replace(/\s/g, '');
  T.keyOf = keyOf;
  const WORD_SKIP = /^(See|E\.g|Eg|I\.e|Cf|Also|For|In|The|And|As|Table|Figure|Fig|Chapter|Section|Page|Pp?)$/;

  // In-text citations in a plain-text passage: "(Dunn, 2001; Case-Smith et al., 2015)", "Dunn (2001)", "Lang et al. (2012)".
  function inTextCitations(text) {
    const found = [];
    const s = String(text || '');
    const paren = /\(([^()]{2,400})\)/g;
    let m;
    while ((m = paren.exec(s))) {
      const inner = m[1];
      if (!new RegExp('(' + YEAR + ')').test(inner)) continue;
      inner.split(';').forEach((part) => {
        // read from the start of each citation (after "see", "e.g.," …): the key is its FIRST author word, the same
        // word a reference-list entry starts with — so group authors ("American Psychiatric Association") match too
        const re = new RegExp('^\\s*(?:(?:[Ss]ee also|[Ss]ee|[Ee]\\.g\\.,?|[Cc]f\\.|[Ii]\\.e\\.,?|[Aa]s cited in|[Ff]or example,?|[Ff]or a review,? see)\\s+)*(' + SURNAME + ')[^;()\\d]*?,?\\s*((?:' + YEAR + ')(?:\\s*,\\s*(?:' + YEAR + '))*)');
        const c = re.exec(part);
        if (!c || WORD_SKIP.test(c[1])) return;
        c[2].split(/\s*,\s*/).forEach((y) => found.push({ author: c[1], year: y, key: keyOf(c[1], y), raw: part.trim(), index: m.index }));
      });
    }
    const narrative = new RegExp('(' + SURNAME + ')(?:[\'’]s)?(?:\\s+et\\s+al\\.?|\\s+(?:and|&)\\s+' + SURNAME + ')?(?:[\'’]s)?\\s*\\(((?:' + YEAR + ')(?:\\s*,\\s*(?:' + YEAR + '))*)\\)', 'g');
    while ((m = narrative.exec(s))) {
      if (WORD_SKIP.test(m[1])) continue;
      m[2].split(/\s*,\s*/).forEach((y) => found.push({ author: m[1], year: y, key: keyOf(m[1], y), raw: m[0].trim(), index: m.index }));
    }
    return found;
  }
  T.inTextCitations = inTextCitations;

  // A reference-list entry: "Ben-Sasson, A., Hen, L., ... (2009). Title." → key ben-sasson|2009
  function referenceKey(entry) {
    const e = String(entry || '').trim();
    const a = new RegExp('^(' + SURNAME + ')').exec(e);
    const y = new RegExp('\\((' + YEAR + ')\\)|,\\s*(' + YEAR + ')[.,]|\\b((?:1[89]|20)\\d{2}[a-z]?)\\b').exec(e);
    if (!a || !y) return null;
    return { author: a[1], year: y[1] || y[2] || y[3], key: keyOf(a[1], y[1] || y[2] || y[3]), raw: e };
  }
  T.referenceKey = referenceKey;
  const isRefHeading = (t) => /^(references?|reference list|bibliography|works cited)$/i.test(String(t).replace(/[:.]$/, '').trim());

  // sections: [{ chapterKey, sectionIndex, label, html, isReferenceSection? }]; managerRefs: [{ author, year, raw }]
  // style: the project's reference style. Returns { supported, citations, missing, uncited, references }.
  function auditCitations(sections, managerRefs, style) {
    const numeric = /vancouver|ieee|numeric/i.test(String(style || ''));
    const refs = [], cites = [];
    (managerRefs || []).forEach((r) => { if (r && r.author && r.year) refs.push({ author: r.author, year: String(r.year), key: keyOf(r.author, r.year), raw: r.raw || (r.author + ' (' + r.year + ')'), source: 'Reference Manager' }); });
    (sections || []).forEach((sec) => {
      let inRefs = !!sec.isReferenceSection;
      blocksOf(sec.html).forEach((b) => {
        if (/^h/.test(b.tag)) { inRefs = !!sec.isReferenceSection || isRefHeading(b.text); return; }
        if (inRefs) { const k = referenceKey(b.text); if (k) refs.push(Object.assign(k, { source: sec.label, chapterKey: sec.chapterKey, sectionIndex: sec.sectionIndex })); return; }
        inTextCitations(b.text).forEach((c) => cites.push(Object.assign(c, { chapterKey: sec.chapterKey, sectionIndex: sec.sectionIndex, label: sec.label, context: b.text })));
      });
    });
    if (numeric) return { supported: false, citations: cites, missing: [], uncited: [], references: refs };
    const refKeys = new Set(refs.map((r) => r.key));
    // "Cochran" cited as 1977 but listed as 1977a (or the reverse) still counts as matched
    const loose = (k) => k.replace(/[a-z]$/, '');
    const refLoose = new Set(refs.map((r) => loose(r.key)));
    const citeKeys = new Set(cites.map((c) => c.key)), citeLoose = new Set(cites.map((c) => loose(c.key)));
    const seenMissing = new Set(), missing = [];
    cites.forEach((c) => { if (!refKeys.has(c.key) && !refLoose.has(loose(c.key)) && !seenMissing.has(c.key)) { seenMissing.add(c.key); missing.push(c); } });
    const seenRef = new Set(), uncited = [];
    refs.forEach((r) => { if (!citeKeys.has(r.key) && !citeLoose.has(loose(r.key)) && !seenRef.has(r.key)) { seenRef.add(r.key); uncited.push(r); } });
    return { supported: true, citations: cites, missing, uncited, references: refs };
  }
  T.auditCitations = auditCitations;

  // ------------------------------------------------------------------ project-wide search
  // sections: [{ chapterKey, sectionIndex, label, html }]; refs: [{ id, text }]. Returns up to `limit` hits with a snippet.
  function searchProject(sections, refs, query, limit) {
    const q = String(query || '').trim();
    if (q.length < 2) return [];
    limit = limit || 100;
    const needle = norm2(q), hits = [];
    (sections || []).forEach((sec) => {
      const text = clean(sec.html);
      const hay = norm2(text);
      let from = 0, idx, perSection = 0;
      while ((idx = hay.indexOf(needle, from)) >= 0 && hits.length < limit && perSection < 20) {
        const start = Math.max(0, idx - 70), end = Math.min(text.length, idx + q.length + 70);
        hits.push({ kind: 'section', chapterKey: sec.chapterKey, sectionIndex: sec.sectionIndex, label: sec.label,
          before: (start > 0 ? '…' : '') + text.slice(start, idx), match: text.slice(idx, idx + q.length), after: text.slice(idx + q.length, end) + (end < text.length ? '…' : ''),
          quote: text.slice(idx, Math.min(text.length, idx + Math.max(q.length, 40))) });
        from = idx + needle.length; perSection++;
      }
    });
    (refs || []).forEach((r) => { if (hits.length < limit && norm2(r.text).includes(needle)) hits.push({ kind: 'reference', id: r.id, label: 'Reference Manager', before: '', match: r.text, after: '' }); });
    return hits;
  }
  // case- and accent-insensitive, same length as the input (so match positions line up with the original text)
  function norm2(s) {
    return String(s || '').split('').map((ch) => { const n = ch.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); return n.length ? n[0] : ch; }).join('');
  }
  T.searchProject = searchProject;

  // ------------------------------------------------------------------ activity timeline
  // entries: [{ type, chapterKey, sectionIndex, summary, at }] (any order). Consecutive saves of the same section
  // within 45 minutes become one "edited" row, so autosave every few seconds doesn't flood the timeline.
  function groupActivity(entries) {
    const list = (entries || []).filter((e) => e && e.at).slice().sort((a, b) => b.at - a.at);
    const out = [];
    list.forEach((e) => {
      const last = out[out.length - 1];
      if (last && e.type === 'section_saved' && last.type === 'section_saved' && last.chapterKey === e.chapterKey && last.sectionIndex === e.sectionIndex && (last.firstAt - e.at) <= 45 * 60000) {
        last.count++; last.firstAt = e.at; return;
      }
      out.push(Object.assign({}, e, { count: 1, lastAt: e.at, firstAt: e.at }));
    });
    return out;
  }
  T.groupActivity = groupActivity;

  // ================================================================== PHASE 2
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  T.esc = esc;
  const sentenceCase = (s) => { s = String(s || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; };
  const endDot = (s) => { s = String(s || '').trim(); return !s ? s : /[.!?]$/.test(s) ? s : s + '.'; };
  // "a, b and c"
  function listJoin(items) {
    const a = (items || []).map((x) => String(x || '').trim()).filter(Boolean);
    return a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  }
  T.listJoin = listJoin;

  // ------------------------------------------------------------------ formatting profiles
  // Common layouts, not any one university's rules: the student checks their department's handbook.
  const FORMAT_PRESETS = {
    nigerian: { name: 'Nigerian university (common layout)', font: 'Times New Roman', size: 12, lineSpacing: 2, margins: { top: 2.54, bottom: 2.54, left: 3.81, right: 2.54 },
      align: 'justify', firstLineIndent: 0, chapterStyle: 'words', headingCase: 'upper', headingAlign: 'center', pageNumbers: 'bottom-center', pageFormat: 'n' },
    apa7: { name: 'APA 7 student paper', font: 'Times New Roman', size: 12, lineSpacing: 2, margins: { top: 2.54, bottom: 2.54, left: 2.54, right: 2.54 },
      align: 'left', firstLineIndent: 1.27, chapterStyle: 'title', headingCase: 'title', headingAlign: 'center', pageNumbers: 'top-right', pageFormat: 'n' },
    ukThesis: { name: 'UK thesis (common layout)', font: 'Arial', size: 12, lineSpacing: 1.5, margins: { top: 2.5, bottom: 2.5, left: 4, right: 2.5 },
      align: 'justify', firstLineIndent: 0, chapterStyle: 'numbers', headingCase: 'title', headingAlign: 'left', pageNumbers: 'bottom-center', pageFormat: 'n' },
    draft: { name: 'Compact draft', font: 'Times New Roman', size: 12, lineSpacing: 1.15, margins: { top: 2.5, bottom: 2.5, left: 2, right: 2 },
      align: 'left', firstLineIndent: 0, chapterStyle: 'title', headingCase: 'title', headingAlign: 'left', pageNumbers: 'bottom-center', pageFormat: 'of' },
  };
  T.FORMAT_PRESETS = FORMAT_PRESETS;
  T.FORMAT_FONTS = ['Times New Roman', 'Arial', 'Calibri', 'Cambria', 'Georgia', 'Garamond'];
  const clampNum = (v, lo, hi, d) => { const n = Number(v); return isFinite(n) && n >= lo && n <= hi ? n : d; };
  // Any stored profile (possibly partial or old) → a complete, safe one. Default: the compact draft (today's export).
  function normalizeFormat(p) {
    p = p || {};
    const base = FORMAT_PRESETS[p.preset] || FORMAT_PRESETS.draft;
    const m = p.margins || {};
    return {
      preset: FORMAT_PRESETS[p.preset] ? p.preset : (p.preset === 'custom' ? 'custom' : 'draft'),
      font: T.FORMAT_FONTS.indexOf(p.font) >= 0 ? p.font : base.font,
      size: clampNum(p.size, 10, 14, base.size),
      lineSpacing: [1, 1.15, 1.5, 2].indexOf(Number(p.lineSpacing)) >= 0 ? Number(p.lineSpacing) : base.lineSpacing,
      margins: { top: clampNum(m.top, 1, 5, base.margins.top), bottom: clampNum(m.bottom, 1, 5, base.margins.bottom), left: clampNum(m.left, 1, 5, base.margins.left), right: clampNum(m.right, 1, 5, base.margins.right) },
      align: p.align === 'justify' || p.align === 'left' ? p.align : base.align,
      firstLineIndent: clampNum(p.firstLineIndent, 0, 3, base.firstLineIndent),
      chapterStyle: ['words', 'numbers', 'title'].indexOf(p.chapterStyle) >= 0 ? p.chapterStyle : base.chapterStyle,
      headingCase: p.headingCase === 'upper' || p.headingCase === 'title' ? p.headingCase : base.headingCase,
      headingAlign: p.headingAlign === 'center' || p.headingAlign === 'left' ? p.headingAlign : base.headingAlign,
      pageNumbers: ['bottom-center', 'bottom-right', 'top-right'].indexOf(p.pageNumbers) >= 0 ? p.pageNumbers : base.pageNumbers,
      pageFormat: p.pageFormat === 'n' || p.pageFormat === 'of' ? p.pageFormat : base.pageFormat,
    };
  }
  T.normalizeFormat = normalizeFormat;
  T.formatFromPreset = (id) => normalizeFormat(Object.assign({}, FORMAT_PRESETS[id] || FORMAT_PRESETS.draft, { preset: id }));

  const NUM_WORDS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE'];
  // "Chapter 1: Introduction" → ["CHAPTER ONE", "INTRODUCTION"] (words) | ["CHAPTER 1", "INTRODUCTION"] (numbers) | ["Chapter 1: Introduction"] (title)
  function chapterHeading(title, profile) {
    const f = normalizeFormat(profile);
    const t = String(title || '').trim();
    const m = /^chapter\s+(\d+)\s*[:.\-–—]?\s*(.*)$/i.exec(t);
    const up = (s) => (f.headingCase === 'upper' ? s.toUpperCase() : s);
    if (!m || f.chapterStyle === 'title') return [up(t)];
    const n = Number(m[1]);
    const label = 'CHAPTER ' + (f.chapterStyle === 'words' && NUM_WORDS[n] ? NUM_WORDS[n] : n);
    return m[2] ? [label, up(m[2])] : [label];
  }
  T.chapterHeading = chapterHeading;

  // CSS for the print / PDF export.
  function formatCss(profile) {
    const f = normalizeFormat(profile);
    const fam = '"' + f.font + '", ' + (/Arial|Calibri/.test(f.font) ? 'Helvetica, sans-serif' : 'Georgia, serif');
    return '@page { size: A4; margin: ' + f.margins.top + 'cm ' + f.margins.right + 'cm ' + f.margins.bottom + 'cm ' + f.margins.left + 'cm; }\n' +
      'body { font-family: ' + fam + '; font-size: ' + f.size + 'pt; line-height: ' + (f.lineSpacing * 1.15).toFixed(2) + '; color: #111; }\n' +
      'p { text-align: ' + f.align + '; margin: 0 0 ' + (f.lineSpacing >= 2 ? '0' : '0.6em') + '; text-indent: ' + f.firstLineIndent + 'cm; }\n' +
      'h1 { text-align: center; font-size: ' + (f.size + 2) + 'pt; } h2, h3 { text-align: ' + f.headingAlign + '; font-size: ' + f.size + 'pt; }\n' +
      (f.headingCase === 'upper' ? 'h1, h2 { text-transform: uppercase; }\n' : '') +
      'h1, h2, h3 { color: #111; font-weight: bold; border: 0; }\n';
  }
  T.formatCss = formatCss;

  // Numbers for the Word (.docx) export: twips (1 cm = 567), half-points, 240ths of a line.
  function docxLayout(profile) {
    const f = normalizeFormat(profile);
    const cm = (v) => Math.round(v * 567);
    return { font: f.font, size: f.size * 2, line: Math.round(f.lineSpacing * 240), align: f.align, firstLine: cm(f.firstLineIndent),
      margins: { top: cm(f.margins.top), bottom: cm(f.margins.bottom), left: cm(f.margins.left), right: cm(f.margins.right) },
      headingUpper: f.headingCase === 'upper', headingCenter: f.headingAlign === 'center', pageNumbers: f.pageNumbers, pageFormat: f.pageFormat };
  }
  T.docxLayout = docxLayout;
  function formatSummary(profile) {
    const f = normalizeFormat(profile);
    return f.font + ' ' + f.size + ' pt · ' + (f.lineSpacing === 2 ? 'double' : f.lineSpacing === 1 ? 'single' : f.lineSpacing + '') + ' spacing · margins ' +
      [f.margins.top, f.margins.right, f.margins.bottom, f.margins.left].join(' / ') + ' cm · ' + (f.align === 'justify' ? 'justified' : 'left-aligned') +
      ' · page numbers ' + f.pageNumbers.replace('-', ' ');
  }
  T.formatSummary = formatSummary;

  // ------------------------------------------------------------------ questionnaire / instrument
  const SCALES = {
    agree5: { label: 'Agreement (5-point)', options: ['Strongly Agree', 'Agree', 'Undecided', 'Disagree', 'Strongly Disagree'], short: ['SA', 'A', 'U', 'D', 'SD'] },
    agree4: { label: 'Agreement (4-point, no neutral)', options: ['Strongly Agree', 'Agree', 'Disagree', 'Strongly Disagree'], short: ['SA', 'A', 'D', 'SD'] },
    freq5: { label: 'Frequency (5-point)', options: ['Always', 'Often', 'Sometimes', 'Rarely', 'Never'], short: ['Always', 'Often', 'Sometimes', 'Rarely', 'Never'] },
    sat5: { label: 'Satisfaction (5-point)', options: ['Very Satisfied', 'Satisfied', 'Neutral', 'Dissatisfied', 'Very Dissatisfied'], short: ['VS', 'S', 'N', 'D', 'VD'] },
    know3: { label: 'Knowledge (True / False / Not sure)', options: ['True', 'False', 'Not sure'], short: ['True', 'False', 'Not sure'] },
  };
  T.SCALES = SCALES;
  T.ITEM_TYPES = [['scale', 'Rating scale'], ['choice', 'Multiple choice (one answer)'], ['multi', 'Tick all that apply'], ['yesno', 'Yes / No'], ['number', 'Number'], ['open', 'Open answer']];

  function demographicsSection(isQual) {
    return { title: 'Section A: Socio-demographic Information', instructions: 'Please tick (✓) the option that applies to you or fill in the blank space.', scale: '', items: [
      { text: 'Age (in years)', type: 'number' },
      { text: 'Sex', type: 'choice', options: ['Male', 'Female'] },
      { text: 'Highest level of education', type: 'choice', options: ['No formal education', 'Primary', 'Secondary', 'Tertiary'] },
      { text: 'Occupation', type: 'open' },
    ].concat(isQual ? [] : [{ text: 'Marital status', type: 'choice', options: ['Single', 'Married', 'Divorced', 'Widowed'] }]) };
  }
  T.demographicsSection = demographicsSection;

  function newInstrument(project) {
    const title = (project && project.title) || 'the study';
    return { title: 'Questionnaire on ' + title, intro: 'Dear Respondent,\n\nI am a student carrying out a research study titled "' + title + '". Please answer the questions below as honestly as you can. Your responses will be kept confidential and used for research purposes only. Participation is voluntary, and you may stop at any time.\n\nThank you for your time.',
      sections: [demographicsSection(project && project.approach === 'qualitative')] };
  }
  T.newInstrument = newInstrument;

  const box = '☐';
  // The questionnaire as document HTML (Likert sections become a tick table, the usual layout).
  function instrumentHtml(inst) {
    inst = inst || {};
    let n = 0;
    let h = '<h2>' + esc(inst.title || 'Questionnaire') + '</h2>';
    String(inst.intro || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).forEach((p) => { h += '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>'; });
    (inst.sections || []).forEach((sec) => {
      h += '<h3>' + esc(sec.title || 'Section') + '</h3>';
      if (sec.instructions) h += '<p><em>' + esc(sec.instructions) + '</em></p>';
      const items = sec.items || [];
      const scale = SCALES[sec.scale];
      const scaled = items.filter((it) => it.type === 'scale');
      if (scale && scaled.length) {
        h += '<p><em>Key: ' + scale.short.map((s, i) => esc(s) + ' = ' + esc(scale.options[i])).filter((x, i) => scale.short[i] !== scale.options[i]).join('; ') + '</em></p>';
        h += '<table><tr><th>S/N</th><th>Statement</th>' + scale.short.map((s) => '<th>' + esc(s) + '</th>').join('') + '</tr>' +
          scaled.map((it) => '<tr><td>' + (++n) + '</td><td>' + esc(it.text) + '</td>' + scale.short.map(() => '<td></td>').join('') + '</tr>').join('') + '</table>';
      }
      items.filter((it) => it.type !== 'scale' || !scale).forEach((it) => {
        const opts = it.type === 'yesno' ? ['Yes', 'No'] : it.type === 'scale' ? (SCALES.agree5.options) : (it.options || []);
        h += '<p>' + (++n) + '. ' + esc(it.text) + (it.type === 'multi' ? ' <em>(tick all that apply)</em>' : '') + '</p>';
        if (it.type === 'open') h += '<p>.......................................................................................................</p>';
        else if (it.type === 'number') h += '<p>..................</p>';
        else h += '<p>' + opts.map((o) => box + ' ' + esc(o)).join('&nbsp;&nbsp;&nbsp; ') + '</p>';
      });
    });
    return h;
  }
  T.instrumentHtml = instrumentHtml;

  function instrumentStats(inst) {
    const out = { sections: 0, items: 0, scaleItems: 0 };
    ((inst && inst.sections) || []).forEach((s) => { out.sections++; (s.items || []).forEach((it) => { out.items++; if (it.type === 'scale' && SCALES[s.scale]) out.scaleItems++; }); });
    return out;
  }
  T.instrumentStats = instrumentStats;

  // The "Validity and Reliability of the Instrument" paragraph. opts: { experts, pilotN, alpha }
  function instrumentParagraph(inst, opts) {
    opts = opts || {};
    const st = instrumentStats(inst);
    const secs = ((inst && inst.sections) || []).map((s) => String(s.title || '').replace(/^section\s+[a-z0-9]+\s*[:.\-–]\s*/i, '').trim().toLowerCase()).filter(Boolean);
    const scales = [...new Set(((inst && inst.sections) || []).map((s) => SCALES[s.scale] && s.items.some((i) => i.type === 'scale') ? SCALES[s.scale].options.length + '-point ' + SCALES[s.scale].label.replace(/\s*\(.*$/, '').toLowerCase() + ' scale' : '').filter(Boolean))];
    const experts = Number(opts.experts) || 0, pilot = Number(opts.pilotN) || 0, alpha = opts.alpha === '' || opts.alpha == null ? NaN : Number(opts.alpha);
    let p = 'The instrument for data collection was a self-structured questionnaire of ' + st.items + ' item' + (st.items === 1 ? '' : 's') + ' in ' + st.sections + ' section' + (st.sections === 1 ? '' : 's') +
      (secs.length ? ' (' + listJoin(secs) + ')' : '') + '.';
    if (scales.length) p += ' Responses to the rating items were recorded on a ' + listJoin(scales) + '.';
    p += ' The face and content validity of the instrument were established by ' + (experts ? experts + ' experts' : 'experts') + ' in the field, who reviewed the items for clarity, relevance and coverage of the study objectives; their corrections were effected before the final draft.';
    if (pilot) p += ' A pilot study was conducted on ' + pilot + ' respondents who were not part of the main study, to test the reliability of the instrument.';
    else p += ' A pilot study on respondents who are not part of the main study will be used to test the reliability of the instrument.';
    if (isFinite(alpha) && alpha > 0 && alpha <= 1) p += " Internal consistency was assessed with Cronbach's alpha, which gave a coefficient of " + alpha.toFixed(2) + (alpha >= 0.7 ? ', indicating that the instrument was reliable (α ≥ 0.70; Nunnally and Bernstein, 1994).' : '. This is below the commonly accepted value of 0.70 (Nunnally and Bernstein, 1994), so the items should be reviewed before the main study.');
    else if (st.scaleItems) p += " Internal consistency will be assessed with Cronbach's alpha, with a coefficient of 0.70 or above taken as acceptable (Nunnally and Bernstein, 1994).";
    return p;
  }
  T.instrumentParagraph = instrumentParagraph;

  // ------------------------------------------------------------------ literature matrix
  T.MATRIX_FIELDS = [['author', 'Author(s)'], ['year', 'Year'], ['title', 'Title'], ['design', 'Design'], ['population', 'Population / sample'], ['setting', 'Setting / country'],
    ['findings', 'Key findings'], ['limitations', 'Limitations'], ['gap', 'Gap / relevance to this study']];
  T.DESIGNS = ['Randomised controlled trial', 'Quasi-experimental', 'Cohort', 'Case-control', 'Cross-sectional survey', 'Descriptive', 'Qualitative', 'Mixed methods', 'Systematic review', 'Case study', 'Other'];
  // Groups a free-text design into one of a few families, for the summary.
  function designFamily(d) {
    const s = String(d || '').toLowerCase();
    if (!s.trim()) return 'Not recorded';
    if (/systematic|meta-?analys|scoping|review/.test(s)) return 'Reviews';
    if (/random|rct|trial/.test(s) && !/non-?random/.test(s)) return 'Randomised trials';
    if (/quasi|pre-?test|post-?test|non-?random|experiment/.test(s)) return 'Quasi-experimental';
    if (/cohort|longitudinal|case-?control|prospective|retrospective/.test(s)) return 'Cohort / case-control';
    if (/qualitative|interview|focus group|phenomenolog|grounded|ethnograph|thematic/.test(s)) return 'Qualitative';
    if (/mixed/.test(s)) return 'Mixed methods';
    if (/case (study|report|series)/.test(s)) return 'Case studies';
    if (/cross-?sectional|survey|descriptive|correlational/.test(s)) return 'Cross-sectional / descriptive';
    return 'Other';
  }
  T.designFamily = designFamily;

  function matrixSummary(rows, nowYear) {
    rows = (rows || []).filter((r) => r && (r.author || r.title));
    const now = nowYear || new Date().getFullYear();
    const byDesign = {};
    let recent = 0, old = 0, noYear = 0;
    const incomplete = [];
    rows.forEach((r, i) => {
      const fam = designFamily(r.design); byDesign[fam] = (byDesign[fam] || 0) + 1;
      const y = parseInt(r.year, 10);
      if (!y) noYear++; else if (now - y <= 5) recent++; else if (now - y > 10) old++;
      const missing = ['design', 'population', 'findings'].filter((k) => !String(r[k] || '').trim());
      if (missing.length) incomplete.push({ index: i, missing });
    });
    const notes = [];
    if (rows.length && recent / rows.length < 0.5) notes.push('Fewer than half of the studies are from the last 5 years. Examiners often ask for recent evidence.');
    if (old) notes.push(old + ' stud' + (old === 1 ? 'y is' : 'ies are') + ' more than 10 years old. Keep them only if they are landmark studies.');
    if (rows.length >= 4 && !byDesign['Randomised trials'] && !byDesign['Reviews']) notes.push('No randomised trials or reviews yet. Look for the strongest evidence on your topic.');
    if (incomplete.length) notes.push(incomplete.length + ' row' + (incomplete.length === 1 ? ' is' : 's are') + ' missing the design, population or findings.');
    return { total: rows.length, byDesign, recent, old, noYear, incomplete, notes };
  }
  T.matrixSummary = matrixSummary;

  // "Summary of empirical studies" table for Chapter 2.
  function matrixHtml(rows, cols) {
    cols = cols || ['author', 'design', 'population', 'findings', 'gap'];
    const head = { author: 'Author (Year)', design: 'Design', population: 'Population / sample', setting: 'Setting', findings: 'Key findings', limitations: 'Limitations', gap: 'Gap / relevance', title: 'Title' };
    const list = (rows || []).filter((r) => r && (r.author || r.title));
    return '<p><strong>Table 2.1: Summary of Empirical Studies</strong></p><table><tr><th>S/N</th>' + cols.map((c) => '<th>' + head[c] + '</th>').join('') + '</tr>' +
      list.map((r, i) => '<tr><td>' + (i + 1) + '</td>' + cols.map((c) => '<td>' + esc(c === 'author' ? (r.author || '') + (r.year ? ' (' + r.year + ')' : '') : r[c] || '') + '</td>').join('') + '</tr>').join('') + '</table>';
  }
  T.matrixHtml = matrixHtml;

  // A matrix row from a Reference Manager entry.
  T.matrixRowFromReference = (r) => {
    const a = (r && r.authors) || [];
    const author = !a.length ? '' : a.length === 1 ? a[0].family : a.length === 2 ? a[0].family + ' and ' + a[1].family : a[0].family + ' et al.';
    return { author, year: String((r && r.year) || ''), title: (r && r.title) || '', design: '', population: '', setting: '', findings: '', limitations: '', gap: '' };
  };

  // ------------------------------------------------------------------ methodology builder
  T.SAMPLING = {
    simpleRandom: { label: 'Simple random sampling', probability: true, text: 'Simple random sampling was used, so that every member of the population had an equal chance of being selected. A list of eligible participants served as the sampling frame, and participants were selected by balloting (or a table of random numbers) until the required sample size was reached.' },
    stratified: { label: 'Stratified random sampling', probability: true, text: 'Stratified random sampling was used. The population was divided into strata, and participants were selected randomly from each stratum in proportion to its size, so that each subgroup was fairly represented.' },
    systematic: { label: 'Systematic sampling', probability: true, text: 'Systematic sampling was used: after a random start, every kth person on the sampling frame was selected (k = population size ÷ sample size) until the sample size was reached.' },
    multistage: { label: 'Multistage sampling', probability: true, text: 'A multistage sampling technique was used, combining the selection of settings or clusters at the first stage with the random selection of participants within them at the final stage.' },
    purposive: { label: 'Purposive sampling', probability: false, text: 'Purposive sampling was used to select participants who met the inclusion criteria and could provide the information the study required.' },
    convenience: { label: 'Convenience sampling', probability: false, text: 'Convenience sampling was used: eligible participants who were available and willing during the period of data collection were recruited until the sample size was reached.' },
    consecutive: { label: 'Consecutive sampling', probability: false, text: 'Consecutive sampling was used: every eligible patient who attended the setting during the data-collection period was invited to take part until the sample size was reached.' },
    snowball: { label: 'Snowball sampling', probability: false, text: 'Snowball sampling was used: initial participants who met the inclusion criteria helped to identify other eligible participants.' },
    census: { label: 'Total enumeration (census)', probability: false, text: 'Total enumeration was used: because the population was small, every eligible member of the population was included in the study.' },
  };
  T.STUDY_DESIGNS = {
    crossSectional: { label: 'Descriptive cross-sectional survey', text: 'This study adopted a descriptive cross-sectional survey design. This design was considered appropriate because it allows data to be collected from a sample at one point in time to describe the variables of interest and the relationships between them.' },
    correlational: { label: 'Correlational design', text: 'This study adopted a correlational research design, which examines the relationship between variables as they naturally occur without manipulating them.' },
    quasiExperimental: { label: 'Quasi-experimental (pre-test / post-test)', text: 'This study adopted a quasi-experimental design with a pre-test and post-test. Participants were assessed before and after the intervention, so that changes in the outcome could be measured; random allocation was not used.' },
    rct: { label: 'Randomised controlled trial', text: 'This study adopted a randomised controlled trial design. Participants were randomly allocated to the intervention or control group, so that differences in outcome could be attributed to the intervention.' },
    caseControl: { label: 'Case-control design', text: 'This study adopted a case-control design, comparing participants with the outcome of interest (cases) with similar participants without it (controls) to identify associated factors.' },
    retrospective: { label: 'Retrospective record review', text: 'This study adopted a retrospective design, in which existing records were reviewed to obtain the data required.' },
    phenomenology: { label: 'Qualitative (phenomenological)', text: 'This study adopted a qualitative phenomenological design, which seeks to understand the lived experiences of participants and the meanings they attach to them.' },
    caseStudy: { label: 'Qualitative case study', text: 'This study adopted a qualitative case study design, which allows an in-depth exploration of a single case within its real-life context.' },
  };

  // answers: { design, setting, population, populationSize, sampleSize, sampleNote, sampling, inclusion[], exclusion[],
  //            instrument, instrumentNote, procedure, duration, ethicsBody, analysis }
  // → [{ key, label, prefer (RegExp source), text }] — one block per usual Chapter 3 section.
  function methodologyBlocks(a) {
    a = a || {};
    const out = [];
    const add = (key, label, prefer, text) => { if (String(text || '').trim()) out.push({ key, label, prefer, text: text.trim() }); };
    const design = T.STUDY_DESIGNS[a.design];
    add('design', 'Research Design', 'design', design ? design.text : '');
    add('setting', 'Area / Setting of Study', 'setting|area|location', a.setting ? 'The study was carried out at ' + endDot(a.setting.trim()) : '');
    const pop = String(a.population || '').trim();
    add('population', 'Population of Study', 'population', pop ? 'The population of the study comprised ' + pop.replace(/\.$/, '') + (Number(a.populationSize) > 0 ? ', numbering about ' + Number(a.populationSize) + ' at the time of the study' : '') + '.' : '');
    const samp = T.SAMPLING[a.sampling];
    let sTxt = '';
    if (Number(a.sampleSize) > 0) sTxt += 'A sample of ' + Number(a.sampleSize) + ' participants was used' + (a.sampleNote ? ', ' + String(a.sampleNote).trim().replace(/^[,;]\s*/, '').replace(/\.$/, '') : '') + '. ';
    if (samp) sTxt += samp.text + ' ';
    const inc = (a.inclusion || []).map((x) => String(x).trim()).filter(Boolean), exc = (a.exclusion || []).map((x) => String(x).trim()).filter(Boolean);
    if (inc.length) sTxt += 'Participants were included if they ' + listJoin(inc.map((x) => x.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase()))) + '. ';
    if (exc.length) sTxt += 'Those who ' + listJoin(exc.map((x) => x.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase()))) + ' were excluded.';
    add('sample', 'Sample and Sampling Technique', 'sampl', sTxt);
    add('instrument', 'Instrument for Data Collection', 'instrument', a.instrument ? 'The instrument used for data collection was ' + endDot(String(a.instrument).trim()) + (a.instrumentNote ? ' ' + endDot(sentenceCase(a.instrumentNote)) : '') : '');
    let proc = '';
    if (a.procedure) proc = endDot(sentenceCase(a.procedure));
    else if (a.instrument || samp) proc = 'After ethical approval and permission from the authorities of the study setting, the researcher explained the purpose of the study to each participant and obtained informed consent. The instrument was then administered' + (a.duration ? ' over a period of ' + String(a.duration).trim().replace(/\.$/, '') : '') + ', and completed copies were checked for completeness before analysis.';
    add('procedure', 'Procedure for Data Collection', 'procedure|collection', proc);
    add('ethics', 'Ethical Considerations', 'ethic', 'Ethical approval was obtained from ' + (a.ethicsBody ? String(a.ethicsBody).trim().replace(/\.$/, '') : 'the relevant research ethics committee') + ' before the study began. Written informed consent was obtained from every participant after the purpose, procedures, risks and benefits of the study had been explained. Participation was voluntary, participants were free to withdraw at any time without any consequence, and all information was kept confidential and used only for this research.');
    add('analysis', 'Method of Data Analysis', 'analysis', a.analysis || '');
    return out;
  }
  T.methodologyBlocks = methodologyBlocks;

  // ------------------------------------------------------------------ defense preparation
  // A stable id from the question's text (32-bit FNV-1a), so saved practice answers survive edits elsewhere.
  function questionId(text) {
    let h = 0x811c9dc5;
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return 'q' + h.toString(36);
  }
  T.questionId = questionId;
  // A question bank built from the project itself (no AI): the questions examiners almost always ask.
  function defenseQuestions(project) {
    const p = project || {};
    const rs = p.researchSetup || {};
    const qual = p.approach === 'qualitative';
    const q = [];
    const add = (category, text, tip) => q.push({ id: questionId(text), category, q: text, tip });
    const title = p.title || 'your study';
    add('Overview', 'Briefly tell us about your study: what you did, why, and what you found.', 'Two minutes: problem, aim, method, the main finding, and one implication. Practise it until it is smooth.');
    add('Overview', 'Why did you choose this topic, "' + title + '"?', 'Link it to a real gap: something you saw in practice, plus what the literature has not answered.');
    add('Background', 'What exactly is the problem your study addresses?','State the gap in one sentence, then the consequence of leaving it unanswered.');
    add('Background', 'What is the significance of this study, and who benefits from it?', 'Name the specific people: patients, therapists, policy makers, future researchers.');
    (rs.objectives || []).filter(Boolean).slice(0, 4).forEach((o, i) => add('Objectives', 'How did you achieve objective ' + (i + 1) + ': "' + String(o).trim().replace(/\.$/, '') + '"?', 'Point to the exact instrument items or analysis that answered it, and the result.'));
    add('Literature', 'Which theory or framework underpins your study, and how did it guide it?', 'Name the model, its key concepts, and where it shaped your questions or analysis.');
    add('Literature', 'Which recent studies are closest to yours, and how is yours different?', 'Have two or three studies ready by author and year, with what each did and what you added.');
    add('Methodology', 'Why did you choose this research design over the alternatives?', 'Give the reason the design fits your question, and one limitation you accepted.');
    add('Methodology', qual ? 'How did you decide how many participants to interview?' : 'How did you arrive at your sample size?', qual ? 'Explain data saturation, and when you reached it.' : 'Name the formula (e.g. Yamane, Cochran, or a power calculation), the values used, and the drop-out allowance.');
    add('Methodology', 'Why did you use this sampling technique, and how might it bias your results?', 'Be honest about the limitation and how you reduced it.');
    add('Methodology', qual ? 'How did you ensure the trustworthiness of your findings?' : 'How did you ensure the validity and reliability of your instrument?', qual ? 'Credibility, transferability, dependability and confirmability, with what you actually did for each.' : 'Expert review for content validity; a pilot study and the Cronbach\'s alpha value for reliability.');
    add('Methodology', 'What ethical issues did you consider, and how did you handle them?', 'Approval body, informed consent, confidentiality, the right to withdraw.');
    if (!qual) add('Analysis', 'Why did you use those statistical tests? Did your data meet their assumptions?', 'Name each test, the type of data it suits, and how you checked normality.');
    else add('Analysis', 'Walk us through how you analysed your interviews.', 'The steps of thematic analysis, with one example of a code becoming a theme.');
    (rs.hypotheses || []).filter(Boolean).slice(0, 2).forEach((h, i) => add('Results', 'Was hypothesis ' + (i + 1) + ' supported? What does the result mean?', 'Give the test result (statistic and p-value) and say it in plain words.'));
    add('Results', 'What is your most important finding, and was it what you expected?', 'One finding, its size, and how it compares with previous studies.');
    add('Discussion', 'How do your findings compare with previous studies? Why might they differ?', 'Agree / disagree with named studies; explain differences by setting, sample or method.');
    add('Discussion', 'What are the limitations of your study?', 'Two or three real limitations and how they affect the conclusions. Never say "none".');
    add('Discussion', 'What are the implications for occupational therapy (or your profession) in practice?', 'One concrete change a clinician could make on Monday because of your results.');
    add('Discussion', 'If you were to repeat this study, what would you do differently?', 'Show you understand the weaknesses: a bigger or random sample, a control group, a validated tool.');
    add('Discussion', 'What do you recommend for future research?', 'Specific next studies, not "more research is needed".');
    return q;
  }
  T.defenseQuestions = defenseQuestions;

  // Practice scores (0–10) → readiness per category and overall.
  function defenseReadiness(questions, answers) {
    answers = answers || {};
    const cats = {};
    let sum = 0, n = 0;
    (questions || []).forEach((q) => {
      const a = answers[q.id];
      const c = cats[q.category] || (cats[q.category] = { total: 0, answered: 0, sum: 0 });
      c.total++;
      if (a && isFinite(Number(a.score))) { c.answered++; c.sum += Number(a.score); sum += Number(a.score); n++; }
    });
    Object.keys(cats).forEach((k) => { const c = cats[k]; c.avg = c.answered ? Math.round((c.sum / c.answered) * 10) / 10 : null; });
    const pct = questions && questions.length ? Math.round((sum / (questions.length * 10)) * 100) : 0;
    return { categories: cats, answered: n, total: (questions || []).length, average: n ? Math.round((sum / n) * 10) / 10 : null, readiness: pct };
  }
  T.defenseReadiness = defenseReadiness;

  if (typeof window !== 'undefined') window.RehablixProjectTools = T;
  if (typeof module !== 'undefined' && module.exports) module.exports = T;
})();
