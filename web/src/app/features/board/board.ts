import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ForumStore } from '../../core/forum.store';
import { StatusService } from '../../core/status.service';
import { Lane } from './lane';

@Component({
  selector: 'app-board',
  imports: [FormsModule, Lane],
  templateUrl: './board.html',
  styleUrl: './board.css',
})
export class BoardPage implements OnInit {
  protected readonly store = inject(ForumStore);
  private readonly status = inject(StatusService);

  protected columnName = '';

  ngOnInit(): void {
    this.store.setView('board');
    void this.store.refreshCards();
  }

  protected async addColumn(): Promise<void> {
    const name = this.columnName.trim();
    if (!name) {
      this.status.flash('column name is required', true);
      return;
    }
    if (await this.store.addColumn(name)) this.columnName = '';
  }
}
