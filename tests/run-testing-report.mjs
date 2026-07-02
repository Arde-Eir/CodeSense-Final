import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const BACKEND_PORT = 3010;
const BASE = `http://localhost:${BACKEND_PORT}`;
const API = `${BASE}/api/analyze`;

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  return {
    ok: result.status === 0,
    status: result.status,
    output: `${result.error?.message || ''}\n${result.stdout || ''}${result.stderr || ''}`.trim(),
  };
}

function runNpm(args) {
  if (process.platform === 'win32') {
    return runCommand('cmd.exe', ['/d', '/s', '/c', ['npm', ...args].join(' ')]);
  }

  return runCommand('npm', args);
}

function status(ok) {
  return ok ? 'Pass' : 'Fail';
}

function actual(ok) {
  return ok ? 'Successful' : 'Failed';
}

function printTable(title, columns, rows) {
  console.log(`\n${title}`);
  console.log(columns.join(' | '));
  console.log(columns.map(() => '---').join(' | '));
  rows.forEach((row) => {
    console.log(columns.map((column) => row[column]).join(' | '));
  });
}

async function post(sourceCode, extra = {}) {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceCode, hintsUsed: 0, ...extra }),
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

async function waitForBackend() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/`);
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }

  throw new Error(`Backend did not become ready at ${BASE}`);
}

async function runIntegrationRows() {
  const backend = spawn(
    'node',
    ['-r', 'ts-node/register', 'src/server.ts'],
    {
      cwd: 'backend',
      env: { ...process.env, PORT: String(BACKEND_PORT) },
      stdio: 'pipe',
    },
  );

  let backendLog = '';
  backend.stdout.on('data', (chunk) => { backendLog += chunk.toString(); });
  backend.stderr.on('data', (chunk) => { backendLog += chunk.toString(); });

  try {
    await waitForBackend();

    const cases = [
      {
        id: 'IT-01',
        modules: 'Tokenizer + Parser',
        expected: 'Token stream passed',
        run: async () => {
          const { body } = await post('int main() { int score = 10; return score; }');
          return body.success === true && Array.isArray(body.tokens) && body.tokens.length > 0 && body.ast?.type === 'Program';
        },
      },
      {
        id: 'IT-02',
        modules: 'Parser + CFG',
        expected: 'CFG generated',
        run: async () => {
          const { body } = await post('int main() { int score = 10; if (score > 0) { score = 20; } return score; }');
          return body.success === true && body.cfg?.nodes?.length > 0 && body.cfg?.edges?.length > 0;
        },
      },
      {
        id: 'IT-03',
        modules: 'Analysis + Mentor Tip',
        expected: 'Tip generated',
        run: async () => {
          const { body } = await post('int main() { int heroHealth = 100; return 0; }');
          return body.success === true && body.explanations?.some((line) => line.includes('heroHealth') || line.toLowerCase().includes('analysis successful'));
        },
      },
      {
        id: 'IT-04',
        modules: 'Lesson + XP System',
        expected: 'XP awarded',
        run: async () => {
          const { body } = await post('int main() { int score = 10; return score; }', { currentLevel: 1 });
          return body.success === true && body.gamification?.xpEarned >= 25 && body.gamification?.levelTitle === 'Squire';
        },
      },
    ];

    const rows = [];
    for (const testCase of cases) {
      let ok = false;
      try {
        ok = await testCase.run();
      } catch {
        ok = false;
      }

      rows.push({
        'Test ID': testCase.id,
        'Modules Integrated': testCase.modules,
        'Expected Result': testCase.expected,
        'Actual Result': actual(ok),
        Status: status(ok),
      });
    }

    return rows;
  } catch (error) {
    return [{
      'Test ID': 'IT-00',
      'Modules Integrated': 'Backend Server',
      'Expected Result': 'Server started',
      'Actual Result': `Failed: ${error.message}${backendLog ? ` (${backendLog.trim().slice(0, 120)})` : ''}`,
      Status: 'Fail',
    }];
  } finally {
    backend.kill();
  }
}

const backendUnit = runNpm(['--prefix', 'backend', 'test']);
const frontendUnit = runNpm(['--prefix', 'frontend', 'run', 'test']);

const unitRows = [
  { 'Test ID': 'UT-01', Module: 'Lexical Keyword Classifier', 'Expected Result': 'Detect keyword tokens', 'Actual Result': actual(backendUnit.ok), Status: status(backendUnit.ok) },
  { 'Test ID': 'UT-02', Module: 'Identifier Extractor', 'Expected Result': 'Detect user identifiers', 'Actual Result': actual(backendUnit.ok), Status: status(backendUnit.ok) },
  { 'Test ID': 'UT-03', Module: 'PEG Parser', 'Expected Result': 'Generate Program AST', 'Actual Result': actual(backendUnit.ok), Status: status(backendUnit.ok) },
  { 'Test ID': 'UT-04', Module: 'Control Flow Graph Builder', 'Expected Result': 'Generate CFG nodes and edges', 'Actual Result': actual(backendUnit.ok), Status: status(backendUnit.ok) },
  { 'Test ID': 'UT-05', Module: 'Gamification Reward Engine', 'Expected Result': 'Award XP and quality bonus', 'Actual Result': actual(backendUnit.ok), Status: status(backendUnit.ok) },
  { 'Test ID': 'UT-06', Module: 'Frontend API/Visualizer Services', 'Expected Result': 'Vitest suite passed', 'Actual Result': actual(frontendUnit.ok), Status: status(frontendUnit.ok) },
];

const integrationRows = await runIntegrationRows();

printTable('Table 12. Unit Testing Results', ['Test ID', 'Module', 'Expected Result', 'Actual Result', 'Status'], unitRows);
printTable('Table 13. Integration Testing Results', ['Test ID', 'Modules Integrated', 'Expected Result', 'Actual Result', 'Status'], integrationRows);

if (!backendUnit.ok) {
  console.log('\nBackend unit test output:');
  console.log(backendUnit.output);
}

if (!frontendUnit.ok) {
  console.log('\nFrontend Vitest output:');
  console.log(frontendUnit.output);
}

const failed = [...unitRows, ...integrationRows].some((row) => row.Status !== 'Pass');
process.exitCode = failed ? 1 : 0;
