import { Component, ElementRef, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ReactiveFormsModule, NonNullableFormBuilder } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, Subscription, debounceTime, distinctUntilChanged } from 'rxjs';
import { CustomerDispatchService, SendMode, SendResponse } from '../../core/customer-dispatch.service';
import { Customer, CustomersService } from '../../core/customers.service';
import { ContactsService, MarketingPerson } from '../../core/contacts.service';
import { DispatchRecord, DispatchService } from '../../core/dispatch.service';
import { MessageThread } from '../../shared/message-thread/message-thread';
import { ScannerDevice, ScannerService, scannedPagesToPdf, scannedPageToPng } from '../../core/scanner.service';

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
  protected readonly selectedFiles = signal<File[]>([]);
  protected readonly selectedFile = computed(() => this.selectedFiles()[0] ?? null);
  protected readonly attachmentResults = signal<{ filename: string; result: SendResponse }[]>([]);
  protected readonly selectedImageUrl = signal<string | null>(null);
  protected readonly isImagePreviewOpen = signal(false);
  protected readonly previewUrl = signal<string | null>(null);
  protected readonly previewPdfUrl = signal<SafeResourceUrl | null>(null);
  protected readonly previewName = signal('');
  protected readonly attachmentMenuOpen = signal(false);
  protected readonly scanHelpOpen = signal(false);
  protected readonly scanDevices = signal<ScannerDevice[]>([]);
  protected readonly scanDeviceId = signal('');
  protected readonly scanPages = signal<File[]>([]);
  protected readonly scanBusy = signal(false);
  protected readonly scanError = signal('');
  protected readonly scanFormat = signal<'pdf' | 'jpeg' | 'png'>('pdf');
  private scanGeneration = 0;
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
  private readonly sanitizer = inject(DomSanitizer);
  private readonly scanner = inject(ScannerService);
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
    this.lastSend.set(null); this.attachmentResults.set([]);
    this.threadRecords.set([]); this.threadSearch.set(''); this.threadScrollToLatest.set(true);
    this.stage.set('compose');
    this.loadThread();
  }

  protected back(): void { if (!this.sending()) { this.closeScanner(); this.clearFiles(); this.form.reset({ message_text: '' }); this.closePicker(); this.threadSubscription?.unsubscribe(); this.stage.set('customers'); } }

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
    const files = Array.from(input.files || []);
    input.value = '';
    this.addFiles(files);
  }

  private addFiles(files: File[]): boolean {
    if (!files.length) return false;
    for (const file of files) {
      const valid = (/\.jpe?g$/i.test(file.name) && file.type === 'image/jpeg') ||
        (/\.png$/i.test(file.name) && file.type === 'image/png') ||
        (/\.pdf$/i.test(file.name) && file.type === 'application/pdf');
      if (!valid) { this.error.set('Choose JPG, PNG, or PDF files.'); return false; }
      const limit = file.type === 'application/pdf' ? 100 : 5;
      if (file.size > limit * 1024 * 1024) { this.error.set(`${file.name} exceeds ${limit} MB.`); return false; }
    }
    if (this.selectedFiles().length + files.length > 20) { this.error.set('Choose up to 20 attachments.'); return false; }
    this.selectedFiles.update((current) => [...current, ...files]);
    this.error.set('');
    if (this.selectedFiles().length === files.length) this.updateImagePreview();
    return true;
  }

  protected openScanner(): void {
    this.attachmentMenuOpen.set(false); this.scanHelpOpen.set(true); this.scanError.set('');
  }

  protected closeScanner(): void {
    this.scanGeneration++; this.scanHelpOpen.set(false); this.scanBusy.set(false);
    this.scanPages.set([]); this.scanDevices.set([]); this.scanDeviceId.set(''); this.scanError.set('');
  }

  protected async findScanners(): Promise<void> {
    const generation = this.scanGeneration;
    this.scanBusy.set(true); this.scanError.set('');
    try {
      const devices = await this.scanner.devices();
      if (generation !== this.scanGeneration) return;
      this.scanDevices.set(devices); this.scanDeviceId.set(devices[0]?.id || '');
      if (!devices.length) this.scanError.set('No scanners found. Check the Windows scanner driver and connection.');
    } catch (error) {
      if (generation === this.scanGeneration) this.scanError.set(error instanceof Error ? error.message : 'Unable to find scanners.');
    } finally { if (generation === this.scanGeneration) this.scanBusy.set(false); }
  }

  protected async scanPage(): Promise<void> {
    if (!this.scanDeviceId() || this.scanBusy()) return;
    if (this.scanPages().length >= 20) { this.scanError.set('A scan can contain up to 20 pages.'); return; }
    const generation = this.scanGeneration;
    this.scanBusy.set(true); this.scanError.set('');
    try {
      const page = await this.scanner.scan(this.scanDeviceId());
      if (generation === this.scanGeneration) this.scanPages.update((pages) => [...pages, page]);
    } catch (error) {
      if (generation === this.scanGeneration) this.scanError.set(error instanceof Error ? error.message : 'Unable to scan the page.');
    } finally { if (generation === this.scanGeneration) this.scanBusy.set(false); }
  }

  protected removeScannedPage(index: number): void {
    this.scanPages.update((pages) => pages.filter((_, i) => i !== index));
    this.closePreview();
  }

  protected async addScannedPages(): Promise<void> {
    if (!this.scanPages().length || this.scanBusy()) return;
    const generation = this.scanGeneration;
    this.scanBusy.set(true); this.scanError.set('');
    try {
      const pages = this.scanPages();
      const files = this.scanFormat() === 'pdf' ? [await scannedPagesToPdf(pages)] :
        this.scanFormat() === 'png' ? await Promise.all(pages.map(scannedPageToPng)) : pages;
      if (generation !== this.scanGeneration) return;
      if (this.addFiles(files)) this.closeScanner();
      else this.scanError.set(this.error());
    } catch {
      if (generation === this.scanGeneration) this.scanError.set('Could not prepare the scanned document. Try again or choose JPEG.');
    } finally { if (generation === this.scanGeneration) this.scanBusy.set(false); }
  }

  private updateImagePreview(): void {
    const previous = this.selectedImageUrl();
    if (previous) URL.revokeObjectURL(previous);
    const file = this.selectedFile();
    this.selectedImageUrl.set(file?.type.startsWith('image/') ? URL.createObjectURL(file) : null);
    this.closePreview();
  }

  protected previewFile(file: File): void {
    this.closePreview();
    const url = URL.createObjectURL(file);
    this.previewUrl.set(url);
    this.previewName.set(file.name);
    this.previewPdfUrl.set(file.type === 'application/pdf' ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null);
    this.isImagePreviewOpen.set(true);
  }

  protected closePreview(): void {
    const url = this.previewUrl();
    if (url) URL.revokeObjectURL(url);
    this.previewUrl.set(null); this.previewPdfUrl.set(null); this.isImagePreviewOpen.set(false);
  }

  protected removeFile(index = 0): void {
    this.selectedFiles.update((files) => files.filter((_, i) => i !== index));
    if (index === 0) this.updateImagePreview();
    else this.closePreview();
  }

  private clearFiles(): void {
    this.selectedFiles.set([]);
    this.updateImagePreview();
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
    const files = [...this.selectedFiles()];
    if (!customer || this.sending() || (!message && !files.length)) return;
    if (files.length && message.length > 1024) { this.error.set('A file caption can contain up to 1024 characters.'); return; }
    this.error.set(''); this.lastSend.set(null); this.attachmentResults.set([]); this.sending.set(true);
    const marketingIds = this.extraRecipients().filter((item) => item.kind === 'marketing_person').map((item) => item.id);
    const customerIds = this.extraRecipients().filter((item) => item.kind === 'customer').map((item) => item.id);
    const sendNext = (index: number): void => {
      const file = files[index] ?? null;
      this.dispatchService.send(customer.id, this.includeCustomer(), index === 0 ? message : '', file, marketingIds, customerIds).subscribe({
        next: (result) => {
          this.lastSend.set(result);
          if (file) {
            this.attachmentResults.update((items) => [...items, { filename: file.name, result }]);
            this.removeFile();
          }
          if (index === 0) this.form.reset({ message_text: '' });
          this.threadSearch.set(''); this.threadScrollToLatest.set(true); this.loadThread();
          const input = this.messageInput()?.nativeElement;
          if (input) this.resizeMessageInput(input);
          if (result.results.some((item) => item.status !== 'accepted')) {
            this.error.set('Sending stopped. Check each recipient result before retrying; some may already have received the attachment.');
            this.sending.set(false);
          } else if (index + 1 < files.length) {
            sendNext(index + 1);
          } else {
            this.sending.set(false);
          }
        },
        error: (response) => {
          const detail = typeof response.error?.detail === 'string' ? response.error.detail : 'Unable to confirm the dispatch result.';
          this.error.set(`${detail} Sending stopped. Check dispatch history and WhatsApp before retrying; the current attachment may have been sent. It remains in the draft; do not retry until you check.`);
          this.sending.set(false); this.loadThread();
        },
      });
    };
    sendNext(0);
  }

  ngOnDestroy(): void {
    this.closeScanner();
    this.listSubscription?.unsubscribe();
    this.searchSubscription?.unsubscribe();
    this.pickerSearchSubscription?.unsubscribe();
    this.pickerListSubscription?.unsubscribe();
    this.threadSubscription?.unsubscribe();
    this.clearFiles();
  }
}
