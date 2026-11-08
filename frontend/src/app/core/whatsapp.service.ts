import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface WhatsAppAcceptedMessage {
  message_id: string;
  status: 'accepted';
  record_id: number;
}

@Injectable({ providedIn: 'root' })
export class WhatsAppService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiBaseUrl}/api/v1/whatsapp`;

  send(message: string, file: File | null, demoContactIds: number[]): Observable<WhatsAppAcceptedMessage> {
    if (!file) {
      return this.http.post<WhatsAppAcceptedMessage>(`${this.url}/text`, {
        message: message.trim(),
        demo_contact_ids: demoContactIds,
      });
    }
    const body = new FormData();
    body.append('file', file);
    if (message.trim()) body.append('caption', message.trim());
    demoContactIds.forEach((id) => body.append('demo_contact_ids', String(id)));
    return this.http.post<WhatsAppAcceptedMessage>(`${this.url}/media`, body);
  }
}
