import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { BusyService } from '../../core/busy.service';
import { ForumStore } from '../../core/forum.store';
import type { Board, Project } from '../../core/models';
import { StatusService } from '../../core/status.service';
import { ProjectCard } from '../../shared/project-card';

@Component({
  selector: 'app-boards',
  imports: [FormsModule, ProjectCard],
  templateUrl: './boards.html',
  styleUrl: './boards.css',
})
export class BoardsListPage implements OnInit {
  protected readonly store = inject(ForumStore);
  private readonly router = inject(Router);
  private readonly status = inject(StatusService);
  protected readonly busy = inject(BusyService);

  protected createOpen = false;
  protected name = '';
  protected description = '';

  ngOnInit(): void {
    this.store.setView('boards');
    void this.store.refreshBoards();
    void this.store.refreshProjects();
  }

  /** Live projects (archived stay out of the list). */
  protected get projects(): Project[] {
    return this.store.projects().filter((p) => !p.archived_at);
  }

  /** The project's single board — carries the column count for the card. */
  protected boardOf(project: Project): Board | null {
    return this.store.boards().find((b) => b.id === project.board_id) ?? null;
  }

  protected openCreate(): void {
    this.createOpen = true;
  }

  protected closeCreate(): void {
    this.createOpen = false;
    this.name = '';
    this.description = '';
  }

  protected async create(): Promise<void> {
    const name = this.name.trim();
    if (!name) {
      this.status.flash('project name is required', true);
      return;
    }
    const created = await this.store.createProject(name, this.description.trim());
    if (created) {
      this.closeCreate();
      void this.router.navigate(['/boards', created.board.id]);
    }
  }
}
