import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeCode } from '../api';
import type { AnalysisResult } from '../../types';

function makeResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    success: true,
    tokens: [],
    ast: null,
    symbolTable: {},
    safetyChecks: [{ id: 'safe-1', status: 'SAFE', message: 'ok', line: 1 }],
    explanations: ['✅ Analysis Successful'],
    errors: [],
    cfg: { nodes: [{ id: 'n1', label: 'Start', type: 'start', line: 1 }], edges: [] },
    cognitiveComplexity: 0,
    symbolicExecution: [],
    ...overrides,
  } as AnalysisResult;
}

function mockFetchResult(result: AnalysisResult): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(result),
  }));
}

describe('analyzeCode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps stale backend success from showing clear when string include is missing', async () => {
    mockFetchResult(makeResult());

    const result = await analyzeCode(`#include <iostream>
using namespace std;

int main() {
    string name = "Ada";
    cout << name << endl;
    return 0;
}`);

    expect(result.success).toBe(false);
    expect(result.errors.some(error => error.message.includes('#include <string>'))).toBe(true);
    expect(result.cfg.nodes).toHaveLength(0);
    expect(result.safetyChecks).toHaveLength(0);
  });

  it('leaves valid string code successful when the string header is included', async () => {
    mockFetchResult(makeResult());

    const result = await analyzeCode(`#include <iostream>
#include <string>
using namespace std;

int main() {
    string name = "Ada";
    cout << name << endl;
    return 0;
}`);

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.cfg.nodes).toHaveLength(1);
  });
});
