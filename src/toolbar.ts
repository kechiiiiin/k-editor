// 上に貼り付くツールバーと、URL を入れる小さな欄（prompt() は使わない。iOS で辛いため）。
import type { Editor } from '@tiptap/core';
import type { KEditorLabels } from './editor.js';
import { ICONS } from './icons.js';

export type ToolbarItem =
  | 'photo'
  | 'embed'
  | 'h2'
  | 'h3'
  | 'bold'
  | 'strike'
  | 'link'
  | 'bulletList'
  | 'orderedList'
  | 'blockquote'
  | 'hr'
  | 'undo'
  | 'redo'
  | '|';

export const DEFAULT_TOOLBAR: ToolbarItem[] = [
  'photo',
  'embed',
  '|',
  'h2',
  'h3',
  'bold',
  'strike',
  'link',
  '|',
  'bulletList',
  'orderedList',
  'blockquote',
  'hr',
  '|',
  'undo',
  'redo',
];

interface ToolbarDeps {
  items: ToolbarItem[];
  labels: KEditorLabels;
  isBlockUrl: (line: string) => boolean;
  onPhoto: () => Promise<void>;
  onEmbed: (url: string) => boolean;
  showError: (message: string | null) => void;
}

type BarMode = 'link' | 'embed';

export class Toolbar {
  private bar: HTMLElement;
  private buttons = new Map<ToolbarItem, HTMLButtonElement>();
  private form: HTMLElement;
  private input: HTMLInputElement;
  private unlinkBtn: HTMLButtonElement;
  private mode: BarMode | null = null;
  private savedSel: { from: number; to: number } | null = null;
  private busyLabel: string | null = null;
  private refresh = (): void => this.update();

  constructor(
    host: HTMLElement,
    private editor: Editor,
    private deps: ToolbarDeps
  ) {
    this.bar = document.createElement('div');
    this.bar.className = 'k-editor-toolbar';
    this.bar.setAttribute('role', 'toolbar');
    for (const item of deps.items) {
      if (item === '|') {
        const sep = document.createElement('span');
        sep.className = 'k-editor-sep';
        sep.setAttribute('aria-hidden', 'true');
        this.bar.appendChild(sep);
        continue;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `k-editor-btn k-editor-btn-${item}`;
      // 見た目は記号だけ。名前は読み上げ（aria-label）と、マウスを乗せたとき（title）に出す
      b.innerHTML = ICONS[item];
      b.setAttribute('aria-label', deps.labels[item]);
      b.title = deps.labels[item];
      b.dataset.item = item;
      // ⚠️ 押してもエディタのフォーカスと選択を奪わない（iOS でキーボードが閉じない・選択が残る）
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => this.run(item));
      this.buttons.set(item, b);
      this.bar.appendChild(b);
    }

    // URL の欄（リンク・埋め込みで共用）
    this.form = document.createElement('div');
    this.form.className = 'k-editor-urlbar';
    this.form.hidden = true;
    this.input = document.createElement('input');
    this.input.type = 'url';
    this.input.inputMode = 'url';
    this.input.autocapitalize = 'off';
    this.input.spellcheck = false;
    this.input.className = 'k-editor-urlbar-input';
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'k-editor-urlbar-apply';
    apply.textContent = deps.labels.apply;
    apply.addEventListener('click', () => this.submit());
    this.unlinkBtn = document.createElement('button');
    this.unlinkBtn.type = 'button';
    this.unlinkBtn.className = 'k-editor-urlbar-unlink';
    this.unlinkBtn.textContent = deps.labels.unlink;
    this.unlinkBtn.addEventListener('click', () => {
      this.restoreSelection().extendMarkRange('link').unsetLink().run();
      this.close();
    });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'k-editor-urlbar-cancel';
    cancel.textContent = deps.labels.cancel;
    cancel.addEventListener('click', () => {
      this.close();
      this.editor.commands.focus();
    });
    this.input.addEventListener('keydown', (e) => {
      // ⚠️ IME の変換を確定する Enter で送らない
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
        this.editor.commands.focus();
      }
    });
    this.form.append(this.input, apply, this.unlinkBtn, cancel);

    host.append(this.bar, this.form);
    editor.on('transaction', this.refresh);
    editor.on('selectionUpdate', this.refresh);
    this.update();
  }

  setBusy(label: string | null): void {
    this.busyLabel = label;
    const b = this.buttons.get('photo');
    if (b) {
      // 送っている間だけ進み具合を文字で出し、終わったら記号に戻す
      if (label) b.textContent = label;
      else b.innerHTML = ICONS.photo;
      b.classList.toggle('k-editor-btn-busy', !!label);
      b.disabled = !!label;
    }
  }

  openLink(): void {
    this.open('link');
  }

  private open(mode: BarMode): void {
    const { from, to } = this.editor.state.selection;
    this.savedSel = { from, to };
    this.mode = mode;
    this.form.hidden = false;
    this.form.dataset.mode = mode;
    this.input.placeholder = mode === 'link' ? this.deps.labels.linkPlaceholder : this.deps.labels.urlPlaceholder;
    const href = mode === 'link' ? (this.editor.getAttributes('link').href as string | undefined) : undefined;
    this.input.value = href ?? '';
    this.unlinkBtn.hidden = !(mode === 'link' && href);
    this.deps.showError(null);
    this.update();
    this.input.focus();
  }

  private close(): void {
    this.mode = null;
    this.form.hidden = true;
    this.savedSel = null;
    this.update();
  }

  private restoreSelection() {
    const chain = this.editor.chain().focus();
    const s = this.savedSel;
    if (s && s.to <= this.editor.state.doc.content.size) chain.setTextSelection(s);
    return chain;
  }

  private submit(): void {
    const url = this.input.value.trim();
    if (this.mode === 'embed') {
      this.restoreSelection().run();
      if (!url) {
        this.close();
        return;
      }
      if (!this.deps.onEmbed(url)) {
        this.deps.showError(this.deps.labels.notUrl);
        this.input.focus();
        return;
      }
      this.close();
      return;
    }
    // link
    if (!url) {
      this.restoreSelection().extendMarkRange('link').unsetLink().run();
      this.close();
      return;
    }
    const s = this.savedSel;
    const empty = !s || s.from === s.to;
    if (empty && !this.editor.isActive('link')) {
      this.restoreSelection()
        .insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] })
        .unsetMark('link')
        .run();
    } else {
      this.restoreSelection().extendMarkRange('link').setLink({ href: url }).run();
    }
    this.close();
  }

  private run(item: ToolbarItem): void {
    const c = this.editor.chain().focus();
    switch (item) {
      case 'photo':
        void this.deps.onPhoto();
        return;
      case 'embed':
        if (this.mode === 'embed') this.close();
        else this.open('embed');
        return;
      case 'link':
        if (this.mode === 'link') this.close();
        else this.open('link');
        return;
      case 'h2':
        c.toggleHeading({ level: 2 }).run();
        return;
      case 'h3':
        c.toggleHeading({ level: 3 }).run();
        return;
      case 'bold':
        c.toggleBold().run();
        return;
      case 'strike':
        c.toggleStrike().run();
        return;
      case 'bulletList':
        c.toggleBulletList().run();
        return;
      case 'orderedList':
        c.toggleOrderedList().run();
        return;
      case 'blockquote':
        c.toggleBlockquote().run();
        return;
      case 'hr':
        c.setHorizontalRule().run();
        return;
      case 'undo':
        c.undo().run();
        return;
      case 'redo':
        c.redo().run();
        return;
      default:
        return;
    }
  }

  private update(): void {
    const e = this.editor;
    const active: Partial<Record<ToolbarItem, boolean>> = {
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bold: e.isActive('bold'),
      strike: e.isActive('strike'),
      link: e.isActive('link') || this.mode === 'link',
      embed: this.mode === 'embed',
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      blockquote: e.isActive('blockquote'),
    };
    for (const [item, b] of this.buttons) {
      if (item in active) b.setAttribute('aria-pressed', active[item] ? 'true' : 'false');
      if (item === 'undo') b.disabled = !e.can().undo();
      if (item === 'redo') b.disabled = !e.can().redo();
      if (item === 'photo') b.disabled = !!this.busyLabel;
    }
  }

  destroy(): void {
    this.editor.off('transaction', this.refresh);
    this.editor.off('selectionUpdate', this.refresh);
  }
}
