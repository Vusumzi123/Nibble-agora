import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';

import { ConfigService } from '../../core/config.service';
import { ForumStore } from '../../core/forum.store';
import { SessionService } from '../../core/session.service';
import { StatusService } from '../../core/status.service';
import { SidePanel } from '../side-panel/side-panel';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, SidePanel],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  host: { '(document:keydown.escape)': 'closeUserMenu()' },
})
export class Shell implements OnInit, OnDestroy {
  protected readonly store = inject(ForumStore);
  protected readonly config = inject(ConfigService);
  protected readonly status = inject(StatusService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  /** Full-screen navigation drawer. */
  protected readonly panelOpen = signal(false);
  /** Top-bar account menu. */
  protected readonly userMenuOpen = signal(false);

  protected readonly handle = computed(() => this.session.me()?.handle ?? '—');
  protected readonly initial = computed(() =>
    (this.session.me()?.display_name ?? this.handle()).trim().charAt(0),
  );

  constructor() {
    // A rejected token mid-session (401) drops the seat back to the login page.
    effect(() => {
      if (!this.session.connected()) void this.router.navigateByUrl('/login');
    });
  }

  ngOnInit(): void {
    this.store.startPolling();
  }

  ngOnDestroy(): void {
    this.store.stopPolling();
  }

  protected openPanel(): void {
    this.userMenuOpen.set(false);
    this.panelOpen.set(true);
  }

  protected toggleUserMenu(): void {
    this.userMenuOpen.update((open) => !open);
  }

  protected closeUserMenu(): void {
    this.userMenuOpen.set(false);
  }

  protected openSettings(): void {
    this.userMenuOpen.set(false);
    void this.router.navigateByUrl('/settings');
  }

  protected disconnect(): void {
    this.userMenuOpen.set(false);
    this.session.leave();
    this.status.clear();
    void this.router.navigateByUrl('/login');
  }
}
