import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { DispatchService, DispatchStatus } from '../../core/dispatch.service';
import { MessageThread } from './message-thread';

describe('Message delivery status', () => {
  it('shows read receipts after a failed message is retried', () => {
    const statuses = new Subject<DispatchStatus[]>();
    TestBed.configureTestingModule({ imports: [MessageThread], providers: [{ provide: DispatchService, useValue: {
      monitorStatuses: () => statuses,
      retry: () => of({ status: 'accepted', error: null, message_id: 'wamid.retry' }),
    } }] });
    const fixture = TestBed.createComponent(MessageThread);
    fixture.componentRef.setInput('records', [{ id: 3, sender_id: 1, send_mode: 'customer_dispatch',
      whatsapp_status: 'failed', whatsapp_message_id: null, failure_reason: 'Failed', recipients: [] }]);
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.retry-button')!.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Meta accepted');
    statuses.next([{ id: 3, whatsapp_status: 'read', whatsapp_message_id: 'wamid.retry', failure_reason: null }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Read');
    expect(fixture.nativeElement.textContent).not.toContain('Meta accepted');
    fixture.destroy();
  });
});
