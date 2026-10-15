import { Component, inject, model } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';

import { ConfigService } from '../../core/config.service';
import { ForumStore } from '../../core/forum.store';

@Component({
  selector: 'app-side-panel',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './side-panel.html',
  styleUrl: './side-panel.css',
  host: { '(document:keydown.escape)': 'close()' },
})
export class SidePanel {
  protected readonly store = inject(ForumStore);
  protected readonly config = inject(ConfigService);
  private readonly router = inject(Router);

  /** Full-screen drawer visibility — owned by the shell's top bar. */
  readonly open = model(false);

  protected close(): void {
    this.open.set(false);
  }

  protected async switchBoard(id: number): Promise<void> {
    this.open.set(false);
    await this.store.switchBoard(id);
    void this.router.navigateByUrl('/threads');
  }
}
