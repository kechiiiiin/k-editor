// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type KEditor } from '../src/index';
import { CASES } from './cases';

// 仮名だけで書く（このリポジトリは public）。

// jsdom に無いレイアウトの API（ProseMirror のスクロール・座標で使う）
if (!Element.prototype.getClientRects) {
  Element.prototype.getClientRects = function () {
    return [] as unknown as DOMRectList;
  };
}
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = function () {
    return [] as unknown as DOMRectList;
  };
  Range.prototype.getBoundingClientRect = function () {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
}

let editors: KEditor[] = [];
function mount(options: Parameters<typeof createEditor>[1] = {}): KEditor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ed = createEditor(el, options);
  editors.push(ed);
  return ed;
}

afterEach(() => {
  for (const e of editors) e.destroy();
  editors = [];
  document.body.innerHTML = '';
});

function keydown(target: Element, init: KeyboardEventInit & { keyCode?: number }): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (init.keyCode !== undefined) Object.defineProperty(e, 'keyCode', { value: init.keyCode });
  target.dispatchEvent(e);
  return e;
}

function paste(target: Element, data: Record<string, string>, files: File[] = []): void {
  const e = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  const dt = {
    getData: (t: string) => data[t] ?? '',
    files,
    items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
    types: Object.keys(data),
  };
  Object.defineProperty(e, 'clipboardData', { value: dt });
  target.dispatchEvent(e);
}

describe('エディタに載せても往復する（ProseMirror の文書を通して）', () => {
  for (const [name, md] of Object.entries(CASES)) {
    it(name, () => {
      const ed = mount({ markdown: md });
      expect(ed.getMarkdown()).toBe(md);
    });
  }

  it('読み込んだだけでは onChange を呼ばない', () => {
    const onChange = vi.fn();
    const ed = mount({ markdown: 'あ\n\nい', onChange });
    ed.setMarkdown('う');
    expect(onChange).not.toHaveBeenCalled();
    expect(ed.getMarkdown()).toBe('う');
  });
});

describe('IME', () => {
  it('変換中の Enter（isComposing）で段落を割らない・送信しない', () => {
    const onSubmit = vi.fn();
    const onChange = vi.fn();
    const ed = mount({ markdown: 'あいう', onSubmit, onChange });
    ed.tiptap.commands.setTextSelection(3);
    const dom = ed.tiptap.view.dom;
    keydown(dom, { key: 'Enter', isComposing: true });
    keydown(dom, { key: 'Enter', isComposing: true, metaKey: true });
    expect(ed.getMarkdown()).toBe('あいう');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keyCode 229 の Enter（Safari の確定）でも割らない', () => {
    const ed = mount({ markdown: 'あいう' });
    ed.tiptap.commands.setTextSelection(3);
    keydown(ed.tiptap.view.dom, { key: 'Enter', keyCode: 229 });
    expect(ed.getMarkdown()).toBe('あいう');
  });

  it('ふつうの Enter は改行（比べるための対照）', () => {
    const ed = mount({ markdown: 'あいう' });
    ed.tiptap.commands.setTextSelection(3);
    keydown(ed.tiptap.view.dom, { key: 'Enter', keyCode: 13 });
    expect(ed.getMarkdown()).toBe('あい\nう');
  });

  it('Cmd/Ctrl+Enter は送信', () => {
    const onSubmit = vi.fn();
    const ed = mount({ markdown: 'あ', onSubmit });
    keydown(ed.tiptap.view.dom, { key: 'Enter', keyCode: 13, metaKey: true });
    keydown(ed.tiptap.view.dom, { key: 'Enter', keyCode: 13, ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(ed.getMarkdown()).toBe('あ');
  });

  it('URL の欄でも、変換中の Enter では入れない', () => {
    const ed = mount({ markdown: 'あ' });
    const btn = ed.root.querySelector('.k-editor-btn-embed') as HTMLButtonElement;
    btn.click();
    const input = ed.root.querySelector('.k-editor-urlbar-input') as HTMLInputElement;
    input.value = 'https://example.com/';
    keydown(input, { key: 'Enter', isComposing: true });
    expect(ed.getMarkdown()).toBe('あ');
    keydown(input, { key: 'Enter', keyCode: 13 });
    expect(ed.getMarkdown()).toContain('https://example.com/');
  });
});

describe('ツールバー', () => {
  function click(ed: KEditor, item: string): void {
    (ed.root.querySelector(`.k-editor-btn-${item}`) as HTMLButtonElement).click();
  }

  it('既定の道具が並ぶ（斜体は無い）', () => {
    const ed = mount({ uploadImage: async () => '/x.jpg' });
    const items = [...ed.root.querySelectorAll('.k-editor-btn')].map((b) => (b as HTMLElement).dataset.item);
    expect(items).toEqual(['photo', 'embed', 'h2', 'h3', 'bold', 'strike', 'link', 'bulletList', 'orderedList', 'blockquote', 'hr', 'undo', 'redo']);
  });

  describe('icons', () => {
    const btn = (ed: KEditor, item: string) => ed.root.querySelector(`.k-editor-btn-${item}`) as HTMLButtonElement;

    it('文字列は HTML として入る', () => {
      const ed = mount({ icons: { bold: '<i class="mine">太</i>' } });
      expect(btn(ed, 'bold').querySelector('i.mine')?.textContent).toBe('太');
    });

    it('要素は複製され、同じ要素を二か所に渡しても両方に入る', () => {
      const el = document.createElement('span');
      el.className = 'shared';
      el.textContent = 'X';
      const ed = mount({ icons: { bold: el, strike: el } });
      expect(btn(ed, 'bold').querySelector('.shared')?.textContent).toBe('X');
      expect(btn(ed, 'strike').querySelector('.shared')?.textContent).toBe('X');
      expect(btn(ed, 'bold').querySelector('.shared')).not.toBe(btn(ed, 'strike').querySelector('.shared'));
      expect(el.parentElement).toBeNull();
    });

    it('関数はボタンごとに呼ばれる', () => {
      const make = vi.fn(() => {
        const s = document.createElement('span');
        s.className = 'gen';
        return s;
      });
      const ed = mount({ icons: { bold: make, strike: make } });
      expect(make).toHaveBeenCalledTimes(2);
      expect(btn(ed, 'bold').querySelector('.gen')).not.toBeNull();
      expect(btn(ed, 'strike').querySelector('.gen')).not.toBeNull();
    });

    it('渡さないボタンは既定のまま・aria-label と title は labels のまま', () => {
      const ed = mount({ icons: { bold: '<i>太</i>' }, labels: { bold: 'ふとい' } });
      expect(btn(ed, 'link').querySelector('svg')).not.toBeNull();
      expect(btn(ed, 'h2').querySelector('.k-editor-glyph')).not.toBeNull();
      expect(btn(ed, 'bold').getAttribute('aria-label')).toBe('ふとい');
      expect(btn(ed, 'bold').title).toBe('ふとい');
    });

    it('写真のアップロードが終わると差し替えたアイコンに戻る', async () => {
      let done!: (u: string) => void;
      const ed = mount({
        icons: { photo: '<b class="mine">写</b>' },
        uploadImage: () => new Promise<string>((r) => (done = r)),
        pickImages: async () => [new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })],
      });
      expect(btn(ed, 'photo').querySelector('.mine')).not.toBeNull();
      btn(ed, 'photo').click();
      await vi.waitFor(() => expect(btn(ed, 'photo').classList.contains('k-editor-btn-busy')).toBe(true));
      expect(btn(ed, 'photo').querySelector('.mine')).toBeNull();
      done('/p/a.jpg');
      await vi.waitFor(() => expect(btn(ed, 'photo').classList.contains('k-editor-btn-busy')).toBe(false));
      expect(btn(ed, 'photo').querySelector('.mine')?.textContent).toBe('写');
    });
  });

  it('uploadImage が無ければ写真の道具は出さない', () => {
    const ed = mount();
    expect(ed.root.querySelector('.k-editor-btn-photo')).toBeNull();
  });

  it('太字・取り消し線・見出し・リスト・引用・区切り線', () => {
    const ed = mount({ markdown: 'あいう' });
    ed.tiptap.commands.setTextSelection({ from: 1, to: 3 });
    click(ed, 'bold');
    expect(ed.getMarkdown()).toBe('**あい**う');
    click(ed, 'strike');
    expect(ed.getMarkdown()).toBe('**~~あい~~**う');
    click(ed, 'h2');
    expect(ed.getMarkdown()).toBe('## **~~あい~~**う');
    click(ed, 'h3');
    expect(ed.getMarkdown()).toBe('### **~~あい~~**う');
    click(ed, 'h3');
    click(ed, 'bulletList');
    expect(ed.getMarkdown()).toBe('- **~~あい~~**う');
    click(ed, 'bulletList');
    click(ed, 'orderedList');
    expect(ed.getMarkdown()).toBe('1. **~~あい~~**う');
    click(ed, 'orderedList');
    click(ed, 'blockquote');
    expect(ed.getMarkdown()).toBe('> **~~あい~~**う');
    click(ed, 'undo');
    expect(ed.getMarkdown()).toBe('**~~あい~~**う');
    click(ed, 'redo');
    expect(ed.getMarkdown()).toBe('> **~~あい~~**う');
  });

  it('区切り線', () => {
    const ed = mount({ markdown: 'あ' });
    ed.tiptap.commands.setTextSelection(2);
    click(ed, 'hr');
    expect(ed.getMarkdown().startsWith('あ\n---')).toBe(true);
  });

  it('リンクは小さな欄で入れる（prompt を使わない）', () => {
    const prompt = vi.spyOn(window, 'prompt');
    const ed = mount({ markdown: 'あいう' });
    ed.tiptap.commands.setTextSelection({ from: 1, to: 3 });
    click(ed, 'link');
    const input = ed.root.querySelector('.k-editor-urlbar-input') as HTMLInputElement;
    expect((ed.root.querySelector('.k-editor-urlbar') as HTMLElement).hidden).toBe(false);
    input.value = 'https://example.com/';
    (ed.root.querySelector('.k-editor-urlbar-apply') as HTMLButtonElement).click();
    expect(ed.getMarkdown()).toBe('[あい](https://example.com/)う');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('埋め込みの URL は行として独立したブロックで入る', () => {
    const renderEmbed = vi.fn((url: string) => {
      const d = document.createElement('div');
      d.className = 'fake-embed';
      d.textContent = url;
      return d;
    });
    const ed = mount({ markdown: 'あ', renderEmbed });
    ed.tiptap.commands.setTextSelection(2);
    click(ed, 'embed');
    (ed.root.querySelector('.k-editor-urlbar-input') as HTMLInputElement).value = 'https://www.youtube.com/watch?v=abcdefghijk';
    (ed.root.querySelector('.k-editor-urlbar-apply') as HTMLButtonElement).click();
    expect(ed.getMarkdown()).toBe('あ\nhttps://www.youtube.com/watch?v=abcdefghijk\n');
    expect(ed.root.querySelector('.fake-embed')).not.toBeNull();
  });

  it('埋め込みでなければ fetchCard のカード', async () => {
    const ed = mount({
      markdown: 'https://example.com/a',
      renderEmbed: () => null,
      fetchCard: async () => ({ title: '<b>たいとる</b>', domain: 'example.com' }),
    });
    await new Promise((r) => setTimeout(r, 0));
    const title = ed.root.querySelector('.k-editor-card-title');
    expect(title?.textContent).toBe('<b>たいとる</b>'); // HTML にしない
    expect(ed.root.querySelector('.k-editor-card-title b')).toBeNull();
  });
});

describe('写真', () => {
  const png = (): File => new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });

  it('ボタン: 選んだ写真を上げて、カーソルの行に入れる', async () => {
    let n = 0;
    const ed = mount({
      markdown: 'あ\n\nい',
      uploadImage: async () => `/p/${++n}.jpg`,
      pickImages: async () => [png(), png()],
    });
    // 空の行（2 行目）にカーソル
    ed.tiptap.commands.setTextSelection(4);
    (ed.root.querySelector('.k-editor-btn-photo') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(ed.getMarkdown()).toBe('あ\n![](/p/1.jpg)\n![](/p/2.jpg)\nい'));
  });

  it('貼り付け: 画像だけなら写真に', async () => {
    const ed = mount({ markdown: 'あ', uploadImage: async () => '/p/x.jpg' });
    ed.tiptap.commands.setTextSelection(2);
    paste(ed.tiptap.view.dom, {}, [png()]);
    await vi.waitFor(() => expect(ed.getMarkdown()).toBe('あ\n![](/p/x.jpg)\n'));
  });

  it('貼り付け: 文字も入っていれば文字として（写真にしない）', async () => {
    const upload = vi.fn(async () => '/p/x.jpg');
    const ed = mount({ markdown: 'あ', uploadImage: upload });
    ed.tiptap.commands.setTextSelection(2);
    paste(ed.tiptap.view.dom, { 'text/plain': 'いう', 'text/html': '<b>いう</b>' }, [png()]);
    expect(ed.getMarkdown()).toBe('あいう');
    expect(upload).not.toHaveBeenCalled();
  });

  it('ドラッグ＆ドロップ', async () => {
    const ed = mount({ markdown: 'あ', uploadImage: async () => '/p/d.jpg' });
    ed.tiptap.commands.setTextSelection(2);
    const e = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(e, 'dataTransfer', {
      value: { files: [png()], items: [{ kind: 'file', type: 'image/png', getAsFile: png }], getData: () => '', types: ['Files'] },
    });
    Object.defineProperty(e, 'clientX', { value: 0 });
    Object.defineProperty(e, 'clientY', { value: 0 });
    // jsdom は座標から位置を引けないので、落とした位置を決め打ちにする（あ の後ろ）
    ed.tiptap.view.posAtCoords = () => ({ pos: 2, inside: -1 });
    ed.tiptap.view.dom.dispatchEvent(e);
    await vi.waitFor(() => expect(ed.getMarkdown()).toBe('あ\n![](/p/d.jpg)\n'));
  });

  it('× で外せる', () => {
    const ed = mount({ markdown: 'あ\n![](/p/1.jpg)\nい' });
    const x = ed.root.querySelector('.k-editor-image .k-editor-remove') as HTMLButtonElement;
    x.click();
    expect(ed.getMarkdown()).toBe('あ\nい');
  });

  it('失敗はその場の文字で知らせる', async () => {
    const ed = mount({
      markdown: '',
      uploadImage: async () => {
        throw new Error('大きすぎます');
      },
      pickImages: async () => [png()],
    });
    (ed.root.querySelector('.k-editor-btn-photo') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(ed.root.querySelector('.k-editor-note')?.textContent).toContain('1枚目で失敗しました'));
  });
});

describe('貼り付けは文字だけ', () => {
  it('HTML の書式は捨てて、行ごとに入れる', () => {
    const ed = mount({ markdown: '' });
    paste(ed.tiptap.view.dom, { 'text/plain': 'いち\n\nに', 'text/html': '<h1>いち</h1><p><b>に</b></p>' });
    expect(ed.getMarkdown()).toBe('いち\n\nに');
  });

  it('空の行に URL だけ貼ると枠になる', () => {
    const ed = mount({ markdown: '' });
    paste(ed.tiptap.view.dom, { 'text/plain': 'https://example.com/' });
    expect(ed.root.querySelector('.k-editor-url')).not.toBeNull();
    expect(ed.getMarkdown()).toBe('https://example.com/\n');
  });
});
