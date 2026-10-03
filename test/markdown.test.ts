import { describe, expect, it } from 'vitest';
import { parseMarkdown, serializeMarkdown, type JSONNode } from '../src/markdown';
import { CASES } from './cases';

// 仮名だけで書く（このリポジトリは public）。
const NBSP = '\u00A0';

function roundTrip(md: string): { doc: JSONNode; out: string; fallbacks: string[] } {
  const fallbacks: string[] = [];
  const doc = parseMarkdown(md, { onFallback: (r) => fallbacks.push(r) });
  return { doc, out: serializeMarkdown(doc), fallbacks };
}

function types(doc: JSONNode): string[] {
  return (doc.content ?? []).map((n) => n.type);
}


describe('Markdown の往復（parse → serialize が 1 文字も変わらない）', () => {
  for (const [name, md] of Object.entries(CASES)) {
    it(name, () => {
      const { out, fallbacks } = roundTrip(md);
      expect(out).toBe(md);
      expect(fallbacks).not.toContain('document');
    });
  }
});

describe('読み取った形', () => {
  it('単独改行は段落の中の hardBreak', () => {
    const { doc } = roundTrip('あ\nい');
    expect(types(doc)).toEqual(['paragraph']);
    expect(doc.content![0]!.content!.map((n) => n.type)).toEqual(['text', 'hardBreak', 'text']);
  });

  it('空行 n 行は空の段落 n 個', () => {
    const { doc } = roundTrip('あ\n\n\nい');
    expect(types(doc)).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph']);
    expect(doc.content![1]!.content).toBeUndefined();
    expect(doc.content![2]!.content).toBeUndefined();
  });

  it('写真の行は image、URL の行は urlBlock、--- は horizontalRule', () => {
    const { doc } = roundTrip('あ\n![](/a/1.jpg)\nhttps://example.com/\n---');
    expect(types(doc)).toEqual(['paragraph', 'image', 'urlBlock', 'horizontalRule']);
    expect(doc.content![1]!.attrs).toMatchObject({ src: '/a/1.jpg', alt: '' });
    expect(doc.content![2]!.attrs).toEqual({ url: 'https://example.com/' });
  });

  it('URL の判定は外から渡せる', () => {
    const doc = parseMarkdown('https://example.com/', { isBlockUrl: () => false });
    expect(types(doc)).toEqual(['paragraph']);
  });

  it('見出し・リスト・引用・コード', () => {
    const { doc, fallbacks } = roundTrip('## み\n- a\n- b\n1. c\n> d\n```\ne\n```');
    expect(types(doc)).toEqual(['heading', 'bulletList', 'orderedList', 'blockquote', 'codeBlock']);
    expect(fallbacks).toEqual([]);
  });

  it('太字・取り消し線・リンクは mark になる', () => {
    const { doc } = roundTrip('**a** ~~b~~ [c](https://example.com/)');
    const marks = doc.content![0]!.content!.map((n) => (n.marks ?? []).map((m) => m.type).join('+'));
    expect(marks).toEqual(['bold', '', 'strike', '', 'link']);
  });

  it('書き戻せない書式は素の文字に倒す（文字は失わない）', () => {
    const { doc, fallbacks } = roundTrip('~~**あ**~~');
    expect(fallbacks).toContain('inline');
    expect(doc.content![0]!.content).toEqual([{ type: 'text', text: '~~**あ**~~' }]);
  });

  it('箇条書きの直後に写真があると、リストごと素の文字に倒す', () => {
    const { doc, fallbacks } = roundTrip('- いち\n![](/a/1.jpg)');
    expect(fallbacks).toContain('bulletList');
    expect(types(doc)).toEqual(['paragraph']);
  });

  it('斜体は開かない', () => {
    const { doc } = roundTrip('*a*');
    expect(doc.content![0]!.content).toEqual([{ type: 'text', text: '*a*' }]);
  });
});

describe('エディタで作った形の書き戻し', () => {
  it('リストの直後の段落には空行を足す（Markdown でリストの続きにならないように）', () => {
    const doc: JSONNode = {
      type: 'doc',
      content: [
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
      ],
    };
    expect(serializeMarkdown(doc)).toBe('- a\n\nb');
  });

  it('太字の端の空白は記号の外へ出す', () => {
    const doc: JSONNode = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: ' あ ', marks: [{ type: 'bold' }] }, { type: 'text', text: 'い' }] }],
    };
    expect(serializeMarkdown(doc)).toBe(' **あ** い');
  });

  it('段落の分かれ目も単独改行、空の段落は空行', () => {
    const doc: JSONNode = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'c' }] },
      ],
    };
    expect(serializeMarkdown(doc)).toBe('a\nb\n\nc');
  });

  it('入れ子のリスト・引用の中のリスト', () => {
    const doc: JSONNode = {
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            { type: 'orderedList', attrs: { start: 1 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }] }] },
          ],
        },
      ],
    };
    expect(serializeMarkdown(doc)).toBe('> 1. a\n>    b');
  });

  it('新しい区切り線・コードブロックの既定', () => {
    const doc: JSONNode = {
      type: 'doc',
      content: [{ type: 'horizontalRule' }, { type: 'codeBlock', content: [{ type: 'text', text: 'x' }] }],
    };
    expect(serializeMarkdown(doc)).toBe('---\n```\nx\n```');
  });
});

describe('乱暴な入力でも往復する', () => {
  // 記号を混ぜたでたらめな本文を大量に作って往復させる（決まった種で再現できるように）
  const ALPHABET = ['あ', 'a', ' ', '\n', '\n\n', '*', '**', '~~', '`', '[', ']', '(', ')', '!', '#', '- ', '1. ', '> ', '---', '```', 'https://example.com/x', '![](/a/1.jpg)', NBSP, '\\', '\t', '_'];
  let seed = 12345;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  it('2000 本', () => {
    let documentFallbacks = 0;
    for (let k = 0; k < 2000; k++) {
      let md = '';
      const len = Math.floor(rand() * 30);
      for (let j = 0; j < len; j++) md += ALPHABET[Math.floor(rand() * ALPHABET.length)];
      const fallbacks: string[] = [];
      const doc = parseMarkdown(md, { onFallback: (r) => fallbacks.push(r) });
      expect(serializeMarkdown(doc)).toBe(md);
      if (fallbacks.includes('document')) documentFallbacks++;
    }
    // 文書まるごと素に倒れるのは規則の穴。ゼロであってほしい
    expect(documentFallbacks).toBe(0);
  });
});
