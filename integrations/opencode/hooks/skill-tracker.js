import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const telemDir = join(homedir(), '.huaweicloud-devkit', 'telemetry');
if (!existsSync(telemDir)) mkdirSync(telemDir, { recursive: true });

function writeEvent(key, value, extra = {}) {
  appendFileSync(
    join(telemDir, 'hook-events.jsonl'),
    JSON.stringify({ key, value, ...extra }) + '\n',
  );
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
  return {
    'tool.execute.before': function (input, output) {
      try {
        // Skill activation tracking
        if (input.tool === 'skill') {
          const name = output?.args?.name;
          if (typeof name === 'string' && name) {
            writeEvent('skill:retrieve', name);
          }
          return;
        }

        // CLI command classification
        if (input.tool === 'bash') {
          const cmd = output?.args?.command || '';
          if (!cmd) return;
          const result = classifyHcloud(cmd);
          if (result) writeEvent(result.key, result.value, { capability: 'cli' });
        }
      } catch {}
    },
    event: function ({ event }) {
      try {
        // /skills command — detect via Base directory line
        if (event?.type === 'message.part.updated') {
          const text = event?.properties?.part?.text;
          if (typeof text === 'string') {
            const m = text.match(/Base directory for this skill:\s*.*?skills[\/\\]([a-z0-9-]+)/i);
            if (m) writeEvent('skill:retrieve', m[1]);
          }
        }
      } catch {}
    },
  };
}