import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { TranslateService } from '../core/i18n';
import type { Agent } from '../core/models';
import { SessionService } from '../core/session.service';
import { StatusService } from '../core/status.service';
import { SidePanel } from '../features/side-panel/side-panel';
import { ConfirmDialog } from './confirm-dialog';
import { LoadingDots } from './loading-dots';
import { ToastHost } from './toast-host';

const AGENT: Agent = {
  id: 1,
  handle: 'root',
  display_name: 'Root',
  is_human: 1,
  color: '#e0a458',
  created_at: '2026-10-15T00:00:00.000Z',
};

/** Shell chrome in Spanish — the frame speaks the active locale. */
describe('Spanish shell chrome', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const session = TestBed.inject(SessionService);
    session.token.set('agr_test');
    session.me.set(AGENT);
    TestBed.inject(TranslateService).setLocale('es');
  });

  it('renders the side panel navigation in Spanish', () => {
    const fixture = TestBed.createComponent(SidePanel);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('aside')!.getAttribute('aria-label')).toBe('navegación');
    expect(root.querySelector('.side-panel__close')!.textContent).toContain('cerrar');
    expect(root.querySelector('a[href="/threads"]')!.textContent).toContain('hilos');
    expect(root.querySelector('a[href="/boards"]')!.textContent).toContain('tableros');
    expect(root.querySelector('a[href="/inbox"]')!.textContent).toContain('bandeja');

    const labels = [...root.querySelectorAll('.ph-label')].map((n) => n.textContent!.trim());
    expect(labels).toEqual(['vistas', 'foros']);
    expect(root.querySelector('.panel-item--ghost')!.textContent).toContain('+ nuevo foro');
  });

  it('translates the new-forum form chrome', () => {
    const fixture = TestBed.createComponent(SidePanel);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    (root.querySelector('.panel-item--ghost') as HTMLButtonElement).click();
    fixture.detectChanges();

    const input = root.querySelector('.side-panel__create input') as HTMLInputElement;
    expect(input.getAttribute('placeholder')).toBe('nombre del foro');
    expect(root.querySelector('.side-panel__create button')!.textContent).toContain('crear');
  });

  it('renders the confirm dialog defaults in Spanish', () => {
    const fixture = TestBed.createComponent(ConfirmDialog);
    fixture.componentRef.setInput('message', '¿eliminar esta tarjeta?');
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.ph-panel__header')!.textContent).toContain('confirmar');
    expect(root.querySelector('.btn-outline-secondary')!.textContent).toContain('conservar');
    expect(root.querySelector('.btn-danger')!.textContent).toContain('eliminar');
  });

  it('labels the toast dismiss control in Spanish', () => {
    const status = TestBed.inject(StatusService);
    status.flash('guardado');
    try {
      const fixture = TestBed.createComponent(ToastHost);
      fixture.detectChanges();
      const button = fixture.nativeElement.querySelector('.toast-stack__dismiss') as HTMLElement;
      expect(button.getAttribute('aria-label')).toBe('descartar');
    } finally {
      status.clear();
    }
  });

  it('labels the loading dots in Spanish', () => {
    const fixture = TestBed.createComponent(LoadingDots);
    fixture.detectChanges();
    const dots = fixture.nativeElement.querySelector('.dots') as HTMLElement;
    expect(dots.getAttribute('aria-label')).toBe('cargando…');
  });

  it('never echoes raw catalog keys in the Spanish chrome', () => {
    const sidePanel = TestBed.createComponent(SidePanel);
    sidePanel.componentRef.setInput('open', true);
    sidePanel.detectChanges();

    const confirm = TestBed.createComponent(ConfirmDialog);
    confirm.componentRef.setInput('message', '¿eliminar esta tarjeta?');
    confirm.detectChanges();

    const dots = TestBed.createComponent(LoadingDots);
    dots.detectChanges();

    for (const fixture of [sidePanel, confirm, dots]) {
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).not.toContain('shell.');
    }
  });
});
