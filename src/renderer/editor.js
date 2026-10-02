// Rich-text editor (Quill) helpers plus safe rendering of stored notes.

const EDITOR_TOOLBAR = [
  [{ header: [1, 2, 3, false] }],
  ['bold', 'italic', 'underline', 'strike'],
  [{ list: 'ordered' }, { list: 'bullet' }],
  ['blockquote', 'code-block', 'link'],
  ['clean'],
];

function createEditor(container, html, onChange) {
  const quill = new Quill(container, {
    theme: 'snow',
    placeholder: 'Escribí tus notas acá…',
    modules: { toolbar: EDITOR_TOOLBAR },
  });
  if (html) setEditorHtml(quill, html);
  if (onChange) quill.on('text-change', () => onChange(getEditorHtml(quill)));
  return quill;
}

function setEditorHtml(quill, html) {
  quill.clipboard.dangerouslyPasteHTML(notesToHtml(html), 'silent');
}

function getEditorHtml(quill) {
  return quill.getText().trim() === '' ? '' : quill.getSemanticHTML().replace(/&nbsp;/g, ' ');
}

const ALLOWED_TAGS = new Set(['P', 'BR', 'STRONG', 'EM', 'U', 'S', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'A']);

// Old notes were plain text; new ones are HTML produced by the editor.
function notesToHtml(notes) {
  if (!notes) return '';
  if (/^\s*</.test(notes)) return sanitizeHtml(notes);
  return notes
    .split('\n')
    .map((line) => `<p>${esc(line) || '<br>'}</p>`)
    .join('');
}

function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const clean = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE) {
        child.remove();
        continue;
      }
      clean(child);
      if (!ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(...child.childNodes);
        continue;
      }
      const href = child.tagName === 'A' ? child.getAttribute('href') : null;
      for (const attr of [...child.attributes]) child.removeAttribute(attr.name);
      if (href && /^https?:\/\//i.test(href)) {
        child.setAttribute('href', href);
        child.setAttribute('rel', 'noopener noreferrer');
      }
    }
  };
  clean(doc.body);
  return doc.body.innerHTML;
}
