import { DatePipe } from '@angular/common';
import { Component, ElementRef, HostListener, OnDestroy, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { DispatchRecord, DispatchService } from '../../core/dispatch.service';
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
  protected readonly previewUrls = signal<Record<number, string>>({});
  protected readonly previewErrors = signal<Set<number>>(new Set());
  protected readonly expandedImage = signal<{ url: string; label: string } | null>(null);
  protected readonly downloadError = signal('');
  protected readonly entries = computed(() => {
    let previousDay = '';
    return [...this.records()].reverse().filter((record) => matchesChatSearch(record, this.searchTerm())).map((record) => {
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
    return /\.(png|jpe?g)$/i.test(record.original_filename || record.file_path || '');
  }

  protected isPdf(record: DispatchRecord): boolean {
    return /\.pdf$/i.test(record.original_filename || record.file_path || '');
  }

  protected status(record: DispatchRecord): string {
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
