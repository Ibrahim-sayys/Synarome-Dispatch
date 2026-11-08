import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactsService } from '../../core/contacts.service';
import { WhatsAppService } from '../../core/whatsapp.service';
import { DispatchPage } from './dispatch';

describe('Dispatch demo flow', () => {
  const contacts = [
    { id: 1, full_name: 'ABC Traders', phone_number: '15550000001', is_active: true },
    { id: 2, full_name: 'Ibrahim', phone_number: '15550000002', is_active: true },
  ];
  const whatsapp = { send: vi.fn(() => NEVER) };

  beforeEach(async () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    whatsapp.send.mockClear();
    await TestBed.configureTestingModule({
      imports: [DispatchPage],
      providers: [
        provideRouter([]),
        { provide: ContactsService, useValue: { listContacts: () => of(contacts) } },
        { provide: WhatsAppService, useValue: whatsapp },
      ],
    }).compileComponents();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('requires contact selection, then makes one test send for multiple selected contacts', async () => {
    const fixture = TestBed.createComponent(DispatchPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const continueButton = element.querySelector<HTMLButtonElement>('.continue-button')!;
    expect(continueButton.disabled).toBe(true);
    expect(element.querySelector('.chat-composer')).toBeNull();

    const checkboxes = element.querySelectorAll<HTMLInputElement>('.recipient-card input');
    checkboxes[0].click();
    checkboxes[1].click();
    fixture.detectChanges();
    expect(continueButton.disabled).toBe(false);
    continueButton.click();
    fixture.detectChanges();
    expect(element.textContent).toContain('2 recipients');

    const textarea = element.querySelector<HTMLTextAreaElement>('textarea')!;
    textarea.value = 'Bilty dispatched';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    const sendButton = element.querySelector<HTMLButtonElement>('.send-button')!;
    sendButton.click();
    fixture.detectChanges();
    expect(whatsapp.send).toHaveBeenCalledTimes(1);
    expect(whatsapp.send).toHaveBeenCalledWith('Bilty dispatched', null, [1, 2]);
    expect(sendButton.disabled).toBe(true);
    fixture.destroy();
  });

  it('grows the message field upward for pasted text and shrinks after editing', async () => {
    const fixture = TestBed.createComponent(DispatchPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLInputElement>('.recipient-card input')!.click();
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.continue-button')!.click();
    fixture.detectChanges();

    const textarea = element.querySelector<HTMLTextAreaElement>('textarea')!;
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 150 });
    textarea.value = 'A pasted message with several lines';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(textarea.style.height).toBe('150px');

    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 48 });
    textarea.value = 'Short';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(textarea.style.height).toBe('48px');

    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 230 });
    textarea.value = 'A very long message';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(textarea.style.height).toBe('170px');
    expect(textarea.style.overflowY).toBe('auto');

    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 30 });
    textarea.value = '';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(textarea.style.height).toBe('36px');
    expect(textarea.style.overflowY).toBe('hidden');
    fixture.destroy();
  });

  it('selects every contact even when the list is filtered', async () => {
    const fixture = TestBed.createComponent(DispatchPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const search = element.querySelector<HTMLInputElement>('.recipient-toolbar input')!;
    search.value = 'ABC';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(element.querySelectorAll('.recipient-card').length).toBe(1);
    element.querySelector<HTMLButtonElement>('.recipient-toolbar button')!.click();
    fixture.detectChanges();
    expect(element.textContent).toContain('2 selected');
    fixture.destroy();
  });
});
