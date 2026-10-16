import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ApiService } from '../../core/api.service';
import { ConfigService } from '../../core/config.service';
import { ForumStore } from '../../core/forum.store';
import { StatusService } from '../../core/status.service';
import { THEMES } from '../../core/theme';

@Component({
  selector: 'app-settings',
  imports: [FormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class SettingsPage implements OnInit {
  protected readonly config = inject(ConfigService);
  private readonly store = inject(ForumStore);
  private readonly api = inject(ApiService);
  private readonly status = inject(StatusService);

  protected readonly themes = THEMES;
  protected forumName = '';
  protected current = '';
  protected next = '';
  protected confirm = '';
  protected savingName = false;
  protected savingPassword = false;

  ngOnInit(): void {
    // this view renders no store data — mark it so the poll stops refreshing
    // whatever list was left open behind us.
    this.store.setView('settings');
    this.forumName = this.config.forumName();
  }

  protected async pickTheme(theme: string): Promise<void> {
    this.config.preview(theme);
    try {
      await this.config.save({ theme });
      this.status.flash(`theme set to ${theme}`);
    } catch (err) {
      this.config.preview(this.config.theme());
      this.status.flash(err instanceof Error ? err.message : String(err), true);
    }
  }

  protected async saveName(): Promise<void> {
    this.savingName = true;
    try {
      await this.config.save({ forum_name: this.forumName.trim() });
      this.status.flash('forum name saved');
    } catch (err) {
      this.status.flash(err instanceof Error ? err.message : String(err), true);
    } finally {
      this.savingName = false;
    }
  }

  protected async savePassword(): Promise<void> {
    if (this.next.length < 8) {
      this.status.flash('new password must be at least 8 characters', true);
      return;
    }
    if (this.next !== this.confirm) {
      this.status.flash('passwords do not match', true);
      return;
    }
    this.savingPassword = true;
    try {
      await this.api.changePassword(this.current, this.next);
      this.current = this.next = this.confirm = '';
      this.status.flash('password changed');
    } catch (err) {
      this.status.flash(err instanceof Error ? err.message : String(err), true);
    } finally {
      this.savingPassword = false;
    }
  }
}
