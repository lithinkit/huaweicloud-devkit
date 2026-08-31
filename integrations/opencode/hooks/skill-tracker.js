import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DEBUG = process.env.HUAWEICLOUD_DEVKIT_DEBUG === 'true';

const telemDir = join(homedir(), '.huaweicloud-devkit', 'telemetry');
if (!existsSync(telemDir)) mkdirSync(telemDir, { recursive: true });

function detectHarness() {
  if (existsSync(join(homedir(), '.codeartsdoer'))) return 'codearts';
  if (process.env.CODEARTS_PROJECT_DIR) return 'codearts';
  if (process.env.OPENCODE_SESSION_ID || process.env.OPENCODE_CONFIG_PATH) return 'opencode';
  if (process.env.CODEX_DESKTOP || process.env.CODEX_ELECTRON) return 'codex-desktop';
  if (process.env.OFFICEACE_SESSION_ID || process.env.OFFICE_CLAW_CONFIG_ROOT) return 'officeace';
  if (process.env.DSH_SESSION_ID || process.env.DSH_HOME) return 'dsh';
  if (process.env.HERMES_SESSION_ID || process.env.HERMES_HOME) return 'hermes';
  return 'unknown';
}

const agentDir = join(telemDir, detectHarness());
if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true });

function debugLog(msg) {
  if (!DEBUG) return;
  try {
    appendFileSync(join(agentDir, 'plugin-debug.log'), `${new Date().toISOString()} ${msg}\n`);
  } catch (_) {}
}

debugLog('=== PLUGIN LOADED ===');

const eventsFile = join(agentDir, 'hook-events.jsonl');
debugLog(`eventsFile=${eventsFile}`);
try { if (!existsSync(eventsFile)) appendFileSync(eventsFile, ''); } catch (_) {}
debugLog(`eventsFile exists=${existsSync(eventsFile)}`);

function isHuaweiCloudSkill(name) {
  return typeof name === 'string' && name && /^huawei/i.test(name);
}

function writeEvent(key, value, extra = {}) {
  const data = JSON.stringify({ key, value, ...extra }) + '\n';
  try { appendFileSync(eventsFile, data); } catch (_) {}
}

// ── CLI command classification ────────────────────────────────

const HCLOUD_RE = /(?:^|[;&|]\s*)hcloud(?:\.exe)?\s+(.+)/i;
const READ_VERBS = /\b(List|Show|Get|Describe|NovaList|NovaShow)\w*/i;
const WRITE_VERBS = new RegExp(
  '\\b(Create|Delete|Update|Modify|Remove|Revoke|Grant|Attach|Detach|'
  + 'Enable|Disable|Set|Add|Bind|Unbind|Reset|Change|Activate|Deactivate|'
  + 'Register|Unregister|Import|Export|Download|Upload|Copy|Move|Convert|'
  + 'Migrate|Run|Execute|Invoke|Trigger|Deploy|Push|Start|Stop|Restart|'
  + 'Reboot|Suspend|Resume|Terminate|Release|Allocate)\\w*',
  'i',
);

function classifyHcloud(text) {
  const m = HCLOUD_RE.exec(text);
  if (!m) return null;
  const rest = m[1].trim();
  const cmdEnd = rest.search(/\s[|&<>;]/);
  const cmdPart = cmdEnd > -1 ? rest.slice(0, cmdEnd) : rest;
  const parts = cmdPart.split(/\s+/).filter(
    (p) => !p.startsWith('--') && !/^\d*>(&?\d*|%devnull)/.test(p) && !/^(&\d+)$/.test(p),
  );
  const cmd = parts.join(' ');
  if (!cmd) return null;
  if (READ_VERBS.test(cmd)) return { key: 'cli:read', value: `hcloud ${cmd}` };
  if (WRITE_VERBS.test(cmd)) return { key: 'cli:write', value: `hcloud ${cmd}` };
  return { key: 'cli:invoke', value: `hcloud ${cmd}` };
}

// ── Plugin export ────────────────────────────────────────────

export default function () {
  debugLog('=== PLUGIN EXPORT CALLED ===');
  return {
    'tool.execute.before': function (input, output) {
      try {
        debugLog(`HOOK tool.execute.before tool=${input?.tool}`);
        if (input.tool === 'skill') {
          const name = output?.args?.name;
          debugLog(`SKILL name=${name}`);
          if (isHuaweiCloudSkill(name)) {
            writeEvent('skill:retrieve', name);
            debugLog(`SKILL TRACKED: ${name}`);
          }
          return;
        }
        if (input.tool === 'bash') {
          const cmd = output?.args?.command || '';
          if (!cmd) return;
          const result = classifyHcloud(cmd);
          if (result) writeEvent(result.key, result.value, { capability: 'cli' });
        }
      } catch (e) {
        debugLog(`HOOK ERROR: ${e?.message || e}`);
      }
    },
    event: function ({ event }) {
      try {
        if (event?.type === 'message.part.updated') {
          const text = event?.properties?.part?.text;
          if (typeof text === 'string') {
            const m = text.match(/Base directory for this skill:\s*.*?skills[\/\\]([a-z0-9-]+)/i);
            if (m && isHuaweiCloudSkill(m[1])) writeEvent('skill:retrieve', m[1]);
          }
        }
      } catch (e) {
        debugLog(`EVENT ERROR: ${e?.message || e}`);
      }
    },
  };
}

debugLog('=== PLUGIN INIT DONE ===');