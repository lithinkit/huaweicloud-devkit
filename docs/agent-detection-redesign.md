# Agent 检测重构 —— 表驱动架构

## 问题

`mcp-server.mjs` 中 agent 类型和版本检测逻辑分散在三层独立结构中，存在覆盖不全、命名不一致、维护负担重等问题。

### 当前架构

```
detectHarnessFromPath()  (mcp-server.mjs:8)     ← 路径匹配, if-else 链
detectAgentHarness()     (agent-detect.mjs:1)    ← 环境变量匹配, if-else 链
detect*Version() × 5     (mcp-server.mjs:23-116) ← 版本检测, 5 个独立函数
initTelemetry 嵌套三元   (mcp-server.mjs:290)    ← 版本选择, 只覆盖 5 个 agent
```

### 具体问题

1. **覆盖不全** — 13 个已知 agent 中，`cursor` / `claude-code` / `openclaw` / `codearts-work` 无路径检测，除 5 个外全部无版本检测，fallback 到不可靠的 `ci.version`
2. **检测调用两次** — `detectHarnessFromPath()` 在 keepalive 检查(line 184)和 telemetry 初始化(line 283)各执行一次
3. **版本函数全量执行** — 无论匹配到哪个 agent，5 个 `detect*Version()` 都会执行，浪费 I/O
4. **嵌套三元不可读** — 5 层嵌套，每次加 agent 需深入中间插入新分支
5. **命名不一致** — 路径检测返回 `codex-desktop`，环境变量返回 `codex`（CLI），但无版本函数区分二者

## 调研

参考业界标杆 **Vercel `@vercel/detect-agent`**（npm 周下载 320 万）：

| 设计决策 | Vercel 做法 |
|---------|------------|
| 数据源 | 单一 `agents.json`，数组顺序即优先级 |
| 条件模型 | `anyOf`(OR) / `allOf`(AND) 组合子嵌套 |
| 条件原语 | `env_set`, `env_value`, `env_matches`, `file_exists`, `no_tty` |
| 逃生舱 | `AI_AGENT` 环境变量最高优先级覆盖 |
| 跨语言 | 同一 JSON → TypeScript + Go 两套运行时 |

**应用到本项目**：不引入 JSON DSL（过度工程），保留 JS 注册表形式，借鉴核心思想——单一数据源 + 数组顺序表达优先级 + 组合子替代 if-else。

## 方案

### Agent 注册表（agent-registry.mjs）

新增 `src/telemetry/agent-registry.mjs`，一条配置替换三层硬编码：

```js
// 数组顺序即优先级 —— 靠前的先匹配
export const AGENTS = [
  {
    id: 'codearts',
    pathPatterns: ['/.codeartsdoer/'],
    envVars: ['CODE_ARTS_HARNESS', 'CODEARTS_PROJECT_DIR'],
    version: { type: 'pkgJson', searchDir: 'CodeArts Agent' }
  },
  {
    id: 'opencode',
    pathPatterns: ['/.config/opencode/'],
    envVars: ['OPENCODE_SESSION_ID', 'OPENCODE_CONFIG_PATH'],
    version: { type: 'pkgJson', searchDir: 'opencode' }
  },
  {
    id: 'codex-desktop',
    pathPatterns: ['/.codex/'],
    envVars: ['CODEX_DESKTOP', 'CODEX_ELECTRON'],
    version: { type: 'pkgJson', searchDir: 'Codex' }
  },
  {
    id: 'codex',
    pathPatterns: null,
    envVars: ['CODEX_SESSION_ID', 'CODEX_CLI_VERSION'],
    version: null
  },
  {
    id: 'codearts-work',
    pathPatterns: ['/.codeartswork/'],
    envVars: null,
    version: null
  },
  {
    id: 'workbuddy',
    pathPatterns: ['/.workbuddy/'],
    envVars: ['WORK_BUDDY_SESSION_ID', 'WORKBUDDY_SESSION'],
    version: { type: 'workbuddy' }
  },
  {
    id: 'dsh',
    pathPatterns: ['/.dsh/'],
    envVars: ['DSH_SESSION_ID', 'DSH_HOME'],
    version: { type: 'dsh' }
  },
  {
    id: 'officeace',
    pathPatterns: ['/.office-claw/', '/.officeace/'],
    envVars: ['OFFICEACE_SESSION_ID', 'OFFICE_CLAW_CONFIG_ROOT'],
    version: { type: 'officeace' }
  },
  {
    id: 'hermes',
    pathPatterns: ['/.hermes/', '/hermes/'],
    envVars: ['HERMES_SESSION_ID', 'HERMES_HOME'],
    version: { type: 'hermes' }
  },
  {
    id: 'openclaw',
    pathPatterns: ['/.openclaw/'],
    envVars: ['OPENCLAW_SESSION_ID', 'OPENCLAW_CONFIG_ROOT'],
    version: null
  },
  {
    id: 'atomcode',
    pathPatterns: ['/.atomcode/'],
    envVars: ['ATOM_CODE_SESSION_ID', 'ATOMCODE_HOME'],
    version: { type: 'pkgJson', searchDir: 'AtomCode' }
  },
  {
    id: 'cursor',
    pathPatterns: ['/.cursor/', '/cursor/'],
    envVars: ['CURSOR_SESSION_ID', 'CURSOR_GIT_WORKDIR'],
    version: { type: 'pkgJson', searchDir: 'Cursor' }
  },
  {
    id: 'claude-code',
    pathPatterns: ['/.claude/'],
    envVars: ['CLAUDE_CODE_SESSION_ID'],
    version: null
  }
];
```

### 版本检测策略（4 种 type）

| type | 适用 agent | 逻辑 |
|------|-----------|------|
| `pkgJson` | codearts, opencode, codex-desktop, cursor, atomcode | 在 `${LOCALAPPDATA}/Programs/<searchDir>/resources/app/package.json` 读 `.version` |
| `dsh` | dsh | 在 `@deepseek-ai/dsh/package.json` 读 `.version` |
| `officeace` | officeace | `OFFICEACE_VERSION` 环境变量 → `${LOCALAPPDATA}/Programs/OfficeAce/.office-claw-release.json` → `.version` |
| `hermes` | hermes | `HERMES_VERSION` 环境变量 → `hermes_cli/__init__.py` 正则提取 `__version__` |
| `workbuddy` | workbuddy | `install-manifest.json` 的 `.appVersion`，遍历盘符兼容非系统盘安装 |
| `null` | codex, openclaw, claude-code, codearts-work | 无版本检测，fallback 到 `ci.version` |

### 新 API（agent-detect.mjs 重写）

```js
export function detectAgent(clientInfo = {}) {
  // 1. AGENT_HARNESS 环境变量（手动覆盖）
  if (process.env.AGENT_HARNESS) {
    return { harness: process.env.AGENT_HARNESS, version: detectVersion(process.env.AGENT_HARNESS) };
  }

  // 2. 遍历 AGENTS 注册表，路径 → 环境变量
  for (const agent of AGENTS) {
    if (matchAgent(agent)) {
      return { harness: agent.id, version: detectVersion(agent) || clientInfo.version || '0.0.0' };
    }
  }

  // 3. 回退
  return {
    harness: clientInfo.name || 'unknown',
    version: clientInfo.version || '0.0.0'
  };
}

// 内部：路径 pattern 匹配 + 环境变量匹配（anyOf 语义）
function matchAgent(agent) {
  if (agent.pathPatterns && agent.pathPatterns.some(p => selfPath.includes(p))) return true;
  if (agent.envVars && agent.envVars.some(v => process.env[v])) return true;
  return false;
}

// 内部：根据 agent.version.type 分发
function detectVersion(agent) { ... }
```

### mcp-server.mjs 简化

```diff
- function detectHarnessFromPath() { ... }     // 删除 14 行
- function detectIdeVersion() { ... }          // 删除 14 行
- function detectDshVersion() { ... }          // 删除 10 行
- function detectHermesVersion() { ... }       // 删除 19 行
- function detectWorkBuddyVersion() { ... }    // 删除 33 行
- function detectOfficeAceVersion() { ... }    // 删除 13 行

- import { detectAgentHarness } from ...       // 改为
+ import { detectAgent } from './telemetry/agent-detect.mjs';

- const harness = detectHarnessFromPath();     // 保留此行，改为
+ const { harness } = detectAgent();

  // dispatch('initialize') 中：
- const hostHarness = detectHarnessFromPath() || detectAgentHarness() || ci.name || 'unknown';
- const ideVersion = detectIdeVersion();
- const dshVersion = detectDshVersion();
- const wbVersion = detectWorkBuddyVersion();
- const hermesVersion = detectHermesVersion();
- const officeaceVersion = detectOfficeAceVersion();
- initTelemetry({ harness: hostHarness, version: (嵌套三元 9 行) });
+ const { harness, version } = detectAgent(ci);
+ initTelemetry({ harness, version });
```

净减 ~100 行，净增 ~140 行（registry ~90 + agent-detect 重写 ~50）。

### NEEDS_KEEPALIVE 兼容

`detectAgent()` 在模块顶层调用一次，结果同时用于 keepalive 判断和 telemetry，保证两处使用同一个 `harness` 值：

```js
const { harness } = detectAgent();
const NEEDS_KEEPALIVE = harness === 'hermes' && platform() === 'win32';
```

## 文件变更

| 文件 | 动作 | 行数变化 |
|------|------|---------|
| `src/telemetry/agent-registry.mjs` | **新建** | +90 |
| `src/telemetry/agent-detect.mjs` | **重写** | 19→50 (+31) |
| `src/mcp-server.mjs` | **简化** | 346→~250 (-96) |

## 向后兼容

- telemetry 事件字段 `harness` / `agentVersion` 格式不变
- `AGENT_HARNESS` 环境变量覆盖行为保留（且提升为最高优先级）
- `ci.version` / `ci.name` fallback 保持
- workbuddy / hermes / officeace 的特殊版本检测逻辑不丢

## 后续扩展

新增 agent 只需在 `agent-registry.mjs` 中加一条配置，无需改动检测逻辑代码：

```js
{
  id: 'new-agent',
  pathPatterns: ['/.new-agent/'],
  envVars: ['NEW_AGENT_SESSION_ID'],
  version: { type: 'pkgJson', searchDir: 'NewAgent' }
}
```