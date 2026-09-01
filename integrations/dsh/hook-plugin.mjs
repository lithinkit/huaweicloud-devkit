// hook-plugin.mjs — DSH Cordis Hook Plugin
// Intercepts Huawei Cloud skill calls and hcloud CLI commands,
// writes events to hook-events.jsonl for the telemetry module to consume.

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ══════════════════════════════════════════════════════════════════
// Cordis plugin identity (required by DSH loader)
// ══════════════════════════════════════════════════════════════════
export const name = 'huaweicloud-devkit-hook';
export const inject = ['tools'];

// ══════════════════════════════════════════════════════════════════
// Paths — this file lives in $DSH_HOME/huaweicloud-plugins/
// ══════════════════════════════════════════════════════════════════
const __filename = fileURLToPath(import.meta.url);
const PLUGIN_DIR = dirname(__filename);
// telemetry/ dir is the single shared location for event files
const TELEMETRY_DIR = join(PLUGIN_DIR, 'telemetry');
const HOOK_EVENTS_PATH = join(TELEMETRY_DIR, 'hook-events.jsonl');

const DEBUG = process.env.HUAWEICLOUD_DEVKIT_DEBUG === 'true';

// ══════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════

function ensureDir(dirPath) {
  if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
}

function debugLog(msg) {
  if (!DEBUG) return;
  try {
    const logPath = join(TELEMETRY_DIR, 'telemetry-debug.log');
    ensureDir(TELEMETRY_DIR);
    appendFileSync(logPath, `${new Date().toISOString()} [hook] ${msg}\n`, 'utf8');
  } catch {
    // debug log is best-effort; never fail the plugin
  }
}

function writeEvent(key, value, extra = {}) {
  try {
    ensureDir(TELEMETRY_DIR);
    const line = JSON.stringify({ key, value, ...extra }) + '\n';
    appendFileSync(HOOK_EVENTS_PATH, line, 'utf8');
    debugLog(`writeEvent key=${key} value=${value}`);
  } catch (err) {
    debugLog(`writeEvent FAILED: ${err.message}`);
  }
}

// ══════════════════════════════════════════════════════════════════
// Huawei Cloud identification
// ══════════════════════════════════════════════════════════════════

function isHuaweiCloudSkill(name) {
  return typeof name === 'string' && /^huawei/i.test(name);
}

// ══════════════════════════════════════════════════════════════════
// hcloud command classification (mirrors skill-tracker.js)
// ══════════════════════════════════════════════════════════════════

const HCLOUD_RE = /(?:^|[;&|]\s*)hcloud(?:\.exe)?\s+(.+)/i;
const READ_VERBS = /\b(List|Show|Get|Describe|NovaList|NovaShow)\w*/i;
const WRITE_VERBS = /\b(Create|Delete|Update|Modify|Remove|Revoke|Grant|Attach|Detach|Enable|Disable|Set|Add|Bind|Unbind|Reset|Change|Activate|Deactivate|Register|Unregister|Import|Export|Download|Upload|Copy|Move|Convert|Migrate|Run|Execute|Invoke|Trigger|Deploy|Push|Start|Stop|Restart|Reboot|Suspend|Resume|Terminate|Release|Allocate)\w*/i;

function classifyHcloud(text) {
  const m = HCLOUD_RE.exec(text);
  if (!m) return null;
  const rest = m[1].trim();
  const parts = rest.split(/\s+/).filter(p => !p.startsWith('--'));
  const cmd = parts.join(' ');
  if (!cmd) return null;
  if (READ_VERBS.test(cmd))  return { key: 'cli:read',  value: `hcloud ${cmd}`, capability: 'cli' };
  if (WRITE_VERBS.test(cmd)) return { key: 'cli:write', value: `hcloud ${cmd}`, capability: 'cli' };
  return { key: 'cli:invoke', value: `hcloud ${cmd}`, capability: 'cli' };
}

// ══════════════════════════════════════════════════════════════════
// apply() — Cordis plugin entry point
// ══════════════════════════════════════════════════════════════════

export function apply(ctx) {
  debugLog('=== PLUGIN LOADED ===');

  // ── Layer 1: tools/pre-execute waterfall ──────────────────────
  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      debugLog(`pre-execute tool=${exec.name}`);

      // ── Intercept 1: skill tool calls ──
      if (exec.name === 'skill') {
        const skillName = exec.arguments?.name || '';
        debugLog(`skill name=${skillName}`);
        if (isHuaweiCloudSkill(skillName)) {
          writeEvent('skill:retrieve', skillName);
          ctx.logger.info(`[hw-hook] skill called: ${skillName}`);
          debugLog(`SKILL TRACKED: ${skillName}`);
        }
      }

      // ── Intercept 2: pwsh/bash with hcloud commands ──
      if (exec.name === 'pwsh' || exec.name === 'bash') {
        const command = exec.arguments?.command || '';
        if (!command) return next();

        if (HCLOUD_RE.test(command)) {
          debugLog(`hcloud command: ${command.slice(0, 120)}`);

          // Classify and write event
          const classified = classifyHcloud(command);
          if (classified) {
            writeEvent(classified.key, classified.value, { capability: 'cli' });
            debugLog(`CLI TRACKED: ${classified.key} ${classified.value}`);
          }
        }
      }

      // ── Intercept 3: MCP Huawei Cloud tools (record only) ──
      if (exec.name.startsWith('mcp__huaweicloud__')) {
        writeEvent(`tool:${exec.name}`, '1', { capability: 'mcp' });
        debugLog(`MCP tool: ${exec.name}`);
      }
    } catch (err) {
      debugLog(`pre-execute ERROR: ${err?.message || err}`);
      ctx.logger.warn(`[hw-hook] pre-execute error: ${err.message}`);
    }
    return next();
  });

  // ── Layer 2: tools/result observe ─────────────────────────────
  ctx.on('tools/result', (exec, result) => {
    if (exec.name.startsWith('mcp__huaweicloud__') && result.isError) {
      const msg = result.error?.message || 'unknown error';
      debugLog(`tool error: ${exec.name}: ${msg}`);
      ctx.logger.info(`[hw-hook] tool error: ${exec.name}: ${msg}`);
    }
  });

  ctx.logger.info('[hw-hook] DSH Huawei Cloud hook plugin activated');
  debugLog('=== PLUGIN INIT DONE ===');
}