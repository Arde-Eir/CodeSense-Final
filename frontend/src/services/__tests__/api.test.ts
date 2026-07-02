import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeCode } from '@/services/api';
import type { AnalysisResult } from '@/types';

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

  it('adds an on-page calls connector from main call nodes to function definitions', async () => {
    mockFetchResult(makeResult({
      cfg: {
        nodes: [
          { id: 'start', label: 'Start', type: 'start', line: 1, children: [], x: 0, y: 0 },
          { id: 'fn-game', label: 'Function: game', code: 'void game()', type: 'predefined', line: 4, children: [], x: 300, y: 0 },
          { id: 'call-game', label: 'Call: game', code: 'game()', type: 'predefined', line: 9, children: [], x: 0, y: 120 },
          { id: 'return', label: 'Return', code: 'return 0', type: 'process', line: 10, children: [], x: 0, y: 240 },
        ],
        edges: [
          { from: 'start', to: 'call-game' },
          { from: 'call-game', to: 'return' },
        ],
      },
    }));

    const result = await analyzeCode(`#include <iostream>
using namespace std;

void game(){
    cout << "hello World";
}

int main() {
    game();
    return 0;
}`);

    expect(result.cfg.edges).toContainEqual({
      from: 'call-game',
      to: 'fn-game',
      label: 'calls',
    });
  });
});
