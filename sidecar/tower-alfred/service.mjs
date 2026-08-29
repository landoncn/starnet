import { randomUUID } from 'node:crypto';
import { ACP_PERMISSION_CANCELLED, createHermesAcpRuntime } from './acp-runtime.mjs';

export { ACP_PERMISSION_CANCELLED };

const DECISION_KIND = {
  once: 'allow_once',
  always: 'allow_always',
  deny: 'reject_once'
};

function lastUserText(messages) {
  const rows = Array.isArray(messages) ? messages : [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (!row || row.role !== 'user') continue;
    if (typeof row.content === 'string' && row.content.trim()) return row.content.trim();
    if (Array.isArray(row.content)) {
      const text = row.content
        .filter(part => part && part.type === 'text')
        .map(part => String(part.text || ''))
        .join('\n')
        .trim();
      if (text) return text;
    }
  }
  return '';
}

function conversationKey(body) {
  const raw = body && (body.streamId || body.agentId) || 'alfred';
  return String(raw).trim().slice(0, 200) || 'alfred';
}

function denyOption(options) {
  const rows = Array.isArray(options) ? options : [];
  return rows.find(option => /^reject/.test(String(option && option.kind || '')))
    || rows.find(option => /deny|reject/i.test(String(option && (option.optionId || option.name) || '')))
    || null;
}

function normalizedDecision(option) {
  const kind = String(option && option.kind || '');
  if (kind === 'allow_once') return 'once';
  if (kind === 'allow_always') return 'always';
  if (/^reject/.test(kind)) return 'deny';
  return String(option && option.optionId || 'deny');
}

export function createTowerAlfredService(options = {}) {
  const profile = String(options.profile || 'default');
  const hermesCommand = String(options.hermesCommand || 'hermes');
  const productName = String(options.productName || 'Tower Alfred');
  const supervisorName = String(options.supervisorName || 'ALFRED');
  const cwd = options.cwd || process.cwd();
  const idFactory = options.idFactory || (prefix => `${prefix}-${randomUUID()}`);
  const permissionTimeoutMs = Math.max(1000, Number(options.permissionTimeoutMs) || 60000);
  const runtimeFactory = options.runtimeFactory || (handlers => createHermesAcpRuntime({
    command: hermesCommand,
    profile,
    cwd,
    onUpdate: handlers.onUpdate,
    onPermission: handlers.onPermission
  }));

  const conversations = new Map();
  const runs = new Map();
  const permissions = new Map();

  function emit(conversation, name, payload) {
    const active = conversation && conversation.active;
    if (!active || typeof active.emit !== 'function') return;
    active.emit({ name, payload });
  }

  function settlePermission(entry, optionId) {
    if (!entry || entry.settled) return;
    entry.settled = true;
    clearTimeout(entry.timer);
    permissions.delete(entry.promptId);
    if (entry.conversation.active) entry.conversation.active.permissions.delete(entry);
    entry.resolve(optionId);
  }

  function createConversation(key) {
    const conversation = { key, active: null, runtime: null };
    const handlers = {
      async onUpdate(update) {
        const active = conversation.active;
        if (!active || !update) return;
        if (update.sessionUpdate === 'agent_message_chunk' && update.content && update.content.type === 'text') {
          emit(conversation, 'agent.token', { agentId: active.agentId, runId: active.runId, delta: update.content.text });
        } else if (update.sessionUpdate === 'tool_call') {
          emit(conversation, 'agent.tool_call', {
            agentId: active.agentId,
            runId: active.runId,
            callId: update.toolCallId || 'acp-tool',
            name: update.title || update.kind || 'Hermes tool',
            argsSummary: update.kind || ''
          });
        } else if (update.sessionUpdate === 'tool_call_update' && /^(completed|failed)$/.test(String(update.status || ''))) {
          emit(conversation, 'agent.tool_result', {
            agentId: active.agentId,
            runId: active.runId,
            callId: update.toolCallId || 'acp-tool',
            ok: update.status === 'completed',
            summary: update.title || update.status,
            isError: update.status !== 'completed'
          });
        }
      },

      async onPermission(request) {
        const active = conversation.active;
        if (!active) return 'deny';
        const available = Array.isArray(request && request.options) ? request.options : [];
        const fallback = denyOption(available);
        if (active.cancelling) return ACP_PERMISSION_CANCELLED;
        const promptId = idFactory('permission');
        return new Promise(resolve => {
          const entry = {
            promptId,
            runId: active.runId,
            request,
            conversation,
            resolve,
            settled: false,
            timer: null
          };
          entry.timer = setTimeout(() => settlePermission(entry, fallback ? fallback.optionId : 'deny'), permissionTimeoutMs);
          entry.timer.unref?.();
          active.permissions.add(entry);
          permissions.set(promptId, entry);
          emit(conversation, 'permission.prompt', {
            agentId: active.agentId,
            runId: active.runId,
            promptId,
            toolCallId: request.toolCallId || null,
            title: request.title || 'Hermes permission request',
            kind: request.kind || 'other',
            options: available
          });
        });
      }
    };
    conversation.runtime = runtimeFactory(handlers, { key, profile, cwd });
    conversations.set(key, conversation);
    return conversation;
  }

  function getConversation(key) {
    return conversations.get(key) || createConversation(key);
  }

  async function run(body, eventSink) {
    const text = lastUserText(body && body.messages);
    if (!text) throw new Error('Tower Alfred requires a user message');
    const key = conversationKey(body);
    const conversation = getConversation(key);
    if (conversation.active) throw new Error('Tower Alfred already has a prompt in progress for this workstream');
    const agentId = String(body && body.agentId || 'alfred').slice(0, 80);
    const runId = idFactory('tower-run');
    conversation.active = { runId, agentId, emit: eventSink, permissions: new Set(), cancelling: false };
    runs.set(runId, conversation);
    emit(conversation, 'agent.run.start', {
      agentId,
      runId,
      streamId: key,
      model: `hermes/${profile}`,
      trigger: 'interactive',
      backend: 'hermes-acp'
    });

    try {
      await conversation.runtime.start();
      const result = await conversation.runtime.prompt(text);
      emit(conversation, 'agent.run.end', {
        agentId,
        runId,
        reason: result.stopReason || 'end_turn',
        completionVerdict: 'not_assessed',
        effectVerdict: 'no_observed_effects'
      });
      return { ...result, runId };
    } catch (error) {
      emit(conversation, 'agent.run.error', { agentId, runId, message: error.message || String(error) });
      emit(conversation, 'agent.run.end', {
        agentId,
        runId,
        reason: 'error',
        completionVerdict: 'not_assessed',
        effectVerdict: 'unknown'
      });
      throw error;
    } finally {
      const active = conversation.active;
      if (active && active.runId === runId) {
        for (const pending of Array.from(active.permissions)) {
          const fallback = denyOption(pending.request.options || []);
          settlePermission(pending, fallback ? fallback.optionId : 'deny');
        }
      }
      if (conversation.active && conversation.active.runId === runId) conversation.active = null;
      runs.delete(runId);
    }
  }

  function resolvePermission({ runId, promptId, decision }) {
    const pending = permissions.get(String(promptId || ''));
    if (!pending || pending.runId !== runId || pending.settled) return { ok: false, decision: 'deny' };
    const available = Array.isArray(pending.request.options) ? pending.request.options : [];
    const requested = String(decision || '');
    let selected = available.find(option => String(option && option.optionId || '') === requested);
    if (!selected && DECISION_KIND[requested]) {
      selected = available.find(option => String(option && option.kind || '') === DECISION_KIND[requested]);
    }
    if (!selected) return { ok: false, decision: 'deny' };
    settlePermission(pending, selected.optionId);
    return { ok: true, decision: normalizedDecision(selected), optionId: selected.optionId };
  }

  async function cancel(body = {}) {
    const runId = String(body && body.runId || '');
    let targets;
    if (runId) {
      const one = runs.get(runId);
      targets = one ? [one] : [];
    } else {
      targets = Array.from(conversations.values()).filter(row => row.active);
      if (!targets.length && conversations.size === 1) targets = [conversations.values().next().value];
    }
    let cancelled = false;
    await Promise.all(targets.map(async conversation => {
      const active = conversation.active;
      if (active) {
        cancelled = true;
        active.cancelling = true;
      }
      if (active) {
        for (const pending of Array.from(active.permissions)) {
          settlePermission(pending, ACP_PERMISSION_CANCELLED);
        }
      }
      await conversation.runtime.cancel();
    }));
    return { ok: true, cancelled };
  }

  function status() {
    const sessions = Array.from(conversations.values()).map(conversation => ({
      key: conversation.key,
      activeRunId: conversation.active ? conversation.active.runId : null,
      runtime: conversation.runtime.status()
    }));
    const activeRuns = sessions.map(row => row.activeRunId).filter(Boolean);
    return {
      enabled: true,
      product: productName,
      supervisor: supervisorName,
      profile,
      activeRunId: activeRuns.length === 1 ? activeRuns[0] : null,
      activeRuns,
      sessions,
      runtime: sessions.length === 1 ? sessions[0].runtime : { state: sessions.length ? 'multi-session' : 'idle' }
    };
  }

  async function stop() {
    for (const conversation of conversations.values()) {
      if (conversation.active) conversation.active.cancelling = true;
    }
    for (const pending of Array.from(permissions.values())) {
      settlePermission(pending, ACP_PERMISSION_CANCELLED);
    }
    await Promise.all(Array.from(conversations.values()).map(conversation => conversation.runtime.stop()));
    conversations.clear();
    runs.clear();
  }

  return { run, resolvePermission, cancel, status, stop };
}
