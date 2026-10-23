import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import type { Project } from '../core/models';
import { TranslateService } from '../core/i18n';
import { Ellipsis } from './ellipsis';

/** One project as a card — used by the Boards list and the forum overview. */
@Component({
  selector: 'app-project-card',
  imports: [RouterLink, Ellipsis],
  templateUrl: './project-card.html',
  styleUrl: './project-card.css',
})
export class ProjectCard {
  protected readonly i18n = inject(TranslateService);
  readonly project = input.required<Project>();
  /** Router link — usually `['/boards', project.board_id]` (its one board). */
  readonly link = input.required<Array<string | number>>();
  readonly active = input(false);
  /** Column count of the project's board (joined by the caller). */
  readonly columns = input(0);
}
