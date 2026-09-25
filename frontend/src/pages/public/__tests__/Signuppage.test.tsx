import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AuthContextType } from '@/components/AuthContext';
import { SignupPage } from '@/pages/public/Signuppage';

const { signup, executeSignupRecaptcha } = vi.hoisted(() => ({
  signup: vi.fn<AuthContextType['signup']>(),
  executeSignupRecaptcha: vi.fn<() => Promise<string>>(),
}));

vi.mock('@/components/AuthContext', () => ({
  useAuth: () => ({ signup, goBack: vi.fn() }),
}));

vi.mock('@/services/recaptcha', () => ({ executeSignupRecaptcha }));

function renderSignup(): { form: HTMLFormElement; submitButton: HTMLButtonElement } {
  const { container } = render(
    <MemoryRouter initialEntries={['/signup']}>
      <Routes>
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/welcome" element={<div data-testid="welcome-page" />} />
      </Routes>
    </MemoryRouter>,
  );
  const form = container.querySelector<HTMLFormElement>('#signup-form');
  const submitButton = container.querySelector<HTMLButtonElement>('#signup-submit');
  if (!form || !submitButton) throw new Error('Registration form or submit button is missing.');
  return { form, submitButton };
}

function inputById(id: string): HTMLInputElement {
  const input = document.getElementById(id);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Registration input ${id} is missing.`);
  return input;
}

function fillRegistration(): void {
  fireEvent.change(inputById('signup-username'), { target: { value: 'CoderKnight' } });
  fireEvent.change(inputById('signup-email'), { target: { value: 'coder@example.com' } });
  fireEvent.change(inputById('signup-password'), { target: { value: 'SecretCode123!' } });
  fireEvent.change(inputById('signup-confirm-password'), { target: { value: 'SecretCode123!' } });
  fireEvent.click(inputById('signup-privacy-consent'));
}

describe('registration reCAPTCHA', () => {
  beforeEach(() => {
    signup.mockReset().mockResolvedValue(undefined);
    executeSignupRecaptcha.mockReset().mockResolvedValue('fresh-signup-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('validates the form before requesting a reCAPTCHA token', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const { form, submitButton } = renderSignup();
    now.mockReturnValue(15_000);

    fireEvent.submit(form);

    expect(executeSignupRecaptcha).not.toHaveBeenCalled();
    expect(signup).not.toHaveBeenCalled();
    expect(submitButton).toBeEnabled();
  });

  it('retains timing and honeypot checks before requesting a token', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const { form } = renderSignup();
    fillRegistration();

    fireEvent.submit(form);
    expect(document.getElementById('signup-error')).toHaveTextContent('Please slow down');
    expect(executeSignupRecaptcha).not.toHaveBeenCalled();

    now.mockReturnValue(15_000);
    fireEvent.change(inputById('signup-website'), { target: { value: 'bot.example.com' } });
    fireEvent.submit(form);

    expect(document.getElementById('signup-error')).toHaveTextContent('Automated signup detected');
    expect(executeSignupRecaptcha).not.toHaveBeenCalled();
    expect(signup).not.toHaveBeenCalled();
  });

  it('passes a fresh token to signup and prevents duplicate submissions while verifying', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    let resolveToken!: (token: string) => void;
    executeSignupRecaptcha.mockImplementationOnce(() => new Promise<string>(resolve => {
      resolveToken = resolve;
    }));
    const { form, submitButton } = renderSignup();
    fillRegistration();
    now.mockReturnValue(15_000);

    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(executeSignupRecaptcha).toHaveBeenCalledOnce();
    expect(signup).not.toHaveBeenCalled();
    expect(submitButton).toBeDisabled();
    expect(submitButton).toHaveAttribute('aria-busy', 'true');

    await act(async () => { resolveToken('fresh-signup-token'); });

    expect(signup).toHaveBeenCalledExactlyOnceWith(
      'CoderKnight', 'SecretCode123!', 'coder@example.com', 'student', 'fresh-signup-token',
    );
    expect(screen.getByTestId('welcome-page')).toBeInTheDocument();
  });

  it('stops signup when verification fails and allows a new verification attempt', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    executeSignupRecaptcha.mockRejectedValueOnce(new DOMException('Unable to load reCAPTCHA.', 'NetworkError'));
    const { form, submitButton } = renderSignup();
    fillRegistration();
    now.mockReturnValue(15_000);

    fireEvent.submit(form);

    await waitFor(() => expect(document.getElementById('signup-error')).toHaveTextContent('Unable to load reCAPTCHA.'));
    expect(signup).not.toHaveBeenCalled();
    expect(submitButton).toBeEnabled();
    expect(submitButton).toHaveAttribute('aria-busy', 'false');

    fireEvent.submit(form);

    await waitFor(() => expect(screen.getByTestId('welcome-page')).toBeInTheDocument());
    expect(executeSignupRecaptcha).toHaveBeenCalledTimes(2);
    expect(signup).toHaveBeenCalledExactlyOnceWith(
      'CoderKnight', 'SecretCode123!', 'coder@example.com', 'student', 'fresh-signup-token',
    );
  });
});
