import {
  Directive,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  input,
  numberAttribute,
  signal,
} from '@angular/core';

/**
 * Truncation wherever it's attached: `appEllipsis` alone clips to one line;
 * `[appEllipsis]="4"` shows four lines first. While the element is actually
 * clipped, the full text is exposed as the native title tooltip; untruncated
 * labels stay tooltip-free. Watches both size (Resize) and text (Mutation) so
 * live-updating labels stay honest. Resize observation is skipped where
 * ResizeObserver is missing (jsdom tests).
 */
@Directive({
  selector: '[appEllipsis]',
  host: {
    class: 'ellipsis',
    '[class.ellipsis--multi]': 'appEllipsis() > 1',
    '[style.--ellipsis-lines]': 'clampVar()',
    '[attr.title]': 'titleText()',
  },
})
export class Ellipsis implements OnDestroy {
  /**
   * How many lines to show before the CSS clamp draws the "…". A bare
   * `appEllipsis` attribute arrives as '' and means one line.
   */
  readonly appEllipsis = input(1, {
    transform: (value: unknown) => {
      const n = value === '' ? 1 : numberAttribute(value, 1);
      return Number.isNaN(n) ? 1 : n;
    },
  });

  /** The line count as the CSS var consumed by `.ellipsis--multi`. */
  protected readonly clampVar = computed(() => String(this.appEllipsis()));

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly observer?: ResizeObserver;
  private readonly mutator = new MutationObserver(() => this.sync());

  /** Full text, set only while the element is clipped. */
  protected readonly titleText = signal<string | null>(null);

  constructor() {
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.sync());
      this.observer.observe(this.el.nativeElement);
    }
    this.mutator.observe(this.el.nativeElement, { childList: true, characterData: true, subtree: true });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.mutator.disconnect();
  }

  private sync(): void {
    const el = this.el.nativeElement;
    const clipped = el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight + 1;
    const text = (el.textContent ?? '').trim();
    this.titleText.set(clipped && text ? text : null);
  }
}
