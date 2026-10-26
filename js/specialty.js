// js/specialty.js — the user's area of specialization (2026-10-26, the owner's wish: "the whole app should always know
// the individual's specialization and preset the forms that need it"). Asked once after sign-in (and changed in
// Settings); saved at users/{uid}/specialty = { key, student, other, updatedAt }. Every tool's profession field is
// preset from it, and Lixa (chat, agent, Live) and the whiteboard tailor what they say to it.
// Android: data/Specialty.kt, the same list and the same words.
(function () {
  'use strict';
  if (window.RehablixSpecialty) return;

  // key, the person, the field, and the value the Presentation, Audio and Smart EMR (patient's discipline) fields use for it
  const LIST = [
    { key: 'physiotherapy', role: 'physiotherapist', field: 'physiotherapy', presentation: 'Physiotherapist', audio: 'physiotherapist', emr: 'Physiotherapy' },
    { key: 'occupational_therapy', role: 'occupational therapist', field: 'occupational therapy', presentation: 'Occupational Therapist', audio: 'occupational_therapist', emr: 'Occupational Therapy' },
    { key: 'speech_language', role: 'speech and language therapist', field: 'speech and language therapy', presentation: 'Speech Therapist', audio: 'speech_language_therapist', emr: 'Speech-Language Therapy' },
    { key: 'prosthetics_orthotics', role: 'prosthetist and orthotist', field: 'prosthetics and orthotics', presentation: 'Prosthetist & Orthotist', audio: 'general_clinician', emr: 'Prosthetics/Orthotics' },
    { key: 'rehab_medicine', role: 'rehabilitation physician', field: 'rehabilitation medicine', presentation: 'Doctor', audio: 'general_clinician', emr: 'Consultant' },
    { key: 'rehab_nursing', role: 'rehabilitation nurse', field: 'rehabilitation nursing', presentation: 'Nurse', audio: 'rehab_nurse', emr: 'Nurse' },
    { key: 'psychology', role: 'psychologist', field: 'psychology', presentation: 'Psychologist', audio: 'psychologist', emr: 'Clinical Psychology' },
    { key: 'psychiatry', role: 'psychiatrist', field: 'psychiatry', presentation: 'Doctor', audio: 'psychiatrist', emr: 'Consultant' },
    { key: 'audiology', role: 'audiologist', field: 'audiology', presentation: 'Audiologist', audio: 'general_clinician', emr: '' },
    { key: 'dietetics', role: 'dietitian', field: 'nutrition and dietetics', presentation: 'Dietitian', audio: 'general_clinician', emr: 'Dietetics/Nutrition' },
    { key: 'social_work', role: 'social worker', field: 'social work', presentation: 'Social Worker', audio: 'general_clinician', emr: 'Social Work' },
    { key: 'exercise_physiology', role: 'exercise physiologist', field: 'exercise physiology', presentation: 'Exercise Physiologist', audio: 'general_clinician', emr: '' },
    { key: 'other', role: 'rehabilitation professional', field: 'rehabilitation', presentation: '', audio: 'general_clinician', emr: '' },
  ];
  const CACHE = 'rehab-specialty';
  const ASKED = 'rehab-specialty-asked';          // (this browser session: "Later" was chosen)
  // (each word capitalised, except "and", "of", "the" inside the name)
  const cap = s => String(s || '').split(' ').map((w, i) => (i > 0 && /^(and|of|the)$/i.test(w) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
  let mine = null, mineFor = null;

  function user() { try { return firebase.auth().currentUser; } catch (e) { return null; } }
  function entry(key) { return LIST.find(e => e.key === key) || null; }
  function clean(v) {
    if (!v || typeof v !== 'object' || !entry(v.key)) return null;
    return { key: v.key, student: !!v.student, other: String(v.other || '').replace(/\s+/g, ' ').trim().slice(0, 60) };
  }
  function changed() { try { document.dispatchEvent(new CustomEvent('rehablix:specialty', { detail: mine })); } catch (e) { /* old browser */ } }

  /** The signed-in user's specialty ({key, student, other}) or null (not set, or nobody signed in). */
  function current() {
    const u = user();
    if (!u) return null;
    if (mineFor === u.uid) return mine;
    try { const c = JSON.parse(localStorage.getItem(CACHE) || 'null'); if (c && c.uid === u.uid) { mine = clean(c.value); mineFor = u.uid; return mine; } } catch (e) { /* storage blocked */ }
    return null;
  }
  async function load() {
    const u = user();
    if (!u) { mine = null; mineFor = null; return null; }
    try { mine = clean((await firebase.database().ref('users/' + u.uid + '/specialty').once('value')).val()); } catch (e) { return current(); }
    mineFor = u.uid;
    try { localStorage.setItem(CACHE, JSON.stringify({ uid: u.uid, value: mine })); } catch (e) { /* storage blocked */ }
    changed();
    return mine;
  }
  async function save(value) {
    const u = user(), v = clean(value);
    if (!u || !v) throw new Error('Choose your area of specialization.');
    await firebase.database().ref('users/' + u.uid + '/specialty').set(Object.assign({}, v, { updatedAt: Date.now() }));
    mine = v; mineFor = u.uid;
    try { localStorage.setItem(CACHE, JSON.stringify({ uid: u.uid, value: v })); } catch (e) { /* storage blocked */ }
    changed();
    return v;
  }

  /** "a physiotherapist", "an occupational therapy student", "a hand therapist" ("" when not set). */
  function describe(v) {
    v = v === undefined ? current() : v;
    const e = v && entry(v.key);
    if (!e) return '';
    const what = v.student ? (v.key === 'other' && v.other ? v.other : e.field) + ' student' : (v.key === 'other' && v.other ? v.other : e.role);
    return (/^[aeiou]/i.test(what) ? 'an ' : 'a ') + what;
  }
  /** The label shown in lists: "Physiotherapist", "Occupational therapy student". */
  function label(v) {
    v = v === undefined ? current() : v;
    const d = describe(v);
    return d ? cap(d.replace(/^an? /, '')) : '';
  }
  /** The line every Lixa prompt carries (blank when not set). Android: Specialty.promptLine, the same text. */
  function promptLine(v) {
    const d = describe(v);
    if (!d) return '';
    const student = !!(v === undefined ? current() : v).student;
    return '\n\nThe user is ' + d + ' (their area of specialization). Tailor every answer to it: use its terms, its scope of practice, its assessments and interventions, and examples from its everyday work' +
      (student ? ', pitched for a student (clear explanations, what exams and placements expect)' : '') +
      '. When another member of the rehabilitation team is the right person for something, say so. Answer questions outside the field accurately too.';
  }
  /** What a tool's profession field should hold for the user ([tool]: 'presentation' | 'audio' | 'emr'). */
  function presetFor(tool) {
    const v = current(), e = v && entry(v.key);
    if (!e) return '';
    if (tool === 'audio') return e.audio;
    if (tool === 'emr') return e.emr;
    if (v.key === 'other') return v.other ? cap(v.other) : '';
    return e.presentation;
  }
  /**
   * Presets a <select> from the specialty when it holds nothing yet ([force]: whatever it holds). An option the select
   * lacks (e.g. "Audiologist") is added, except in Smart EMR (a patient's discipline stays one of its own).
   */
  function preset(select, tool, force) {
    if (!select) return;
    const want = presetFor(tool);
    if (!want || (!force && select.value && tool !== 'audio')) return;
    if (!Array.from(select.options).some(o => o.value === want)) {
      if (tool === 'emr') return;
      const o = document.createElement('option'); o.value = want; o.textContent = want; select.appendChild(o);
    }
    select.value = want;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ---- asking (once after sign-in; Settings changes it)
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function ask(opts) {
    const o = opts || {};
    if (document.getElementById('rxSpecialty')) return;
    const now = current() || { key: '', student: false, other: '' };
    const box = document.createElement('div');
    box.id = 'rxSpecialty';
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'rxSpecialtyTitle');
    box.style.cssText = 'position:fixed;inset:0;z-index:10060;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.55)';
    box.innerHTML =
      '<div style="width:min(460px,100%);max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;background:var(--surface,#fff);color:var(--text-primary,#1f2933);border:1px solid var(--border-light,#e3e6ea);border-radius:18px;padding:20px;box-shadow:0 20px 50px rgba(15,23,42,.3)">' +
      '<h2 id="rxSpecialtyTitle" style="margin:0 0 4px;font-size:1.15rem">What is your area of specialization?</h2>' +
      '<p style="margin:0 0 14px;font-size:.86rem;color:var(--text-secondary,#6b7280);line-height:1.45">Lixa and every tool use it: forms come filled in, and answers, examples and lessons are tailored to your field. You can change it any time in Settings.</p>' +
      '<div role="radiogroup" aria-label="Area of specialization" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">' +
      LIST.map(e => '<label style="display:flex;align-items:center;gap:8px;padding:9px 11px;border:1px solid var(--border-light,#e3e6ea);border-radius:12px;cursor:pointer;font-size:.9rem"><input type="radio" name="rxSpec" value="' + e.key + '"' + (now.key === e.key ? ' checked' : '') + '> ' + esc(e.key === 'other' ? 'Other' : cap(e.role)) + '</label>').join('') +
      '</div>' +
      '<input id="rxSpecOther" type="text" maxlength="60" placeholder="Your specialization (e.g. hand therapist)" value="' + esc(now.other) + '" style="display:' + (now.key === 'other' ? 'block' : 'none') + ';width:100%;box-sizing:border-box;margin-top:10px;padding:10px 12px;border:1px solid var(--border-light,#e3e6ea);border-radius:12px;background:var(--bg-page,#fff);color:inherit;font:inherit">' +
      '<label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:.9rem;cursor:pointer"><input id="rxSpecStudent" type="checkbox"' + (now.student ? ' checked' : '') + '> I am a student in this field</label>' +
      '<p id="rxSpecErr" style="display:none;margin:10px 0 0;color:#dc2626;font-size:.85rem"></p>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">' +
      '<button type="button" data-a="later" style="padding:9px 16px;border-radius:12px;border:1px solid var(--border-light,#e3e6ea);background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer">' + (o.fromSettings ? 'Cancel' : 'Later') + '</button>' +
      '<button type="button" data-a="save" style="padding:9px 18px;border-radius:12px;border:0;background:var(--accent,#009688);color:#fff;font:inherit;font-weight:700;cursor:pointer">Save</button></div></div>';
    document.body.appendChild(box);
    const $ = s => box.querySelector(s);
    const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
    const later = () => { if (!o.fromSettings) { try { sessionStorage.setItem(ASKED, '1'); } catch (e) { /* storage blocked */ } } close(); };
    const onKey = e => { if (e.key === 'Escape') later(); };
    document.addEventListener('keydown', onKey);
    box.addEventListener('change', e => { if (e.target.name === 'rxSpec') $('#rxSpecOther').style.display = e.target.value === 'other' ? 'block' : 'none'; });
    box.addEventListener('click', async e => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'later') { later(); return; }
      const picked = box.querySelector('input[name="rxSpec"]:checked');
      const err = $('#rxSpecErr');
      const v = { key: picked ? picked.value : '', student: $('#rxSpecStudent').checked, other: $('#rxSpecOther').value };
      if (!v.key) { err.textContent = 'Choose your area of specialization.'; err.style.display = 'block'; return; }
      if (v.key === 'other' && !v.other.trim()) { err.textContent = 'Write your specialization.'; err.style.display = 'block'; return; }
      b.disabled = true;
      try { await save(v); close(); if (typeof window.showToast === 'function') window.showToast('Saved: ' + label(), 'success'); }
      catch (x) { err.textContent = (x && x.message) || 'It could not be saved. Please try again.'; err.style.display = 'block'; b.disabled = false; }
    });
    const first = box.querySelector('input[name="rxSpec"]:checked') || box.querySelector('input[name="rxSpec"]');
    if (first) first.focus();
  }

  // ---- Settings > My Specialization (view-templates.js): what it is, and Change
  function paintSettings() {
    const el = document.getElementById('specSettingsLabel');
    if (el) el.textContent = label() || (user() ? 'Not set yet' : 'Log in to set it');
  }
  document.addEventListener('click', e => {
    if (!e.target.closest || !e.target.closest('#specSettingsBtn')) return;
    if (!user()) { if (typeof window.showToast === 'function') window.showToast('Log in to set your area of specialization.', 'info'); return; }
    ask({ fromSettings: true });
  });
  document.addEventListener('rehablix:specialty', paintSettings);
  document.addEventListener('rehablix:routechange', () => setTimeout(paintSettings, 0));

  // once after sign-in: read it, and ask when it was never set (not again this session after "Later")
  function start() {
    if (!window.firebase || !firebase.auth) { setTimeout(start, 400); return; }
    firebase.auth().onAuthStateChanged(async u => {
      if (!u) { mine = null; mineFor = null; changed(); return; }
      const v = await load();
      let later = false;
      try { later = sessionStorage.getItem(ASKED) === '1'; } catch (e) { /* storage blocked */ }
      if (!v && !later) setTimeout(() => { if (user() && !current()) ask(); }, 1500);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.RehablixSpecialty = { LIST, current, load, save, describe, label, promptLine, presetFor, preset, ask };
})();
