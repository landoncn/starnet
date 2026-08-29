import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });
let permissionRequestId = 9001;
const pending = new Map();

function send(message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
}

function reply(id, result) {
  send({ id, result });
}

rl.on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch (_) { return; }

  if (Object.prototype.hasOwnProperty.call(message, 'result') && pending.has(message.id)) {
    const resolve = pending.get(message.id);
    pending.delete(message.id);
    resolve(message.result);
    return;
  }

  if (message.method === 'initialize') {
    return reply(message.id, {
      protocolVersion: message.params.protocolVersion,
      agentInfo: { name: 'hermes-agent', version: 'test' },
      agentCapabilities: { loadSession: true },
      authMethods: []
    });
  }

  if (message.method === 'session/new') {
    return reply(message.id, { sessionId: 'alfred-test-session' });
  }

  if (message.method === 'session/prompt') {
    const sessionId = message.params.sessionId;
    const id = permissionRequestId++;
    send({
      id,
      method: 'session/request_permission',
      params: {
        sessionId,
        toolCall: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tool-1',
          title: 'Inspect Tower workspace',
          kind: 'read',
          status: 'pending'
        },
        options: [
          { optionId: 'allow_once', kind: 'allow_once', name: 'Allow once' },
          { optionId: 'deny', kind: 'reject_once', name: 'Deny' }
        ]
      }
    });
    pending.set(id, permission => {
      send({
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'tool-1',
            title: 'Inspect Tower workspace',
            kind: 'read',
            status: permission.outcome.optionId === 'allow_once' ? 'completed' : 'failed'
          }
        }
      });
      send({
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'ALFRED online.' }
          }
        }
      });
      reply(message.id, { stopReason: 'end_turn' });
    });
    return;
  }

  if (message.method === 'session/cancel') return;

  if (Object.prototype.hasOwnProperty.call(message, 'id')) {
    send({ id: message.id, error: { code: -32601, message: 'method not found' } });
  }
});
