import { Component, inject } from '@angular/core';
import { ConnectionService } from '../connection.service';

@Component({
  selector: 'app-pairing',
  imports: [],
  templateUrl: './pairing.html',
  styleUrl: './pairing.css',
})
export class Pairing {
  protected readonly conn = inject(ConnectionService);
  protected readonly accountNumber = ConnectionService.accountNumber;
}
