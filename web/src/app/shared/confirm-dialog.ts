import { Component, ElementRef, ViewChild, input, output } from '@angular/core';

/**
 * Centered overlay confirm for the board's destructive actions (delete card,
 * delete column). Esc / overlay click / the cancel button emit `cancelled`;
 * the danger button emits `confirmed`. Cancel takes focus on open so Enter
 * is the safe choice.
 */
@Component({
  selector: 'app-confirm-dialog',
  template: `
    <div class="overlay" (click)="cancelled.emit()">
      <section
        class="overlay__card confirm"
        (click)="$event.stopPropagation()"
        (keydown.escape)="cancelled.emit()"
      >
        <header class="ph-panel__header">{{ title() }}</header>
        <div class="confirm__body">
          <p class="confirm__msg">{{ message() }}</p>
          <div class="confirm__actions">
            <button
              #cancel
              class="btn btn-sm btn-outline-secondary"
              type="button"
              (click)="cancelled.emit()"
            >
              {{ cancelLabel() }}
            </button>
            <button class="btn btn-sm btn-danger" type="button" (click)="confirmed.emit()">
              {{ confirmLabel() }}
            </button>
          </div>
        </div>
      </section>
    </div>
  `,
  styles: `
    .confirm {
      width: min(24rem, 100%);
    }

    .confirm__body {
      display: flex;
      flex-direction: column;
      gap: var(--ph-space-4);
      padding: var(--ph-space-4);
    }

    .confirm__msg {
      margin: 0;
      font-family: var(--ph-font-mono);
      font-size: var(--ph-text-sm);
      color: var(--ph-text-muted);
      line-height: var(--ph-leading-tight);
    }

    .confirm__actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--ph-space-2);
    }
  `,
})
export class ConfirmDialog {
  /** Modal header, e.g. "delete card". */
  readonly title = input('confirm');
  readonly message = input.required<string>();
  readonly confirmLabel = input('delete');
  readonly cancelLabel = input('keep');

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  @ViewChild('cancel') private cancel?: ElementRef<HTMLButtonElement>;

  protected ngAfterViewInit(): void {
    setTimeout(() => this.cancel?.nativeElement.focus());
  }
}
