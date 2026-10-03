// k-editor のブロック（写真・URL の枠）と、Markdown の書き方を覚えておくための属性の足し込み。
import { Mark, Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';
import { NodeSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import { BulletList, ListItem, OrderedList } from '@tiptap/extension-list';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import CodeBlock from '@tiptap/extension-code-block';

/** リンクカードの中身（fetchCard が返す形）。 */
export interface LinkCardData {
  title: string;
  description?: string;
  /** 一段目に出すドメイン等 */
  domain?: string;
  /** 画像の URL。渡す側で安全なものだけにすること */
  image?: string | null;
}

export type EmbedResult = HTMLElement | { dom: HTMLElement; destroy?: () => void } | null;

export interface BlockHooks {
  renderEmbed?: (url: string) => EmbedResult;
  fetchCard?: (url: string) => Promise<LinkCardData | null> | LinkCardData | null;
  removeLabel: string;
  imageRemoveLabel: string;
}

function removeButton(label: string, onRemove: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'k-editor-remove';
  b.setAttribute('aria-label', label);
  b.textContent = '×';
  // フォーカスを奪わない（iOS でキーボードが閉じたり選択が飛んだりしないように）
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onRemove();
  });
  return b;
}

function deleteNodeAt(editor: Editor, getPos: () => number | undefined, node: PMNode): void {
  const pos = getPos();
  if (typeof pos !== 'number') return;
  const { tr } = editor.state;
  editor.view.dispatch(tr.delete(pos, pos + node.nodeSize).scrollIntoView());
}

class BlockView implements NodeView {
  dom: HTMLElement;
  destroyers: (() => void)[] = [];
  constructor(className: string) {
    this.dom = document.createElement('div');
    this.dom.className = className;
    this.dom.contentEditable = 'false';
  }
  selectNode(): void {
    this.dom.classList.add('k-editor-selected');
  }
  deselectNode(): void {
    this.dom.classList.remove('k-editor-selected');
  }
  stopEvent(e: Event): boolean {
    const t = e.target as Element | null;
    // × ボタンと、埋め込みの中（iframe 等）は ProseMirror に渡さない
    return !!t && !!t.closest?.('.k-editor-remove, .k-editor-embed-body');
  }
  ignoreMutation(): boolean {
    return true;
  }
  destroy(): void {
    for (const d of this.destroyers) d();
    this.destroyers = [];
  }
}

export function createImageNode(hooks: BlockHooks) {
  return Node.create({
    name: 'image',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
      return {
        src: { default: '' },
        alt: { default: '' },
        title: { default: null },
      };
    },
    parseHTML() {
      return [
        {
          tag: 'img[src]',
          getAttrs: (el) => {
            const e = el as HTMLElement;
            return { src: e.getAttribute('src') ?? '', alt: e.getAttribute('alt') ?? '', title: e.getAttribute('title') };
          },
        },
      ];
    },
    renderHTML({ HTMLAttributes }) {
      return ['img', mergeAttributes(HTMLAttributes)];
    },
    addNodeView() {
      return ({ node, getPos, editor }) => {
        let current = node;
        const view = new BlockView('k-editor-image');
        const img = document.createElement('img');
        img.src = String(node.attrs.src);
        img.alt = String(node.attrs.alt ?? '');
        img.draggable = false;
        view.dom.appendChild(img);
        view.dom.appendChild(removeButton(hooks.imageRemoveLabel, () => deleteNodeAt(editor, getPos, current)));
        // 写真を押したら選ぶ（× と同じく、iOS で確実に選べるように）
        view.dom.addEventListener('mousedown', (e) => {
          if ((e.target as Element).closest('.k-editor-remove')) return;
          const pos = getPos();
          if (typeof pos !== 'number') return;
          e.preventDefault();
          editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
          editor.view.focus();
        });
        return Object.assign(view, {
          update(n: PMNode) {
            if (n.type !== current.type) return false;
            if (n.attrs.src !== current.attrs.src) img.src = String(n.attrs.src);
            current = n;
            return true;
          },
        });
      };
    },
  });
}

function cardElement(url: string, card: LinkCardData): HTMLElement {
  const box = document.createElement('div');
  box.className = 'k-editor-card';
  const thumb = document.createElement('span');
  thumb.className = 'k-editor-card-thumb';
  if (card.image) {
    const img = document.createElement('img');
    img.src = card.image;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => img.remove());
    thumb.appendChild(img);
  }
  box.appendChild(thumb);
  const text = document.createElement('span');
  text.className = 'k-editor-card-text';
  const add = (cls: string, value: string | undefined): void => {
    if (!value) return;
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = value; // ⚠️ 相手のサイトから来た文字は必ずテキストとして
    text.appendChild(s);
  };
  add('k-editor-card-site', card.domain);
  add('k-editor-card-title', card.title || url);
  add('k-editor-card-desc', card.description);
  box.appendChild(text);
  return box;
}

function plainUrlElement(url: string): HTMLElement {
  const d = document.createElement('div');
  d.className = 'k-editor-url-plain';
  d.textContent = url;
  return d;
}

export function createUrlBlockNode(hooks: BlockHooks) {
  return Node.create({
    name: 'urlBlock',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
      return { url: { default: '' } };
    },
    parseHTML() {
      return [{ tag: 'div[data-url-block]', getAttrs: (el) => ({ url: (el as HTMLElement).getAttribute('data-url-block') ?? '' }) }];
    },
    renderHTML({ node }) {
      return ['div', { 'data-url-block': node.attrs.url }, String(node.attrs.url)];
    },
    renderText({ node }) {
      return String(node.attrs.url);
    },
    addNodeView() {
      return ({ node, getPos, editor }) => {
        let current = node;
        const view = new BlockView('k-editor-url');
        const body = document.createElement('div');
        body.className = 'k-editor-embed-body';
        view.dom.appendChild(body);
        view.dom.appendChild(removeButton(hooks.removeLabel, () => deleteNodeAt(editor, getPos, current)));
        view.dom.addEventListener('mousedown', (e) => {
          if ((e.target as Element).closest('.k-editor-remove')) return;
          const pos = getPos();
          if (typeof pos !== 'number') return;
          editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
        });

        let alive = true;
        view.destroyers.push(() => {
          alive = false;
        });
        const url = String(node.attrs.url);
        const embed = hooks.renderEmbed?.(url) ?? null;
        if (embed) {
          const dom = embed instanceof HTMLElement ? embed : embed.dom;
          view.dom.classList.add('k-editor-url-embed');
          body.appendChild(dom);
          if (!(embed instanceof HTMLElement) && embed.destroy) view.destroyers.push(embed.destroy);
        } else {
          body.appendChild(plainUrlElement(url));
          if (hooks.fetchCard) {
            Promise.resolve(hooks.fetchCard(url))
              .then((card) => {
                if (!alive || !card) return;
                body.replaceChildren(cardElement(url, card));
                view.dom.classList.add('k-editor-url-card');
              })
              .catch(() => {
                /* カードが取れなければ URL のまま */
              });
          }
        }
        return Object.assign(view, {
          update(n: PMNode) {
            // URL が変わったら作り直してもらう（埋め込みを描き直す）
            if (n.type !== current.type || n.attrs.url !== current.attrs.url) return false;
            current = n;
            return true;
          },
        });
      };
    },
  });
}

/* ---------- Markdown の書き方を覚えておく属性 ---------- */

const hidden = { rendered: false } as const;

export const KBulletList = BulletList.extend({
  addAttributes() {
    return { ...this.parent?.(), bullet: { default: '-', ...hidden } };
  },
});

export const KOrderedList = OrderedList.extend({
  addAttributes() {
    return { ...this.parent?.(), delimiter: { default: '.', ...hidden } };
  },
});

/** 1 項目 = 1 段落。Tab での入れ子はしない（Markdown へ素直に戻せる形だけにする）。 */
export const KListItem = ListItem.extend({
  content: 'paragraph',
  addKeyboardShortcuts() {
    return { Enter: () => this.editor.commands.splitListItem(this.name) };
  },
});

export const KHorizontalRule = HorizontalRule.extend({
  addAttributes() {
    return { markup: { default: '---', ...hidden } };
  },
});

export const KCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      open: { default: null, ...hidden },
      close: { default: '```', ...hidden },
    };
  },
});

/* ---------- リンク（@tiptap/extension-link は自動リンク用の linkify を抱えて重いので、要るぶんだけ） ---------- */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    kLink: {
      setLink: (attrs: { href: string }) => ReturnType;
      unsetLink: () => ReturnType;
    };
  }
}

export const KLink = Mark.create({
  name: 'link',
  priority: 1000,
  inclusive: false,
  addAttributes() {
    return { href: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'a[href]', getAttrs: (el) => ({ href: (el as HTMLElement).getAttribute('href') }) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['a', mergeAttributes(HTMLAttributes, { rel: 'noopener noreferrer nofollow' }), 0];
  },
  addCommands() {
    return {
      setLink:
        (attrs) =>
        ({ chain }) =>
          chain().setMark(this.name, attrs).run(),
      unsetLink:
        () =>
        ({ chain }) =>
          chain().unsetMark(this.name, { extendEmptyMarkRange: true }).run(),
    };
  },
});
