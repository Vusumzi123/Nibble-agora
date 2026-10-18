import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { BlockingOverlay } from './shared/blocking-overlay';
import { ToastHost } from './shared/toast-host';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastHost, BlockingOverlay],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {}
