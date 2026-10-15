import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { ConfigService } from '../../core/config.service';
import { SessionService } from '../../core/session.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class LoginPage {
  protected readonly config = inject(ConfigService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  protected handle = '';
  protected password = '';
  protected readonly error = signal('');
  protected busy = false;

  protected async submit(): Promise<void> {
    this.error.set('');
    this.busy = true;
    try {
      await this.session.login(this.handle, this.password);
      this.password = '';
      await this.router.navigateByUrl('/threads');
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.busy = false;
    }
  }
}
