import { Component, input } from '@angular/core';

/** The jumping dots shown wherever a section loads on its own. */
@Component({
  selector: 'app-loading-dots',
  template: `<span class="dots" role="status" [attr.aria-label]="label()">
    <i></i><i></i><i></i>
  </span>`,
  styles: `
    .dots {
      display: inline-flex;
      gap: 5px;
    }

    .dots i {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
      opacity: 0.4;
      animation: dot-jump 0.6s ease-in-out infinite;
    }

    .dots i:nth-child(2) {
      animation-delay: 0.15s;
    }

    .dots i:nth-child(3) {
      animation-delay: 0.3s;
    }

    @keyframes dot-jump {
      0%,
      100% {
        transform: translateY(0);
        opacity: 0.4;
      }

      40% {
        transform: translateY(-5px);
        opacity: 1;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .dots i {
        animation: none;
      }
    }
  `,
})
export class LoadingDots {
  readonly label = input('loading');
}
