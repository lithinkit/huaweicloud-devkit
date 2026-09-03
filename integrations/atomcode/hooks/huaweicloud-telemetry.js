/**
 * huaweicloud-telemetry.js — AtomCode PreToolUse Hook
 *
 * Captures Skill loading, hcloud CLI commands, and MCP tool invocations,
 * writing structured events to hook-events.jsonl for the devkit telemetry
 * module to ingest and report.
 *
 * Classification logic mirrors the existing four platform hooks exactly.
 * This hook NEVER blocks execution — it always exits 0.
 */

import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ══════════════════════════════════════════════════════════════════
// Debug
// ══════════════════════════════════════════════════════════════════

const DEBUG = process.env.HUAWEICLOUD_DEVKIT_DEBUG === 'true';

function debugLog(msg) {
  if (!DEBUG) return;
  try {
    const logPath = join(TELEMETRY_DIR, 'atomcode-debug.log');
    appendFileSync(logPath, `${new Date().toISOString()} ${msg}\n`);
  } catch (_) { /* best-effort */ }
}

// ══════════════════════════════════════════════════════════════════
// Paths — hook is installed at <plugin_dir>/hooks/
// ══════════════════════════════════════════════════════════════════

const __filename = fileURLToPath(import.meta.url);
const HOOK_DIR = dirname(__filename);
const PLUGIN_DIR = dirname(HOOK_DIR);
const TELEMETRY_DIR = join(PLUGIN_DIR, 'telemetry');
const HOOK_EVENTS_PATH = join(TELEMETRY_DIR, 'hook-events.jsonl');

// ══════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════

function ensureDir(dirPath) {
  if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
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
// Skill identification
// ══════════════════════════════════════════════════════════════════

function isHuaweiCloudSkill(name) {
  return typeof name === 'string' && /^huawei/i.test(name);
}

// ══════════════════════════════════════════════════════════════════
// CLI command classification (matches skill-tracker.js exactly)
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
  if (READ_VERBS.test(cmd))  return { key: 'cli:read',  value: `hcloud ${cmd}` };
  if (WRITE_VERBS.test(cmd)) return { key: 'cli:write', value: `hcloud ${cmd}` };
  return { key: 'cli:invoke', value: `hcloud ${cmd}` };
}

// ══════════════════════════════════════════════════════════════════
// Input parsing — stdin JSON, with env-var fallback
// ══════════════════════════════════════════════════════════════════

function parseInput() {
  // Primary: AtomCode passes data via env vars
  const toolName = process.env.ATOMCODE_TOOL_NAME || '';
  const context = process.env.ATOMCODE_HOOK_CONTEXT || '';
  if (toolName || context) {
    const input = { tool_name: toolName };
    if (context) {
      try {
        input.tool_input = JSON.parse(context);
      } catch (_) {
        input.tool_input = { command: context };
      }
    } else {
      input.tool_input = {};
    }
    return input;
  }

  // Fallback: stdin JSON (piped for manual testing)
  try {
    const data = readFileSync(0, 'utf8').trim();
    if (data) return JSON.parse(data);
  } catch (_) { /* stdin unavailable */ }

  return { tool_name: '', tool_input: {} };
}

function extractCommand(toolInput) {
  if (typeof toolInput === 'string') return toolInput;
  if (toolInput && typeof toolInput === 'object') {
    return toolInput.command || toolInput.arguments?.command || '';
  }
  return '';
}

function extractSkillName(toolInput) {
  if (typeof toolInput === 'string') return toolInput;
  if (toolInput && typeof toolInput === 'object') {
    return toolInput.name || toolInput.command || '';
  }
  return '';
}

// ══════════════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════════════

try {
  const input = parseInput();
  const toolName = input.tool_name || input.tool || '';
  const toolInput = input.tool_input || input.arguments || {};

  debugLog(`tool=${toolName}`);

  // ── Category 1: Skill tool calls ──
  if (toolName === 'skill' || toolName === 'use_skill') {
    const skillName = extractSkillName(toolInput);
    debugLog(`skill name=${skillName}`);
    if (isHuaweiCloudSkill(skillName)) {
      writeEvent('skill:retrieve', skillName);
    }
  }

  // ── Category 2: Bash/pwsh with hcloud commands ──
  if (toolName === 'bash' || toolName === 'pwsh') {
    const command = extractCommand(toolInput);
    if (command && HCLOUD_RE.test(command)) {
      debugLog(`hcloud command: ${command.slice(0, 120)}`);
      const classified = classifyHcloud(command);
      if (classified) {
        writeEvent(classified.key, classified.value, { capability: 'cli' });
      }
    }
  }

  // ── Category 3: MCP Huawei Cloud tools ──
  if (toolName.startsWith('mcp__huaweicloud')) {
    writeEvent(`tool:${toolName}`, '1', { capability: 'mcp' });
    debugLog(`MCP tool: ${toolName}`);
  }
} catch (err) {
  debugLog(`FATAL: ${err?.message || err}`);
}

// Always allow — telemetry hook never blocks
process.exit(0);