// Rich-text editor (Quill) helpers plus safe rendering of stored notes.

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'];

// Quill only lets http, https and data URLs through for images; our own attachments use studyfiles://.
(() => {
  const Image = Quill.import('formats/image');
  const original = Image.sanitize.bind(Image);
  Image.sanitize = (url) => (/^studyfiles:\/\/file\/\d+$/.test(url || '') ? url : original(url));
})();

const editorToolbar = (withImages) => [
  [{ header: [1, 2, 3, false] }],
  ['bold', 'italic', 'underline', 'strike'],
  [{ list: 'ordered' }, { list: 'bullet' }],
  withImages ? ['blockquote', 'code-block', 'link', 'image'] : ['blockquote', 'code-block', 'link'],
  ['clean'],
];

// Saves the chosen, pasted or dropped images as attachments and inserts them by reference (never as base64).
async function uploadImages(quill, range, files, subjectId) {
  let index = range ? range.index : quill.getLength();
  for (const file of files) {
    if (!IMAGE_TYPES.includes(file.type)) {
      toast('Solo se pueden insertar imágenes PNG, JPG, GIF, WebP o BMP.', 'error');
      continue;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const saved = await window.api.addFileBytes({ subjectId, sessionId: null, name: file.name || 'imagen', mime: file.type, bytes, inline: true });
      state.files.unshift(saved); // so the preview can open it without a full reload
      quill.insertEmbed(index, 'image', fileUrl(saved.id), 'user');
      index += 1;
    } catch (err) {
      toast(cleanError(err), 'error');
    }
  }
  quill.setSelection(index, 0, 'silent');
}

// `subjectId` enables images: the files are stored under that subject. Without it the editor is text only.
function createEditor(container, html, onChange, { subjectId = null } = {}) {
  let quill;
  quill = new Quill(container, {
    theme: 'snow',
    placeholder: 'Escribí tus notas acá…',
    modules: {
      toolbar: editorToolbar(!!subjectId),
      uploader: { mimetypes: IMAGE_TYPES, handler: (range, files) => (subjectId ? uploadImages(quill, range, files, subjectId) : undefined) },
    },
  });
  if (html) setEditorHtml(quill, html);
  if (onChange) quill.on('text-change', () => onChange(getEditorHtml(quill)));
  return quill;
}

function setEditorHtml(quill, html) {
  quill.clipboard.dangerouslyPasteHTML(notesToHtml(html), 'silent');
}

function getEditorHtml(quill) {
  // Quill's getText() ignores embeds, so a note that only holds an image must be detected separately.
  if (quill.getText().trim() === '' && !quill.root.querySelector('img')) return '';
  const html = quill.getSemanticHTML().replace(/&nbsp;/g, ' ');
  return html.includes('<img') ? stripForeignImages(html) : html;
}

// Pasted web pages can carry remote or base64 images; only our own attachments are ever stored.
function stripForeignImages(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('img').forEach((img) => {
    if (!OWN_IMAGE.test(img.getAttribute('src') || '')) img.remove();
  });
  return doc.body.innerHTML;
}

const ALLOWED_TAGS = new Set(['P', 'BR', 'STRONG', 'EM', 'U', 'S', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'A', 'IMG']);
const OWN_IMAGE = /^studyfiles:\/\/file\/\d+$/; // the only image source notes may reference

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
      const src = child.tagName === 'IMG' ? child.getAttribute('src') : null;
      if (child.tagName === 'IMG' && !OWN_IMAGE.test(src || '')) {
        child.remove(); // remote or inline-data images are never rendered
        continue;
      }
      for (const attr of [...child.attributes]) child.removeAttribute(attr.name);
      if (src) child.setAttribute('src', src);
      if (href && /^https?:\/\//i.test(href)) {
        child.setAttribute('href', href);
        child.setAttribute('rel', 'noopener noreferrer');
      }
    }
  };
  clean(doc.body);
  return doc.body.innerHTML;
}
