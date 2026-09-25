import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeSignupRecaptcha } from '@/services/recaptcha';

describe('executeSignupRecaptcha', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    document.getElementById('codesense-recaptcha')?.remove();
  });

  it('rejects missing configuration before loading Google', async () => {
    vi.stubEnv('VITE_RECAPTCHA_SITE_KEY', '');

    await expect(executeSignupRecaptcha()).rejects.toThrow('Registration verification is not configured.');

    expect(document.getElementById('codesense-recaptcha')).toBeNull();
  });

  it('executes the signup action again for each submission and returns fresh tokens', async () => {
    vi.stubEnv('VITE_RECAPTCHA_SITE_KEY', 'test-site-key');
    const execute = vi.fn<(siteKey: string, options: { action: string }) => Promise<string>>()
      .mockResolvedValueOnce('first-token')
      .mockResolvedValueOnce('second-token');
    vi.stubGlobal('grecaptcha', {
      ready: (callback: () => void): void => { callback(); },
      execute,
    });

    await expect(executeSignupRecaptcha()).resolves.toBe('first-token');
    await expect(executeSignupRecaptcha()).resolves.toBe('second-token');

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenNthCalledWith(1, 'test-site-key', { action: 'signup' });
    expect(execute).toHaveBeenNthCalledWith(2, 'test-site-key', { action: 'signup' });
  });

  it('waits for the Google bootstrap to provide execute through ready without retrying', async () => {
    vi.stubEnv('VITE_RECAPTCHA_SITE_KEY', 'test-site-key');
    vi.stubGlobal('grecaptcha', undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ready = vi.fn<(callback: () => void) => void>();
    const execute = vi.fn<(siteKey: string, options: { action: string }) => Promise<string>>()
      .mockResolvedValue('bootstrap-token');
    const bootstrap: { ready: typeof ready; execute?: typeof execute } = { ready };

    const verification = executeSignupRecaptcha();
    const script = document.getElementById('codesense-recaptcha');
    if (!(script instanceof HTMLScriptElement)) throw new Error('The reCAPTCHA bootstrap script was not created.');
    vi.stubGlobal('grecaptcha', bootstrap);
    script.dispatchEvent(new Event('load'));

    expect(ready).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();

    bootstrap.execute = execute;
    ready.mock.calls[0][0]();

    await expect(verification).resolves.toBe('bootstrap-token');
    expect(execute).toHaveBeenCalledExactlyOnceWith('test-site-key', { action: 'signup' });
    expect(warn).not.toHaveBeenCalled();
  });
});
