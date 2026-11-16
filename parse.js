// fast-marked: a dependency-free Markdown renderer whose parse() returns
// exactly the HTML marked 18.1.3 returns with its default options
// (GFM on, breaks off, pedantic off, async off).
//
// Design: one direct rendering pass. Block structure is scanned line by
// line, link definitions are collected first, and inline content is
// rendered straight to strings -- no token objects, no queues, no second
// tree walk. Inline emphasis uses the CommonMark flanking rules, and the
// block/inline boundary patterns follow the same grammar marked uses, so
// the output matches marked code unit for code unit.

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/g;
const ESC_NOENC_RE = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;
const NUM_REF_RE = /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/g;
const NUM_REF_OR_AMP_RE = /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;
const PUNCT_RE = /[\p{P}\p{S}]/u;
const ALNUM_RE = /[\p{L}\p{N}]/u;
const WS_RE = /\s/;
const TAGNAMES = 'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';

function escEncode(s) {
  return s.indexOf('&') < 0 && s.indexOf('<') < 0 && s.indexOf('>') < 0 && s.indexOf('"') < 0 && s.indexOf("'") < 0
    ? s : s.replace(ESC_RE, (c) => ESC_MAP[c]);
}
function escNoEncode(s) {
  return s.indexOf('<') < 0 && s.indexOf('>') < 0 && s.indexOf('"') < 0 && s.indexOf("'") < 0 && s.indexOf('&') < 0
    ? s : s.replace(ESC_NOENC_RE, (c) => ESC_MAP[c] || '&amp;');
}
function decodeNumeric(s) {
  if (s.indexOf('&') < 0) return s;
  if (!NUM_REF_RE.test(s)) return s;
  NUM_REF_RE.lastIndex = 0;
  return s.replace(NUM_REF_OR_AMP_RE, (ref, dec, hex) => {
    if (dec === undefined && hex === undefined) return '&amp;';
    const code = dec === undefined ? parseInt(hex, 16) : parseInt(dec, 10);
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\uFFFD';
    return code === 38 ? '&amp;' : String.fromCodePoint(code);
  });
}
function cleanUrl(href) {
  try { return encodeURI(href).replace(/%25/g, '%'); } catch { return null; }
}
function normLabel(label) {
  return label.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase().toLowerCase();
}
function rtrimChar(s, c) {
  let i = s.length;
  while (i > 0 && s.charCodeAt(i - 1) === c.charCodeAt(0)) i--;
  return s.slice(0, i);
}
function rtrimStr(s, c) {
  let i = s.length;
  while (i > 0 && s[i - 1] === c) i--;
  return s.slice(0, i);
}
function findClosingBracket(s, open, close) {
  if (s.indexOf(open) < 0 && s.indexOf(close) < 0) return -1;
  let level = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') { i++; continue; }
    if (ch === open) level++;
    else if (ch === close) { level--; if (level < 0) return i; }
  }
  return level > 0 ? -2 : -1;
}
function splitCells(row, count) {
  const r = row.replace(/\|/g, (m, off, str) => {
    let esc = false, k = off;
    while (--k >= 0 && str[k] === '\\') esc = !esc;
    return esc ? '|' : ' |';
  });
  const cells = r.split(' |');
  if (cells.length && !cells[0].trim()) cells.shift();
  if (cells.length && !cells[cells.length - 1].trim()) cells.pop();
  if (count) {
    if (cells.length > count) cells.splice(count);
    else while (cells.length < count) cells.push('');
  }
  for (let i = 0; i < cells.length; i++) cells[i] = cells[i].trim().replace(/\\\|/g, '|');
  return cells;
}
function expandTabs(line, indent = 0) {
  let col = indent, out = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\t') { const add = 4 - (col % 4); out += ' '.repeat(add); col += add; }
    else { out += ch; col++; }
  }
  return out;
}
function isPunct(ch) { return ch.length === 1 && /[\s\p{P}\p{S}]/u.test(ch); }
function isAlnum(ch) { return ch.length === 1 && ALNUM_RE.test(ch); }

// ---- block patterns ----
const RE_NEWLINE = /^(?:[ \t]*(?:\n|$))+/;
const RE_INDENT_CODE = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
const RE_FENCE = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}(?:(?=`)\1`*|(?=~)\1~*) *(?=\n|$)|$)/;
const RE_HR = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
const RE_ATX = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
const RE_HTML = new RegExp(
  '^ {0,3}(?:'
  + '<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)'
  + '|<!--(?:-?>|[\\s\\S]*?(?:-->|$))[^\\n]*(\\n+|$)'
  + '|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)'
  + '|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)'
  + '|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)'
  + '|</?(' + TAGNAMES + ')(?:[ \\t]+|\\n|/?>|$)[\\s\\S]*?(?:(?:\\n[ \\t]*)+\\n|$)'
  + '|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?: +[a-zA-Z:_][\\w.:-]*(?: *= *"[^"\\n]*"| *= *\'[^\'\\n]*\'| *= *[^\\s"\'=<>`]+)?)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \\t]*)+\\n|$)'
  + '|</[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \\t]*)+\\n|$)'
  + ')', 'i');
const RE_HTML_BEGIN = new RegExp('^ {0,3}(?:</?(?:' + TAGNAMES + ')(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)', 'i');
const RE_DEF = /^ {0,3}\[((?!\s*\])(?:\\[\s\S]|[^\[\]\\\n]|\n(?![ \t]*\n))+)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)((?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\\n]|\n(?!\n))*'|\((?:\\[\s\S]|[^()\\])*\))))? *(?:\n+|$)/;
const RE_TABLE_DELIM = /^ {0,3}((?:\| *)?:?-+:? *(?:\| *:?-+:? *)*(?:\| *)?)$/;
const RE_SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;

// ---- inline patterns ----
const RE_ESCAPE = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
const RE_CODE = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
const RE_BR = /^( {2,}|\\)\n(?!\s*$)[ \t]*/;
const RE_AUTOLINK = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s\x00-\x1f<>]*|[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_]))>/;
const RE_TAG = /^<!--(?:-?>|[\s\S]*?-->)|^<\/[a-zA-Z][a-zA-Z0-9-]*\s*>|^<[a-zA-Z][a-zA-Z0-9-]*(?:\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?)*?\s*\/?>|^<\?[\s\S]*?\?>|^<![a-zA-Z]+\s[\s\S]*?>|^<!\[CDATA\[[\s\S]*?\]\]>/;
const LABEL_IN = '(?:\\[(?:\\[(?:\\\\[\\s\\S]|[^\\[\\]\\\\])*\\]|\\\\[\\s\\S]|[^\\[\\]\\\\])*\\]|\\\\[\\s\\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\\])|[^\\[\\]\\\\`])*?';
const LABEL_BL = '(?!\\s*\\])(?:\\\\[\\s\\S]|[^\\[\\]\\\\\\n]|\\n(?![ \\t]*\\n))+';
const RE_LINK = new RegExp('^!?\\[(' + LABEL_IN + ')\\]\\([ \\t\\n]*(<(?:\\\\.|[^\\n<>\\\\])+>|[^ \\t\\n\\x00-\\x1f]+|(?=\\)))(?:(?:[ \\t]+(?:\\n[ \\t]*)?|\\n[ \\t]*)("(?:\\\\[\\s\\S]|[^"\\\\])*"|\'(?:\\\\[\\s\\S]|[^\'\\\\])*\'|\\((?:\\\\[\\s\\S]|[^)\\\\])*\\)))?[ \\t\\n]*\\)');
const RE_REFLINK = new RegExp('^!?\\[(' + LABEL_IN + ')\\]\\[(' + LABEL_BL + ')\\]');
const RE_NOLINK = new RegExp('^!?\\[(' + LABEL_BL + ')\\](?:\\[\\])?');
const RE_URL = /^(?:mailto:[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])|xmpp:[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])(?:\/[A-Za-z0-9@.]+)?)|^((?:[hH][tT][tT][pP][sS]?|[fF][tT][pP]):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/;
const RE_BACKPEDAL = /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/;
const RE_TABLE_ROW_BLANK = /\n[ \t]*$/;

// Sticky copies of the inline regexes, for matching at an offset without
// slicing the remaining source (slicing on every inline step is quadratic
// on long paragraphs). The leading ^ anchors are stripped -- the sticky
// flag already anchors at lastIndex -- but ^ inside character classes and
// escaped ^ are left alone.
function stickyOf(re) {
  const src = re.source;
  let out = '';
  let inClass = false;
  let escaped = false;
  for (let k = 0; k < src.length; k++) {
    const c = src[k];
    if (escaped) { out += c; escaped = false; continue; }
    if (c === '\\') { out += c; escaped = true; continue; }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    if (c === '^' && !inClass && (k === 0 || src[k - 1] === '|' || src[k - 1] === '(')) continue;
    out += c;
  }
  return new RegExp(out, 'y');
}
function execAt(re, s, i) {
  re.lastIndex = i;
  return re.exec(s);
}
const RE_ESCAPE_Y = stickyOf(RE_ESCAPE);
const RE_CODE_Y = stickyOf(RE_CODE);
const RE_BR_Y = stickyOf(RE_BR);
const RE_AUTOLINK_Y = stickyOf(RE_AUTOLINK);
const RE_TAG_Y = stickyOf(RE_TAG);
const RE_URL_Y = stickyOf(RE_URL);

// ---- block helpers (line based) ----
function blankLine(s) { return /^[ \t]*$/.test(s); }
function consumedLines(raw) {
  if (!raw) return 0;
  const nl = (raw.match(/\n/g) || []).length;
  return raw.endsWith('\n') ? nl : nl + 1;
}
function leadCount(s) {
  let i = 0, col = 0;
  while (i < s.length && (s[i] === ' ' || s[i] === '\t')) {
    if (s[i] === '\t') col += 4 - (col % 4); else col++;
    i++;
  }
  return { col, idx: i };
}
function isHrLine(s) {
  const { col, idx } = leadCount(s);
  if (col > 3) return false;
  const rest = s.slice(idx);
  if (!rest) return false;
  const ch = rest[0];
  if (ch !== '-' && ch !== '_' && ch !== '*') return false;
  let n = 0;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === ch) n++;
    else if (c !== ' ' && c !== '\t') return false;
  }
  return n >= 3;
}
function atxHead(s) {
  const { col, idx } = leadCount(s);
  if (col > 3) return null;
  let n = 0;
  while (idx + n < s.length && s[idx + n] === '#') n++;
  if (n < 1 || n > 6) return null;
  const after = s[idx + n];
  if (after !== undefined && after !== ' ' && after !== '\t') return null;
  return { depth: n, text: s.slice(idx + n) };
}
function fenceStart(s) {
  const { col, idx } = leadCount(s);
  if (col > 3) return null;
  const ch = s[idx];
  if (ch !== '`' && ch !== '~') return null;
  let n = 0;
  while (idx + n < s.length && s[idx + n] === ch) n++;
  if (n < 3) return null;
  if (ch === '`' && s.slice(idx).includes('`', idx + n)) {
    // a backtick fence's info string may not hold a backtick
    const info = s.slice(idx + n);
    if (info.indexOf('`') >= 0) return null;
  }
  return { ch, len: n, info: s.slice(idx + n) };
}
function bulletOf(s) {
  const { col, idx } = leadCount(s);
  if (col > 3) return null;
  const c = s[idx];
  if (c === '*' || c === '+' || c === '-') {
    const after = s[idx + 1];
    if (after !== undefined && after !== ' ' && after !== '\t' && after !== '\n') return null;
    return { ordered: false, bull: c, num: 0, idx, col };
  }
  if (c >= '0' && c <= '9') {
    let j = idx;
    while (j < s.length && s[j] >= '0' && s[j] <= '9') j++;
    if (j - idx > 9) return null;
    const d = s[j];
    if (d !== '.' && d !== ')') return null;
    const after = s[j + 1];
    if (after !== undefined && after !== ' ' && after !== '\t') return null;
    return { ordered: true, bull: s.slice(idx, j + 1), num: parseInt(s.slice(idx, j), 10), idx, col, delim: d };
  }
  return null;
}
function tableDelim(s) {
  const { col } = leadCount(s);
  if (col > 3) return null;
  const m = RE_TABLE_DELIM.exec(s);
  if (!m) return null;
  if (m[1].indexOf(':') < 0 && m[1].indexOf('|') < 0) return null;
  return m[1];
}
function isTableStart(lines, i) {
  if (i + 1 >= lines.length) return false;
  const head = lines[i];
  if (!head || head.trim() === '' || head[0] === ' ') {
    // header may have leading spaces; the table regex allows ' *' before it
    if (head.trim() === '') return false;
  }
  const delim = tableDelim(lines[i + 1]);
  if (!delim) return false;
  const headers = splitCells(head);
  const aligns = delim.replace(/^\||\| *$/g, '').split('|');
  return headers.length === aligns.length;
}
function interruptsPara(line, lines, i, mode) {
  if (blankLine(line)) return true;
  if (RE_SETEXT.test(line)) return true;
  // list interruption depends on context: a top-level paragraph is only
  // interrupted by an unordered bullet or a '1.' list with content; a
  // blockquote paragraph by any bullet; list-item text by any bullet
  // (even a bare one, since blockTokens tries list() before text())
  if (mode === 'text') { if (bulletOf(line)) return true; }
  else if (mode === 'bq') { if (/^ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)/.test(line)) return true; }
  else if (/^ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t\n]/.test(line)) return true;
  if (atxHead(line)) return true;
  if (isHrLine(line)) return true;
  if (fenceStart(line)) return true;
  const { col } = leadCount(line);
  if (col <= 3 && line.slice(leadCount(line).idx, leadCount(line).idx + 1) === '>') return true;
  if (RE_HTML_BEGIN.test(line)) return true;
  // (list interrupt handled by the regex above: a bullet only interrupts
  // a paragraph when it has content after it, and only '1.' ordered lists
  // interrupt at all)
  if (isTableStart(lines, i)) return true;
  return false;
}
// Collect paragraph lines starting at i; returns {text, next}
function collectPara(lines, i, end, mode) {
  const out = [];
  let j = i;
  while (j < end) {
    const line = lines[j];
    if (blankLine(line)) {
      // a whitespace-only line that is the last line of the block is part
      // of the paragraph (marked's paragraph regex only rejects it when a
      // newline follows it) -- but not in a list item: there the line is a
      // space token, and the text token ends before it
      if (mode !== 'text' && j === end - 1 && line.length > 0) { out.push(line); j++; }
      break;
    }
    if (j > i && interruptsPara(line, lines, j, mode)) break;
    // in a list-item (text) paragraph, a continuation line that starts
    // an indented code block (4+ spaces, or a tab) is absorbed into the
    // text with its indent stripped, as marked does by merging an
    // indented code block into the open text token; lines with fewer
    // spaces are not code blocks and keep their indent verbatim
    if (mode === 'text' && j > i && /^(?: {4}[^\n]| {0,3}\t)/.test(line)) {
      out.push(line.replace(/^(?: {0,3}\t| {1,4})/, '')); j++; continue;
    }
    out.push(line);
    j++;
  }
  return { text: out.join('\n'), next: j };
}
function trimTrailBlank(s) {
  const ls = s.split('\n');
  let e = ls.length - 1;
  while (e >= 0 && blankLine(ls[e])) e--;
  if (ls.length - e <= 2) return s;
  return ls.slice(0, e + 1).join('\n');
}

function parseLines(lines, a, b, mode, links) {
  const nodes = [];
  let pendingBlank = false;
  let prevHadBlank = false;
  let prevNodeCount = 0;
  let i = a;
  while (i < b) {
    let skippedBlanks = 0;
    while (i < b && blankLine(lines[i])) { if (nodes.length) skippedBlanks++; i++; }
    if (i >= b) break;
    const line = lines[i];
    if (nodes.length > 0) {
      if (skippedBlanks > 0) nodes.hasBlankSep = true;
      else if (i > 0 && blankLine(lines[i - 1])) nodes.hasBlankSep = true;
    }
    if (prevHadBlank && nodes.length > prevNodeCount) nodes.hasBlankSep = true;
    const hadBlank = skippedBlanks > 0 || pendingBlank;
    pendingBlank = false;
    prevHadBlank = hadBlank;
    prevNodeCount = nodes.length;
    // the remaining source as one string is only built when a block that
    // needs it can start here (indented code, fence, html block, def);
    // building it on every line is quadratic on long documents
    let rest = null;
    const getRest = () => (rest ??= lines.slice(i, b).join('\n'));
    // indented code
    {
      if (/^(?: {4}[^\n]| {0,3}\t)/.test(line)) {
      // bound the join to the end of the code block (a non-blank line
      // that is not indented code ends it)
      let end = i;
      while (end < b) {
        const l = lines[end];
        if (/^(?: {4}[^\n]| {0,3}\t)/.test(l) || blankLine(l)) { end++; continue; }
        break;
      }
      const cap = RE_INDENT_CODE.exec(lines.slice(i, end).join('\n'));
      if (cap) {
        const raw = trimTrailBlank(cap[0]);
        const text = raw.replace(/^(?: {0,3}\t| {1,4})/gm, '');
        const consumed = consumedLines(raw);
        nodes.push({ k: 'code', text, lang: '', ind: true });
        i += consumed;
        // skip any trailing blank lines the raw did not include
        while (i < b && blankLine(lines[i])) {
          // indented code may include trailing blank lines in its raw; those
          // were already counted if present. Only skip blanks that follow.
          break;
        }
        continue;
      }
      }
    }
    // fenced code
    {
      const f = fenceStart(line);
      if (f) {
        // bound the join to the closing fence line: joining to the end of
        // the block for every fence is quadratic on documents with many
        let end = b;
        for (let k = i + 1; k < b; k++) {
          const l = lines[k];
          let p = 0;
          while (l[p] === ' ') p++;
          if (p > 3) continue;
          let n = 0;
          while (l[p + n] === f.ch) n++;
          if (n < f.len) continue;
          let q = p + n;
          while (l[q] === ' ') q++;
          if (q >= l.length) { end = k + 1; break; }
        }
        const cap = RE_FENCE.exec(lines.slice(i, end).join('\n'));
        if (cap) {
          const raw = cap[0];
          let text = cap[3] || '';
          // indent compensation: remove up to the fence's indent from lines
          const m = /^(\s+)(?:```)/.exec(raw);
          if (m) {
            const ind = m[1];
            text = text.split('\n').map((ln) => {
              const mm = /^\s+/.exec(ln);
              if (!mm) return ln;
              return ln.slice(Math.min(mm[0].length, ind.length));
            }).join('\n');
          }
          let lang = '';
          if (cap[2]) lang = cap[2].trim().replace(/\\([\p{P}\p{S}])/gu, '$1');
          nodes.push({ k: 'code', text, lang });
          const consumed = consumedLines(raw);
          i += Math.max(1, consumed);
          continue;
        }
      }
    }
    // ATX heading
    {
      const h = atxHead(line);
      if (h) {
        let text = h.text.trim();
        if (text.endsWith('#')) {
          const t = rtrimChar(text, '#');
          if (!t || /[ \t]$/.test(t)) text = t.trim();
        }
        nodes.push({ k: 'h', d: h.depth, text });
        i++;
        continue;
      }
    }
    // hr
    if (isHrLine(line)) { nodes.push({ k: 'hr' }); i++; continue; }
    // blockquote
    {
      const { col, idx } = leadCount(line);
      if (col <= 3 && line[idx] === '>') {
        const r = parseBlockquote(lines, i, b, links);
        nodes.push(r.node);
        i = r.next;
        continue;
      }
    }
    // list
    {
      const bl = bulletOf(line);
      if (bl) {
        // a bullet that is actually an hr is handled above; check hr first
        if (!(line.trim().length >= 3 && /^[-*][ \t]*$/.test(line.trim()) && false)) {
          const r = parseList(lines, i, b, links);
          if (r) { nodes.push(r.node); i = r.next; continue; }
        }
      }
    }
    // html block
    {
      if (/^ {0,3}</.test(line)) {
      const cap = RE_HTML.exec(getRest());
      if (cap) {
        const raw = trimTrailBlank(cap[0]);
        nodes.push({ k: 'html', text: raw, pre: cap[1] === 'pre' || cap[1] === 'script' || cap[1] === 'style' });
        const consumed = consumedLines(raw);
        i += Math.max(1, consumed);
        continue;
      }
      }
    }
    // link reference definition (the title can span many lines, so the
    // join is not bounded here; it only runs on lines starting with '[')
    {
      if (/^ {0,3}\[/.test(line)) {
      const cap = RE_DEF.exec(getRest());
      if (cap) {
        const hrefRaw = cap[2];
        if (hrefRaw[0] !== '<' && findClosingBracket(hrefRaw, '(', ')') !== -1) {
          // not a definition; fall through
        } else {
          const raw = rtrimStr(cap[0], '\n');
          const tag = normLabel(cap[1]);
          if (!Object.prototype.hasOwnProperty.call(links, tag)) {
            let href = hrefRaw.replace(/^<(.*)>$/, '$1').replace(/\\([\p{P}\p{S}])/gu, '$1');
            let title = cap[3] ? cap[3].substring(1, cap[3].length - 1).replace(/\\([\p{P}\p{S}])/gu, '$1') : cap[3];
            links[tag] = { href, title: title || null };
          }
          const consumed = consumedLines(raw);
          if (hadBlank) nodes.hasBlankSep = true;
          i += Math.max(1, consumed);
          continue;
        }
      }
      }
    }
    // table
    if (isTableStart(lines, i)) {
      const r = parseTable(lines, i, b);
      nodes.push(r.node);
      i = r.next;
      continue;
    }
    // setext heading
    {
      const para = collectPara(lines, i, b, mode);
      if (para.next < b) {
        const u = lines[para.next];
        const m = RE_SETEXT.exec(u);
        if (m && para.text.trim() !== '') {
          nodes.push({ k: 'h', d: m[1][0] === '=' ? 1 : 2, text: para.text.trim() });
          i = para.next + 1;
          continue;
        }
      }
      // paragraph (or text when inside a list item)
      if (mode === 'text') {
        nodes.push({ k: 't', text: para.text });
      } else {
        nodes.push({ k: 'p', text: para.text });
      }
      i = para.next;
      continue;
    }
  }
  if (prevHadBlank && nodes.length > prevNodeCount) nodes.hasBlankSep = true;
  return nodes;
}

function parseTable(lines, i, b) {
  const header = splitCells(lines[i]);
  const delim = tableDelim(lines[i + 1]);
  const alignsRaw = delim.replace(/^\||\| *$/g, '').split('|');
  const align = alignsRaw.map((a) => {
    if (/^ *-+: *$/.test(a)) return 'right';
    if (/^ *:-+: *$/.test(a)) return 'center';
    if (/^ *:-+ *$/.test(a)) return 'left';
    return null;
  });
  const rows = [];
  let j = i + 2;
  while (j < b) {
    const line = lines[j];
    // a whitespace-only line ends the table, unless it contains a tab:
    // marked's table-row lookahead only excludes lines of spaces + newline,
    // so a tab-only line is a row of empty cells
    if (blankLine(line)) {
      if (!line.includes('\t')) break;
      rows.push(line);
      j++;
      continue;
    }
    if (isHrLine(line) || atxHead(line) || fenceStart(line)) break;
    const { col, idx } = leadCount(line);
    if (col <= 3 && line[idx] === '>') break;
    if (/^(?: {4}| {0,3}\t)[^\n]/.test(line)) break;
    if (RE_HTML_BEGIN.test(line)) break;
    const bl = bulletOf(line);
    if (bl && line.slice(bl.idx + bl.bull.length).length > 0 && (line[bl.idx + bl.bull.length] === ' ' || line[bl.idx + bl.bull.length] === '\t')) break;
    rows.push(line);
    j++;
  }
  return { node: { k: 'table', header, align, rows }, next: j };
}

function stripBqLines(chunk) {
  // Expand the whitespace after each '>' marker to the next tab stop,
  // then strip one marker (plus at most one space) per line.
  let joined = chunk.join('\n');
  joined = joined.replace(/^( {0,3}>)([ \t]+)/gm, (_, marker, ws) => marker + expandTabs(ws, marker.length));
  joined = joined.replace(/\n {0,3}((?:=+|-+)[ \t]*)(?=\n|$)/g, '\n    $1');
  joined = joined.replace(/^ {0,3}>[ \t]?/gm, '');
  return joined.split('\n');
}

function bqLazyInterrupt(line, lines, j, b) {
  // a lazy continuation line must not start a block that interrupts a paragraph
  if (isHrLine(line)) return true;
  if (/^ {0,3}#{1,6}(?:\s|$)/.test(line)) return true;
  if (/^ {0,3}(?:```|~~~)/.test(line)) return true;
  if (bulletOf(line)) return true;
  if (isTableStart(lines, j)) return true;
  if (RE_HTML_BEGIN.test(line)) return true;
  return false;
}
function isBqLine(line) {
  const { col, idx } = leadCount(line);
  return col <= 3 && line[idx] === '>';
}
function bqParse(chunk, links) {
  const stripped = stripBqLines(chunk);
  return { nodes: parseLines(stripped, 0, chunk.length, 'bq', links), stripped };
}
// Merge a separately parsed blockquote group into the quote's nodes, as
// marked does by calling blockTokens per group with lastParagraphClipped:
// an open paragraph absorbs a following paragraph as a continuation, and
// an indented code block (never a fenced one) merges into an open
// paragraph/text with its indent stripped. mergePara is false when a blank
// line (an empty '>' marker) separates the groups: marked then pushes a
// space token, which blocks the paragraph merge.
function mergeBqGroup(nodes, gnodes, mergePara = true) {
  if (!gnodes.length) return;
  const last = nodes[nodes.length - 1];
  // a group after a nested blockquote continues that blockquote (marked
  // re-parses the nested quote with the continuation lines): only the
  // group's first node, when it is itself a blockquote, merges into the
  // nested quote; the remaining nodes belong to this quote, not to the
  // nested one (the nested quote's re-parse only consumes its own lines)
  if (last && last.k === 'bq') {
    if (gnodes[0].k === 'bq') {
      mergeBqGroup(last.nodes, gnodes[0].nodes, mergePara);
      for (const n of gnodes.slice(1)) nodes.push(n);
    } else {
      for (const n of gnodes) nodes.push(n);
    }
    return;
  }
  const first = gnodes[0];
  if (mergePara && last && (last.k === 'p' || last.k === 't')) {
    if (first.k === 'code' && first.ind) { last.text += '\n' + first.text; gnodes = gnodes.slice(1); }
    else if (first.k === 'p' || first.k === 't') { last.text += '\n' + first.text; gnodes = gnodes.slice(1); }
  }
  for (const n of gnodes) nodes.push(n);
}
// A blockquote group ends (and the quote stops consuming lines) when its
// last token is a code block, heading, hr, html block or table: marked
// breaks out of the quote after such a group.
function bqGroupEndsQuote(nodes) {
  const last = nodes[nodes.length - 1];
  return !!last && (last.k === 'code' || last.k === 'h' || last.k === 'hr' || last.k === 'html' || last.k === 'table');
}
function parseBlockquote(lines, i, b, links) {
  // first group: consecutive lines starting with '>'
  // (a blank line ends the quote; marked splits '> a\n\n> b' in two)
  let chunk = [];
  let j = i;
  while (j < b && isBqLine(lines[j])) { chunk.push(lines[j]); j++; }
  let { nodes, stripped } = bqParse(chunk, links);
  // paraClosed: a blank line (an empty '>' marker, or the previous group
  // ending blank) separates paragraphs, so the next group must not merge
  // its first paragraph into the open one
  let paraClosed = stripped.length > 0 && stripped[stripped.length - 1].trim() === '';
  if (bqGroupEndsQuote(nodes)) return { node: { k: 'bq', nodes }, next: j };
  while (j < b) {
    const line = lines[j];
    if (blankLine(line)) break;
    if (isBqLine(line)) {
      // another '>' group: parse separately and merge, unless the last
      // node is a nested blockquote or a list -- then the group's lines
      // belong to that block (marked re-parses it with the continuation
      // lines appended), so re-parse the whole quote instead
      const extra = [];
      while (j < b && isBqLine(lines[j])) { extra.push(lines[j]); j++; }
      const last0 = nodes[nodes.length - 1];
      if (last0 && (last0.k === 'bq' || last0.k === 'list')) {
        chunk = chunk.concat(extra);
        ({ nodes, stripped } = bqParse(chunk, links));
        paraClosed = stripped.length > 0 && stripped[stripped.length - 1].trim() === '';
        if (bqGroupEndsQuote(nodes)) break;
        continue;
      }
      const g = bqParse(extra, links);
      const groupStartsBlank = g.stripped.length > 0 && g.stripped[0].trim() === '';
      mergeBqGroup(nodes, g.nodes, !paraClosed && !groupStartsBlank);
      stripped = g.stripped;
      paraClosed = stripped.length > 0 && stripped[stripped.length - 1].trim() === '';
      if (bqGroupEndsQuote(nodes)) break;
      continue;
    }
    const last = nodes[nodes.length - 1];
    if (!last || last.k === 'code' || last.k === 'h' || last.k === 'hr' || last.k === 'html' || last.k === 'table') break;
    // a blank line at the end of the quote closes the open paragraph, so
    // no lazy continuation follows it
    if (stripped.length && stripped[stripped.length - 1].trim() === '') break;
    // lazy group: consecutive non-blank, non-'>' lines that do not start
    // a block that interrupts a paragraph
    const lazy = [];
    while (j < b && !blankLine(lines[j]) && !isBqLine(lines[j]) && !bqLazyInterrupt(lines[j], lines, j, b)) {
      lazy.push(lines[j]);
      j++;
    }
    if (!lazy.length) break;
    // lazy lines after a list or nested blockquote belong to that block:
    // re-parse the whole quote so its parser sees them
    if (last.k === 'list' || last.k === 'bq') {
      chunk = chunk.concat(lazy);
      ({ nodes, stripped } = bqParse(chunk, links));
      paraClosed = stripped.length > 0 && stripped[stripped.length - 1].trim() === '';
      if (bqGroupEndsQuote(nodes)) break;
      continue;
    }
    const g = bqParse(lazy, links);
    stripped = g.stripped;
    mergeBqGroup(nodes, g.nodes, !paraClosed);
    paraClosed = false;
    if (bqGroupEndsQuote(nodes)) break;
  }
  return { node: { k: 'bq', nodes }, next: j };
}

// The six regexes that can end a list item, cached per effective indent
// (there are only four possible values). The break tests are dispatched on
// the first non-space character so a plain text line runs no regex at all.
const listBreakResCache = new Map();
function listBreakRes(effIndent) {
  let r = listBreakResCache.get(effIndent);
  if (!r) {
    r = {
      nextBullet: new RegExp(`^ {0,${effIndent}}(?:[*+-]|\\d{1,9}[.)])((?:[ \\t][^\\n]*)?(?:\\n|$))`),
      hr: new RegExp(`^ {0,${effIndent}}((?:-[ \\t]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,})(?:\\n+|$)`),
      fence: new RegExp(`^ {0,${effIndent}}(?:\`\`\`|~~~)`),
      head: new RegExp(`^ {0,${effIndent}}#{1,6}(?:\\s|$)`),
      html: new RegExp(`^ {0,${effIndent}}(?:</?(?:${TAGNAMES})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`, 'i'),
      bq: new RegExp(`^ {0,${effIndent}}>`)
    };
    listBreakResCache.set(effIndent, r);
  }
  return r;
}
function listLineBreaks(s, res, effIndent, includeBq) {
  let p = 0;
  while (s[p] === ' ') p++;
  if (p > effIndent) return false;
  const c = s[p];
  if (c === '`' || c === '~') return res.fence.test(s);
  if (c === '#') return res.head.test(s);
  if (c === '<') return res.html.test(s);
  if (c === '>' && includeBq) return res.bq.test(s);
  if (c === '*' || c === '+' || c === '-') return res.nextBullet.test(s) || res.hr.test(s);
  if (c >= '0' && c <= '9') return res.nextBullet.test(s);
  if (c === '_') return res.hr.test(s);
  return false;
}

function parseList(lines, i, b, links) {
  const first = bulletOf(lines[i]);
  if (!first) return null;
  const ordered = first.ordered;
  const startNum = ordered ? first.num : 0;
  const bullPat = ordered ? `\\d{1,9}\\${first.delim}` : `\\${first.bull}`;
  const itemRe = new RegExp(`^( {0,3}${bullPat})((?:[\\t ][^\\n]*)?(?:\\n|$))`);
  const items = [];
  let loose = false;
  let endsBlank = false;
  let j = i;
  let listRawLines = 0;
  while (j < b) {
    // run the item regex on the single line: joining all remaining lines
    // for every item is quadratic on long lists
    const cap = itemRe.exec(lines[j]);
    if (!cap) break;
    if (isHrLine(lines[j])) break;
    const itemStartLine = j;
    const firstLineRaw = cap[2].split('\n', 1)[0];
    const bulletIndent = cap[1].length;
    let line = firstLineRaw.replace(/^[ \t]+/, (w) => expandTabs(w, bulletIndent));
    let nextLineStr = j + 1 < b ? lines[j + 1] : '';
    let blankLineFlag = !line.trim();
    let indent = 0;
    let itemParts = [];
    if (blankLineFlag) {
      indent = bulletIndent + 1;
    } else {
      const m = /[^ ]/.exec(line);
      indent = m ? m.index : 0;
      if (indent > 4) indent = 1;
      itemParts.push(line.slice(indent));
      indent += bulletIndent;
    }
    let endEarly = false;
    let cur = j + 1; // next line index to examine
    if (blankLineFlag && blankLine(nextLineStr)) { cur = j + 2; endEarly = true; }
    if (!endEarly) {
      const effIndent = Math.max(0, Math.min(3, indent - 1));
      const res = listBreakRes(effIndent);
      while (cur < b) {
        const rawLine = lines[cur];
        // first non-space char (for the break dispatch) and blankness, in
        // one scan; tabs expand to spaces for the dedent below
        let p = 0;
        while (rawLine[p] === ' ') p++;
        let q = p;
        while (rawLine[q] === ' ' || rawLine[q] === '\t') q++;
        const isBlank = q >= rawLine.length;
        const nlNoTabs = (rawLine[0] === ' ' || rawLine[0] === '\t') ? rawLine.replace(/^[ \t]+/, (w) => expandTabs(w)) : rawLine;
        const nl = nlNoTabs;
        if (listLineBreaks(rawLine, res, effIndent, true)) break;
        // first non-space char of the expanded line, for the indent test
        let ns = 0;
        while (nlNoTabs[ns] === ' ') ns++;
        const nonSpace = ns >= nlNoTabs.length ? -1 : ns;
        if (nonSpace >= indent || isBlank) {
          itemParts.push(nlNoTabs.slice(indent));
        } else {
          if (blankLineFlag) break;
          const prev = line.replace(/\t/g, '    ');
          if (prev.search(/[^ ]/) >= 4) break;
          if (listLineBreaks(line, res, effIndent, false)) break;
          let cont = rawLine;
          if (/^ {0,3}(?:=+|-+) *$/.test(rawLine)) {
            const cand = `${line}\n${rawLine}`;
            const candLines = cand.split('\n');
            const p2 = collectPara(candLines, 0, candLines.length, 'text');
            if (p2.next < candLines.length && RE_SETEXT.test(candLines[p2.next])) {
              cont = '    ' + nlNoTabs.replace(/^ {0,3}/, '');
            }
          }
          itemParts.push(cont);
        }
        blankLineFlag = isBlank;
        cur++;
        line = nlNoTabs.slice(indent);
      }
    }
    const rawLines = lines.slice(itemStartLine, cur);
    const rawText = rawLines.join('\n');
    if (!loose) {
      if (endsBlank) loose = true;
      else if (/\n[ \t]*\n[ \t]*$/.test(rawText + '\n')) endsBlank = true;
    }
    items.push({ text: itemParts.join('\n'), raw: rawText, task: false, nodes: null, checked: false });
    j = cur;
    listRawLines = j - i;
    if (j >= b) break;
    // loop continues; itemRe on the next line decides
    if (!bulletOf(lines[j])) {
      // next line is not a bullet: list ends (the while loop's itemRe fails)
      break;
    }
  }
  if (!items.length) return null;
  const lastItem = items[items.length - 1];
  lastItem.raw = lastItem.raw.replace(/\s+$/, '');
  lastItem.text = lastItem.text.replace(/\s+$/, '');
  // tokenize items
  for (const item of items) {
    const sub = item.text.split('\n');
    item.nodes = parseLines(sub, 0, sub.length, 'text', links);
    item.task = /^\[[ xX]\][ \t]+\S/.test(item.text);
    if (!loose && item.nodes.hasBlankSep) loose = true;
  }
  // task checkboxes
  for (const item of items) {
    if (!item.task) continue;
    const firstNode = item.nodes[0];
    if (firstNode && (firstNode.k === 't' || firstNode.k === 'p')) {
      const m = /^\[[ xX]\][ \t]+/.exec(firstNode.text);
      if (m) {
        const checked = firstNode.text[1] !== ' ';
        item.checked = checked;
        firstNode.text = firstNode.text.replace(/^\[[ xX]\][ \t]+/, '');
        item.nodes.unshift({ k: 'cb', checked });
      } else item.task = false;
    } else item.task = false;
  }
  if (loose) {
    for (const item of items) {
      for (const n of item.nodes) if (n.k === 't') n.k = 'p';
    }
  }
  return { node: { k: 'list', ordered, start: ordered ? startNum : '', loose, items }, next: j };
}

// ---- inline emphasis patterns (GFM) ----
const RE_EM_L = /^(?:\*+(?:((?!~)[\p{P}\p{S}])|([^\s*]))?)|^_+(?:((?!_)(?!~)[\p{P}\p{S}])|([^\s_]))?/u;
const RE_EM_R_AST = new RegExp(
  '^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])'
  + '|(?!\\*)(?!~)[\\p{P}\\p{S}](\\*+)(?=[\\s]|$)'
  + '|(?:[^\\s\\p{P}\\p{S}]|~)(\\*+)(?!\\*)(?=(?:(?!~)[\\s\\p{P}\\p{S}]|$))'
  + '|(?!\\*)(?!~)[\\s\\p{P}\\p{S}](\\*+)(?=(?:[^\\s\\p{P}\\p{S}]|~))'
  + '|[\\s](\\*+)(?!\\*)(?=(?!~)[\\p{P}\\p{S}])'
  + '|(?!\\*)(?!~)[\\p{P}\\p{S}](\\*+)(?!\\*)(?=(?!~)[\\p{P}\\p{S}])'
  + '|(?:[^\\s\\p{P}\\p{S}]|~)(\\*+)(?=(?:[^\\s\\p{P}\\p{S}]|~))', 'gu');
const RE_EM_R_UND = new RegExp(
  '^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])'
  + '|(?!_)[\\p{P}\\p{S}](_+)(?=[\\s]|$)'
  + '|[^\\s\\p{P}\\p{S}](_+)(?!_)(?=[\\s\\p{P}\\p{S}]|$)'
  + '|(?!_)[\\s\\p{P}\\p{S}](_+)(?=[^\\s\\p{P}\\p{S}])'
  + '|[\\s](_+)(?!_)(?=[\\p{P}\\p{S}])'
  + '|(?!_)[\\p{P}\\p{S}](_+)(?!_)(?=[\\p{P}\\p{S}])', 'gu');
const RE_DEL_L = /^~~?(?:((?!~)[\p{P}\p{S}])|[^\s~])/u;
const RE_DEL_R = new RegExp(
  '^[^~]+(?=[^~])'
  + '|(?!~)[\\p{P}\\p{S}](~~?)(?=[\\s]|$)'
  + '|[^\\s\\p{P}\\p{S}](~~?)(?!~)(?=[\\s\\p{P}\\p{S}]|$)'
  + '|(?!~)[\\s\\p{P}\\p{S}](~~?)(?=[^\\s\\p{P}\\p{S}])'
  + '|[\\s](~~?)(?!~)(?=[\\p{P}\\p{S}])'
  + '|(?!~)[\\p{P}\\p{S}](~~?)(?!~)(?=[\\p{P}\\p{S}])'
  + '|[^\\s\\p{P}\\p{S}](~~?)(?=[^\\s\\p{P}\\p{S}])', 'gu');
const RE_REFLINK_SEARCH = /!?\[(?:[^\[\]\\`]*(?:\[(?:\[(?:\\[\s\S]|[^\[\]\\`])*\\]|\\[\s\S]|[^\[\]\\`])*?\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?\]\[((?!\s*\])(?:\\[\s\S]|[^\[\]\\`]){1,999})\]|!?\[(?:(?!\s*\])(?:\\[\s\S]|[^\[\]\\`]){1,999})\](?:\[\])?(?!\\\()/g;
const RE_BLOCKSKIP = /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)|(?<!`)()(?<b>`+)[^`]+\k<b>(?!`)|<(?! )[^<>]*?>/g;
const RE_ANYPUNCT_OUTSIDE = /(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\([\p{P}\p{S}])/gu;

function maskSrc(src, links) {
  let masked = src;
  if (links && src.indexOf('[') >= 0) {
    const maskReflink = (m0) => {
      const refStart = m0.lastIndexOf('[');
      if (!Object.prototype.hasOwnProperty.call(links, normLabel(m0.slice(refStart + 1, -1)))) return m0;
      if (refStart > 1 && m0.charAt(0) !== '!') {
        const text = m0.slice(1, refStart - 1);
        // if the text itself holds a link, mask only the links inside it
        if (text.indexOf('[') >= 0) {
          // approximate link-in-text check with the search regex
          RE_REFLINK_SEARCH.lastIndex = 0;
          if (RE_REFLINK_SEARCH.test(text)) {
            RE_REFLINK_SEARCH.lastIndex = 0;
            return '[' + text.replace(RE_REFLINK_SEARCH, maskReflink) + '][' + 'a'.repeat(m0.length - refStart - 2) + ']';
          }
        }
      }
      return '[' + 'a'.repeat(m0.length - 2) + ']';
    };
    RE_REFLINK_SEARCH.lastIndex = 0;
    masked = masked.replace(RE_REFLINK_SEARCH, maskReflink);
  }
  masked = masked.replace(RE_ANYPUNCT_OUTSIDE, (m0, code, punct) => {
    if (punct) return '+'.repeat(m0.length);
    if (code) return code + m0.slice(code.length, -code.length).replace(/`/g, '+') + code;
    return m0;
  });
  masked = masked.replace(RE_BLOCKSKIP, (m0, _l, ctx) => {
    const off = ctx ? ctx.length : 0;
    return m0.slice(0, off) + '[' + 'a'.repeat(Math.max(0, m0.length - off - 2)) + ']';
  });
  return masked;
}
function lastCloserIndex(masked, delim) {
  let last = -1;
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch !== '*' && ch !== '_' && ch !== '~') continue;
    const prev = i === 0 ? '\n' : masked[i - 1];
    let j = i + 1;
    while (j < masked.length && masked[j] === ch) j++;
    if (prev !== ' ' && prev !== '\t' && prev !== '\n' && prev !== '\r' && prev !== '\f') {
      if (delim === '~' ? ch === '~' : ch === delim) last = i;
    }
    i = j - 1;
  }
  return last;
}

// Inline rendering context, shared across one inline run.
function makeCtx() { return { inLink: false, inRawBlock: false, linkEmitted: false, parenPossible: true }; }

function inlineRender(src, links, ctx, plain) {
  if (!src) return '';
  const masked = (src.indexOf('*') >= 0 || src.indexOf('_') >= 0 || src.indexOf('~') >= 0) ? maskSrc(src, links) : src;
  const prevParen = ctx.parenPossible;
  ctx.parenPossible = prevParen && src.indexOf(')') >= 0;
  let out = '';
  let i = 0;
  let prevChar = '';
  let keepPrev = false;
  const n = src.length;
  while (i < n) {
    if (!keepPrev) prevChar = '';
    keepPrev = false;
    const ch = src[i];
    // escape
    if (ch === '\\') {
      const m = execAt(RE_ESCAPE_Y, src, i);
      if (m) {
        out += plain ? m[1] : escNoEncode(m[1]);
        i += m[0].length;
        continue;
      }
    }
    // tag
    if (ch === '<') {
      const m = execAt(RE_TAG_Y, src, i);
      if (m) {
        const tagText = m[0];
        if (!ctx.inLink && /^<a /i.test(tagText)) ctx.inLink = true;
        else if (ctx.inLink && /^<\/a>/i.test(tagText)) ctx.inLink = false;
        if (!ctx.inRawBlock && /^<(pre|code|kbd|script)(\s|>)/i.test(tagText)) ctx.inRawBlock = true;
        else if (ctx.inRawBlock && /^<\/(pre|code|kbd|script)(\s|>)/i.test(tagText)) ctx.inRawBlock = false;
        out += tagText;
        i += tagText.length;
        continue;
      }
    }
    // link / image
    if (ch === '[' || (ch === '!' && src[i + 1] === '[')) {
      const r = tryLink(src, i, links, ctx, plain);
      if (r) { out += r.html; i += r.len; continue; }
      const r2 = tryRefLink(src, i, links, ctx, plain);
      if (r2) {
        if (r2.textOnly) {
          // reflink with no matching definition renders only '[' as text
          out += plain ? r2.html : escNoEncode(r2.html);
          i += 1;
          continue;
        }
        out += r2.html; i += r2.len; continue;
      }
    }
    // emphasis / strong
    if (ch === '*' || ch === '_') {
      const r = tryEmphasis(src, i, masked, links, ctx, plain);
      if (r) { out += r.html; i += r.len; continue; }
    }
    // code span
    if (ch === '`') {
      const m = execAt(RE_CODE_Y, src, i);
      if (m) {
        let text = m[2].replace(/\n/g, ' ');
        const hasNon = /[^ ]/.test(text);
        const both = /^ /.test(text) && / $/.test(text);
        if (hasNon && both) text = text.substring(1, text.length - 1);
        out += plain ? text : '<code>' + escEncode(text) + '</code>';
        i += m[0].length;
        continue;
      }
    }
    // hard break
    if (ch === ' ' || ch === '\\') {
      const m = execAt(RE_BR_Y, src, i);
      if (m) { out += plain ? '' : '<br>'; i += m[0].length; continue; }
    }
    // strikethrough
    if (ch === '~') {
      const r = tryDel(src, i, masked, links, ctx, plain);
      if (r) { out += r.html; i += r.len; continue; }
    }
    // autolink
    if (ch === '<') {
      const m = execAt(RE_AUTOLINK_Y, src, i);
      if (m) {
        const text = m[1];
        const isEmail = !/^[a-zA-Z][a-zA-Z0-9+.-]{1,31}:/.test(text);
        const href = isEmail ? 'mailto:' + text : text;
        if (plain) out += text;
        else {
          const clean = cleanUrl(href);
          if (clean !== null) out += '<a href="' + escNoEncode(clean) + '">' + escEncode(text) + '</a>';
          else out += escEncode(text);
        }
        // autolinks never set linkEmitted in marked: only outputLink does,
        // so a link whose text contains an autolink is still created
        i += m[0].length;
        continue;
      }
    }
    // extended autolink (www / email / protocol)
    if (!ctx.inLink && !plain) {
      const m = execAt(RE_URL_Y, src, i);
      if (m) {
        let text, href;
        if (m[2] === '@') { text = m[0]; href = 'mailto:' + text; }
        else {
          let cap0 = m[0];
          let prev0;
          do { prev0 = cap0; cap0 = (RE_BACKPEDAL.exec(cap0) || [''])[0]; } while (prev0 !== cap0);
          text = cap0;
          href = m[1] === 'www.' ? 'http://' + cap0 : cap0;
        }
        const clean = cleanUrl(href);
        if (clean !== null) out += '<a href="' + escNoEncode(clean) + '">' + escEncode(text) + '</a>';
        else out += escEncode(text);
        // extended autolinks never set linkEmitted in marked (see above)
        i += text.length;
        continue;
      }
    }
    // text chunk
    const start = i;
    i = scanText(src, i, ctx, plain);
    if (i === start) { // safety: never stall
      out += plain ? src[i] : escNoEncode(src[i]);
      i++;
      continue;
    }
    const chunk = src.slice(start, i);
    if (plain) out += chunk;
    else if (ctx.inRawBlock) out += chunk;
    else out += escNoEncode(decodeNumeric(chunk));
    if (chunk[chunk.length - 1] !== '_') prevChar = chunk[chunk.length - 1];
    keepPrev = true;
  }
  ctx.parenPossible = prevParen;
  return out;
}

// Character helpers for the inline scanner (a regex test on one character
// is far slower than a code comparison when it runs on every character).
function isAlnumChar(c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
}
function isEmailWordChar(c) {
  return isAlnumChar(c) || c === '.' || c === '_' || c === '+' || c === '-';
}
function isWwwPrev(c) {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v' || c === '*' || c === '_' || c === '~' || c === '(';
}
function startsWithCI(s, i, word) {
  for (let k = 0; k < word.length; k++) {
    if ((s.charCodeAt(i + k) | 32) !== word.charCodeAt(k)) return false;
  }
  return true;
}
function isEmailWord(w) {
  if (!w) return false;
  for (let k = 0; k < w.length; k++) if (!isEmailWordChar(w[k])) return false;
  return true;
}
const RE_EMAIL_DOM = /^[a-zA-Z0-9\-_]+(?:\.[a-zA-Z0-9\-_]*[a-zA-Z0-9])+/;

function scanText(s, i, ctx, plain) {
  const n = s.length;
  let j = i;
  while (j < n) {
    const c = s[j];
    if (j === i && (c === '`' || c === '~')) {
      // a text chunk may start with a run of backticks/tildes (marked's
      // inline text regex allows that as its first character); the next
      // run of the same character ends the chunk instead
      while (j < n && s[j] === c) j++;
      continue;
    }
    if (c === '`' || c === '\\' || c === '<' || c === '[' || c === '*' || c === '~') break;
    if (c === '!') break;
    if (c === '_') break;
    // hard break: two or more spaces before a newline
    if (c === ' ' && j + 1 < n && s[j + 1] === ' ') {
      let k = j;
      while (k < n && s[k] === ' ') k++;
      if (s[k] === '\n') break;
      j = k;
      continue;
    }
    if (!ctx.inLink && !plain) {
      const c0 = s[j];
      if (c0 === 'w' && s.startsWith('www.', j) && (j === 0 || isWwwPrev(s[j - 1]))) break;
      // protocol prefixes, compared case-insensitively without allocating;
      // gated on the first character so the helper rarely runs
      if (c0 === 'h' || c0 === 'H') {
        if (startsWithCI(s, j, 'http://') || startsWithCI(s, j, 'https://')) break;
      } else if (c0 === 'f' || c0 === 'F') {
        if (startsWithCI(s, j, 'ftp://')) break;
      } else if (c0 === 'm' || c0 === 'M') {
        if (startsWithCI(s, j, 'mailto:')) break;
      } else if (c0 === 'x' || c0 === 'X') {
        if (startsWithCI(s, j, 'xmpp:')) break;
      }
      // email start: word boundary + word@domain
      if (isAlnumChar(c0) && (j === 0 || !isEmailWordChar(s[j - 1]))) {
        const at = s.indexOf('@', j, Math.min(n, j + 64));
        if (at > j) {
          const word = s.slice(j, at);
          if (isEmailWord(word)) {
            const dom = s.slice(at + 1, at + 129);
            if (RE_EMAIL_DOM.test(dom)) break;
          }
        }
      }
    }
    j++;
  }
  return j;
}

function isLabelEndInside(src, label, labelStart) {
  if (!label.includes('<')) return false;
  for (let k = 0; k < label.length; k++) {
    if (label[k] === '\\') { k++; continue; }
    if (label[k] === '`') {
      const code = RE_CODE.exec(label.slice(k));
      if (code) { k += code[0].length - 1; continue; }
    }
    if (label[k] !== '<') continue;
    const tokSrc = src.slice(labelStart + k);
    const tok = RE_TAG.exec(tokSrc) || RE_AUTOLINK.exec(tokSrc);
    if (!tok) continue;
    if (tok[0].length > label.length - k) return true;
    k += tok[0].length - 1;
  }
  return false;
}

function renderLinkText(text, links, ctx, plain) {
  const outerInLink = ctx.inLink, outerEmitted = ctx.linkEmitted, outerRaw = ctx.inRawBlock;
  ctx.inLink = true; ctx.linkEmitted = false;
  const html = inlineRender(text, links, ctx, plain);
  const hasLink = ctx.linkEmitted;
  ctx.linkEmitted = outerEmitted; ctx.inLink = outerInLink;
  return { html, hasLink, outerRaw };
}

function tryLink(src, i, links, ctx, plain) {
  if (ctx.parenPossible === false) return null;
  const sub = src.slice(i);
  const cap = RE_LINK.exec(sub);
  if (!cap) return null;
  const labelStart = cap[0][0] === '!' ? 2 : 1;
  if (isLabelEndInside(src, cap[1], i + labelStart)) return null;
  let hrefRaw = cap[2].trim();
  let title = cap[3] ? cap[3].slice(1, -1) : '';
  if (hrefRaw[0] === '<') {
    if (hrefRaw[hrefRaw.length - 1] !== '>') return null;
    const inner = rtrimStr(hrefRaw.slice(0, -1), '\\');
    if ((hrefRaw.length - inner.length) % 2 === 0) return null;
  } else {
    const lastParen = findClosingBracket(cap[2], '(', ')');
    if (lastParen === -2) return null;
    if (lastParen > -1) {
      const start = cap[0][0] === '!' ? 5 : 4;
      const linkLen = start + cap[1].length + lastParen;
      cap[2] = cap[2].substring(0, lastParen);
      cap[0] = cap[0].substring(0, linkLen).trim();
      cap[3] = '';
      title = '';
    }
  }
  const unesc = rtrimStr(cap[0].slice(0, -1), '\\');
  if ((cap[0].length - unesc.length) % 2 === 0) return null;
  let href = cap[2].trim();
  if (href[0] === '<') href = href.slice(1, -1);
  href = href ? href.replace(/\\([\p{P}\p{S}])/gu, '$1') : href;
  title = title ? title.replace(/\\([\p{P}\p{S}])/gu, '$1') : title;
  const isImage = cap[0][0] === '!';
  const text = cap[1].replace(/\\([\[\]])/g, '$1');
  const r = renderLinkText(text, links, ctx, isImage ? true : plain);
  // links may not contain other links, at any level: bail so the caller
  // falls through to text and the inner link is the one kept (images are
  // exempt; their text is flattened into the alt attribute)
  if (!isImage && r.hasLink) { ctx.inRawBlock = r.outerRaw; return null; }
  if (plain) { if (!isImage) ctx.linkEmitted = true; return { html: r.html, len: cap[0].length }; }
  if (!isImage) ctx.linkEmitted = true;
  if (isImage) {
    const alt = escNoEncode(r.html);
    const clean = cleanUrl(href);
    if (clean === null) return { html: alt, len: cap[0].length };
    let out = '<img src="' + escNoEncode(clean) + '" alt="' + alt + '"';
    if (title) out += ' title="' + escNoEncode(title) + '"';
    return { html: out + '>', len: cap[0].length };
  }
  const clean = cleanUrl(href);
  if (clean === null) return { html: r.html, len: cap[0].length };
  let out = '<a href="' + escNoEncode(clean) + '"';
  if (title) out += ' title="' + escNoEncode(title) + '"';
  return { html: out + '>' + r.html + '</a>', len: cap[0].length };
}

function tryRefLink(src, i, links, ctx, plain) {
  const sub = src.slice(i);
  let cap = RE_REFLINK.exec(sub) || RE_NOLINK.exec(sub);
  if (!cap) return null;
  const labelStart = cap[0][0] === '!' ? 2 : 1;
  if (isLabelEndInside(src, cap[1], i + labelStart)) return null;
  const link = links[normLabel(cap[2] || cap[1])];
  if (!link) return { textOnly: true, html: cap[0][0], len: 1 };
  const isImage = cap[0][0] === '!';
  const text = cap[1].replace(/\\([\[\]])/g, '$1');
  const r = renderLinkText(text, links, ctx, isImage ? true : plain);
  if (!isImage && r.hasLink) { ctx.inRawBlock = r.outerRaw; return null; }
  if (plain) { if (!isImage) ctx.linkEmitted = true; return { html: r.html, len: cap[0].length }; }
  if (!isImage) ctx.linkEmitted = true;
  if (isImage) {
    const alt = escNoEncode(r.html);
    const clean = cleanUrl(link.href);
    if (clean === null) return { html: alt, len: cap[0].length };
    let out = '<img src="' + escNoEncode(clean) + '" alt="' + alt + '"';
    if (link.title) out += ' title="' + escNoEncode(link.title) + '"';
    return { html: out + '>', len: cap[0].length };
  }
  const clean = cleanUrl(link.href);
  if (clean === null) return { html: r.html, len: cap[0].length };
  let out = '<a href="' + escNoEncode(clean) + '"';
  if (link.title) out += ' title="' + escNoEncode(link.title) + '"';
  return { html: out + '>' + r.html + '</a>', len: cap[0].length };
}

function tryEmphasis(src, i, masked, links, ctx, plain) {
  const sub = src.slice(i);
  const match = RE_EM_L.exec(sub);
  if (!match) return null;
  if (!match[1] && !match[2] && !match[3] && !match[4]) return null;
  const delim = match[0][0];
  const midRun = i > 0 && src[i - 1] === delim;
  const srcStart = masked.length - sub.length;
  let runStart = srcStart;
  while (runStart > 0 && masked[runStart - 1] === delim) runStart--;
  const runPrev = runStart > 0 ? [...masked.slice(Math.max(0, runStart - 2), runStart)].at(-1) ?? '' : '';
  const runPrevPunct = runPrev === '*' || runPrev === '_' || isPunct(runPrev);
  let prevChar = i > 0 ? src[i - 1] : '';
  if (runStart < srcStart) prevChar = runPrev;
  const prevPunct = runStart < srcStart ? runPrevPunct : isPunct(prevChar);
  if (match[4] && isAlnum(prevChar)) return null;
  const nextChar = match[1] || match[3] || '';
  if (nextChar && prevChar && !prevPunct) return null;
  const lLen = [...match[0]].length - 1;
  const runLen = srcStart - runStart + lLen;
  const openerCanClose = !!runPrev.trim() && (!!nextChar || (delim === '*' && !runPrevPunct));
  const endRe = delim === '*' ? RE_EM_R_AST : RE_EM_R_UND;
  const lastIdx = lastCloserIndex(masked, delim);
  const windowStart = masked.length - sub.length + lLen;
  if (lastIdx < windowStart) return null;
  const windowMasked = masked.slice(-sub.length + lLen);
  const lastInWindow = lastIdx - windowStart;
  endRe.lastIndex = 0;
  let delimTotal = lLen, midTotal = 0, m;
  while ((m = endRe.exec(windowMasked)) !== null) {
    if (m.index > lastInWindow) break;
    const rDelim = m[1] || m[2] || m[3] || m[4] || m[5] || m[6];
    if (!rDelim) continue;
    const rLen = [...rDelim].length;
    if (m[3] || m[4]) { delimTotal += rLen; continue; }
    else if (m[5] || m[6] || openerCanClose) {
      if (midRun && (m[5] || m[6])) break;
      if (runLen % 3 && !((runLen + rLen) % 3)) { midTotal += rLen; continue; }
    }
    delimTotal -= rLen;
    if (delimTotal > 0) continue;
    const used = Math.min(rLen, rLen + delimTotal + midTotal);
    const firstLen = [...m[0]][0].length;
    const raw = sub.slice(0, lLen + m.index + firstLen + used);
    const inner = raw.slice(1, -1);
    if (Math.min(lLen, used) % 2) {
      const html = plain ? inlineRender(inner, links, ctx, true) : '<em>' + inlineRender(inner, links, ctx, false) + '</em>';
      return { html, len: raw.length };
    }
    const inner2 = raw.slice(2, -2);
    const html2 = plain ? inlineRender(inner2, links, ctx, true) : '<strong>' + inlineRender(inner2, links, ctx, false) + '</strong>';
    return { html: html2, len: raw.length };
  }
  return null;
}

function tryDel(src, i, masked, links, ctx, plain) {
  const sub = src.slice(i);
  const match = RE_DEL_L.exec(sub);
  if (!match) return null;
  const nextChar = match[1] || '';
  const prevChar = i > 0 ? src[i - 1] : '';
  if (!nextChar || !prevChar || isPunct(prevChar)) {
    const lLen = [...match[0]].length - 1;
    let delimTotal = lLen;
    const lastIdx = lastCloserIndex(masked, '~');
    const windowStart = masked.length - sub.length + lLen;
    if (lastIdx < windowStart) return null;
    const windowMasked = masked.slice(-sub.length + lLen);
    const lastInWindow = lastIdx - windowStart;
    RE_DEL_R.lastIndex = 0;
    let m;
    while ((m = RE_DEL_R.exec(windowMasked)) !== null) {
      if (m.index > lastInWindow) break;
      const rDelim = m[1] || m[2] || m[3] || m[4] || m[5] || m[6];
      if (!rDelim) continue;
      const rLen = [...rDelim].length;
      if (rLen !== lLen) continue;
      if (m[3] || m[4]) { delimTotal += rLen; continue; }
      delimTotal -= rLen;
      if (delimTotal > 0) continue;
      const used = Math.min(rLen, rLen + delimTotal);
      const firstLen = [...m[0]][0].length;
      const raw = sub.slice(0, lLen + m.index + firstLen + used);
      const inner = raw.slice(lLen, -lLen);
      const html = plain ? inlineRender(inner, links, ctx, true) : '<del>' + inlineRender(inner, links, ctx, false) + '</del>';
      return { html, len: raw.length };
    }
  }
  return null;
}

// ---- block rendering ----
function entryRender(src, links, ctx) {
  ctx.inRawBlock = false;
  ctx.linkEmitted = false;
  return inlineRender(src, links, ctx, false);
}
function renderNodes(nodes, links, out, ctx) {
  for (const node of nodes) {
    switch (node.k) {
      case 'p': {
        out.push('<p>', entryRender(node.text, links, ctx), '</p>\n');
        break;
      }
      case 't': {
        out.push(entryRender(node.text, links, ctx));
        break;
      }
      case 'h': {
        out.push('<h', String(node.d), '>', entryRender(node.text, links, ctx), '</h', String(node.d), '>\n');
        break;
      }
      case 'hr': out.push('<hr>\n'); break;
      case 'code': {
        const lang = (node.lang || '').match(/^\S*/)?.[0] || '';
        const code = node.text ? node.text.replace(/\n$/, '') + '\n' : '';
        if (!lang) out.push('<pre><code>', escEncode(code), '</code></pre>\n');
        else out.push('<pre><code class="language-', escNoEncode(lang), '">', escEncode(code), '</code></pre>\n');
        break;
      }
      case 'html': out.push(node.text); break;
      case 'bq': {
        const inner = [];
        renderNodes(node.nodes, links, inner, ctx);
        out.push('<blockquote>\n', inner.join(''), '</blockquote>\n');
        break;
      }
      case 'list': {
        const body = [];
        for (const item of node.items) body.push(renderListItem(item, node.loose, links, ctx));
        const type = node.ordered ? 'ol' : 'ul';
        const startAttr = node.ordered && node.start !== 1 && node.start !== '' ? ' start="' + node.start + '"' : '';
        out.push('<', type, startAttr, '>\n', body.join(''), '</', type, '>\n');
        break;
      }
      case 'table': {
        const headerParts = [];
        for (let j = 0; j < node.header.length; j++) {
          const cell = node.header[j];
          const align = node.align[j];
          headerParts.push('<th' + (align ? ' align="' + align + '"' : '') + '>' + entryRender(cell, links, ctx) + '</th>\n');
        }
        const bodyParts = [];
        for (const row of node.rows) {
          const cells = splitCells(row, node.header.length);
          const rowParts = [];
          for (let k = 0; k < cells.length; k++) {
            const align = node.align[k];
            rowParts.push('<td' + (align ? ' align="' + align + '"' : '') + '>' + entryRender(cells[k], links, ctx) + '</td>\n');
          }
          bodyParts.push('<tr>\n' + rowParts.join('') + '</tr>\n');
        }
        out.push('<table>\n<thead>\n<tr>\n', headerParts.join(''), '</tr>\n</thead>\n', bodyParts.length ? '<tbody>' + bodyParts.join('') + '</tbody>' : '', '</table>\n');
        break;
      }
    }
  }
}
function renderListItem(item, loose, links, ctx) {
  const nodes = item.nodes.slice();
  let prefix = '';
  if (nodes.length && nodes[0].k === 'cb') {
    const cb = nodes.shift();
    prefix = '<input ' + (cb.checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ';
    if (loose && nodes.length && (nodes[0].k === 'p' || nodes[0].k === 't')) {
      // in a loose list the checkbox lives inside the first paragraph
      const first = nodes[0];
      const inner = [];
      renderNodes([first], links, inner, ctx);
      // renderNodes wrapped it in <p>...</p>; inject the checkbox after <p>
      const html = inner.join('');
      const rest = nodes.slice(1);
      const tail = [];
      renderNodes(rest, links, tail, ctx);
      return '<li>' + html.replace('<p>', '<p>' + prefix) + tail.join('') + '</li>\n';
    }
    if (!loose) {
      const tail = [];
      renderNodes(nodes, links, tail, ctx);
      return '<li>' + prefix + tail.join('') + '</li>\n';
    }
  }
  const body = [];
  renderNodes(nodes, links, body, ctx);
  return '<li>' + body.join('') + '</li>\n';
}

export function parse(markdown) {
  if (!markdown) return '';
  const src = markdown.indexOf('\r') >= 0 ? markdown.replace(/\r\n|\r/g, '\n') : markdown;
  const links = Object.create(null);
  const lines = src.split('\n');
  const nodes = parseLines(lines, 0, lines.length, 'top', links);
  const out = [];
  renderNodes(nodes, links, out, makeCtx());
  return out.join('');
}
