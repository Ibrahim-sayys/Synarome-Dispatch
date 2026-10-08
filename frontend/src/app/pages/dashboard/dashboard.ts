import { Component, OnInit, signal, inject } from '@angular/core';
import { ApiHealthService } from '../../core/api-health.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard implements OnInit {
  protected readonly apiStatus = signal('Checking');
  protected readonly apiStatusDetail = signal('Connecting to the backend health endpoint');
  protected readonly currentUser = inject(AuthService).currentUser;

  private readonly apiHealth = inject(ApiHealthService);

  ngOnInit(): void {
    this.apiHealth.getHealth().subscribe({
      next: (health) => {
        this.apiStatus.set(health.status);
        this.apiStatusDetail.set('Angular can reach the FastAPI service.');
      },
      error: () => {
        this.apiStatus.set('Unavailable');
        this.apiStatusDetail.set('FastAPI is not reachable from the configured API URL.');
      },
    });
  }
}
