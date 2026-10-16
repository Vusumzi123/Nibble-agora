import { Component, OnInit, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ConfigService } from '../../core/config.service';
import { ForumStore } from '../../core/forum.store';
import type { Board, Project } from '../../core/models';
import { WhenPipe } from '../../core/time';
import { ProjectCard } from '../../shared/project-card';

/** Forum home: the forum's projects + recently active threads (all boards). */
@Component({
  selector: 'app-forum',
  imports: [RouterLink, WhenPipe, ProjectCard],
  templateUrl: './forum.html',
  styleUrl: './forum.css',
})
export class ForumOverviewPage implements OnInit {
  protected readonly store = inject(ForumStore);
  protected readonly config = inject(ConfigService);

  protected readonly projects = computed(() =>
    this.store.projects().filter((p: Project) => !p.archived_at),
  );
  protected readonly recent = computed(
    () => this.store.overview()?.recent_threads ?? [],
  );
  protected readonly counts = computed(
    () => this.store.overview()?.counts ?? { projects: 0, threads: 0 },
  );

  ngOnInit(): void {
    this.store.setView('forum');
    void this.store.refreshBoards();
    void this.store.refreshProjects();
    void this.store.refreshOverview();
  }

  protected boardOf(project: Project): Board | null {
    return this.store.boards().find((b) => b.id === project.board_id) ?? null;
  }
}
