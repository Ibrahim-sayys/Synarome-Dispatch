import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { ReactiveFormsModule, NonNullableFormBuilder } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, Subscription, debounceTime, distinctUntilChanged, concat, of, interval, switchMap, catchError, EMPTY } from 'rxjs';
import { CustomerDispatchService, SendMode, SendResponse, WindowStatus } from '../../core/customer-dispatch.service';
import { Customer, CustomersService } from '../../core/customers.service';
import { ContactsService, MarketingPerson } from '../../core/contacts.service';
import { DispatchRecord, DispatchService } from '../../core/dispatch.service';
import { MessageThread } from '../../shared/message-thread/message-thread';
import { ScannerDevice, ScannerService, cropBounds, scanFileName, scannedPagesToPdf, scannedPageToPng } from '../../core/scanner.service';

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
  protected readonly windowStatus = signal<WindowStatus | null>(null);
  protected readonly windowError = signal('');
  protected readonly includeCustomer = signal(false);
  protected readonly draftIncludeCustomer = signal(false);
  protected readonly selectedFiles = signal<File[]>([]);
  protected readonly selectedFile = computed(() => this.selectedFiles()[0] ?? null);
  protected readonly attachmentResults = signal<{ filename: string; result: SendResponse }[]>([]);
  protected readonly selectedImageUrl = signal<string | null>(null);
  protected readonly isImagePreviewOpen = signal(false);
  protected readonly previewUrl = signal<string | null>(null);
  protected readonly previewName = signal('');
  protected readonly attachmentMenuOpen = signal(false);
  protected readonly scanHelpOpen = signal(false);
  protected readonly scanDevices = signal<ScannerDevice[]>([]);
  protected readonly scanDeviceId = signal('');
  protected readonly scanPages = signal<File[]>([]);
  protected readonly scanBusy = signal(false);
  protected readonly scanError = signal('');
  protected readonly editingPage = signal<number | null>(null);
  protected readonly previewZoom = signal(100);
  protected readonly previewAspect = signal(1);
  protected readonly previewRotation = signal(0);
  protected readonly rotatedAspect = computed(() => this.previewRotation() % 180 ? 1 / this.previewAspect() : this.previewAspect());
  protected readonly panning = signal(false);
  private panDrag: { pointerId: number; x: number; y: number; left: number; top: number } | null = null;
  protected readonly cropLeft = signal(0);
  protected readonly cropRight = signal(0);
  protected readonly cropTop = signal(0);
  protected readonly cropBottom = signal(0);
  protected readonly visibleCrop = signal({ left: 0, right: 0, top: 0, bottom: 0 });
  protected readonly cropError = signal('');
  protected readonly cropHandles = [
    { name: 'top', label: 'top edge' }, { name: 'right', label: 'right edge' },
    { name: 'bottom', label: 'bottom edge' }, { name: 'left', label: 'left edge' },
    { name: 'top-left', label: 'top left corner' }, { name: 'top-right', label: 'top right corner' },
    { name: 'bottom-left', label: 'bottom left corner' }, { name: 'bottom-right', label: 'bottom right corner' },
  ];
  private cropDrag: { pointerId: number; edge: string; x: number; y: number; width: number; height: number; left: number; right: number; top: number; bottom: number } | null = null;

  protected readonly scanFormat = signal<'pdf' | 'jpeg' | 'png'>('pdf');
  private scanGeneration = 0;
  protected readonly sending = signal(false);
  protected readonly lastSend = signal<SendResponse | null>(null);
  protected readonly threadRecords = signal<DispatchRecord[]>([]);
  protected readonly threadSearch = signal('');
  protected readonly threadSearchOpen = signal(false);
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
  private readonly scanner = inject(ScannerService);
  private readonly searchInput = new Subject<string>();
  private readonly pickerSearchInput = new Subject<string>();
  private readonly messageInput = viewChild<ElementRef<HTMLTextAreaElement>>('messageInput');
  private readonly attachmentButton = viewChild<ElementRef<HTMLButtonElement>>('attachmentButton');
  private readonly attachmentMenu = viewChild<ElementRef<HTMLElement>>('attachmentMenu');
  private searchSubscription?: Subscription;
  private listSubscription?: Subscription;
  private pickerSearchSubscription?: Subscription;
  private pickerListSubscription?: Subscription;
  private threadSubscription?: Subscription;
  protected readonly form = this.builder.group({ message_text: [''] });

  constructor() {
    effect((onCleanup) => {
      const customer = this.selected();
      const mode = this.mode();
      const stage = this.stage();
      const include = this.includeCustomer();
      const extra = this.extraRecipients();
      this.windowStatus.set(null);
      this.windowError.set('');
      if (!customer || !mode || stage !== 'compose') return;
      const marketing = extra.filter((item) => item.kind === 'marketing_person').map((item) => item.id);
      const customers = extra.filter((item) => item.kind === 'customer').map((item) => item.id);
      const request = concat(of(0), interval(15000)).pipe(switchMap(() => this.dispatchService.windowStatus(customer.id, include, marketing, customers).pipe(catchError(() => {
        this.windowStatus.set(null); this.windowError.set('Unable to check the 24-hour reply window.'); return EMPTY;
      })))).subscribe({
        next: (status) => { this.windowStatus.set(status); this.windowError.set(''); },
        error: () => { this.windowStatus.set(null); this.windowError.set('Unable to check the 24-hour reply window.'); },
      });
      onCleanup(() => request.unsubscribe());
    });
  }

  @HostListener('document:click', ['$event'])
  protected closeAttachmentMenuOnOutsideClick(event: MouseEvent): void {
    const target = event.target;
    if (this.attachmentMenuOpen() && target instanceof Node &&
        !this.attachmentButton()?.nativeElement.contains(target) && !this.attachmentMenu()?.nativeElement.contains(target)) {
      this.attachmentMenuOpen.set(false);
    }
  }

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
    this.threadSubscription = concat(of(0), interval(15000)).pipe(
      switchMap(() => this.historyService.listFullHistory({ customer_id: customer.id }).pipe(
        catchError(() => { this.threadError.set('Unable to load previous messages.'); this.threadLoading.set(false); return EMPTY; }),
      )),
    ).subscribe({
      next: (records) => { if (JSON.stringify(records) !== JSON.stringify(this.threadRecords())) this.threadRecords.set(records); this.threadLoading.set(false); this.threadError.set(''); },
    });
  }

  protected hasSendIssues(result: SendResponse): boolean {
    return result.results.some((item) => item.status !== 'accepted');
  }

  protected onRetryCompleted(): void {
    this.lastSend.set(null);
    this.attachmentResults.set([]);
    this.loadThread();
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
    void this.findScanners();
  }

  protected closeScanner(): void {
    this.scanGeneration++; this.scanHelpOpen.set(false); this.scanBusy.set(false);
    this.closePreview(); this.scanPages.set([]); this.scanDevices.set([]); this.scanDeviceId.set(''); this.scanError.set('');
  }

  protected async findScanners(): Promise<void> {
    const generation = this.scanGeneration;
    this.scanBusy.set(true); this.scanError.set('');
    try {
      const devices = await this.scanner.devices();
      if (generation !== this.scanGeneration) return;
      const selected = devices.some((device) => device.id === this.scanDeviceId()) ? this.scanDeviceId() : devices[0]?.id || '';
      this.scanDevices.set(devices); this.scanDeviceId.set(selected);
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
      if (generation === this.scanGeneration) this.scanPages.update((pages) => [...pages, new File([page], scanFileName('jpg', pages.length + 1), { type: 'image/jpeg' })]);
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
    if (file.type === 'application/pdf') {
      window.open(url, '_blank', 'noopener');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return;
    }
    this.previewUrl.set(url);
    this.previewName.set(file.name);
    this.isImagePreviewOpen.set(true);
  }

  protected previewScanPage(index: number): void {
    const page = this.scanPages()[index];
    if (!page) return;
    this.previewFile(page);
    this.editingPage.set(index);
    this.previewName.set(`Page ${index + 1}`);
    this.resetCrop();
  }

  protected imageLoaded(event: Event): void {
    const image = event.target as HTMLImageElement;
    if (image.naturalWidth && image.naturalHeight) this.previewAspect.set(image.naturalWidth / image.naturalHeight);
  }

  protected rotatePreview(direction: -1 | 1): void {
    const left = this.cropLeft(), right = this.cropRight(), top = this.cropTop(), bottom = this.cropBottom();
    this.previewRotation.update((rotation) => (rotation + direction * 90 + 360) % 360);
    if (direction === 1) {
      this.cropLeft.set(bottom); this.cropRight.set(top); this.cropTop.set(left); this.cropBottom.set(right);
    } else {
      this.cropLeft.set(top); this.cropRight.set(bottom); this.cropTop.set(right); this.cropBottom.set(left);
    }
    this.updateVisibleCrop();
  }

  protected adjustZoom(amount: number): void {
    this.previewZoom.update((zoom) => Math.max(100, Math.min(300, zoom + amount)));
  }

  protected startPan(event: PointerEvent): void {
    if (this.previewZoom() <= 100 || event.button !== 0 || (event.target as Element).closest('.crop-handle')) return;
    const viewport = event.currentTarget as HTMLElement;
    this.panDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId);
    this.panning.set(true);
    event.preventDefault();
  }

  protected movePan(event: PointerEvent): void {
    const drag = this.panDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const viewport = event.currentTarget as HTMLElement;
    viewport.scrollLeft = drag.left - (event.clientX - drag.x);
    viewport.scrollTop = drag.top - (event.clientY - drag.y);
  }

  protected endPan(event: PointerEvent): void {
    if (this.panDrag?.pointerId === event.pointerId) { this.panDrag = null; this.panning.set(false); }
  }

  protected startCropDrag(event: PointerEvent, edge: string): void {
    if (this.scanBusy() || event.button !== 0) return;
    const handle = event.currentTarget as HTMLElement;
    const image = handle.closest('.scan-editor-image');
    if (!image) return;
    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    event.preventDefault();
    this.cropDrag = { pointerId: event.pointerId, edge, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height,
      left: this.cropLeft(), right: this.cropRight(), top: this.cropTop(), bottom: this.cropBottom() };
    handle.setPointerCapture(event.pointerId);
  }

  protected moveCropDrag(event: PointerEvent): void {
    const drag = this.cropDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = (event.clientX - drag.x) * 100 / drag.width;
    const dy = (event.clientY - drag.y) * 100 / drag.height;
    this.setCropEdges(drag.edge, drag.left + dx, drag.right - dx, drag.top + dy, drag.bottom - dy);
  }

  protected endCropDrag(event: PointerEvent): void {
    if (this.cropDrag?.pointerId === event.pointerId) { this.cropDrag = null; this.updateVisibleCrop(); }
  }

  protected cropHandleKey(event: KeyboardEvent, edge: string): void {
    const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if ((!dx && !dy) || this.scanBusy()) return;
    event.preventDefault();
    this.setCropEdges(edge, this.cropLeft() + dx, this.cropRight() - dx, this.cropTop() + dy, this.cropBottom() - dy);
    this.updateVisibleCrop();
  }

  private updateVisibleCrop(): void {
    this.visibleCrop.set({ left: this.cropLeft(), right: this.cropRight(), top: this.cropTop(), bottom: this.cropBottom() });
  }

  private setCropEdges(edge: string, left: number, right: number, top: number, bottom: number): void {
    const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
    if (edge.includes('left')) this.cropLeft.set(clamp(left, 95 - this.cropRight()));
    if (edge.includes('right')) this.cropRight.set(clamp(right, 95 - this.cropLeft()));
    if (edge.includes('top')) this.cropTop.set(clamp(top, 95 - this.cropBottom()));
    if (edge.includes('bottom')) this.cropBottom.set(clamp(bottom, 95 - this.cropTop()));
  }

  protected resetCrop(): void {
    this.cropDrag = null;
    this.cropLeft.set(0); this.cropRight.set(0); this.cropTop.set(0); this.cropBottom.set(0); this.cropError.set('');
    this.updateVisibleCrop();
  }

  protected async applyCrop(): Promise<void> {
    const index = this.editingPage();
    if (index === null || this.scanBusy()) return;
    const file = this.scanPages()[index];
    if (!file) return;
    const left = this.cropLeft(), right = this.cropRight(), top = this.cropTop(), bottom = this.cropBottom();
    const rotation = this.previewRotation();
    if (left + right + top + bottom === 0 && rotation === 0) { this.closePreview(); return; }
    if (left + right >= 100 || top + bottom >= 100) { this.cropError.set('Leave some of the page visible to crop.'); return; }
    const generation = this.scanGeneration;
    this.scanBusy.set(true); this.cropError.set('');
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Cannot open image')); image.src = objectUrl; });
      const rotatedWidth = rotation % 180 ? image.naturalHeight : image.naturalWidth;
      const rotatedHeight = rotation % 180 ? image.naturalWidth : image.naturalHeight;
      const bounds = cropBounds(rotatedWidth, rotatedHeight, left, right, top, bottom);
      const canvas = document.createElement('canvas');
      canvas.width = bounds.width; canvas.height = bounds.height;
      const context = canvas.getContext('2d');
      if (!context || canvas.width < 1 || canvas.height < 1) throw new Error('Invalid crop');
      if (rotation === 0) {
        context.drawImage(image, bounds.x, bounds.y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      } else {
        context.translate(-bounds.x, -bounds.y);
        if (rotation === 90) context.translate(rotatedWidth, 0);
        else if (rotation === 180) context.translate(rotatedWidth, rotatedHeight);
        else context.translate(0, rotatedHeight);
        context.rotate(rotation * Math.PI / 180);
        context.drawImage(image, 0, 0);
      }
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) throw new Error('Cannot save crop');
      if (generation !== this.scanGeneration || this.editingPage() !== index || this.scanPages()[index] !== file) return;
      if (blob.size > 5 * 1024 * 1024) throw new Error('Cropped image exceeds 5 MB');
      const cropped = new File([blob], file.name, { type: 'image/jpeg' });
      this.scanPages.update((pages) => pages.map((page, i) => i === index ? cropped : page));
      this.closePreview();
    } catch {
      if (generation === this.scanGeneration) this.cropError.set('Could not crop this page. Try a smaller selection or keep the original.');
    } finally {
      URL.revokeObjectURL(objectUrl);
      if (generation === this.scanGeneration) this.scanBusy.set(false);
    }
  }

  protected closePreview(): void {
    const url = this.previewUrl();
    if (url) URL.revokeObjectURL(url);
    this.previewUrl.set(null); this.isImagePreviewOpen.set(false);
    this.panDrag = null; this.panning.set(false); this.previewAspect.set(1); this.previewRotation.set(0);
    this.editingPage.set(null); this.previewZoom.set(100); this.resetCrop();
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
    if (!files.length && !this.windowStatus()?.all_open) { this.error.set('Custom messages require a recent reply from every selected recipient.'); return; }
    if (files.length && message) { this.error.set('Remove the typed text before sending an attachment; the template uses the recipient’s name.'); return; }
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
