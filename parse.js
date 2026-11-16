const RE_BLOCKQUOTE = /^( {0,3}> ?(?:(?![ \t]*(?:\n|$))(([^\n]+(?:\n(?! {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)| {0,3}#{1,6}(?:\s|$)| {0,3}>| {0,3}(?:`{3,}(?=[^`\n]*(?:\n|$))|~~~)[^\n]*(?:\n|$)| {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)| {0,3}(?:<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?: +|\n|\/?>)|<(?:(?:script|pre|style|textarea)(?:[\s>]|$)|!--)|<\?|<![A-Za-z]|<!\[CDATA\[)|[ \t]+\n)[^\n]+)*))|[^\n]*)(?:\n|$))+/;
// Block grammars adapted from marked 18.1.3 (MIT; see NOTICE).
const RE_LHEADING = /^(?! {0,3}(?:[*+-]|\d{1,9}[.)]) |(?: {4}| {0,3}\t)| {0,3}(?:`{3,}|~{3,})| {0,3}>| {0,3}#{1,6}(?:\s|$)| {0,3}<[^\n>]+>\n| {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n)((?:.|\n(?!\s*?\n| {0,3}(?:[*+-]|\d{1,9}[.)]) | {0,3}(?:`{3,}|~{3,})| {0,3}>| {0,3}#{1,6}(?:\s|$)| {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)| {0,3}<[^\n>]+>\n| {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n))+?)\n {0,3}(=+|-+)[ \t]*(?:\n+|$)/;
const RE_PARAGRAPH = /^([^\n]+(?:\n(?! {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)| {0,3}#{1,6}(?:\s|$)| {0,3}>| {0,3}(?:`{3,}(?=[^`\n]*(?:\n|$))|~~~)[^\n]*(?:\n|$)| {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t\n]| {0,3}(?:<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?: +|\n|\/?>)|<(?:(?:script|pre|style|textarea)(?:[\s>]|$)|!--)|<\?|<![A-Za-z]|<!\[CDATA\[)| *([^\n ].*)\n {0,3}((?:\| *)?:?-+:? *(?:\| *:?-+:? *)*(?:\| *)?)(?:\n((?:(?! *\n| {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)| {0,3}#{1,6}(?:\s|$)| {0,3}>|(?: {4}| {0,3}	)[^\n]| {0,3}(?:`{3,}(?=[^`\n]*(?:\n|$))|~~~)[^\n]*(?:\n|$)| {0,3}(?:[*+-]|1[.)])[ \t]| {0,3}(?:<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?: +|\n|\/?>)|<(?:(?:script|pre|style|textarea)(?:[\s>]|$)|!--)|<\?|<![A-Za-z]|<!\[CDATA\[)).*(?:\n|$))*)\n*|$)|[ \t]+\n)[^\n]+)*)/;
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
  return ESC_ANY_RE.test(s) ? s.replace(ESC_RE, (c) => ESC_MAP[c]) : s;
}
const ESC_ANY_RE = /[<>"'&]/;
function escNoEncode(s) {
  // one regex test replaces five indexOf scans; chunks are short
  return ESC_ANY_RE.test(s) ? s.replace(ESC_NOENC_RE, (c) => ESC_MAP[c] || '&amp;') : s;
}
// Fused text-chunk escape: check every character needing HTML escaping.
// The exact GFM scanner can consume a leading unmatched '<'
// (it is a scan special), so only &, > " ' can need work. One regex
// test replaces decodeNumeric's '&' check plus escNoEncode's five
// indexOf scans on the common no-entity chunk.
const ESC_TEXT_RE = /[&<>"']/;
function escText(s) {
  if (!ESC_TEXT_RE.test(s)) return s;
  return escNoEncode(decodeNumeric(s));
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
  // encodeURI only produces %25 by encoding a '%' from the input, so
  // when the input holds no '%' the replace is a no-op scan; skip it
  try { const e = encodeURI(href); return href.indexOf('%') < 0 ? e : e.replace(/%25/g, '%'); } catch { return null; }
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
const IS_PUNCT_RE = /[\s\p{P}\p{S}]/u;
function isPunct(ch) {
  if (!ch || ch === '*' || ch === '_') return false;
  const c = ch.charCodeAt(0);
  if (c < 128) {
    return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126)
      || c === 9 || c === 10 || c === 11 || c === 12 || c === 13 || c === 32;
  }
  return IS_PUNCT_RE.test(ch);
}
function isAlnum(ch) {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  if (c < 128) return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
  return ALNUM_RE.test(ch);
}

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
  // keep the source regex's flags (notably 'u' for \p{...} patterns),
  // replacing 'g' with sticky 'y' so execAt matches at the offset
  // without slicing the remaining source first
  return new RegExp(out, re.flags.replace('g', '') + 'y');
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
const RE_LINK_Y = stickyOf(RE_LINK);
const RE_REFLINK_Y = stickyOf(RE_REFLINK);
const RE_NOLINK_Y = stickyOf(RE_NOLINK);

// ---- block helpers (line based) ----
function blankLine(s) {
  // the old /^[ \t]*$/ test coerced non-strings (undefined lines past
  // the end of a section, as parseList can pass) to "undefined"/"null"
  // and returned false; keep that behaviour instead of throwing
  if (typeof s !== 'string') return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}
// /^(?: {4}[^\n]| {0,3}\t)/ as char checks: the same test runs on
// every line of parseLines/collectPara, and a regex setup per line is
// slower than a few charCodeAt comparisons. Lines handed here are
// newline-free, so the {4} arm needs no fifth-character check beyond
// the line being non-blank (callers already ensure that, or check
// blankLine alongside).
function isIndentCodeStart(line) {
  if (typeof line !== 'string') return false;
  if (line.charCodeAt(0) === 9) return true;
  if (line.charCodeAt(0) !== 32) return false;
  if (line.charCodeAt(1) === 9) return true;
  if (line.charCodeAt(1) !== 32) return false;
  if (line.charCodeAt(2) === 9) return true;
  if (line.charCodeAt(2) !== 32) return false;
  if (line.charCodeAt(3) === 9) return true;
  return line.charCodeAt(3) === 32;
}
function consumedLines(raw) {
  if (!raw) return 0;
  const nl = (raw.match(/\n/g) || []).length;
  return raw.endsWith('\n') ? nl : nl + 1;
}
// leadCount runs on nearly every line several times (bullet, heading,
// hr, fence and blockquote checks each call it), and every call used
// to allocate a fresh {col, idx} object. All callers read the values
// immediately (or call it again on the same line, which yields the
// same values), so one shared result object is exact here and cuts
// thousands of small allocations per document.
const LEAD = { col: 0, idx: 0 };
function leadCount(s) {
  let i = 0, col = 0;
  while (i < s.length && (s[i] === ' ' || s[i] === '\t')) {
    if (s[i] === '\t') col += 4 - (col % 4); else col++;
    i++;
  }
  LEAD.col = col; LEAD.idx = i;
  return LEAD;
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
  if (ch === '`' && s.indexOf('`', idx + n) >= 0) return null;
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
  // a table delimiter always contains '-'; most lines' next line does
  // not, so this cheap check skips the delimiter regex (and the
  // header split) for nearly every paragraph line
  const dl = lines[i + 1];
  if (!dl || dl.indexOf('-') < 0) return false;
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
    if (mode === 'text' && j > i && isIndentCodeStart(line)) {
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

function parseLines(lines, a, b, mode, links, nodes = [], mergeParagraphs = false) {
  let pendingBlank = false;
  let prevHadBlank = false;
  let prevNodeCount = 0;
  let i = a;
  let source = null, sourceLine = a, sourceOffset = 0;
  function getRest() {
    if (source === null) {
      source = lines.slice(i, b).join('\n');
      sourceLine = i;
    }
    while (sourceLine < i) sourceOffset += lines[sourceLine++].length + 1;
    return source.slice(sourceOffset);
  }
  while (i < b) {
    let skippedBlanks = 0;
    while (i < b && blankLine(lines[i])) { if (nodes.length) skippedBlanks++; i++; }
    if (i >= b) {
      if (skippedBlanks >= 2) nodes.hasBlankSep = true;
      break;
    }
    const line = lines[i];
    const leading = leadCount(line);
    const firstChar = line[leading.idx];
    if (nodes.length > 0) {
      if (skippedBlanks > 0) nodes.hasBlankSep = true;
      else if (i > 0 && blankLine(lines[i - 1])) nodes.hasBlankSep = true;
    }
    if (prevHadBlank && nodes.length > prevNodeCount) nodes.hasBlankSep = true;
    const hadBlank = skippedBlanks > 0 || pendingBlank;
    pendingBlank = false;
    prevHadBlank = hadBlank;
    prevNodeCount = nodes.length;
    // Ordinary paragraph starts cannot introduce any of these block types.
    if (leading.col >= 4 || '0123456789#*_~`>+-<['.includes(firstChar)) {
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
        const cap = RE_INDENT_CODE.exec(lines.slice(i, end).join('\n') + (end < b ? '\n' : ''));
        if (cap) {
          const raw = trimTrailBlank(cap[0]);
          const text = raw.replace(/^(?: {0,3}\t| {1,4})/gm, '');
          const consumed = consumedLines(raw);
          const previous = nodes[nodes.length - 1];
          if (!hadBlank && previous && (previous.k === 't' || previous.k === 'p')) previous.text += '\n' + text;
          else nodes.push({ k: 'code', text, lang: '', ind: true });
          i += consumed;
          continue;
        }
        }
      }
      // fenced code
      {
        const f = (firstChar === '`' || firstChar === '~') && fenceStart(line);
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
        const h = firstChar === '#' && atxHead(line);
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
      if ((firstChar === '-' || firstChar === '*' || firstChar === '_') && isHrLine(line)) { nodes.push({ k: 'hr' }); i++; continue; }
      // blockquote
      {
        const { col, idx } = leadCount(line);
        if (col <= 3 && line[idx] === '>') {
          const r = parseBlockquote(lines, i, b, links, getRest());
          nodes.push(r.node);
          i = r.next;
          continue;
        }
      }
      // list
      {
        const bl = (firstChar === '-' || firstChar === '*' || firstChar === '+' || (firstChar >= '0' && firstChar <= '9')) && bulletOf(line);
        if (bl) {
          const r = parseList(lines, i, b, links, bl);
          if (r) {
            nodes.push(r.node);
            if (r.tail) {
              const rest = (r.tail + (r.next < b ? '\n' + lines.slice(r.next, b).join('\n') : '')).split('\n');
              nodes.push(...parseLines(rest, 0, rest.length, 'top', links));
              i = b;
            } else i = r.next;
            mode = 'top';
            continue;
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
            const previous = nodes[nodes.length - 1];
            if (!hadBlank && previous && (previous.k === 't' || previous.k === 'p')) previous.text += '\n' + raw;
            else if (!Object.prototype.hasOwnProperty.call(links, tag)) {
              let href = hrefRaw.replace(/^<(.*)>$/, '$1').replace(/\\([\p{P}\p{S}])/gu, '$1');
              let title = cap[3] ? cap[3].substring(1, cap[3].length - 1).replace(/\\([\p{P}\p{S}])/gu, '$1') : cap[3];
              links[tag] = { href, title: title || null };
            }
            if (!previous || hadBlank || (previous.k !== 't' && previous.k !== 'p')) nodes.push({ k: 'def' });
            const consumed = consumedLines(raw);
            if (hadBlank) nodes.hasBlankSep = true;
            i += Math.max(1, consumed);
            continue;
          }
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
    const remaining = getRest();
    // Setext headings are rare, but RE_LHEADING is a heavy backtracking
    // regex run over the whole remainder on every paragraph. It can only
    // match when a later line of this paragraph block (before the next
    // blank line) is a setext underline, so skip it unless one exists.
    let maybeSetext = false;
    for (let k = i + 1; k < b; k++) {
      const lk = lines[k];
      if (blankLine(lk)) break;
      if (RE_SETEXT.test(lk)) { maybeSetext = true; break; }
    }
    const heading = maybeSetext ? RE_LHEADING.exec(remaining) : null;
    if (heading) {
      nodes.push({ k: 'h', d: heading[2][0] === '=' ? 1 : 2, text: heading[1].trim() });
      i += consumedLines(rtrimStr(heading[0], '\n'));
      continue;
    }
    const cap = mode === 'text' ? /^[^\n]+/.exec(remaining) : RE_PARAGRAPH.exec(remaining);
    const raw = cap ? cap[0] : line;
    const text = mode === 'text' ? raw : (cap ? cap[1].replace(/\n$/, '') : line);
    const previous = nodes[nodes.length - 1];
    if (mode === 'text') {
      if (!hadBlank && previous?.k === 't') previous.text += '\n' + text;
      else nodes.push({ k: 't', text });
    } else if (mergeParagraphs && !hadBlank && previous?.k === 'p') previous.text += '\n' + text;
    else nodes.push({ k: 'p', text });
    i += Math.max(1, consumedLines(raw));
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
    if (bl && (!bl.ordered || bl.num === 1) && line.slice(bl.idx + bl.bull.length).length > 0 && (line[bl.idx + bl.bull.length] === ' ' || line[bl.idx + bl.bull.length] === '\t')) break;
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

function isBqLine(line) {
  const { col, idx } = leadCount(line);
  return col <= 3 && line[idx] === '>';
}
function parseBlockquote(sourceLines, start, end, links, source) {
  source ??= sourceLines.slice(start, end).join('\n');
  const cap = RE_BLOCKQUOTE.exec(source);
  let lines = rtrimStr(cap[0], '\n').split('\n');
  let raw = '';
  const nodes = [];
  while (lines.length) {
    let sawMarker = false, count = 0;
    for (; count < lines.length; count++) {
      if (isBqLine(lines[count])) sawMarker = true;
      else if (sawMarker) break;
    }
    const group = lines.slice(0, count);
    lines = lines.slice(count);
    const groupRaw = group.join('\n');
    const stripped = stripBqLines(group);
    raw += (raw ? '\n' : '') + groupRaw;
    parseLines(stripped, 0, stripped.length, 'bq', links, nodes, true);
    if (!lines.length) break;
    const last = nodes.at(-1);
    if (last && ['code', 'h', 'hr', 'html', 'table'].includes(last.k)) break;
    if (last?.k === 'bq') {
      const continuation = lines.join('\n').replace(/^ {0,3}>[ \t]?/gm, '');
      const combined = last.raw + '\n' + continuation;
      const restLines = combined.split('\n');
      const nested = parseBlockquote(restLines, 0, restLines.length, links, combined);
      nodes[nodes.length - 1] = nested.node;
      const leftover = combined.slice(nested.node.raw.length).replace(/^\n/, '');
      const leftoverCount = leftover ? leftover.split('\n').length : 0;
      const consumed = leftoverCount ? lines.slice(0, -leftoverCount) : lines;
      if (consumed.length) raw += '\n' + consumed.join('\n');
      lines = lines.slice(consumed.length);
      if (lines.length && isBqLine(lines[0])) continue;
      break;
    }
    if (last?.k === 'list') {
      const combined = last.raw + '\n' + lines.join('\n');
      const restLines = combined.split('\n');
      const list = parseList(restLines, 0, restLines.length, links, bulletOf(restLines[0]));
      nodes[nodes.length - 1] = list.node;
      const consumed = list.node.raw.length > last.raw.length
        ? combined.slice(last.raw.length + 1, list.node.raw.length).split('\n').length : 0;
      if (consumed) raw += '\n' + lines.slice(0, consumed).join('\n');
      lines = lines.slice(consumed);
    }
  }
  return { node: { k: 'bq', nodes, raw }, next: start + consumedLines(raw) };
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
  if (c === '*' || c === '+' || c === '-') return (includeBq && res.nextBullet.test(s)) || res.hr.test(s);
  if (c >= '0' && c <= '9') return includeBq && res.nextBullet.test(s);
  if (c === '_') return res.hr.test(s);
  return false;
}

const LIST_ITEM_RE = {
  '*': /^( {0,3}\*)((?:[\t ][^\n]*)?(?:\n|$))/,
  '+': /^( {0,3}\+)((?:[\t ][^\n]*)?(?:\n|$))/,
  '-': /^( {0,3}\-)((?:[\t ][^\n]*)?(?:\n|$))/,
  '.': /^( {0,3}\d{1,9}\.)((?:[\t ][^\n]*)?(?:\n|$))/,
  ')': /^( {0,3}\d{1,9}\))((?:[\t ][^\n]*)?(?:\n|$))/,
};
function parseList(lines, i, b, links, first) {
  const ordered = first.ordered;
  const startNum = ordered ? first.num : 0;
  const itemRe = LIST_ITEM_RE[ordered ? first.delim : first.bull];
  const items = [];
  let loose = false;
  let endsBlank = false;
  let j = i, lastStart = i;
  while (j < b) {
    // run the item regex on the single line: joining all remaining lines
    // for every item is quadratic on long lists
    const cap = itemRe.exec(lines[j]);
    if (!cap) break;
    if ((first.bull === '-' || first.bull === '*') && isHrLine(lines[j])) break;
    const itemStartLine = j;
    lastStart = j;
    const firstLineRaw = cap[2].split('\n', 1)[0];
    const bulletIndent = cap[1].length;
    let line = firstLineRaw.includes('\t') ? firstLineRaw.replace(/^[ \t]+/, (w) => expandTabs(w, bulletIndent)) : firstLineRaw;
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
    if (blankLineFlag && !nextLineStr.trim()) { cur = j + 2; endEarly = true; }
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
        // Blank = only spaces/tabs: q already scanned exactly that, so
        // this avoids a trim() allocation on every list line. Lines are
        // newline-free and \r-free here (parse() normalises \r first),
        // matching blankLine's space/tab-only test.
        const isBlank = q >= rawLine.length;
        const nlNoTabs = rawLine.indexOf('\t') >= 0 ? rawLine.replace(/^[ \t]+/, (w) => expandTabs(w)) : rawLine;
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
            if (RE_LHEADING.test(cand)) {
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
    if (!loose) {
      if (endsBlank) loose = true;
      else if (Math.min(cur, lines.length) > itemStartLine + 1 && blankLine(lines[Math.min(cur, lines.length) - 1])) endsBlank = true;
    }
    items.push({ lines: itemParts, task: false, nodes: null, checked: false });
    j = cur;
    if (j >= b) break;
  }
  if (!items.length) return null;
  const lastItem = items[items.length - 1];
  while (lastItem.lines.length && !lastItem.lines.at(-1).trimEnd()) lastItem.lines.pop();
  if (lastItem.lines.length) lastItem.lines[lastItem.lines.length - 1] = lastItem.lines.at(-1).trimEnd();
  // tokenize items
  for (const item of items) {
    const sub = item.lines;
    item.nodes = parseLines(sub, 0, sub.length, 'text', links);
    item.task = /^\[[ xX]\][ \t]+\S/.test(item.lines[0] || '');
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
  let tail = '';
  const rawEnd = Math.min(j, b);
  for (let k = rawEnd - 1; k >= lastStart; k--) {
    const trimmed = lines[k].trimEnd();
    tail = lines[k].slice(trimmed.length) + (k + 1 < rawEnd ? '\n' + lines.slice(k + 1, rawEnd).join('\n') : '');
    if (trimmed.length) break;
  }
  const spacer = tail;
  if (!/[^ \t\n]/.test(tail)) tail = '';
  let raw = lines.slice(i, rawEnd).join('\n').trimEnd();
  if (spacer.length === 1 && !tail) raw += '\n';
  return { node: { k: 'list', ordered, start: ordered ? startNum : '', loose, items, raw }, next: j, tail };
}

// ---- inline emphasis patterns (GFM) ----
const RE_EM_L = /^(?:\*+(?:((?!\*)(?!~)[\p{P}\p{S}])|([^\s*]))?)|^_+(?:((?!_)(?!~)[\p{P}\p{S}])|([^\s_]))?/u;
const RE_EM_R_AST = /^[^_*]*?__[^_*]*?\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\*)(?!~)[\p{P}\p{S}](\*+)(?=[\s]|$)|(?:[^\s\p{P}\p{S}]|~)(\*+)(?!\*)(?=(?!~)[\s\p{P}\p{S}]|$)|(?!\*)(?!~)[\s\p{P}\p{S}](\*+)(?=(?:[^\s\p{P}\p{S}]|~))|[\s](\*+)(?!\*)(?=(?!~)[\p{P}\p{S}])|(?!\*)(?!~)[\p{P}\p{S}](\*+)(?!\*)(?=(?!~)[\p{P}\p{S}])|(?:[^\s\p{P}\p{S}]|~)(\*+)(?=(?:[^\s\p{P}\p{S}]|~))/gu;
const RE_EM_R_UND = /^[^_*]*?\*\*[^_*]*?_[^_*]*?(?=\*\*)|[^_]+(?=[^_])|(?!_)[\p{P}\p{S}](_+)(?=[\s]|$)|[^\s\p{P}\p{S}](_+)(?!_)(?=[\s\p{P}\p{S}]|$)|(?!_)[\s\p{P}\p{S}](_+)(?=[^\s\p{P}\p{S}])|[\s](_+)(?!_)(?=[\p{P}\p{S}])|(?!_)[\p{P}\p{S}](_+)(?!_)(?=[\p{P}\p{S}])/gu;
const RE_DEL_L = /^~~?(?:((?!~)[\p{P}\p{S}])|[^\s~])/u;
const RE_DEL_R = new RegExp(
  '^[^~]+(?=[^~])'
  + '|(?!~)[\\p{P}\\p{S}](~~?)(?=[\\s]|$)'
  + '|[^\\s\\p{P}\\p{S}](~~?)(?!~)(?=[\\s\\p{P}\\p{S}]|$)'
  + '|(?!~)[\\s\\p{P}\\p{S}](~~?)(?=[^\\s\\p{P}\\p{S}])'
  + '|[\\s](~~?)(?!~)(?=[\\p{P}\\p{S}])'
  + '|(?!~)[\\p{P}\\p{S}](~~?)(?!~)(?=[\\p{P}\\p{S}])'
  + '|[^\\s\\p{P}\\p{S}](~~?)(?=[^\\s\\p{P}\\p{S}])', 'gu');
const RE_EM_L_Y = stickyOf(RE_EM_L);
const RE_DEL_L_Y = stickyOf(RE_DEL_L);
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
  if (masked.includes('`') || masked.includes('\\')) masked = masked.replace(RE_ANYPUNCT_OUTSIDE, (m0, code, punct) => {
    if (punct) return '+'.repeat(m0.length);
    if (code) return code + m0.slice(code.length, -code.length).replace(/`/g, '+') + code;
    return m0;
  });
  if (/[`<\[]/.test(masked)) masked = masked.replace(RE_BLOCKSKIP, (m0, _l, ctx) => {
    const off = ctx ? ctx.length : 0;
    return m0.slice(0, off) + '[' + 'a'.repeat(Math.max(0, m0.length - off - 2)) + ']';
  });
  return masked;
}
// Last closer positions for '*', '_' and '~' in one scan, cached per
// masked string on the inline context: tryEmphasis/tryDel used to rescan
// the whole masked string on every delimiter attempt (quadratic on long
// paragraphs). The cache is keyed by string content, so a nested
// inlineRender that overwrites it simply causes a recompute on return.
function lastClosers(masked) {
  let star = -1, und = -1, tilde = -1;
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch !== '*' && ch !== '_' && ch !== '~') continue;
    const prev = i === 0 ? '\n' : masked[i - 1];
    let j = i + 1;
    while (j < masked.length && masked[j] === ch) j++;
    if (prev !== ' ' && prev !== '\t' && prev !== '\n' && prev !== '\r' && prev !== '\f') {
      if (ch === '*') star = i;
      else if (ch === '_') und = i;
      else tilde = i;
    }
    i = j - 1;
  }
  return { star, und, tilde };
}
// Last-closer cache owned by one inlineRender invocation: the old
// version cached on the shared ctx, so a nested inlineRender (link
// text) overwrote it and the outer call re-scanned -- and the
// string-identity check could degrade into a full O(n) content
// comparison when the two masked strings merely shared a length.
// An object created per invocation is compared by identity only.
function lastCloserFor(lcObj, delim) {
  if (!lcObj.lc) lcObj.lc = lastClosers(lcObj.masked);
  return delim === '*' ? lcObj.lc.star : delim === '_' ? lcObj.lc.und : lcObj.lc.tilde;
}

// Inline rendering context, shared across one inline run.
function makeCtx() { return { inLink: false, inRawBlock: false, linkEmitted: false, parenPossible: true }; }

// Any inline construct at all: escapes, tags, links, emphasis, code,
// hard breaks, autolinks (incl. case-insensitive protocols) and '@'
// (possible email autolink). A string with none of these is plain text.
const FAST_INLINE_RE = /[\\<\[*_`~@]|www\.|https?:\/\/|ftp:\/\/|mailto:|xmpp:| {2,}\n/i;

function inlineRender(src, links, ctx, plain) {
  if (!src) return '';
  // Plain spans need escaping, but no token scanning or delimiter masking.
  if (!/[\\`*_[!<~\n@]| {2,}|(?:https?:\/\/|ftp:\/\/|mailto:|xmpp:|www\.)/i.test(src)) {
    return plain || ctx.inRawBlock ? src : escNoEncode(decodeNumeric(src));
  }
  const masked = (src.includes('*') || src.includes('_') || src.includes('~')) ? maskSrc(src, links) : src;
  const lcObj = { masked, lc: null };
  const hasEmail = src.includes('@');
  const prevParen = ctx.parenPossible;
  ctx.parenPossible = prevParen && src.indexOf(')') >= 0;
  let out = '';
  let i = 0;
  const n = src.length;
  let prevChar = '', keepPrev = false, textEscaped = null;
  while (i < n) {
    if (!keepPrev) prevChar = '';
    keepPrev = false;
    const previousTextEscaped = textEscaped;
    textEscaped = null;
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
          textEscaped = previousTextEscaped ?? false;
          out += plain || textEscaped ? r2.html : escNoEncode(r2.html);
          i += 1;
          continue;
        }
        out += r2.html; i += r2.len; continue;
      }
    }
    // emphasis / strong
    if (ch === '*' || ch === '_') {
      const r = tryEmphasis(src, i, masked, links, ctx, plain, lcObj, prevChar);
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
      const r = tryDel(src, i, masked, links, ctx, plain, lcObj, prevChar);
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
          if (clean !== null) out += '<a href="' + escEncode(clean) + '">' + escEncode(text) + '</a>';
          else out += escEncode(text);
        }
        // autolinks never set linkEmitted in marked: only outputLink does,
        // so a link whose text contains an autolink is still created
        i += m[0].length;
        continue;
      }
    }
    // extended autolink (www / email / protocol)
    if (!ctx.inLink && !plain && (hasEmail || ch === 'w' || ch === 'h' || ch === 'H' || ch === 'f' || ch === 'F' || ch === 'm' || ch === 'x')) {
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
        if (clean !== null) out += '<a href="' + escEncode(clean) + '">' + escEncode(text) + '</a>';
        else out += escEncode(text);
        // extended autolinks never set linkEmitted in marked (see above)
        i += text.length;
        continue;
      }
    }
    // text chunk
    const start = i;
    i = scanText(src, i, ctx, plain, hasEmail);
    if (i === start) { // safety: never stall
      out += plain ? src[i] : escNoEncode(src[i]);
      if (src[i] !== '_') prevChar = src[i];
      keepPrev = true;
      i++;
      continue;
    }
    const chunk = src.slice(start, i);
    textEscaped = previousTextEscaped ?? ctx.inRawBlock;
    if (!plain && !textEscaped && !ctx.inRawBlock) out += escText(chunk);
    else {
      const text = ctx.inRawBlock ? chunk : decodeNumeric(chunk);
      out += plain || textEscaped ? text : escNoEncode(text);
    }
    if (!chunk.endsWith('_')) prevChar = chunk.slice(-1);
    keepPrev = true;
  }
  ctx.parenPossible = prevParen;
  return out;
}

// Character helpers for the inline scanner (a regex test on one character
// is far slower than a code comparison when it runs on every character).
// GFM text boundary grammar from marked 18.1.3 (MIT; see NOTICE).
const RE_TEXT = /^(?:[^a-zA-Z0-9](?=(?:mailto|xmpp):)|(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|[hH][tT][tT][pP][sS]?|[fF][tT][pP]:\/\/|(?<![^\s*_~(])www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9](?=(?:mailto|xmpp):)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@))))/;
const RE_TEXT_Y = stickyOf(RE_TEXT);
function scanText(s, i) {
  // Sticky match at the offset instead of slicing the remainder: the
  // slice copied the whole rest of the paragraph on every text chunk.
  RE_TEXT_Y.lastIndex = i;
  const m = RE_TEXT_Y.exec(s);
  return i + (m?.[0].length || 0);
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
  const cap = execAt(RE_LINK_Y, src, i);
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
  let cap = execAt(RE_REFLINK_Y, src, i) || execAt(RE_NOLINK_Y, src, i);
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

// Last code point ending at s[end-1..end) (a surrogate pair counts as one)
function lastCpBefore(s, end) {
  if (end <= 0) return '';
  const lo = s.charCodeAt(end - 1);
  if (lo >= 0xDC00 && lo <= 0xDFFF && end >= 2) {
    const hi = s.charCodeAt(end - 2);
    if (hi >= 0xD800 && hi <= 0xDBFF) return s.slice(end - 2, end);
  }
  return s[end - 1];
}
// UTF-16 length of the first code point of s (1, or 2 for a surrogate pair)
function firstCpLen(s) {
  const hi = s.charCodeAt(0);
  return hi >= 0xD800 && hi <= 0xDBFF && s.length > 1 ? 2 : 1;
}
// [...s].length - 1 for a delimiter run (ASCII) plus one trailing char
function runCpLenMinus1(s) {
  const n = s.length;
  if (n >= 2) {
    const lo = s.charCodeAt(n - 1);
    if (lo >= 0xDC00 && lo <= 0xDFFF) {
      const hi = s.charCodeAt(n - 2);
      if (hi >= 0xD800 && hi <= 0xDBFF) return n - 2;
    }
  }
  return n - 1;
}

function tryEmphasis(src, i, masked, links, ctx, plain, lcObj, prevChar) {
  const match = execAt(RE_EM_L_Y, src, i);
  if (!match) return null;
  if (!match[1] && !match[2] && !match[3] && !match[4]) return null;
  const delim = match[0][0];
  const midRun = prevChar === delim;
  const srcStart = i;
  let runStart = srcStart;
  while (runStart > 0 && masked[runStart - 1] === delim) runStart--;
  const runPrev = runStart > 0 ? lastCpBefore(masked, runStart) : '';
  const runPrevPunct = runPrev === '*' || runPrev === '_' || isPunct(runPrev);
  if (runStart < srcStart) prevChar = runPrev;
  const prevPunct = runStart < srcStart ? runPrevPunct : isPunct(prevChar);
  if (match[4] && isAlnum(prevChar)) return null;
  const nextChar = match[1] || match[3] || '';
  if (nextChar && prevChar && !prevPunct) return null;
  const lLen = runCpLenMinus1(match[0]);
  const runLen = srcStart - runStart + lLen;
  const openerCanClose = !!runPrev.trim() && (!!nextChar || (delim === '*' && !runPrevPunct));
  const endRe = delim === '*' ? RE_EM_R_AST : RE_EM_R_UND;
  const lastIdx = lastCloserFor(lcObj, delim);
  const windowStart = i + lLen;
  if (lastIdx < windowStart) return null;
  const windowMasked = masked.slice(windowStart);
  const lastInWindow = lastIdx - windowStart;
  endRe.lastIndex = 0;
  let delimTotal = lLen, midTotal = 0, m;
  while ((m = endRe.exec(windowMasked)) !== null) {
    if (m.index > lastInWindow) break;
    const rDelim = m[1] || m[2] || m[3] || m[4] || m[5] || m[6];
    if (!rDelim) continue;
    const rLen = rDelim.length;
    if (m[3] || m[4]) { delimTotal += rLen; continue; }
    else if (m[5] || m[6] || openerCanClose) {
      if (midRun && (m[5] || m[6])) break;
      if (runLen % 3 && !((runLen + rLen) % 3)) { midTotal += rLen; continue; }
    }
    delimTotal -= rLen;
    if (delimTotal > 0) continue;
    const used = Math.min(rLen, rLen + delimTotal + midTotal);
    const firstLen = firstCpLen(m[0]);
    const raw = src.slice(i, i + lLen + m.index + firstLen + used);
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

function tryDel(src, i, masked, links, ctx, plain, lcObj, prevChar) {
  const match = execAt(RE_DEL_L_Y, src, i);
  if (!match) return null;
  const nextChar = match[1] || '';
  if (!nextChar || !prevChar || isPunct(prevChar)) {
    const lLen = runCpLenMinus1(match[0]);
    let delimTotal = lLen;
    const lastIdx = lastCloserFor(lcObj, '~');
    const windowStart = i + lLen;
    if (lastIdx < windowStart) return null;
    const windowMasked = masked.slice(windowStart);
    const lastInWindow = lastIdx - windowStart;
    RE_DEL_R.lastIndex = 0;
    let m;
    while ((m = RE_DEL_R.exec(windowMasked)) !== null) {
      if (m.index > lastInWindow) break;
      const rDelim = m[1] || m[2] || m[3] || m[4] || m[5] || m[6];
      if (!rDelim) continue;
      const rLen = rDelim.length;
      if (rLen !== lLen) continue;
      if (m[3] || m[4]) { delimTotal += rLen; continue; }
      delimTotal -= rLen;
      if (delimTotal > 0) continue;
      const used = Math.min(rLen, rLen + delimTotal);
      const firstLen = firstCpLen(m[0]);
      const raw = src.slice(i, i + lLen + m.index + firstLen + used);
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
        // flattened: push straight into the caller's array instead
        // of building and joining an intermediate one
        out.push('<blockquote>\n');
        renderNodes(node.nodes, links, out, ctx);
        out.push('</blockquote>\n');
        break;
      }
      case 'list': {
        const type = node.ordered ? 'ol' : 'ul';
        const startAttr = node.ordered && node.start !== 1 && node.start !== '' ? ' start="' + node.start + '"' : '';
        out.push('<', type, startAttr, '>\n');
        for (const item of node.items) renderListItem(item, node.loose, links, ctx, out);
        out.push('</', type, '>\n');
        break;
      }
      case 'table': {
        out.push('<table>\n<thead>\n<tr>\n');
        for (let j = 0; j < node.header.length; j++) {
          const cell = node.header[j];
          const align = node.align[j];
          out.push('<th' + (align ? ' align="' + align + '"' : '') + '>' + entryRender(cell, links, ctx) + '</th>\n');
        }
        out.push('</tr>\n</thead>\n');
        if (node.rows.length) {
          out.push('<tbody>');
          for (const row of node.rows) {
            const cells = splitCells(row, node.header.length);
            out.push('<tr>\n');
            for (let k = 0; k < cells.length; k++) {
              const align = node.align[k];
              out.push('<td' + (align ? ' align="' + align + '"' : '') + '>' + entryRender(cells[k], links, ctx) + '</td>\n');
            }
            out.push('</tr>\n');
          }
          out.push('</tbody>');
        }
        out.push('</table>\n');
        break;
      }
    }
  }
}
function renderListItem(item, loose, links, ctx, out) {
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
      out.push('<li>' + html.replace('<p>', '<p>' + prefix));
      renderNodes(nodes.slice(1), links, out, ctx);
      out.push('</li>\n');
      return;
    }
    if (!loose) {
      out.push('<li>' + prefix);
      renderNodes(nodes, links, out, ctx);
      out.push('</li>\n');
      return;
    }
  }
  out.push('<li>');
  renderNodes(nodes, links, out, ctx);
  out.push('</li>\n');
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
