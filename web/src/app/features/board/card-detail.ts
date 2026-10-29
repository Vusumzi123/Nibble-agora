import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ForumStore } from '../../core/forum.store';
import { TranslateService } from '../../core/i18n';
import { when } from '../../core/time';
import type { Card, CardComment } from '../../core/models';
import { CharCounter } from '../../shared/char-counter';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { renderMarkdown } from '../../shared/markdown';
import { Modal } from '../../shared/modal';

/**
 * The card's full text: opened by clicking a card tile, or blank when the
 * board asks for a new card. The header carries the card's title (double-click
 * to rename); the body opens as rendered markdown with an edit toggle. Title,
 * body and owner save together through `PATCH /api/cards/:id` — or, in create
 * mode, through `POST /api/cards` when the draft is saved.
 */
@Component({
  selector: 'app-card-detail',
  imports: [FormsModule, CharCounter, ConfirmDialog, Modal],
  templateUrl: './card-detail.html',
  styleUrl: './card-detail.css',
})
export class CardDetail {
  /** The card being edited; null opens the modal as a new-card composer. */
  readonly card = input<Card | null>(null);
  /** Target column for a new card. */
  readonly columnId = input<number | null>(null);
  readonly closed = output<void>();

  protected readonly store = inject(ForumStore);
  protected readonly i18n = inject(TranslateService);
  protected readonly creating = computed(() => this.card() === null);

  protected readonly title = signal('');
  protected readonly body = signal('');
  protected readonly assignee = signal<number | null>(null);
  /** Marked blocked by the current seat; persisted immediately, not with save. */
  protected readonly blocked = signal(false);
  protected readonly blocking = signal(false);
  /** The card's own conversation, loaded when the modal opens. */
  protected readonly comments = signal<CardComment[]>([]);
  protected readonly commentsLoading = signal(true);
  protected readonly commentDraft = signal('');
  /** True while the card + any pending comment save together. */
  protected readonly saving = signal(false);
  /** Read mode by default: the body is prose, not a form field. Edit flips to
      the raw markdown textarea; both share the same draft. */
  protected readonly editing = signal(false);
  /** The header title is a label until double-clicked. */
  protected readonly editingTitle = signal(false);
  protected readonly confirmingDelete = signal(false);
  /** The board refreshed this card while the modal was open (live feed). */
  protected readonly remoteChanged = signal(false);
  protected readonly rendered = computed(() => renderMarkdown(this.body()));
  protected readonly canSave = computed(
    () =>
      !this.saving() &&
      this.title().trim().length > 0 &&
      (this.card() !== null || this.columnId() !== null),
  );

  private readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('titleInput');
  private readonly bodyInput = viewChild<ElementRef<HTMLTextAreaElement>>('bodyInput');
  private titleBeforeEdit = '';
  private seeded = { title: '', body: '', assignee: null as number | null, updatedAt: '' };

  constructor() {
    // Live feed: the board refreshes the store while this modal is open. Adopt
    // a remote change when the draft is clean; otherwise keep the draft and
    // offer a reload instead of yanking the text from under the user.
    effect(() => {
      const card = this.card();
      if (!card) return;
      const fresh = this.store.cards().find((item) => item.id === card.id);
      if (!fresh || fresh.updated_at === this.seeded.updatedAt) return;
      if (this.isDirty()) {
        this.remoteChanged.set(true);
        return;
      }
      this.seed(fresh);
    });
  }

  /** Seed the fields once — later card refreshes must not clobber edits. */
  protected ngOnInit(): void {
    const card = this.card();
    if (card) {
      this.seed(card);
      void this.loadComments();
      return;
    }
    // New card: land straight in edit mode with the title field focused.
    this.editingTitle.set(true);
    this.editing.set(true);
    this.commentsLoading.set(false);
    requestAnimationFrame(() => this.titleInput()?.nativeElement.focus());
  }

  private isDirty(): boolean {
    return (
      this.title() !== this.seeded.title ||
      this.body() !== this.seeded.body ||
      this.assignee() !== this.seeded.assignee
    );
  }

  private seed(card: Card): void {
    this.title.set(card.title);
    this.body.set(card.body);
    this.assignee.set(card.assignee_id);
    this.blocked.set(card.blocked_at !== null);
    this.seeded = {
      title: card.title,
      body: card.body,
      assignee: card.assignee_id,
      updatedAt: card.updated_at,
    };
    this.remoteChanged.set(false);
  }

  /** Pull the remote revision over the local draft. */
  protected reload(): void {
    const card = this.card();
    if (!card) return;
    const fresh = this.store.cards().find((item) => item.id === card.id);
    if (fresh) this.seed(fresh);
    else this.remoteChanged.set(false);
  }

  protected get limit(): number {
    return this.store.session.limits().card_body_char_limit;
  }

  protected get commentLimit(): number {
    return this.store.session.limits().post_char_limit;
  }

  protected render(body: string): string {
    return renderMarkdown(body);
  }

  protected when(iso: string): string {
    return when(iso, this.i18n.locale());
  }

  private async loadComments(): Promise<void> {
    const card = this.card();
    if (!card) return;
    this.commentsLoading.set(true);
    this.comments.set(await this.store.cardComments(card.id));
    this.commentsLoading.set(false);
  }

  protected async toggleBlocked(): Promise<void> {
    const card = this.card();
    if (!card || this.blocking()) return;
    const next = !this.blocked();
    this.blocking.set(true);
    const ok = await this.store.setBlocked(card.id, next);
    this.blocking.set(false);
    if (!ok) return;
    this.blocked.set(next);
    // Our own toggle refreshed the card; don't flag it as a remote edit when
    // the seat has an unrelated draft open.
    const fresh = this.store.cards().find((item) => item.id === card.id);
    if (fresh) this.seeded.updatedAt = fresh.updated_at;
    this.remoteChanged.set(false);
  }

  protected onAssignee(event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    this.assignee.set(raw === '' ? null : Number(raw));
  }

  protected startTitleEdit(): void {
    this.titleBeforeEdit = this.title();
    this.editingTitle.set(true);
    requestAnimationFrame(() => {
      const input = this.titleInput()?.nativeElement;
      input?.focus();
      input?.select();
    });
  }

  /** The rendered body is another way into edit mode. */
  protected startBodyEdit(): void {
    if (this.editing()) return;
    this.editing.set(true);
    requestAnimationFrame(() => this.bodyInput()?.nativeElement.focus());
  }

  protected commitTitle(): void {
    if (!this.editingTitle()) return;
    const next = this.title().trim();
    this.title.set(next || this.titleBeforeEdit);
    this.editingTitle.set(false);
  }

  protected cancelTitle(): void {
    this.title.set(this.titleBeforeEdit);
    this.editingTitle.set(false);
  }

  protected async save(): Promise<void> {
    if (!this.canSave()) return;
    const card = this.card();
    const title = this.title().trim();
    this.saving.set(true);
    try {
      if (card) {
        // Save now also posts a pending comment and keeps the card open.
        const result = await this.store.saveCard(
          card.id,
          { title, body: this.body(), assignee: this.assignee() },
          this.commentDraft(),
        );
        if (result.ok && result.comment) {
          this.comments.update((list) => [...list, result.comment!]);
          this.commentDraft.set('');
        }
        return;
      }
      const ok = await this.store.addCard(this.columnId()!, title, this.body(), this.assignee());
      // A freshly created card has no modal identity yet — close to the board.
      if (ok) this.closed.emit();
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const card = this.card();
    if (!card) return;
    this.confirmingDelete.set(false);
    const ok = await this.store.deleteCard(card);
    if (ok) this.closed.emit();
  }
}
