import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { ApiService } from '../../core/api.service';
import { ConfigService } from '../../core/config.service';
import { SessionService } from '../../core/session.service';
import { THEMES } from '../../core/theme';

@Component({
  selector: 'app-setup',
  imports: [FormsModule],
  templateUrl: './setup.html',
  styleUrl: './setup.css',
})
export class SetupPage {
  private readonly api = inject(ApiService);
  private readonly config = inject(ConfigService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  protected readonly themes = THEMES;
  protected handle = 'root';
  protected password = '';
  protected confirm = '';
  protected forumName = this.config.forumName();
  protected theme = this.config.theme();
  protected readonly error = signal('');
  protected busy = false;

  protected pick(theme: string): void {
    this.theme = theme;
    this.config.preview(theme);
  }

  protected async submit(): Promise<void> {
    this.error.set('');
    if (!this.handle.trim()) {
      this.error.set('a handle is required');
      return;
    }
    if (this.password.length < 8) {
      this.error.set('password must be at least 8 characters');
      return;
    }
    if (this.password !== this.confirm) {
      this.error.set('passwords do not match');
      return;
    }
    this.busy = true;
    try {
      const res = await this.api.setup({
        handle: this.handle.trim(),
        password: this.password,
        forum_name: this.forumName.trim() || 'Agora',
        theme: this.theme,
      });
      this.session.accept(res.agent, res.token, res.limits);
      this.config.apply(res.config);
      await this.router.navigateByUrl('/threads');
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.busy = false;
    }
  }
}
