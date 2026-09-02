#!/usr/bin/env node
import { stdin, stdout } from 'node:process';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';

function detectHarnessFromPath() {
  const selfPath = new URL(import.meta.url).pathname.toLowerCase();
  if (selfPath.includes('/.codeartsdoer/')) return 'codearts';
  if (selfPath.includes('/.config/opencode/')) return 'opencode';
  if (selfPath.includes('/.codex/')) return 'codex-desktop';
  if (selfPath.includes('/.workbuddy/')) return 'workbuddy';
  if (selfPath.includes('/.atomcode/')) return 'atomcode';
  if (selfPath.includes('/.dsh/')) return 'dsh';
  if (selfPath.includes('/.hermes/')) return 'hermes';
  if (selfPath.includes('/hermes/')) return 'hermes';
  if (selfPath.includes('/.officeace/')) return 'officeace';
  return null;
}

function detectIdeVersion() {
  const bases = [];
  if (process.env.ProgramFiles) bases.push(join(process.env.ProgramFiles, 'CodeArts Agent'));
  if (process.env['ProgramFiles(x86)']) bases.push(join(process.env['ProgramFiles(x86)'], 'CodeArts Agent'));
  if (process.env.ProgramW6432) bases.push(join(process.env.ProgramW6432, 'CodeArts Agent'));
  if (process.env.LOCALAPPDATA) bases.push(join(process.env.LOCALAPPDATA, 'Programs', 'CodeArts'));
  for (const base of bases) {
    const p = join(base, 'resources', 'app', 'package.json');
    try {
      if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')).version || null;
    } catch {}
  }
  return null;
}

function detectDshVersion() {
  try {
    const npmGlobal = process.env.APPDATA
      ? join(process.env.APPDATA, 'npm', 'node_modules')
      : join(homedir(), '.npm-global', 'lib', 'node_modules');
    const p = join(npmGlobal, '@deepseek-ai', 'dsh', 'package.json');
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')).version || null;
  } catch {}
  return null;
}

function detectHermesVersion() {
  // 1. Explicit env var (set by Hermes or user config)
  if (process.env.HERMES_VERSION) return process.env.HERMES_VERSION;
  // 2. Read from hermes_cli/__init__.py in the Hermes install dir
  const candidates = [];
  if (process.env.HERMES_HOME) candidates.push(process.env.HERMES_HOME);
  if (process.env.LOCALAPPDATA) candidates.push(join(process.env.LOCALAPPDATA, 'hermes', 'hermes-agent'));
  candidates.push(join(homedir(), '.hermes', 'hermes-agent'));
  for (const base of candidates) {
    try {
      const initFile = join(base, 'hermes_cli', '__init__.py');
      if (existsSync(initFile)) {
        const content = readFileSync(initFile, 'utf8');
        const m = content.match(/__version__\s*=\s*['"]([^'"]+)['"]/);
        if (m) return m[1];
      }
    } catch {}
  }
  return null;
}

function detectWorkBuddyVersion() {
  const username = process.env.USERNAME || basename(homedir());
  const relPath = join('Users', username, 'AppData', 'Local', 'Programs', 'WorkBuddy');

  // Read resources/install-manifest.json for user-facing "appVersion" (e.g. "5.4.7"),
  // falling back to the "version" file (internal build number like "37.10.3-24").
  function tryBase(base) {
    const manifest = join(base, 'resources', 'install-manifest.json');
    try {
      if (existsSync(manifest)) {
        const m = JSON.parse(readFileSync(manifest, 'utf8'));
        if (m.appVersion) return `v${m.appVersion}`;
      }
    } catch {}
    const verFile = join(base, 'version');
    try { if (existsSync(verFile)) return readFileSync(verFile, 'utf8').trim() || null; } catch {}
    return null;
  }

  // 1. Try LOCALAPPDATA (most common — user profile drive)
  const localApp = join(process.env.LOCALAPPDATA || '', 'Programs', 'WorkBuddy');
  const r = tryBase(localApp);
  if (r) return r;

  // 2. Iterate all logical drives (A-Z) to handle off-profile-drive installs
  for (let d = 'A'.charCodeAt(0); d <= 'Z'.charCodeAt(0); d++) {
    const drive = String.fromCharCode(d) + ':';
    const r2 = tryBase(join(drive, '/', relPath));
    if (r2) return r2;
  }

  return null;
}

import { TOOL_DEFINITIONS, callTool } from './tools.mjs';
import { initTelemetry } from './telemetry/telemetry.mjs';
import { detectAgentHarness } from './telemetry/agent-detect.mjs';

const projectDirIdx = process.argv.indexOf('--codearts-project-dir');
if (projectDirIdx > -1 && process.argv[projectDirIdx + 1]) {
  process.env.CODEARTS_PROJECT_DIR = process.argv[projectDirIdx + 1];
}

const endpointIdx = process.argv.indexOf('--hdkitservice-endpoint');
if (endpointIdx > -1 && process.argv[endpointIdx + 1]) {
  process.env.HDKITSERVICE_ENDPOINT = process.argv[endpointIdx + 1];
}

const telemetryEndpointIdx = process.argv.indexOf('--telemetry-endpoint');
if (telemetryEndpointIdx > -1 && process.argv[telemetryEndpointIdx + 1]) {
  process.env.HUAWEICLOUD_DEVKIT_TELEMETRY_ENDPOINT = process.argv[telemetryEndpointIdx + 1];
}

try {
  const { readProxyConfig } = await import('./proxy/proxy-config.mjs');
  const proxyConfig = readProxyConfig();
  if (proxyConfig) {
    if (proxyConfig.https_proxy || proxyConfig.HTTPS_PROXY) {
      process.env.HTTPS_PROXY = process.env.HTTPS_PROXY || proxyConfig.https_proxy || proxyConfig.HTTPS_PROXY;
    }
    if (proxyConfig.http_proxy || proxyConfig.HTTP_PROXY) {
      process.env.HTTP_PROXY = process.env.HTTP_PROXY || proxyConfig.http_proxy || proxyConfig.HTTP_PROXY;
    }
  }
} catch {}

// The MCP server is now loaded by a live agent session. Clear the install marker
// in this plugin dir so `doctor` no longer reports "restart needed".
try {
  const pluginDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const marker = resolve(pluginDir, '.installed');
  if (existsSync(marker)) rmSync(marker, { force: true });
} catch {}

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '..');
const packageRoot = resolve(pluginRoot, '..', '..');
let pkgVersion = '0.0.0';
for (const base of [pluginRoot, packageRoot]) {
  try {
    const version = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')).version;
    if (version) {
      pkgVersion = version;
      break;
    }
  } catch {}
}

let buffer = Buffer.alloc(0);
let useContentLengthFraming = true;

// Keep the event loop alive after stdin is closed (Windows Hermes workaround).
// Node.js exits when no active handles remain; the stdin 'data' listener is
// the only handle. On Windows, Hermes may close the stdin pipe after the
// initial handshake, causing the process to exit silently (exit 0).
//
// When stdin closes, start a keepalive timer. When stdout also closes (normal
// shutdown signal from OfficeAce or other agents), clear the timer and exit.
let keepAlive = null;
function onStdinClose() {
  if (keepAlive) return;
  keepAlive = setInterval(() => {}, 60000);
}
function onStdoutClose() {
  if (keepAlive) {
    clearInterval(keepAlive);
    keepAlive = null;
  }
  process.exitCode = 0;
}
stdin.on('close', onStdinClose);
stdin.on('end', onStdinClose);
stdout.on('close', onStdoutClose);

stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  readFrames();
});

function readFrames() {
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      useContentLengthFraming = true;
      const consumed = parseContentLengthFrame(headerEnd);
      if (!consumed) return;
      continue;
    }

    const lf = buffer.indexOf('\n');
    if (lf !== -1) {
      useContentLengthFraming = false;
      const line = buffer.subarray(0, lf).toString('utf8').trim();
      buffer = buffer.subarray(lf + 1);
      if (line) void handleMessage(JSON.parse(line));
      continue;
    }

    return;
  }
}

function parseContentLengthFrame(headerEnd) {
  const header = buffer.subarray(0, headerEnd).toString('utf8');
  const match = header.match(/Content-Length:\s*(\d+)/i);
  if (!match) {
    buffer = Buffer.alloc(0);
    return true;
  }
  const length = Number(match[1]);
  const bodyStart = headerEnd + 4;
  const bodyEnd = bodyStart + length;
  if (buffer.length < bodyEnd) return false;
  const body = buffer.subarray(bodyStart, bodyEnd).toString('utf8');
  buffer = buffer.subarray(bodyEnd);
  void handleMessage(JSON.parse(body));
  return true;
}

async function handleMessage(message) {
  if (!Object.hasOwn(message, 'id')) {
    if (message.method === 'notifications/initialized') return;
    return;
  }
  try {
    const result = await dispatch(message.method, message.params || {});
    writeMessage({ jsonrpc: '2.0', id: message.id, result });
  } catch (error) {
    writeMessage({
      jsonrpc: '2.0',
      id: message.id,
      error: {
        code: -32603,
        message: error.message,
      },
    });
  }
}

async function dispatch(method, params) {
  if (method === 'initialize') {
    const ci = params.clientInfo || {};

    try {
      const { hdkitGenerateUserHash } = await import('./sandbox/hdkitservice-api.mjs');
      await Promise.race([
        hdkitGenerateUserHash(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
    } catch {}

    const hostHarness = detectHarnessFromPath() || detectAgentHarness() || ci.name || 'unknown';
    const ideVersion = detectIdeVersion();
    const dshVersion = detectDshVersion();
    const wbVersion = detectWorkBuddyVersion();
    const hermesVersion = detectHermesVersion();
    initTelemetry({
      harness: hostHarness,
      version: hostHarness === 'codearts' || hostHarness === 'codex-desktop' || hostHarness === 'cursor'
        ? (ideVersion || ci.version || '0.0.0')
        : hostHarness === 'dsh'
          ? (dshVersion || ci.version || '0.0.0')
          : hostHarness === 'workbuddy'
            ? (wbVersion || ci.version || '0.0.0')
            : hostHarness === 'hermes'
              ? (hermesVersion || ci.version || '0.0.0')
              : (ci.version || '0.0.0'),
    });
    return {
      protocolVersion: params.protocolVersion || '2024-11-05',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'huaweicloud-devkit',
        version: pkgVersion,
      },
    };
  }

  if (method === 'tools/list') {
    return { tools: TOOL_DEFINITIONS };
  }

  if (method === 'tools/call') {
    const result = await callTool(params.name, params.arguments || {});
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
      isError: false,
    };
  }

  if (method === 'resources/list') {
    return { resources: [] };
  }

  throw new Error(`Unsupported method: ${method}`);
}

function writeMessage(message) {
  const json = JSON.stringify(message);
  if (useContentLengthFraming) {
    stdout.write(`Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`);
  } else {
    stdout.write(json + '\n');
  }
}
