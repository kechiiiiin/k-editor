// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { useState } from 'preact/hooks';
import { KEditor, type KEditorInstance } from '../src/preact';

// 仮名だけで書く（このリポジトリは public）。

describe('Preact の包み', () => {
  it('親の再描画が打鍵に遅れても、打った本文を巻き戻さない', async () => {
    const ref: { current: KEditorInstance | null } = { current: null };
    let setOuter: (v: string) => void = () => {};
    let seen = '';
    function Host() {
      const [v, setV] = useState('');
      setOuter = setV;
      seen = v;
      return h(KEditor, { value: v, onChange: setV, editorRef: ref });
    }
    const root = document.createElement('div');
    document.body.appendChild(root);
    render(h(Host, null), root);
    await vi.waitFor(() => expect(ref.current).not.toBeNull());
    const ed = ref.current!;
    // 再描画を待たずに続けて打つ
    ed.tiptap.commands.insertContent('あ');
    ed.tiptap.commands.insertContent('い');
    ed.tiptap.commands.splitBlock();
    ed.tiptap.commands.insertContent('う');
    await vi.waitFor(() => expect(seen).toBe('あい\nう'));
    await new Promise((r) => setTimeout(r, 50));
    expect(ed.getMarkdown()).toBe('あい\nう');

    // 外から変えた値（保存して空に戻す等）は差し替える
    setOuter('');
    await vi.waitFor(() => expect(ed.getMarkdown()).toBe(''));
    render(null, root);
  });
});
