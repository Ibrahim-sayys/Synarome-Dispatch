import { DatePipe } from '@angular/common';
import { Component, ElementRef, HostListener, OnDestroy, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { DispatchRecord, DispatchService, DispatchStatus, mergeDispatchStatus } from '../../core/dispatch.service';
import { matchesChatSearch } from '../chat-search';

@Component({
  selector: 'app-message-thread',
  imports: [DatePipe],
  templateUrl: './message-thread.html',
  styleUrl: './message-thread.css',
})
export class MessageThread implements OnDestroy {
  readonly records = input<DispatchRecord[]>([]);
  readonly loading = input(false);
  readonly error = input('');
  readonly emptyMessage = input('No messages yet.');
  readonly searchTerm = input('');
  readonly scrollToLatest = input(true);
  readonly hasOlder = input(false);
  readonly loadingOlder = input(false);
  readonly loadOlder = output<void>();
  readonly retryCompleted = output<void>();
  protected readonly retrying = signal<Set<number>>(new Set());
  protected readonly retryError = signal('');
  private readonly retryResults = signal<Record<number, { status: string; error: string | null; messageId: string | null }>>({});
  private readonly liveStatuses = signal<Record<number, DispatchStatus>>({});
  protected readonly previewUrls = signal<Record<number, string>>({});
  protected readonly previewErrors = signal<Set<number>>(new Set());
  protected readonly expandedImage = signal<{ url: string; label: string } | null>(null);
  protected readonly downloadError = signal('');
  protected readonly entries = computed(() => {
    let previousDay = '';
    return [...this.records()].reverse().map((record) => {
      const current = mergeDispatchStatus(record, this.liveStatuses()[record.id]);
      const result = this.retryResults()[record.id];
      if (result && current.whatsapp_message_id !== result.messageId) return { ...current, whatsapp_status: result.status, failure_reason: result.error, whatsapp_message_id: result.messageId };
      return current;
    }).filter((record) => matchesChatSearch(record, this.searchTerm())).map((record) => {
      const parsed = record.timestamp ? new Date(record.timestamp) : null;
      const timestamp = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
      const day = timestamp?.toDateString() ?? 'unknown';
      const showDate = day !== previousDay;
      previousDay = day;
      return { record, timestamp, showDate };
    });
  });
  private readonly thread = viewChild<ElementRef<HTMLDivElement>>('thread');
  private readonly dispatch = inject(DispatchService);
  private readonly subscriptions = new Subscription();
  private readonly requestedPreviews = new Set<number>();
  private pendingOlderOffset: number | null = null;

  constructor() {
    this.subscriptions.add(this.dispatch.monitorStatuses(() => this.records()).subscribe((statuses) => {
      this.liveStatuses.set(Object.fromEntries(statuses.map((status) => [status.id, status])));
    }));
    effect(() => {
      const showLatest = this.scrollToLatest();
      for (const record of this.records()) {
        if (!this.isImage(record) || this.requestedPreviews.has(record.id)) continue;
        this.requestedPreviews.add(record.id);
        this.subscriptions.add(this.dispatch.downloadFile(record.id).subscribe({
          next: (blob) => {
            const url = URL.createObjectURL(blob);
            this.previewUrls.update((current) => ({ ...current, [record.id]: url }));
          },
          error: () => this.previewErrors.update((current) => new Set([...current, record.id])),
        }));
      }
      requestAnimationFrame(() => {
        const element = this.thread()?.nativeElement;
        if (!element) return;
        if (this.pendingOlderOffset !== null) {
          element.scrollTop = element.scrollHeight - this.pendingOlderOffset;
          this.pendingOlderOffset = null;
        } else {
          element.scrollTop = showLatest ? element.scrollHeight : 0;
        }
      });
    });
  }

  protected isImage(record: DispatchRecord): boolean {
    return !!record.file_path && /\.(png|jpe?g)$/i.test(record.original_filename || record.file_path);
  }

  protected retry(record: DispatchRecord): void {
    if (this.retrying().has(record.id)) return;
    this.retryError.set('');
    this.retrying.update((ids) => new Set([...ids, record.id]));
    this.subscriptions.add(this.dispatch.retry(record.id).subscribe({
      next: (result) => {
        this.retryResults.update((items) => ({ ...items, [record.id]: { status: result.status, error: result.error ?? null, messageId: result.message_id ?? null } }));
        this.retrying.update((ids) => { const next = new Set(ids); next.delete(record.id); return next; });
        this.retryCompleted.emit();
      },
      error: (response) => {
        this.retryError.set(typeof response.error?.detail === 'string' ? response.error.detail : 'Could not confirm the retry. Check the message before trying again.');
        this.retrying.update((ids) => { const next = new Set(ids); next.delete(record.id); return next; });
        this.retryCompleted.emit();
      },
    }));
  }

  protected isPdf(record: DispatchRecord): boolean {
    return /\.pdf$/i.test(record.original_filename || record.file_path || '');
  }

  protected status(record: DispatchRecord): string {
    if (record.direction === 'incoming') return 'Received';
    if (record.whatsapp_status === 'read') return 'Read';
      if (record.whatsapp_status === 'delivered') return 'Delivered';
      if (record.whatsapp_status === 'sent') return 'Sent';
      if (record.whatsapp_status === 'accepted') return 'Meta accepted';
    if (record.whatsapp_status === 'unknown') return 'Status uncertain';
    if (record.whatsapp_status === 'failed') return 'Failed';
    return 'Pending';
  }

  protected openImage(record: DispatchRecord): void {
    const url = this.previewUrls()[record.id];
    if (url) this.expandedImage.set({ url, label: `Image from dispatch ${record.id}` });
  }

  protected downloadAttachment(record: DispatchRecord): void {
    this.downloadError.set('');
    this.dispatch.downloadFile(record.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = record.original_filename || `bilty-${record.id}${this.isPdf(record) ? '.pdf' : ''}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      error: () => this.downloadError.set('Unable to download the attachment.'),
    });
  }

  protected requestOlder(): void {
    const element = this.thread()?.nativeElement;
    this.pendingOlderOffset = element ? element.scrollHeight - element.scrollTop : null;
    this.loadOlder.emit();
  }

  @HostListener('window:keydown.escape')
  protected onEscape(): void { if (this.expandedImage()) this.expandedImage.set(null); }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    Object.values(this.previewUrls()).forEach((url) => URL.revokeObjectURL(url));
  }
}
