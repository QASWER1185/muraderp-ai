import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const evidence = 'backend/stage8-performance-evidence.txt';
const runTests = (filters) => spawnSync('npm', ['test', '--', '--run', ...filters], {
  cwd: 'backend',
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const started = performance.now();
const full = runTests([]);
const fullDurationMs = Math.round(performance.now() - started);
if (full.status !== 0) process.exit(full.status ?? 1);

const categories = {
  authentication_session: [
    'test/phase23-stage2-auth-context.test.ts',
    'test/phase23-auth-security.test.ts',
    'test/authorization.service.test.ts',
    'test/browser-copilot-session.test.ts',
    'test/env-config.test.ts',
  ],
  copilot: [
    'test/copilot.functional.test.ts',
    'test/ai-assistant.service.test.ts',
    'test/ai-assistant.no-mutation.test.ts',
    'test/ai-assistant.resolver.test.ts',
    'test/ai-assistant.module.test.ts',
    'test/ai-assistant.integration.contract.test.ts',
    'test/ai-assistant.policy.test.ts',
    'test/ai-assistant.validation.test.ts',
    'test/ai-assistant.permission-map.test.ts',
    'test/ai-assistant.factory.test.ts',
    'test/ai-input.draft-lifecycle.test.ts',
    'test/ai-input.normalization.test.ts',
    'test/ai-input.review-policy.test.ts',
    'test/phase20.copilot.service.test.ts',
    'test/phase20.copilot.runtime.test.ts',
    'test/phase20.transaction-action-planner.test.ts',
  ],
  pricing: [
    'test/pricing-resolution.test.ts',
    'test/pricing.service.test.ts',
    'test/phase23-stage5-pricing.test.ts',
    'test/estimate-pricing.integration.test.ts',
  ],
  erp_reads: [
    'test/erp.test.ts',
    'test/reporting.service.test.ts',
    'test/inventory-intelligence.service.test.ts',
    'test/accounting.validation.test.ts',
    'test/accounting.validation.additional.test.ts',
  ],
  protected_mutations: [
    'test/customer-payment.test.ts',
    'test/vendor-payment.test.ts',
    'test/sales-transaction.integration.test.ts',
    'test/sales-return.test.ts',
    'test/phase23-stage4-idempotency.test.ts',
    'test/phase20.transaction-action-gateway.test.ts',
  ],
};

const lines = [
  'MURADERP-AI — PHASE 23 STAGE 8 PERFORMANCE EVIDENCE',
  `full_test_suite_duration_ms=${fullDurationMs}`,
];

for (const [name, filters] of Object.entries(categories)) {
  const start = performance.now();
  const result = runTests(filters);
  const durationMs = Math.round(performance.now() - start);
  lines.push(`${name}_duration_ms=${durationMs}`);
  lines.push(`${name}_result=${result.status === 0 ? 'success' : 'failure'}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

writeFileSync(evidence, `${lines.join('\n')}\n`);
console.log(`\n${lines.join('\n')}`);
