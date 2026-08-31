import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync, renameSync, unlinkSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, hostname, type as osType, networkInterfaces, release as osRelease } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

let PLUGIN_VERSION = '0.0.0';
try {
  const __telemDir = dirname(fileURLToPath(import.meta.url));
  const pkgRoots = [join(__telemDir, '..', '..', 'package.json'), join(__telemDir, '..', '..', '..', '..', 'package.json')];
  for (const p of pkgRoots) {
    if (existsSync(p)) {
      const v = JSON.parse(readFileSync(p, 'utf8')).version;
      if (v) { PLUGIN_VERSION = v; break; }
    }
  }
} catch {}

const TELEMETRY_DIR = join(homedir(), '.huaweicloud-devkit', 'telemetry');
const HOOK_EVENTS_PATH = join(TELEMETRY_DIR, 'hook-events.jsonl');
function installStampPath(agent) { return join(TELEMETRY_DIR, agent, 'install-stamp'); }
function installCounterPath(agent) { return join(TELEMETRY_DIR, agent, 'install-counter'); }
const DAU_STAMP = join(TELEMETRY_DIR, 'dau-stamp');
const FIRST_USE_STAMP = join(TELEMETRY_DIR, 'first-use-stamp');
const MACHINE_FINGER_PATH = join(TELEMETRY_DIR, 'machine-finger');
const INSTALLATION_ID_PATH = join(TELEMETRY_DIR, 'installation-id');
const USER_HASH_PATH = join(TELEMETRY_DIR, 'user-hash');

const MAX_QUEUE_SIZE = 500;
const FLUSH_INTERVAL_MS = 60_000;
const BATCH_SIZE = 100;
const FETCH_TIMEOUT_MS = 5000;

const DEFAULT_ENDPOINT = 'https://devkit.huaweicloud.com/rest/developer/server/hdkitservice/telemetry/events';

let eventQueue = [];
let isFlushing = false;
let flushTimer = null;
let lastCheckedDate = '';
let installId = null;
let userHash = null;
let agentHarness = 'unknown';
let agentVersion = '0.0.0';
let osTypeStr = osType();
let osVersionStr = osRelease();

const DEBUG = process.env.HUAWEICLOUD_DEVKIT_DEBUG === 'true';
const DEBUG_LOG = join(TELEMETRY_DIR, 'telemetry-debug.log');

function debugLog(msg) {
  if (!DEBUG) return;
  try {
    if (!existsSync(TELEMETRY_DIR)) mkdirSync(TELEMETRY_DIR, { recursive: true });
    appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`, 'utf8');
  } catch (_) {}
}

function ensureDir(dirPath = TELEMETRY_DIR) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function readTextFile(filePath) {
  try {
    return readFileSync(filePath, 'utf8').trim();
  } catch {
    return null;
  }
}

function writeTextFile(filePath, content) {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, content, 'utf8');
}

function touchFile(filePath) {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, '', 'utf8');
}

function stampExists(filePath) {
  return existsSync(filePath);
}

function getStampUTCDate(filePath) {
  try {
    return new Date(statSync(filePath).mtime).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function getUTCToday() {
  return new Date().toISOString().slice(0, 10);
}

function generateMachineFinger() {
  const host = hostname();
  const nets = networkInterfaces();
  let firstMac = '';
  for (const key of Object.keys(nets).sort()) {
    const iface = nets[key].find((a) => a.mac && a.mac !== '00:00:00:00:00:00');
    if (iface) { firstMac = iface.mac; break; }
  }
  const factor = `${host}|${firstMac}|${osTypeStr}|${homedir()}`;
  return createHash('sha256').update(factor).digest('hex');
}

export function generateOrRecoverInstallId() {
  ensureDir();
  if (existsSync(INSTALLATION_ID_PATH)) {
    const cached = readTextFile(INSTALLATION_ID_PATH);
    if (cached) return cached;
  }
  const finger = existsSync(MACHINE_FINGER_PATH) ? readTextFile(MACHINE_FINGER_PATH) : generateMachineFinger();
  if (!finger) {
    const fallback = randomUUID();
    writeTextFile(INSTALLATION_ID_PATH, fallback);
    return fallback;
  }
  writeTextFile(MACHINE_FINGER_PATH, finger);
  const id = createHash('sha256').update(finger).digest('hex');
  writeTextFile(INSTALLATION_ID_PATH, id);
  return id;
}

function loadUserHash() {
  if (existsSync(USER_HASH_PATH)) {
    const cached = readTextFile(USER_HASH_PATH);
    if (cached) userHash = cached;
  }
}

export function isTelemetryEnabled() {
  return process.env.HUAWEICLOUD_DEVKIT_TELEMETRY !== 'off';
}

function getEndpoint() {
  return process.env.HUAWEICLOUD_DEVKIT_TELEMETRY_ENDPOINT || DEFAULT_ENDPOINT;
}

function capabilityFromKey(key) {
  if (key.startsWith('tool:')) return 'mcp';
  if (key.startsWith('cli:')) return 'cli';
  return undefined;
}

function buildEvent(raw) {
  const event = {
    key: raw.key,
    value: raw.value,
    installId: installId,
    userHash: userHash,
    version: PLUGIN_VERSION,
    harness: agentHarness,
    agentVersion: agentVersion,
    os: osTypeStr,
    osVersion: osVersionStr,
  };
  const cap = raw.capability || capabilityFromKey(raw.key);
  if (cap) event.capability = cap;
  return event;
}

export function enqueueEvent(raw) {
  if (!isTelemetryEnabled()) return;
  if (!installId) return;

  ingestHookEvents();

  checkDauPing();

  const event = buildEvent(raw);
  eventQueue.push(event);

  if (eventQueue.length > MAX_QUEUE_SIZE) {
    eventQueue = eventQueue.slice(eventQueue.length - MAX_QUEUE_SIZE);
  }

  if (eventQueue.length >= BATCH_SIZE) setImmediate(() => flushEvents());
}

function checkDauPing() {
  const today = getUTCToday();
  if (today !== lastCheckedDate) {
    lastCheckedDate = today;
    if (shouldSendDauPing()) {
      eventQueue.unshift(buildEvent({ key: 'dau:active_today', value: '1' }));
    }
  }
}

function shouldSendDauPing() {
  if (!existsSync(DAU_STAMP)) return true;
  const stampDate = getStampUTCDate(DAU_STAMP);
  return stampDate !== getUTCToday();
}

function shouldSendFirstUsePing() {
  return !stampExists(FIRST_USE_STAMP);
}

export function trackInstall(agent) {
  if (!isTelemetryEnabled()) return;
  ensureDir();
  writeTextFile(installStampPath(agent), new Date().toISOString());

  let count = 0;
  const existing = readTextFile(installCounterPath(agent));
  if (existing) count = parseInt(existing, 10) || 0;
  writeTextFile(installCounterPath(agent), String(count + 1));
}

function consumeInstallCounter(agent) {
  ensureDir();
  const existing = readTextFile(installCounterPath(agent));
  if (!existing) return 0;
  const count = parseInt(existing, 10) || 0;
  if (count <= 0) return 0;
  writeTextFile(installCounterPath(agent), '0');
  return count;
}

export function ingestHookEvents() {
  const processingPath = HOOK_EVENTS_PATH + '.processing';
  if (existsSync(processingPath)) {
    try {
      const lines = readFileSync(processingPath, 'utf8').trim().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          eventQueue.push(buildEvent(parsed));
        } catch {}
      }
    } catch {
    } finally {
      try { unlinkSync(processingPath); } catch {}
    }
  }
  if (!existsSync(HOOK_EVENTS_PATH)) return;
  try {
    renameSync(HOOK_EVENTS_PATH, processingPath);
  } catch {
    return;
  }
  try {
    const lines = readFileSync(processingPath, 'utf8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        eventQueue.push(buildEvent(parsed));
      } catch {}
    }
  } catch {
  } finally {
    try { unlinkSync(processingPath); } catch {}
  }
}

export function trackToolInvoke(toolName, value = '1') {
  if (!isTelemetryEnabled()) return;
  enqueueEvent({ key: `tool:${toolName}`, value });
}

export function trackSkillRetrieve(skillName) {
  if (!isTelemetryEnabled()) return;
  enqueueEvent({ key: 'skill:retrieve', value: skillName });
}

export function trackSandboxConnect() {
  if (!isTelemetryEnabled()) return;
  enqueueEvent({ key: 'sandbox:connect', value: '1' });
}

export function trackSandboxDisconnect() {
  if (!isTelemetryEnabled()) return;
  enqueueEvent({ key: 'sandbox:disconnect', value: '1' });
}

export function cacheUserHash(hash) {
  if (!hash) return;
  userHash = hash;
  ensureDir();
  writeTextFile(USER_HASH_PATH, hash);
}

function flushEvents() {
  if (isFlushing) return;
  if (eventQueue.length === 0) return;
  isFlushing = true;

  const batch = eventQueue.splice(0, BATCH_SIZE);
  const keys = batch.map((e) => e.key).join(',');
  debugLog(`FLUSH start events=${batch.length} harness=${batch[0].harness} agentVersion=${batch[0].agentVersion} keys=[${keys}]`);

  const endpoint = getEndpoint();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batch),
    signal: controller.signal,
  })
    .then((resp) => {
      clearTimeout(timer);
      debugLog(`POST status=${resp.status} events=${batch.length}`);
      if (resp.ok) {
        for (const event of batch) {
          if (event.key === 'dau:active_today') touchFile(DAU_STAMP);
          if (event.key === 'plugin:install') touchFile(INSTALL_STAMP);
          if (event.key === 'plugin:first_use') touchFile(FIRST_USE_STAMP);
        }
      } else {
        eventQueue = [...batch, ...eventQueue];
      }
      isFlushing = false;
    })
    .catch((err) => {
      clearTimeout(timer);
      debugLog(`POST FAIL err=${err.message} events=${batch.length}`);
      eventQueue = [...batch, ...eventQueue];
      isFlushing = false;
    });
}

export function initTelemetry({ harness, version }) {
  installId = generateOrRecoverInstallId();
  agentHarness = harness || 'unknown';
  agentVersion = version || '0.0.0';
  loadUserHash();

  if (!isTelemetryEnabled()) return;

  if (!stampExists(installStampPath(agentHarness)) && !existsSync(installCounterPath(agentHarness))) {
    trackInstall(agentHarness);
  }

  const pendingInstalls = consumeInstallCounter(agentHarness);
  for (let i = 0; i < pendingInstalls; i++) {
    enqueueEvent({ key: 'plugin:install', value: '1' });
  }

  if (shouldSendFirstUsePing()) {
    enqueueEvent({ key: 'plugin:first_use', value: '1' });
  }

  if (flushTimer) clearInterval(flushTimer);
  flushTimer = setInterval(() => {
    ingestHookEvents();
    checkDauPing();
    if (eventQueue.length > 0) setImmediate(() => flushEvents());
  }, FLUSH_INTERVAL_MS);

  ingestHookEvents();
  if (eventQueue.length > 0) setImmediate(() => flushEvents());
}