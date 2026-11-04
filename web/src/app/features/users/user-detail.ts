import { Component, Input, inject, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ApiError, ApiService } from '../../core/api.service';
import { TranslateService } from '../../core/i18n';
import type { Agent } from '../../core/models';
import { StatusService } from '../../core/status.service';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { Modal } from '../../shared/modal';

/** A colour is optional; when present it must be a 3- or 6-digit hex value. */
const HEX_COLOUR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

type Mode = 'edit' | 'reset' | 'revealed';

/**
 * Manage one seat in a single dialog: edit identity, reset the password
 * (one-time reveal), and soft-disable / restore. Every mutation reports back
 * through `changed` so the directory can refresh in place, and failures are
 * surfaced as toasts without closing the dialog.
 */
@Component({
  selector: 'app-user-detail',
  imports: [FormsModule, Modal, ConfirmDialog],
  template: `
    <app-modal
      [title]="i18n.t('users.detailTitle', { handle: current.handle })"
      headingId="user-detail-title"
      panelClass="user-detail__modal"
      (closed)="close()"
    >
      <div class="user-detail">
        @if (disabled) {
          <p class="field__hint field__hint--danger user-detail__disabled">
            {{ i18n.t('users.disabledHint') }}
          </p>
        }

        <form class="user-detail__form" (ngSubmit)="save()">
          <label class="field">
            <span class="field__label">{{ i18n.t('users.handle') }}</span>
            <input
              class="form-control"
              name="detailHandle"
              type="text"
              autocomplete="off"
              spellcheck="false"
              maxlength="64"
              [attr.aria-invalid]="handleError ? 'true' : null"
              [(ngModel)]="handle"
              [disabled]="busy || disabled"
            />
            @if (handleError) {
              <span class="field__hint field__hint--danger user-detail__handle-error">
                {{ handleError }}
              </span>
            }
          </label>

          <label class="field">
            <span class="field__label">{{ i18n.t('users.displayName') }}</span>
            <input
              class="form-control"
              name="detailDisplayName"
              type="text"
              autocomplete="off"
              maxlength="64"
              [attr.aria-invalid]="displayNameError ? 'true' : null"
              [(ngModel)]="displayName"
              [disabled]="busy || disabled"
            />
            @if (displayNameError) {
              <span class="field__hint field__hint--danger user-detail__name-error">
                {{ displayNameError }}
              </span>
            }
          </label>

          <label class="field">
            <span class="field__label">{{ i18n.t('users.color') }}</span>
            <input
              class="form-control"
              name="detailColor"
              type="text"
              autocomplete="off"
              spellcheck="false"
              maxlength="32"
              placeholder="#336699"
              [attr.aria-invalid]="colorError ? 'true' : null"
              [(ngModel)]="color"
              [disabled]="busy || disabled"
            />
            @if (colorError) {
              <span class="field__hint field__hint--danger user-detail__color-error">
                {{ colorError }}
              </span>
            }
          </label>

          @if (formError) {
            <p class="field__hint field__hint--danger user-detail__form-error">{{ formError }}</p>
          }

          <div class="user-detail__actions">
            <button class="btn btn-outline-secondary" type="button" (click)="close()">
              {{ i18n.t('shell.cancel') }}
            </button>
            <button class="btn btn-primary user-detail__save" type="submit" [disabled]="busy || disabled">
              {{ i18n.t(busy ? 'shell.saving' : 'shell.save') }}
            </button>
          </div>
        </form>

        @if (mode === 'reset') {
          <form class="user-detail__reset-form" (ngSubmit)="resetPassword()">
            <label class="field">
              <span class="field__label">{{ i18n.t('users.resetFormTitle') }}</span>
              <input
                class="form-control"
                name="newPassword"
                type="password"
                autocomplete="new-password"
                [(ngModel)]="newPassword"
              />
              <span class="field__hint">{{ i18n.t('users.passwordHint') }}</span>
              @if (resetError) {
                <span class="field__hint field__hint--danger user-detail__reset-error">
                  {{ resetError }}
                </span>
              }
            </label>
            <div class="user-detail__actions">
              <button class="btn btn-outline-secondary" type="button" (click)="cancelReset()">
                {{ i18n.t('shell.cancel') }}
              </button>
              <button class="btn btn-primary user-detail__reset-save" type="submit" [disabled]="busy">
                {{ i18n.t(busy ? 'users.resetting' : 'users.reset') }}
              </button>
            </div>
          </form>
        } @else if (mode === 'revealed') {
          <div class="user-detail__revealed">
            <p class="field__hint field__hint--danger">{{ i18n.t('users.revealWarning') }}</p>
            <div class="field">
              <span class="field__label">{{ i18n.t('users.revealTitle') }}</span>
              <div class="user-detail__secret-row">
                <code class="user-detail__secret">{{ revealedPassword }}</code>
                <button
                  class="btn btn-sm btn-outline-secondary"
                  type="button"
                  (click)="copyRevealed()"
                >
                  {{ i18n.t(copied ? 'users.copied' : 'users.copy') }}
                </button>
              </div>
            </div>
            <div class="user-detail__actions">
              <button class="btn btn-primary user-detail__reset-done" type="button" (click)="finishReveal()">
                {{ i18n.t('users.revealDone') }}
              </button>
            </div>
          </div>
        } @else {
          <div class="user-detail__danger">
            <button
              class="btn btn-outline-secondary user-detail__reset"
              type="button"
              (click)="openReset()"
              [disabled]="busy"
            >
              {{ i18n.t('users.resetPassword') }}
            </button>
            @if (disabled) {
              <button
                class="btn btn-outline-secondary user-detail__restore"
                type="button"
                (click)="restore()"
                [disabled]="busy"
              >
                {{ i18n.t('users.restore') }}
              </button>
            } @else {
              <button
                class="btn btn-danger user-detail__disable"
                type="button"
                (click)="askDisable()"
                [disabled]="busy"
              >
                {{ i18n.t('users.disable') }}
              </button>
            }
          </div>
        }
      </div>
    </app-modal>

    @if (confirmDisable) {
      <app-confirm-dialog
        [title]="i18n.t('users.disable')"
        [message]="i18n.t('users.disableConfirm', { handle: current.handle })"
        [confirmLabel]="i18n.t('users.disable')"
        (confirmed)="disableSeat()"
        (cancelled)="cancelDisable()"
      />
    }
  `,
  styles: `
    .user-detail__form,
    .user-detail__reset-form,
    .user-detail__revealed {
      display: flex;
      flex-direction: column;
      gap: var(--ph-space-3);
    }

    .user-detail__disabled {
      margin: 0 0 var(--ph-space-3);
    }

    .user-detail__actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--ph-space-2);
      margin-top: var(--ph-space-2);
    }

    .user-detail__danger {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: var(--ph-space-2);
      margin-top: var(--ph-space-4);
      padding-top: var(--ph-space-4);
      border-top: 1px solid var(--ph-border);
    }

    .user-detail__secret-row {
      display: flex;
      align-items: center;
      gap: var(--ph-space-2);
    }

    .user-detail__secret {
      flex: 1;
      min-width: 0;
      padding: var(--ph-space-2);
      border: 1px solid var(--ph-border);
      border-radius: var(--ph-radius-md);
      background: var(--ph-surface);
      color: var(--ph-text);
      overflow-wrap: anywhere;
    }
  `,
})
export class UserDetail {
  protected readonly i18n = inject(TranslateService);
  private readonly api = inject(ApiService);
  private readonly status = inject(StatusService);

  readonly closed = output<void>();
  readonly changed = output<Agent>();

  protected current!: Agent;
  protected handle = '';
  protected displayName = '';
  protected color = '';
  protected handleError = '';
  protected displayNameError = '';
  protected colorError = '';
  protected formError = '';
  protected busy = false;
  protected mode: Mode = 'edit';
  protected newPassword = '';
  protected resetError = '';
  protected revealedPassword = '';
  protected confirmDisable = false;
  protected copied = false;

  /** A deterministic setter (not an effect) so the form is filled before the
   *  first render even though the dialog is recreated on each row click. */
  @Input({ required: true }) set agent(value: Agent) {
    this.sync(value);
  }

  protected get disabled(): boolean {
    return this.current?.disabled_at != null;
  }

  private sync(agent: Agent): void {
    this.current = agent;
    this.handle = agent.handle;
    this.displayName = agent.display_name;
    this.color = agent.color ?? '';
    this.handleError = '';
    this.displayNameError = '';
    this.colorError = '';
    this.formError = '';
    this.busy = false;
    this.mode = 'edit';
    this.newPassword = '';
    this.resetError = '';
    this.revealedPassword = '';
    this.confirmDisable = false;
    this.copied = false;
  }

  private apply(agent: Agent): void {
    this.sync(agent);
    this.changed.emit(agent);
  }

  protected close(): void {
    this.closed.emit();
  }

  protected async save(): Promise<void> {
    if (this.busy) return;
    this.handleError = '';
    this.displayNameError = '';
    this.colorError = '';
    this.formError = '';

    const handle = this.handle.trim();
    const displayName = this.displayName.trim();
    const color = this.color.trim();
    if (handle === '') {
      this.handleError = this.i18n.t('users.handleRequired');
      return;
    }
    if (displayName === '') {
      this.displayNameError = this.i18n.t('users.displayNameRequired');
      return;
    }
    if (color !== '' && !HEX_COLOUR.test(color)) {
      this.colorError = this.i18n.t('users.colorInvalid');
      return;
    }

    this.busy = true;
    try {
      const updated = await this.api.updateAgent(this.current.id, {
        handle,
        display_name: displayName,
        color: color === '' ? null : color,
      });
      this.apply(updated);
      this.status.flash(this.i18n.t('users.saved', { handle: updated.handle }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        this.handleError = this.i18n.t('users.handleTaken');
      } else if (err instanceof ApiError && err.status === 400) {
        this.formError = err.message;
      } else {
        this.status.flash(
          err instanceof Error ? err.message : this.i18n.t('users.saveFailed'),
          true,
        );
      }
    } finally {
      this.busy = false;
    }
  }

  protected openReset(): void {
    this.mode = 'reset';
    this.newPassword = '';
    this.resetError = '';
    this.formError = '';
  }

  protected cancelReset(): void {
    this.mode = 'edit';
    this.newPassword = '';
    this.resetError = '';
  }

  protected async resetPassword(): Promise<void> {
    if (this.busy) return;
    if (this.newPassword.length < 8) {
      this.resetError = this.i18n.t('users.passwordTooShort');
      return;
    }
    this.resetError = '';
    this.busy = true;
    try {
      const updated = await this.api.resetAgentPassword(this.current.id, this.newPassword);
      this.current = updated;
      this.revealedPassword = this.newPassword;
      this.newPassword = '';
      this.copied = false;
      this.mode = 'revealed';
      this.changed.emit(updated);
    } catch (err) {
      this.resetError =
        err instanceof Error ? err.message : this.i18n.t('users.resetFailed');
    } finally {
      this.busy = false;
    }
  }

  protected finishReveal(): void {
    this.mode = 'edit';
    this.revealedPassword = '';
    this.copied = false;
  }

  protected async copyRevealed(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.revealedPassword);
      this.copied = true;
    } catch {
      this.status.flash(this.i18n.t('users.copyFailed'), true);
    }
  }

  protected askDisable(): void {
    this.confirmDisable = true;
  }

  protected cancelDisable(): void {
    this.confirmDisable = false;
  }

  protected async disableSeat(): Promise<void> {
    this.confirmDisable = false;
    if (this.busy) return;
    this.busy = true;
    try {
      const updated = await this.api.disableAgent(this.current.id);
      this.apply(updated);
      this.status.flash(this.i18n.t('users.disabledSeat', { handle: updated.handle }));
    } catch (err) {
      this.status.flash(
        err instanceof Error ? err.message : this.i18n.t('users.disableFailed'),
        true,
      );
    } finally {
      this.busy = false;
    }
  }

  protected async restore(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const updated = await this.api.restoreAgent(this.current.id);
      this.apply(updated);
      this.formError = this.i18n.t('users.restoreHint');
    } catch (err) {
      this.status.flash(
        err instanceof Error ? err.message : this.i18n.t('users.restoreFailed'),
        true,
      );
    } finally {
      this.busy = false;
    }
  }
}
