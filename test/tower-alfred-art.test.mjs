import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetRoot = path.join(root, 'frontend', 'assets');
const towerRoot = path.join(assetRoot, 'tower-alfred');
const manifestPath = path.join(assetRoot, 'sprites', 'manifest.json');
const manifestBytes = fs.readFileSync(manifestPath);
assert.ok(manifestBytes.includes(Buffer.from('\r\n')), 'art generation preserves the canonical CRLF sprite manifest formatting');
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const css = fs.readFileSync(path.join(root, 'frontend', 'css', 'tower-alfred.css'), 'utf8');
const brand = fs.readFileSync(path.join(root, 'frontend', 'app', 'tower-alfred.js'), 'utf8');
const dataShim = fs.readFileSync(path.join(root, 'frontend', 'app', 'data-shim.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');

function pngSize(file) {
  const data = fs.readFileSync(file);
  assert.equal(data.toString('ascii', 1, 4), 'PNG', `${file} is a PNG`);
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

assert.deepEqual(pngSize(path.join(towerRoot, 'tower-alfred-icon.png')), [1024, 1024], 'app icon has a full-resolution square master');
assert.deepEqual(pngSize(path.join(towerRoot, 'sanctum-overlay.png')), [1280, 720], 'sanctum overlay matches a widescreen station viewport');
assert.ok(fs.statSync(path.join(towerRoot, 'tower-alfred-wordmark.svg')).size > 500, 'Tower wordmark is an original vector asset');
assert.ok(index.includes('css/tower-alfred.css'), 'Tower presentation stylesheet ships in the frontend');
assert.ok(css.includes('html[data-product="tower-alfred"]'), 'visual overrides are scoped to server-attested Tower mode');
assert.ok(css.includes('sanctum-overlay.png'), 'live camera receives the original gothic skyline overlay');
assert.ok(css.includes("content: 'TOWER ALFRED'"), 'Tower renders its exact independent wordmark without a clipped text mask');
assert.ok(brand.includes('tower-authority-badge'), 'Tower visibly states the Hermes ACP authority connection');
assert.ok(brand.includes('ATTACHED · HERMES ACP'), 'authority badge names the attached runtime rather than a cosmetic provider');
assert.ok(dataShim.includes("window.__TOWER_ALFRED_BOOT__.enabled === true"), 'Night Warden registration requires server-attested Tower boot');
assert.ok(dataShim.includes("DATA.SKINS.nightwarden = { name: 'Night Warden'"), 'original Night Warden supervisor is registered only for Tower');

const keys = Object.keys(manifest.sprites).filter(key => key.startsWith('nightwarden.'));
assert.equal(keys.length, 29, 'Night Warden implements the complete supervisor animation contract');
let files = 0;
for (const key of keys) {
  for (const relative of manifest.sprites[key]) {
    const file = path.join(assetRoot, 'sprites', relative);
    assert.ok(fs.existsSync(file), `${key} frame exists`);
    assert.deepEqual(pngSize(file), [92, 92], `${key} frame matches the sprite engine canvas`);
    files++;
  }
}
assert.equal(files, 107, 'Night Warden ships every generated animation frame');

const independentSurface = [css, brand, fs.readFileSync(path.join(towerRoot, 'tower-alfred-wordmark.svg'), 'utf8')].join('\n');
assert.ok(!/batman|dark knight|terraria/i.test(independentSurface), 'shipped Tower branding does not claim third-party character or game identity');

console.log('tower-alfred-art.test: OK');
