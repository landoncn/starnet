import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHermesAcpRuntime, hermesAcpArgs } from '../sidecar/tower-alfred/acp-runtime.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'tower-alfred-fake-acp.mjs');
const runtimeSource = fs.readFileSync(path.join(here, '..', 'sidecar', 'tower-alfred', 'acp-runtime.mjs'), 'utf8');
assert.ok(!runtimeSource.includes('try { await cancel();'), 'shutdown must signal the owned child without awaiting a stalled ACP cancellation');
assert.ok(!runtimeSource.includes('stderrTail.push'), 'detached cancellation failure logging must treat stderrTail as a bounded string');

assert.deepEqual(
  hermesAcpArgs({ profile: 'default' }),
  ['--profile', 'default', 'acp'],
  'default profile is selected explicitly'
);
assert.deepEqual(
  hermesAcpArgs({ profile: '' }),
  ['acp'],
  'empty profile uses the main Hermes home'
);
assert.throws(
  () => hermesAcpArgs({ profile: '../escape' }),
  /invalid Hermes profile/,
  'profile names cannot become argument or path injection'
);

const updates = [];
const permissions = [];
const runtime = createHermesAcpRuntime({
  command: process.execPath,
  args: [fixture],
  cwd: process.cwd(),
  onUpdate(update) { updates.push(update); },
  async onPermission(request) {
    permissions.push(request);
    return 'allow_once';
  }
});

try {
  const started = await runtime.start();
  assert.equal(started.agent.name, 'hermes-agent');
  assert.equal(started.sessionId, 'alfred-test-session');
  assert.equal(runtime.status().state, 'ready');

  const result = await runtime.prompt('Report in.');
  assert.equal(result.text, 'ALFRED online.');
  assert.equal(result.stopReason, 'end_turn');
  assert.equal(permissions.length, 1);
  assert.equal(permissions[0].title, 'Inspect Tower workspace');
  assert.ok(updates.some(update => update.sessionUpdate === 'tool_call'));
  assert.ok(updates.some(update => update.sessionUpdate === 'agent_message_chunk'));
} finally {
  await runtime.stop();
}

assert.equal(runtime.status().state, 'stopped');
console.log('tower-alfred-acp.test: OK');
