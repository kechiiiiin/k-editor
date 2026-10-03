// k-editor の芯。素の DOM に createEditor(el, options) で載せる。
import { Editor, Extension } from '@tiptap/core';
import { Fragment, Mark, Slice, type Node as PMNode, type Schema } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import Paragraph from '@tiptap/extension-paragraph';
import HardBreak from '@tiptap/extension-hard-break';
import Heading from '@tiptap/extension-heading';
import Bold from '@tiptap/extension-bold';
import Strike from '@tiptap/extension-strike';
import Code from '@tiptap/extension-code';
import Blockquote from '@tiptap/extension-blockquote';
import { Dropcursor, Gapcursor, Placeholder, UndoRedo } from '@tiptap/extensions';
import { defaultIsBlockUrl, parseMarkdown, serializeMarkdown, type JSONNode } from './markdown.js';
import {
  KBulletList,
  KCodeBlock,
  KHorizontalRule,
  KLink,
  KListItem,
  KOrderedList,
  createImageNode,
  createUrlBlockNode,
  type EmbedResult,
  type LinkCardData,
} from './nodes.js';
import { Toolbar, type ToolbarItem, DEFAULT_TOOLBAR } from './toolbar.js';

export type { ToolbarItem } from './toolbar.js';
export type { LinkCardData, EmbedResult } from './nodes.js';

export interface KEditorLabels {
  photo: string;
  embed: string;
  h2: string;
  h3: string;
  bold: string;
  strike: string;
  link: string;
  bulletList: string;
  orderedList: string;
  blockquote: string;
  hr: string;
  undo: string;
  redo: string;
  /** 写真を送っている間の表示。{done} {total} が入る */
  uploading: string;
  /** 写真の失敗。{n} {message} が入る */
  uploadFailed: string;
  urlPlaceholder: string;
  linkPlaceholder: string;
  apply: string;
  cancel: string;
  unlink: string;
  notUrl: string;
  removeBlock: string;
  removeImage: string;
}

export const DEFAULT_LABELS: KEditorLabels = {
  photo: '写真',
  embed: '埋め込み',
  h2: '見出し',
  h3: '小見出し',
  bold: '太字',
  strike: '取消線',
  link: 'リンク',
  bulletList: '箇条書き',
  orderedList: '番号',
  blockquote: '引用',
  hr: '区切り',
  undo: '戻す',
  redo: 'やり直す',
  uploading: '送っています {done} / {total}',
  uploadFailed: '{n}枚目で失敗しました（{message}）',
  urlPlaceholder: 'URL を貼る（X・YouTube・記事など）',
  linkPlaceholder: 'リンク先の URL',
  apply: '入れる',
  cancel: 'やめる',
  unlink: '外す',
  notUrl: '行として置ける URL ではありません',
  removeBlock: 'これを外す',
  removeImage: 'この写真を外す',
};

export interface KEditorOptions {
  /** 最初の本文（Markdown） */
  markdown?: string;
  placeholder?: string;
  /** 本文が変わるたび（Markdown） */
  onChange?: (markdown: string) => void;
  /** Cmd/Ctrl+Enter。IME の変換中は呼ばない */
  onSubmit?: () => void;
  /** 写真を上げて URL を返す。無ければ写真の道具は出さない */
  uploadImage?: (file: File) => Promise<string>;
  /** 写真を選ばせる（既定は隠しの input type=file） */
  pickImages?: () => Promise<File[]>;
  /** URL を埋め込みとして描くなら要素を返す。null ならカード／素の URL */
  renderEmbed?: (url: string) => EmbedResult;
  /** URL のカードの中身。null ならその URL のまま */
  fetchCard?: (url: string) => Promise<LinkCardData | null> | LinkCardData | null;
  /** 行まるごとの URL を、埋め込み・カードの枠（urlBlock）にするか */
  isBlockUrl?: (line: string) => boolean;
  /** 出す道具と並び。'|' は区切り。false で出さない */
  toolbar?: ToolbarItem[] | false;
  labels?: Partial<KEditorLabels>;
  /** 失敗の知らせ（既定はエディタの下に文字で出す） */
  onError?: (message: string) => void;
  /** 読み込み時にどの規則で素の文字に倒したか（検査用） */
  onFallback?: (rule: string) => void;
}

export interface KEditor {
  /** いまの本文（Markdown） */
  getMarkdown(): string;
  /** 本文を差し替える（onChange は呼ばない・元に戻す履歴にも積まない） */
  setMarkdown(markdown: string): void;
  focus(): void;
  /** 写真をカーソル位置へ（ボタン・ドロップ・貼り付けと同じ経路） */
  insertImages(files: File[]): Promise<void>;
  /** URL の枠をカーソル位置へ */
  insertUrl(url: string): boolean;
  destroy(): void;
  /** 下回りの Tiptap（凝ったことをしたいとき用） */
  readonly tiptap: Editor;
  readonly root: HTMLElement;
}

/** IME の変換中か（変換の確定の Enter を、改行や送信に使わない） */
export function isComposingEvent(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229;
}

/** JSON から ProseMirror の文書を組む（書式の並びは schema の順に揃える）。 */
export function nodeFromJSON(schema: Schema, json: JSONNode): PMNode {
  const marks = Mark.setFrom((json.marks ?? []).map((m) => schema.mark(m.type, m.attrs)));
  if (json.type === 'text') return schema.text(json.text ?? '', marks);
  const type = schema.nodes[json.type];
  if (!type) throw new Error(`unknown node: ${json.type}`);
  const children = (json.content ?? []).map((c) => nodeFromJSON(schema, c));
  return type.create(json.attrs ?? null, children, marks);
}

function imagesFrom(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const files = Array.from(dt.files ?? []).filter((f) => f.type.startsWith('image/'));
  if (files.length) return files;
  // スクリーンショットは files に無く items だけに入るブラウザがある
  return Array.from(dt.items ?? [])
    .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
    .map((it) => it.getAsFile())
    .filter((f): f is File => !!f);
}

function hasImageDrag(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  return Array.from(dt.items ?? []).some((it) => it.kind === 'file' && it.type.startsWith('image/'));
}

function defaultPickImages(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const files = input.files ? Array.from(input.files) : [];
      input.remove();
      resolve(files);
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve([]);
    });
    input.click();
  });
}

/** 文字だけの貼り付け: 行ごとに段落（空行は空の段落）にした Slice。 */
export function plainTextSlice(schema: Schema, text: string): Slice {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const paragraphs = lines.map((line) => schema.nodes.paragraph!.create(null, line ? schema.text(line) : null));
  return new Slice(Fragment.fromArray(paragraphs), 1, 1);
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_w, k: string) => String(values[k] ?? ''));
}

export function createEditor(el: HTMLElement, options: KEditorOptions = {}): KEditor {
  const labels: KEditorLabels = { ...DEFAULT_LABELS, ...(options.labels ?? {}) };
  const isBlockUrl = options.isBlockUrl ?? defaultIsBlockUrl;

  const root = document.createElement('div');
  root.className = 'k-editor';
  const toolbarHost = document.createElement('div');
  toolbarHost.className = 'k-editor-toolbar-wrap';
  const contentEl = document.createElement('div');
  contentEl.className = 'k-editor-content';
  const note = document.createElement('p');
  note.className = 'k-editor-note';
  note.hidden = true;
  root.append(toolbarHost, contentEl, note);
  el.appendChild(root);

  let silent = false;
  let lastMarkdown = options.markdown ?? '';
  let busy = false;

  const showError = (message: string | null): void => {
    if (message && options.onError) {
      options.onError(message);
      return;
    }
    note.textContent = message ?? '';
    note.hidden = !message;
  };

  const hooks = {
    renderEmbed: options.renderEmbed,
    fetchCard: options.fetchCard,
    removeLabel: labels.removeBlock,
    imageRemoveLabel: labels.removeImage,
  };

  const KKeymap = Extension.create({
    name: 'kKeymap',
    priority: 1000,
    addKeyboardShortcuts() {
      return {
        'Mod-k': () => {
          toolbar?.openLink();
          return true;
        },
      };
    },
  });

  const editor = new Editor({
    element: contentEl,
    extensions: [
      Document,
      Text,
      Paragraph,
      HardBreak,
      Heading.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      Bold,
      Strike,
      Code,
      KLink,
      KBulletList,
      KOrderedList,
      KListItem,
      Blockquote,
      KHorizontalRule,
      KCodeBlock,
      createImageNode(hooks),
      createUrlBlockNode(hooks),
      UndoRedo,
      Gapcursor,
      Dropcursor.configure({ class: 'k-editor-dropcursor' }),
      Placeholder.configure({ placeholder: options.placeholder ?? '' }),
      KKeymap,
    ],
    editorProps: {
      attributes: { class: 'k-editor-prose' },
      handleKeyDown: (_view, event) => {
        // IME の変換中・変換の確定の Enter（Safari は compositionend の後に keyCode 229 の Enter が来る）は
        // 段落を割らない・送信しない。true を返すと以降のキー操作（Enter での分割等）は走らない
        if (isComposingEvent(event)) return event.isComposing || event.key === 'Enter';
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && options.onSubmit) {
          options.onSubmit();
          return true;
        }
        return false;
      },
      handlePaste: (view, event) => onPaste(view, event),
      handleDrop: (view, event, _slice, moved) => onDrop(view, event as DragEvent, moved),
      handleDOMEvents: {
        dragover: (_view, event) => {
          if (hasImageDrag((event as DragEvent).dataTransfer)) root.classList.add('k-editor-dropping');
          return false;
        },
        dragleave: () => {
          root.classList.remove('k-editor-dropping');
          return false;
        },
        drop: () => {
          root.classList.remove('k-editor-dropping');
          return false;
        },
      },
    },
  });

  function loadMarkdown(markdown: string): void {
    const json = parseMarkdown(markdown, { isBlockUrl, onFallback: options.onFallback });
    const doc = nodeFromJSON(editor.schema, json);
    const { state } = editor;
    const tr = state.tr.replaceWith(0, state.doc.content.size, doc.content);
    tr.setSelection(TextSelection.atStart(tr.doc));
    tr.setMeta('addToHistory', false);
    tr.setMeta('preventUpdate', true);
    silent = true;
    try {
      editor.view.dispatch(tr);
    } finally {
      silent = false;
    }
    lastMarkdown = markdown;
  }

  function getMarkdown(): string {
    return serializeMarkdown(editor.getJSON() as JSONNode);
  }

  editor.on('update', () => {
    if (silent) return;
    const md = getMarkdown();
    if (md === lastMarkdown) return;
    lastMarkdown = md;
    options.onChange?.(md);
  });

  /** ブロック（写真・URL の枠）をカーソル位置へ。空の行にいればその行と置き換える（textarea と同じ行数）。 */
  function insertBlock(node: PMNode): void {
    const view = editor.view;
    const { state } = view;
    const sel = state.selection;
    let tr = state.tr;
    let at: number;
    const $from = sel.$from;
    if (sel instanceof NodeSelection) {
      at = sel.to;
      tr = tr.insert(at, node);
    } else if (
      $from.parent.type.name === 'paragraph' &&
      $from.parent.content.size === 0 &&
      $from.node($from.depth - 1).type.contentMatch.matchType(node.type)
    ) {
      at = $from.before();
      tr = tr.replaceWith(at, $from.after(), node);
    } else {
      tr = tr.replaceSelectionWith(node, false);
      at = tr.mapping.map(sel.from, -1);
      // replaceSelectionWith は段落を割って差し込む。差し込んだ位置を探し直す
      const found = findNodeNear(tr.doc, at, node);
      at = found ?? at;
    }
    // 次の行へカーソルを置く。後ろに何も無ければ空の段落を足す（写真の後に書き足せるように）
    const after = at + node.nodeSize;
    const $after = tr.doc.resolve(Math.min(after, tr.doc.content.size));
    const next = $after.nodeAfter;
    if (next && next.isTextblock) {
      tr = tr.setSelection(TextSelection.create(tr.doc, after + 1));
    } else if (next) {
      tr = tr.setSelection(NodeSelection.create(tr.doc, after));
    } else {
      tr = tr.insert(after, editor.schema.nodes.paragraph!.create());
      tr = tr.setSelection(TextSelection.create(tr.doc, after + 1));
    }
    view.dispatch(tr.scrollIntoView());
  }

  function findNodeNear(doc: PMNode, pos: number, node: PMNode): number | null {
    let hit: number | null = null;
    doc.nodesBetween(Math.max(0, pos - 2), Math.min(doc.content.size, pos + node.nodeSize + 2), (n, p) => {
      if (hit === null && n.type === node.type && n.attrs.src === node.attrs.src && n.attrs.url === node.attrs.url) hit = p;
      return hit === null;
    });
    return hit;
  }

  async function insertImages(files: File[]): Promise<void> {
    if (!files.length || busy || !options.uploadImage) return;
    busy = true;
    showError(null);
    try {
      for (let i = 0; i < files.length; i++) {
        toolbar?.setBusy(fill(labels.uploading, { done: i, total: files.length }));
        let url: string;
        try {
          url = await options.uploadImage(files[i]!);
        } catch (e) {
          showError(fill(labels.uploadFailed, { n: i + 1, message: e instanceof Error ? e.message : String(e) }));
          return;
        }
        if (editor.isDestroyed) return;
        insertBlock(editor.schema.nodes.image!.create({ src: url, alt: '' }));
      }
    } finally {
      busy = false;
      toolbar?.setBusy(null);
    }
  }

  function insertUrl(raw: string): boolean {
    const url = raw.trim();
    if (!url || !isBlockUrl(url)) return false;
    insertBlock(editor.schema.nodes.urlBlock!.create({ url }));
    return true;
  }

  function insertPlainText(view: EditorView, text: string): void {
    const clean = text.replace(/\r\n?/g, '\n');
    const { state } = view;
    const $from = state.selection.$from;
    // 空の行に URL だけを貼ったら、その場で枠にする（読み直したときと同じ見え方に）
    if (
      !clean.includes('\n') &&
      isBlockUrl(clean) &&
      $from.parent.type.name === 'paragraph' &&
      $from.parent.content.size === 0 &&
      $from.node($from.depth - 1).type.contentMatch.matchType(editor.schema.nodes.urlBlock!)
    ) {
      insertBlock(editor.schema.nodes.urlBlock!.create({ url: clean }));
      return;
    }
    if ($from.parent.type.spec.code || !clean.includes('\n')) {
      view.dispatch(state.tr.insertText(clean).scrollIntoView());
      return;
    }
    view.dispatch(state.tr.replaceSelection(plainTextSlice(editor.schema, clean)).scrollIntoView());
  }

  /** 貼り付け: 画像だけなら写真に・それ以外は文字だけ（他所の書式は持ち込まない）。 */
  function onPaste(view: EditorView, event: ClipboardEvent): boolean {
    const dt = event.clipboardData;
    if (!dt) return false;
    const text = dt.getData('text/plain');
    const files = imagesFrom(dt);
    if (files.length && !text.trim()) {
      event.preventDefault();
      void insertImages(files);
      return true;
    }
    // このエディタ自身からのコピーは書式ごと（ProseMirror の印が付いている）
    if (dt.getData('text/html').includes('data-pm-slice')) return false;
    if (!text) return files.length > 0;
    event.preventDefault();
    insertPlainText(view, text);
    return true;
  }

  function onDrop(view: EditorView, event: DragEvent, moved: boolean): boolean {
    root.classList.remove('k-editor-dropping');
    const dt = event.dataTransfer;
    const files = imagesFrom(dt);
    const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (files.length) {
      event.preventDefault();
      if (coords) {
        const $pos = view.state.doc.resolve(coords.pos);
        view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)));
      }
      void insertImages(files);
      return true;
    }
    if (moved || view.dragging) return false; // エディタの中での移動は ProseMirror に任せる
    const text = dt?.getData('text/plain');
    if (!text) return false;
    event.preventDefault();
    if (coords) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(coords.pos))));
    insertPlainText(view, text);
    return true;
  }

  const items = options.toolbar === false ? null : (options.toolbar ?? DEFAULT_TOOLBAR);
  const toolbar = items
    ? new Toolbar(toolbarHost, editor, {
        items: options.uploadImage ? items : items.filter((i) => i !== 'photo'),
        labels,
        isBlockUrl,
        onPhoto: async () => {
          const files = await (options.pickImages ?? defaultPickImages)();
          await insertImages(files);
        },
        onEmbed: (url) => insertUrl(url),
        showError,
      })
    : null;

  loadMarkdown(options.markdown ?? '');

  return {
    getMarkdown,
    setMarkdown: (md: string) => {
      if (md === getMarkdown()) {
        lastMarkdown = md;
        return;
      }
      loadMarkdown(md);
    },
    focus: () => editor.commands.focus(),
    insertImages,
    insertUrl,
    destroy: () => {
      toolbar?.destroy();
      editor.destroy();
      root.remove();
    },
    tiptap: editor,
    root,
  };
}
