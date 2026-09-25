interface RecaptchaApi {
  ready: (callback: () => void) => void;
  execute: (siteKey: string, options: { action: string }) => Promise<string>;
}

declare global {
  interface Window {
    grecaptcha?: RecaptchaApi;
  }
}

const SCRIPT_ID = 'codesense-recaptcha';
const TIMEOUT_MS = 15_000;

function loadRecaptcha(siteKey: string): Promise<RecaptchaApi> {
  return new Promise((resolve, reject) => {
    const existingScript = document.getElementById(SCRIPT_ID);
    if (existingScript && !(existingScript instanceof HTMLScriptElement)) {
      reject(new TypeError('The reCAPTCHA script element is invalid. Please reload this page.'));
      return;
    }
    const script = existingScript ?? document.createElement('script');
    const cleanup = (): void => {
      window.clearTimeout(timeout);
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
    };
    const onError = (): void => {
      cleanup();
      script.remove();
      reject(new DOMException('Unable to load reCAPTCHA. Check your connection and allow Google reCAPTCHA, then try again.', 'NetworkError'));
    };
    const onLoad = (): void => {
      const api = window.grecaptcha;
      if (!api || typeof api.ready !== 'function') {
        onError();
        return;
      }
      api.ready(() => {
        if (typeof api.execute !== 'function') {
          onError();
          return;
        }
        cleanup();
        resolve(api);
      });
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      script.remove();
      reject(new DOMException('reCAPTCHA took too long to load. Check your connection and try again.', 'TimeoutError'));
    }, TIMEOUT_MS);

    if (window.grecaptcha) {
      onLoad();
      return;
    }
    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);
    if (!existingScript) {
      script.id = SCRIPT_ID;
      script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

function requestSignupToken(api: RecaptchaApi, siteKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new DOMException('reCAPTCHA verification timed out. Please try again.', 'TimeoutError'));
    }, TIMEOUT_MS);

    Promise.resolve().then(() => api.execute(siteKey, { action: 'signup' })).then(token => {
      window.clearTimeout(timeout);
      if (typeof token !== 'string' || !token.trim()) {
        reject(new TypeError('reCAPTCHA did not return a verification token. Please try again.'));
        return;
      }
      resolve(token);
    }, error => {
      window.clearTimeout(timeout);
      reject(error instanceof Error ? error : new DOMException(
        `reCAPTCHA could not verify this submission (${String(error)}). Please try again.`, 'OperationError',
      ));
    });
  });
}

/** Executes at submission time so each registration attempt gets a fresh, single-use token. */
export async function executeSignupRecaptcha(): Promise<string> {
  const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY?.trim();
  if (!siteKey || siteKey === 'YOUR_RECAPTCHA_V3_SITE_KEY') {
    throw new TypeError('Registration verification is not configured. Please contact support.');
  }

  let api: RecaptchaApi;
  try {
    api = await loadRecaptcha(siteKey);
  } catch (error) {
    console.warn('reCAPTCHA script loading failed; retrying', {
      error: error instanceof Error ? error.message : String(error),
    });
    api = await loadRecaptcha(siteKey);
  }

  try {
    return await requestSignupToken(api, siteKey);
  } catch (error) {
    console.warn('reCAPTCHA token request failed; retrying', {
      error: error instanceof Error ? error.message : String(error),
    });
    return requestSignupToken(api, siteKey);
  }
}
