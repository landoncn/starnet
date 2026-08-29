import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_PORT = 8787;
const PROFILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const TOWER_USAGE = 'usage: starnet alfred [--no-open] [--port PORT] [--profile NAME] [--config PATH]';

function usage(message) {
  const prefix = message ? `${message}\n\n` : '';
  return new Error(`${prefix}${TOWER_USAGE}`);
}

function nextValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw usage(`${flag} requires a value`);
  return value;
}

export function parseTowerArgs(argv) {
  const args = Array.from(argv || []);
  if (args.includes('--help') || args.includes('-h')) return { help: true };
  if (args.shift() !== 'alfred') throw usage();
  const parsed = { command: 'alfred', noOpen: false, port: null, profile: null, configPath: null };
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (flag === '--no-open') parsed.noOpen = true;
    else if (flag === '--port') {
      const value = nextValue(args, i, flag);
      i += 1;
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw usage('port must be an integer from 1 to 65535');
      parsed.port = port;
    } else if (flag === '--profile') {
      const profile = nextValue(args, i, flag);
      i += 1;
      if (!PROFILE_RE.test(profile) || profile.includes('..')) throw usage('invalid Hermes profile');
      parsed.profile = profile;
    } else if (flag === '--config') {
      parsed.configPath = path.resolve(nextValue(args, i, flag));
      i += 1;
    } else if (flag === '--help' || flag === '-h') {
      throw usage();
    } else {
      throw usage(`unknown option: ${flag}`);
    }
  }
  return parsed;
}

function validateConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Tower Alfred config must be an object');
  if (!config.product || typeof config.product.name !== 'string' || !config.product.name.trim()) {
    throw new Error('Tower Alfred config requires product.name');
  }
  const profile = String(config.hermes && config.hermes.profile || 'default');
  if (!PROFILE_RE.test(profile) || profile.includes('..')) throw new Error('Tower Alfred config has an invalid Hermes profile');
  const port = Number(config.server && config.server.port || DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Tower Alfred config has an invalid server port');
  return config;
}

export async function loadTowerConfig(configPath) {
  let raw;
  try { raw = await readFile(configPath, 'utf8'); }
  catch (error) { throw new Error(`cannot read Tower Alfred config ${configPath}: ${error.message}`); }
  try { return validateConfig(JSON.parse(raw)); }
  catch (error) {
    if (error.message.startsWith('Tower Alfred config')) throw error;
    throw new Error(`cannot parse Tower Alfred config ${configPath}: ${error.message}`);
  }
}

export function buildLaunchPlan({ repoRoot, config, cli, nodePath = process.execPath, baseEnv = process.env }) {
  const port = cli.port || Number(config.server.port) || DEFAULT_PORT;
  const profile = cli.profile || config.hermes.profile || 'default';
  const hermesCommand = String(config.hermes.command || 'hermes').trim() || 'hermes';
  const host = String(config.server.host || '127.0.0.1').trim().toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('Tower Alfred server.host must be a loopback host (127.0.0.1 or localhost)');
  }
  const productName = String(config.product.name || 'Tower Alfred').trim();
  const supervisorName = String(config.supervisor && config.supervisor.name || 'ALFRED').trim();
  const supervisorRole = String(config.supervisor && config.supervisor.role || 'Supervisory Intelligence').trim();
  const configuredWorkspaces = String(config.storage && config.storage.workspaces || '.tower-alfred/workspaces');
  const workspaces = path.isAbsolute(configuredWorkspaces)
    ? configuredWorkspaces
    : path.resolve(repoRoot, configuredWorkspaces);
  return {
    command: nodePath,
    args: [path.join(repoRoot, 'sidecar', 'index.js')],
    cwd: repoRoot,
    env: {
      ...baseEnv,
      PORT: String(port),
      STARNET_PORT: String(port),
      TOWER_ALFRED: '1',
      TOWER_ALFRED_CONFIG: cli.configPath || path.join(repoRoot, 'tower-alfred.config.json'),
      TOWER_ALFRED_PROFILE: profile,
      TOWER_ALFRED_HERMES_COMMAND: hermesCommand,
      TOWER_ALFRED_PRODUCT: productName,
      TOWER_ALFRED_NAME: supervisorName,
      TOWER_ALFRED_ROLE: supervisorRole,
      STARNET_WORKSPACES: workspaces
    },
    url: `http://${host}:${port}/`,
    openBrowser: !cli.noOpen && config.server.openBrowser !== false,
    hermes: {
      command: hermesCommand,
      args: ['--profile', profile, 'acp', '--check']
    }
  };
}

function runCheck(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let output = '';
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-4096); });
    child.stderr.on('data', chunk => { output = (output + chunk).slice(-4096); });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(output) : reject(new Error(output.trim() || `${command} exited ${code}`)));
  });
}

async function waitForServer(url, child, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  const root = new URL(url); root.search = '';
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Tower Alfred sidecar exited during startup (${child.exitCode})`);
    try {
      const response = await fetch(root, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Tower Alfred did not become ready at ${root}`);
}

function openUrl(url) {
  if (process.platform === 'darwin') return spawn('open', [url], { stdio: 'ignore', detached: true, shell: false }).unref();
  if (process.platform === 'win32') return spawn('cmd.exe', ['/d', '/s', '/c', 'start', '', url], { stdio: 'ignore', detached: true, windowsHide: true }).unref();
  return spawn('xdg-open', [url], { stdio: 'ignore', detached: true, shell: false }).unref();
}

export async function launchTowerAlfred({ repoRoot, cli, config }) {
  const plan = buildLaunchPlan({ repoRoot, cli, config });
  await runCheck(plan.hermes.command, plan.hermes.args, { cwd: plan.cwd, env: plan.env });
  const child = spawn(plan.command, plan.args, {
    cwd: plan.cwd,
    env: plan.env,
    stdio: ['inherit', 'inherit', 'inherit'],
    shell: false
  });

  const stop = signal => {
    if (child.exitCode == null && child.signalCode == null) child.kill(signal);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    await waitForServer(plan.url, child);
    process.stdout.write(`Tower Alfred online at ${plan.url}\n`);
    if (plan.openBrowser) openUrl(plan.url);
    return await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (signal || code === 0) resolve(code || 0);
        else reject(new Error(`Tower Alfred sidecar exited ${code}`));
      });
    });
  } catch (error) {
    stop('SIGTERM');
    throw error;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
