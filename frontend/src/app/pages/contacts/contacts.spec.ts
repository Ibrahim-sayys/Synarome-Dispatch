import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ContactsService } from '../../core/contacts.service';
import { DispatchRecord, DispatchService } from '../../core/dispatch.service';
import { Contacts } from './contacts';

describe('Marketing person chat', () => {
  it('shows the complete conversation oldest first and searches it', async () => {
    const records: DispatchRecord[] = [
      { id: 3, sender_id: 1, timestamp: '2026-11-03T10:00:00Z', message_text: 'Third message', recipients: [] },
      { id: 2, sender_id: 1, timestamp: '2026-11-02T10:00:00Z', message_text: 'Bilty details', recipients: [] },
      { id: 1, sender_id: 1, timestamp: '2026-11-01T10:00:00Z', message_text: 'First message', recipients: [] },
    ];
    const dispatch = { listFullHistory: vi.fn(() => of(records)) };
    await TestBed.configureTestingModule({
      imports: [Contacts],
      providers: [
        { provide: ContactsService, useValue: { listContacts: () => of([{ id: 7, full_name: 'John', phone_number: '03000000001', is_active: true }]) } },
        { provide: DispatchService, useValue: dispatch },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(Contacts);
    fixture.detectChanges(); await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLElement>('.contact-card')!.click(); fixture.detectChanges();
    expect(dispatch.listFullHistory).toHaveBeenCalledWith({ person_id: 7 });
    const texts = () => [...element.querySelectorAll('.history-modal .message-text')].map((node) => node.textContent?.trim());
    expect(texts()).toEqual(['First message', 'Bilty details', 'Third message']);

    const search = element.querySelector<HTMLInputElement>('.history-modal .chat-search input')!;
    search.value = 'bilty'; search.dispatchEvent(new Event('input', { bubbles: true })); fixture.detectChanges();
    expect(texts()).toEqual(['Bilty details']);
    search.value = 'missing'; search.dispatchEvent(new Event('input', { bubbles: true })); fixture.detectChanges();
    expect(element.querySelector('.history-empty-state')?.textContent).toContain('No matching messages');
    fixture.destroy();
  });
});
