import { Component, ElementRef, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { ReactiveFormsModule, NonNullableFormBuilder } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, Subscription, debounceTime, distinctUntilChanged } from 'rxjs';
import { CustomerDispatchService, SendMode, SendResponse } from '../../core/customer-dispatch.service';
import { Customer, CustomersService } from '../../core/customers.service';
import { ContactsService, MarketingPerson } from '../../core/contacts.service';
import { DispatchRecord, DispatchService } from '../../core/dispatch.service';
import { MessageThread } from '../../shared/message-thread/message-thread';

interface ExtraRecipient { kind: 'marketing_person' | 'customer'; id: number; name: string; phone: string; }

@Component({
  selector: 'app-dispatch',
  imports: [ReactiveFormsModule, RouterLink, MessageThread],
  templateUrl: './dispatch.html',
  styleUrl: './dispatch.css',
})
export class DispatchPage implements OnInit, OnDestroy {
  protected readonly stage = signal<'customers' | 'compose'>('customers');
  protected readonly customers = signal<Customer[]>([]);
  protected readonly selected = signal<Customer | null>(null);
  protected readonly searchTerm = signal('');
  protected readonly page = signal(1);
  protected readonly total = signal(0);
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / 20)));
  protected readonly firstVisible = computed(() => this.total() ? (this.page() - 1) * 20 + 1 : 0);
  protected readonly lastVisible = computed(() => Math.min(this.page() * 20, this.total()));
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly mode = signal<SendMode | null>(null);
  protected readonly includeCustomer = signal(false);
  protected readonly draftIncludeCustomer = signal(false);
  protected readonly selectedFile = signal<File | null>(null);
  protected readonly selectedImageUrl = signal<string | null>(null);
  protected readonly isImagePreviewOpen = signal(false);
  protected readonly sending = signal(false);
  protected readonly lastSend = signal<SendResponse | null>(null);
  protected readonly threadRecords = signal<DispatchRecord[]>([]);
  protected readonly threadSearch = signal('');
  protected readonly threadScrollToLatest = signal(true);
  protected readonly threadLoading = signal(false);
  protected readonly threadError = signal('');
  protected readonly extraRecipients = signal<ExtraRecipient[]>([]);
  protected readonly draftExtraRecipients = signal<ExtraRecipient[]>([]);
  protected readonly pickerOpen = signal(false);
  protected readonly pickerTab = signal<'marketing_person' | 'customer'>('marketing_person');
  protected readonly pickerSearch = signal('');
  protected readonly pickerPage = signal(1);
  protected readonly pickerTotal = signal(0);
  protected readonly pickerCustomers = signal<Customer[]>([]);
  protected readonly pickerMarketingPersons = signal<MarketingPerson[]>([]);
  protected readonly pickerLoading = signal(false);
  protected readonly pickerError = signal('');
  protected readonly pickerPageCount = computed(() => Math.max(1, Math.ceil(this.pickerTotal() / 20)));
  protected readonly filteredPickerPeople = computed(() => this.pickerMarketingPersons().filter((person) =>
    person.full_name.toLowerCase().includes(this.pickerSearch().trim().toLowerCase()) || person.phone_number.includes(this.pickerSearch().trim())
  ));
  protected readonly recipientCount = computed(() => 1 + Number(this.includeCustomer()) + this.extraRecipients().length);
  protected readonly draftRecipientCount = computed(() => 1 + Number(this.draftIncludeCustomer()) + this.draftExtraRecipients().length);
  protected readonly canCopy = computed(() => this.mode()?.mode === 'test'
    ? !!this.mode()?.customer_test_recipient
    : this.mode()?.mode === 'live' && !!this.selected()?.phone_number);
  private readonly customerService = inject(CustomersService);
  private readonly contactsService = inject(ContactsService);
  private readonly dispatchService = inject(CustomerDispatchService);
  private readonly historyService = inject(DispatchService);
  private readonly builder = inject(NonNullableFormBuilder);
  private readonly searchInput = new Subject<string>();
  private readonly pickerSearchInput = new Subject<string>();
  private readonly messageInput = viewChild<ElementRef<HTMLTextAreaElement>>('messageInput');
  private searchSubscription?: Subscription;
  private listSubscription?: Subscription;
  private pickerSearchSubscription?: Subscription;
  private pickerListSubscription?: Subscription;
  private threadSubscription?: Subscription;
  protected readonly form = this.builder.group({ message_text: [''] });

  ngOnInit(): void {
    this.searchSubscription = this.searchInput.pipe(debounceTime(250), distinctUntilChanged()).subscribe((value) => {
      this.searchTerm.set(value); this.page.set(1); this.load();
    });
    this.pickerSearchSubscription = this.pickerSearchInput.pipe(debounceTime(250), distinctUntilChanged()).subscribe((value) => {
      this.pickerSearch.set(value); this.pickerPage.set(1); if (this.pickerTab() === 'customer') this.loadPickerCustomers();
    });
    this.dispatchService.mode().subscribe({
      next: (mode) => this.mode.set(mode),
      error: () => this.error.set('Unable to load WhatsApp send mode.'),
    });
    this.load();
  }

  protected search(value: string): void { this.searchInput.next(value); }

  protected load(): void {
    this.listSubscription?.unsubscribe();
    this.loading.set(true);
    this.listSubscription = this.customerService.list(this.searchTerm(), this.page(), 20).subscribe({
      next: (result) => {
        const lastPage = Math.max(1, Math.ceil(result.total / 20));
        if (this.page() > lastPage) {
          this.page.set(lastPage);
          this.load();
          return;
        }
        this.customers.set(result.items); this.total.set(result.total); this.loading.set(false);
        if (this.error() === 'Unable to load customers.') this.error.set('');
      },
      error: () => { this.error.set('Unable to load customers.'); this.loading.set(false); },
    });
  }

  protected changePage(delta: number): void {
    const next = this.page() + delta;
    if (next < 1 || next > this.pageCount() || this.loading()) return;
    this.page.set(next);
    this.load();
  }

  protected choose(customer: Customer): void {
    this.selected.set(customer);
    if (this.error() !== 'Unable to load WhatsApp send mode.') this.error.set('');
    this.includeCustomer.set(false);
    this.extraRecipients.set([]);
    this.lastSend.set(null);
    this.threadRecords.set([]); this.threadSearch.set(''); this.threadScrollToLatest.set(true);
    this.stage.set('compose');
    this.loadThread();
  }

  protected back(): void { if (!this.sending()) { this.closePicker(); this.threadSubscription?.unsubscribe(); this.stage.set('customers'); } }

  private loadThread(): void {
    const customer = this.selected();
    if (!customer) return;
    this.threadSubscription?.unsubscribe();
    this.threadError.set('');
    this.threadLoading.set(true);
    this.threadSubscription = this.historyService.listFullHistory({ customer_id: customer.id }).subscribe({
      next: (records) => { this.threadRecords.set(records); this.threadLoading.set(false); },
      error: () => { this.threadError.set('Unable to load previous messages.'); this.threadLoading.set(false); },
    });
  }

  protected openPicker(): void {
    this.draftIncludeCustomer.set(this.includeCustomer());
    this.draftExtraRecipients.set([...this.extraRecipients()]);
    this.pickerOpen.set(true);
    this.pickerError.set('');
    if (!this.pickerMarketingPersons().length) this.contactsService.listContacts('', false).subscribe({
      next: (people) => this.pickerMarketingPersons.set(people),
      error: () => this.pickerError.set('Unable to load marketing persons.'),
    });
    this.loadPickerCustomers();
  }

  protected closePicker(): void {
    this.pickerOpen.set(false);
    this.draftIncludeCustomer.set(this.includeCustomer());
    this.draftExtraRecipients.set([...this.extraRecipients()]);
  }

  protected confirmPicker(): void {
    this.includeCustomer.set(this.draftIncludeCustomer());
    this.extraRecipients.set([...this.draftExtraRecipients()]);
    this.pickerOpen.set(false);
  }

  protected setPickerTab(tab: 'marketing_person' | 'customer'): void {
    this.pickerTab.set(tab); this.pickerSearch.set(''); this.pickerPage.set(1);
    if (tab === 'customer') this.loadPickerCustomers();
  }

  protected searchPicker(value: string): void {
    this.pickerSearch.set(value);
    this.pickerSearchInput.next(value);
  }

  protected loadPickerCustomers(): void {
    this.pickerListSubscription?.unsubscribe();
    this.pickerLoading.set(true); this.pickerError.set('');
    this.pickerListSubscription = this.customerService.list(this.pickerSearch(), this.pickerPage(), 20).subscribe({
      next: (result) => { this.pickerCustomers.set(result.items); this.pickerTotal.set(result.total); this.pickerLoading.set(false); },
      error: () => { this.pickerError.set('Unable to load customers.'); this.pickerLoading.set(false); },
    });
  }

  protected changePickerPage(delta: number): void {
    const next = this.pickerPage() + delta;
    if (next < 1 || next > this.pickerPageCount() || this.pickerLoading()) return;
    this.pickerPage.set(next); this.loadPickerCustomers();
  }

  protected selectedExtra(kind: ExtraRecipient['kind'], id: number): boolean {
    return this.draftExtraRecipients().some((item) => item.kind === kind && item.id === id);
  }

  protected toggleDraftExtra(recipient: ExtraRecipient): void {
    if (this.selectedExtra(recipient.kind, recipient.id)) {
      this.draftExtraRecipients.update((items) => items.filter((item) => !(item.kind === recipient.kind && item.id === recipient.id)));
    } else if (this.draftExtraRecipients().length < 25) {
      this.draftExtraRecipients.update((items) => [...items, recipient]);
    }
  }

  protected removeExtra(recipient: ExtraRecipient): void {
    this.extraRecipients.update((items) => items.filter((item) => !(item.kind === recipient.kind && item.id === recipient.id)));
  }

  protected toggleMainCustomer(): void { if (this.canCopy()) this.includeCustomer.update((value) => !value); }

  protected toggleDraftMainCustomer(): void { if (this.canCopy()) this.draftIncludeCustomer.update((value) => !value); }

  protected setFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    input.value = '';
    if (!file) return;
    const valid = (/\.jpe?g$/i.test(file.name) && file.type === 'image/jpeg') ||
      (/\.png$/i.test(file.name) && file.type === 'image/png') ||
      (/\.pdf$/i.test(file.name) && file.type === 'application/pdf');
    if (!valid) { this.error.set('Choose a JPG, PNG, or PDF file.'); return; }
    const limit = file.type === 'application/pdf' ? 100 : 5;
    if (file.size > limit * 1024 * 1024) { this.error.set(`File exceeds ${limit} MB.`); return; }
    this.removeFile();
    this.error.set('');
    this.selectedFile.set(file);
    if (file.type.startsWith('image/')) this.selectedImageUrl.set(URL.createObjectURL(file));
  }

  protected removeFile(): void {
    const url = this.selectedImageUrl();
    if (url) URL.revokeObjectURL(url);
    this.selectedImageUrl.set(null);
    this.selectedFile.set(null);
    this.isImagePreviewOpen.set(false);
  }

  protected resizeMessageInput(input: HTMLTextAreaElement): void {
    input.style.height = 'auto';
    const height = Math.min(Math.max(input.scrollHeight, 44), 184);
    input.style.height = `${height}px`;
    input.style.overflowY = input.scrollHeight > 184 ? 'auto' : 'hidden';
  }

  protected send(): void {
    const customer = this.selected();
    const message = this.form.getRawValue().message_text.trim();
    const file = this.selectedFile();
    if (!customer || this.sending() || (!message && !file)) return;
    if (file && message.length > 1024) { this.error.set('A file caption can contain up to 1024 characters.'); return; }
    this.error.set(''); this.lastSend.set(null); this.sending.set(true);
    this.dispatchService.send(customer.id, this.includeCustomer(), message, file,
      this.extraRecipients().filter((item) => item.kind === 'marketing_person').map((item) => item.id),
      this.extraRecipients().filter((item) => item.kind === 'customer').map((item) => item.id)).subscribe({
      next: (result) => {
        this.lastSend.set(result);
        this.sending.set(false);
        this.threadSearch.set('');
        this.threadScrollToLatest.set(true);
        this.loadThread();
        this.form.reset({ message_text: '' });
        this.removeFile();
        const input = this.messageInput()?.nativeElement;
        if (input) this.resizeMessageInput(input);
      },
      error: (response) => {
        this.error.set(typeof response.error?.detail === 'string' ? response.error.detail : 'Unable to send dispatch.');
        this.sending.set(false);
      },
    });
  }

  ngOnDestroy(): void {
    this.listSubscription?.unsubscribe();
    this.searchSubscription?.unsubscribe();
    this.pickerSearchSubscription?.unsubscribe();
    this.pickerListSubscription?.unsubscribe();
    this.threadSubscription?.unsubscribe();
    this.removeFile();
  }
}
