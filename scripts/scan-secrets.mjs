import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.vite',
  '.turbo',
  'coverage',
  'secrets',
  'private',
]);

const SKIP_FILES = new Set([
  'package-lock.json',
  'scan-secrets.mjs',
]);

const ALLOWED_ENV_EXAMPLES = new Set([
  '.env.example',
]);

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
  '.txt',
  '.yml',
  '.yaml',
]);

const SECRET_PATTERNS = [
  {
    name: 'Supabase service-role key',
    pattern: /SUPABASE_SERVICE_ROLE|SERVICE_ROLE_KEY/i,
  },
  {
    name: 'Private key block',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PRIVATE )?PRIVATE KEY-----/,
  },
  {
    name: 'OpenAI-style API key',
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/,
  },
  {
    name: 'JWT-like token',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    name: 'Hard-coded password assignment',
    pattern: /(?:^|[,{;\s])(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|client[_-]?secret)\s*[:=]\s*['"][^'"\n]{8,}['"]/i,
  },
];

function isSkippedFile(filePath) {
  const base = path.basename(filePath);
  const ext = path.extname(base);

  if (SKIP_FILES.has(base)) return true;
  if (base.startsWith('.env') && !ALLOWED_ENV_EXAMPLES.has(base)) return true;
  if (base.endsWith('.local')) return true;
  if (base.includes('.secret.') || base.includes('.credentials.')) return true;
  if (['.pem', '.key', '.p12'].includes(ext)) return true;

  return ext && !TEXT_EXTENSIONS.has(ext);
}

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(fullPath);
      continue;
    }
    if (!entry.isFile() || isSkippedFile(fullPath)) continue;
    yield fullPath;
  }
}

const findings = [];

for await (const filePath of walk(ROOT)) {
  const relativePath = path.relative(ROOT, filePath).replaceAll(path.sep, '/');
  const text = await readFile(filePath, 'utf8');
  const lines = text.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    for (const rule of SECRET_PATTERNS) {
      if (!rule.pattern.test(line)) continue;
      findings.push({
        file: relativePath,
        line: index + 1,
        rule: rule.name,
      });
    }
  }
}

if (findings.length > 0) {
  console.error('Potential secrets found:');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} (${finding.rule})`);
  }
  console.error('\nMove real secrets to ignored local env files or rotate/remove them before committing.');
  process.exitCode = 1;
} else {
  console.log('Secret scan passed.');
}
