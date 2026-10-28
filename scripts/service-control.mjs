/**
 * STREETO service controller.
 *
 * Used by the desktop control panel and by hand:
 *
 *   node scripts/service-control.mjs status
 *   node scripts/service-control.mjs install
 *   node scripts/service-control.mjs start
 *   node scripts/service-control.mjs stop
 *   node scripts/service-control.mjs restart
 *
 * `install` is idempotent: on a new machine it checks for Node, the
 * cloudflared binary, the environment file, the Cloudflared service and the
 * STREETO server task. Anything missing or pointing at an old path is
 * created/updated, then both are started.
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import {
  platform,
  isWindows,
  isMac,
  isLinux,
  ensureCloudflared,
  installServices,
  startServices,
  stopServices,
  restartServices,
  serviceStatus,
  portFree,
  shQuiet,
  APP_TASK,
  TUNNEL_SERVICE,
} from './lib/runtime.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENV_FILE = path.join(ROOT, '.env.production');
const LOG_FILE = path.join(ROOT, 'data', 'logs', 'server.log');
const PUBLIC_URL = 'https://streeto.net';

if (fs.existsSync(ENV_FILE)) {
  try { process.loadEnvFile(ENV_FILE); } catch { /* older Node or malformed file */ }
}

const argv = process.argv.slice(2);
const command = (argv.find((arg) => !arg.startsWith('-')) || 'status').toLowerCase();
const json = argv.includes('--json');

const say = (message) => {
  if (!json) console.log(message);
};

const fail = (message) => {
  if (json) console.log(JSON.stringify({ ok: false, error: message }));
  else console.error(message);
  process.exit(1);
};

const envValue = (name) => String(process.env[name] || '').trim();

function serviceInstalled() {
  if (isWindows) {
    const tunnel = shQuiet('sc.exe', ['query', TUNNEL_SERVICE]);
    const task = shQuiet('powershell.exe', [
      '-NoProfile', '-Command',
      `(Get-ScheduledTask -TaskName '${APP_TASK}' -ErrorAction SilentlyContinue).State`,
    ]).trim();
    return {
      app: Boolean(task),
      tunnel: /STATE|FAILED/.test(tunnel),
    };
  }
  if (isMac) {
    const list = shQuiet('launchctl', ['list']);
    return {
      app: list.includes('net.streeto.server'),
      tunnel: list.includes('net.cloudflare.cloudflared'),
    };
  }
  return {
    app: Boolean(shQuiet('systemctl', ['cat', 'streeto.service']).trim()),
    tunnel: Boolean(shQuiet('systemctl', ['cat', 'cloudflared.service']).trim()),
  };
}

function tunnelToken() {
  const fromEnv = envValue('CF_TUNNEL_TOKEN');
  if (fromEnv) return fromEnv;
  if (isWindows) {
    const commandLine = shQuiet('powershell.exe', [
      '-NoProfile', '-Command',
      `(Get-CimInstance Win32_Service -Filter "Name='${TUNNEL_SERVICE}'").PathName`,
    ]).trim();
    return /--token\s+(\S+)/.exec(commandLine)?.[1] || '';
  }
  if (isLinux) {
    const unit = shQuiet('systemctl', ['cat', 'cloudflared.service']);
    return /--token\s+(\S+)/.exec(unit)?.[1] || '';
  }
  return '';
}

function httpsOk(url, timeoutMs = 3500) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = https.get(url, { rejectUnauthorized: false, timeout: timeoutMs }, (res) => {
      res.resume();
      done(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('timeout', () => { req.destroy(); done(false); });
    req.on('error', () => done(false));
  });
}

async function status() {
  const services = serviceInstalled();
  const state = await serviceStatus();
  const free = await portFree(443);
  const localHealth = free ? false : await httpsOk('https://localhost:443/api/health');
  const base = envValue('PUBLIC_URL') || PUBLIC_URL;
  const publicHealth = base ? await httpsOk(`${base.replace(/\/+$/, '')}/api/health`) : false;
  return {
    ok: true,
    platform,
    project: ROOT,
    node: process.execPath,
    envFile: ENV_FILE,
    logFile: LOG_FILE,
    services: {
      app: { name: APP_TASK, installed: services.app, state: state.app },
      tunnel: { name: TUNNEL_SERVICE, installed: services.tunnel, state: state.tunnel },
    },
    port443: free ? 'free' : 'listening',
    local: localHealth ? 'ok' : 'down',
    public: { url: base, health: publicHealth ? 'ok' : 'down' },
  };
}

function psQuote(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

/** Stop the old go-live.bat processes for this project, not other apps. */
function stopForeground(token) {
  const script = `
$project = ${psQuote(ROOT)}
$token = ${psQuote(token)}
$listener = Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
  if ($proc -and $proc.CommandLine -like "*$project*" -and $proc.CommandLine -match 'server\\.js|run-server\\.mjs') {
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Output 'Stopped the foreground STREETO server.'
  }
}
if ($token) {
  $svc = Get-CimInstance Win32_Service -Filter "Name='Cloudflared'" -ErrorAction SilentlyContinue
  $svcPid = if ($svc) { [int]$svc.ProcessId } else { 0 }
  Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $svcPid -and $_.CommandLine -like "*$token*" } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      Write-Output 'Stopped a foreground cloudflared connector.'
    }
}`;
  const output = shQuiet('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script,
  ]).trim();
  if (output) say(output);
}

async function install() {
  if (!fs.existsSync(ENV_FILE)) {
    fail(`Missing ${ENV_FILE}. Create it with "npm run golive" or copy it from the old server.`);
  }

  const token = tunnelToken();
  if (!token && !serviceInstalled().tunnel) {
    fail('No CF_TUNNEL_TOKEN in .env.production. Run "npm run golive" once to create the tunnel.');
  }

  // Switching from go-live.bat to services: stop only the foreground
  // server/tunnel belonging to this project. Another app on port 443 or
  // another Cloudflare tunnel is left alone.
  if (isWindows) stopForeground(token);

  say('Checking cloudflared...');
  const exe = await ensureCloudflared(say);
  say(`cloudflared: ${exe}`);
  say('Installing/updating the Cloudflared service and STREETO server task...');
  await installServices({
    exe,
    token,
    node: process.execPath,
    project: ROOT,
    envFile: ENV_FILE,
    log: say,
  });
  say('Starting services...');
  startServices();
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const result = await status();
  if (json) console.log(JSON.stringify(result));
  else {
    say(`Server: ${result.services.app.state} (${result.services.app.installed ? 'installed' : 'missing'})`);
    say(`Tunnel: ${result.services.tunnel.state} (${result.services.tunnel.installed ? 'installed' : 'missing'})`);
    say(`Local HTTPS: ${result.local}`);
    say(`Public site: ${result.public.health}`);
    say(`Log: ${result.logFile}`);
  }
  if (!result.local || !result.public) {
    say('Warning: the services were installed, but the health check is not green yet. Check the log.');
  }
}

async function main() {
  if (isWindows && ['install', 'start', 'stop', 'restart'].includes(command)) {
    const admin = shQuiet('powershell.exe', [
      '-NoProfile', '-Command',
      "$p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent()); $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
    ]).trim();
    if (admin !== 'True') {
      fail('Administrator rights are needed. Use STREETO Control or run this command in an elevated PowerShell.');
    }
  }

  if (command === 'status') {
    const result = await status();
    if (json) console.log(JSON.stringify(result));
    else {
      console.log(`Platform: ${result.platform}`);
      console.log(`Project:  ${result.project}`);
      console.log(`Server:   ${result.services.app.state} (${result.services.app.installed ? 'installed' : 'missing'})`);
      console.log(`Tunnel:   ${result.services.tunnel.state} (${result.services.tunnel.installed ? 'installed' : 'missing'})`);
      console.log(`Port 443: ${result.port443}`);
      console.log(`Local:    ${result.local}`);
      console.log(`Public:   ${result.public.url} (${result.public.health})`);
      console.log(`Log:      ${result.logFile}`);
    }
    return;
  }

  if (command === 'install') return install();
  if (command === 'start') {
    startServices();
    say('Start requested.');
  } else if (command === 'stop') {
    stopServices();
    say('Stop requested.');
  } else if (command === 'restart') {
    restartServices();
    say('Restart requested.');
  } else {
    fail(`Unknown command "${command}". Use status, install, start, stop or restart.`);
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));
  const result = await status();
  if (json) console.log(JSON.stringify(result));
  else console.log(`Server: ${result.services.app.state}; tunnel: ${result.services.tunnel.state}; local: ${result.local}; public: ${result.public.health}`);
}

main().catch((error) => fail(error?.message || String(error)));
