// frontend/src/services/api.ts
import type { AnalysisResult } from '../types';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
const TIMEOUT_MS = 30_000;
const IS_PROD = import.meta.env.PROD;
const ANALYZE_URL = API_BASE_URL
  ? `${API_BASE_URL}/api/analyze`
  : '/api/analyze';

// Cancel any in-flight request when a new one is submitted
let _activeController: AbortController | null = null;

export const analyzeCode = async (
  sourceCode: string,
  currentLevel?: number
): Promise<AnalysisResult> => {
  if (IS_PROD && !API_BASE_URL) {
    throw new Error('Missing VITE_API_BASE_URL in production build');
  }
  // Abort the previous request if still pending
  if (_activeController) {
    _activeController.abort();
  }

  const controller = new AbortController();
  _activeController = controller;

  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(ANALYZE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tunnel-Skip-AntiPhishing-Page': 'true',
      },
      body: JSON.stringify({ sourceCode, hintsUsed: 0, currentLevel }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(`Backend returned status: ${response.status}`);
      throw new Error('Analysis failed');
    }

    return response.json();
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Analysis timed out or was cancelled');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (_activeController === controller) {
      _activeController = null;
    }
  }
};
