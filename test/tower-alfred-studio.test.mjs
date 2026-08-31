import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHermesKanbanAdapter, createTowerStudioService, readBounded } from '../sidecar/tower-alfred/studio.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tower-studio-test-'));
await fs.mkdir(path.join(root, 'studio', 'artifacts'), { recursive: true });
await fs.writeFile(path.join(root, 'studio', 'artifact-reviews.jsonl'), '');
await fs.writeFile(path.join(root, 'studio', 'manifest.json'), JSON.stringify({
  schemaVersion: 1,
  studioId: 'anglers-hollow',
  projectName: "Angler's Hollow: Secrets of the Deep",
  currentMilestone: 'Stillwater Fish Expansion — Batch A',
  agents: [
    { profile: 'ahtech', name: 'FORGE', role: 'Technical Director', kind: 'engineering' },
    { profile: 'ahgameplay', name: 'RIPPLE', role: 'Gameplay Director', kind: 'gameplay' },
    { profile: 'ahbalance', name: 'SOUNDER', role: 'Balance Director', kind: 'balance' },
    { profile: 'ahnarrative', name: 'LOREKEEPER', role: 'Narrative Director', kind: 'narrative' },
    { profile: 'ahvisual', name: 'LANTERN', role: 'Visual Production Lead', kind: 'visual' },
    { profile: 'ahaudio', name: 'ECHO', role: 'Audio Production Lead', kind: 'audio' },
    { profile: 'ahqa', name: 'WATCHWARDEN', role: 'QA and Release Engineer', kind: 'qa' }
  ],
  artifactIndex: 'studio/artifacts.json'
}));
await fs.writeFile(path.join(root, 'studio', 'artifacts', 'fish.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
await fs.writeFile(path.join(root, 'studio', 'artifacts', 'lake.wav'), Buffer.from('RIFFtest'));
await fs.writeFile(path.join(root, 'studio', 'artifacts', 'extra.flac'), Buffer.from('fLaCtest'));
await fs.writeFile(path.join(root, 'outside.png'), Buffer.from('outside'));
await fs.writeFile(path.join(root, 'studio', 'artifacts.json'), JSON.stringify({
  schemaVersion: 1,
  artifacts: [
    { id: 'fish', title: 'Bluegill concept', path: 'studio/artifacts/fish.png', type: 'image', creatorProfile: 'ahvisual', taskId: 'task-visual', status: 'candidate', note: 'Candidate sprite.' },
    { id: 'lake', title: 'Lake ambience', path: 'studio/artifacts/lake.wav', type: 'audio', creatorProfile: 'ahaudio', taskId: 'task-audio', status: 'sketch', note: 'Loop sketch.' },
    { id: 'flac', title: 'Unsupported audio', path: 'studio/artifacts/extra.flac', type: 'audio', creatorProfile: 'ahaudio', taskId: 'task-audio', status: 'sketch' },
    { id: 'bad-shape', title: { nested: true }, path: 'studio/artifacts/fish.png', type: 'image', creatorProfile: 'ahvisual', taskId: 42, status: 'sketch' },
    { id: 'too-long', title: 'x'.repeat(301), path: 'studio/artifacts/fish.png', type: 'image', creatorProfile: 'ahvisual', taskId: 'task-visual', status: 'sketch' },
    { id: 'path-array', title: 'Path array', path: ['studio/artifacts/fish.png'], type: 'image', creatorProfile: 'ahvisual', taskId: 'task-visual', status: 'sketch' },
    { id: 'type-array', title: 'Type array', path: 'studio/artifacts/fish.png', type: ['image'], creatorProfile: 'ahvisual', taskId: 'task-visual', status: 'sketch' },
    { id: 'path-control', title: 'Path control', path: 'studio/artifacts/fi\u0000sh.png', type: 'image', creatorProfile: 'ahvisual', taskId: 'task-visual', status: 'sketch' },
    { id: 'type-control', title: 'Type control', path: 'studio/artifacts/fish.png', type: 'im\u0000age', creatorProfile: 'ahvisual', taskId: 'task-visual', status: 'sketch' },
    { id: 'type-long', title: 'Type long', path: 'studio/artifacts/fish.png', type: 'image' + ' '.repeat(30), creatorProfile: 'ahvisual', taskId: 'task-visual', status: 'sketch' },
    { id: 'escape', title: 'Escape', path: '../outside.png', type: 'image', creatorProfile: 'ahvisual', taskId: 'bad', status: 'candidate' },
    { id: 'active', title: 'Active markup', path: 'studio/artifacts/unsafe.svg', type: 'image', creatorProfile: 'ahvisual', taskId: 'bad-svg', status: 'candidate' }
  ]
}));

const tasks = [
  { id: 'task-visual', title: 'Create fish concepts', assignee: 'ahvisual', status: 'running', updated_at: 1788022200, priority: 10 },
  { id: 'task-audio', title: 'Build lake ambience', assignee: 'ahaudio', status: 'review', updated_at: 1788022100, priority: 5 }
];
const assignees = [
  { name: 'ahtech', on_disk: true, counts: {} },
  { name: 'ahgameplay', on_disk: true, counts: {} },
  { name: 'ahbalance', on_disk: true, counts: {} },
  { name: 'ahnarrative', on_disk: true, counts: {} },
  { name: 'ahvisual', on_disk: true, counts: { running: 1 } },
  { name: 'ahaudio', on_disk: true, counts: { review: 1 } },
  { name: 'ahqa', on_disk: true, counts: {} }
];
const adapter = {
  async listTasks() { return tasks; },
  async listAssignees() { return assignees; }
};
const studio = createTowerStudioService({
  root,
  board: 'anglers-hollow',
  ...adapter,
  now: () => 1788022214000
});

const status = await studio.status();
assert.equal(status.ok, true);
assert.equal(status.studio.id, 'anglers-hollow');
assert.equal(status.studio.milestone, 'Stillwater Fish Expansion — Batch A');
assert.equal(status.board, 'anglers-hollow');
assert.equal(status.agents.length, 7, 'the exact seven durable studio profiles are shown');
assert.deepEqual(status.agents.map(row => [row.profile, row.state, row.task && row.task.title]), [
  ['ahtech', 'idle', null],
  ['ahgameplay', 'idle', null],
  ['ahbalance', 'idle', null],
  ['ahnarrative', 'idle', null],
  ['ahvisual', 'working', 'Create fish concepts'],
  ['ahaudio', 'review', 'Build lake ambience'],
  ['ahqa', 'idle', null]
]);
assert.equal(status.agents[0].provisioned, true);
assert.equal(status.artifacts.length, 2, 'only existing safe image/audio artifacts inside the project are shown');
assert.equal(status.sources.artifacts, 'partial', 'a registry with rejected records is not reported as wholly healthy');
assert.equal(status.rejectedArtifacts, 10);
assert.equal(status.artifacts[0].preview, 'image');
assert.equal(status.artifacts[1].preview, 'audio');
assert.deepEqual(status.artifacts[0].review, { decision: 'pending', feedback: '', updatedAt: null }, 'unreviewed artifacts expose an explicit pending owner decision');
assert.match(status.artifacts[0].previewUrl, /^\/api\/tower\/studio\/artifact\?path=/);
assert.ok(!JSON.stringify(status).includes(String(root)), 'the API never exposes the project absolute path');

const approvedReview = await studio.saveReview({ artifactId: 'lake', decision: 'approved', feedback: 'Rain sits well under the bite cue.' });
assert.deepEqual(approvedReview, { artifactId: 'lake', decision: 'approved', feedback: 'Rain sits well under the bite cue.', updatedAt: 1788022214000 });
const reviewedStatus = await createTowerStudioService({ root, board: 'anglers-hollow', ...adapter, cacheMs: 0, now: () => 1788022215000 }).status();
assert.deepEqual(reviewedStatus.artifacts.find(row => row.id === 'lake').review, {
  decision: 'approved', feedback: 'Rain sits well under the bite cue.', updatedAt: 1788022214000
}, 'owner reviews persist independently of the Tower process cache');
await Promise.all([
  studio.saveReview({ artifactId: 'fish', decision: 'denied', feedback: 'Replace the old sprite.' }),
  studio.saveReview({ artifactId: 'lake', decision: 'approved', feedback: 'Keep this mix.' })
]);
const concurrentReviewLines = (await fs.readFile(path.join(root, 'studio', 'artifact-reviews.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
assert.deepEqual(concurrentReviewLines.slice(-2).map(row => row.artifactId), ['fish', 'lake'], 'serialized concurrent review appends cannot lose an owner decision');
const concurrentStatus = await createTowerStudioService({ root, board: 'anglers-hollow', ...adapter, cacheMs: 0 }).status();
assert.equal(concurrentStatus.artifacts.find(row => row.id === 'fish').review.decision, 'denied');
assert.equal(concurrentStatus.artifacts.find(row => row.id === 'lake').review.feedback, 'Keep this mix.');
const completeReviewLog = await fs.readFile(path.join(root, 'studio', 'artifact-reviews.jsonl'), 'utf8');
await fs.appendFile(path.join(root, 'studio', 'artifact-reviews.jsonl'), '{"artifactId":"fish"');
const recoveredTailStatus = await createTowerStudioService({ root, board: 'anglers-hollow', ...adapter, cacheMs: 0 }).status();
assert.equal(recoveredTailStatus.artifacts.find(row => row.id === 'fish').review.decision, 'denied', 'a truncated crash tail cannot erase the previous complete decision');
await assert.rejects(() => studio.saveReview({ artifactId: 'fish', decision: 'approved', feedback: '' }), /recovery/i, 'a truncated crash tail blocks later writes instead of compounding corruption');
await fs.writeFile(path.join(root, 'studio', 'artifact-reviews.jsonl'), completeReviewLog);
await assert.rejects(() => studio.saveReview({ artifactId: 'missing', decision: 'approved', feedback: '' }), /artifact/i);
await assert.rejects(() => studio.saveReview({ artifactId: 'fish', decision: 'maybe', feedback: '' }), /decision/i);
await assert.rejects(() => studio.saveReview({ artifactId: ' fish', decision: 'approved', feedback: '' }), /id/i);
await assert.rejects(() => studio.saveReview({ artifactId: 'fish', decision: 'APPROVED', feedback: '' }), /decision/i);
await assert.rejects(() => studio.saveReview({ artifactId: 'fish', decision: 'denied', feedback: 'x'.repeat(2001) }), /feedback/i);
await assert.rejects(() => studio.saveReview({ artifactId: 'fish', decision: 'denied', feedback: 'bad\u0000feedback' }), /feedback/i);
const reviewPath = path.join(root, 'studio', 'artifact-reviews.jsonl');
const savedReviewPath = path.join(root, 'studio', 'artifact-reviews.saved.jsonl');
const outsideReviewPath = path.join(root, 'outside-review.jsonl');
await fs.rename(reviewPath, savedReviewPath);
await fs.writeFile(outsideReviewPath, 'outside stays unchanged\n');
await fs.symlink(outsideReviewPath, reviewPath);
await assert.rejects(() => studio.saveReview({ artifactId: 'fish', decision: 'approved', feedback: 'unsafe' }), /symlink|unsafe|changed/i);
assert.equal(await fs.readFile(outsideReviewPath, 'utf8'), 'outside stays unchanged\n', 'a symlinked review target cannot mutate an outside file');
await fs.rm(reviewPath);
await fs.rename(savedReviewPath, reviewPath);

const redirectedManifest = JSON.parse(await fs.readFile(path.join(root, 'studio', 'manifest.json'), 'utf8'));
redirectedManifest.artifactIndex = 'studio/alternate-artifacts.json';
await fs.writeFile(path.join(root, 'studio', 'manifest.json'), JSON.stringify(redirectedManifest));
await fs.writeFile(path.join(root, 'studio', 'alternate-artifacts.json'), JSON.stringify({ schemaVersion: 1, artifacts: [] }));
const redirectedStatus = await createTowerStudioService({ root, board: 'anglers-hollow', ...adapter, cacheMs: 0 }).status();
assert.equal(redirectedStatus.artifacts.length, 2, 'the manifest cannot redirect Tower to a different artifact registry');
const malformedKanban = await createTowerStudioService({
  root, board: 'anglers-hollow', cacheMs: 0,
  async listTasks() { return [null, { foo: 'bar' }]; },
  async listAssignees() { return [null, { on_disk: true }, { name: '', on_disk: true }]; }
}).status();
assert.equal(malformedKanban.sources.tasks, 'unavailable', 'malformed Kanban output never appears healthy');
assert.equal(malformedKanban.agents.every(agent => agent.state === 'unknown'), true, 'malformed Kanban output does not fabricate idle state');
const aliasKanban = await createTowerStudioService({
  root, board: 'anglers-hollow', cacheMs: 0,
  async listTasks() { return [{ id: 'alias', title: 'Alias injection', status: 'running', assignee: null, assignee_profile: ['ahvisual'], updatedAt: ['9999999999'], created_at: 1, priority: 1 }]; },
  async listAssignees() { return assignees; }
}).status();
assert.equal(aliasKanban.sources.tasks, 'kanban');
assert.equal(aliasKanban.agents.find(agent => agent.profile === 'ahvisual').state, 'idle', 'unvalidated assignment and timestamp aliases cannot influence the roster');

const image = await studio.readArtifact('studio/artifacts/fish.png');
assert.equal(image.mime, 'image/png');
assert.deepEqual(Array.from(image.data), [0x89, 0x50, 0x4e, 0x47]);
const audio = await studio.readArtifact('studio/artifacts/lake.wav');
assert.equal(audio.mime, 'audio/wav');
await assert.rejects(() => studio.readArtifact('../outside.png'), /outside studio project|invalid artifact path/);
await assert.rejects(() => studio.readArtifact('studio/artifacts/unsafe.svg'), /artifact preview unavailable/);

const unavailable = createTowerStudioService({
  root: path.join(root, 'missing'),
  board: 'anglers-hollow',
  async listTasks() { throw new Error('kanban offline'); },
  async listAssignees() { throw new Error('profiles offline'); }
});
const unavailableStatus = await unavailable.status();
assert.equal(unavailableStatus.ok, false);
assert.equal(unavailableStatus.state, 'unavailable');
assert.equal(unavailableStatus.error, 'Studio manifest unavailable');
assert.ok(!JSON.stringify(unavailableStatus).includes(String(root)), 'manifest errors do not expose absolute paths');

const linkedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tower-studio-linked-'));
const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tower-studio-outside-'));
await fs.mkdir(path.join(linkedRoot, 'studio'), { recursive: true });
await fs.writeFile(path.join(outsideRoot, 'manifest.json'), JSON.stringify({ schemaVersion: 1, studioId: 'escaped', projectName: 'Outside', agents: [] }));
await fs.symlink(path.join(outsideRoot, 'manifest.json'), path.join(linkedRoot, 'studio', 'manifest.json'));
const linkedStudio = createTowerStudioService({ root: linkedRoot, board: 'anglers-hollow', cacheMs: 0, async listTasks() { return []; }, async listAssignees() { return []; } });
const linkedStatus = await linkedStudio.status();
assert.equal(linkedStatus.ok, false, 'a symlinked manifest is rejected');
assert.equal(linkedStatus.error, 'Studio manifest unavailable');

const intermediateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tower-studio-intermediate-link-'));
await fs.mkdir(path.join(intermediateRoot, 'real-studio'), { recursive: true });
await fs.writeFile(path.join(intermediateRoot, 'real-studio', 'manifest.json'), JSON.stringify({
  schemaVersion: 1,
  studioId: 'linked',
  projectName: 'Linked',
  currentMilestone: 'Unsafe',
  agents: [
    { profile: 'ahtech', name: 'FORGE', role: 'Role', kind: 'kind' },
    { profile: 'ahgameplay', name: 'RIPPLE', role: 'Role', kind: 'kind' },
    { profile: 'ahbalance', name: 'SOUNDER', role: 'Role', kind: 'kind' },
    { profile: 'ahnarrative', name: 'LOREKEEPER', role: 'Role', kind: 'kind' },
    { profile: 'ahvisual', name: 'LANTERN', role: 'Role', kind: 'kind' },
    { profile: 'ahaudio', name: 'ECHO', role: 'Role', kind: 'kind' },
    { profile: 'ahqa', name: 'WATCHWARDEN', role: 'Role', kind: 'kind' }
  ]
}));
await fs.symlink('real-studio', path.join(intermediateRoot, 'studio'));
const intermediateStatus = await createTowerStudioService({ root: intermediateRoot, adapter, cacheMs: 0 }).status();
assert.equal(intermediateStatus.ok, false, 'every symlinked path component is rejected even when its target stays inside the project root');

const invalidAgentRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tower-studio-invalid-agent-'));
await fs.mkdir(path.join(invalidAgentRoot, 'studio'), { recursive: true });
await fs.writeFile(path.join(invalidAgentRoot, 'studio', 'manifest.json'), JSON.stringify({
  schemaVersion: 1,
  studioId: 'invalid',
  projectName: 'Invalid',
  currentMilestone: 'Invalid',
  agents: [{ profile: '', name: '', role: '', kind: '' }]
}));
const invalidAgentStatus = await createTowerStudioService({ root: invalidAgentRoot, adapter, cacheMs: 0 }).status();
assert.equal(invalidAgentStatus.ok, false, 'empty durable-agent identities fail closed instead of producing blank roster cards');

const wrongRosterRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tower-studio-wrong-roster-'));
await fs.mkdir(path.join(wrongRosterRoot, 'studio'), { recursive: true });
await fs.writeFile(path.join(wrongRosterRoot, 'studio', 'manifest.json'), JSON.stringify({
  schemaVersion: 1,
  studioId: 'anglers-hollow', projectName: 'Wrong', currentMilestone: 'Wrong',
  agents: [
    ['ahtech', 'FORGE'], ['ahgameplay', 'RIPPLE'], ['ahbalance', 'SOUNDER'], ['ahnarrative', 'LOREKEEPER'],
    ['ahvisual', 'LANTERN'], ['ahaudio', 'ECHO'], ['rogue', 'ROGUE']
  ].map(([profile, name]) => ({ profile, name, role: 'Role', kind: 'kind' }))
}));
const wrongRosterStatus = await createTowerStudioService({ root: wrongRosterRoot, adapter, cacheMs: 0 }).status();
assert.equal(wrongRosterStatus.ok, false, 'the studio manifest cannot replace one of the seven authorized durable profiles');

const wrongTypeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tower-studio-wrong-type-'));
await fs.mkdir(path.join(wrongTypeRoot, 'studio'), { recursive: true });
await fs.writeFile(path.join(wrongTypeRoot, 'studio', 'manifest.json'), JSON.stringify({
  schemaVersion: 1,
  studioId: 'anglers-hollow', projectName: { nested: true }, currentMilestone: 'Wrong',
  agents: [
    ['ahtech', 'FORGE'], ['ahgameplay', 'RIPPLE'], ['ahbalance', 'SOUNDER'], ['ahnarrative', 'LOREKEEPER'],
    ['ahvisual', 'LANTERN'], ['ahaudio', 'ECHO'], ['ahqa', 'WATCHWARDEN']
  ].map(([profile, name]) => ({ profile, name, role: 'Role', kind: 'kind' }))
}));
const wrongTypeStatus = await createTowerStudioService({ root: wrongTypeRoot, adapter, cacheMs: 0 }).status();
assert.equal(wrongTypeStatus.ok, false, 'required manifest fields must be strings rather than coercible objects');

let emitted = 0;
const growingHandle = {
  async read(buffer) {
    if (emitted >= 12) return { bytesRead: 0, buffer };
    const bytesRead = Math.min(buffer.length, 4);
    buffer.fill(0x61, 0, bytesRead);
    emitted += bytesRead;
    return { bytesRead, buffer };
  }
};
await assert.rejects(() => readBounded(growingHandle, 8), /size limit/i, 'bounded reads stop after max+1 bytes even if a file grows after fstat');

await fs.writeFile(path.join(root, 'studio', 'artifacts.json'), JSON.stringify({ schemaVersion: '1', artifacts: [] }));
const badRegistryStudio = createTowerStudioService({ root, board: 'anglers-hollow', cacheMs: 0, async listTasks() { return []; }, async listAssignees() { return assignees; } });
const badRegistryStatus = await badRegistryStudio.status();
assert.equal(badRegistryStatus.sources.artifacts, 'unavailable', 'unsupported registry schemas degrade visibly');
assert.equal(badRegistryStatus.artifacts.length, 0);

await fs.writeFile(path.join(root, 'studio', 'artifacts.json'), JSON.stringify({ schemaVersion: 1, artifacts: [
  { id: 'huge', title: 'Huge', path: 'studio/artifacts/huge.wav', type: 'audio', creatorProfile: 'ahaudio' }
] }));
await fs.writeFile(path.join(root, 'studio', 'artifacts', 'huge.wav'), Buffer.from('RIFF'));
await fs.truncate(path.join(root, 'studio', 'artifacts', 'huge.wav'), 50 * 1024 * 1024 + 1);
const hugeStudio = createTowerStudioService({ root, board: 'anglers-hollow', cacheMs: 0, async listTasks() { return []; }, async listAssignees() { return assignees; } });
const hugeStatus = await hugeStudio.status();
assert.equal(hugeStatus.artifacts.length, 0, 'oversized artifacts are not advertised as previewable');
assert.equal(hugeStatus.sources.artifacts, 'partial');
assert.equal(hugeStatus.rejectedArtifacts, 1);

let listCalls = 0;
const cachedStudio = createTowerStudioService({ root, board: 'anglers-hollow', cacheMs: 1000, async listTasks() { listCalls += 1; return []; }, async listAssignees() { return assignees; } });
await Promise.all([cachedStudio.status(), cachedStudio.status(), cachedStudio.status()]);
assert.equal(listCalls, 1, 'concurrent status polls share one Kanban read');

const execCalls = [];
const cliAdapter = createHermesKanbanAdapter({
  command: 'hermes', board: 'anglers-hollow',
  env: { KEEP_ME: 'yes', HERMES_DELEGATED_CHILD_CONTEXT: '1' },
  async execFile(command, args, options) {
    execCalls.push({ command, args, options });
    return { stdout: '[]' };
  }
});
await cliAdapter.listTasks();
assert.equal(execCalls.length, 1);
assert.equal(execCalls[0].options.env.KEEP_ME, 'yes');
assert.equal('HERMES_DELEGATED_CHILD_CONTEXT' in execCalls[0].options.env, false, 'the read-only Tower adapter does not inherit a delegation mutation guard that makes Hermes list fail');

await fs.rm(root, { recursive: true, force: true });
await fs.rm(linkedRoot, { recursive: true, force: true });
await fs.rm(outsideRoot, { recursive: true, force: true });
console.log('tower-alfred-studio.test: OK');
