import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';

const output = 'stage8-vitest.json';
const started = performance.now();
const result = spawnSync('npm', ['test', '--', '--reporter=json', `--outputFile=${output}`], {
  cwd: 'backend',
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
const elapsedMs = Math.round(performance.now() - started);

if (result.status !== 0 || !existsSync(`backend/${output}`)) process.exit(result.status ?? 1);

const report = JSON.parse(readFileSync(`backend/${output}`, 'utf8'));
const files = Array.isArray(report.testResults) ? report.testResults : [];
const categories = {
  authentication_session: /auth|session|organization|branch|rbac|permission/i,
  copilot: /copilot|ai-assistant|ai-input/i,
  pricing: /pricing|rate|rate-list/i,
  erp_reads: /customer|vendor|product|warehouse|inventory|estimate|report|accounting/i,
  protected_mutations: /purchase|sale|invoice|payment|return|mutation|idempot/i,
};
const totals = Object.fromEntries(Object.keys(categories).map((key) => [key, { files: 0, durationMs: 0 }]));
for (const file of files) {
  const name = file.name ?? file.testFilePath ?? '';
  const duration = Number(file.duration ?? 0);
  for (const [key, pattern] of Object.entries(categories)) {
    if (pattern.test(name)) {
      totals[key].files += 1;
      totals[key].durationMs += duration;
    }
  }
}
console.log('\nSTAGE 8 PERFORMANCE EVIDENCE');
console.log(`full_test_suite_duration_ms=${elapsedMs}`);
console.log(`test_files=${files.length}`);
for (const [key, value] of Object.entries(totals)) {
  console.log(`${key}_files=${value.files}`);
  console.log(`${key}_duration_ms=${Math.round(value.durationMs)}`);
}
unlinkSync(`backend/${output}`);
