import { DatePipe } from '@angular/common';
import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY, Subscription, catchError, from, mergeMap, tap } from 'rxjs';
import { ContactsService, MarketingPerson } from '../../core/contacts.service';
import { DispatchRecord, DispatchService } from '../../core/dispatch.service';
import { ActionNotice } from '../../core/action-notice';
import { matchesChatSearch } from '../../shared/chat-search';

@Component({
  selector: 'app-contacts',
  imports: [ReactiveFormsModule, DatePipe],
  templateUrl: './contacts.html',
  styleUrl: './contacts.css',
})
export class Contacts implements OnInit, OnDestroy {
  protected readonly contacts = signal<MarketingPerson[]>([]);
  protected readonly isAddOpen = signal(false);
  protected readonly searchTerm = signal('');
  protected readonly editingContact = signal<MarketingPerson | null>(null);
  protected readonly openMenuId = signal<number | null>(null);
  protected readonly deleteTarget = signal<MarketingPerson | null>(null);
  protected readonly isSaving = signal(false);
  protected readonly isDeleting = signal(false);
  private readonly notice = new ActionNotice();
  protected readonly message = this.notice.message;
  protected readonly isErrorMessage = this.notice.isError;
  protected readonly selectedContact = signal<MarketingPerson | null>(null);
  protected readonly contactHistory = signal<DispatchRecord[]>([]);
  protected readonly historySearch = signal('');
  protected readonly isLoadingContactHistory = signal(false);
  protected readonly historyError = signal('');
  protected readonly previewUrls = signal<Record<number, string>>({});
  protected readonly previewErrors = signal<Set<number>>(new Set());
  protected readonly expandedImage = signal<{ url: string; label: string } | null>(null);
  protected readonly conversation = computed(() => {
    const records = [...this.contactHistory()].reverse().filter((record) => matchesChatSearch(record, this.historySearch()));
    let previousDay = '';
    return records.map((record) => {
      const parsed = record.timestamp ? new Date(record.timestamp) : null;
      const timestamp = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
      const day = timestamp?.toDateString() ?? 'unknown';
      const showDate = day !== previousDay;
      previousDay = day;
      return { record, timestamp, showDate };
    });
  });
  protected readonly filteredContacts = computed(() => this.contacts());
  private readonly conversationThread = viewChild<ElementRef<HTMLDivElement>>('conversationThread');

  private historyRequest?: Subscription;
  private previewRequests?: Subscription;

  private readonly contactsService = inject(ContactsService);
  private readonly dispatchService = inject(DispatchService);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  protected readonly contactForm = this.formBuilder.group({
    full_name: ['', [Validators.required, Validators.minLength(2)]],
    phone_number: ['', [Validators.required, Validators.pattern(/^[0-9]{11,15}$/)]],
  });

  protected readonly editForm = this.formBuilder.group({
    full_name: ['', [Validators.required, Validators.minLength(2)]],
    phone_number: ['', [Validators.required, Validators.pattern(/^[0-9]{11,15}$/)]],
    is_active: [true],
  });

  ngOnInit(): void {
    this.loadContacts();
  }

  protected loadContacts(): void {
    this.contactsService.listContacts(this.searchTerm()).subscribe({
      next: (contacts) => this.contacts.set(contacts),
      error: () => this.showMessage('Unable to load contacts.', true),
    });
  }

  protected search(value: string): void {
    this.searchTerm.set(value);
    this.loadContacts();
  }

  protected openAddDialog(): void {
    this.clearMessage();
    this.contactForm.reset({ full_name: '', phone_number: '' });
    this.isAddOpen.set(true);
  }

  protected closeAddDialog(): void {
    if (!this.isSaving()) this.isAddOpen.set(false);
  }

  protected saveContact(): void {
    this.clearMessage();

    if (this.contactForm.invalid || this.isSaving()) {
      this.contactForm.markAllAsTouched();
      return;
    }

    this.isSaving.set(true);
    const payload = {
      ...this.contactForm.getRawValue(),
      is_active: true,
    };

    this.contactsService.createContact(payload).subscribe({
      next: () => {
        this.showMessage('Contact created.');
        this.contactForm.reset({
          full_name: '',
          phone_number: '',
        });
        this.isAddOpen.set(false);
        this.isSaving.set(false);
        this.loadContacts();
      },
      error: (error) => {
        this.showMessage(error.error?.detail ?? 'Unable to save contact.', true);
        this.isSaving.set(false);
      },
    });
  }

  protected editContact(contact: MarketingPerson): void {
    this.openMenuId.set(null);
    this.editingContact.set(contact);
    this.editForm.setValue({
      full_name: contact.full_name,
      phone_number: contact.phone_number.replace(/\D/g, ''),
      is_active: contact.is_active,
    });
  }

  protected toggleMenu(contactId: number): void {
    this.openMenuId.update((id) => id === contactId ? null : contactId);
  }

  protected onActionsClick(event: MouseEvent): void {
    if (!(event.target instanceof Element) || !event.target.closest('.contact-menu, .contact-menu-trigger')) {
      this.closeMenu();
    }
    event.stopPropagation();
  }

  protected digitsOnly(event: Event, form: 'add' | 'edit'): void {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/[^0-9]/g, '').slice(0, 15);
    input.value = digits;
    (form === 'add' ? this.contactForm : this.editForm).controls.phone_number.setValue(digits);
  }

  @HostListener('document:click')
  protected closeMenu(): void {
    this.openMenuId.set(null);
  }

  protected openDeleteDialog(contact: MarketingPerson): void {
    this.openMenuId.set(null);
    this.deleteTarget.set(contact);
  }

  protected closeDeleteDialog(): void {
    if (!this.isDeleting()) this.deleteTarget.set(null);
  }

  protected deleteContact(): void {
    const contact = this.deleteTarget();
    if (!contact || this.isDeleting()) return;
    this.isDeleting.set(true);
    this.contactsService.deleteContact(contact.id).subscribe({
      next: () => {
        if (this.selectedContact()?.id === contact.id) this.closeContactHistory();
        this.deleteTarget.set(null);
        this.isDeleting.set(false);
        this.showMessage('Contact deleted.');
        this.loadContacts();
      },
      error: (error) => {
        this.deleteTarget.set(null);
        this.isDeleting.set(false);
        this.showMessage(error.error?.detail ?? 'Unable to delete contact.', true);
      },
    });
  }

  protected openContactHistory(contact: MarketingPerson): void {
    this.closeContactHistory();
    this.selectedContact.set(contact);
    this.historyError.set('');
    this.isLoadingContactHistory.set(true);
    this.historyRequest = this.dispatchService.listFullHistory({ person_id: contact.id }).subscribe({
      next: (history) => {
        this.contactHistory.set(history);
        this.isLoadingContactHistory.set(false);
        this.scrollToLatest();
        this.loadImagePreviews(history);
      },
      error: () => {
        this.historyError.set('Unable to load contact messages. Please try again.');
        this.isLoadingContactHistory.set(false);
      },
    });
  }

  protected closeContactHistory(): void {
    this.historyRequest?.unsubscribe();
    this.previewRequests?.unsubscribe();
    Object.values(this.previewUrls()).forEach((url) => URL.revokeObjectURL(url));
    this.selectedContact.set(null);
    this.contactHistory.set([]);
    this.historySearch.set('');
    this.previewUrls.set({});
    this.previewErrors.set(new Set());
    this.expandedImage.set(null);
    this.historyError.set('');
    this.isLoadingContactHistory.set(false);
  }

  private loadImagePreviews(history: DispatchRecord[]): void {
    this.previewRequests = from(history.filter((record) => this.isImage(record))).pipe(
      mergeMap((record) => this.dispatchService.downloadFile(record.id).pipe(
        tap((blob) => {
          const url = URL.createObjectURL(blob);
          this.previewUrls.update((current) => ({ ...current, [record.id]: url }));
        }),
        catchError(() => {
          this.previewErrors.update((current) => new Set([...current, record.id]));
          return EMPTY;
        }),
      ), 4),
    ).subscribe();
  }

  protected isImage(record: DispatchRecord): boolean {
    return /\.(png|jpe?g)$/i.test(record.file_path ?? '');
  }

  protected searchHistory(value: string): void {
    this.historySearch.set(value);
    this.scrollToLatest();
  }

  private scrollToLatest(): void {
    requestAnimationFrame(() => {
      const thread = this.conversationThread()?.nativeElement;
      if (thread) thread.scrollTop = thread.scrollHeight;
    });
  }

  protected isPdf(record: DispatchRecord): boolean {
    return /\.pdf$/i.test(record.file_path ?? '');
  }

  protected contactStatus(record: DispatchRecord, contactId: number): string {
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
    const status = record.recipients.find((recipient) => recipient.person_id === contactId)?.delivery_status;
    if (status === 'sent') return 'Submitted';
    if (status === 'failed') return 'Failed';
    if (status === 'not_configured') return 'Not configured';
    return status === 'pending' ? 'Pending' : 'Recorded';
  }

  protected getInitials(name: string): string {
    return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');
  }

  protected openImage(record: DispatchRecord): void {
    const url = this.previewUrls()[record.id];
    if (url) this.expandedImage.set({ url, label: `Image sent in dispatch ${record.id}` });
  }

  protected downloadAttachment(record: DispatchRecord): void {
    this.dispatchService.downloadFile(record.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = record.original_filename || `bilty-${record.id}${this.isPdf(record) ? '.pdf' : ''}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      error: () => this.historyError.set('Unable to download this attachment.'),
    });
  }

  @HostListener('window:keydown.escape')
  protected onEscape(): void {
    if (this.expandedImage()) this.expandedImage.set(null);
    else if (this.selectedContact()) this.closeContactHistory();
    else if (this.deleteTarget()) this.closeDeleteDialog();
    else if (this.editingContact()) this.closeEditDialog();
    else if (this.isAddOpen()) this.closeAddDialog();
    else this.closeMenu();
  }

  ngOnDestroy(): void {
    this.closeContactHistory();
    this.notice.destroy();
  }

  protected updateContact(): void {
    this.clearMessage();
    const editing = this.editingContact();

    if (!editing || this.editForm.invalid || this.isSaving()) {
      this.editForm.markAllAsTouched();
      return;
    }

    this.isSaving.set(true);
    this.contactsService.updateContact(editing.id, this.editForm.getRawValue()).subscribe({
      next: () => {
        this.showMessage('Contact updated.');
        this.closeEditDialog();
        this.isSaving.set(false);
        this.loadContacts();
      },
      error: (error) => {
        this.showMessage(error.error?.detail ?? 'Unable to update contact.', true);
        this.isSaving.set(false);
      },
    });
  }

  protected setSuspendedStatus(contact: MarketingPerson): void {
    if (this.isSaving()) {
      return;
    }

    this.openMenuId.set(null);
    const isSuspended = contact.is_active;
    this.isSaving.set(true);
    this.contactsService.updateContact(contact.id, { is_active: !isSuspended }).subscribe({
      next: () => {
        this.showMessage(isSuspended ? 'Contact suspended.' : 'Contact unsuspended.');
        this.isSaving.set(false);
        this.loadContacts();
      },
      error: () => {
        this.showMessage(isSuspended ? 'Unable to suspend contact.' : 'Unable to unsuspend contact.', true);
        this.isSaving.set(false);
      },
    });
  }

  protected closeEditDialog(): void {
    this.editingContact.set(null);
    this.editForm.reset({
      full_name: '',
      phone_number: '',
      is_active: true,
    });
  }

  private showMessage(message: string, isError = false): void {
    this.notice.show(message, isError);
  }

  private clearMessage(): void {
    this.notice.clear();
  }
}
