import { Component, OnInit, computed, signal, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiHealthService } from '../../core/api-health.service';
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
  private readonly apiHealth = inject(ApiHealthService);
  private readonly dispatchService = inject(DispatchService);

  protected readonly apiStatus = signal('Checking');
  protected readonly apiStatusDetail = signal('Connecting to backend...');
  protected readonly stats = signal<DispatchStats | null>(null);
  protected readonly isLoadingStats = signal(true);

  protected readonly currentUser = this.auth.currentUser;
  protected readonly canManageUsers = computed(() => {
    const role = this.currentUser()?.role;
    return role === 'super_admin' || role === 'manager';
  });

  ngOnInit(): void {
    this.checkHealth();
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

  private checkHealth(): void {
    this.apiHealth.getHealth().subscribe({
      next: (health) => {
        this.apiStatus.set(health.status);
        this.apiStatusDetail.set('FastAPI backend online');
      },
      error: () => {
        this.apiStatus.set('Unavailable');
        this.apiStatusDetail.set('Backend not reachable');
      },
    });
  }

  protected getSentCount(record: DispatchRecord): number {
    return record.recipients.filter((r) => r.delivery_status === 'sent').length;
  }

  protected getStatusBadgeClass(record: DispatchRecord): string {
    const sent = this.getSentCount(record);
    const total = record.recipients.length;
    if (total === 0) return 'neutral';
    if (sent === total) return 'success';
    if (sent === 0) return 'danger';
    return 'warning';
  }

  protected getStatusLabel(record: DispatchRecord): string {
    const sent = this.getSentCount(record);
    const total = record.recipients.length;
    if (total === 0) return 'No recipients';
    if (sent === total) return `${sent}/${total} Sent`;
    return `${sent}/${total} Delivered`;
  }
}
