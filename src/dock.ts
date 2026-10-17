// 下に置くツールバー（toolbarPosition: 'bottom'）。
//
// ツールバーを画面の下端に固定する。iPhone でソフトキーボードが開いているときはキーボードのすぐ上へ。
// ⚠️ iOS Safari の position: fixed; bottom: 0 は layout viewport の下端に付くので、キーボードに隠れる。
//    visualViewport（見えている範囲）の下端との差を測って、そのぶん持ち上げる。
//
// 一つのページに下置きのエディタが複数あっても、出すのは一つだけ:
//   画面に入っているもののうち、いちばん最近「作られた・フォーカスを受けた」もの
//   （その場で開いた編集欄は、開いた時点で前からある欄より優先。前の欄に触れればそちらへ戻る）。
// 画面の外に出たら引っ込める。出している間は <html> に --k-editor-dock-height（ツールバーの高さ）を置く
// （使う側が、下に固定の知らせ等を持ち上げるのに使える）。

let seq = 0;
let focusSeq = 0;
const docks = new Set<BottomDock>();

function pick(): void {
  let best: BottomDock | null = null;
  for (const d of docks) {
    if (!d.visible) continue;
    if (!best || d.focusTick > best.focusTick || (d.focusTick === best.focusTick && d.order > best.order)) best = d;
  }
  for (const d of docks) d.setShown(d === best);
  const html = document.documentElement;
  if (best && best.height > 0) html.style.setProperty('--k-editor-dock-height', `${best.height}px`);
  else html.style.removeProperty('--k-editor-dock-height');
}

export interface CaretRect {
  top: number;
  bottom: number;
}

export class BottomDock {
  visible = true;
  /** 作られた・フォーカスを受けた順（大きいほど新しい） */
  focusTick = ++focusSeq;
  height = 0;
  readonly order = ++seq;
  private shown = false;
  private raf = 0;
  private followRaf = 0;
  private io: IntersectionObserver | null = null;
  private ro: ResizeObserver | null = null;
  private readonly vv: VisualViewport | null;

  constructor(
    private root: HTMLElement,
    private bar: HTMLElement,
    /** いまのカーソルの位置（画面の座標）。フォーカスが無ければ null */
    private caret: () => CaretRect | null
  ) {
    this.vv = typeof window !== 'undefined' && window.visualViewport ? window.visualViewport : null;
    root.classList.add('k-editor-dock');
    bar.classList.add('k-editor-dock-off');
    root.addEventListener('focusin', this.onFocusIn);
    this.vv?.addEventListener('resize', this.onViewportResize);
    this.vv?.addEventListener('scroll', this.onViewportScroll);
    window.addEventListener('resize', this.onViewportResize);
    if (typeof IntersectionObserver !== 'undefined') {
      this.io = new IntersectionObserver((entries) => {
        const last = entries[entries.length - 1];
        if (!last) return;
        this.visible = last.isIntersecting;
        pick();
      });
      this.io.observe(root);
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.measure());
      this.ro.observe(bar);
    }
    docks.add(this);
    pick();
  }

  /** pick() から呼ぶ。出す／引っ込める */
  setShown(shown: boolean): void {
    if (this.shown === shown) return;
    this.shown = shown;
    this.bar.classList.toggle('k-editor-dock-off', !shown);
    if (shown) {
      this.place();
      this.measure();
    }
  }

  get isShown(): boolean {
    return this.shown;
  }

  /** 文字を打つ・カーソルが動いたとき。カーソルがツールバーの裏に入ったら、ツールバーの上まで送る */
  follow(): void {
    if (!this.shown || this.followRaf) return;
    this.followRaf = requestAnimationFrame(() => {
      this.followRaf = 0;
      if (!this.shown) return;
      const c = this.caret();
      if (!c) return;
      const barTop = this.bar.getBoundingClientRect().top;
      const margin = 8;
      const over = c.bottom - (barTop - margin);
      if (over > 0) window.scrollBy(0, over);
    });
  }

  destroy(): void {
    docks.delete(this);
    this.root.removeEventListener('focusin', this.onFocusIn);
    this.vv?.removeEventListener('resize', this.onViewportResize);
    this.vv?.removeEventListener('scroll', this.onViewportScroll);
    window.removeEventListener('resize', this.onViewportResize);
    this.io?.disconnect();
    this.ro?.disconnect();
    this.io = null;
    this.ro = null;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.followRaf) cancelAnimationFrame(this.followRaf);
    this.raf = this.followRaf = 0;
    this.shown = false;
    this.bar.classList.add('k-editor-dock-off');
    this.bar.style.removeProperty('bottom');
    this.root.classList.remove('k-editor-dock');
    pick();
  }

  private onFocusIn = (): void => {
    this.focusTick = ++focusSeq;
    pick();
  };

  private onViewportScroll = (): void => this.schedule();

  private onViewportResize = (): void => {
    this.schedule();
    // キーボードが開いた直後。iOS はカーソルをキーボードの上までは送るが、ツールバーの分は見ない
    this.follow();
  };

  private schedule(): void {
    if (!this.shown || this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.place();
    });
  }

  /** layout viewport の下端と、見えている範囲（visualViewport）の下端の差だけ持ち上げる */
  private place(): void {
    const vv = this.vv;
    let lift = 0;
    if (vv) {
      lift = Math.round(window.innerHeight - vv.height - vv.offsetTop);
      if (lift < 2) lift = 0; // 端数・アドレスバーの揺れは無視
    }
    if (lift > 0) this.bar.style.bottom = `${lift}px`;
    else this.bar.style.removeProperty('bottom');
    // キーボードが開いている間は safe-area（ホームバー）の余白は要らない
    this.bar.classList.toggle('k-editor-dock-lifted', lift > 0);
    this.measure();
  }

  private measure(): void {
    const h = this.bar.offsetHeight;
    if (h <= 0 || h === this.height) return;
    this.height = h;
    this.root.style.setProperty('--k-editor-toolbar-h', `${h}px`);
    if (this.shown) document.documentElement.style.setProperty('--k-editor-dock-height', `${h}px`);
  }
}
