import assert from 'node:assert/strict';
import { createTowerAlfredService } from '../sidecar/tower-alfred/service.mjs';

let runtimeHandlers;
let cancelled = false;
const runtime = {
  async start() { return { state: 'ready', sessionId: 'session-1', agent: { name: 'hermes-agent', version: 'test' } }; },
  status() { return { state: 'ready', sessionId: 'session-1', agent: { name: 'hermes-agent', version: 'test' } }; },
  async prompt(text) {
    assert.equal(text, 'Status report.');
    await runtimeHandlers.onUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'tool-1',
      title: 'Inspect system',
      kind: 'read',
      status: 'pending'
    });
    const decision = await runtimeHandlers.onPermission({
      toolCallId: 'tool-1',
      title: 'Inspect system',
      kind: 'read',
      options: [
        { optionId: 'allow_once', kind: 'allow_once', name: 'Allow once' },
        { optionId: 'deny', kind: 'reject_once', name: 'Deny' }
      ]
    });
    assert.equal(decision, 'allow_once');
    await runtimeHandlers.onUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool-1',
      title: 'Inspect system',
      kind: 'read',
      status: 'completed'
    });
    await runtimeHandlers.onUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'All systems nominal.' }
    });
    return { text: 'All systems nominal.', stopReason: 'end_turn' };
  },
  async cancel() { cancelled = true; }
};

const service = createTowerAlfredService({
  profile: 'default',
  productName: 'Configured Tower',
  supervisorName: 'JARVIS',
  runtimeFactory(handlers) { runtimeHandlers = handlers; return runtime; },
  idFactory: (() => { let n = 0; return prefix => `${prefix}-${++n}`; })(),
  permissionTimeoutMs: 1000
});

const events = [];
const runPromise = service.run({
  agentId: 'agent',
  messages: [{ role: 'user', content: 'Status report.' }]
}, event => events.push(event));

await new Promise(resolve => setImmediate(resolve));
const permission = events.find(event => event.name === 'permission.prompt');
assert.ok(permission, 'permission is surfaced to the Tower UI');
assert.equal(permission.payload.title, 'Inspect system');
assert.equal(service.resolvePermission({
  runId: permission.payload.runId,
  promptId: permission.payload.promptId,
  decision: 'full'
}).ok, false, 'StarNet full-access semantics must never become a persistent ACP grant');
const applied = service.resolvePermission({
  runId: permission.payload.runId,
  promptId: permission.payload.promptId,
  decision: 'allow_once'
});
assert.deepEqual(applied, { ok: true, decision: 'once', optionId: 'allow_once' });

const result = await runPromise;
assert.equal(result.text, 'All systems nominal.');
assert.deepEqual(events.map(event => event.name), [
  'agent.run.start',
  'agent.tool_call',
  'permission.prompt',
  'agent.tool_result',
  'agent.token',
  'agent.run.end'
]);
assert.equal(events.at(-1).payload.reason, 'end_turn');
assert.equal(service.status().profile, 'default');
assert.equal(service.status().product, 'Configured Tower');
assert.equal(service.status().supervisor, 'JARVIS');

await service.cancel();
assert.equal(cancelled, true);
assert.equal(service.resolvePermission({ runId: 'missing', promptId: 'missing', decision: 'once' }).ok, false);

let releaseFirstCancel;
const firstCancelGate = new Promise(resolve => { releaseFirstCancel = resolve; });
const promptReleases = new Map();
let secondCancelCalled = false;
const parallelService = createTowerAlfredService({
  runtimeFactory(_handlers, { key }) {
    return {
      async start() {},
      status() { return { state: 'ready', sessionId: key }; },
      prompt() { return new Promise(resolve => { promptReleases.set(key, resolve); }); },
      async cancel() {
        promptReleases.get(key)?.({ text: '', stopReason: 'cancelled' });
        if (key === 'alpha') await firstCancelGate;
        if (key === 'beta') secondCancelCalled = true;
      },
      async stop() {}
    };
  }
});
const alphaRun = parallelService.run({ streamId: 'alpha', messages: [{ role: 'user', content: 'alpha' }] }, () => {});
const betaRun = parallelService.run({ streamId: 'beta', messages: [{ role: 'user', content: 'beta' }] }, () => {});
await new Promise(resolve => setImmediate(resolve));
const cancelAll = parallelService.cancel({});
await new Promise(resolve => setImmediate(resolve));
assert.equal(secondCancelCalled, true, 'a stalled ACP cancel cannot block E-STOP delivery to another workstream');
releaseFirstCancel();
await cancelAll;
await Promise.all([alphaRun, betaRun]);

console.log('tower-alfred-service.test: OK');
