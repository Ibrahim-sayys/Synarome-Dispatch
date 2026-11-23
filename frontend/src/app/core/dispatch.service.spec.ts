import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { DispatchRecord, DispatchService } from './dispatch.service';

describe('DispatchService full history', () => {
  it('fetches every page for a selected chat', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const service = TestBed.inject(DispatchService);
    const http = TestBed.inject(HttpTestingController);
    const firstItems: DispatchRecord[] = Array.from({ length: 100 }, (_, index) => ({
      id: 101 - index, sender_id: 1, recipients: [],
    }));
    let records: DispatchRecord[] | undefined;
    service.listFullHistory({ person_id: 7 }).subscribe((result) => { records = result; });

    const first = http.expectOne((request) => request.url.endsWith('/history/page') && request.params.get('page') === '1');
    expect(first.request.params.get('person_id')).toBe('7');
    expect(first.request.params.get('page_size')).toBe('100');
    first.flush({ items: firstItems, total: 101, page: 1, page_size: 100 });

    const second = http.expectOne((request) => request.url.endsWith('/history/page') && request.params.get('page') === '2');
    second.flush({ items: [{ id: 1, sender_id: 1, recipients: [] }], total: 101, page: 2, page_size: 100 });
    const incoming = http.expectOne((request) => request.url.endsWith('/api/v1/incoming') && request.params.get('person_id') === '7');
    incoming.flush([]);
    expect(records?.map((record) => record.id)).toEqual([...firstItems.map((record) => record.id), 1]);
    http.verify();
  });
});
