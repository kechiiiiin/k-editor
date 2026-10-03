# k-editor

Markdown を読んで Markdown を書き戻す、小さな WYSIWYG エディタ。[Tiptap](https://tiptap.dev/)（ProseMirror）の上に、素の DOM で載ります。Preact 用の薄い包みも付いています。

- 上に貼り付くツールバー: 写真／埋め込み（URL）／見出し・小見出し／太字／取り消し線／リンク／箇条書き／番号付き／引用／区切り線／戻す・やり直す（斜体はありません）
- 写真・埋め込み・リンクカードは本文の中にそのまま見え、× で外せます
- 写真はボタン・ドラッグ＆ドロップ・貼り付け（画像だけのとき）で入ります
- 他所からの貼り付けは**文字だけ**（HTML の書式は持ち込みません）
- リンクの URL は `prompt()` ではなく、ツールバーの下の小さな欄で入れます
- IME の変換中の Enter で段落を割らず、送信もしません（`isComposing`・`keyCode 229`）

## いちばん大事な約束: 往復で 1 文字も変えない

```ts
serializeMarkdown(parseMarkdown(md)) === md   // どんな md でも
```

読み込んで何も触らずに書き戻すと、元の Markdown と完全に一致します。規則で読めた塊を**その場で書き戻して元と比べ**、合わなければその塊は「書式を開かない素の文字」に倒すので、読めない形でも文字は失いません（見た目が素朴になるだけ）。

| Markdown | エディタの中 |
|---|---|
| 単独の改行 | 段落の中の改行（段落の境目も同じく単独の改行として書き戻す） |
| 空行 n 行 | 空の段落 n 個 |
| `![](url)` だけの行 | 写真のブロック |
| 行として独立した URL | 埋め込み・リンクカードの枠（判定は `isBlockUrl` で差し替え可） |
| `---` `***` など | 区切り線（書かれた記号を覚えておく） |
| `## 見出し` | 見出し（H1〜H6 を読める。ツールバーは H2・H3） |
| `- ` `* ` `+ ` / `1. ` `1) ` | 箇条書き / 番号付き（1 項目 1 段落・入れ子は素の文字に倒す） |
| `> ` | 引用 |
| コードフェンス | コードブロック（開き・閉じの行を覚えておく） |
| `**太字**` `~~取り消し~~` `[文字](url)` `` `コード` `` | 書式 |
| `*斜体*`・`\*` などのエスケープ | 文字のまま見せる |

リスト・引用の直後に（空行なしで）段落を書き足したときだけは、Markdown でリストの続きに読まれないよう空行を 1 行足して書き戻します（読み込んだ本文からはこの並びは生まれないので、往復には影響しません）。

## 入れ方

npm には公開していません。GitHub のタグから入れます（`prepare` でビルドされます）。

```sh
npm i github:kechiiiiin/k-editor#v0.1.0
```

## 使い方（素の DOM）

```ts
import { createEditor } from 'k-editor';
import 'k-editor/style.css';

const editor = createEditor(document.getElementById('editor')!, {
  markdown: '## きょう\nたろうと公園へ行った',
  placeholder: 'いま、何が浮かびましたか',
  onChange: (md) => save(md),
  onSubmit: () => send(),                 // Cmd/Ctrl+Enter（IME の変換中は呼ばない）
  uploadImage: async (file) => upload(file), // URL を返す。無ければ写真の道具は出ない
  renderEmbed: (url) => myEmbed(url),     // 埋め込みにするなら要素（か { dom, destroy }）、しないなら null
  fetchCard: async (url) => myCard(url),  // { title, description?, domain?, image? } か null
  isBlockUrl: (line) => /^https?:\/\/\S+$/.test(line),
  toolbar: ['photo', 'embed', '|', 'h2', 'h3', 'bold', 'strike', 'link', '|', 'bulletList', 'orderedList', 'blockquote', 'hr', '|', 'undo', 'redo'],
  labels: { photo: 'Photo' },             // 文言の差し替え
});

editor.getMarkdown();
editor.setMarkdown('…');  // onChange は呼ばない・履歴にも積まない
editor.destroy();
```

ライブラリは使う側のことを知りません。写真の置き場・埋め込みの判別と描き方・カードの中身は、関数で外から渡します。カードの文字は必ずテキストとして描きます（HTML にしません）。画像の URL の安全性は渡す側で確かめてください。

## Preact

`preact/compat` には依存しません（`preact` と `preact/hooks` だけ）。

```tsx
import { KEditor } from 'k-editor/preact';
import 'k-editor/style.css';

<KEditor value={body} onChange={setBody} uploadImage={upload} />
```

`value` は「外から変わったとき」（保存して空に戻した等）だけ本文を差し替えます。打っている間に親の再描画が遅れて古い `value` が届いても、本文は巻き戻りません。

## Markdown の変換だけ使う

```ts
import { parseMarkdown, serializeMarkdown } from 'k-editor/markdown';
```

DOM に依存しないので Node でも動きます。`onFallback(rule)` で、どの規則で素の文字に倒したかを数えられます（検査用）。

## 見た目

`style.css` の変数で差し替えます: `--k-editor-bg` `--k-editor-fg` `--k-editor-muted` `--k-editor-line` `--k-editor-accent` `--k-editor-sticky-top`（上に固定のヘッダがあるときその高さ）`--k-editor-font-size`。ツールバーは狭い画面では横にすべらせ、マウスの画面では折り返します。

## デモ

```sh
npm install
npm run demo   # http://localhost:5178/examples/
```

`examples/index.html` は素の HTML から使う例です（デモ用に esbuild で束ねます）。

## 開発

```sh
npm test         # vitest（Markdown の往復・エディタの操作・IME・貼り付け・写真）
npm run typecheck
npm run build    # dist/
npm run size     # 束ねたときの重さ（min / gzip）
```

テストの本文は仮名だけで書きます。

## 重さ（v0.1.0・esbuild で min）

本体一式で約 366 KB min / 113 KB gzip（大半は ProseMirror と Tiptap の芯）。Markdown の変換だけなら約 9 KB min / 3.4 KB gzip。
