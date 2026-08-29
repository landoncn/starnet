import { execFile as execFileCallback } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execFile = promisify(execFileCallback);
const IMAGE_TYPES = Object.freeze({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' });
const AUDIO_TYPES = Object.freeze({ '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' });
const EXPECTED_STUDIO_PROFILES = Object.freeze(['ahtech', 'ahgameplay', 'ahbalance', 'ahnarrative', 'ahvisual', 'ahaudio', 'ahqa']);
const STATE_PRIORITY = Object.freeze({ running: 0, review: 1, blocked: 2, ready: 3, todo: 4, scheduled: 5 });
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_REGISTRY_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;
const MAX_AGENTS = 32;
const MAX_ARTIFACTS = 1000;

function cleanText(value, limit = 300) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit);
}

function requiredText(value, limit, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  if (value.length > limit) throw new Error(`${label} exceeds its size limit`);
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label} contains control characters`);
  const text = cleanText(value, limit);
  if (!text) throw new Error(`${label} is required`);
  return text;
}

const KANBAN_STATES = new Set(['archived', 'blocked', 'done', 'ready', 'review', 'running', 'scheduled', 'todo', 'triage']);
function validateKanban(tasks, assignees) {
  if (!Array.isArray(tasks) || tasks.length > 5000 || !Array.isArray(assignees) || assignees.length > 256) {
    throw new Error('Kanban response is malformed');
  }
  for (const task of tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) throw new Error('Kanban task is malformed');
    requiredText(task.id, 160, 'Kanban task id');
    requiredText(task.title, 500, 'Kanban task title');
    const status = requiredText(task.status, 40, 'Kanban task status').toLowerCase();
    if (!KANBAN_STATES.has(status)) throw new Error('Kanban task status is invalid');
    if (task.assignee != null) {
      const assignee = requiredText(task.assignee, 80, 'Kanban task assignee');
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(assignee)) throw new Error('Kanban task assignee is invalid');
    }
    if (task.updated_at != null && (typeof task.updated_at !== 'number' || !Number.isFinite(task.updated_at))) throw new Error('Kanban task timestamp is invalid');
    if (task.created_at != null && (typeof task.created_at !== 'number' || !Number.isFinite(task.created_at))) throw new Error('Kanban task timestamp is invalid');
    if (task.priority != null && (typeof task.priority !== 'number' || !Number.isFinite(task.priority))) throw new Error('Kanban task priority is invalid');
  }
  const names = new Set();
  for (const row of assignees) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Kanban assignee is malformed');
    const name = requiredText(row.name, 80, 'Kanban assignee name');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(name) || names.has(name) || typeof row.on_disk !== 'boolean') {
      throw new Error('Kanban assignee is invalid');
    }
    names.add(name);
  }
}

function taskTime(task) {
  const raw = task && (task.updated_at ?? task.created_at);
  if (!Number.isFinite(raw)) return 0;
  return raw < 100000000000 ? raw * 1000 : raw;
}

function currentTask(tasks, profile) {
  return (Array.isArray(tasks) ? tasks : [])
    .filter(task => task && task.assignee === profile)
    .filter(task => Object.prototype.hasOwnProperty.call(STATE_PRIORITY, cleanText(task.status, 30).toLowerCase()))
    .sort((a, b) => {
      const state = STATE_PRIORITY[cleanText(a.status, 30).toLowerCase()] - STATE_PRIORITY[cleanText(b.status, 30).toLowerCase()];
      return state || taskTime(b) - taskTime(a);
    })[0] || null;
}

function publicTask(task) {
  if (!task) return null;
  return {
    id: cleanText(task.id, 120),
    title: cleanText(task.title, 300),
    status: cleanText(task.status, 30).toLowerCase(),
    updatedAt: taskTime(task) || null
  };
}

function agentState(task, provisioned) {
  if (!provisioned) return 'unprovisioned';
  const status = cleanText(task && task.status, 30).toLowerCase();
  if (status === 'running') return 'working';
  if (status === 'review') return 'review';
  if (status === 'blocked') return 'blocked';
  if (status === 'ready' || status === 'todo' || status === 'scheduled') return 'queued';
  return 'idle';
}

function safeRelativePath(value) {
  const raw = requiredText(value, 1000, 'artifact path').replaceAll('\\', '/');
  if (raw.startsWith('/')) throw new Error('invalid artifact path');
  const normalized = path.posix.normalize(raw);
  if (normalized === '..' || normalized.startsWith('../')) throw new Error('artifact path is outside studio project');
  return normalized;
}

function artifactType(record) {
  const relative = safeRelativePath(record.path);
  const ext = path.extname(relative).toLowerCase();
  const claimed = requiredText(record.type, 20, 'artifact type').toLowerCase();
  if (claimed === 'image' && IMAGE_TYPES[ext]) return { preview: 'image', mime: IMAGE_TYPES[ext], relative };
  if (claimed === 'audio' && AUDIO_TYPES[ext]) return { preview: 'audio', mime: AUDIO_TYPES[ext], relative };
  throw new Error('unsupported artifact type');
}

function insideRoot(root, candidate) {
  return candidate === root || candidate.startsWith(root + path.sep);
}

async function assertNoSymlinkComponents(root, relative) {
  let cursor = root;
  for (const component of relative.split('/')) {
    cursor = path.join(cursor, component);
    const stat = await fs.lstat(cursor);
    if (stat.isSymbolicLink()) throw new Error('symlinked studio path rejected');
  }
}

export async function readBounded(handle, maxBytes) {
  const chunks = [];
  let total = 0;
  while (total <= maxBytes) {
    const want = Math.min(64 * 1024, maxBytes + 1 - total);
    const buffer = Buffer.allocUnsafe(want);
    const { bytesRead } = await handle.read(buffer, 0, want, null);
    if (!bytesRead) break;
    total += bytesRead;
    if (total > maxBytes) throw new Error('file exceeds size limit');
    chunks.push(buffer.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks, total);
}

async function openJailedFile(root, relative, maxBytes) {
  const resolvedRoot = await fs.realpath(root);
  const safe = safeRelativePath(relative);
  const candidate = path.resolve(resolvedRoot, safe);
  if (!insideRoot(resolvedRoot, candidate)) throw new Error('file outside studio project');
  await assertNoSymlinkComponents(resolvedRoot, safe);
  const before = await fs.realpath(candidate);
  if (!insideRoot(resolvedRoot, before)) throw new Error('file outside studio project');
  const handle = await fs.open(before, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('file is not regular');
    if (stat.size > maxBytes) throw new Error('file exceeds size limit');
    const after = await fs.realpath(candidate);
    if (!insideRoot(resolvedRoot, after) || before !== after) throw new Error('file changed during validation');
    const pathStat = await fs.stat(after);
    if (pathStat.dev !== stat.dev || pathStat.ino !== stat.ino) throw new Error('file changed during validation');
    return { handle, stat };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function inspectJailedFile(root, relative, maxBytes) {
  const opened = await openJailedFile(root, relative, maxBytes);
  await opened.handle.close();
  return opened.stat;
}

async function readJailedFile(root, relative, maxBytes) {
  const opened = await openJailedFile(root, relative, maxBytes);
  try {
    const data = await readBounded(opened.handle, maxBytes);
    if (data.length !== opened.stat.size) throw new Error('file changed during read');
    return { data, stat: opened.stat };
  } finally {
    await opened.handle.close();
  }
}

async function readJson(root, relative, maxBytes) {
  const opened = await readJailedFile(root, relative, maxBytes);
  const parsed = JSON.parse(opened.data.toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON document must contain an object');
  return parsed;
}

function parseJsonOutput(output, label) {
  try { return JSON.parse(String(output || '')); }
  catch (error) { throw new Error(`${label} returned invalid JSON: ${error.message}`); }
}

export function createHermesKanbanAdapter(options = {}) {
  const command = cleanText(options.command || 'hermes', 500) || 'hermes';
  const board = cleanText(options.board, 100);
  const cwd = options.cwd || process.cwd();
  const execute = options.execFile || execFile;
  const childEnv = { ...(options.env || process.env) };
  delete childEnv.HERMES_DELEGATED_CHILD_CONTEXT;
  const run = async args => {
    const result = await execute(command, args, { cwd, env: childEnv, timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
    return typeof result === 'string' ? result : result.stdout;
  };
  const argsFor = subcommand => ['kanban', '--board', board, subcommand, '--json'];
  return {
    async listTasks() { return parseJsonOutput(await run(argsFor('list')), 'kanban list'); },
    async listAssignees() { return parseJsonOutput(await run(argsFor('assignees')), 'kanban assignees'); }
  };
}

export function createTowerStudioService(options = {}) {
  const root = path.resolve(options.root || '');
  const board = cleanText(options.board || 'anglers-hollow', 100) || 'anglers-hollow';
  const adapter = options.listTasks && options.listAssignees
    ? options
    : createHermesKanbanAdapter({ command: options.hermesCommand, board, cwd: options.cwd, execFile: options.execFile });
  const now = options.now || (() => Date.now());
  const cacheMs = Math.max(0, Number.isFinite(Number(options.cacheMs)) ? Number(options.cacheMs) : 4000);
  let cachedStatus = null;
  let cachedAt = 0;
  let statusInFlight = null;

  async function loadManifest() {
    const manifest = await readJson(root, 'studio/manifest.json', MAX_MANIFEST_BYTES);
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.agents) || manifest.agents.length > MAX_AGENTS) throw new Error('manifest schema is unsupported');
    requiredText(manifest.studioId, 120, 'studioId');
    requiredText(manifest.projectName, 240, 'projectName');
    requiredText(manifest.currentMilestone, 300, 'currentMilestone');
    const profiles = new Set();
    for (const agent of manifest.agents) {
      if (!agent || typeof agent !== 'object' || Array.isArray(agent)) throw new Error('agent record is invalid');
      const profile = requiredText(agent.profile, 80, 'agent profile');
      if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(profile) || profiles.has(profile)) throw new Error('agent profile is invalid or duplicated');
      profiles.add(profile);
      requiredText(agent.name, 120, 'agent name');
      requiredText(agent.role, 160, 'agent role');
      requiredText(agent.kind, 80, 'agent kind');
    }
    if (profiles.size !== EXPECTED_STUDIO_PROFILES.length || EXPECTED_STUDIO_PROFILES.some(profile => !profiles.has(profile))) {
      throw new Error('studio roster is not authorized');
    }
    return manifest;
  }

  async function loadArtifacts(manifest) {
    const indexPath = 'studio/artifacts.json';
    const index = await readJson(root, indexPath, MAX_REGISTRY_BYTES);
    if (index.schemaVersion !== 1 || !Array.isArray(index.artifacts) || index.artifacts.length > MAX_ARTIFACTS) throw new Error('artifact registry schema is unsupported');
    const output = [];
    const ids = new Set();
    const profiles = new Set(manifest.agents.map(agent => cleanText(agent.profile, 80)));
    let rejected = 0;
    for (const raw of index.artifacts) {
      try {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('artifact record is invalid');
        const id = requiredText(raw.id, 120, 'artifact id');
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(id) || ids.has(id)) throw new Error('artifact id is invalid or duplicated');
        const title = requiredText(raw.title, 300, 'artifact title');
        const creatorProfile = requiredText(raw.creatorProfile, 80, 'artifact creatorProfile');
        if (!profiles.has(creatorProfile)) throw new Error('artifact creator is not a studio profile');
        const taskId = requiredText(raw.taskId, 120, 'artifact taskId');
        const type = artifactType(raw);
        const stat = await inspectJailedFile(root, type.relative, MAX_ARTIFACT_BYTES);
        ids.add(id);
        output.push({
          id,
          title,
          path: type.relative,
          preview: type.preview,
          mime: type.mime,
          creatorProfile,
          taskId,
          status: cleanText(raw.status, 30).toLowerCase() || 'sketch',
          note: cleanText(raw.note, 500),
          createdAt: cleanText(raw.createdAt, 80) || null,
          bytes: stat.size,
          previewUrl: `/api/tower/studio/artifact?path=${encodeURIComponent(type.relative)}`
        });
      } catch (_) { rejected += 1; }
    }
    return { artifacts: output, rejected };
  }

  async function buildStatus() {
    let manifest;
    try { manifest = await loadManifest(); }
    catch (_) { return { ok: false, state: 'unavailable', board, error: 'Studio manifest unavailable', agents: [], artifacts: [] }; }

    let tasks = [];
    let assignees = [];
    let taskSource = 'kanban';
    try {
      [tasks, assignees] = await Promise.all([adapter.listTasks(), adapter.listAssignees()]);
      validateKanban(tasks, assignees);
    } catch (_) {
      tasks = [];
      assignees = [];
      taskSource = 'unavailable';
    }
    const provisioned = new Set(assignees.filter(row => row && row.on_disk !== false).map(row => cleanText(row.name, 80)));
    const agents = manifest.agents.map(raw => {
      const profile = cleanText(raw.profile, 80);
      const task = currentTask(tasks, profile);
      const isProvisioned = taskSource === 'unavailable' ? null : provisioned.has(profile);
      return {
        profile,
        name: cleanText(raw.name, 120) || profile,
        role: cleanText(raw.role, 240),
        kind: cleanText(raw.kind, 40),
        provisioned: isProvisioned,
        state: taskSource === 'unavailable' ? 'unknown' : agentState(task, isProvisioned),
        task: publicTask(task)
      };
    });
    let artifacts = [];
    let rejectedArtifacts = 0;
    let artifactSource = 'registry';
    try {
      const loaded = await loadArtifacts(manifest);
      artifacts = loaded.artifacts;
      rejectedArtifacts = loaded.rejected;
      if (rejectedArtifacts) artifactSource = 'partial';
    } catch (_) { artifactSource = 'unavailable'; }
    return {
      ok: true,
      state: 'ready',
      board,
      generatedAt: now(),
      sources: { tasks: taskSource, artifacts: artifactSource },
      rejectedArtifacts,
      studio: {
        id: cleanText(manifest.studioId, 120),
        name: cleanText(manifest.projectName, 240),
        milestone: cleanText(manifest.currentMilestone, 300)
      },
      agents,
      artifacts
    };
  }

  async function status() {
    const timestamp = now();
    if (cachedStatus && cacheMs > 0 && timestamp - cachedAt < cacheMs) return cachedStatus;
    if (statusInFlight) return statusInFlight;
    statusInFlight = buildStatus().then(result => {
      cachedStatus = result;
      cachedAt = now();
      return result;
    }).finally(() => { statusInFlight = null; });
    return statusInFlight;
  }

  async function readArtifact(requestedPath) {
    const manifest = await loadManifest();
    const loaded = await loadArtifacts(manifest);
    const relative = safeRelativePath(requestedPath);
    const record = loaded.artifacts.find(row => row.path === relative);
    if (!record) throw new Error('artifact preview unavailable');
    const file = await readJailedFile(root, relative, MAX_ARTIFACT_BYTES);
    return { data: file.data, mime: record.mime, bytes: file.data.length, path: relative };
  }

  return { status, readArtifact };
}
