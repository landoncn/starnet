#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchTowerAlfred, loadTowerConfig, parseTowerArgs, TOWER_USAGE } from '../sidecar/tower-alfred/launcher.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const cli = parseTowerArgs(process.argv.slice(2));
  if (cli.help) {
    process.stdout.write(`${TOWER_USAGE}\n`);
  } else {
    const configPath = cli.configPath || path.join(repoRoot, 'tower-alfred.config.json');
    const config = await loadTowerConfig(configPath);
    const code = await launchTowerAlfred({ repoRoot, cli, config });
    process.exitCode = code;
  }
} catch (error) {
  process.stderr.write(`starnet: ${error.message}\n`);
  process.exitCode = 1;
}
