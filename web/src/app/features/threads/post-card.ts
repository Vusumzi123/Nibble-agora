import { Component, computed, inject, input } from '@angular/core';

import { ForumStore } from '../../core/forum.store';
import { REACTION_PRESETS, reactionIcon, type Post } from '../../core/models';
import { TranslateService } from '../../core/i18n';
import { SessionService } from '../../core/session.service';
import { WhenPipe } from '../../core/time';

interface Chip {
  token: string;
  icon: string;
  count: number;
  mine: boolean;
  agents: string[];
}

/** Accent pool for per-handle tag colors inside posts. */
const TAG_ACCENTS = [
  'var(--ph-primary)',
  'var(--ph-info)',
  'var(--ph-success)',
  'var(--ph-warning)',
  'var(--ph-danger)',
];

/** Stable accent per handle — same handle always gets the same color. */
function accentFor(handle: string): string {
  let hash = 0;
  for (const ch of handle) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return TAG_ACCENTS[Math.abs(hash) % TAG_ACCENTS.length] ?? 'var(--ph-primary)';
}

@Component({
  selector: 'app-post-card',
  imports: [WhenPipe],
  templateUrl: './post-card.html',
  styleUrl: './post-card.css',
})
export class PostCard {
  readonly post = input.required<Post>();

  private readonly store = inject(ForumStore);
  protected readonly i18n = inject(TranslateService);
  private readonly session = inject(SessionService);

  private readonly handle = computed(() => this.session.me()?.handle ?? '');

  private readonly groups = computed<{ token: string; agents: string[]; mine: boolean }[]>(() => {
    const byToken = new Map<string, string[]>();
    for (const reaction of this.post().reactions) {
      const list = byToken.get(reaction.emoji) ?? [];
      list.push(reaction.agent);
      byToken.set(reaction.emoji, list);
    }
    const me = this.handle();
    return [...byToken].map(([token, agents]) => ({ token, agents, mine: agents.includes(me) }));
  });

  /** Preset row first (always visible, counter even at 0), then any custom tokens. */
  protected readonly chips = computed<Chip[]>(() => {
    const groups = this.groups();
    const byToken = new Map(groups.map((g) => [g.token, g]));
    const presetTokens = new Set(REACTION_PRESETS.map((p) => p.token));

    const presets: Chip[] = REACTION_PRESETS.map((p) => {
      const hit = byToken.get(p.token);
      return {
        token: p.token,
        icon: p.icon,
        count: hit?.agents.length ?? 0,
        mine: hit?.mine ?? false,
        agents: hit?.agents ?? [],
      };
    });
    const custom: Chip[] = groups
      .filter((g) => !presetTokens.has(g.token))
      .map((g) => ({
        token: g.token,
        icon: reactionIcon(g.token),
        count: g.agents.length,
        mine: g.mine,
        agents: g.agents,
      }));
    return [...presets, ...custom];
  });

  protected toggle(chip: Chip): void {
    void this.store.toggleReaction(this.post().id, chip.token, chip.mine);
  }

  protected asHandle(handle: string): string {
    return `@${handle}`;
  }

  protected accentFor(handle: string): string {
    return accentFor(handle);
  }
}
