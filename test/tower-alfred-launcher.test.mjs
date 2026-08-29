import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildLaunchPlan,
  loadTowerConfig,
  parseTowerArgs
} from '../sidecar/tower-alfred/launcher.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const parsed = parseTowerArgs(['alfred', '--no-open', '--port', '18877', '--profile', 'research']);
assert.deepEqual(parsed, {
  command: 'alfred',
  noOpen: true,
  port: 18877,
  profile: 'research',
  configPath: null
});
assert.throws(() => parseTowerArgs(['other']), /usage: starnet alfred/);
assert.throws(() => parseTowerArgs(['alfred', '--port', '0']), /port must be/);
assert.throws(() => parseTowerArgs(['alfred', '--unknown']), /unknown option/);
assert.deepEqual(parseTowerArgs(['--help']), { help: true });
assert.deepEqual(parseTowerArgs(['alfred', '--help']), { help: true });

const config = await loadTowerConfig(path.join(repoRoot, 'tower-alfred.config.json'));
assert.equal(config.product.name, 'Tower Alfred');
assert.equal(config.hermes.profile, 'default');
assert.equal(config.server.port, 8791);
assert.equal(config.studio.projectRoot, '/Users/alfred/Projects/Anglers-Hollow');
assert.equal(config.studio.kanbanBoard, 'anglers-hollow');
assert.throws(() => buildLaunchPlan({
  repoRoot,
  config: { ...config, server: { ...config.server, host: 'evil.example' } },
  cli: parsed,
  nodePath: '/test/node',
  baseEnv: { PATH: '/test/bin' }
}), /loopback/, 'Tower launch URLs cannot target an external host');

const plan = buildLaunchPlan({
  repoRoot,
  config,
  cli: parsed,
  nodePath: '/test/node',
  baseEnv: { PATH: '/test/bin', STARNET_PORT: '9999' }
});
assert.equal(plan.command, '/test/node');
assert.deepEqual(plan.args, [path.join(repoRoot, 'sidecar', 'index.js')]);
assert.equal(plan.cwd, repoRoot);
assert.equal(plan.env.TOWER_ALFRED, '1');
assert.equal(plan.env.TOWER_ALFRED_PROFILE, 'research');
assert.equal(plan.env.TOWER_ALFRED_HERMES_COMMAND, config.hermes.command, 'the sidecar executes the exact Hermes binary that passed preflight');
assert.equal(plan.env.TOWER_ALFRED_PRODUCT, 'Tower Alfred');
assert.equal(plan.env.TOWER_ALFRED_NAME, 'ALFRED');
assert.equal(plan.env.TOWER_ALFRED_STUDIO_ROOT, '/Users/alfred/Projects/Anglers-Hollow');
assert.equal(plan.env.TOWER_ALFRED_STUDIO_BOARD, 'anglers-hollow');
assert.equal(plan.env.PORT, '18877');
assert.equal(plan.env.STARNET_PORT, '18877');
assert.equal(plan.env.STARNET_WORKSPACES, path.join(repoRoot, '.tower-alfred', 'workspaces'));
assert.equal('WORKSPACES' in plan.env, false);
const launchedUrl = new URL(plan.url);
assert.equal(launchedUrl.origin, 'http://127.0.0.1:18877');
assert.equal(launchedUrl.search, '', 'Tower authority and identity are not carried in a user-controlled query');
assert.equal(plan.openBrowser, false);
assert.equal(plan.env.PATH, '/test/bin');

console.log('tower-alfred-launcher.test: OK');
