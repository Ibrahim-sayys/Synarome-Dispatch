import { DatePipe } from '@angular/common';
import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ContactsService, MarketingPerson } from '../../core/contacts.service';
import { WhatsAppService } from '../../core/whatsapp.service';

interface SessionMessage {
  messageId: string;
  recordId: number;
  text: string;
  attachmentName: string | null;
  attachmentUrl: string | null;
  isImage: boolean;
  time: Date;
}

@Component({
  selector: 'app-dispatch',
  imports: [DatePipe, ReactiveFormsModule, RouterLink],
  templateUrl: './dispatch.html',
  styleUrl: './dispatch.css',
})
export class DispatchPage implements OnInit, OnDestroy {
  protected readonly stage = signal<'contacts' | 'compose'>('contacts');
  protected readonly contacts = signal<MarketingPerson[]>([]);
  protected readonly isLoadingContacts = signal(false);
  protected readonly contactsError = signal('');
  protected readonly contactSearch = signal('');
  protected readonly selectedRecipientIds = signal<Set<number>>(new Set());
  protected readonly selectedCount = computed(() => this.selectedRecipientIds().size);
  protected readonly filteredContacts = computed(() => {
    const term = this.contactSearch().trim().toLowerCase();
    return term ? this.contacts().filter((contact) =>
      contact.full_name.toLowerCase().includes(term) || contact.phone_number.includes(term),
    ) : this.contacts();
  });
  protected readonly selectedContacts = computed(() =>
    this.contacts().filter((contact) => this.selectedRecipientIds().has(contact.id)),
  );
  protected readonly allContactsSelected = computed(() => {
    const contacts = this.contacts();
    return contacts.length > 0 && contacts.every((contact) => this.selectedRecipientIds().has(contact.id));
  });
  protected readonly isSending = signal(false);
  protected readonly error = signal('');
  protected readonly selectedFile = signal<File | null>(null);
  protected readonly selectedAttachmentUrl = signal<string | null>(null);
  protected readonly selectedFileIsImage = computed(() => this.selectedFile()?.type.startsWith('image/') ?? false);
  protected readonly sessionMessages = signal<SessionMessage[]>([]);
  protected readonly enlargedImage = signal<{ url: string; name: string } | null>(null);

  private readonly contactsService = inject(ContactsService);
  private readonly whatsappService = inject(WhatsAppService);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly chatThread = viewChild<ElementRef<HTMLDivElement>>('chatThread');
  private readonly messageInput = viewChild<ElementRef<HTMLTextAreaElement>>('messageInput');
  private contactsRequest?: Subscription;

  protected readonly dispatchForm = this.formBuilder.group({ message_text: [''] });

  ngOnInit(): void {
    this.loadContacts();
  }

  protected loadContacts(): void {
    this.contactsRequest?.unsubscribe();
    this.isLoadingContacts.set(true);
    this.contactsError.set('');
    this.contactsRequest = this.contactsService.listContacts('', false).subscribe({
      next: (contacts) => {
        this.contacts.set(contacts);
        const validIds = new Set(contacts.map((contact) => contact.id));
        const selected = this.selectedRecipientIds();
        if ([...selected].some((id) => !validIds.has(id))) {
          this.selectedRecipientIds.set(new Set([...selected].filter((id) => validIds.has(id))));
          this.clearSessionMessages();
        }
        this.isLoadingContacts.set(false);
      },
      error: () => {
        this.contactsError.set('Unable to load contacts.');
        this.isLoadingContacts.set(false);
      },
    });
  }

  protected toggleRecipient(contactId: number, checked: boolean): void {
    const next = new Set(this.selectedRecipientIds());
    if (checked) next.add(contactId);
    else next.delete(contactId);
    this.selectedRecipientIds.set(next);
    this.clearSessionMessages();
  }

  protected selectAllContacts(): void {
    const next = new Set(this.selectedRecipientIds());
    this.contacts().forEach((contact) => next.add(contact.id));
    this.selectedRecipientIds.set(next);
    this.clearSessionMessages();
  }

  protected clearRecipients(): void {
    this.selectedRecipientIds.set(new Set());
    this.clearSessionMessages();
  }

  protected continueToMessage(): void {
    if (!this.selectedCount()) return;
    this.stage.set('compose');
    this.scrollToLatest();
  }

  protected backToContacts(): void {
    if (!this.isSending()) this.stage.set('contacts');
  }

  private clearSessionMessages(): void {
    this.enlargedImage.set(null);
    this.sessionMessages().forEach((message) => {
      if (message.attachmentUrl) URL.revokeObjectURL(message.attachmentUrl);
    });
    this.sessionMessages.set([]);
  }

  protected setFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    this.removeFile();
    if (!file) return;

    const isJpeg = /\.jpe?g$/i.test(file.name) && file.type === 'image/jpeg';
    const isPng = /\.png$/i.test(file.name) && file.type === 'image/png';
    const isPdf = /\.pdf$/i.test(file.name) && file.type === 'application/pdf';
    if (!isJpeg && !isPng && !isPdf) {
      this.error.set('Choose a JPG, PNG, or PDF file.');
      return;
    }
    const limit = isPdf ? 100 : 5;
    if (file.size > limit * 1024 * 1024) {
      this.error.set(`This file exceeds the ${limit} MB limit.`);
      return;
    }
    this.error.set('');
    this.selectedFile.set(file);
    this.selectedAttachmentUrl.set(URL.createObjectURL(file));
  }

  protected removeFile(): void {
    const url = this.selectedAttachmentUrl();
    if (url) URL.revokeObjectURL(url);
    this.selectedFile.set(null);
    this.selectedAttachmentUrl.set(null);
  }

  protected handleEnter(event: Event): void {
    const keyboard = event as KeyboardEvent;
    if (keyboard.shiftKey || keyboard.isComposing) return;
    event.preventDefault();
    this.sendMessage();
  }

  protected resizeMessageInput(input?: HTMLTextAreaElement): void {
    if (!input) return;
    input.style.height = 'auto';
    const contentHeight = input.scrollHeight;
    input.style.height = `${Math.min(Math.max(contentHeight, 36), 170)}px`;
    input.style.overflowY = contentHeight > 170 ? 'auto' : 'hidden';
  }

  protected sendMessage(): void {
    if (this.isSending() || this.stage() !== 'compose' || !this.selectedCount()) return;
    const text = this.dispatchForm.getRawValue().message_text.trim();
    const file = this.selectedFile();
    if (!text && !file) return;
    if (file && text.length > 1024) {
      this.error.set('A file caption can contain up to 1024 characters.');
      return;
    }

    this.error.set('');
    this.isSending.set(true);
    this.whatsappService.send(text, file, [...this.selectedRecipientIds()]).subscribe({
      next: (result) => {
        this.sessionMessages.update((current) => [...current, {
          messageId: result.message_id,
          recordId: result.record_id,
          text,
          attachmentName: file?.name ?? null,
          attachmentUrl: this.selectedAttachmentUrl(),
          isImage: !!file?.type.startsWith('image/'),
          time: new Date(),
        }]);
        this.selectedFile.set(null);
        this.selectedAttachmentUrl.set(null);
        this.dispatchForm.reset({ message_text: '' });
        this.resizeMessageInput(this.messageInput()?.nativeElement);
        this.isSending.set(false);
        this.scrollToLatest();
      },
      error: (response) => {
        const detail = response.error?.detail;
        this.error.set(typeof detail === 'string' ? detail : 'Unable to send the test message.');
        this.isSending.set(false);
      },
    });
  }

  protected formatFileSize(bytes: number): string {
    return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private scrollToLatest(): void {
    requestAnimationFrame(() => {
      const thread = this.chatThread()?.nativeElement;
      if (thread) thread.scrollTop = thread.scrollHeight;
    });
  }

  @HostListener('window:keydown.escape')
  protected onEscape(): void {
    if (this.enlargedImage()) this.enlargedImage.set(null);
  }

  ngOnDestroy(): void {
    this.contactsRequest?.unsubscribe();
    this.removeFile();
    this.clearSessionMessages();
  }
}
