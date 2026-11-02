// 言葉のリンク `[[言葉]]`。文書の形（スキーマ）は変えず、本文の文字をそのまま飾り、ボタンで括弧を足し外しする。
// Markdown にはただの文字として残るので、書き戻しは他の文字と同じ。言葉の行き先はライブラリの外の話。
import { Extension } from '@tiptap/core';
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/** 言葉の文法: `[[` + `[ ] 改行` を含まない1文字以上 + `]]`。空白だけは言葉にしない */
const WORD = /\[\[([^[\]\n]+)\]\]/g;

interface WordRange {
  from: number;
  to: number;
}

/**
 * 塊の中身を、位置が文書と 1 対 1 になる文字列にする。改行とコード・リンクの中は言葉をまたげないよう改行で埋める
 * （リンクは Markdown では `[文字](url)` で、`[[a]](url)` はこちらの解釈を優先する）
 */
function plainOf(block: PMNode): string {
  let out = '';
  block.forEach((child) => {
    const opaque = !child.isText || child.marks.some((m) => m.type.name === 'code' || m.type.name === 'link');
    out += opaque ? '\n'.repeat(child.nodeSize) : child.text;
  });
  return out;
}

/** 塊の中の言葉（括弧を含む範囲。塊の先頭からの位置） */
function wordsIn(block: PMNode): WordRange[] {
  if (block.type.spec.code) return [];
  return [...plainOf(block).matchAll(WORD)]
    .filter((m) => m[1]!.trim())
    .map((m) => ({ from: m.index, to: m.index + m[0].length }));
}

/** カーソル／選択を内側に持つ言葉（文書の位置）。カーソルが括弧のすぐ外にあるときは外とみなす */
export function wordAround({ selection }: EditorState): WordRange | null {
  const { $from, $to, empty } = selection;
  if (!(selection instanceof TextSelection) || !$from.sameParent($to)) return null;
  const a = $from.parentOffset;
  const b = $to.parentOffset;
  const word = wordsIn($from.parent).find((w) => (empty ? w.from < a && a < w.to : w.from <= a && b <= w.to));
  if (!word) return null;
  const start = $from.start();
  return { from: start + word.from, to: start + word.to };
}

/** 選択の全部にかかっている書式。括弧にもこれを付ける（`**[[あ]]**` にするため） */
function commonMarks(state: EditorState, from: number, to: number): readonly Mark[] {
  let marks: readonly Mark[] | null = null;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isText) marks = marks ? marks.filter((m) => m.isInSet(node.marks)) : node.marks;
  });
  return marks ?? [];
}

/** ボタンの動き。言葉の中なら括弧を外し、そうでなければ選択を囲む。何も変えないときは理由を返す */
export function toggleWikilink(state: EditorState): Transaction | 'empty' | 'invalid' {
  const word = wordAround(state);
  if (word) return state.tr.delete(word.to - 2, word.to).delete(word.from, word.from + 2);

  const { selection } = state;
  if (selection.empty) return 'empty';
  const { $from, $to, from, to } = selection;
  if (!(selection instanceof TextSelection) || !$from.sameParent($to) || $from.parent.type.spec.code) return 'invalid';
  const text = plainOf($from.parent).slice($from.parentOffset, $to.parentOffset);
  if (/[[\]\n]/.test(text)) return 'invalid';
  if (!text.trim()) return 'empty';

  const marks = commonMarks(state, from, to);
  const tr = state.tr.insert(to, state.schema.text(']]', marks)).insert(from, state.schema.text('[[', marks));
  // 続けて打つ文字は言葉の外に入る
  return tr.setSelection(TextSelection.create(tr.doc, to + 4));
}

function decorate(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    for (const w of wordsIn(node)) {
      const from = pos + 1 + w.from;
      const to = pos + 1 + w.to;
      decorations.push(
        Decoration.inline(from, from + 2, { class: 'k-editor-wikilink-bracket' }),
        Decoration.inline(from + 2, to - 2, { class: 'k-editor-wikilink' }, { inclusiveStart: true, inclusiveEnd: true }),
        Decoration.inline(to - 2, to, { class: 'k-editor-wikilink-bracket' })
      );
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

const wikilinkKey = new PluginKey<DecorationSet>('kWikilink');

/** 変換が終わって DOM が落ち着いてから飾り直すまでの待ち（ProseMirror の後始末は 20ms 後） */
const AFTER_COMPOSITION_MS = 50;

export const KWikilink = Extension.create({
  name: 'kWikilink',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: wikilinkKey,
        state: {
          init: (_config, state) => decorate(state.doc),
          apply(tr, old) {
            // ⚠️ 変換中は飾りを作り直さない（変換中の文字の周りの DOM を組み替えると IME が壊れる）。位置だけ追う
            if (tr.getMeta('composition') !== undefined) return old.map(tr.mapping, tr.doc);
            return tr.docChanged || tr.getMeta(wikilinkKey) ? decorate(tr.doc) : old;
          },
        },
        props: {
          decorations: (state) => wikilinkKey.getState(state),
          handleDOMEvents: {
            compositionend: (view) => {
              setTimeout(() => {
                if (!view.isDestroyed && !view.composing) view.dispatch(view.state.tr.setMeta(wikilinkKey, true));
              }, AFTER_COMPOSITION_MS);
              return false;
            },
          },
        },
      }),
    ];
  },
});
