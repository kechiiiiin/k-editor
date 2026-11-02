// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditor, DEFAULT_TOOLBAR, type KEditor } from '../src/index';
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

describe('ツールバーの置き場所', () => {
  it('既定は上（本文の前に置く）', () => {
    const ed = mount({ markdown: 'あ' });
    const wrap = ed.root.querySelector('.k-editor-toolbar-wrap')!;
    const content = ed.root.querySelector('.k-editor-content')!;
    expect(ed.root.classList.contains('k-editor-toolbar-bottom')).toBe(false);
    expect(ed.root.firstElementChild).toBe(wrap);
    expect(wrap.nextElementSibling).toBe(content);
  });

  it("'bottom' は本文の直後に置き、下置きの印を付ける", () => {
    const ed = mount({ markdown: 'あ', toolbarPosition: 'bottom' });
    const wrap = ed.root.querySelector('.k-editor-toolbar-wrap')!;
    const content = ed.root.querySelector('.k-editor-content')!;
    expect(ed.root.classList.contains('k-editor-toolbar-bottom')).toBe(true);
    expect(ed.root.firstElementChild).toBe(content);
    expect(content.nextElementSibling).toBe(wrap);
    // 道具も URL の欄も上置きと同じものが入っている
    expect(wrap.querySelector('.k-editor-toolbar')).not.toBeNull();
    expect(wrap.querySelector('.k-editor-urlbar')).not.toBeNull();
  });

  it('下置きでも IME の変換の確定の Enter で段落を割らない', () => {
    const ed = mount({ markdown: 'あ', toolbarPosition: 'bottom' });
    const e = keydown(ed.tiptap.view.dom, { key: 'Enter', keyCode: 229 });
    expect(e.defaultPrevented).toBe(true);
    expect(ed.getMarkdown()).toBe('あ');
  });

  it('下置きの見た目は sticky の bottom（style.css）', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const css = readFileSync(resolve(__dirname, '../style.css'), 'utf8');
    const rule = css.match(/\.k-editor-toolbar-bottom \.k-editor-toolbar-wrap \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/bottom:\s*0/);
    expect(rule).toMatch(/top:\s*auto/);
    expect(rule).toMatch(/safe-area-inset-bottom/);
    expect(css).not.toMatch(/k-editor-dock/);
    expect(css).not.toMatch(/position:\s*fixed/);
  });
});

describe('言葉のリンク（wikilink）', () => {
  const toolbar = ['photo', 'embed', '|', 'wikilink', 'h2', 'bold', '|', 'undo'] as const;
  const mountW = (markdown: string, options: Parameters<typeof createEditor>[1] = {}): KEditor =>
    mount({ markdown, toolbar: [...toolbar], ...options });
  const btn = (ed: KEditor): HTMLButtonElement => ed.root.querySelector('.k-editor-btn-wikilink') as HTMLButtonElement;
  const press = (ed: KEditor): void => btn(ed).click();
  const select = (ed: KEditor, from: number, to = from): void => {
    ed.tiptap.commands.setTextSelection({ from, to });
  };
  const type = (ed: KEditor, text: string): void => {
    ed.tiptap.view.dispatch(ed.tiptap.state.tr.insertText(text));
  };
  const words = (ed: KEditor): string[] => [...ed.root.querySelectorAll('.k-editor-wikilink')].map((e) => e.textContent ?? '');
  const brackets = (ed: KEditor): string[] => [...ed.root.querySelectorAll('.k-editor-wikilink-bracket')].map((e) => e.textContent ?? '');
  const note = (ed: KEditor): HTMLElement => ed.root.querySelector('.k-editor-note') as HTMLElement;

  describe('囲む', () => {
    it('前後に括弧が入り、続けて打つ文字は ]] の外に入る', () => {
      const onChange = vi.fn();
      const ed = mountW('あいう', { onChange });
      select(ed, 2, 3);
      press(ed);
      expect(ed.getMarkdown()).toBe('あ[[い]]う');
      expect(onChange).toHaveBeenLastCalledWith('あ[[い]]う');
      expect(ed.tiptap.state.selection.empty).toBe(true);
      type(ed, 'か');
      expect(ed.getMarkdown()).toBe('あ[[い]]かう');
      expect(words(ed)).toEqual(['い']);
    });

    it('一度の「戻す」で元に戻る', () => {
      const ed = mountW('あいう');
      select(ed, 2, 3);
      press(ed);
      (ed.root.querySelector('.k-editor-btn-undo') as HTMLButtonElement).click();
      expect(ed.getMarkdown()).toBe('あいう');
    });

    it('太字の中では括弧も太字の内側に入る', () => {
      const ed = mountW('**あい**う');
      select(ed, 1, 3);
      press(ed);
      expect(ed.getMarkdown()).toBe('**[[あい]]**う');
      ed.setMarkdown(ed.getMarkdown());
      expect(ed.getMarkdown()).toBe('**[[あい]]**う');
    });

    it('書式がまたがる選択では、括弧はどちらの書式にも入らない', () => {
      const ed = mountW('**あ**い');
      select(ed, 1, 3);
      press(ed);
      expect(ed.getMarkdown()).toBe('[[**あ**い]]');
    });

    it('見出し・リスト・引用の中でも囲める', () => {
      for (const [md, want] of [
        ['## あい', '## [[あい]]'],
        ['- あい', '- [[あい]]'],
        ['1. あい', '1. [[あい]]'],
        ['> あい', '> [[あい]]'],
      ] as const) {
        const ed = mountW(md);
        const at = ed.tiptap.state.doc.textContent.length;
        const start = md.startsWith('##') ? 1 : md.startsWith('>') ? 2 : 3;
        select(ed, start, start + at);
        press(ed);
        expect(ed.getMarkdown()).toBe(want);
      }
    });

    it('前後に空白のある選択もそのまま囲む（比べるときに空白は落ちる）', () => {
      const ed = mountW('あ い う');
      select(ed, 3, 5);
      press(ed);
      expect(ed.getMarkdown()).toBe('あ [[い ]]う');
      expect(words(ed)).toEqual(['い ']);
    });
  });

  describe('外す', () => {
    // あ[[いう]]え: あ=1-2 [[=2-4 いう=4-6 ]]=6-8 え=8-9
    it('カーソルが中にあれば括弧だけ外す', () => {
      const ed = mountW('あ[[いう]]え');
      select(ed, 5);
      press(ed);
      expect(ed.getMarkdown()).toBe('あいうえ');
      expect(words(ed)).toEqual([]);
      expect(ed.tiptap.state.selection.from).toBe(3); // い と う の間のまま
    });

    it('言葉を選んでいても、括弧ごと選んでいても外す', () => {
      for (const [from, to] of [
        [4, 6],
        [2, 8],
        [3, 7],
      ] as const) {
        const ed = mountW('あ[[いう]]え');
        select(ed, from, to);
        press(ed);
        expect(ed.getMarkdown()).toBe('あいうえ');
      }
    });

    it('外して戻すと括弧が戻る・もう一度囲むと同じになる', () => {
      const ed = mountW('あ[[いう]]え');
      select(ed, 5);
      press(ed);
      (ed.root.querySelector('.k-editor-btn-undo') as HTMLButtonElement).click();
      expect(ed.getMarkdown()).toBe('あ[[いう]]え');
      select(ed, 4, 6);
      press(ed);
      select(ed, 2, 4);
      press(ed);
      expect(ed.getMarkdown()).toBe('あ[[いう]]え');
    });

    it('太字の中の言葉も括弧だけ外す', () => {
      const ed = mountW('**[[あ]]**');
      select(ed, 4);
      press(ed);
      expect(ed.getMarkdown()).toBe('**あ**');
    });

    it('同じ行に複数あれば、カーソルのある言葉だけ', () => {
      const ed = mountW('[[あ]]と[[い]]');
      select(ed, 10);
      press(ed);
      expect(ed.getMarkdown()).toBe('[[あ]]とい');
    });
  });

  describe('何も変えない', () => {
    const cases: [string, string, number, number, string][] = [
      ['選択なし', 'あいう', 2, 2, '言葉を選んでから'],
      ['空白だけ', 'あ   い', 2, 5, '言葉を選んでから'],
      ['複数の塊にまたがる', '## あ\nい', 2, 5, '1行の中'],
      ['段落の中の改行を含む', 'あ\nい', 1, 5, '1行の中'],
      ['[ を含む', 'あ[い', 1, 4, '1行の中'],
      ['] を含む', 'あ]い', 1, 4, '1行の中'],
      ['言葉をまたぐ', '[[あ]]い[[う]]', 3, 11, '1行の中'],
      ['言葉に半分かかる', 'あ[[い]]', 1, 5, '1行の中'],
      ['括弧のすぐ外のカーソル（後ろ）', 'あ[[い]]う', 7, 7, '言葉を選んでから'],
      ['括弧のすぐ外のカーソル（前）', 'あ[[い]]う', 2, 2, '言葉を選んでから'],
      ['コードブロックの中', '```\nあいう\n```', 2, 4, '1行の中'],
      ['コードブロックの中のカーソル', '```\nあいう\n```', 2, 2, '言葉を選んでから'],
      ['インラインコードの中', 'あ`いう`え', 2, 4, '1行の中'],
      ['インラインコードにかかる', 'あ`いう`え', 1, 3, '1行の中'],
      ['リンクの文字', 'あ[いう](https://example.com/)え', 2, 4, '1行の中'],
    ];
    for (const [name, md, from, to, message] of cases) {
      it(name, () => {
        const onChange = vi.fn();
        const ed = mountW(md, { onChange });
        select(ed, from, to);
        press(ed);
        expect(ed.getMarkdown()).toBe(md);
        expect(onChange).not.toHaveBeenCalled();
        expect(note(ed).hidden).toBe(false);
        expect(note(ed).textContent).toContain(message);
      });
    }

    it('写真を選んでいるときも変えない', () => {
      const ed = mountW('![](/a/1.jpg)\nあ');
      ed.tiptap.commands.setNodeSelection(0);
      press(ed);
      expect(ed.getMarkdown()).toBe('![](/a/1.jpg)\nあ');
      expect(note(ed).hidden).toBe(false);
    });

    it('文言は labels で差し替えられ、onError があればそちらへ', () => {
      const onError = vi.fn();
      const ed = mountW('あ\nい', { onError, labels: { wikilinkEmpty: 'えらんで', wikilinkInvalid: 'むり' } });
      select(ed, 2);
      press(ed);
      expect(onError).toHaveBeenLastCalledWith('えらんで');
      select(ed, 1, 5);
      press(ed);
      expect(onError).toHaveBeenLastCalledWith('むり');
    });

    it('断りは選択が動くと消え、囲めたときも残らない', () => {
      const ed = mountW('あいう');
      select(ed, 2);
      press(ed);
      expect(note(ed).hidden).toBe(false);
      select(ed, 2, 3);
      expect(note(ed).hidden).toBe(true);
      select(ed, 2);
      press(ed);
      expect(note(ed).hidden).toBe(false);
      ed.tiptap.commands.setTextSelection({ from: 2, to: 3 });
      press(ed);
      expect(note(ed).hidden).toBe(true);
    });
  });

  describe('aria-pressed', () => {
    it('言葉の中にカーソルがある間だけ true', () => {
      const ed = mountW('あ[[いう]]え');
      const pressed = (): string | null => btn(ed).getAttribute('aria-pressed');
      expect(pressed()).toBe('false'); // 読み込んだ直後は先頭
      select(ed, 5);
      expect(pressed()).toBe('true');
      select(ed, 8);
      expect(pressed()).toBe('false');
      select(ed, 2);
      expect(pressed()).toBe('false');
      select(ed, 3);
      expect(pressed()).toBe('true');
    });

    it('囲んだ直後は外（カーソルは ]] の直後）、外した後も false', () => {
      const ed = mountW('あいう');
      select(ed, 2, 3);
      press(ed);
      expect(btn(ed).getAttribute('aria-pressed')).toBe('false');
      select(ed, 5);
      expect(btn(ed).getAttribute('aria-pressed')).toBe('true');
      press(ed);
      expect(btn(ed).getAttribute('aria-pressed')).toBe('false');
    });
  });

  describe('飾り', () => {
    it('括弧は薄く、中身は言葉の色の印。打つと追いかける', () => {
      const ed = mountW('あ[[いう]]え[[か]]');
      expect(words(ed)).toEqual(['いう', 'か']);
      expect(brackets(ed)).toEqual(['[[', ']]', '[[', ']]']);
      type(ed, '[[き]]');
      expect(words(ed)).toEqual(['き', 'いう', 'か']);
    });

    it('太字・見出し・リストの中も飾る。書式の途中で切れても飾る', () => {
      const ed = mountW('**[[あ]]**\n## [[い]]\n- [[う]]\n\n[[え**お**]]');
      expect(words(ed)).toEqual(['あ', 'い', 'う', 'え', 'お']);
    });

    it('言葉でないものは飾らない', () => {
      for (const md of [
        '[[]]',
        '[[ ]]',
        '[[\u3000]]',
        '[[ひらきっぱなし',
        'とじっぱなし]]',
        '[[あ\nい]]',
        '[あ]',
        '[[あ[い]]',
        '`[[あ]]`',
        '```\n[[あ]]\n```',
        '[[あ]](https://example.com/)',
        '[[[あ]]](https://example.com/)',
        '[[あ`い`う]]',
      ]) {
        const ed = mountW(md);
        expect(words(ed)).toEqual([]);
        expect(brackets(ed)).toEqual([]);
        expect(ed.getMarkdown()).toBe(md);
      }
    });

    it('本文に飾りが混ざらない（文書はただの文字のまま）', () => {
      const md = 'あ[[いう]]え';
      const ed = mountW(md);
      expect(ed.getMarkdown()).toBe(md);
      expect(ed.tiptap.getJSON()).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: md }] }] });
      expect(Object.keys(ed.tiptap.schema.nodes)).not.toContain('wikilink');
      expect(Object.keys(ed.tiptap.schema.marks)).not.toContain('wikilink');
    });

    it('setMarkdown でも飾り直す', () => {
      const ed = mountW('あ');
      ed.setMarkdown('[[い]]');
      expect(words(ed)).toEqual(['い']);
      ed.setMarkdown('い');
      expect(words(ed)).toEqual([]);
    });

    it('外した言葉の飾りは消える', () => {
      const ed = mountW('[[あ]]');
      select(ed, 4);
      press(ed);
      expect(words(ed)).toEqual([]);
      expect(brackets(ed)).toEqual([]);
    });

    it('見た目は変数の色で（style.css）', async () => {
      const { readFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const css = readFileSync(resolve(__dirname, '../style.css'), 'utf8');
      expect(css.match(/\.k-editor-wikilink \{([^}]*)\}/)?.[1]).toMatch(/var\(--k-editor-accent\)/);
      expect(css).toMatch(/\.k-editor-wikilink-bracket \{/);
    });
  });

  describe('往復（道具を出したエディタでも 1 文字も変わらない）', () => {
    for (const [name, md] of Object.entries(CASES)) {
      it(name, () => {
        const ed = mountW(md);
        expect(ed.getMarkdown()).toBe(md);
      });
    }

    it('囲んだ本文を読み直しても変わらない', () => {
      const ed = mountW('## あい\n**かき**く\n- さし');
      select(ed, 1, 3);
      press(ed);
      const got = ed.getMarkdown();
      expect(got).toBe('## [[あい]]\n**かき**く\n- さし');
      const again = mountW(got);
      expect(again.getMarkdown()).toBe(got);
      expect(words(again)).toEqual(['あい']);
    });
  });

  describe('opt-in', () => {
    it('既定の並びに入っていない', () => {
      expect(DEFAULT_TOOLBAR).not.toContain('wikilink');
    });

    for (const [name, options] of [
      ['既定の並び', {}],
      ['並びに無い', { toolbar: ['bold' as const] }],
      ['ツールバーなし', { toolbar: false as const }],
    ] as const) {
      it(`${name}ならボタンも飾りも無い。本文は素の文字のまま`, () => {
        const ed = mount({ markdown: 'あ[[い]]う', ...options });
        expect(btn(ed)).toBeNull();
        expect(words(ed)).toEqual([]);
        expect(brackets(ed)).toEqual([]);
        expect(ed.root.querySelector('.k-editor-prose')?.textContent).toBe('あ[[い]]う');
        expect(ed.getMarkdown()).toBe('あ[[い]]う');
      });
    }

    it('渡した並びのとおりに置く（H2 の左）・名前とアイコン', () => {
      const ed = mountW('あ', { uploadImage: async () => '/x.jpg' });
      const items = [...ed.root.querySelectorAll('.k-editor-btn')].map((b) => (b as HTMLElement).dataset.item);
      expect(items.slice(0, 4)).toEqual(['photo', 'embed', 'wikilink', 'h2']);
      expect(btn(ed).previousElementSibling?.classList.contains('k-editor-sep')).toBe(true);
      expect(btn(ed).querySelector('.k-editor-glyph-h')?.textContent).toBe('[[ ]]');
      expect(btn(ed).getAttribute('aria-label')).toBe('言葉のリンク');
    });

    it('名前とアイコンは差し替えられる', () => {
      const ed = mountW('あ', { labels: { wikilink: 'ことば' }, icons: { wikilink: '<i class="mine">語</i>' } });
      expect(btn(ed).title).toBe('ことば');
      expect(btn(ed).querySelector('i.mine')).not.toBeNull();
    });
  });

  describe('IME', () => {
    it('言葉の中でも、変換中の Enter で割らない・送信しない', () => {
      const onSubmit = vi.fn();
      const ed = mountW('[[あい]]', { onSubmit });
      select(ed, 4);
      keydown(ed.tiptap.view.dom, { key: 'Enter', isComposing: true });
      keydown(ed.tiptap.view.dom, { key: 'Enter', keyCode: 229 });
      expect(ed.getMarkdown()).toBe('[[あい]]');
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('変換中はボタンを押しても本文に触らない（断りも出さない）', () => {
      const ed = mountW('あいう');
      select(ed, 2, 3);
      const input = (ed.tiptap.view as unknown as { input: { composing: boolean } }).input;
      input.composing = true;
      press(ed);
      input.composing = false;
      expect(ed.getMarkdown()).toBe('あいう');
      expect(note(ed).hidden).toBe(true);
    });

    it('変換中の入力では飾りを作り直さず、変換が終わってから飾る', async () => {
      const ed = mountW('[[あ]]い');
      const { view } = ed.tiptap;
      // 変換中の入力（ProseMirror は composition の印を付けて流す）
      select(ed, 6);
      view.dispatch(view.state.tr.insertText('[[か]]').setMeta('composition', 1));
      expect(ed.getMarkdown()).toBe('[[あ]][[か]]い');
      expect(words(ed)).toEqual(['あ']);
      // 前を変えても、飾りは位置を追う
      view.dispatch(view.state.tr.insertText('さ', 1).setMeta('composition', 1));
      expect(words(ed)).toEqual(['あ']);
      view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
      await vi.waitFor(() => expect(words(ed)).toEqual(['あ', 'か']));
      expect(ed.getMarkdown()).toBe('さ[[あ]][[か]]い');
    });

    it('変換の終わりの飾り直しは onChange を呼ばず、壊したエディタにも触らない', async () => {
      const onChange = vi.fn();
      const ed = mountW('[[あ]]', { onChange });
      ed.tiptap.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
      await new Promise((r) => setTimeout(r, 80));
      expect(onChange).not.toHaveBeenCalled();
      const gone = mountW('[[あ]]');
      gone.tiptap.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
      gone.destroy();
      editors = editors.filter((e) => e !== gone);
      await new Promise((r) => setTimeout(r, 80));
    });
  });
});
