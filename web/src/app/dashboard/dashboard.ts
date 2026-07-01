import { Component, inject } from '@angular/core';
import { ToolbarModule } from 'primeng/toolbar';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { ConnectionService } from '../connection.service';

@Component({
  selector: 'app-dashboard',
  imports: [ToolbarModule, CardModule, TagModule, ButtonModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {
  protected readonly conn = inject(ConnectionService);
  protected readonly accountNumber = ConnectionService.accountNumber;
}
