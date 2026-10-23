import { NgClass } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

import { TranslateService } from '../core/i18n';
import { ModalStack, firstFocusable } from './modal-stack';

let nextId = 0;

/**
 * The one modal shell: scrim, panel, header, Escape/Tab behaviour and focus
 * restoration. Callers keep their own `@if (open)` so projected content lives
 * exactly as long as the dialog, then put the view inside.
 *
 * The scrim only closes when the press **and** the release both happen on the
 * scrim itself, so a drag or text selection that starts in the panel and ends
 * on the overlay does not dismiss the dialog.
 */
@Component({
  selector: 'app-modal',
  imports: [NgClass],
  template: `
    <div
      #scrim
      class="overlay"
      (pointerdown)="onPointerDown($event)"
      (pointerup)="onPointerUp($event)"
      (pointercancel)="onPointerCancel()"
      (click)="onScrimClick($event)"
    >
      <section
        #card
        class="overlay__card"
        [ngClass]="panelClasses()"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        [attr.aria-labelledby]="labelledBy() || (title() ? headingId() : null)"
        [attr.aria-label]="ariaLabel() || null"
        (click)="$event.stopPropagation()"
      >
        <ng-content select="[modal-header]">
          <header class="ph-panel__header">
            <span class="modal__title" [id]="headingId()">{{ title() }}</span>
            @if (showClose()) {
              <button
                class="btn btn-sm btn-outline-secondary btn-icon"
                type="button"
                [title]="i18n.t('shell.close')"
                [attr.aria-label]="i18n.t('shell.close')"
                (click)="close()"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            }
          </header>
        </ng-content>
        <ng-content />
      </section>
    </div>
  `,
  styles: `
    :host {
      display: contents;
    }

    .ph-panel__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ph-space-2);
    }

    .modal__title {
      min-width: 0;
      overflow-wrap: anywhere;
    }
  `,
})
export class Modal implements AfterViewInit, OnDestroy {
  protected readonly i18n = inject(TranslateService);
  private readonly stack = inject(ModalStack);
  private readonly cardRef = viewChild.required<ElementRef<HTMLElement>>('card');
  private readonly scrimRef = viewChild.required<ElementRef<HTMLElement>>('scrim');

  /** Default header label; omit when projecting a `[modal-header]`. */
  readonly title = input<string>('');
  /** Show the default header `×` (ignored when a custom header is projected). */
  readonly showClose = input(true);
  readonly variant = input<'card' | 'menu'>('card');
  /** Feature class(es) for the panel (width, padding, panel look). */
  readonly panelClass = input<string | string[]>([]);
  /** Extra class applied while the caller's state flag is on. */
  readonly activeClass = input<string>('');
  /** Id of a projected heading, used as `aria-labelledby`. */
  readonly labelledBy = input<string>('');
  /** Accessible name for custom headers that carry no single heading. */
  readonly ariaLabel = input<string>('');
  /** Stable id for the default header title (generated when omitted). */
  readonly headingIdInput = input<string>('', { alias: 'headingId' });

  readonly closed = output<void>();

  private readonly instanceId = ++nextId;
  protected readonly headingId = computed(
    () => this.headingIdInput() || `agora-modal-${this.instanceId}-title`,
  );
  protected readonly panelClasses = computed(() =>
    [this.panelClass(), this.activeClass(), this.variant() === 'menu' ? 'overlay__card--menu' : '']
      .flat()
      .filter((name): name is string => typeof name === 'string' && name.trim() !== '')
      .join(' '),
  );

  private unregister?: () => void;
  private previousFocus: HTMLElement | null = null;

  private sawPointer = false;
  private downOnScrim = false;
  private upOnScrim = false;

  ngAfterViewInit(): void {
    this.previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.unregister = this.stack.register({
      panel: this.cardRef().nativeElement,
      close: () => this.close(),
    });
    queueMicrotask(() => this.focusInitial());
  }

  ngOnDestroy(): void {
    this.unregister?.();
    this.unregister = undefined;
    const previous = this.previousFocus;
    this.previousFocus = null;
    if (previous?.isConnected) queueMicrotask(() => previous.focus());
  }

  protected close(): void {
    this.closed.emit();
  }

  private focusInitial(): void {
    const card = this.cardRef().nativeElement;
    if (card.contains(document.activeElement)) return;
    (firstFocusable(card) ?? card).focus();
  }

  protected onPointerDown(event: PointerEvent): void {
    this.sawPointer = true;
    this.downOnScrim = event.target === this.scrimRef().nativeElement;
    this.upOnScrim = false;
  }

  protected onPointerUp(event: PointerEvent): void {
    this.upOnScrim = event.target === this.scrimRef().nativeElement;
  }

  protected onPointerCancel(): void {
    this.sawPointer = false;
    this.downOnScrim = false;
    this.upOnScrim = false;
  }

  protected onScrimClick(event: MouseEvent): void {
    const onScrim = event.target === this.scrimRef().nativeElement;
    // No pointer sequence (synthetic click) keeps the old click-to-close
    // behaviour used by the specs; a real gesture must start and end here.
    const allowed = !this.sawPointer || (this.downOnScrim && this.upOnScrim);
    this.sawPointer = false;
    this.downOnScrim = false;
    this.upOnScrim = false;
    if (onScrim && allowed) this.close();
  }
}
