import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installTowerAlfredApp } from '../sidecar/tower-alfred/install-macos-app.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installerSource = fs.readFileSync(path.join(root, 'sidecar', 'tower-alfred', 'install-macos-app.mjs'), 'utf8');
assert.ok(!installerSource.includes('unlink(LOCK_FILE)'), 'the lock inode remains persistent across shutdowns');
assert.ok(installerSource.includes('O_CLOEXEC'), 'lock ownership cannot leak into browser or sidecar helper execs');
assert.ok(installerSource.includes('static int open_owned_instance(int lock_fd)'), 'duplicate readiness follows the currently held lock generation');
assert.ok(installerSource.includes('read_owner_nonce(lock_fd, owner_nonce) && tower_ready(owner_nonce)'), 'duplicate clicks retry the owner nonce instead of waiting on stale lock contents');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-alfred-app-test-'));
try {
  const home = path.join(scratch, 'home');
  const installDir = path.join(home, 'Applications');
  fs.mkdirSync(home, { recursive: true });

  for (const port of [-1, 0, 1.5, 65536, Number.NaN]) {
    assert.throws(() => installTowerAlfredApp({ home, installDir, port, desktopAlias: false, register: false, sign: false }), /port/i, `invalid port ${String(port)} is rejected before installation`);
  }

  const protectedInstallDir = path.join(home, 'Protected Applications');
  const protectedApp = path.join(protectedInstallDir, 'Tower Alfred.app');
  const marker = path.join(protectedApp, 'keep-me');
  fs.mkdirSync(protectedApp, { recursive: true });
  fs.writeFileSync(marker, 'existing working app');
  const badClang = path.join(scratch, 'bad-clang');
  fs.writeFileSync(badClang, '#!/bin/sh\nexit 23\n');
  fs.chmodSync(badClang, 0o755);
  assert.throws(() => installTowerAlfredApp({
    home,
    installDir: protectedInstallDir,
    nodePath: process.execPath,
    clangPath: badClang,
    desktopAlias: false,
    register: false,
    sign: false
  }), /clang|spawn/i, 'a failed replacement build is reported');
  assert.equal(fs.readFileSync(marker, 'utf8'), 'existing working app', 'a failed replacement build preserves the installed app');

  const result = installTowerAlfredApp({
    home,
    installDir,
    nodePath: process.execPath,
    desktopAlias: false,
    register: false,
    sign: false
  });

  assert.equal(result.appPath, path.join(installDir, 'Tower Alfred.app'));
  assert.ok(fs.statSync(result.appPath).isDirectory(), 'installer creates a clickable .app bundle');
  assert.ok(fs.statSync(result.executable).mode & 0o100, 'bundle launcher is executable');
  assert.equal(fs.readFileSync(result.executable).subarray(0, 4).toString('hex'), 'cffaedfe', 'LaunchServices receives a native arm64 Mach-O executable');
  const plist = fs.readFileSync(path.join(result.appPath, 'Contents', 'Info.plist'), 'utf8');
  assert.match(plist, /com\.landoncn\.tower-alfred/, 'bundle has an independent Tower Alfred identifier');
  assert.match(plist, /<string>Tower Alfred<\/string>/, 'bundle presents the Tower Alfred product name');
  assert.ok(fs.statSync(path.join(result.appPath, 'Contents', 'Resources', 'TowerAlfred.icns')).size > 1000, 'bundle carries original Tower Alfred icon artwork');

  const launcher = fs.readFileSync(result.executable, 'latin1');
  assert.ok(launcher.includes(path.join(root, 'bin', 'starnet.mjs')), 'click path launches this repository’s Tower command');
  assert.ok(launcher.includes('launcher.lock'), 'native launcher owns an atomic per-user instance lock');
  assert.ok(launcher.includes('flock'), 'duplicate-click arbitration uses an OS-held lock rather than a racy port probe');
  assert.ok(launcher.includes('arc4random_buf'), 'each owned launch receives an unpredictable 256-bit readiness nonce');
  assert.ok(launcher.includes('TOWER_ALFRED_LAUNCH_NONCE'), 'the nonce is passed only to the exact owned Tower child');
  assert.ok(launcher.includes('pread'), 'duplicate clicks read the owner nonce from the locked state file');
  assert.ok(launcher.includes('lock_still_held'), 'a waiting duplicate rechecks lock ownership before opening the browser');
  assert.ok(launcher.includes('sigaction'), 'native app termination installs signal forwarding for the owned Tower child');
  assert.ok(launcher.includes('supervised_child'), 'the native supervisor tracks only its exact owned child');
  assert.ok(launcher.includes('--no-open'), 'only the lock-owning native launcher opens the browser after its child is ready');
  assert.ok(launcher.includes('--port'), 'the sidecar receives the same validated port that the native launcher probes');
  assert.ok(launcher.includes('window.__TOWER_ALFRED_BOOT__='), 'readiness is checked only after instance ownership is established');
  assert.ok(!launcher.startsWith('#!'), 'bundle uses a native executable accepted by LaunchServices');
  assert.ok(!launcher.includes('eval '), 'bundle launcher does not evaluate dynamic shell text');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log('tower-alfred-macos-app.test: OK');
