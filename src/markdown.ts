// Markdown ⇔ 文書（ProseMirror の JSON）の変換。DOM に依存しない。
//
// いちばん大事な約束（往復の不変条件）:
//   serializeMarkdown(parseMarkdown(md)) === md   … どんな md でも 1 文字も変わらない
//
// そのために、規則で読めた塊を**その場で書き戻して元の行と比べ**、一致しなければその塊は
// 「書式を開かない素の文字」に倒す（行内も同じ）。読めないものは見た目が素朴になるだけで、文字は失わない。
//
// 文書の形（本文は「行」の並びとして扱う。textarea と同じ感覚）:
//   - 段落の中の改行（hardBreak）も、段落と段落の境目も、どちらも Markdown では単独の改行 `\n`
//   - 空の段落 1 つ = 空行 1 行（空行 n 行 = 空の段落 n 個）
//   - `![alt](url)` だけの行        → image ブロック
//   - 行として独立した URL          → urlBlock（埋め込み・リンクカードの枠。判定は外から渡せる）
//   - `---` `***` などの区切り線の行 → horizontalRule（書かれた記号をそのまま覚える）
//   - `# 見出し`〜`###### 見出し`    → heading
//   - `- ` `* ` `+ ` / `1. ` `1) `   → 箇条書き / 番号付き（1 項目 1 段落・入れ子は扱わない）
//   - `> `                           → 引用（中身は同じ規則で読む）
//   - ``` / ~~~ のコードフェンス     → codeBlock（開き・閉じの行をそのまま覚える）
//   - 行内: **太字** / ~~取り消し線~~ / [リンク](url) / `コード`。斜体（*a*）は開かず文字のまま

export interface JSONMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface JSONNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: JSONNode[];
  text?: string;
  marks?: JSONMark[];
}

export interface MarkdownOptions {
  /**
   * 行まるごとが URL のとき、それを urlBlock（埋め込み・カードの枠）にするか。
   * 既定は「http(s) で始まり、空白を含まず、文末の句読点で終わらない」。
   */
  isBlockUrl?: (line: string) => boolean;
  /**
   * 規則で読めずに素の文字へ倒したときに呼ばれる（検査スクリプト用）。
   * rule はブロックの種類（'bulletList' 等）か 'inline'・'document'。中身は渡さない。
   */
  onFallback?: (rule: string) => void;
}

/** 区切り線の行（CommonMark: 先頭空白3つまで・同じ記号3つ以上・間の空白可）。 */
export const HR_LINE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
/** コードフェンスの開き・閉じ。 */
export const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING_LINE = /^(#{1,6})(?: (.*))?$/;
const IMAGE_LINE = /^!\[([^\]\n]*)\]\(([^)\s]+)(?: "([^"\n]*)")?\)$/;
const BULLET_LINE = /^([-*+]) (.*)$/;
const ORDERED_LINE = /^(\d{1,9})([.)]) (.*)$/;
const QUOTE_LINE = /^>/;

export function defaultIsBlockUrl(line: string): boolean {
  if (!/^https?:\/\/[\x21-\x7E]+$/i.test(line)) return false;
  return !/[.,!?:;'"`\]}>]$/.test(line);
}

// ───────────────────────────────────────────────────────────────
// 行内
// ───────────────────────────────────────────────────────────────

/** 書き戻すときの記号の内→外の順（外ほど先に開く）。 */
const MARK_ORDER = ['link', 'bold', 'strike', 'code'];
const ESCAPABLE = '\\`*_~[]()!#-<>&|+.';

interface InlineItem {
  /** '\n' は hardBreak */
  text: string;
  marks: JSONMark[];
}

function sameMark(a: JSONMark, b: JSONMark): boolean {
  return a.type === b.type && (a.type !== 'link' || a.attrs?.href === b.attrs?.href);
}

function hasMarkType(marks: JSONMark[], type: string): boolean {
  return marks.some((m) => m.type === type);
}

function findClosing(text: string, from: number, mark: string): number {
  let i = from;
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (text.startsWith(mark, i)) return i;
    i++;
  }
  return -1;
}

interface LinkMatch {
  label: string;
  href: string;
  end: number;
}

/** `[ラベル](URL)` を i の位置から読む。URL に空白（タイトル付き等）があるものは読まない。 */
function matchLink(text: string, i: number): LinkMatch | null {
  let depth = 0;
  let j = i;
  for (; j < text.length; j++) {
    const c = text.charAt(j);
    if (c === '\\') {
      j++;
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (j >= text.length || text.charAt(j) !== ']' || text.charAt(j + 1) !== '(') return null;
  const close = text.indexOf(')', j + 2);
  if (close < 0) return null;
  const href = text.slice(j + 2, close);
  if (!href || /[\s()<>"']/.test(href)) return null;
  return { label: text.slice(i + 1, j), href, end: close + 1 };
}

function isSafeHref(href: string): boolean {
  return /^https?:\/\/[\x21-\x7E]+$/i.test(href) || /^mailto:[\x21-\x7E]+$/i.test(href);
}

function parseInlineItems(text: string, marks: JSONMark[]): InlineItem[] {
  const out: InlineItem[] = [];
  let buf = '';
  const flush = (): void => {
    if (buf) out.push({ text: buf, marks });
    buf = '';
  };
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === '\n') {
      flush();
      out.push({ text: '\n', marks });
      i++;
      continue;
    }
    // \* などは記号として働かせず、そのまま文字に残す（往復で 1 文字も変えないため）
    if (c === '\\' && i + 1 < text.length && ESCAPABLE.includes(text.charAt(i + 1))) {
      buf += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    // 行内の画像記法は開かない（リンクに化けないよう丸ごと文字）
    if (c === '!' && text.charAt(i + 1) === '[') {
      const img = matchLink(text, i + 1);
      if (img) {
        buf += text.slice(i, img.end);
        i = img.end;
        continue;
      }
    }
    if (c === '`' && marks.length === 0) {
      const close = text.indexOf('`', i + 1);
      const inner = close > i + 1 ? text.slice(i + 1, close) : '';
      if (inner && !inner.includes('\n')) {
        flush();
        out.push({ text: inner, marks: [{ type: 'code' }] });
        i = close + 1;
        continue;
      }
    }
    if (c === '[' && !hasMarkType(marks, 'link')) {
      const m = matchLink(text, i);
      if (m && m.label && isSafeHref(m.href)) {
        flush();
        out.push(...parseInlineItems(m.label, [...marks, { type: 'link', attrs: { href: m.href } }]));
        i = m.end;
        continue;
      }
    }
    let matched = false;
    for (const [mark, type] of [
      ['**', 'bold'],
      ['~~', 'strike'],
    ] as const) {
      if (!text.startsWith(mark, i) || hasMarkType(marks, type)) continue;
      const from = i + mark.length;
      const close = findClosing(text, from, mark);
      if (close <= from) continue;
      const inner = text.slice(from, close);
      if (/^\s/.test(inner) || /\s$/.test(inner)) continue;
      flush();
      out.push(...parseInlineItems(inner, [...marks, { type }]));
      i = close + mark.length;
      matched = true;
      break;
    }
    if (matched) continue;
    buf += c;
    i++;
  }
  flush();
  return out;
}

function markOrder(m: JSONMark): number {
  const k = MARK_ORDER.indexOf(m.type);
  return k < 0 ? MARK_ORDER.length : k;
}

function opener(m: JSONMark): string {
  switch (m.type) {
    case 'link':
      return '[';
    case 'bold':
      return '**';
    case 'strike':
      return '~~';
    case 'code':
      return '`';
    default:
      return '';
  }
}

function closer(m: JSONMark): string {
  switch (m.type) {
    case 'link':
      return `](${String(m.attrs?.href ?? '')})`;
    case 'bold':
      return '**';
    case 'strike':
      return '~~';
    case 'code':
      return '`';
    default:
      return '';
  }
}

/** 段落などの中身（text・hardBreak の並び）を、書式の記号つきの文字列に戻す。 */
export function serializeInline(content: JSONNode[] | undefined): string {
  // 1) 文字と改行を、空白／非空白の小片に割る
  const items: InlineItem[] = [];
  for (const n of content ?? []) {
    const marks = (n.marks ?? []).filter((m) => MARK_ORDER.includes(m.type));
    if (n.type === 'hardBreak') {
      items.push({ text: '\n', marks });
    } else if (n.type === 'text' && n.text) {
      if (hasMarkType(marks, 'code')) {
        items.push({ text: n.text, marks });
        continue;
      }
      for (const piece of n.text.match(/\s+|\S+/g) ?? []) items.push({ text: piece, marks });
    }
  }
  // 2) 太字・取り消し線の端にかかった空白は記号の外へ出す（`** a**` は太字として読めないため）
  for (const type of ['bold', 'strike']) {
    let k = 0;
    while (k < items.length) {
      if (!hasMarkType(items[k]!.marks, type)) {
        k++;
        continue;
      }
      let e = k;
      while (e + 1 < items.length && hasMarkType(items[e + 1]!.marks, type)) e++;
      const strip = (idx: number): void => {
        items[idx] = { ...items[idx]!, marks: items[idx]!.marks.filter((m) => m.type !== type) };
      };
      let a = k;
      while (a <= e && !/\S/.test(items[a]!.text)) strip(a++);
      let b = e;
      while (b >= a && !/\S/.test(items[b]!.text)) strip(b--);
      k = e + 1;
    }
  }
  // 3) 記号を開け閉めしながら並べる
  let out = '';
  let open: JSONMark[] = [];
  for (const it of items) {
    const want = [...it.marks].sort((x, y) => markOrder(x) - markOrder(y));
    let keep = 0;
    while (keep < open.length && keep < want.length && sameMark(open[keep]!, want[keep]!)) keep++;
    for (let k = open.length - 1; k >= keep; k--) out += closer(open[k]!);
    open = open.slice(0, keep);
    for (let k = keep; k < want.length; k++) {
      out += opener(want[k]!);
      open.push(want[k]!);
    }
    out += it.text;
  }
  for (let k = open.length - 1; k >= 0; k--) out += closer(open[k]!);
  return out;
}

function itemsToNodes(items: InlineItem[]): JSONNode[] {
  const nodes: JSONNode[] = [];
  for (const it of items) {
    const marks = it.marks.length ? it.marks.map((m) => ({ ...m })) : undefined;
    if (it.text === '\n') {
      nodes.push(marks ? { type: 'hardBreak', marks } : { type: 'hardBreak' });
      continue;
    }
    const last = nodes[nodes.length - 1];
    if (
      last &&
      last.type === 'text' &&
      JSON.stringify(last.marks ?? []) === JSON.stringify(marks ?? [])
    ) {
      last.text += it.text;
      continue;
    }
    nodes.push(marks ? { type: 'text', text: it.text, marks } : { type: 'text', text: it.text });
  }
  return nodes;
}

/** 書式を開かない素の中身（改行は hardBreak）。 */
export function plainInline(text: string): JSONNode[] {
  const nodes: JSONNode[] = [];
  text.split('\n').forEach((line, i) => {
    if (i > 0) nodes.push({ type: 'hardBreak' });
    if (line) nodes.push({ type: 'text', text: line });
  });
  return nodes;
}

/** 行内を開く。書き戻して元と一致しなければ素の文字に倒す。 */
export function parseInline(text: string, onFallback?: (rule: string) => void): JSONNode[] {
  const rich = itemsToNodes(parseInlineItems(text, []));
  if (serializeInline(rich) === text) return rich;
  onFallback?.('inline');
  return plainInline(text);
}

function withContent(node: JSONNode, content: JSONNode[]): JSONNode {
  return content.length ? { ...node, content } : node;
}

// ───────────────────────────────────────────────────────────────
// ブロック
// ───────────────────────────────────────────────────────────────

function isListLike(n: JSONNode | undefined): boolean {
  return !!n && (n.type === 'bulletList' || n.type === 'orderedList' || n.type === 'blockquote');
}

function isEmptyParagraph(n: JSONNode | undefined): boolean {
  return !!n && n.type === 'paragraph' && !(n.content && n.content.length);
}

/**
 * ブロックの並びを書き戻す。境目は単独の改行。
 * ⚠️ リスト・引用の直後に（空行を挟まず）段落・画像・URL が来ると、Markdown ではリストの続き
 *    （lazy continuation）として読まれてしまうので、そこだけ空行を 1 行足す。
 *    読み込み（parse）ではこの並びは生まれない（続きの行はリスト側に吸われる）ので、往復は変わらない。
 */
export function serializeBlocks(nodes: JSONNode[] | undefined): string {
  const list = nodes ?? [];
  let out = '';
  list.forEach((n, i) => {
    if (i > 0) {
      const prev = list[i - 1];
      const lazy =
        isListLike(prev) &&
        ((n.type === 'paragraph' && !isEmptyParagraph(n)) || n.type === 'image' || n.type === 'urlBlock');
      out += lazy ? '\n\n' : '\n';
    }
    out += serializeBlock(n);
  });
  return out;
}

function prefixLines(text: string, first: string, rest: string): string {
  return text
    .split('\n')
    .map((line, i) => (line === '' && i > 0 ? '' : (i === 0 ? first : rest) + line))
    .join('\n');
}

export function serializeBlock(n: JSONNode): string {
  const a = n.attrs ?? {};
  switch (n.type) {
    case 'paragraph':
      return serializeInline(n.content);
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(a.level) || 2));
      const text = serializeInline(n.content);
      return '#'.repeat(level) + (text ? ' ' + text : '');
    }
    case 'horizontalRule':
      return typeof a.markup === 'string' && HR_LINE.test(a.markup) ? a.markup : '---';
    case 'image': {
      const title = a.title ? ` "${String(a.title)}"` : '';
      return `![${String(a.alt ?? '')}](${String(a.src ?? '')}${title})`;
    }
    case 'urlBlock':
      return String(a.url ?? '');
    case 'codeBlock': {
      const open = typeof a.open === 'string' && a.open ? a.open : '```' + (a.language ? String(a.language) : '');
      const close = a.close === null ? null : typeof a.close === 'string' && a.close ? a.close : '```';
      const text = (n.content ?? []).map((c) => c.text ?? '').join('');
      const parts = [open];
      if (text || close === null) parts.push(text);
      if (close !== null) parts.push(close);
      return parts.join('\n');
    }
    case 'bulletList': {
      const bullet = a.bullet === '*' || a.bullet === '+' ? a.bullet : '-';
      return (n.content ?? [])
        .map((item) => {
          const body = serializeBlocks(item.content);
          return prefixLines(body, bullet + ' ', '  ');
        })
        .join('\n');
    }
    case 'orderedList': {
      const start = Number.isFinite(Number(a.start)) ? Number(a.start) : 1;
      const delim = a.delimiter === ')' ? ')' : '.';
      return (n.content ?? [])
        .map((item, i) => {
          const marker = `${start + i}${delim} `;
          return prefixLines(serializeBlocks(item.content), marker, ' '.repeat(marker.length));
        })
        .join('\n');
    }
    case 'blockquote':
      return serializeBlocks(n.content)
        .split('\n')
        .map((line) => (line === '' ? '>' : '> ' + line))
        .join('\n');
    case 'listItem':
      return serializeBlocks(n.content);
    default:
      // 知らないブロックは中身の文字だけ
      return n.content ? serializeBlocks(n.content) : (n.text ?? '');
  }
}

interface Ctx {
  isBlockUrl: (line: string) => boolean;
  onFallback: (rule: string) => void;
}

function isBlockStart(line: string, ctx: Ctx): boolean {
  return (
    FENCE_LINE.test(line) ||
    HR_LINE.test(line) ||
    HEADING_LINE.test(line) ||
    IMAGE_LINE.test(line) ||
    ctx.isBlockUrl(line) ||
    BULLET_LINE.test(line) ||
    ORDERED_LINE.test(line) ||
    QUOTE_LINE.test(line)
  );
}

/** 塊を書き戻して元の行と比べ、合わなければ素の段落に倒す。 */
function verified(node: JSONNode, lines: string[], ctx: Ctx): JSONNode {
  const src = lines.join('\n');
  if (serializeBlock(node) === src) return node;
  ctx.onFallback(node.type);
  return rawParagraph(src);
}

function rawParagraph(src: string): JSONNode {
  return withContent({ type: 'paragraph' }, plainInline(src));
}

function fenceEnd(lines: string[], i: number): number {
  const m = lines[i]!.match(FENCE_LINE)!;
  const ch = m[1]![0]!;
  const len = m[1]!.length;
  for (let j = i + 1; j < lines.length; j++) {
    const f = lines[j]!.match(FENCE_LINE);
    if (f && f[1]![0] === ch && f[1]!.length >= len && lines[j]!.trim() === f[1]) return j;
  }
  return -1;
}

function parseLines(lines: string[], ctx: Ctx): JSONNode[] {
  const out: JSONNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    if (line === '') {
      out.push({ type: 'paragraph' });
      i++;
      continue;
    }

    if (FENCE_LINE.test(line)) {
      const end = fenceEnd(lines, i);
      const last = end < 0 ? lines.length - 1 : end;
      const inner = lines.slice(i + 1, end < 0 ? lines.length : end);
      const text = inner.join('\n');
      const lang = line.replace(FENCE_LINE, '').trim();
      const node = withContent(
        { type: 'codeBlock', attrs: { language: lang || null, open: line, close: end < 0 ? null : lines[end]! } },
        text ? [{ type: 'text', text }] : []
      );
      out.push(verified(node, lines.slice(i, last + 1), ctx));
      i = last + 1;
      continue;
    }

    if (HR_LINE.test(line)) {
      out.push({ type: 'horizontalRule', attrs: { markup: line } });
      i++;
      continue;
    }

    const h = HEADING_LINE.exec(line);
    if (h) {
      const text = h[2] ?? '';
      const node = withContent({ type: 'heading', attrs: { level: h[1]!.length } }, text ? parseInline(text, ctx.onFallback) : []);
      out.push(verified(node, [line], ctx));
      i++;
      continue;
    }

    const img = IMAGE_LINE.exec(line);
    if (img) {
      out.push(verified({ type: 'image', attrs: { src: img[2]!, alt: img[1] ?? '', title: img[3] ?? null } }, [line], ctx));
      i++;
      continue;
    }

    if (ctx.isBlockUrl(line)) {
      out.push({ type: 'urlBlock', attrs: { url: line } });
      i++;
      continue;
    }

    const bullet = BULLET_LINE.exec(line);
    const ordered = bullet ? null : ORDERED_LINE.exec(line);
    if (bullet || ordered) {
      const start = i;
      const items: string[][] = [];
      const itemRe = bullet ? BULLET_LINE : ORDERED_LINE;
      const sameKind = (l: string): boolean => {
        if (HR_LINE.test(l)) return false;
        const m = itemRe.exec(l);
        if (!m) return false;
        return bullet ? m[1] === bullet[1] : m[2] === ordered![2];
      };
      while (i < lines.length) {
        const l = lines[i]!;
        if (sameKind(l)) {
          const m = itemRe.exec(l)!;
          items.push([bullet ? m[2]! : m[3]!]);
          i++;
          continue;
        }
        if (l === '' || !items.length) break;
        // 続きの行（字下げ・字下げなしの lazy）はその項目に入れる。合わない形は検査で素に倒れる
        const marker = bullet ? 2 : (itemRe.exec(lines[start]!)![1]!.length + 2);
        const indent = ' '.repeat(marker);
        if (l.startsWith(indent)) {
          items[items.length - 1]!.push(l.slice(marker));
          i++;
          continue;
        }
        if (!isBlockStart(l, ctx) || IMAGE_LINE.test(l) || ctx.isBlockUrl(l)) {
          items[items.length - 1]!.push(l);
          i++;
          continue;
        }
        break;
      }
      const listItems = items.map((ls) => ({
        type: 'listItem',
        content: [withContent({ type: 'paragraph' }, parseInline(ls.join('\n'), ctx.onFallback))],
      }));
      const node: JSONNode = bullet
        ? { type: 'bulletList', attrs: { bullet: bullet[1]! }, content: listItems }
        : {
            type: 'orderedList',
            attrs: { start: parseInt(ordered![1]!, 10), delimiter: ordered![2]! },
            content: listItems,
          };
      out.push(verified(node, lines.slice(start, i), ctx));
      continue;
    }

    if (QUOTE_LINE.test(line)) {
      const start = i;
      const inner: string[] = [];
      while (i < lines.length) {
        const l = lines[i]!;
        if (QUOTE_LINE.test(l)) {
          inner.push(l.startsWith('> ') ? l.slice(2) : l.slice(1));
          i++;
          continue;
        }
        if (l !== '' && (!isBlockStart(l, ctx) || IMAGE_LINE.test(l) || ctx.isBlockUrl(l))) {
          inner.push(l); // lazy。書き戻すと `> ` が付くので検査で素に倒れる
          i++;
          continue;
        }
        break;
      }
      const node: JSONNode = { type: 'blockquote', content: parseLines(inner, ctx) };
      out.push(verified(node, lines.slice(start, i), ctx));
      continue;
    }

    // 段落: 空行か、次のブロックの始まりまで
    const start = i;
    i++;
    while (i < lines.length && lines[i] !== '' && !isBlockStart(lines[i]!, ctx)) i++;
    const text = lines.slice(start, i).join('\n');
    out.push(withContent({ type: 'paragraph' }, parseInline(text, ctx.onFallback)));
  }
  return joinLazy(out, ctx);
}

function isLazyTarget(n: JSONNode): boolean {
  return (n.type === 'paragraph' && !isEmptyParagraph(n)) || n.type === 'image' || n.type === 'urlBlock';
}

/**
 * リスト・引用の直後に段落等が（空行なしで）並んだら、両方をまとめて素の段落にする。
 * 書き戻しはその並びに空行を足す（serializeBlocks）ので、そのままだと往復が崩れるため。
 * 続きの行はふつうリスト側に吸われるので、ここへ来るのは「直後の塊が素に倒れた」ときだけ。
 * ⚠️ 各ブロックは serializeBlock で元の行に戻る（検査済み）ので、それをつなげば元の行になる。
 */
function joinLazy(nodes: JSONNode[], ctx: Ctx): JSONNode[] {
  const out: JSONNode[] = [];
  for (const n of nodes) {
    out.push(n);
    while (out.length >= 2 && isListLike(out[out.length - 2]) && isLazyTarget(out[out.length - 1]!)) {
      const b = out.pop()!;
      const a = out.pop()!;
      ctx.onFallback('lazy');
      out.push(rawParagraph(serializeBlock(a) + '\n' + serializeBlock(b)));
    }
  }
  return out;
}

/** Markdown を文書（ProseMirror の JSON）に読む。往復の不変条件を必ず満たす。 */
export function parseMarkdown(markdown: string, options: MarkdownOptions = {}): JSONNode {
  const ctx: Ctx = { isBlockUrl: options.isBlockUrl ?? defaultIsBlockUrl, onFallback: options.onFallback ?? (() => {}) };
  let content = parseLines(markdown.split('\n'), ctx);
  if (!content.length) content = [{ type: 'paragraph' }];
  const doc: JSONNode = { type: 'doc', content };
  if (serializeMarkdown(doc) === markdown) return doc;
  // 最後の砦: 全部を素の行に（ここへ来るのは規則の穴。検査スクリプトで数える）
  ctx.onFallback('document');
  return rawDocument(markdown);
}

/** 全部を素の段落（1 行 1 段落・空行は空の段落）にした文書。必ず往復する。 */
export function rawDocument(markdown: string): JSONNode {
  return {
    type: 'doc',
    content: markdown.split('\n').map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })),
  };
}

/** 文書を Markdown に書き戻す。 */
export function serializeMarkdown(doc: JSONNode): string {
  return serializeBlocks(doc.content);
}
