/**
 * Parse forum topic/comment content: [b], [i], [color=...], [img], [gif], and smileys.
 * Output is safe HTML (we only emit our own tags). URLs restricted to http/https.
 */

const ALLOWED_URL_PREFIX = /^https?:\/\//i;

function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeUrl(url) {
  const u = (url || '').trim();
  return ALLOWED_URL_PREFIX.test(u) ? u : '';
}

// Smiley text → emoji (order matters: longer first)
const SMILEYS = [
  [':thumbsup:', '👍'],
  [':)', '😊'],
  [':-)', '😊'],
  [':(', '😢'],
  [':-(', '😢'],
  [':D', '😀'],
  [':-D', '😀'],
  [';)', '😉'],
  [';-)', '😉'],
  [':P', '😛'],
  [':-P', '😛'],
  [':p', '😛'],
  [':-p', '😛'],
  [':O', '😮'],
  [':-O', '😮'],
  [":'(", '😢'],
  ['<3', '❤️'],
  [':*', '😘'],
  ['xD', '😆'],
  ['XD', '😆'],
];

/**
 * Convert plain text + BBCode-style markup to safe HTML.
 * Supported: [b]...[/b], [i]...[/i], [color=#hex or name]...[/color], [img]url[/img], [gif]url[/gif].
 * Also replaces :) :( etc with emoji.
 */
export function parseForumContent(content) {
  if (content == null || typeof content !== 'string') return '';
  let s = content;

  // 1) Escape HTML so raw tags are safe
  s = escapeHtml(s);

  // 2) Replace [gif]url[/gif] and [img]url[/img] with placeholders (URLs can contain & etc)
  const gifPlaceholders = [];
  const imgPlaceholders = [];
  s = s.replace(/\[gif\](.*?)\[\/gif\]/gi, (_, url) => {
    const idx = gifPlaceholders.length;
    const safe = safeUrl(url);
    gifPlaceholders.push(safe ? `<img src="${escapeAttr(safe)}" alt="GIF" class="forum-content-media forum-content-gif" loading="lazy" />` : '');
    return `\u0001G${idx}\u0001`;
  });
  s = s.replace(/\[img\](.*?)\[\/img\]/gi, (_, url) => {
    const idx = imgPlaceholders.length;
    const safe = safeUrl(url);
    imgPlaceholders.push(safe ? `<img src="${escapeAttr(safe)}" alt="" class="forum-content-media forum-content-img" loading="lazy" />` : '');
    return `\u0001I${idx}\u0001`;
  });

  // 3) Bold and italic (non-greedy, no nesting)
  s = s.replace(/\[\/?(?:b|i|color=[^\]]*)\]/gi, (m) => m); // keep as-is for next step
  s = s.replace(/\[b\](.*?)\[\/b\]/gi, '<strong>$1</strong>');
  s = s.replace(/\[i\](.*?)\[\/i\]/gi, '<em>$1</em>');
  s = s.replace(/\[color=(#[a-fA-F0-9]{3,8}|[a-zA-Z]+)\](.*?)\[\/color\]/gi, (_, color, text) => {
    const c = color.startsWith('#') ? color : color;
    return `<span style="color:${escapeAttr(c)}">${text}</span>`;
  });

  // 4) Smileys (replace text with emoji)
  for (const [from, emoji] of SMILEYS) {
    const re = new RegExp(escapeRegex(from), 'g');
    s = s.replace(re, emoji);
  }

  // 5) Restore placeholders
  gifPlaceholders.forEach((html, i) => {
    s = s.replace(`\u0001G${i}\u0001`, html);
  });
  imgPlaceholders.forEach((html, i) => {
    s = s.replace(`\u0001I${i}\u0001`, html);
  });

  // 6) Newlines to <br />
  s = s.replace(/\n/g, '<br />');

  return s;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Insert markup at cursor in a textarea. Returns new value and new cursor position (after inserted text).
 */
export function insertAtCursor(value, before, after, selectionStart, selectionEnd) {
  const head = value.slice(0, selectionStart);
  const tail = value.slice(selectionEnd);
  const selected = value.slice(selectionStart, selectionEnd);
  const inserted = before + selected + after;
  const newValue = head + inserted + tail;
  const newPos = head.length + inserted.length;
  return { value: newValue, cursor: newPos };
}
