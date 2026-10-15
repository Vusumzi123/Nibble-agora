import { Injectable, computed, inject, signal } from '@angular/core';

import { ApiService } from './api.service';
import type { AppConfig } from './models';
import { DEFAULT_THEME, applyTheme } from './theme';

const DEFAULT_CONFIG: AppConfig = { configured: false, forum_name: 'Agora', theme: DEFAULT_THEME };

/** Global instance configuration: setup state, forum name, and active theme. */
@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly api = inject(ApiService);

  readonly config = signal<AppConfig>(DEFAULT_CONFIG);
  readonly forumName = computed(() => this.config().forum_name);
  readonly theme = computed(() => this.config().theme);
  readonly configured = computed(() => this.config().configured);

  /** Load the public config and apply the theme. Safe to call before routing. */
  async load(): Promise<void> {
    try {
      this.apply(await this.api.getConfig());
    } catch {
      // Server unreachable at boot — keep defaults; the seat still renders.
    }
  }

  /** Apply a theme locally (live preview) without persisting. */
  preview(theme: string): void {
    applyTheme(theme);
  }

  /** Persist a config change (forum name and/or theme). */
  async save(patch: { forum_name?: string; theme?: string }): Promise<void> {
    this.apply(await this.api.updateSettings(patch));
  }

  /** Adopt a full config (e.g. the response from `/api/setup`). */
  apply(config: AppConfig): void {
    this.config.set(config);
    applyTheme(config.theme);
  }
}
