/**
 * Parse forum topic/comment content: [b], [i], [u], [s], [center], [color]/[colour],
 * [size], [spoiler], [quote], [url], [img], [gif], [ytube], and smileys.
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

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Smileys — order matters: longer / more-specific patterns first
// ---------------------------------------------------------------------------
const SMILEYS = [
  // --- Classic text smileys (longer first to avoid partial matches) ---
  [":'(",   '😭'],
  ['>:-(',  '😠'],
  ['>:(',   '😠'],
  [':-)))', '😂'],
  [':-))',  '😄'],
  [':-)',   '😊'],
  [':-D',   '😄'],
  [';-)',   '😉'],
  [':-P',   '😛'],
  [':-p',   '😛'],
  [':-O',   '😮'],
  [':-o',   '😮'],
  [':-/',   '😕'],
  [':-\\',  '😕'],
  [':-|',   '😐'],
  [':-*',   '😘'],
  [':-#',   '🤐'],
  ['B-)',   '😎'],
  ['O:-)',  '😇'],
  [':)',    '😊'],
  [':D',   '😄'],
  [';)',    '😉'],
  [':P',   '😛'],
  [':p',   '😛'],
  [':O',   '😮'],
  [':o',   '😮'],
  [':(',   '😢'],
  [':/',   '😕'],
  [':|',   '😐'],
  [':*',   '😘'],
  ['xD',   '😆'],
  ['XD',   '😆'],
  ['<3',   '❤️'],
  ['</3',  '💔'],

  // --- Named smileys: faces & emotions ---
  [':laugh:',      '😂'],
  [':lol:',        '😂'],
  [':rofl:',       '🤣'],
  [':cry:',        '😭'],
  [':sob:',        '😭'],
  [':sad:',        '😢'],
  [':happy:',      '😁'],
  [':grin:',       '😁'],
  [':big_smile:',  '😁'],
  [':smile:',      '😊'],
  [':blush:',      '😊'],
  [':wink:',       '😉'],
  [':tongue:',     '😛'],
  [':kiss:',       '😘'],
  [':love:',       '😍'],
  [':heart_eyes:', '😍'],
  [':inlove:',     '😍'],
  [':shocked:',    '😱'],
  [':scream:',     '😱'],
  [':wow:',        '😲'],
  [':surprised:',  '😲'],
  [':mad:',        '😡'],
  [':angry:',      '😡'],
  [':rage:',       '🤬'],
  [':grr:',        '😤'],
  [':steam:',      '😤'],
  [':evil:',       '😈'],
  [':devil:',      '😈'],
  [':angel:',      '😇'],
  [':halo:',       '😇'],
  [':cool:',       '😎'],
  [':sunglasses:', '😎'],
  [':smirk:',      '😏'],
  [':sly:',        '😏'],
  [':nerd:',       '🤓'],
  [':monocle:',    '🧐'],
  [':thinking:',   '🤔'],
  [':hmm:',        '🤔'],
  [':lying:',      '🤥'],
  [':nervous:',    '😬'],
  [':grimace:',    '😬'],
  [':sweat:',      '😅'],
  [':phew:',       '😅'],
  [':awkward:',    '😅'],
  [':dizzy:',      '😵'],
  [':woozy:',      '🥴'],
  [':drunk:',      '🥴'],
  [':confused:',   '😕'],
  [':neutral:',    '😐'],
  [':meh:',        '😑'],
  [':expressionless:','😑'],
  [':tired:',      '😫'],
  [':weary:',      '😩'],
  [':yawn:',       '🥱'],
  [':sleepy:',     '😴'],
  [':zzz:',        '💤'],
  [':sick:',       '🤒'],
  [':ill:',        '🤒'],
  [':vomit:',      '🤮'],
  [':puke:',       '🤮'],
  [':mask:',       '😷'],
  [':shrug:',      '🤷'],
  [':facepalm:',   '🤦'],
  [':headbang:',   '🤦'],
  [':pleading:',   '🥺'],
  [':uwu:',        '🥺'],
  [':exploding:',  '🤯'],
  [':mindblown:',  '🤯'],
  [':cowboy:',     '🤠'],
  [':clown:',      '🤡'],
  [':skull:',      '💀'],
  [':dead:',       '💀'],
  [':ghost:',      '👻'],
  [':alien:',      '👽'],
  [':robot:',      '🤖'],
  [':poop:',       '💩'],
  [':shit:',       '💩'],
  [':monkey_see:', '🙈'],
  [':monkey_hear:','🙉'],
  [':monkey_speak:','🙊'],
  [':see_no_evil:', '🙈'],
  [':sunglasses2:','🕶️'],
  [':nazar:',      '🧿'],
  [':moneymouth:', '🤑'],
  [':zipper:',     '🤐'],
  [':raised_eyebrow:','🤨'],
  [':upside_down:','🙃'],
  [':melting:',    '🫠'],
  [':salute:',     '🫡'],
  [':dotted_face:','🫥'],
  [':peeking:',    '🫣'],
  [':handshake_heart:','🫶'],

  // --- Hands & gestures ---
  [':thumbsup:',   '👍'],
  [':+1:',         '👍'],
  [':thumbsdown:', '👎'],
  [':-1:',         '👎'],
  [':clap:',       '👏'],
  [':wave:',       '👋'],
  [':pray:',       '🙏'],
  [':muscle:',     '💪'],
  [':fist:',       '✊'],
  [':punch:',      '👊'],
  [':ok:',         '👌'],
  [':point:',      '👉'],
  [':point_left:', '👈'],
  [':point_up:',   '☝️'],
  [':point_down:', '👇'],
  [':fingers_crossed:','🤞'],
  [':crossed_fingers:','🤞'],
  [':vulcan:',     '🖖'],
  [':peace:',      '✌️'],
  [':metal:',      '🤘'],
  [':call_me:',    '🤙'],
  [':raising_hand:','🙋'],
  [':open_hands:', '🤲'],
  [':handshake:',  '🤝'],
  [':writing:',    '✍️'],
  [':nail_care:',  '💅'],
  [':selfie:',     '🤳'],

  // --- Hearts & affection ---
  [':heart:',       '❤️'],
  [':red_heart:',   '❤️'],
  [':orange_heart:','🧡'],
  [':yellow_heart:','💛'],
  [':green_heart:', '💚'],
  [':blue_heart:',  '💙'],
  [':purple_heart:','💜'],
  [':black_heart:', '🖤'],
  [':white_heart:', '🤍'],
  [':brown_heart:', '🤎'],
  [':broken_heart:','💔'],
  [':two_hearts:',  '💕'],
  [':sparkling_heart:','💖'],
  [':heartbeat:',   '💓'],
  [':revolving_hearts:','💞'],
  [':love_letter:', '💌'],
  [':kiss_mark:',   '💋'],

  // --- Celebration & achievement ---
  [':party:',       '🎉'],
  [':tada:',        '🎊'],
  [':balloon:',     '🎈'],
  [':trophy:',      '🏆'],
  [':medal:',       '🥇'],
  [':gold:',        '🥇'],
  [':silver:',      '🥈'],
  [':bronze:',      '🥉'],
  [':star:',        '⭐'],
  [':star2:',       '🌟'],
  [':sparkles:',    '✨'],
  [':glitter:',     '✨'],
  [':crown:',       '👑'],
  [':confetti:',    '🎊'],
  [':fireworks:',   '🎆'],
  [':cake:',        '🎂'],
  [':gift:',        '🎁'],
  [':ribbon:',      '🎀'],
  [':champagne:',   '🥂'],

  // --- Mafia / game themed ---
  [':money:',       '💰'],
  [':moneybag:',    '💰'],
  [':cash:',        '💵'],
  [':dollar:',      '💵'],
  [':coin:',        '🪙'],
  [':gun:',         '🔫'],
  [':pistol:',      '🔫'],
  [':knife:',       '🔪'],
  [':dagger:',      '🗡️'],
  [':bomb:',        '💣'],
  [':explosion:',   '💥'],
  [':boom:',        '💥'],
  [':skull_crossbones:','☠️'],
  [':car:',         '🚗'],
  [':sports_car:',  '🏎️'],
  [':cop:',         '👮'],
  [':detective:',   '🕵️'],
  [':handcuffs:',   '⛓️'],
  [':jail:',        '🔒'],
  [':cigar:',       '🚬'],
  [':tophat:',      '🎩'],
  [':suit:',        '🤵'],
  [':briefcase:',   '💼'],
  [':safe:',        '🔐'],
  [':key2:',        '🗝️'],
  [':scroll:',      '📜'],
  [':newspaper:',   '📰'],
  [':chess:',       '♟️'],
  [':dice:',        '🎲'],
  [':cards:',       '🃏'],
  [':spades:',      '♠️'],
  [':hearts:',      '♥️'],
  [':diamonds:',    '♦️'],
  [':clubs:',       '♣️'],
  [':joker:',       '🃏'],

  // --- Objects & misc ---
  [':fire:',        '🔥'],
  [':100:',         '💯'],
  [':check:',       '✅'],
  [':tick:',        '✅'],
  [':x:',           '❌'],
  [':no:',          '🚫'],
  [':warning:',     '⚠️'],
  [':lock:',        '🔒'],
  [':unlock:',      '🔓'],
  [':key:',         '🔑'],
  [':eyes:',        '👀'],
  [':eye:',         '👁️'],
  [':ear:',         '👂'],
  [':nose:',        '👃'],
  [':music:',       '🎵'],
  [':notes:',       '🎶'],
  [':mic:',         '🎤'],
  [':headphones:',  '🎧'],
  [':pizza:',       '🍕'],
  [':burger:',      '🍔'],
  [':beer:',        '🍺'],
  [':beers:',       '🍻'],
  [':wine:',        '🍷'],
  [':whiskey:',     '🥃'],
  [':cocktail:',    '🍸'],
  [':coffee:',      '☕'],
  [':tea:',         '🍵'],
  [':sun:',         '☀️'],
  [':moon:',        '🌙'],
  [':rain:',        '🌧️'],
  [':lightning:',   '⚡'],
  [':snowflake:',   '❄️'],
  [':rainbow:',     '🌈'],
  [':earth:',       '🌍'],
  [':phone:',       '📱'],
  [':computer:',    '💻'],
  [':email:',       '📧'],
  [':pin:',         '📌'],
  [':paperclip:',   '📎'],
  [':scissors:',    '✂️'],
  [':pencil:',      '✏️'],
  [':pen:',         '🖊️'],
  [':book:',        '📖'],
  [':books:',       '📚'],
  [':magnify:',     '🔍'],
  [':bulb:',        '💡'],
  [':bell:',        '🔔'],
  [':no_bell:',     '🔕'],
  [':clock:',       '🕐'],
  [':hourglass:',   '⏳'],
  [':recycle:',     '♻️'],
  [':link:',        '🔗'],
  [':tools:',       '🛠️'],
  [':chart:',       '📈'],
  [':chart_down:',  '📉'],
  [':flag:',        '🚩'],
  [':white_flag:',  '🏳️'],
  [':rocket:',      '🚀'],
  [':boom2:',       '💥'],
  [':snowman:',     '☃️'],
  [':shamrock:',    '🍀'],
  [':rose:',        '🌹'],
  [':cactus:',      '🌵'],
  [':mushroom:',    '🍄'],
  [':cherry:',      '🍒'],
  [':lemon:',       '🍋'],
  [':grape:',       '🍇'],
  [':horseshoe:',   '🧲'],
  [':joystick:',    '🕹️'],
];

/**
 * Convert plain text + BBCode-style markup to safe HTML.
 *
 * Supported tags:
 *   [b]…[/b]              bold
 *   [i]…[/i]              italic
 *   [u]…[/u]              underline
 *   [s]…[/s]              strikethrough
 *   [center]…[/center]    centred block (works for text AND images)
 *   [color=X]…[/color]    coloured text (also [colour=X])
 *   [size=N]…[/size]      font size in em, clamped 0.6–2.5
 *   [spoiler]…[/spoiler]  collapsible spoiler block
 *   [quote]…[/quote]      blockquote
 *   [quote=Name]…[/quote] blockquote with attribution
 *   [url]…[/url]          hyperlink
 *   [url=X]…[/url]        hyperlink with label
 *   [img]URL[/img]        image (centres itself inside [center])
 *   [gif]URL[/gif]        gif image
 *   [ytube]…[/ytube]      YouTube embed
 *   :smiley: codes        see SMILEYS list above
 */
export function parseForumContent(content) {
  if (content == null || typeof content !== 'string') return '';
  let s = content;

  // 1) Escape HTML so raw < > & are safe
  s = escapeHtml(s);

  // 2) Extract media/embed tags into placeholders so their URLs survive escaping
  const gifPlaceholders   = [];
  const imgPlaceholders   = [];
  const ytubePlaceholders = [];

  s = s.replace(/\[gif\](.*?)\[\/gif\]/gi, (_, url) => {
    const idx = gifPlaceholders.length;
    const safe = safeUrl(url.trim());
    gifPlaceholders.push(
      safe
        ? `<img src="${escapeAttr(safe)}" alt="GIF" class="forum-content-media forum-content-gif" style="display:block;max-width:100%;height:auto;border-radius:6px;margin:0.25em auto;" loading="lazy">`
        : ''
    );
    return `\u0001G${idx}\u0001`;
  });

  s = s.replace(/\[img\](.*?)\[\/img\]/gi, (_, url) => {
    const idx = imgPlaceholders.length;
    const safe = safeUrl(url.trim());
    // display:block + margin:auto → centres correctly inside [center] wrappers
    imgPlaceholders.push(
      safe
        ? `<img src="${escapeAttr(safe)}" alt="" class="forum-content-media forum-content-img" style="display:block;max-width:100%;height:auto;border-radius:6px;margin:0.25em auto;" loading="lazy">`
        : ''
    );
    return `\u0001I${idx}\u0001`;
  });

  s = s.replace(/\[ytube\](.*?)\[\/ytube\]/gi, (_, url) => {
    const idx = ytubePlaceholders.length;
    const videoId = getYoutubeVideoId(url.trim());
    const embedSrc = videoId ? `https://www.youtube.com/embed/${escapeAttr(videoId)}` : '';
    ytubePlaceholders.push(
      embedSrc
        ? `<div class="forum-content-ytube" style="position:relative;width:100%;max-width:560px;margin:0.5em auto;padding-bottom:56.25%;"><iframe src="${embedSrc}" title="YouTube" class="forum-content-ytube-iframe" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;border-radius:8px;" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`
        : ''
    );
    return `\u0001Y${idx}\u0001`;
  });

  // 3) Normalise British spelling
  s = s.replace(/\[colour=/gi,   '[color=');
  s = s.replace(/\[\/colour\]/gi, '[/color]');

  // 4) Block / structural tags (multiline-safe with [\s\S])
  //    [center]: width:100% so block images with margin:auto also centre
  s = s.replace(
    /\[center\]([\s\S]*?)\[\/center\]/gi,
    '<div style="text-align:center;width:100%;">$1</div>'
  );

  // [quote=Name]
  s = s.replace(
    /\[quote=([^\]]{1,64})\]([\s\S]*?)\[\/quote\]/gi,
    (_, name, inner) =>
      `<blockquote class="forum-content-quote" style="border-left:3px solid rgba(234,179,8,0.4);margin:0.4em 0;padding:0.4em 0.8em;background:rgba(234,179,8,0.05);border-radius:0 4px 4px 0;"><span style="font-size:0.75em;opacity:0.6;display:block;margin-bottom:0.2em;">${escapeHtml(name)} wrote:</span>${inner}</blockquote>`
  );
  // [quote]
  s = s.replace(
    /\[quote\]([\s\S]*?)\[\/quote\]/gi,
    '<blockquote class="forum-content-quote" style="border-left:3px solid rgba(234,179,8,0.4);margin:0.4em 0;padding:0.4em 0.8em;background:rgba(234,179,8,0.05);border-radius:0 4px 4px 0;">$1</blockquote>'
  );

  // [spoiler]
  s = s.replace(
    /\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi,
    '<details class="forum-content-spoiler" style="margin:0.4em 0;border:1px solid rgba(234,179,8,0.25);border-radius:4px;padding:0.25em 0.6em;"><summary style="cursor:pointer;font-size:0.8em;opacity:0.6;user-select:none;">Spoiler</summary><div style="padding-top:0.3em;">$1</div></details>'
  );

  // 5) Inline formatting
  s = s.replace(/\[b\]([\s\S]*?)\[\/b\]/gi,   '<strong>$1</strong>');
  s = s.replace(/\[i\]([\s\S]*?)\[\/i\]/gi,   '<em>$1</em>');
  s = s.replace(/\[u\]([\s\S]*?)\[\/u\]/gi,   '<span style="text-decoration:underline">$1</span>');
  s = s.replace(/\[s\]([\s\S]*?)\[\/s\]/gi,   '<span style="text-decoration:line-through">$1</span>');

  // [color=value]
  s = s.replace(
    /\[color=([^\]\s;"']{1,32})\]([\s\S]*?)\[\/color\]/gi,
    (_, color, text) => {
      const c = color.trim();
      return c ? `<span style="color:${escapeAttr(c)}">${text}</span>` : text;
    }
  );

  // [size=N] — em value, clamped 0.6–2.5
  s = s.replace(
    /\[size=([0-9.]{1,5})\]([\s\S]*?)\[\/size\]/gi,
    (_, size, text) => {
      const em = Math.min(2.5, Math.max(0.6, parseFloat(size) || 1));
      return `<span style="font-size:${em}em">${text}</span>`;
    }
  );

  // [url=X]label[/url] and [url]href[/url]
  s = s.replace(/\[url=(.*?)\]([\s\S]*?)\[\/url\]/gi, (_, href, text) => {
    const safe = safeUrl(href.trim());
    return safe
      ? `<a href="${escapeAttr(safe)}" target="_blank" rel="noopener noreferrer" class="forum-content-link">${text}</a>`
      : text;
  });
  s = s.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (_, url) => {
    const safe = safeUrl(url.trim());
    return safe
      ? `<a href="${escapeAttr(safe)}" target="_blank" rel="noopener noreferrer" class="forum-content-link">${escapeHtml(url.trim())}</a>`
      : escapeHtml(url.trim());
  });

  // 6) Smileys
  for (const [from, emoji] of SMILEYS) {
    s = s.replace(new RegExp(escapeRegex(from), 'g'), emoji);
  }

  // 7) Restore media placeholders
  gifPlaceholders.forEach((html, i)   => { s = s.split(`\u0001G${i}\u0001`).join(html); });
  imgPlaceholders.forEach((html, i)   => { s = s.split(`\u0001I${i}\u0001`).join(html); });
  ytubePlaceholders.forEach((html, i) => { s = s.split(`\u0001Y${i}\u0001`).join(html); });

  // 8) Newlines → <br>
  s = s.replace(/\n/g, '<br />');

  return s;
}

/**
 * Insert markup at cursor in a textarea.
 * Returns { value: string, cursor: number }.
 */
export function insertAtCursor(value, before, after, selectionStart, selectionEnd) {
  const head     = value.slice(0, selectionStart);
  const tail     = value.slice(selectionEnd);
  const selected = value.slice(selectionStart, selectionEnd);
  const inserted = before + selected + after;
  return {
    value:  head + inserted + tail,
    cursor: head.length + inserted.length,
  };
}
