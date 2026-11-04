import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  effect,
  inject,
  output,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ApiError, ApiService } from '../../core/api.service';
import { ForumStore } from '../../core/forum.store';
import { TranslateService } from '../../core/i18n';
import type { Agent } from '../../core/models';
import { StatusService } from '../../core/status.service';
import { WhenPipe } from '../../core/time';
import { LoadingDots } from '../../shared/loading-dots';
import { Modal } from '../../shared/modal';
import { UserDetail } from './user-detail';

/** One request per typing pause — the first debounced input in the codebase. */
const SEARCH_DEBOUNCE_MS = 300;

/** The one-time credential for a freshly created seat. Lives only in this
 *  component instance and is wiped when the modal closes. */
interface CreatedSeat {
  agent: Agent;
  token: string;
  password: string | null;
}

@Component({
  selector: 'app-users',
  imports: [FormsModule, WhenPipe, LoadingDots, Modal, UserDetail],
  templateUrl: './users.html',
  styleUrl: './users.css',
})
export class UsersPage implements OnInit, OnDestroy {
  protected readonly i18n = inject(TranslateService);
  protected readonly store = inject(ForumStore);
  private readonly api = inject(ApiService);
  private readonly status = inject(StatusService);

  /** Row selection — also emitted for callers that want the seat externally. */
  readonly agentSelected = output<Agent>();

  /** The seat whose detail modal is open, or null when it is closed. */
  protected detailAgent: Agent | null = null;

  protected query = this.store.usersQuery();

  protected createOpen = false;
  protected handle = '';
  protected displayName = '';
  protected password = '';
  protected isHuman = true;
  protected busy = false;
  protected created: CreatedSeat | null = null;
  protected copied: 'token' | 'password' | null = null;
  protected handleError = '';
  protected displayNameError = '';
  protected passwordError = '';

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly sentinelEl = viewChild<ElementRef<HTMLElement>>('sentinel');

  constructor() {
    // Re-arm the sentinel watcher whenever a new sentinel mounts or unmounts.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void this.loadMore();
    });
    effect((onCleanup) => {
      const sentinel = this.sentinelEl()?.nativeElement;
      if (!sentinel) return;
      observer.observe(sentinel);
      onCleanup(() => observer.unobserve(sentinel));
    });
  }

  ngOnInit(): void {
    this.store.setView('users');
    void this.store.loadUsers({ reset: true });
  }

  ngOnDestroy(): void {
    if (this.searchTimer !== null) clearTimeout(this.searchTimer);
  }

  /** Debounced search: clearing the field lands back on the unfiltered list. */
  protected onSearch(value: string): void {
    if (this.searchTimer !== null) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.store.setUsersQuery(value.trim());
    }, SEARCH_DEBOUNCE_MS);
  }

  protected selectAgent(agent: Agent): void {
    this.agentSelected.emit(agent);
    this.detailAgent = agent;
  }

  protected closeDetail(): void {
    this.detailAgent = null;
  }

  /** Keep the directory in step with the modal's mutations without a page reload. */
  protected async onDetailChanged(): Promise<void> {
    await this.store.loadUsers({ reset: true });
  }

  protected openCreate(): void {
    this.resetCreate();
    this.createOpen = true;
  }

  /** Closing wipes the form and, crucially, the one-time credential. */
  protected closeCreate(): void {
    this.createOpen = false;
    this.resetCreate();
  }

  private resetCreate(): void {
    this.handle = '';
    this.displayName = '';
    this.password = '';
    this.isHuman = true;
    this.busy = false;
    this.created = null;
    this.copied = null;
    this.handleError = '';
    this.displayNameError = '';
    this.passwordError = '';
  }

  protected async create(): Promise<void> {
    if (this.busy || this.created) return;
    this.handleError = '';
    this.displayNameError = '';
    this.passwordError = '';

    const handle = this.handle.trim();
    const displayName = this.displayName.trim();
    if (handle === '') {
      this.handleError = this.i18n.t('users.handleRequired');
      return;
    }
    if (displayName === '') {
      this.displayNameError = this.i18n.t('users.displayNameRequired');
      return;
    }
    if (this.password !== '' && this.password.length < 8) {
      this.passwordError = this.i18n.t('users.passwordTooShort');
      return;
    }

    this.busy = true;
    try {
      const seat = await this.api.createAgent({
        handle,
        display_name: displayName,
        is_human: this.isHuman,
        ...(this.password === '' ? {} : { password: this.password }),
      });
      // The token is unrecoverable after this response — keep it in memory
      // just long enough for the credential card, then wipe it on close.
      this.created = { agent: seat, token: seat.token, password: this.password || null };
      this.password = '';
      this.status.flash(this.i18n.t('users.created', { handle: seat.handle }));
      await this.store.loadUsers({ reset: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        this.handleError = this.i18n.t('users.handleTaken');
      } else {
        this.status.flash(
          err instanceof Error ? err.message : this.i18n.t('users.createFailed'),
          true,
        );
      }
    } finally {
      this.busy = false;
    }
  }

  protected async copy(value: string, which: 'token' | 'password'): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.copied = which;
    } catch {
      this.status.flash(this.i18n.t('users.copyFailed'), true);
    }
  }

  protected finishCreate(): void {
    this.closeCreate();
  }

  /** Load the next batch; if the sentinel is still on screen after it (tall
   *  viewports never fire a fresh intersection), keep filling. */
  private async loadMore(): Promise<void> {
    if (this.store.usersLoadingMore() || !this.store.hasMoreUsers()) return;
    await this.store.loadUsers();
    const sentinel = this.sentinelEl()?.nativeElement;
    if (!sentinel || !this.store.hasMoreUsers()) return;
    const rect = sentinel.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) void this.loadMore();
  }
}
