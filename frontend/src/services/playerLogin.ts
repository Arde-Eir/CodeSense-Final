const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '')

interface PlayerSessionTokens {
  access_token: string
  refresh_token: string
}

/** Password verification and private email resolution stay behind the backend. */
export async function signInPlayer(playerName: string, secretCode: string): Promise<PlayerSessionTokens> {
  if (import.meta.env.PROD && !API_BASE_URL) throw new Error('Player sign-in requires VITE_API_BASE_URL in the production build.')
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName, secretCode }),
        signal: AbortSignal.timeout(30_000),
      })
      const result: { access_token?: string; refresh_token?: string; error?: string } = await response.json()
      if (!response.ok) {
        throw Object.assign(new Error(typeof result?.error === 'string' ? result.error : `Player sign-in failed (HTTP ${response.status}).`), {
          statusCode: response.status,
        })
      }
      if (typeof result?.access_token !== 'string' || !result.access_token ||
          typeof result.refresh_token !== 'string' || !result.refresh_token) {
        throw new TypeError('The sign-in service returned an invalid session. Contact an administrator.')
      }
      return { access_token: result.access_token, refresh_token: result.refresh_token }
    } catch (error) {
      if (error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500) throw error
      console.warn('Player sign-in request failed', { attempt, errorType: error instanceof Error ? error.name : typeof error })
      if (attempt === 2) throw error
    }
  }
  throw new Error('The sign-in service exhausted its connection attempts.')
}
