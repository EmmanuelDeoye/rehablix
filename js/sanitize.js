// js/sanitize.js — HTML sanitizer for anything rendered from Markdown or
// AI output before it is inserted into the DOM (no external dependency).
//
// Allowlist-based: known formatting tags survive with a few safe attributes;
// everything else is unwrapped (text kept) or dropped (script/style/iframe…).
// Event-handler attributes and javascript:/data: URLs never survive.
(function () {
  const DROP = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'textarea', 'select', 'option', 'noscript', 'template', 'svg', 'math', 'audio', 'video', 'source', 'track', 'canvas']);
  const ALLOW = new Set(['a', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'ins', 'mark', 'sub', 'sup', 'small', 'code', 'pre', 'kbd',
    'p', 'br', 'hr', 'div', 'span', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col', 'img', 'figure', 'figcaption', 'details', 'summary', 'button']);
  const ATTRS = { '*': ['class', 'title', 'aria-label', 'aria-hidden', 'role', 'colspan', 'rowspan', 'align', 'data-open-findings'], a: ['href', 'target', 'rel'], img: ['src', 'alt', 'width', 'height'], ol: ['start'], button: ['type'] };
  const SAFE_URL = /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/|index\.html)/i;

  function clean(node) {
    Array.from(node.childNodes).forEach(function (child) {
      if (child.nodeType === 8) { child.remove(); return; } // comments
      if (child.nodeType !== 1) return;
      const tag = child.tagName.toLowerCase();
      if (DROP.has(tag)) { child.remove(); return; }
      if (!ALLOW.has(tag)) { // unknown tag: keep its (cleaned) contents
        clean(child);
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        child.remove();
        return;
      }
      Array.from(child.attributes).forEach(function (attr) {
        const name = attr.name.toLowerCase();
        const allowed = (ATTRS['*'].indexOf(name) >= 0) || ((ATTRS[tag] || []).indexOf(name) >= 0);
        if (!allowed) { child.removeAttribute(attr.name); return; }
        if (name === 'href' || name === 'src') {
          const v = attr.value.trim();
          const ok = SAFE_URL.test(v) || (name === 'src' && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(v));
          if (!ok) child.removeAttribute(attr.name);
        }
      });
      if (tag === 'a' && child.getAttribute('target') === '_blank') child.setAttribute('rel', 'noopener noreferrer');
      if (tag === 'button' && !child.hasAttribute('data-open-findings')) { // only the app's own inert buttons survive
        clean(child);
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        child.remove();
        return;
      }
      clean(child);
    });
  }

  // DOMParser documents are inert: nothing in them runs or loads while parsed.
  function html(input) {
    if (input == null) return '';
    const doc = new DOMParser().parseFromString('<!doctype html><body>' + String(input), 'text/html');
    clean(doc.body);
    return doc.body.innerHTML;
  }

  // marked.parse → sanitized HTML (the single entry point for Markdown rendering).
  function markdown(md) {
    const raw = window.marked && typeof window.marked.parse === 'function' ? window.marked.parse(md || '') : String(md || '').replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; });
    return html(raw);
  }

  window.RehablixSanitize = { html: html, markdown: markdown };

  // Every marked.parse() in the app (Lixa, results, study, project, motion,
  // audio…) goes through this sanitizer via marked's own postprocess hook —
  // one global guarantee instead of patching each call site. marked is a
  // deferred script, so hook it now or once all deferred scripts have run.
  function hookMarked() {
    const m = window.marked;
    if (!m || typeof m.use !== 'function' || m.__rehablixSanitized) return;
    try {
      m.use({ hooks: { postprocess: function (out) { return html(out); } } });
      Object.defineProperty(m, '__rehablixSanitized', { value: true });
    } catch (e) { console.warn('[sanitize] could not hook marked', e); }
  }
  hookMarked();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hookMarked);
  else setTimeout(hookMarked, 0);
})();
