import { Component, ElementRef, ViewChild, inject, input, output } from '@angular/core';

import { TranslateService } from '../core/i18n';
import { Modal } from './modal';

/**
 * Centered overlay confirm for the board's destructive actions (delete card,
 * delete column). Esc / overlay click / the cancel button emit `cancelled`;
 * the danger button emits `confirmed`. Cancel takes focus on open so Enter
 * is the safe choice.
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [Modal],
  template: `
    <app-modal
      [title]="title() ?? i18n.t('shell.confirm')"
      [showClose]="false"
      panelClass="confirm"
      (closed)="cancelled.emit()"
    >
      <div class="confirm__body">
        <p class="confirm__msg">{{ message() }}</p>
        <div class="confirm__actions">
          <button
            #cancel
            class="btn btn-sm btn-outline-secondary"
            type="button"
            (click)="cancelled.emit()"
          >
            {{ cancelLabel() ?? i18n.t('shell.keep') }}
          </button>
          <button class="btn btn-sm btn-danger" type="button" (click)="confirmed.emit()">
            {{ confirmLabel() ?? i18n.t('shell.delete') }}
          </button>
        </div>
      </div>
    </app-modal>
  `,
  styles: `
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
  protected readonly i18n = inject(TranslateService);

  /** Modal header, e.g. "delete card"; falls back to the translated default. */
  readonly title = input<string>();
  readonly message = input.required<string>();
  readonly confirmLabel = input<string>();
  readonly cancelLabel = input<string>();

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  @ViewChild('cancel') private cancel?: ElementRef<HTMLButtonElement>;

  protected ngAfterViewInit(): void {
    setTimeout(() => this.cancel?.nativeElement.focus());
  }
}
