import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { EMPTY, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DispatchService } from '../../core/dispatch.service';
import { DispatchHistoryPage } from './dispatch-history';

describe('Dispatch history filters', () => {
  const dispatchService = {
    monitorStatuses: () => EMPTY,
    listHistoryPage: vi.fn((_filters: unknown, page: number) => of({ items: [], total: 0, page, page_size: 20 })),
    listHistorySenders: vi.fn(() => of([
      { id: 1, username: 'alice' },
      { id: 2, username: 'charlie' },
    ])),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [DispatchHistoryPage],
      providers: [provideRouter([{ path: 'dispatch/history', component: DispatchHistoryPage }]), { provide: DispatchService, useValue: dispatchService }],
    }).compileComponents();
  });

  it('shows active senders even with no records and sends every UI filter', async () => {
    const fixture = TestBed.createComponent(DispatchHistoryPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    const sender = element.querySelector<HTMLSelectElement>('.history-filters select')!;
    expect([...sender.options].map((option) => option.text)).toContain('charlie');
    sender.value = '2';
    sender.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    expect(element.textContent).toContain('No dispatches by this user.');

    const search = element.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'bilty';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    for (const [type, value] of [
      ['date', '2026-11-06'],
      ['time', '12:30'],
      ['date', '2026-11-07'],
      ['time', '17:00'],
    ]) {
      const inputs = element.querySelectorAll<HTMLInputElement>(`input[type="${type}"]`);
      const index = type === 'date' || type === 'time' ? (value === '2026-11-07' || value === '17:00' ? 1 : 0) : 0;
      inputs[index].value = value;
      inputs[index].dispatchEvent(new Event('change', { bubbles: true }));
    }
    fixture.detectChanges();
    expect(dispatchService.listHistoryPage).toHaveBeenLastCalledWith(expect.objectContaining({
      search: 'bilty',
      user_id: 2,
      from_date: '2026-11-06',
      from_time: '12:30',
      to_date: '2026-11-07',
      to_time: '17:00',
      timezone_offset_minutes: new Date().getTimezoneOffset(),
    }), 1);

    element.querySelector<HTMLButtonElement>('.clear-button')!.click();
    expect(dispatchService.listHistoryPage).toHaveBeenLastCalledWith(expect.objectContaining({
      search: '', user_id: null, from_date: '', to_date: '', from_time: '', to_time: '',
    }), 1);
    fixture.destroy();
  });

  it('opens one dispatch from the dashboard link and can return to all history', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/dispatch/history?dispatch_id=42', DispatchHistoryPage);
    expect(dispatchService.listHistoryPage).toHaveBeenLastCalledWith(expect.objectContaining({ dispatch_id: 42 }), 1);
    expect(harness.routeNativeElement?.textContent).toContain('Viewing dispatch #42');
    harness.routeNativeElement?.querySelector<HTMLButtonElement>('.record-focus button')?.click();
    await harness.fixture.whenStable();
    expect(dispatchService.listHistoryPage).toHaveBeenLastCalledWith(expect.objectContaining({ dispatch_id: null }), 1);
  });

  it('moves through server pages and resets to page one when a filter changes', async () => {
    dispatchService.listHistoryPage.mockImplementation((_filters, page) => of({ items: [], total: 45, page, page_size: 20 }));
    const fixture = TestBed.createComponent(DispatchHistoryPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Page 1 of 3');
    element.querySelectorAll<HTMLButtonElement>('.history-pagination button')[1].click();
    fixture.detectChanges();
    expect(dispatchService.listHistoryPage).toHaveBeenLastCalledWith(expect.anything(), 2);
    const search = element.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'Ali';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(dispatchService.listHistoryPage).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'Ali' }), 1);
    fixture.destroy();
  });
});
