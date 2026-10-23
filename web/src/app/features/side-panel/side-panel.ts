import { Component, inject, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';

import { ConfigService } from '../../core/config.service';
import { ForumStore } from '../../core/forum.store';
import { TranslateService } from '../../core/i18n';

@Component({
  selector: 'app-side-panel',
  imports: [FormsModule, RouterLink, RouterLinkActive],
  templateUrl: './side-panel.html',
  styleUrl: './side-panel.css',
  host: { '(document:keydown.escape)': 'close()' },
})
export class SidePanel {
  protected readonly store = inject(ForumStore);
  protected readonly config = inject(ConfigService);
  protected readonly i18n = inject(TranslateService);
  private readonly router = inject(Router);

  /** Full-screen drawer visibility — owned by the shell's top bar. */
  readonly open = model(false);

  protected createOpen = false;
  protected name = '';

  protected close(): void {
    this.open.set(false);
  }

  /** Switch the active forum; boards, projects and threads all follow. */
  protected async selectForum(id: number): Promise<void> {
    this.close();
    await this.store.switchForum(id);
    void this.router.navigateByUrl('/forum');
  }

  protected toggleCreate(): void {
    this.createOpen = !this.createOpen;
  }

  protected async create(): Promise<void> {
    const name = this.name.trim();
    if (!name) return;
    const forum = await this.store.createForum(name, null);
    if (forum) {
      this.name = '';
      this.createOpen = false;
      this.close();
    }
  }
}
