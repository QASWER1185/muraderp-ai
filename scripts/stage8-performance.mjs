import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const evidence = 'backend/stage8-performance-evidence.txt';
const started = performance.now();
const full = spawnSync('npm', ['test', '--', '--run'], {
  cwd: 'backend',
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
const fullDurationMs = Math.round(performance.now() - started);
if (full.status !== 0) process.exit(full.status ?? 1);

const categories = {
  authentication_session: 'auth|session|organization|branch|rbac|permission',
  copilot: 'copilot|ai-assistant|ai-input',
  pricing: 'pricing|rate|rate-list',
  erp_reads: 'customer|vendor|product|warehouse|inventory|estimate|report|accounting',
  protected_mutations: 'purchase|sale|invoice|payment|return|mutation|idempot',
};

const lines = [
  'MURADERP-AI — PHASE 23 STAGE 8 PERFORMANCE EVIDENCE',
  `full_test_suite_duration_ms=${fullDurationMs}`,
];
for (const [name, pattern] of Object.entries(categories)) {
  const start = performance.now();
  const result = spawnSync('npm', ['test', '--', '--run', pattern], {
    cwd: 'backend',
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  const durationMs = Math.round(performance.now() - start);
  lines.push(`${name}_duration_ms=${durationMs}`);
  lines.push(`${name}_result=${result.status === 0 ? 'success' : 'failure'}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
writeFileSync(evidence, `${lines.join('\n')}\n`);
console.log(`\n${lines.join('\n')}`);
