// 素の HTML から k-editor を使う例。`npm run demo` で examples/demo.js に束ねて開く。
import { createEditor } from '../src/index';

const sample = [
  '## きょうのこと',
  'たろうと**公園**へ行った。',
  'ブランコが~~こわい~~たのしいらしい。',
  '',
  '- すべりだい',
  '- すなば',
  '',
  '> また行こうね',
  '',
  '---',
  '',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://example.com/article',
  '',
  '[リンク](https://example.com/)も書ける',
].join('\n');

const out = document.getElementById('out')!;

// 写真は手元で object URL にするだけ（本物はサーバに上げて URL を返す）
async function uploadImage(file: File): Promise<string> {
  await new Promise((r) => setTimeout(r, 300));
  return URL.createObjectURL(file);
}

function renderEmbed(url: string): HTMLElement | null {
  const yt = /^https:\/\/(?:www\.)?youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/.exec(url);
  if (!yt) return null;
  // デモでは外へ繋がない。本物は iframe 等を返す
  const d = document.createElement('div');
  d.className = 'fake-embed';
  const b = document.createElement('b');
  b.textContent = 'YouTube の埋め込み';
  d.append(b, document.createTextNode(yt[1]!));
  return d;
}

const editor = createEditor(document.getElementById('editor')!, {
  markdown: sample,
  placeholder: 'いま、何が浮かびましたか',
  uploadImage,
  renderEmbed,
  fetchCard: async (url) => (url.startsWith('https://example.com/') ? { title: '例のページ', description: 'fetchCard が返したカード', domain: 'example.com' } : null),
  onChange: (md) => (out.textContent = md),
  onSubmit: () => alert('送信（Cmd/Ctrl+Enter）'),
});
out.textContent = editor.getMarkdown();
(window as unknown as { kEditor: typeof editor }).kEditor = editor;
