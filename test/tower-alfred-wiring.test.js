'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'sidecar', 'index.js'), 'utf8');

assert.ok(source.includes("process.env.TOWER_ALFRED === '1'"), 'Tower mode is explicit and disabled by default');
assert.ok(source.includes("import('./tower-alfred/http-handlers.mjs')"), 'Tower HTTP module is lazy-loaded');
assert.ok(source.includes("window.__TOWER_ALFRED_BOOT__="), 'Tower mode is attested by the sidecar in served HTML');
assert.ok(source.includes('process.env.TOWER_ALFRED_LAUNCH_NONCE'), 'sidecar reads the owned native launcher nonce');
assert.ok(source.includes("/^[a-f0-9]{64}$/"), 'sidecar accepts only a canonical 256-bit hex launcher nonce');
assert.ok(source.includes('launchNonce: towerLaunchNonce'), 'owned nonce is bound into server boot attestation');
assert.ok(source.includes("exact: '/api/tower/status'"), 'Tower status route is wired');
assert.ok(source.includes("exact: '/api/tower/run'"), 'Tower prompt stream route is wired');
assert.ok(source.includes("exact: '/api/tower/consent'"), 'Tower permission route is wired');
assert.ok(source.includes("exact: '/api/tower/cancel'"), 'Tower cancellation route is wired');
assert.ok(source.includes("hermesCommand: process.env.TOWER_ALFRED_HERMES_COMMAND || 'hermes'"), 'Tower sidecar passes the preflight-validated Hermes executable into the ACP runtime');
assert.ok(source.includes('towerStop.finally'), 'graceful shutdown waits for Tower ACP cleanup before exiting');
assert.ok(source.includes("killAllBackground()).catch(swallow('execution.shutdown'))"), 'async execution cleanup cannot become an unhandled rejection');
assert.ok(source.includes("killAllBackground()).catch(swallow('execution.halt'))"), 'E-STOP observes asynchronous backend cleanup');
assert.ok(source.includes("towerAlfredService.cancel({})).catch(swallow('tower-alfred.halt'))"), 'E-STOP cancels every active Tower Hermes run');

console.log('tower-alfred-wiring.test: OK');
