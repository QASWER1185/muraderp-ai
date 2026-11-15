import assert from 'node:assert/strict';
import { test } from 'node:test';
import { V2_INSTRUCTIONS, MUSE_STANDARD_INSTRUCTIONS } from '../production-runtime/backend/runtime/ai-copilot/v2/instructions.js';

// Set before importing the agent so tests never load local environment files.
process.env.NODE_ENV = 'test';
const { AutonomousV2Agent } = await import('../production-runtime/backend/runtime/ai-copilot/v2/agent.js');

function harness(outputs) {
  const prompts = [];
  const conversation = { id: 'prompt-test', messages: [], state: {} };
  const provider = { async toolTurn(instructions) {
    prompts.push(instructions);
    assert.ok(outputs.length, 'Unexpected model call');
    return { output: outputs.shift() };
  } };
  const tools = { async authorize() {}, definitions: () => [], async execute() { return []; } };
  const store = { async open() { return conversation; }, async claim() { return 'lease'; },
    async memories() { return []; }, async save() {} };
  return { agent: new AutonomousV2Agent(provider, tools, store), prompts };
}

const message = text => [{ type: 'message', content: [{ type: 'output_text', text }] }];
const scope = { userId: 'test-user', organizationId: 'test-org', branchId: 'test-branch' };

test('fresh and continuing v2 conversations always receive the canonical MUSE prompt', async () => {
  const { agent, prompts } = harness([message('First response'), message('Follow-up response')]);
  await agent.run({ message: 'Hello' }, scope);
  await agent.run({ message: 'Continue', conversationId: 'prompt-test' }, scope);
  assert.equal(prompts.length, 2);
  for (const prompt of prompts) {
    assert.equal(prompt, V2_INSTRUCTIONS);
    assert.ok(prompt.startsWith(MUSE_STANDARD_INSTRUCTIONS));
  }
});

test('tool continuation and final synthesis retain MUSE and accounting safeguards', async () => {
  const { agent, prompts } = harness([
    [{ type: 'function_call', name: 'lookup', arguments: '{}', call_id: 'lookup-1' }],
    [], message('Verified test response'),
  ]);
  const result = await agent.run({ message: 'Look up an item' }, scope);
  assert.equal(result.answer, 'Verified test response');
  assert.equal(prompts.length, 3);
  assert.equal(prompts[0], V2_INSTRUCTIONS);
  assert.equal(prompts[1], V2_INSTRUCTIONS);
  assert.ok(prompts[2].startsWith(V2_INSTRUCTIONS + '\nFINAL EXPLANATION ONLY:'));
  for (const prompt of prompts) {
    for (const section of ['RULE 0:', 'RULE 1:', 'RULE 2:', 'RULE 3:']) assert.ok(prompt.includes(section));
    assert.ok(prompt.includes('Preserve ERP permissions, branch scope, idempotency, concurrency checks and accounting invariants.'));
    assert.ok(prompt.includes("owner's current approval"));
  }
});
