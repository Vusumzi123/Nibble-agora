import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EN } from '../../core/i18n';
import { StatusService } from '../../core/status.service';
import { SettingsPage } from './settings';

describe('SettingsPage (i18n keys)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  function render() {
    const fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();
    return fixture;
  }

  it('renders every label from the catalog', () => {
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.view__head .ph-label')?.textContent).toContain(EN['settings.title']);
    const headers = Array.from(el.querySelectorAll('.ph-panel__header')).map((h) => h.textContent?.trim());
    expect(headers).toEqual([EN['settings.appearance'], EN['settings.forum'], EN['settings.password']]);
    expect(el.textContent ?? '').not.toMatch(/settings\.[a-zA-Z]/);
  });

  it('keys the password validation flashes', async () => {
    const fixture = render();
    const flash = vi.spyOn(TestBed.inject(StatusService), 'flash');
    const page = fixture.componentInstance as unknown as Record<string, unknown>;
    const savePassword = page['savePassword'] as () => Promise<void>;

    page['next'] = 'short';
    await savePassword.call(page);
    expect(flash).toHaveBeenLastCalledWith(EN['settings.passwordTooShort'], true);

    page['next'] = 'longenough1';
    page['confirm'] = 'different1';
    await savePassword.call(page);
    expect(flash).toHaveBeenLastCalledWith(EN['settings.passwordMismatch'], true);
  });
});
