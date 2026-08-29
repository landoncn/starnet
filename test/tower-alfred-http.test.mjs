import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createTowerAlfredHttpHandlers } from '../sidecar/tower-alfred/http-handlers.mjs';

function response() {
  return {
    statusCode: 200,
    headers: null,
    chunks: [],
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; },
    write(chunk) { this.chunks.push(String(chunk)); },
    end(chunk) { if (chunk != null) this.chunks.push(String(chunk)); this.ended = true; }
  };
}

const calls = [];
const service = {
  status() { return { enabled: true, supervisor: 'ALFRED' }; },
  async run(body, emit) {
    calls.push(['run', body]);
    emit({ name: 'agent.run.start', payload: { runId: 'r1' } });
    emit({ name: 'agent.token', payload: { delta: 'Online.' } });
    emit({ name: 'agent.run.end', payload: { runId: 'r1', reason: 'end_turn' } });
  },
  resolvePermission(body) { calls.push(['permission', body]); return { ok: true, decision: 'allow_once' }; },
  async cancel() { calls.push(['cancel']); return { ok: true, cancelled: true }; },
  async studioStatus() { calls.push(['studio']); return { ok: true, studio: { id: 'anglers-hollow' }, agents: [], artifacts: [] }; },
  async readStudioArtifact(file) {
    calls.push(['artifact', file]);
    return { data: Buffer.from('RIFFtest'), mime: 'audio/wav', bytes: 8, path: file };
  }
};
const handlers = createTowerAlfredHttpHandlers({
  service,
  async readBody(req) { return req.body; }
});

const statusRes = response();
await handlers.status({}, statusRes);
assert.equal(statusRes.statusCode, 200);
assert.deepEqual(JSON.parse(statusRes.chunks.join('')), { enabled: true, supervisor: 'ALFRED' });

const studioRes = response();
await handlers.studio({}, studioRes);
assert.equal(studioRes.statusCode, 200);
assert.deepEqual(JSON.parse(studioRes.chunks.join('')).studio, { id: 'anglers-hollow' });

const artifactRes = {
  statusCode: 200,
  headers: {},
  writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; },
  end(chunk) { this.body = chunk; this.ended = true; }
};
await handlers.studioArtifact({ url: '/api/tower/studio/artifact?path=studio%2Fartifacts%2Flake.wav' }, artifactRes);
assert.equal(artifactRes.statusCode, 200);
assert.equal(artifactRes.headers['Content-Type'], 'audio/wav');
assert.equal(artifactRes.headers['Content-Length'], '8');
assert.deepEqual(artifactRes.body, Buffer.from('RIFFtest'));
assert.deepEqual(calls.find(row => row[0] === 'artifact'), ['artifact', 'studio/artifacts/lake.wav']);

const missingArtifactRes = response();
await handlers.studioArtifact({ url: '/api/tower/studio/artifact' }, missingArtifactRes);
assert.equal(missingArtifactRes.statusCode, 400);

const privateErrorHandlers = createTowerAlfredHttpHandlers({
  service: { async readStudioArtifact() { throw new Error('ENOENT /Users/private/project/secret.wav'); } },
  async readBody(req) { return req.body; }
});
const privateErrorRes = response();
await privateErrorHandlers.studioArtifact({ url: '/api/tower/studio/artifact?path=studio%2Fartifacts%2Fmissing.wav' }, privateErrorRes);
assert.equal(privateErrorRes.statusCode, 404);
assert.deepEqual(JSON.parse(privateErrorRes.chunks.join('')), { ok: false, error: 'Artifact preview unavailable' });

const privateStatusHandlers = createTowerAlfredHttpHandlers({
  service: {
    status() { return { enabled: true }; },
    async studioStatus() { throw new Error('read failed at /Users/alfred/Projects/Anglers-Hollow/studio/manifest.json'); }
  },
  readBody: async () => ({})
});
const privateStatusRes = response();
await privateStatusHandlers.studio({}, privateStatusRes);
assert.equal(privateStatusRes.statusCode, 503);
assert.deepEqual(JSON.parse(privateStatusRes.chunks.join('')), { ok: false, error: 'Studio telemetry unavailable' });

const runRes = response();
await handlers.run({ body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }) }, runRes);
assert.equal(runRes.statusCode, 200);
assert.equal(runRes.headers['Content-Type'], 'application/x-ndjson; charset=utf-8');
assert.deepEqual(runRes.chunks.join('').trim().split('\n').map(JSON.parse).map(row => row.name), [
  'agent.run.start', 'agent.token', 'agent.run.end'
]);

const consentRes = response();
await handlers.consent({ body: JSON.stringify({ runId: 'r1', promptId: 'p1', decision: 'once' }) }, consentRes);
assert.deepEqual(JSON.parse(consentRes.chunks.join('')), { ok: true, decision: 'allow_once' });

const cancelRes = response();
await handlers.cancel({ body: '{}' }, cancelRes);
assert.deepEqual(JSON.parse(cancelRes.chunks.join('')), { ok: true, cancelled: true });

const badRes = response();
await handlers.run({ body: '{' }, badRes);
assert.equal(badRes.statusCode, 400);
assert.match(JSON.parse(badRes.chunks.join('')).error, /bad json/);

let releaseDisconnected;
let disconnectedCancel = null;
const disconnectService = {
  status() { return {}; },
  async run(_body, emit) {
    emit({ name: 'agent.run.start', payload: { runId: 'disconnect-run' } });
    await new Promise(resolve => { releaseDisconnected = resolve; });
  },
  async cancel(body) { disconnectedCancel = body; releaseDisconnected(); return { ok: true, cancelled: true }; },
  resolvePermission() { return { ok: false }; }
};
const disconnectHandlers = createTowerAlfredHttpHandlers({ disconnectService, service: disconnectService, readBody: async req => req.body });
const disconnectReq = new EventEmitter();
disconnectReq.body = JSON.stringify({ streamId: 'disconnect-stream', messages: [{ role: 'user', content: 'work' }] });
const disconnectRes = Object.assign(new EventEmitter(), response(), { writableEnded: false, destroyed: false });
const disconnectedRun = disconnectHandlers.run(disconnectReq, disconnectRes);
await new Promise(resolve => setImmediate(resolve));
disconnectRes.emit('close');
const disconnectedOutcome = await Promise.race([
  disconnectedRun.then(() => 'finished'),
  new Promise(resolve => setTimeout(() => resolve('timed-out'), 500))
]);
assert.equal(disconnectedOutcome, 'finished', 'client disconnect cancels the still-running ACP prompt');
assert.deepEqual(disconnectedCancel, { runId: 'disconnect-run' }, 'disconnect cancellation targets the exact run');

const failingService = {
  status() { return {}; },
  async run(_body, emit) {
    emit({ name: 'agent.run.start', payload: { runId: 'failed-run' } });
    emit({ name: 'agent.run.error', payload: { runId: 'failed-run', message: 'failed once' } });
    emit({ name: 'agent.run.end', payload: { runId: 'failed-run', reason: 'error' } });
    throw new Error('failed once');
  },
  async cancel() { return { ok: true, cancelled: false }; },
  resolvePermission() { return { ok: false }; }
};
const failingHandlers = createTowerAlfredHttpHandlers({ service: failingService, readBody: async req => req.body });
const failingRes = response();
await failingHandlers.run({ body: JSON.stringify({ messages: [{ role: 'user', content: 'fail' }] }) }, failingRes);
const failingEvents = failingRes.chunks.join('').trim().split('\n').map(JSON.parse);
assert.equal(failingEvents.filter(event => event.name === 'agent.run.error').length, 1, 'a Tower run failure is streamed exactly once');
assert.equal(failingEvents.find(event => event.name === 'agent.run.error').payload.runId, 'failed-run', 'the single failure remains keyed to its run');

console.log('tower-alfred-http.test: OK');
