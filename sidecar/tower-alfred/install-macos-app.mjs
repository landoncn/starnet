#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

function xml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr || result.stdout || 'unknown error';
    throw new Error(`${path.basename(command)} failed: ${String(detail).trim()}`);
  }
}

function makeIcon(source, destination, scratch) {
  const iconset = path.join(scratch, 'TowerAlfred.iconset');
  fs.mkdirSync(iconset, { recursive: true });
  for (const [name, size] of [[16, 16], [16, 32], [32, 32], [32, 64], [128, 128], [128, 256], [256, 256], [256, 512], [512, 512], [512, 1024]]) {
    const retina = size === name * 2;
    const filename = `icon_${name}x${name}${retina ? '@2x' : ''}.png`;
    run('/usr/bin/sips', ['-z', String(size), String(size), source, '--out', path.join(iconset, filename)]);
  }
  run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', destination]);
}

function installBundleAtomically({ stagedAppPath, appPath, clangPath, scratch }) {
  if (!fs.existsSync(appPath)) {
    fs.renameSync(stagedAppPath, appPath);
    return;
  }

  const source = path.join(scratch, 'tower-alfred-atomic-swap.c');
  const executable = path.join(scratch, 'tower-alfred-atomic-swap');
  fs.writeFileSync(source, `#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
int main(int argc, char **argv) {
  if (argc != 3) return 2;
  if (renameatx_np(AT_FDCWD, argv[1], AT_FDCWD, argv[2], RENAME_SWAP) == 0) return 0;
  perror("renameatx_np(RENAME_SWAP)");
  return errno ? errno : 1;
}
`);
  run(clangPath, ['-Os', '-Wall', '-Wextra', '-arch', process.arch === 'arm64' ? 'arm64' : 'x86_64', source, '-o', executable]);
  run(executable, [stagedAppPath, appPath]);
  // After RENAME_SWAP, the new bundle is continuously visible at appPath and
  // the displaced old bundle is at stagedAppPath for build-root cleanup.
}

export function installTowerAlfredApp(options = {}) {
  if (process.platform !== 'darwin') throw new Error('Tower Alfred desktop installation currently requires macOS');
  const home = options.home || os.homedir();
  const installDir = path.resolve(options.installDir || path.join(home, 'Applications'));
  const appPath = path.join(installDir, 'Tower Alfred.app');
  const nodePath = path.resolve(options.nodePath || process.execPath);
  const clangPath = path.resolve(options.clangPath || '/usr/bin/clang');
  const cliPath = path.join(repoRoot, 'bin', 'starnet.mjs');
  const iconSource = path.join(repoRoot, 'frontend', 'assets', 'tower-alfred', 'tower-alfred-icon.png');
  const logDir = path.join(home, 'Library', 'Logs', 'Tower Alfred');
  const stateDir = path.join(home, 'Library', 'Application Support', 'Tower Alfred');
  const lockPath = path.join(stateDir, 'launcher.lock');
  const port = Number(options.port ?? 8791);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Tower Alfred port must be an integer from 1 to 65535');
  const url = `http://127.0.0.1:${port}/`;

  for (const required of [nodePath, clangPath, cliPath, iconSource]) {
    if (!fs.existsSync(required)) throw new Error(`required Tower Alfred file is missing: ${required}`);
  }

  fs.mkdirSync(installDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const buildRoot = fs.mkdtempSync(path.join(installDir, '.tower-alfred-build-'));
  const stagedAppPath = path.join(buildRoot, 'Tower Alfred.app');
  const contents = path.join(stagedAppPath, 'Contents');
  const macos = path.join(contents, 'MacOS');
  const resources = path.join(contents, 'Resources');
  const executable = path.join(appPath, 'Contents', 'MacOS', 'Tower Alfred');
  const stagedExecutable = path.join(macos, 'Tower Alfred');

  try {
    fs.mkdirSync(macos, { recursive: true });
    fs.mkdirSync(resources, { recursive: true });
    const launcherSource = `#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

static const char *URL = ${JSON.stringify(url)};
static const char *NODE = ${JSON.stringify(nodePath)};
static const char *CLI = ${JSON.stringify(cliPath)};
static const char *REPO = ${JSON.stringify(repoRoot)};
static const char *LOG_FILE = ${JSON.stringify(path.join(logDir, 'launcher.log'))};
static const char *LOCK_FILE = ${JSON.stringify(lockPath)};
static const char *TOWER_MARK = "window.__TOWER_ALFRED_BOOT__=";
static const char *PORT_ARG = ${JSON.stringify(String(port))};
static const char *LAUNCH_PATH = ${JSON.stringify(`${path.dirname(nodePath)}:/opt/homebrew/bin:/usr/local/bin:${path.join(home, '.local', 'bin')}:/usr/bin:/bin`)};
static const int TOWER_PORT = ${port};
static volatile sig_atomic_t stop_requested = 0;
static pid_t supervised_child = -1;

static void forward_stop(int signal_number) {
  (void)signal_number;
  stop_requested = 1;
  if (supervised_child > 0) kill(supervised_child, SIGTERM);
}

static void install_signal_forwarding(void) {
  struct sigaction action;
  memset(&action, 0, sizeof(action));
  action.sa_handler = forward_stop;
  sigemptyset(&action.sa_mask);
  sigaction(SIGTERM, &action, NULL);
  sigaction(SIGINT, &action, NULL);
  sigaction(SIGHUP, &action, NULL);
}

static int valid_nonce(const char *nonce) {
  if (!nonce || strlen(nonce) != 64) return 0;
  for (int i = 0; i < 64; i++) {
    if (!((nonce[i] >= '0' && nonce[i] <= '9') || (nonce[i] >= 'a' && nonce[i] <= 'f'))) return 0;
  }
  return 1;
}

static void generate_nonce(char nonce[65]) {
  unsigned char bytes[32];
  static const char hex[] = "0123456789abcdef";
  arc4random_buf(bytes, sizeof(bytes));
  for (int i = 0; i < 32; i++) {
    nonce[i * 2] = hex[bytes[i] >> 4];
    nonce[i * 2 + 1] = hex[bytes[i] & 15];
  }
  nonce[64] = '\\0';
}

static int read_owner_nonce(int lock_fd, char nonce[65]) {
  ssize_t got = pread(lock_fd, nonce, 64, 0);
  if (got != 64) return 0;
  nonce[64] = '\\0';
  return valid_nonce(nonce);
}

static int lock_still_held(int lock_fd) {
  if (flock(lock_fd, LOCK_EX | LOCK_NB) == 0) {
    flock(lock_fd, LOCK_UN);
    return 0;
  }
  return errno == EWOULDBLOCK;
}

static int connect_local(void) {
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) return -1;
  struct timeval tv = { .tv_sec = 1, .tv_usec = 0 };
  setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
  setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
  struct sockaddr_in addr;
  memset(&addr, 0, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_port = htons(TOWER_PORT);
  inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
  if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) { close(fd); return -1; }
  return fd;
}

static int port_open(void) {
  int fd = connect_local();
  if (fd < 0) return 0;
  close(fd);
  return 1;
}

static int tower_ready(const char *nonce) {
  if (!valid_nonce(nonce)) return 0;
  int fd = connect_local();
  if (fd < 0) return 0;
  const char *request = "GET / HTTP/1.0\\r\\nHost: 127.0.0.1\\r\\nConnection: close\\r\\n\\r\\n";
  if (write(fd, request, strlen(request)) < 0) { close(fd); return 0; }
  char response[65536];
  size_t used = 0;
  ssize_t got;
  while (used + 1 < sizeof(response) && (got = read(fd, response + used, sizeof(response) - used - 1)) > 0) used += (size_t)got;
  close(fd);
  response[used] = '\\0';
  int ok_status = strstr(response, "HTTP/1.0 200") != NULL || strstr(response, "HTTP/1.1 200") != NULL;
  char nonce_mark[96];
  snprintf(nonce_mark, sizeof(nonce_mark), "\\\"launchNonce\\\":\\\"%s\\\"", nonce);
  return ok_status && strstr(response, TOWER_MARK) != NULL && strstr(response, nonce_mark) != NULL;
}

static void open_tower(void) {
  pid_t pid = fork();
  if (pid == 0) { execl("/usr/bin/open", "open", URL, (char *)NULL); _exit(127); }
}

static int wait_for_ready(pid_t child, const char *nonce) {
  for (int i = 0; i < 300; i++) {
    if (stop_requested) return 0;
    int status = 0;
    pid_t ended = waitpid(child, &status, WNOHANG);
    if (ended == child) return 0;
    if (tower_ready(nonce)) return 1;
    usleep(100000);
  }
  return 0;
}

static int open_owned_instance(int lock_fd) {
  char owner_nonce[65];
  for (int i = 0; i < 300; i++) {
    if (!lock_still_held(lock_fd)) return 8;
    if (read_owner_nonce(lock_fd, owner_nonce) && tower_ready(owner_nonce)) {
      char confirmed_nonce[65];
      if (!lock_still_held(lock_fd)) return 8;
      if (!read_owner_nonce(lock_fd, confirmed_nonce) || strcmp(owner_nonce, confirmed_nonce) != 0) continue;
      open_tower();
      return 0;
    }
    usleep(100000);
  }
  return 6;
}

int main(void) {
  int lock_fd = open(LOCK_FILE, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (lock_fd < 0) return 2;
  struct stat lock_stat;
  if (fstat(lock_fd, &lock_stat) != 0 || !S_ISREG(lock_stat.st_mode) || lock_stat.st_uid != getuid()) { close(lock_fd); return 3; }

  if (flock(lock_fd, LOCK_EX | LOCK_NB) != 0) {
    int lock_error = errno;
    int result = (lock_error == EWOULDBLOCK) ? open_owned_instance(lock_fd) : 4;
    close(lock_fd);
    return result;
  }

  if (port_open()) { flock(lock_fd, LOCK_UN); close(lock_fd); return 5; }
  char launch_nonce[65];
  generate_nonce(launch_nonce);
  ftruncate(lock_fd, 0);
  if (pwrite(lock_fd, launch_nonce, 64, 0) != 64 || fsync(lock_fd) != 0) {
    flock(lock_fd, LOCK_UN);
    close(lock_fd);
    return 9;
  }

  pid_t supervisor = fork();
  if (supervisor < 0) { flock(lock_fd, LOCK_UN); close(lock_fd); return 1; }
  if (supervisor > 0) { close(lock_fd); return 0; }
  setsid();
  install_signal_forwarding();

  pid_t child = fork();
  if (child < 0) { flock(lock_fd, LOCK_UN); close(lock_fd); _exit(1); }
  if (child == 0) {
    close(lock_fd);
    chdir(REPO);
    setenv("PATH", LAUNCH_PATH, 1);
    setenv("TOWER_ALFRED_LAUNCH_NONCE", launch_nonce, 1);
    int log = open(LOG_FILE, O_WRONLY | O_CREAT | O_APPEND, 0600);
    if (log >= 0) { dup2(log, STDOUT_FILENO); dup2(log, STDERR_FILENO); if (log > STDERR_FILENO) close(log); }
    int devnull = open("/dev/null", O_RDONLY);
    if (devnull >= 0) { dup2(devnull, STDIN_FILENO); if (devnull > STDERR_FILENO) close(devnull); }
    execl(NODE, NODE, CLI, "alfred", "--no-open", "--port", PORT_ARG, (char *)NULL);
    _exit(127);
  }
  supervised_child = child;

  if (!wait_for_ready(child, launch_nonce)) {
    kill(child, SIGTERM);
    waitpid(child, NULL, 0);
    flock(lock_fd, LOCK_UN);
    close(lock_fd);
    _exit(7);
  }
  open_tower();
  while (waitpid(child, NULL, 0) < 0 && errno == EINTR) {
    if (stop_requested) kill(child, SIGTERM);
  }
  supervised_child = -1;
  flock(lock_fd, LOCK_UN);
  close(lock_fd);
  _exit(0);
}
`;

    const compileScratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-alfred-launcher-'));
    try {
      const source = path.join(compileScratch, 'tower-alfred-launcher.c');
      fs.writeFileSync(source, launcherSource);
      run(clangPath, ['-Os', '-Wall', '-Wextra', '-arch', process.arch === 'arm64' ? 'arm64' : 'x86_64', source, '-o', stagedExecutable]);
    } finally {
      fs.rmSync(compileScratch, { recursive: true, force: true });
    }
    fs.chmodSync(stagedExecutable, 0o755);

    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleDevelopmentRegion</key><string>en</string>
<key>CFBundleDisplayName</key><string>Tower Alfred</string>
<key>CFBundleExecutable</key><string>Tower Alfred</string>
<key>CFBundleIconFile</key><string>TowerAlfred</string>
<key>CFBundleIdentifier</key><string>com.landoncn.tower-alfred</string>
<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
<key>CFBundleName</key><string>Tower Alfred</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>LSUIElement</key><false/>
<key>NSHumanReadableCopyright</key><string>${xml('Tower Alfred — private local command center')}</string>
</dict></plist>
`;
    fs.writeFileSync(path.join(contents, 'Info.plist'), plist);

    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-alfred-icon-'));
    try { makeIcon(iconSource, path.join(resources, 'TowerAlfred.icns'), scratch); }
    finally { fs.rmSync(scratch, { recursive: true, force: true }); }

    run('/usr/bin/plutil', ['-lint', path.join(contents, 'Info.plist')]);
    if (options.sign !== false && fs.existsSync('/usr/bin/codesign')) run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', stagedAppPath]);

    installBundleAtomically({ stagedAppPath, appPath, clangPath, scratch: buildRoot });
  } finally {
    fs.rmSync(buildRoot, { recursive: true, force: true });
  }

  let desktopPath = null;
  if (options.desktopAlias !== false) {
    const desktop = path.join(home, 'Desktop');
    if (fs.existsSync(desktop)) {
      desktopPath = path.join(desktop, 'Tower Alfred.app');
      try {
        const current = fs.lstatSync(desktopPath);
        if (current.isSymbolicLink()) fs.unlinkSync(desktopPath);
        else desktopPath = null;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (desktopPath) fs.symlinkSync(appPath, desktopPath);
    }
  }

  const register = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
  if (options.register !== false && fs.existsSync(register)) run(register, ['-f', appPath]);
  return { appPath, desktopPath, executable, nodePath, cliPath, url };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--install-dir') out.installDir = argv[++i];
    else if (argv[i] === '--home') out.home = argv[++i];
    else if (argv[i] === '--node') out.nodePath = argv[++i];
    else if (argv[i] === '--port') out.port = Number(argv[++i]);
    else if (argv[i] === '--no-desktop-alias') out.desktopAlias = false;
    else if (argv[i] === '--no-register') out.register = false;
    else if (argv[i] === '--no-sign') out.sign = false;
    else throw new Error(`unknown option: ${argv[i]}`);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = installTowerAlfredApp(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(`Tower Alfred app installation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
