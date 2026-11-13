import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactsService } from '../../core/contacts.service';
import { Customer, CustomersService } from '../../core/customers.service';
import { DispatchRecord, DispatchService } from '../../core/dispatch.service';
import { Customers } from './customers';

describe('Customers directory', () => {
  const marketingPerson = { id: 7, full_name: 'John', phone_number: '03000000001', is_active: true };
  const customers = {
    list: vi.fn(() => of({ items: [] as Customer[], total: 0, page: 1, page_size: 25 })),
    filterOptions: vi.fn(() => of({ cities: ['Karachi', 'Lahore'] })),
    create: vi.fn(() => of({})),
    update: vi.fn(() => of({})),
    delete: vi.fn(() => of(undefined)),
  };
  const dispatch = { listFullHistory: vi.fn(() => of([] as DispatchRecord[])) };

  beforeEach(async () => {
    vi.clearAllMocks();
    customers.list.mockReturnValue(of({ items: [], total: 0, page: 1, page_size: 25 }));
    dispatch.listFullHistory.mockReturnValue(of([]));
    await TestBed.configureTestingModule({
      imports: [Customers],
      providers: [
        provideRouter([]),
        { provide: ContactsService, useValue: { listContacts: () => of([marketingPerson]) } },
        { provide: CustomersService, useValue: customers },
        { provide: DispatchService, useValue: dispatch },
      ],
    }).compileComponents();
  });

  it('shows only customer-addressed messages in a chat window and labels missing numbers', async () => {
    customers.list.mockReturnValue(of({ items: [
      { id: 1, full_name: 'Ali', phone_number: '03001234567', city: 'Lahore', other_info: null, marketing_person_id: 7, marketing_person: marketingPerson },
      { id: 2, full_name: 'No Phone', phone_number: null, city: 'Karachi', other_info: null, marketing_person_id: 7, marketing_person: marketingPerson },
    ], total: 2, page: 1, page_size: 25 }));
    const fixture = TestBed.createComponent(Customers);
    fixture.detectChanges(); await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const cards = element.querySelectorAll('.customer-card');
    expect(cards[1].querySelector('.messages-button')).toBeNull();
    expect(cards[1].textContent).toContain('No number added');
    cards[0].querySelector<HTMLButtonElement>('.messages-button')!.click(); fixture.detectChanges();
    expect(element.querySelector('.history-modal')).not.toBeNull();
    expect(dispatch.listFullHistory).toHaveBeenCalledWith({ recipient_customer_id: 1 });
    fixture.destroy();
  });

  it('shows the complete customer chat oldest first and searches its messages', async () => {
    customers.list.mockReturnValue(of({ items: [
      { id: 1, full_name: 'Ali', phone_number: '03001234567', city: null, other_info: null, marketing_person_id: 7, marketing_person: marketingPerson },
    ], total: 1, page: 1, page_size: 25 }));
    dispatch.listFullHistory.mockReturnValue(of([
      { id: 3, sender_id: 1, timestamp: '2026-11-03T10:00:00Z', message_text: 'Last message', recipients: [] },
      { id: 2, sender_id: 1, timestamp: '2026-11-02T10:00:00Z', message_text: 'Middle bilty', recipients: [] },
      { id: 1, sender_id: 1, timestamp: '2026-11-01T10:00:00Z', message_text: 'First message', recipients: [] },
    ]));
    const fixture = TestBed.createComponent(Customers);
    fixture.detectChanges(); await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.messages-button')!.click(); fixture.detectChanges();
    const texts = () => [...element.querySelectorAll('.history-modal .message-text')].map((node) => node.textContent?.trim());
    expect(texts()).toEqual(['First message', 'Middle bilty', 'Last message']);
    expect(element.querySelector('.load-older')).toBeNull();

    const search = element.querySelector<HTMLInputElement>('.history-modal .chat-search input')!;
    search.value = 'bilty'; search.dispatchEvent(new Event('input', { bubbles: true })); fixture.detectChanges();
    expect(texts()).toEqual(['Middle bilty']);
    search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true })); fixture.detectChanges();
    expect(texts()).toHaveLength(3);
    fixture.destroy();
  });

  it('filters customers by city, marketing person, and phone status', async () => {
    const fixture = TestBed.createComponent(Customers);
    fixture.detectChanges(); await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelectorAll<HTMLButtonElement>('.filter-trigger')[0].click(); fixture.detectChanges();
    element.querySelectorAll<HTMLButtonElement>('.filter-option-list button')[1].click(); fixture.detectChanges();
    element.querySelectorAll<HTMLButtonElement>('.filter-trigger')[1].click(); fixture.detectChanges();
    element.querySelectorAll<HTMLButtonElement>('.filter-option-list button')[2].click(); fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.phone-filter-options button:nth-child(2)')!.click(); fixture.detectChanges();
    expect(customers.list).toHaveBeenLastCalledWith('', 1, 25, { marketing_person_id: 7, city: 'Lahore', phone_status: 'with_phone' });
    fixture.destroy();
  });

  it('opens a customer form in a dialog and keeps optional fields optional', async () => {
    const fixture = TestBed.createComponent(Customers);
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.customer-dialog')).toBeNull();
    element.querySelector<HTMLButtonElement>('.add-directory-button')!.click();
    fixture.detectChanges();
    const dialog = element.querySelector<HTMLElement>('.customer-dialog')!;
    expect(dialog).not.toBeNull();
    const name = dialog.querySelector<HTMLInputElement>('input[formControlName="full_name"]')!;
    name.value = 'Ali Traders';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    dialog.querySelector<HTMLButtonElement>('.person-trigger')!.click();
    fixture.detectChanges();
    dialog.querySelector<HTMLButtonElement>('.person-option-list button')!.click();
    fixture.detectChanges();
    dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    expect(customers.create).toHaveBeenCalledWith({
      full_name: 'Ali Traders', marketing_person_id: 7, phone_number: null, city: null, other_info: null,
    });
    fixture.destroy();
  });

  it('keeps the customer form open after a backdrop click until Cancel is clicked', async () => {
    const fixture = TestBed.createComponent(Customers);
    fixture.detectChanges(); await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.add-directory-button')!.click();
    fixture.detectChanges();
    element.querySelector<HTMLElement>('.modal-backdrop')!.click();
    fixture.detectChanges();
    expect(element.querySelector('.customer-dialog')).not.toBeNull();
    element.querySelector<HTMLButtonElement>('.customer-dialog .modal-actions .secondary')!.click();
    fixture.detectChanges();
    expect(element.querySelector('.customer-dialog')).toBeNull();
    fixture.destroy();
  });

  it('filters marketing persons and keeps only digits in the optional phone', async () => {
    const fixture = TestBed.createComponent(Customers);
    fixture.detectChanges(); await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.add-directory-button')!.click(); fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.person-trigger')!.click(); fixture.detectChanges();
    const search = element.querySelector<HTMLInputElement>('.person-options input')!;
    search.value = 'missing'; search.dispatchEvent(new Event('input', { bubbles: true })); fixture.detectChanges();
    expect(element.querySelector('.person-option-list')?.textContent).toContain('No marketing persons found');
    const phone = element.querySelector<HTMLInputElement>('input[formControlName="phone_number"]')!;
    phone.value = '+92 (300) abc 1234567'; phone.dispatchEvent(new Event('input', { bubbles: true })); fixture.detectChanges();
    expect(phone.value).toBe('923001234567');
    fixture.destroy();
  });

  it('closes customer dropdowns when clicking elsewhere', async () => {
    const fixture = TestBed.createComponent(Customers);
    fixture.detectChanges(); await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    element.querySelector<HTMLButtonElement>('.filter-trigger')!.click();
    fixture.detectChanges();
    expect(element.querySelector('.filter-options')).not.toBeNull();
    element.querySelector<HTMLElement>('.filter-field[data-filter="city"] > span')!.click();
    fixture.detectChanges();
    expect(element.querySelector('.filter-options')).toBeNull();

    element.querySelector<HTMLButtonElement>('.filter-trigger')!.click();
    fixture.detectChanges();
    element.querySelector<HTMLElement>('.directory-summary-row')!.click();
    fixture.detectChanges();
    expect(element.querySelector('.filter-options')).toBeNull();

    element.querySelector<HTMLButtonElement>('.add-directory-button')!.click();
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.person-trigger')!.click();
    fixture.detectChanges();
    expect(element.querySelector('.person-options')).not.toBeNull();
    element.querySelector<HTMLInputElement>('input[formControlName="full_name"]')!.click();
    fixture.detectChanges();
    expect(element.querySelector('.person-options')).toBeNull();
    fixture.destroy();
  });
});
