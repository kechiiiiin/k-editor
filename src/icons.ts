// ツールバーの記号。名前（labels）は aria-label と title にだけ出す。
// 線の図形は Lucide（https://lucide.dev・ISC License・Copyright (c) Lucide Contributors）から写した。
// 見出し・太字・取消線は、図形より文字の形のほうが伝わるので文字の記号にする。
import type { ToolbarItem } from './toolbar.js';

export type IconItem = Exclude<ToolbarItem, '|'>;

/** 使う側が差し替えるアイコン。文字列は HTML としてそのまま入れる（使う側が渡すものなので信頼する。ユーザー入力は渡さないこと）。要素はボタンごとに複製し、関数はボタンごとに呼ぶ */
export type IconSource = string | HTMLElement | (() => HTMLElement);
export type KEditorIcons = Partial<Record<IconItem, IconSource>>;

const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

const glyph = (text: string, cls: string): string => `<span class="k-editor-glyph ${cls}" aria-hidden="true">${text}</span>`;

export const DEFAULT_ICONS: Record<IconItem, string> = {
  photo: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
  embed: svg('<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m10 9 5 3-5 3z"/>'),
  h2: glyph('H2', 'k-editor-glyph-h'),
  h3: glyph('H3', 'k-editor-glyph-h'),
  bold: glyph('B', 'k-editor-glyph-bold'),
  strike: glyph('S', 'k-editor-glyph-strike'),
  link: svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
  bulletList: svg('<path d="M9 6h12"/><path d="M9 12h12"/><path d="M9 18h12"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/>'),
  orderedList: svg('<path d="M10 12h11"/><path d="M10 18h11"/><path d="M10 6h11"/><path d="M4 10h2"/><path d="M4 6h1v4"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>'),
  blockquote: svg('<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>'),
  hr: svg('<path d="M3 12h18"/><path d="m8 7 4-4 4 4"/><path d="m8 17 4 4 4-4"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>'),
  redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/>'),
};

/** ボタンにアイコンを入れる。要素は複製・関数は呼び直すので、同じ要素が二か所に入って片方から消えることはない */
export function applyIcon(button: HTMLElement, item: IconItem, icons?: KEditorIcons): void {
  const src = icons?.[item];
  if (src === undefined) {
    button.innerHTML = DEFAULT_ICONS[item];
  } else if (typeof src === 'string') {
    button.innerHTML = src; // 使う側が渡すもの。信頼する
  } else if (typeof src === 'function') {
    button.replaceChildren(src());
  } else {
    button.replaceChildren(src.cloneNode(true));
  }
}
