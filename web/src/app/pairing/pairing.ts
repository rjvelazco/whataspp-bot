import { Component, inject } from '@angular/core';
import { TagModule } from 'primeng/tag';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { ConnectionService } from '../connection.service';

@Component({
  selector: 'app-pairing',
  imports: [TagModule, ProgressSpinnerModule],
  templateUrl: './pairing.html',
  styleUrl: './pairing.css',
})
export class Pairing {
  protected readonly conn = inject(ConnectionService);
  protected readonly accountNumber = ConnectionService.accountNumber;
}
