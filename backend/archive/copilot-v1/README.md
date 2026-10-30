Historical Copilot v1 agent, model and factory snapshots. No production entry point imports these files.

The old source paths contain compatibility exports for historical tests only. Both those exports and this archive are excluded from `tsconfig.build.json`; production builds also exclude test modules/fixtures. No test suite was run during this reorganization.

Shared catalog normalization, response errors and document/calculation utilities were extracted unchanged into `src/ai-copilot/shared`. Shared interfaces live in `agent/contracts.ts` and `agent/model-contracts.ts`. Copilot v2 and authoritative ERP services import those modules directly and never instantiate the archived agent.
