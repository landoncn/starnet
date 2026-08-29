'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
const harness = fs.readFileSync(path.join(root, 'frontend', 'app', 'harness.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend', 'app', 'app.js'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'frontend', 'app', 'chat.js'), 'utf8');
const brand = fs.readFileSync(path.join(root, 'frontend', 'app', 'tower-alfred.js'), 'utf8');

const brandPos = index.indexOf('app/tower-alfred.js');
const harnessPos = index.indexOf('app/harness.js');
assert.ok(brandPos >= 0 && brandPos < harnessPos, 'Tower identity loads before the harness');
assert.ok(harness.includes("const TOWER_MODE = !!window.__TOWER_ALFRED__"), 'harness has an explicit Tower mode');
assert.ok(harness.includes("const getModel = () => TOWER_MODE ? 'hermes/' + String(window.__TOWER_ALFRED__.profile || 'default')"), 'Tower model metadata follows the server-attested Hermes profile');
assert.ok(harness.includes("'/api/tower/run'"), 'Tower chat uses the Hermes ACP stream');
assert.ok(harness.includes("'/api/tower/consent'"), 'Tower permissions use the ACP broker');
assert.ok(harness.includes("'/api/tower/cancel'"), 'Tower cancellation reaches Hermes ACP');
assert.ok(app.includes('function towerAlfredInitialSave()'), 'fresh Tower launches seed ALFRED as visual supervisor');
assert.ok(app.includes("supervisor || 'ALFRED'"), 'ALFRED remains the default head identity');
assert.ok(app.includes("provider: 'hermes'"), 'the visual supervisor is explicitly Hermes-backed');
assert.ok(app.includes('tower.supervisor'), 'seeded supervisor name comes from Tower configuration');
assert.ok(brand.includes('window.__TOWER_ALFRED_BOOT__'), 'Tower mode requires a server-injected attestation');
assert.ok(!brand.includes("params.get('tower')"), 'a user-controlled query cannot activate Tower mode');
assert.ok(brand.includes('boot.productName'), 'product name comes from server-attested configuration');
assert.ok(brand.includes('boot.supervisor'), 'supervisor identity comes from server-attested configuration');
assert.ok(brand.includes('boot.role'), 'supervisor role comes from server-attested configuration');
assert.ok(chat.includes('option.optionId'), 'Tower consent buttons submit exact ACP option ids');
assert.ok(chat.includes('options: ev.options'), 'background permission snapshots preserve exact ACP options');

console.log('tower-alfred-frontend.test: OK');
