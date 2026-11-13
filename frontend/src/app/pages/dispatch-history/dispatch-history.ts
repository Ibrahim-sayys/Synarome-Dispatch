import { DatePipe } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { DispatchRecord, DispatchService, HistoryFilters, HistorySender } from '../../core/dispatch.service';

@Component({
  selector: 'app-dispatch-history',
  imports: [DatePipe, RouterLink],
  templateUrl: './dispatch-history.html',
  styleUrl: './dispatch-history.css',
})
export class DispatchHistoryPage implements OnInit, OnDestroy {
  protected readonly history = signal<DispatchRecord[]>([]);
  protected readonly page = signal(1);
  protected readonly total = signal(0);
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / 20)));
  protected readonly historyUsers = signal<HistorySender[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly error = signal('');
  protected readonly sendersError = signal('');
  protected readonly search = signal('');
  protected readonly fromDate = signal('');
  protected readonly toDate = signal('');
  protected readonly fromTime = signal('');
  protected readonly toTime = signal('');
  protected readonly userId = signal<number | null>(null);
  protected readonly dispatchId = signal<number | null>(null);
  protected readonly customerId = signal<number | null>(null);
  protected readonly previewUrl = signal<string | null>(null);
  protected readonly previewTitle = signal('');
  protected readonly loadingPreviewId = signal<number | null>(null);
  protected readonly hasFilters = computed(() => Boolean(
    this.search().trim() || this.fromDate() || this.toDate() ||
    this.fromTime() || this.toTime() || this.userId() !== null || this.dispatchId() !== null || this.customerId() !== null,
  ));
  protected readonly hasOtherFilters = computed(() => Boolean(
    this.search().trim() || this.fromDate() || this.toDate() ||
    this.fromTime() || this.toTime() || this.dispatchId() !== null || this.customerId() !== null,
  ));

  private readonly dispatchService = inject(DispatchService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private historyRequest?: Subscription;
  private sendersRequest?: Subscription;
  private routeRequest?: Subscription;
  private previewRequest?: Subscription;

  ngOnInit(): void {
    this.loadSenders();
    this.routeRequest = this.route.queryParamMap.subscribe((params) => {
      const rawId = params.get('dispatch_id');
      this.dispatchId.set(rawId && /^\d+$/.test(rawId) && Number(rawId) > 0 ? Number(rawId) : null);
      const rawCustomerId = params.get('customer_id');
      this.customerId.set(rawCustomerId && /^\d+$/.test(rawCustomerId) && Number(rawCustomerId) > 0 ? Number(rawCustomerId) : null);
      this.page.set(1);
      this.loadHistory();
    });
  }

  protected refresh(): void {
    this.loadSenders();
    this.loadHistory();
  }

  private loadSenders(): void {
    this.sendersRequest?.unsubscribe();
    this.sendersError.set('');
    this.sendersRequest = this.dispatchService.listHistorySenders().subscribe({
      next: (users) => {
        this.historyUsers.set(users);
        if (this.userId() !== null && !users.some((user) => user.id === this.userId())) {
          this.userId.set(null);
          this.loadHistory();
        }
      },
      error: () => this.sendersError.set('Unable to load active senders. Refresh to try again.'),
    });
  }

  protected loadHistory(): void {
    this.historyRequest?.unsubscribe();
    this.error.set('');
    this.isLoading.set(true);
    const filters: HistoryFilters = {
      search: this.search(),
      from_date: this.fromDate(),
      to_date: this.toDate(),
      from_time: this.fromTime(),
      to_time: this.toTime(),
      user_id: this.userId(),
      dispatch_id: this.dispatchId(),
      customer_id: this.customerId(),
      timezone_offset_minutes: new Date().getTimezoneOffset(),
    };
    this.historyRequest = this.dispatchService.listHistoryPage(filters, this.page()).subscribe({
      next: (result) => {
        const lastPage = Math.max(1, Math.ceil(result.total / 20));
        if (this.page() > lastPage) {
          this.page.set(lastPage);
          this.loadHistory();
          return;
        }
        this.history.set(result.items);
        this.total.set(result.total);
        this.isLoading.set(false);
      },
      error: () => {
        this.error.set('Unable to load dispatch history. Please try again.');
        this.isLoading.set(false);
      },
    });
  }

  protected setFilter(filter: 'search' | 'fromDate' | 'toDate' | 'fromTime' | 'toTime' | 'userId', value: string): void {
    if (filter === 'search') this.search.set(value);
    if (filter === 'fromDate') this.fromDate.set(value);
    if (filter === 'toDate') this.toDate.set(value);
    if (filter === 'fromTime') this.fromTime.set(value);
    if (filter === 'toTime') this.toTime.set(value);
    if (filter === 'userId') this.userId.set(value ? Number(value) : null);
    this.page.set(1);
    if (this.dispatchId() !== null) this.clearRecordFocus();
    else this.loadHistory();
  }

  protected clearRecordFocus(): void {
    void this.router.navigate(['/dispatch/history']);
  }

  protected clearFilters(): void {
    this.search.set('');
    this.fromDate.set('');
    this.toDate.set('');
    this.fromTime.set('');
    this.toTime.set('');
    this.userId.set(null);
    this.page.set(1);
    if (this.dispatchId() !== null || this.customerId() !== null) this.clearRecordFocus();
    else this.loadHistory();
  }

  protected changePage(delta: number): void {
    const next = this.page() + delta;
    if (next < 1 || next > this.pageCount() || this.isLoading()) return;
    this.page.set(next);
    this.loadHistory();
  }

  protected isImageFile(path: string | null | undefined): boolean {
    return /\.(png|jpe?g)$/i.test(path ?? '');
  }

  protected statusText(record: DispatchRecord): string {
    if (record.send_mode === 'customer_dispatch' || record.send_mode === 'customer_test') {
      if (record.whatsapp_status === 'accepted') return 'Meta accepted';
      if (record.whatsapp_status === 'unknown') return 'Status uncertain';
      if (record.whatsapp_status === 'failed') return 'Failed';
      return 'Pending';
    }
    if (record.send_mode === 'whatsapp_test') {
      if (record.whatsapp_status === 'accepted') return 'Meta accepted';
      if (record.whatsapp_status === 'unknown') return 'Status uncertain';
      if (record.whatsapp_status === 'failed') return 'Failed';
      return 'Pending';
    }
    const submitted = record.recipients.filter((recipient) => recipient.delivery_status === 'sent').length;
    return `${submitted}/${record.recipients.length} submitted`;
  }

  protected previewImage(record: DispatchRecord): void {
    if (this.loadingPreviewId() !== null) return;
    this.loadingPreviewId.set(record.id);
    this.previewRequest = this.dispatchService.downloadFile(record.id).subscribe({
      next: (blob) => {
        this.closePreview();
        this.previewUrl.set(URL.createObjectURL(blob));
        this.previewTitle.set(`Dispatch #${record.id} image`);
        this.loadingPreviewId.set(null);
      },
      error: () => {
        this.error.set('Unable to open this image.');
        this.loadingPreviewId.set(null);
      },
    });
  }

  protected closePreview(): void {
    const url = this.previewUrl();
    if (url) URL.revokeObjectURL(url);
    this.previewUrl.set(null);
  }

  protected downloadFile(record: DispatchRecord): void {
    this.dispatchService.downloadFile(record.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const extension = record.file_path?.match(/\.(png|jpe?g|pdf)$/i)?.[0] ?? '';
        link.href = url;
        link.download = record.original_filename || `dispatch-${record.id}${extension}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      error: () => this.error.set('Unable to download this attachment.'),
    });
  }

  @HostListener('window:keydown.escape')
  protected onEscape(): void {
    if (this.previewUrl()) this.closePreview();
  }

  ngOnDestroy(): void {
    this.historyRequest?.unsubscribe();
    this.sendersRequest?.unsubscribe();
    this.routeRequest?.unsubscribe();
    this.previewRequest?.unsubscribe();
    this.closePreview();
  }
}
