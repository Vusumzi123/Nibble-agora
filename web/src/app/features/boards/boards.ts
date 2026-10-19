import { Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { BusyService } from '../../core/busy.service';
import { ForumStore } from '../../core/forum.store';
import type { Board, Project } from '../../core/models';
import { StatusService } from '../../core/status.service';
import { PROJECT_DRAG_TYPE, acceptsDrag, dropIndex, startDrag } from '../../shared/drag-reorder';
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

  @ViewChild('nameInput') private nameInput?: ElementRef<HTMLInputElement>;

  /** The project being dragged and the one its pointer is over. */
  protected draggingProjectId: number | null = null;
  protected overProjectId: number | null = null;

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

  // ---- project drag & drop -------------------------------------------------

  protected onProjectDragStart(event: DragEvent, project: Project): void {
    this.draggingProjectId = project.id;
    startDrag(event, PROJECT_DRAG_TYPE, project.id);
    // The card is a link; keep the browser from dragging its URL instead.
    event.dataTransfer?.setData('text/plain', '');
  }

  protected onProjectDragOver(event: DragEvent, project: Project): void {
    if (!acceptsDrag(event, PROJECT_DRAG_TYPE)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.overProjectId = project.id;
  }

  protected onProjectDragLeave(event: DragEvent): void {
    const to = event.relatedTarget as Node | null;
    const from = event.currentTarget as HTMLElement | null;
    if (to && from?.contains(to)) return;
    this.overProjectId = null;
  }

  protected onProjectDrop(event: DragEvent, project: Project): void {
    if (!acceptsDrag(event, PROJECT_DRAG_TYPE)) return;
    event.preventDefault();
    this.overProjectId = null;
    this.draggingProjectId = null;

    const projects = this.projects;
    const draggedId = Number(event.dataTransfer?.getData(PROJECT_DRAG_TYPE));
    const from = projects.findIndex((p) => p.id === draggedId);
    const overIdx = projects.findIndex((p) => p.id === project.id);
    if (from < 0 || overIdx < 0 || from === overIdx) return;

    const target = dropIndex(event, event.currentTarget as HTMLElement, overIdx, from, 'x');
    if (target === from) return;
    void this.store.reorderProject(draggedId, from, target - from);
  }

  protected endProjectDrag(): void {
    this.draggingProjectId = null;
    this.overProjectId = null;
  }

  protected openCreate(): void {
    this.createOpen = true;
    setTimeout(() => this.nameInput?.nativeElement.focus());
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
