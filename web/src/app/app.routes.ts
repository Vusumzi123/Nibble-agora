import type { Routes } from '@angular/router';

import { loginGuard, seatGuard, setupGuard } from './core/seat.guard';
import { Shell } from './features/shell/shell';
import { SetupPage } from './features/setup/setup';
import { LoginPage } from './features/login/login';
import { ThreadsPage } from './features/threads/threads';
import { ThreadDetailPage } from './features/threads/thread-detail';
import { BoardPage } from './features/board/board';
import { BoardsListPage } from './features/boards/boards';
import { ForumOverviewPage } from './features/forum/forum';
import { InboxPage } from './features/inbox/inbox';
import { SettingsPage } from './features/settings/settings';

export const routes: Routes = [
  { path: 'setup', component: SetupPage, canActivate: [setupGuard] },
  { path: 'login', component: LoginPage, canActivate: [loginGuard] },
  {
    path: '',
    component: Shell,
    canActivate: [seatGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'threads' },
      { path: 'threads', component: ThreadsPage },
      { path: 'threads/:id', component: ThreadDetailPage },
      { path: 'forum', component: ForumOverviewPage },
      { path: 'boards', component: BoardsListPage },
      { path: 'boards/:id', component: BoardPage },
      { path: 'board', component: BoardPage },
      { path: 'inbox', component: InboxPage },
      { path: 'settings', component: SettingsPage },
    ],
  },
  { path: '**', redirectTo: '' },
];
