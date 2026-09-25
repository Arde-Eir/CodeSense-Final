export type AnalysisPhaseError = Error & {
  name: 'AnalysisPhaseError';
  phase: string;
  cause: unknown;
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function runAnalysisPhase<Result>(phase: string, operation: () => Result): Result {
  try {
    return operation();
  } catch (cause: unknown) {
    const error = new Error(`${phase} failed: ${errorMessage(cause)}`) as AnalysisPhaseError;
    error.name = 'AnalysisPhaseError';
    error.phase = phase;
    error.cause = cause;
    throw error;
  }
}

export function isAnalysisPhaseError(error: unknown): error is AnalysisPhaseError {
  return error instanceof Error
    && error.name === 'AnalysisPhaseError'
    && 'phase' in error
    && typeof error.phase === 'string';
}
