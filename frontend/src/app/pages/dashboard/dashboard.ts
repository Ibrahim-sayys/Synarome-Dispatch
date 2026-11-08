import { Component, OnInit, computed, signal, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { DispatchService, DispatchStats, DispatchRecord } from '../../core/dispatch.service';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly dispatchService = inject(DispatchService);

  protected readonly stats = signal<DispatchStats | null>(null);
  protected readonly isLoadingStats = signal(true);

  protected readonly currentUser = this.auth.currentUser;
  protected readonly canManageUsers = computed(() => {
    const role = this.currentUser()?.role;
    return role === 'super_admin' || role === 'manager';
  });

  ngOnInit(): void {
    this.loadStats();
  }

  protected loadStats(): void {
    this.isLoadingStats.set(true);
    this.dispatchService.getStats().subscribe({
      next: (data) => {
        this.stats.set(data);
        this.isLoadingStats.set(false);
      },
      error: () => {
        this.isLoadingStats.set(false);
      },
    });
  }

  protected getSentCount(record: DispatchRecord): number {
    if (record.send_mode === 'whatsapp_test') return record.whatsapp_status === 'accepted' ? 1 : 0;
    return record.recipients.filter((r) => r.delivery_status === 'sent').length;
  }

  protected getStatusBadgeClass(record: DispatchRecord): string {
    if (record.send_mode === 'whatsapp_test') {
      return record.whatsapp_status === 'accepted' ? 'success' : record.whatsapp_status === 'failed' ? 'danger' : 'neutral';
    }
    const sent = this.getSentCount(record);
    const total = record.recipients.length;
    if (total === 0) return 'neutral';
    if (sent === total) return 'success';
    if (sent === 0) return 'danger';
    return 'warning';
  }

  protected getStatusLabel(record: DispatchRecord): string {
    if (record.send_mode === 'whatsapp_test') {
      return record.whatsapp_status === 'accepted' ? 'Meta accepted' : record.whatsapp_status === 'failed' ? 'Failed' : 'Status uncertain';
    }
    const sent = this.getSentCount(record);
    const total = record.recipients.length;
    if (total === 0) return 'No recipients';
    if (sent === total) return `${sent}/${total} Sent`;
    return `${sent}/${total} Submitted`;
  }
}
