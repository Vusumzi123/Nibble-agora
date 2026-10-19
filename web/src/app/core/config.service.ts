import { Injectable, computed, inject, signal } from '@angular/core';

import { ApiService } from './api.service';
import type { AppConfig } from './models';
import { DEFAULT_ACCENT, DEFAULT_THEME, applyAccent, applyTheme, normalizeTheme } from './theme';

const DEFAULT_CONFIG: AppConfig = {
  configured: false,
  forum_name: 'Agora',
  theme: DEFAULT_THEME,
  accent: DEFAULT_ACCENT,
};

/** Global instance configuration: setup state, forum name, theme mode, accent. */
@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly api = inject(ApiService);

  readonly config = signal<AppConfig>(DEFAULT_CONFIG);
  readonly forumName = computed(() => this.config().forum_name);
  readonly theme = computed(() => this.config().theme);
  readonly accent = computed(() => this.config().accent);
  readonly configured = computed(() => this.config().configured);

  /** Load the public config and apply the theme + accent. Safe before routing. */
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

  /** Apply an accent locally (live preview) without persisting. */
  previewAccent(accent: string): void {
    applyAccent(accent);
  }

  /** Persist a config change (forum name and/or theme and/or accent). */
  async save(patch: { forum_name?: string; theme?: string; accent?: string }): Promise<void> {
    this.apply(await this.api.updateSettings(patch));
  }

  /** Adopt a full config (e.g. the response from `/api/setup`). */
  apply(config: AppConfig): void {
    // normalize + accent fallback guard a pre-nibble server's payload.
    const next: AppConfig = {
      ...config,
      theme: normalizeTheme(config.theme),
      accent: config.accent ?? DEFAULT_ACCENT,
    };
    this.config.set(next);
    applyTheme(next.theme);
    applyAccent(next.accent);
  }
}
