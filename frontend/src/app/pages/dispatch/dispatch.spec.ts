import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerDispatchService, SendMode } from '../../core/customer-dispatch.service';
import { ScannerService } from '../../core/scanner.service';
import { CustomersService } from '../../core/customers.service';
import { ContactsService } from '../../core/contacts.service';
import { DispatchRecord, DispatchService } from '../../core/dispatch.service';
import { DispatchPage } from './dispatch';

describe('Customer dispatch flow', () => {
  const ali = {
    id: 1, full_name: 'Ali', phone_number: '+923005556666', city: 'Lahore', other_info: null,
    marketing_person_id: 2,
    marketing_person: { id: 2, full_name: 'John', phone_number: '+923001112222', is_active: true },
  };
  const customers = { list: vi.fn((_search: string, page: number, _size: number) => of({ items: [ali], total: 1, page, page_size: 20 })) };
  const dispatch = {
    mode: vi.fn((): Observable<SendMode> => of({ mode: 'live', test_recipient: null, customer_test_recipient: null })),
    send: vi.fn(() => of({ mode: 'live', results: [{
      record_id: 1, recipient_kind: 'marketing_person', recipient_name: 'John', actual_recipient: '923001112222',
      status: 'accepted', message_id: 'wamid.test', error: null,
    }] })),
  };
  const history = { listFullHistory: vi.fn(() => of([] as DispatchRecord[])) };

  beforeEach(async () => {
    customers.list.mockClear();
    customers.list.mockImplementation((_search, page) => of({ items: [ali], total: 1, page, page_size: 20 }));
    dispatch.send.mockClear();
    history.listFullHistory.mockClear();
    history.listFullHistory.mockReturnValue(of([]));
    dispatch.mode.mockReturnValue(of({ mode: 'live', test_recipient: null, customer_test_recipient: null }));
    await TestBed.configureTestingModule({
      imports: [DispatchPage],
      providers: [provideRouter([]), { provide: CustomersService, useValue: customers }, { provide: CustomerDispatchService, useValue: dispatch },
        { provide: ContactsService, useValue: { listContacts: () => of([{ id: 3, full_name: 'Sara', phone_number: '923003334444', is_active: true }]) } },
        { provide: DispatchService, useValue: history },
      ],
    }).compileComponents();
  });

  it('sends to the assigned marketing person by default and opts into the customer copy', async () => {
    const fixture = TestBed.createComponent(DispatchPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.customer-choice')!.click();
    fixture.detectChanges();
    expect(element.textContent).toContain('John');
    expect(element.querySelector('.recipient-pill.required')?.textContent).toContain('Assigned marketing person');
    const textarea = element.querySelector<HTMLTextAreaElement>('textarea')!;
    textarea.value = 'Bilty dispatched';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.send-button')!.click();
    expect(dispatch.send).toHaveBeenCalledWith(1, false, 'Bilty dispatched', null, [], []);
    element.querySelector<HTMLButtonElement>('.add-recipient-button')!.click(); fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.picker-main-customer')!.click(); fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.picker-footer button')!.click();
    fixture.detectChanges();
    textarea.value = 'Bilty dispatched';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.send-button')!.click();
    expect(dispatch.send).toHaveBeenLastCalledWith(1, true, 'Bilty dispatched', null, [], []);
    fixture.destroy();
  });

  it('applies the customer recipient only after Done', async () => {
    const fixture = TestBed.createComponent(DispatchPage);
    fixture.detectChanges(); await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.customer-choice')!.click(); fixture.detectChanges();

    element.querySelector<HTMLButtonElement>('.add-recipient-button')!.click(); fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.picker-main-customer')!.click(); fixture.detectChanges();
    expect(element.querySelector('.picker-main-customer.selected')).not.toBeNull();
    expect(element.querySelectorAll('.compose-recipient-strip .recipient-pill').length).toBe(1);
    element.querySelector<HTMLElement>('.recipient-overlay')!.click(); fixture.detectChanges();
    expect(element.querySelector('.recipient-overlay')).not.toBeNull();
    element.querySelector<HTMLButtonElement>('.picker-close')!.click(); fixture.detectChanges();
    expect(element.querySelector('.recipient-overlay')).toBeNull();
    expect(element.querySelectorAll('.compose-recipient-strip .recipient-pill').length).toBe(1);

    element.querySelector<HTMLButtonElement>('.add-recipient-button')!.click(); fixture.detectChanges();
    expect(element.querySelector('.picker-main-customer.selected')).toBeNull();
    element.querySelector<HTMLButtonElement>('.picker-main-customer')!.click(); fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.picker-footer button')!.click(); fixture.detectChanges();
    expect(element.querySelectorAll('.compose-recipient-strip .recipient-pill').length).toBe(2);

    const textarea = element.querySelector<HTMLTextAreaElement>('textarea')!;
    textarea.value = 'Bilty'; textarea.dispatchEvent(new Event('input', { bubbles: true })); fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.send-button')!.click();
    expect(dispatch.send).toHaveBeenCalledWith(1, true, 'Bilty', null, [], []);
    fixture.destroy();
  });

  it('adds a marketing person and a customer as separate recipients', async () => {
    customers.list.mockImplementation((_search, page) => of({ items: [ali, { ...ali, id: 4, full_name: 'Fatima', phone_number: '03001234567' }], total: 2, page, page_size: 20 }));
    const fixture = TestBed.createComponent(DispatchPage);
    fixture.detectChanges(); await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.customer-choice')!.click(); fixture.detectChanges();
    expect(element.querySelector('.compose-header .history-link')).toBeNull();
    element.querySelector<HTMLButtonElement>('.add-recipient-button')!.click(); fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.picker-item')!.click(); fixture.detectChanges();
    element.querySelectorAll<HTMLButtonElement>('.picker-tabs button')[1].click(); fixture.detectChanges();
    const fatima = [...element.querySelectorAll<HTMLButtonElement>('.picker-item')].find((button) => button.textContent?.includes('Fatima'))!;
    fatima.click(); fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.picker-footer button')!.click(); fixture.detectChanges();
    expect(element.querySelectorAll('.recipient-pill').length).toBe(3);
    const textarea = element.querySelector<HTMLTextAreaElement>('textarea')!;
    textarea.value = 'Bilty'; textarea.dispatchEvent(new Event('input', { bubbles: true })); fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.send-button')!.click();
    expect(dispatch.send).toHaveBeenCalledWith(1, false, 'Bilty', null, [3], [4]);
    fixture.destroy();
  });

  it('routes the optional customer copy to the configured second test number', async () => {
    dispatch.mode.mockReturnValue(of({ mode: 'test', test_recipient: '+15551234567', customer_test_recipient: '+15557654321' }));
    const fixture = TestBed.createComponent(DispatchPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.customer-choice')!.click();
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.add-recipient-button')!.click(); fixture.detectChanges();
    expect(element.querySelector<HTMLButtonElement>('.picker-main-customer')!.disabled).toBe(false);
    expect(element.querySelector('.picker-main-customer')?.textContent).toContain('Select the end customer Ali as recipient');
    expect(element.querySelector('.picker-main-customer')?.textContent).toContain('+15557654321');
    fixture.destroy();
  });

  it('grows for long pasted text and shrinks when cleared or sent', async () => {
    const fixture = TestBed.createComponent(DispatchPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.customer-choice')!.click();
    fixture.detectChanges();
    const textarea = element.querySelector<HTMLTextAreaElement>('textarea')!;
    let measuredHeight = 154;
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, get: () => textarea.value ? measuredHeight : 30 });
    textarea.value = 'A long pasted dispatch message';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(textarea.style.height).toBe('154px');
    measuredHeight = 260;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(textarea.style.height).toBe('184px');
    expect(textarea.style.overflowY).toBe('auto');
    textarea.value = '';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(textarea.style.height).toBe('44px');
    textarea.value = 'Ready';
    measuredHeight = 110;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.send-button')!.click();
    expect(textarea.style.height).toBe('44px');
    fixture.destroy();
  });

  it('shows previous customer dispatches as chat messages', async () => {
    history.listFullHistory.mockReturnValue(of([{
      id: 11, sender_id: 1, message_text: 'Previous bilty', recipient_name: 'John', actual_recipient: '923001112222', whatsapp_status: 'accepted', timestamp: '2026-11-10T10:00:00Z', recipients: [],
    }]));
    const fixture = TestBed.createComponent(DispatchPage);
    fixture.detectChanges(); await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.customer-choice')!.click(); fixture.detectChanges();
    expect(history.listFullHistory).toHaveBeenCalledWith({ customer_id: 1 });
    expect(element.querySelector('.compose-thread .message-bubble')?.textContent).toContain('Previous bilty');
    const search = element.querySelector<HTMLInputElement>('.compose-chat-search')!;
    search.value = 'missing'; search.dispatchEvent(new Event('input', { bubbles: true })); fixture.detectChanges();
    expect(element.querySelector('.compose-thread .message-bubble')).toBeNull();
    expect(element.querySelector('.compose-thread .history-empty-state')?.textContent).toContain('No matching messages');
    fixture.destroy();
  });

  it('previews an attached image and revokes the preview when removed', async () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
    try {
      const fixture = TestBed.createComponent(DispatchPage);
      fixture.detectChanges();
      await fixture.whenStable();
      const element = fixture.nativeElement as HTMLElement;
      element.querySelector<HTMLButtonElement>('.customer-choice')!.click();
      fixture.detectChanges();
      const fileInput = element.querySelector<HTMLInputElement>('.file-input')!;
      Object.defineProperty(fileInput, 'files', { configurable: true, value: [new File(['image'], 'bilty.png', { type: 'image/png' })] });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      fixture.detectChanges();
      expect(element.querySelector<HTMLImageElement>('.attachment-image-button img')?.getAttribute('src')).toContain('blob:preview');
      element.querySelector<HTMLButtonElement>('.attachment-image-button')!.click();
      fixture.detectChanges();
      expect(element.querySelector('.image-overlay img')).not.toBeNull();
      element.querySelector<HTMLButtonElement>('.remove-attachment')!.click();
      fixture.detectChanges();
      expect(element.querySelector('.attachment-preview')).toBeNull();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
      fixture.destroy();
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it('sends multiple attachments in order with the caption on the first', async () => {
    const fixture = TestBed.createComponent(DispatchPage);
    fixture.detectChanges(); await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.customer-choice')!.click(); fixture.detectChanges();
    const fileInput = element.querySelector<HTMLInputElement>('.file-input')!;
    const first = new File(['pdf'], 'first.pdf', { type: 'application/pdf' });
    const second = new File(['pdf'], 'second.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [first, second] });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    const textarea = element.querySelector<HTMLTextAreaElement>('textarea')!;
    textarea.value = 'Caption'; textarea.dispatchEvent(new Event('input', { bubbles: true })); fixture.detectChanges();
    expect(element.querySelectorAll('.attachment-preview')).toHaveLength(2);
    element.querySelector<HTMLButtonElement>('.send-button')!.click(); fixture.detectChanges();
    expect(dispatch.send).toHaveBeenNthCalledWith(1, 1, false, 'Caption', first, [], []);
    expect(dispatch.send).toHaveBeenNthCalledWith(2, 1, false, '', second, [], []);
    expect(element.querySelectorAll('.attachment-preview')).toHaveLength(0);
    expect(element.textContent).toContain('first.pdf');
    expect(element.textContent).toContain('second.pdf');
    fixture.destroy();
  });

  it('stops sending remaining attachments when a recipient fails', async () => {
    dispatch.send.mockImplementationOnce(() => of({ mode: 'live', results: [{
      record_id: 2, recipient_kind: 'marketing_person', recipient_name: 'John', actual_recipient: '923001112222',
      status: 'failed', message_id: 'wamid.test', error: null,
    }] }));
    const fixture = TestBed.createComponent(DispatchPage);
    fixture.detectChanges(); await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.customer-choice')!.click(); fixture.detectChanges();
    const input = element.querySelector<HTMLInputElement>('.file-input')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [
      new File(['pdf'], 'first.pdf', { type: 'application/pdf' }),
      new File(['pdf'], 'second.pdf', { type: 'application/pdf' }),
    ] });
    input.dispatchEvent(new Event('change', { bubbles: true })); fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.send-button')!.click(); fixture.detectChanges();
    expect(dispatch.send).toHaveBeenCalledTimes(1);
    expect(element.querySelector('.compose-error')?.textContent).toContain('Sending stopped');
    expect(element.querySelector('.attachment-preview')?.textContent).toContain('second.pdf');
    fixture.destroy();
  });

  it('discovers a scanner and adds a scanned JPEG to the draft', async () => {
    const scanner = TestBed.inject(ScannerService);
    vi.spyOn(scanner, 'devices').mockResolvedValue([{ id: 'scanner-1', name: 'Flatbed' }]);
    vi.spyOn(scanner, 'scan').mockResolvedValue(new File(['jpeg'], 'scan.jpg', { type: 'image/jpeg' }));
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:scan');
    URL.revokeObjectURL = vi.fn();
    try {
      const fixture = TestBed.createComponent(DispatchPage);
      fixture.detectChanges(); await fixture.whenStable();
      const element = fixture.nativeElement as HTMLElement;
      element.querySelector<HTMLButtonElement>('.customer-choice')!.click(); fixture.detectChanges();
      element.querySelector<HTMLButtonElement>('.attach-button')!.click(); fixture.detectChanges();
      [...element.querySelectorAll<HTMLButtonElement>('.attachment-menu button')].find((button) => button.textContent?.includes('Scan Document'))!.click(); fixture.detectChanges();
      [...element.querySelectorAll<HTMLButtonElement>('.scan-help button')].find((button) => button.textContent?.includes('Find scanners'))!.click();
      await fixture.whenStable(); fixture.detectChanges();
      expect(element.querySelector('.scan-help select')?.textContent).toContain('Flatbed');
      [...element.querySelectorAll<HTMLButtonElement>('.scan-help button')].find((button) => button.textContent?.includes('Scan page'))!.click();
      await fixture.whenStable(); fixture.detectChanges();
      const format = element.querySelectorAll<HTMLSelectElement>('.scan-help select')[1];
      format.value = 'jpeg'; format.dispatchEvent(new Event('change', { bubbles: true })); fixture.detectChanges();
      [...element.querySelectorAll<HTMLButtonElement>('.scan-help button')].find((button) => button.textContent?.includes('Add to message'))!.click();
      await fixture.whenStable(); fixture.detectChanges();
      expect(element.querySelector('.attachment-preview')?.textContent).toContain('scan.jpg');
      expect(scanner.scan).toHaveBeenCalledWith('scanner-1');
      fixture.destroy();
    } finally { URL.createObjectURL = create; URL.revokeObjectURL = revoke; }
  });

  it('shows compact pagination and requests the next customer page', async () => {
    customers.list.mockImplementation((_search, page) => of({ items: [ali], total: 35, page, page_size: 20 }));
    const fixture = TestBed.createComponent(DispatchPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Showing 1–20');
    element.querySelector<HTMLButtonElement>('.dispatch-pagination button[aria-label="Next page"]')!.click();
    fixture.detectChanges();
    expect(customers.list).toHaveBeenLastCalledWith('', 2, 20);
    expect(element.textContent).toContain('Showing 21–35');
    fixture.destroy();
  });
});
