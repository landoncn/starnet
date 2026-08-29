'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const modulePath = path.join(root, 'frontend', 'app', 'tower-studio.js');
const index = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
const towerIdentityPos = index.indexOf('app/tower-alfred.js');
const studioPos = index.indexOf('app/tower-studio.js');
const harnessPos = index.indexOf('app/harness.js');
assert.ok(studioPos > towerIdentityPos && studioPos < harnessPos, 'studio command center loads only after server-attested Tower identity and before the harness');

const Studio = require(modulePath);
const { shouldReplaceSnapshot } = Studio;
const state = {
  ok: true,
  studio: { id: 'anglers-hollow', name: "Angler's Hollow: Secrets of the Deep", milestone: 'Stillwater Fish Expansion — Batch A' },
  sources: { tasks: 'kanban', artifacts: 'registry' },
  agents: [
    { profile: 'ahvisual', name: 'LANTERN', role: 'Visual Production Lead', kind: 'visual', provisioned: true, state: 'working', task: { id: 't1', title: 'Create <fish> sprites', status: 'running', updatedAt: 1000 } },
    { profile: 'ahaudio', name: 'ECHO', role: 'Audio Production Lead', kind: 'audio', provisioned: true, state: 'review', task: { id: 't2', title: 'Lake ambience', status: 'review', updatedAt: 900 } },
    { profile: 'ahqa', name: 'WATCHWARDEN', role: 'QA', kind: 'qa', provisioned: true, state: 'idle', task: null }
  ],
  artifacts: [
    { id: 'fish', title: 'Bluegill concept', preview: 'image', previewUrl: '/api/tower/studio/artifact?path=fish', status: 'candidate', creatorProfile: 'ahvisual', note: 'Sprite candidate.' },
    { id: 'lake', title: 'Lake ambience', preview: 'audio', previewUrl: '/api/tower/studio/artifact?path=lake', status: 'sketch', creatorProfile: 'ahaudio', note: 'Loop sketch.' }
  ]
};
assert.equal(shouldReplaceSnapshot(null, { ok: false }), true, 'an initial unavailable response is rendered honestly');
assert.equal(shouldReplaceSnapshot(state, { ok: false, error: 'temporary' }), false, 'a 200-level unavailable payload cannot erase the last verified snapshot');
assert.equal(shouldReplaceSnapshot(state, { ...state, generatedAt: 2 }), true, 'a verified payload refreshes the snapshot');
const html = Studio.render(state);
assert.match(html, /ANGLER’S HOLLOW STUDIO/);
assert.match(html, /Stillwater Fish Expansion — Batch A/);
assert.match(html, /LANTERN/);
assert.match(html, /ECHO/);
assert.match(html, /WATCHWARDEN/);
assert.match(html, /WORKING/);
assert.match(html, /IN REVIEW/);
assert.match(html, /IDLE/);
assert.match(html, /Create &lt;fish&gt; sprites/);
assert.ok(!html.includes('Create <fish> sprites'), 'task text is escaped');
assert.match(html, /data-artifact="fish"/);
assert.match(html, /data-artifact="lake"/);
assert.match(html, /IMAGE PREVIEW/);
assert.match(html, /AUDIO PREVIEW/);
assert.match(html, /aria-label="Preview Bluegill concept image"/);
assert.match(html, /aria-label="Preview Lake ambience audio"/);
assert.ok(!html.includes('<img src='), 'untrusted artifacts are fetched into a blob only after an explicit preview action');
assert.ok(!html.includes('<audio src='), 'untrusted audio is fetched into a blob only after an explicit preview action');

const sevenProfiles = ['ahtech', 'ahgameplay', 'ahbalance', 'ahnarrative', 'ahvisual', 'ahaudio', 'ahqa'];
const seven = Studio.render({
  ok: true,
  board: 'anglers-hollow',
  studio: { id: 'anglers-hollow', name: "Angler's Hollow", milestone: 'Batch A' },
  sources: { tasks: 'kanban', artifacts: 'registry' },
  agents: sevenProfiles.map(profile => ({ profile, name: profile.toUpperCase(), role: 'Studio specialist', state: 'idle', task: null })),
  artifacts: []
});
for (const profile of sevenProfiles) assert.match(seven, new RegExp(profile));

const unavailable = Studio.render({ ok: false, state: 'unavailable', error: 'manifest missing', agents: [], artifacts: [] });
assert.match(unavailable, /STUDIO TELEMETRY UNAVAILABLE/);
assert.match(unavailable, /manifest missing/);

const source = fs.readFileSync(modulePath, 'utf8');
const css = fs.readFileSync(path.join(root, 'frontend', 'css', 'tower-alfred.css'), 'utf8');
assert.ok(source.includes("fetch('/api/tower/studio'"), 'live studio data comes from the Tower API');
assert.ok(source.includes('setTimeout(refresh, 5000)'), 'agent work status refreshes after the previous poll settles');
assert.ok(!source.includes('setInterval('), 'polling cannot overlap through an unmanaged interval');
assert.ok(source.includes('AbortController'), 'the active studio request has a cancellation owner');
assert.ok(source.includes("addEventListener('pagehide'"), 'studio polling and preview blobs have a teardown path');
assert.ok(source.includes('preservePreviews'), 'refreshes preserve loaded preview nodes');
assert.ok(source.includes('if (!host) { revokeBlob(item.id); continue; }'), 'removed artifacts immediately release their preview blob URLs');
assert.ok(source.includes("URL.createObjectURL"), 'art and audio previews use revocable same-page blobs');
assert.ok(source.includes("<audio controls"), 'audio deliverables play inside Tower');
assert.ok(source.includes("<img class=\"tower-studio-image\""), 'visual deliverables render inside Tower');
assert.ok(source.includes("getElementById('screen-game')"), 'the command center is mounted on the returning-user game screen');
assert.ok(css.includes('#tower-studio-command'), 'Tower stylesheet positions the studio command center');
assert.ok(css.includes('.tower-studio-agents'), 'Tower stylesheet provides a readable agent roster grid');
assert.ok(css.includes('.tower-studio-image'), 'Tower stylesheet constrains visual previews inside the command center');
assert.ok(css.includes('@media (max-width: 760px)'), 'studio command center adapts to small windows');

console.log('tower-alfred-studio-frontend.test: OK');
