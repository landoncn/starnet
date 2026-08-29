import { spawn as nodeSpawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';

const PROFILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const ACP_PERMISSION_CANCELLED = Symbol('tower-alfred.acp-permission-cancelled');

export function hermesAcpArgs({ profile = 'default' } = {}) {
  const selected = String(profile == null ? '' : profile).trim();
  if (!selected) return ['acp'];
  if (!PROFILE_RE.test(selected) || selected === '.' || selected === '..' || selected.includes('..')) {
    throw new Error('invalid Hermes profile');
  }
  return ['--profile', selected, 'acp'];
}

function permissionOutcome(request, optionId) {
  if (optionId === ACP_PERMISSION_CANCELLED) return { outcome: { outcome: 'cancelled' } };
  const selected = String(optionId || 'deny');
  const allowed = (request.options || []).some(option => option.optionId === selected);
  if (!allowed) return { outcome: { outcome: 'cancelled' } };
  return { outcome: { outcome: 'selected', optionId: selected } };
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode != null || child.signalCode != null) return Promise.resolve();
  return new Promise(resolve => {
    let timer = null;
    const done = () => {
      if (timer) clearTimeout(timer);
      resolve();
    };
    child.once('exit', done);
    timer = setTimeout(done, timeoutMs);
    timer.unref?.();
  });
}

export function createHermesAcpRuntime(options = {}) {
  const spawnImpl = options.spawn || nodeSpawn;
  const command = options.command || 'hermes';
  const args = Array.isArray(options.args)
    ? options.args.map(String)
    : hermesAcpArgs({ profile: options.profile });
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : () => {};
  const onPermission = typeof options.onPermission === 'function'
    ? options.onPermission
    : async () => 'deny';

  let state = 'idle';
  let child = null;
  let connection = null;
  let session = null;
  let agentInfo = null;
  let activePrompt = false;
  let stderrTail = '';

  function status() {
    return {
      state,
      pid: child && child.exitCode == null ? child.pid : null,
      sessionId: session ? session.sessionId : null,
      agent: agentInfo
    };
  }

  async function start() {
    if (state === 'ready') return status();
    if (state !== 'idle' && state !== 'stopped') throw new Error(`Hermes ACP runtime cannot start from ${state}`);
    state = 'starting';
    stderrTail = '';

    child = spawnImpl(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', chunk => {
      stderrTail = (stderrTail + String(chunk)).slice(-8192);
    });

    const startupFailure = new Promise((_, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (state === 'starting') {
          const detail = stderrTail.trim();
          reject(new Error(`Hermes ACP exited during startup (${signal || code})${detail ? `: ${detail}` : ''}`));
        } else if (state !== 'stopping' && state !== 'stopped') {
          state = 'failed';
        }
      });
    });

    try {
      const stream = acp.ndJsonStream(
        Writable.toWeb(child.stdin),
        Readable.toWeb(child.stdout)
      );
      const app = acp.client({ name: 'tower-alfred' })
        .onRequest(acp.methods.client.session.requestPermission, async ({ params }) => {
          const request = {
            sessionId: params.sessionId,
            toolCallId: params.toolCall && params.toolCall.toolCallId,
            title: params.toolCall && params.toolCall.title,
            kind: params.toolCall && params.toolCall.kind,
            options: (params.options || []).map(option => ({
              optionId: option.optionId,
              kind: option.kind,
              name: option.name
            }))
          };
          let choice = 'deny';
          try { choice = await onPermission(request); } catch (_) { choice = 'deny'; }
          return permissionOutcome(params, choice);
        });

      connection = app.connect(stream);
      const initialized = await Promise.race([
        connection.agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: { name: 'tower-alfred', version: '0.1.0' }
        }),
        startupFailure
      ]);
      agentInfo = initialized.agentInfo || { name: 'hermes-agent', version: 'unknown' };
      session = await connection.agent.buildSession(cwd).start();
      state = 'ready';
      return status();
    } catch (error) {
      state = 'failed';
      await stop();
      throw error;
    }
  }

  async function prompt(text) {
    if (state !== 'ready' || !session) throw new Error('Hermes ACP runtime is not ready');
    if (activePrompt) throw new Error('Hermes ACP prompt already in progress');
    const input = String(text == null ? '' : text).trim();
    if (!input) throw new Error('prompt text is required');

    activePrompt = true;
    let responseText = '';
    try {
      session.prompt(input).catch(() => {});
      for (;;) {
        const message = await session.nextUpdate();
        if (message.kind === 'stop') {
          return { text: responseText, stopReason: message.stopReason };
        }
        const update = message.update;
        if (update.sessionUpdate === 'agent_message_chunk' && update.content && update.content.type === 'text') {
          responseText += update.content.text;
        }
        await onUpdate(update);
      }
    } finally {
      activePrompt = false;
    }
  }

  async function cancel() {
    if (!session || !connection) return;
    await connection.agent.notify(acp.methods.agent.session.cancel, { sessionId: session.sessionId });
  }

  async function stop() {
    if (state === 'stopped') return;
    state = 'stopping';
    if (activePrompt) {
      cancel().catch(error => {
        stderrTail = (stderrTail + `\nACP cancel during shutdown failed: ${error && error.message || error}`).slice(-8192);
      });
    }
    try { session?.dispose(); } catch (_) {}
    try { connection?.close(); } catch (_) {}

    if (child && child.exitCode == null && child.signalCode == null) {
      child.kill('SIGTERM');
      await waitForExit(child, 2000);
      if (child.exitCode == null && child.signalCode == null) {
        child.kill('SIGKILL');
        await waitForExit(child, 1000);
      }
    }
    child = null;
    connection = null;
    session = null;
    state = 'stopped';
  }

  return { start, prompt, cancel, stop, status };
}
