/**
 * Parse forum topic/comment content: [b], [i], [u], [s], [center], [color]/[colour], [url], [img], [gif], [ytube], and smileys.
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

function getYoutubeVideoId(urlOrId) {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  const s = urlOrId.trim();
  const m = s.match(/(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  return null;
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
 * Supported: [b], [i], [u], [s], [center], [color=name|hex] or [colour=...], [url], [img], [gif].
 * Also replaces :) :( etc with emoji.
 */
export function parseForumContent(content) {
  if (content == null || typeof content !== 'string') return '';
  let s = content;

  // 1) Escape HTML so raw tags are safe
  s = escapeHtml(s);

  // 2) Replace [gif], [img], [ytube] with placeholders (URLs can contain & etc)
  const gifPlaceholders = [];
  const imgPlaceholders = [];
  const ytubePlaceholders = [];
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
  s = s.replace(/\[ytube\](.*?)\[\/ytube\]/gi, (_, url) => {
    const idx = ytubePlaceholders.length;
    const videoId = getYoutubeVideoId(url);
    const embedSrc = videoId ? `https://www.youtube.com/embed/${escapeAttr(videoId)}` : '';
    ytubePlaceholders.push(embedSrc ? `<div class="forum-content-ytube"><iframe src="${embedSrc}" title="YouTube" class="forum-content-ytube-iframe" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>` : '');
    return `\u0001Y${idx}\u0001`;
  });

  // 3) Normalise British [colour] to [color] so one replacement handles both
  s = s.replace(/\[colour=/gi, '[color=');
  s = s.replace(/\[\/colour\]/gi, '[/color]');

  // Block/alignment and inline formatting (non-greedy)
  s = s.replace(/\[\/?(?:b|i|u|s|center|color=[^\]]*|url=[^\]]*)\]/gi, (m) => m); // keep as-is for next step
  s = s.replace(/\[center\](.*?)\[\/center\]/gi, '<div style="text-align:center">$1</div>');
  s = s.replace(/\[b\](.*?)\[\/b\]/gi, '<strong>$1</strong>');
  s = s.replace(/\[i\](.*?)\[\/i\]/gi, '<em>$1</em>');
  s = s.replace(/\[u\](.*?)\[\/u\]/gi, '<span style="text-decoration:underline">$1</span>');
  s = s.replace(/\[s\](.*?)\[\/s\]/gi, '<span style="text-decoration:line-through">$1</span>');
  // [color=value] or [colour=value]: value = hex (#rgb/#rrggbb) or any CSS color name (red, re, midnightblue, etc.)
  s = s.replace(/\[color=([^\]\s;"']+)\](.*?)\[\/color\]/gi, (_, color, text) => {
    const c = (color || '').trim();
    if (!c) return text;
    return `<span style="color:${escapeAttr(c)}">${text}</span>`;
  });
  // [url=...]text[/url] and [url]...[/url]
  s = s.replace(/\[url=(.*?)\](.*?)\[\/url\]/gi, (_, href, text) => {
    const safe = safeUrl(href);
    return safe ? `<a href="${escapeAttr(safe)}" target="_blank" rel="noopener noreferrer" class="forum-content-link">${text}</a>` : text;
  });
  s = s.replace(/\[url\](.*?)\[\/url\]/gi, (_, url) => {
    const safe = safeUrl(url);
    return safe ? `<a href="${escapeAttr(safe)}" target="_blank" rel="noopener noreferrer" class="forum-content-link">${url}</a>` : url;
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
  ytubePlaceholders.forEach((html, i) => {
    s = s.replace(`\u0001Y${i}\u0001`, html);
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
