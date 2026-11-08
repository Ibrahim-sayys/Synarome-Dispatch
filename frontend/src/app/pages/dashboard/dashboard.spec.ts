import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { AuthService } from '../../core/auth.service';
import { DispatchService } from '../../core/dispatch.service';
import { Dashboard } from './dashboard';

describe('Dashboard dispatch links', () => {
  it('opens a recent record in history and sends View all to history', async () => {
    await TestBed.configureTestingModule({
      imports: [Dashboard],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { currentUser: signal({ id: 1, username: 'alice', role: 'user' }) } },
        { provide: DispatchService, useValue: { getStats: () => of({
          total_dispatches: 1, total_messages: 1, messages_sent: 1, messages_failed: 0,
          today_dispatches: 1, today_messages: 1, total_contacts: 1, active_contacts: 1,
          delivery_rate: 100,
          recent_dispatches: [{ id: 42, sender_id: 1, message_text: 'Bilty dispatched', recipients: [] }],
        }) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector<HTMLAnchorElement>('.view-all-link')?.getAttribute('href')).toBe('/dispatch/history');
    expect(element.querySelector<HTMLAnchorElement>('.recent-item')?.getAttribute('href')).toBe('/dispatch/history?dispatch_id=42');
    fixture.destroy();
  });
});
