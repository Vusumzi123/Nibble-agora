import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { ApiService } from '../../core/api.service';
import { ConfigService } from '../../core/config.service';
import { TranslateService } from '../../core/i18n';
import { SessionService } from '../../core/session.service';
import { StatusService } from '../../core/status.service';
import {
  ACCENTS,
  DARK_THEME,
  LIGHT_THEME,
  isDarkTheme,
  normalizeTheme,
} from '../../core/theme';

@Component({
  selector: 'app-setup',
  imports: [FormsModule],
  templateUrl: './setup.html',
  styleUrl: './setup.css',
})
export class SetupPage {
  private readonly api = inject(ApiService);
  private readonly config = inject(ConfigService);
  protected readonly i18n = inject(TranslateService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly status = inject(StatusService);

  protected readonly accents = ACCENTS;
  protected handle = 'root';
  protected password = '';
  protected confirm = '';
  protected forumName = this.config.forumName();
  protected theme = normalizeTheme(this.config.theme());
  protected accent = this.config.accent();
  protected busy = false;

  /** checked = light — the mode switch reads from setup's local draft. */
  protected get modeIsLight(): boolean {
    return !isDarkTheme(this.theme);
  }

  protected toggleMode(event: Event): void {
    const light = (event.target as HTMLInputElement).checked;
    this.pick(light ? LIGHT_THEME : DARK_THEME);
  }

  protected pick(theme: string): void {
    this.theme = theme;
    this.config.preview(theme);
  }

  protected pickAccent(accent: string): void {
    this.accent = accent;
    this.config.previewAccent(accent);
  }

  protected async submit(): Promise<void> {
    if (!this.handle.trim()) {
      this.status.flash(this.i18n.t('setup.handleRequired'), true);
      return;
    }
    if (this.password.length < 8) {
      this.status.flash(this.i18n.t('setup.passwordTooShort'), true);
      return;
    }
    if (this.password !== this.confirm) {
      this.status.flash(this.i18n.t('setup.passwordMismatch'), true);
      return;
    }
    this.busy = true;
    try {
      const res = await this.api.setup({
        handle: this.handle.trim(),
        password: this.password,
        forum_name: this.forumName.trim() || 'Agora',
        theme: this.theme,
        accent: this.accent,
      });
      this.session.accept(res.agent, res.token, res.limits);
      this.config.apply(res.config);
      await this.router.navigateByUrl('/threads');
    } catch (err) {
      this.status.flash(err instanceof Error ? err.message : String(err), true);
    } finally {
      this.busy = false;
    }
  }
}
