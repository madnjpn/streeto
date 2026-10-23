/**
 * OS-specific bits of the go-live automation: installing the cloudflared
 * connector and registering the app and the connector as services that
 * start with the machine.
 *
 *   Windows   - a Windows service for cloudflared, a scheduled task for the app
 *   Linux     - systemd units for both
 *   macOS     - launchd agents for both
 */
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const platform = os.platform();
export const isWindows = platform === 'win32';
export const isMac = platform === 'darwin';
export const isLinux = platform === 'linux';

export const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';

/** Where the cloudflared binary lives per platform. */
export function cloudflaredPaths() {
  if (isWindows) {
    return {
      system: 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
      user: path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'cloudflared', 'cloudflared.exe'),
    };
  }
  return {
    system: '/usr/local/bin/cloudflared',
    user: path.join(os.homedir(), '.local', 'bin', 'cloudflared'),
  };
}

/** The download URL for the running platform. */
export function cloudflaredUrl() {
  if (isWindows) {
    return `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-${arch}.exe`;
  }
  if (isMac) {
    return `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${arch}.tgz`;
  }
  return `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`;
}

/** Run a command, returning stdout. Throws with the stderr on failure. */
export async function sh(command, args, options = {}) {
  const { stdout } = await run(command, args, { windowsHide: true, ...options });
  return stdout;
}

/** Run a command, ignoring failures. */
export function shQuiet(command, args, options = {}) {
  try {
    return execFileSync(command, args, { windowsHide: true, encoding: 'utf8', ...options });
  } catch {
    return '';
  }
}

/** Is a TCP port free on this machine? */
export function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '0.0.0.0');
  });
}

/* ── cloudflared binary ─────────────────────────────────────────────── */

/**
 * Make sure a cloudflared binary exists and return its path.
 * On Windows the system location needs admin rights, so we fall back to a
 * per-user install when we cannot write there.
 */
export async function ensureCloudflared(log) {
  const paths = cloudflaredPaths();
  if (fs.existsSync(paths.system)) return paths.system;
  if (fs.existsSync(paths.user)) return paths.user;

  log('Downloading cloudflared...');
  const tmp = path.join(os.tmpdir(), `cloudflared-${Date.now()}${isWindows ? '.exe' : isMac ? '.tgz' : ''}`);
  const res = await fetch(cloudflaredUrl(), { redirect: 'follow', signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`Could not download cloudflared (${res.status})`);
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));

  let binary = tmp;
  if (isMac) {
    const { execFileSync: sync } = await import('node:child_process');
    sync('tar', ['-xzf', tmp, '-C', os.tmpdir()]);
    binary = path.join(os.tmpdir(), 'cloudflared');
  }
  fs.chmodSync(binary, 0o755);

  // Try the system location first, then the per-user one.
  for (const target of [paths.system, paths.user]) {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(binary, target);
      if (!isWindows) fs.chmodSync(target, 0o755);
      log(`Installed cloudflared at ${target}`);
      return target;
    } catch {
      /* try the next location */
    }
  }
  throw new Error('Could not install cloudflared - run this as administrator.');
}

/* ── services ───────────────────────────────────────────────────────── */

const APP_TASK = 'STREETO server';
const TUNNEL_SERVICE = 'Cloudflared';

async function windowsServiceExists(name) {
  const out = shQuiet('sc.exe', ['query', name]);
  return out.includes('STATE') || out.includes('FAILED');
}

/** The current command line of a Windows service, or null. */
async function windowsServiceConfig(name) {
  const out = shQuiet('powershell.exe', [
    '-NoProfile', '-Command',
    `(Get-CimInstance Win32_Service -Filter "Name='${name}'").PathName`,
  ]).trim();
  return out || null;
}

/** Register the cloudflared connector as a service that starts with Windows. */
export async function installTunnelServiceWindows({ exe, token, log }) {
  const existing = await windowsServiceExists(TUNNEL_SERVICE);
  if (existing) {
    // Keep the token the service already has, only move the binary.
    const current = (await windowsServiceConfig(TUNNEL_SERVICE)) || '';
    const currentToken = /--token\s+(\S+)/.exec(current)?.[1];
    const wanted = `"${exe}" tunnel run --token ${currentToken || token}`;
    if (!current.includes(exe) || (currentToken && currentToken !== token)) {
      shQuiet('sc.exe', ['config', TUNNEL_SERVICE, 'binPath=', wanted, 'start=', 'auto']);
      const after = (await windowsServiceConfig(TUNNEL_SERVICE)) || '';
      if (after.includes(exe)) log('Updated the Cloudflared service to use the new binary.');
      else log('Could not update the Cloudflared service - administrator rights are needed.');
    }
  } else {
    shQuiet('sc.exe', ['create', TUNNEL_SERVICE, `binPath= "${exe}" tunnel run --token ${token}`, 'start=', 'auto', 'DisplayName=', 'Cloudflared agent']);
    log('Created the Cloudflared service.');
  }
  shQuiet('sc.exe', ['config', TUNNEL_SERVICE, 'start=', 'auto']);
  shQuiet('sc.exe', ['start', TUNNEL_SERVICE]);

  const state = shQuiet('sc.exe', ['query', TUNNEL_SERVICE]);
  if (!/RUNNING/.test(state)) {
    throw new Error(
      'The Cloudflared service could not be started. Open PowerShell as ' +
        'administrator and run "npm run golive" again.',
    );
  }
}

/** Register the app as a scheduled task that starts with Windows. */
export async function installAppServiceWindows({ node, project, envFile, log }) {
  const task = [
    'powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
    `$a = New-ScheduledTaskAction -Execute '${node}' -Argument '--env-file="${envFile}" "${path.join(project, 'server.js')}"' -WorkingDirectory '${project}';` +
    `$t = New-ScheduledTaskTrigger -AtStartup;` +
    `$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero);` +
    `$p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest;` +
    `Unregister-ScheduledTask -TaskName '${APP_TASK}' -Confirm:$false -ErrorAction SilentlyContinue;` +
    `Register-ScheduledTask -TaskName '${APP_TASK}' -Action $a -Trigger $t -Settings $s -Principal $p -Force | Out-Null;` +
    `Start-ScheduledTask -TaskName '${APP_TASK}';`,
  ];
  shQuiet('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', task.join(' ')]);
  const state = shQuiet('powershell.exe', [
    '-NoProfile', '-Command',
    `(Get-ScheduledTask -TaskName '${APP_TASK}' -ErrorAction SilentlyContinue).State`,
  ]).trim();
  if (!state) {
    throw new Error(
      'The scheduled task could not be registered. Open PowerShell as ' +
        'administrator and run "npm run golive" again.',
    );
  }
  log(`Registered the "${APP_TASK}" scheduled task (${state}).`);
}

/** systemd units for Linux. */
export async function installSystemdUnits({ exe, token, node, project, envFile, log }) {
  const tunnelUnit = `[Unit]
Description=Cloudflare Tunnel connector
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${exe} tunnel --no-autoupdate run --token ${token}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
  const appUnit = `[Unit]
Description=STREETO server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${project}
ExecStart=${node} --env-file=${envFile} ${path.join(project, 'server.js')}
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
`;

  const units = '/etc/systemd/system';
  fs.writeFileSync(path.join(units, 'cloudflared.service'), tunnelUnit);
  fs.writeFileSync(path.join(units, 'streeto.service'), appUnit);
  shQuiet('systemctl', ['daemon-reload']);
  shQuiet('systemctl', ['enable', '--now', 'cloudflared.service']);
  shQuiet('systemctl', ['enable', '--now', 'streeto.service']);
  log('Installed the cloudflared.service and streeto.service systemd units.');
}

/** launchd agents for macOS. */
export async function installLaunchdAgents({ exe, token, node, project, envFile, log }) {
  const agents = path.join(os.homedir(), 'Library', 'LaunchAgents');
  fs.mkdirSync(agents, { recursive: true });

  const tunnelPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>net.cloudflare.cloudflared</string>
<key>ProgramArguments</key><array><string>${exe}</string><string>tunnel</string><string>--no-autoupdate</string><string>run</string><string>--token</string><string>${token}</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
</dict></plist>
`;
  const appPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>net.streeto.server</string>
<key>ProgramArguments</key><array><string>${node}</string><string>--env-file=${envFile}</string><string>${path.join(project, 'server.js')}</string></array>
<key>WorkingDirectory</key><string>${project}</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
</dict></plist>
`;
  fs.writeFileSync(path.join(agents, 'net.cloudflare.cloudflared.plist'), tunnelPlist);
  fs.writeFileSync(path.join(agents, 'net.streeto.server.plist'), appPlist);
  shQuiet('launchctl', ['load', '-w', path.join(agents, 'net.cloudflare.cloudflared.plist')]);
  shQuiet('launchctl', ['load', '-w', path.join(agents, 'net.streeto.server.plist')]);
  log('Installed the launchd agents.');
}

/** Install both services for the current platform. */
export async function installServices(options) {
  if (isWindows) {
    await installTunnelServiceWindows(options);
    await installAppServiceWindows(options);
    return;
  }
  if (isMac) {
    await installLaunchdAgents(options);
    return;
  }
  await installSystemdUnits(options);
}

/** A short status of the services, for the report at the end. */
export async function serviceStatus() {
  if (isWindows) {
    const tunnel = shQuiet('sc.exe', ['query', 'Cloudflared']);
    const task = shQuiet('powershell.exe', [
      '-NoProfile', '-Command',
      "(Get-ScheduledTask -TaskName 'STREETO server' -ErrorAction SilentlyContinue).State",
    ]).trim();
    return {
      tunnel: /RUNNING/.test(tunnel) ? 'running' : 'stopped',
      app: task || 'not installed',
    };
  }
  if (isMac) {
    return {
      tunnel: shQuiet('launchctl', ['list']).includes('net.cloudflare.cloudflared') ? 'running' : 'stopped',
      app: shQuiet('launchctl', ['list']).includes('net.streeto.server') ? 'running' : 'stopped',
    };
  }
  return {
    tunnel: shQuiet('systemctl', ['is-active', 'cloudflared.service']).trim() || 'stopped',
    app: shQuiet('systemctl', ['is-active', 'streeto.service']).trim() || 'stopped',
  };
}

export default { platform, isWindows, isMac, isLinux, arch, ensureCloudflared, installServices, serviceStatus, portFree, sh, shQuiet };
