// Preact 用の薄い包み。preact/compat には依存しない（preact と preact/hooks だけ）。
//
//   <KEditor value={body} onChange={setBody} uploadImage={…} />
//
// value が外から変わったとき（保存して欄を空にした等）だけ本文を差し替える。
// 打っている最中は onChange で返した値がそのまま戻ってくるので、差し替えは起きない。
import { h, type JSX, type Ref } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { createEditor, type KEditor as KEditorInstance, type KEditorOptions } from './editor.js';

export interface KEditorProps extends Omit<KEditorOptions, 'markdown' | 'onChange'> {
  value: string;
  onChange: (markdown: string) => void;
  /** エディタの操作口（focus 等）を受け取る */
  editorRef?: Ref<KEditorInstance | null>;
  class?: string;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T): void {
  if (!ref) return;
  if (typeof ref === 'function') ref(value);
  else ref.current = value;
}

export function KEditor(props: KEditorProps): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const inst = useRef<KEditorInstance | null>(null);
  // 最新の props をコールバックから読む（エディタは一度だけ作る）
  const latest = useRef(props);
  latest.current = props;
  // onChange で返したが、まだ value として戻ってきていない値の列。
  // 親の再描画は打鍵より遅れて（まとめて）来るので、古い value で打っている本文を巻き戻さないよう、
  // 列にある値が戻ってきたら「自分の打鍵の反映」とみなして差し替えない。列に無い値だけが外からの変更
  const pending = useRef<string[]>([]);

  useEffect(() => {
    if (!host.current) return;
    const p = latest.current;
    const editor = createEditor(host.current, {
      ...p,
      markdown: p.value,
      onChange: (md) => {
        pending.current.push(md);
        if (pending.current.length > 200) pending.current.shift();
        latest.current.onChange(md);
      },
      onSubmit: p.onSubmit ? () => latest.current.onSubmit?.() : undefined,
      uploadImage: p.uploadImage ? (f) => latest.current.uploadImage!(f) : undefined,
      renderEmbed: p.renderEmbed ? (u) => latest.current.renderEmbed?.(u) ?? null : undefined,
      fetchCard: p.fetchCard ? (u) => latest.current.fetchCard?.(u) ?? null : undefined,
      onError: p.onError ? (m) => latest.current.onError?.(m) : undefined,
    });
    inst.current = editor;
    assignRef(p.editorRef, editor);
    return () => {
      assignRef(latest.current.editorRef, null);
      editor.destroy();
      inst.current = null;
    };
  }, []);

  useEffect(() => {
    const e = inst.current;
    if (!e) return;
    const k = pending.current.lastIndexOf(props.value);
    if (k >= 0) {
      pending.current.splice(0, k + 1);
      return;
    }
    pending.current = [];
    if (e.getMarkdown() !== props.value) e.setMarkdown(props.value);
  }, [props.value]);

  return h('div', { ref: host, class: props.class });
}

export type { KEditorInstance };
