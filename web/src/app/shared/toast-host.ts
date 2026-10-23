import { Component, inject } from '@angular/core';

import { TranslateService } from '../core/i18n';
import { StatusService } from '../core/status.service';

@Component({
  selector: 'app-toast-host',
  template: `
    <div class="toast-stack" aria-live="polite" aria-atomic="false">
      @for (toast of status.toasts(); track toast.id) {
        <div
          class="toast show"
          [class.toast--success]="toast.kind === 'success'"
          [class.toast--danger]="toast.kind === 'error'"
          [attr.role]="toast.kind === 'error' ? 'alert' : 'status'"
        >
          <div class="toast-body">
            <span class="toast-stack__msg">{{ toast.message }}</span>
            <button
              class="toast-stack__dismiss"
              type="button"
              [attr.aria-label]="i18n.t('shell.dismiss')"
              (click)="status.dismiss(toast.id)"
            >
              ×
            </button>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      position: fixed;
      top: calc(var(--seat-topbar) + var(--ph-space-3));
      right: var(--ph-space-5);
      z-index: 1080;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: var(--ph-space-2);
      pointer-events: none;
    }

    .toast-stack {
      display: flex;
      flex-direction: column;
      gap: var(--ph-space-2);
      width: min(22rem, calc(100vw - 2 * var(--ph-space-5)));
    }

    .toast {
      pointer-events: auto;
      animation: toast-in 160ms ease-out;
    }

    .toast-body {
      display: flex;
      align-items: baseline;
      gap: var(--ph-space-3);
      font-family: var(--ph-font-mono);
      font-size: var(--ph-text-sm);
    }

    .toast-stack__msg {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .toast-stack__dismiss {
      flex: none;
      border: 0;
      padding: 0;
      background: none;
      color: var(--ph-text-muted);
      font-size: 1rem;
      line-height: 1;
      cursor: pointer;
    }

    .toast-stack__dismiss:hover {
      color: var(--ph-text);
    }

    @keyframes toast-in {
      from {
        opacity: 0;
        transform: translateY(-0.25rem);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .toast {
        animation: none;
      }
    }
  `,
})
export class ToastHost {
  protected readonly status = inject(StatusService);
  protected readonly i18n = inject(TranslateService);
}
