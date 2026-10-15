import { Component, computed, inject, input } from '@angular/core';

import { ForumStore } from '../../core/forum.store';
import type { Post } from '../../core/models';
import { SessionService } from '../../core/session.service';
import { WhenPipe } from '../../core/time';

const PRESET_EMOJI = ['+1', 'ack', '🎉'];

interface Group {
  emoji: string;
  agents: string[];
  mine: boolean;
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
  private readonly session = inject(SessionService);

  private readonly handle = computed(() => this.session.me()?.handle ?? '');

  protected readonly groups = computed<Group[]>(() => {
    const byEmoji = new Map<string, string[]>();
    for (const reaction of this.post().reactions) {
      const list = byEmoji.get(reaction.emoji) ?? [];
      list.push(reaction.agent);
      byEmoji.set(reaction.emoji, list);
    }
    return [...byEmoji].map(([emoji, agents]) => ({
      emoji,
      agents,
      mine: agents.includes(this.handle()),
    }));
  });

  protected readonly presets = computed<string[]>(() => {
    const seen = new Set(this.groups().map((g) => g.emoji));
    return PRESET_EMOJI.filter((emoji) => !seen.has(emoji));
  });

  protected toggle(emoji: string, remove: boolean): void {
    void this.store.toggleReaction(this.post().id, emoji, remove);
  }

  protected asHandle(handle: string): string {
    return `@${handle}`;
  }
}
