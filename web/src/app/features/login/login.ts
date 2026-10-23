import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { ConfigService } from '../../core/config.service';
import { TranslateService } from '../../core/i18n';
import { SessionService } from '../../core/session.service';
import { StatusService } from '../../core/status.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class LoginPage {
  protected readonly config = inject(ConfigService);
  protected readonly i18n = inject(TranslateService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly status = inject(StatusService);

  protected handle = '';
  protected password = '';
  protected busy = false;

  protected async submit(): Promise<void> {
    this.busy = true;
    try {
      await this.session.login(this.handle, this.password);
      this.password = '';
      await this.router.navigateByUrl('/threads');
    } catch (err) {
      this.status.flash(err instanceof Error ? err.message : String(err), true);
    } finally {
      this.busy = false;
    }
  }
}
