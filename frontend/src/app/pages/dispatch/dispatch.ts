import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ContactsService, MarketingPerson } from '../../core/contacts.service';
import { DispatchRecord, DispatchService, HistoryFilters } from '../../core/dispatch.service';

@Component({
  selector: 'app-dispatch',
  imports: [ReactiveFormsModule],
  templateUrl: './dispatch.html',
  styleUrl: './dispatch.css',
})
export class DispatchPage implements OnInit, OnDestroy {
  protected readonly contacts = signal<MarketingPerson[]>([]);
  protected readonly contactSearchTerm = signal('');
  protected readonly selectedRecipientIds = signal<Set<number>>(new Set());
  protected readonly history = signal<DispatchRecord[]>([]);
  protected readonly isSending = signal(false);
  protected readonly isLoadingHistory = signal(false);
  protected readonly historySearch = signal('');
  protected readonly historyFromDate = signal('');
  protected readonly historyToDate = signal('');
  protected readonly historyFromTime = signal('');
  protected readonly historyToTime = signal('');
  protected readonly historyUserId = signal<number | null>(null);
  protected readonly message = signal('');
  protected readonly isErrorMessage = signal(false);
  protected readonly selectedFile = signal<File | null>(null);
  protected readonly selectedFilePreviewUrl = signal<string | null>(null);
  protected readonly selectedFileName = computed(() => this.selectedFile()?.name ?? 'No file selected');
  protected readonly isSelectedFileImage = computed(() => {
    const file = this.selectedFile();
    if (!file) return false;
    return file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name);
  });
  protected readonly lightboxUrl = signal<string | null>(null);
  protected readonly lightboxTitle = signal<string>('');
  protected readonly isLoadingHistoryPreview = signal<number | null>(null);
  private historyPreviewBlobUrl: string | null = null;
  protected readonly hasActiveHistoryFilters = computed(() => {
    return Boolean(
      this.historySearch().trim() ||
      this.historyUserId() !== null ||
      this.historyFromDate() ||
      this.historyToDate() ||
      this.historyFromTime() ||
      this.historyToTime()
    );
  });
  protected readonly activeHistoryFilterCount = computed(() => {
    let count = 0;
    if (this.historySearch().trim()) count++;
    if (this.historyUserId() !== null) count++;
    if (this.historyFromDate()) count++;
    if (this.historyToDate()) count++;
    if (this.historyFromTime()) count++;
    if (this.historyToTime()) count++;
    return count;
  });
  protected readonly selectedCount = computed(() => this.selectedRecipientIds().size);
  protected readonly filteredContacts = computed(() => {
    const term = this.contactSearchTerm().trim().toLowerCase();
    if (!term) {
      return this.contacts();
    }

    return this.contacts().filter((contact) => {
      return (
        contact.full_name.toLowerCase().includes(term) ||
        contact.phone_number.toLowerCase().includes(term)
      );
    });
  });
  protected readonly historyUsers = computed(() => {
    const users = new Map<number, string>();
    this.history().forEach((record) => {
      if (record.sender) users.set(record.sender.id, record.sender.username);
    });
    return Array.from(users, ([id, username]) => ({ id, username })).sort((a, b) => a.username.localeCompare(b.username));
  });

  private readonly contactsService = inject(ContactsService);
  private readonly dispatchService = inject(DispatchService);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  protected readonly dispatchForm = this.formBuilder.group({
    message_text: [''],
  });

  ngOnInit(): void {
    this.loadContacts();
    this.loadHistory();
  }

  protected loadContacts(): void {
    this.contactsService.listContacts('', false).subscribe({
      next: (contacts) => this.contacts.set(contacts),
      error: () => this.showMessage('Unable to load active contacts.', true),
    });
  }

  protected loadHistory(): void {
    this.isLoadingHistory.set(true);
    const filters: HistoryFilters = {
      search: this.historySearch(),
      from_date: this.historyFromDate(),
      to_date: this.historyToDate(),
      from_time: this.historyFromTime(),
      to_time: this.historyToTime(),
      user_id: this.historyUserId(),
    };
    this.dispatchService.listHistory(filters).subscribe({
      next: (history) => {
        this.history.set(history);
        this.isLoadingHistory.set(false);
      },
      error: () => {
        this.showMessage('Unable to load dispatch history.', true);
        this.isLoadingHistory.set(false);
      },
    });
  }

  protected setHistoryFilter(filter: 'search' | 'fromDate' | 'toDate' | 'fromTime' | 'toTime' | 'user', value: string): void {
    if (filter === 'search') this.historySearch.set(value);
    if (filter === 'fromDate') this.historyFromDate.set(value);
    if (filter === 'toDate') this.historyToDate.set(value);
    if (filter === 'fromTime') this.historyFromTime.set(value);
    if (filter === 'toTime') this.historyToTime.set(value);
    if (filter === 'user') this.historyUserId.set(value ? Number(value) : null);
    this.loadHistory();
  }

  protected clearHistoryFilters(): void {
    this.historySearch.set('');
    this.historyFromDate.set('');
    this.historyToDate.set('');
    this.historyFromTime.set('');
    this.historyToTime.set('');
    this.historyUserId.set(null);
    this.loadHistory();
  }

  protected toggleRecipient(contactId: number, checked: boolean): void {
    const next = new Set(this.selectedRecipientIds());
    if (checked) {
      next.add(contactId);
    } else {
      next.delete(contactId);
    }
    this.selectedRecipientIds.set(next);
  }

  protected selectAllRecipients(): void {
    const next = new Set(this.selectedRecipientIds());
    this.filteredContacts().forEach((c) => next.add(c.id));
    this.selectedRecipientIds.set(next);
  }

  protected clearRecipients(): void {
    this.selectedRecipientIds.set(new Set());
  }

  protected readonly isAllFilteredSelected = computed(() => {
    const filtered = this.filteredContacts();
    if (filtered.length === 0) return false;
    const selected = this.selectedRecipientIds();
    return filtered.every((c) => selected.has(c.id));
  });

  protected searchContacts(value: string): void {
    this.contactSearchTerm.set(value);
  }

  private revokePreviewUrl(): void {
    const url = this.selectedFilePreviewUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
  }

  private revokeHistoryPreviewUrl(): void {
    if (this.historyPreviewBlobUrl) {
      URL.revokeObjectURL(this.historyPreviewBlobUrl);
      this.historyPreviewBlobUrl = null;
    }
  }

  protected setFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.revokePreviewUrl();
    this.selectedFile.set(file);
    if (file && (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name))) {
      this.selectedFilePreviewUrl.set(URL.createObjectURL(file));
    } else {
      this.selectedFilePreviewUrl.set(null);
    }
  }

  protected removeFile(): void {
    this.revokePreviewUrl();
    this.selectedFile.set(null);
    this.selectedFilePreviewUrl.set(null);
  }

  protected openLightbox(url: string, title = 'Image Preview'): void {
    this.lightboxUrl.set(url);
    this.lightboxTitle.set(title);
  }

  protected closeLightbox(): void {
    this.lightboxUrl.set(null);
    this.lightboxTitle.set('');
  }

  @HostListener('window:keydown.escape')
  protected onEscapeKey(): void {
    if (this.lightboxUrl()) {
      this.closeLightbox();
    }
  }

  protected isImageFile(path?: string | null): boolean {
    if (!path) return false;
    return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(path);
  }

  protected previewHistoryFile(record: DispatchRecord): void {
    if (!record.file_path) return;
    this.isLoadingHistoryPreview.set(record.id);
    this.dispatchService.downloadFile(record.id).subscribe({
      next: (blob) => {
        this.revokeHistoryPreviewUrl();
        const url = URL.createObjectURL(blob);
        this.historyPreviewBlobUrl = url;
        this.openLightbox(url, `Dispatch #${record.id} Attachment`);
        this.isLoadingHistoryPreview.set(null);
      },
      error: () => {
        this.showMessage('Unable to load image preview.', true);
        this.isLoadingHistoryPreview.set(null);
      },
    });
  }

  ngOnDestroy(): void {
    this.revokePreviewUrl();
    this.revokeHistoryPreviewUrl();
  }

  protected getInitials(name: string): string {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((n) => n[0].toUpperCase())
      .join('');
  }

  protected formatFileSize(bytes?: number): string {
    if (!bytes) return '';
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  }

  protected sendDispatch(): void {
    this.clearMessage();

    const recipientIds = Array.from(this.selectedRecipientIds());
    const messageText = this.dispatchForm.getRawValue().message_text;
    const file = this.selectedFile();

    if (recipientIds.length === 0) {
      this.showMessage('Select at least one recipient.', true);
      return;
    }

    if (!messageText.trim() && !file) {
      this.showMessage('Add a message or choose a file.', true);
      return;
    }

    this.isSending.set(true);
    this.dispatchService.sendDispatch(recipientIds, messageText, file).subscribe({
      next: (record) => {
        const hasUnsent = record.recipients.some((recipient) => recipient.delivery_status !== 'sent');
        this.showMessage(hasUnsent ? 'Dispatch recorded, but WhatsApp needs configuration.' : 'Dispatch sent.');
        this.dispatchForm.reset({ message_text: '' });
        this.revokePreviewUrl();
        this.selectedFile.set(null);
        this.selectedFilePreviewUrl.set(null);
        this.selectedRecipientIds.set(new Set());
        this.isSending.set(false);
        this.loadHistory();
      },
      error: (error) => {
        this.showMessage(error.error?.detail ?? 'Unable to send dispatch.', true);
        this.isSending.set(false);
      },
    });
  }

  protected downloadFile(record: DispatchRecord): void {
    this.dispatchService.downloadFile(record.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `dispatch-${record.id}`;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: () => this.showMessage('Unable to download dispatch file.', true),
    });
  }

  protected statusText(record: DispatchRecord): string {
    const sent = record.recipients.filter((recipient) => recipient.delivery_status === 'sent').length;
    return `${sent}/${record.recipients.length} sent`;
  }

  protected contactIsSelected(contactId: number): boolean {
    return this.selectedRecipientIds().has(contactId);
  }

  private showMessage(message: string, isError = false): void {
    this.message.set(message);
    this.isErrorMessage.set(isError);
  }

  private clearMessage(): void {
    this.message.set('');
    this.isErrorMessage.set(false);
  }
}
