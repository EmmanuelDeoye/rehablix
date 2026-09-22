// js/docx-export.js — shared HTML -> .docx builder.
//
// Extracted out of js/result.js's downloadBtn handler (Lixa History +
// Intelligence Upgrade / generic export task) so it can be called from
// anywhere that has an HTML string or element, not only from a live
// #/result page's own DOM. js/result.js now calls into this instead of
// carrying its own copy — behavior there is unchanged, just relocated.
//
// Walks real markup (headings, bold/italic/underline runs, bulleted/
// numbered lists, tables with a shaded header row) into actual Word
// structure via the `docx` library (loaded globally in index.html), rather
// than flattening everything to plain paragraphs.
(function () {
  function inlineRunsFromNode(node, baseFormatting) {
    baseFormatting = baseFormatting || {};
    const runs = [];
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent;
        if (text) runs.push(new docx.TextRun({ text, ...baseFormatting }));
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;

      const tag = child.tagName.toLowerCase();
      if (tag === 'br') {
        runs.push(new docx.TextRun({ text: '', break: 1 }));
        return;
      }
      const nextFormatting = { ...baseFormatting };
      if (tag === 'strong' || tag === 'b') nextFormatting.bold = true;
      if (tag === 'em' || tag === 'i') nextFormatting.italics = true;
      if (tag === 'u') nextFormatting.underline = {};
      runs.push(...inlineRunsFromNode(child, nextFormatting));
    });
    return runs;
  }

  function blockToDocxElements(el) {
    const tag = el.tagName.toLowerCase();

    if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') {
      const levelMap = {
        h1: docx.HeadingLevel.HEADING_1,
        h2: docx.HeadingLevel.HEADING_2,
        h3: docx.HeadingLevel.HEADING_3,
        h4: docx.HeadingLevel.HEADING_4
      };
      return [new docx.Paragraph({
        heading: levelMap[tag],
        spacing: { before: 240, after: 120 },
        children: inlineRunsFromNode(el)
      })];
    }

    if (tag === 'p') {
      const runs = inlineRunsFromNode(el);
      if (runs.length === 0) return [new docx.Paragraph({ text: '' })];
      return [new docx.Paragraph({ spacing: { after: 120 }, children: runs })];
    }

    if (tag === 'ul' || tag === 'ol') {
      const elements = [];
      Array.from(el.children).forEach((li) => {
        if (li.tagName.toLowerCase() !== 'li') return;
        const runs = inlineRunsFromNode(li);
        elements.push(new docx.Paragraph({
          spacing: { after: 60 },
          bullet: tag === 'ul' ? { level: 0 } : undefined,
          numbering: tag === 'ol' ? { reference: 'docx-export-numbering', level: 0 } : undefined,
          children: runs.length ? runs : [new docx.TextRun({ text: li.textContent || '' })]
        }));
      });
      return elements;
    }

    if (tag === 'table') {
      const rows = [];
      Array.from(el.querySelectorAll('tr')).forEach((tr, rowIdx) => {
        const isHeaderRow = rowIdx === 0 && tr.querySelector('th');
        const cells = Array.from(tr.children).map((cell) => {
          const runs = inlineRunsFromNode(cell, isHeaderRow ? { bold: true } : {});
          return new docx.TableCell({
            shading: isHeaderRow ? { fill: 'E3E6EA' } : undefined,
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new docx.Paragraph({ children: runs.length ? runs : [new docx.TextRun('')] })]
          });
        });
        rows.push(new docx.TableRow({ children: cells }));
      });
      if (rows.length === 0) return [];
      return [
        new docx.Table({
          width: { size: 100, type: docx.WidthType.PERCENTAGE },
          rows
        }),
        new docx.Paragraph({ text: '' }) // breathing room after the table
      ];
    }

    if (tag === 'blockquote') {
      return [new docx.Paragraph({
        indent: { left: 360 },
        spacing: { after: 120 },
        children: [new docx.TextRun({ text: el.textContent || '', italics: true })]
      })];
    }

    if (tag === 'hr') {
      return [new docx.Paragraph({
        border: { bottom: { color: 'CCCCCC', space: 1, style: docx.BorderStyle.SINGLE, size: 6 } },
        spacing: { before: 120, after: 120 },
        text: ''
      })];
    }

    // Unknown/unsupported element (e.g. div wrapper): recurse into children
    // rather than dropping the content, falling back to plain paragraphs.
    if (el.children.length > 0) {
      const nested = [];
      Array.from(el.children).forEach((child) => nested.push(...blockToDocxElements(child)));
      if (nested.length > 0) return nested;
    }
    const text = el.textContent.trim();
    return text ? [new docx.Paragraph({ text })] : [];
  }

  function contentElementsFromContainer(containerEl) {
    const elements = [];
    Array.from(containerEl.children).forEach((child) => {
      elements.push(...blockToDocxElements(child));
    });
    // Fully empty container: keep export from producing a broken/blank .docx.
    if (elements.length === 0) {
      elements.push(new docx.Paragraph({ text: containerEl.innerText || '' }));
    }
    return elements;
  }

  // `source` is either an HTML string or an already-live element (e.g. the
  // #/result editor). `meta`: { title, printMeta: [[label, value], ...] }.
  function buildDocument(source, meta) {
    meta = meta || {};
    const container = (typeof source === 'string')
      ? Object.assign(document.createElement('div'), { innerHTML: source })
      : source;
    const bodyElements = contentElementsFromContainer(container);
    const printMeta = meta.printMeta || [];

    return new docx.Document({
      numbering: {
        config: [{
          reference: 'docx-export-numbering',
          levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: docx.AlignmentType.START }]
        }]
      },
      sections: [{
        children: [
          new docx.Paragraph({ text: meta.title || 'Document', heading: docx.HeadingLevel.HEADING_1, spacing: { after: 120 } }),
          new docx.Paragraph({ text: `Date: ${new Date().toLocaleString()}`, spacing: { after: 60 } }),
          ...printMeta.map(([k, v]) => new docx.Paragraph({ text: `${k}: ${v}`, spacing: { after: 40 } })),
          new docx.Paragraph({ text: '' }),
          ...bodyElements
        ]
      }]
    });
  }

  async function buildBlob(source, meta) {
    if (typeof docx === 'undefined') throw new Error('Word export library not loaded');
    const doc = buildDocument(source, meta);
    return docx.Packer.toBlob(doc);
  }

  // Builds and triggers a browser download in one step — what both
  // js/result.js and Lixa's generic export path actually want.
  async function download(source, meta) {
    const blob = await buildBlob(source, meta);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(meta && meta.fileBase) || 'document'}_${Date.now()}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  window.RehablixDocx = { buildDocument, buildBlob, download };
})();
