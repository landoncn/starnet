import assert from 'node:assert/strict';
import { createTowerAlfredService } from '../sidecar/tower-alfred/service.mjs';

const created = [];
const service = createTowerAlfredService({
  profile: 'default',
  runtimeFactory(handlers, context) {
    const record = { key: context && context.key, prompts: [], stopped: false };
    created.push(record);
    return {
      async start() {},
      status() { return { state: 'ready', sessionId: `session-${record.key}` }; },
      async prompt(text) {
        record.prompts.push(text);
        await handlers.onUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
        return { text, stopReason: 'end_turn' };
      },
      async cancel() {},
      async stop() { record.stopped = true; }
    };
  },
  idFactory: (() => { let n = 0; return prefix => `${prefix}-${++n}`; })()
});

const sink = () => {};
await service.run({ streamId: 'alpha', agentId: 'agent', messages: [{ role: 'user', content: 'alpha one' }] }, sink);
await service.run({ streamId: 'beta', agentId: 'agent', messages: [{ role: 'user', content: 'beta one' }] }, sink);
await service.run({ streamId: 'alpha', agentId: 'agent', messages: [{ role: 'user', content: 'alpha two' }] }, sink);

assert.deepEqual(created.map(row => row.key), ['alpha', 'beta'], 'each workstream owns one ACP session');
assert.deepEqual(created[0].prompts, ['alpha one', 'alpha two'], 'returning to a workstream reuses its ACP session');
assert.deepEqual(created[1].prompts, ['beta one'], 'workstream context does not leak into another ACP session');
assert.equal(service.status().sessions.length, 2);

await service.stop();
assert.ok(created.every(row => row.stopped), 'shutdown stops every owned ACP runtime');

console.log('tower-alfred-sessions.test: OK');
