# HuaweiCloud DevKit

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![CI](https://github.com/huaweicloud/HuaweiCloud-Devkit/actions/workflows/ci.yml/badge.svg)](https://github.com/huaweicloud/HuaweiCloud-Devkit/actions/workflows/ci.yml)

**[中文](README.zh-CN.md) | English**

Help AI coding agents use Huawei Cloud safely and accurately — skills guidance, KooCLI tooling, and safety policies in one integration.

HuaweiCloud DevKit provides AI coding agents with the knowledge, tools, and safety guardrails they need to work with Huawei Cloud. It supports mainstream agents including OpenCode, Codex, and CodeArts Agent.

## Quick Start

### OpenCode

```bash
npx --yes huaweicloud-devkit install
```

Installs 27 skills, the MCP server, and safety policies, and updates your OpenCode config. **Restart the session** after installation for the MCP tools to take effect.

```bash
npx --yes huaweicloud-devkit doctor    # self-check: hcloud, MCP, skills, auth
npx --yes huaweicloud-devkit status    # show installation status
npx --yes huaweicloud-devkit update    # update to the latest version
npx --yes huaweicloud-devkit uninstall # uninstall
```

### Codex

```bash
npx --yes huaweicloud-devkit install --target codex
```

> The Codex CLI must be installed first. `--target all` skips Codex when the Codex CLI is missing.

### CodeArts Agent

CodeArts has no plugin marketplace; it is adapted through skills + MCP:

```bash
npx --yes huaweicloud-devkit install --target codearts
```

Installs 27 skills to `~/.codeartsdoer/skills/` and project-level `.codeartsdoer/skills/`, and registers the MCP server in user- and project-level `.codeartsdoer/mcp/mcp_settings.json`. If KooCLI already exists locally (`~/hcloud/hcloud.exe`), `HCLOUD_BIN` is injected into the MCP config automatically. **Restart the session** after installation.

```bash
npx --yes huaweicloud-devkit install-hcloud   # install KooCLI
npx --yes huaweicloud-devkit doctor           # self-check
npx --yes huaweicloud-devkit status --target codearts
npx --yes huaweicloud-devkit uninstall --target codearts
```

> **Sandbox mode**: CodeArts defaults to `bash_mode: sandbox`, which blocks KooCLI from writing to config directories (e.g. `~/.hcloud/root`), preventing the privacy agreement from persisting and KooCLI from running. `install-hcloud` detects sandbox mode and gives clear guidance — install and use KooCLI **outside the sandbox terminal**, or disable sandbox mode in CodeArts settings (Settings → Permissions → Bash mode).
>
> **Authentication**: After KooCLI is ready, run `hcloud configure init` outside the sandbox terminal to configure AK/SK and region before describing your Huawei Cloud tasks.

### Other Agents

For agents that support the Model Context Protocol (MCP), configure the MCP server manually:

```json
{
  "mcp": {
    "huaweicloud-devkit": {
      "type": "local",
      "command": ["node", "<path>/plugins/huaweicloud-core/src/mcp-server.mjs"],
      "enabled": true
    }
  }
}
```

Then install the skills:

```bash
npx --yes huaweicloud-devkit install
```

> **Prerequisites:** [KooCLI](https://support.huaweicloud.com/qs-hcli/hcli_02_003.html) (`hcloud`) installed and authenticated. The MCP server requires Node.js >= 20. If `hcloud` is not on `PATH`, set the `HCLOUD_BIN` environment variable to the full path.

## What's Included

### Plugin

The `huaweicloud-core` plugin bundles the MCP server config, 27 agent skills, and safety policies into a single install.

| Plugin | Description |
|--------|-------------|
| [huaweicloud-core](plugins/huaweicloud-core/) | Core plugin with skills, MCP server, and safety policies. **Start here.** |

### Skills

Agent skills are curated packages of instructions and reference materials that help agents complete specific Huawei Cloud tasks. Skills load on demand — agents only discover and retrieve what is relevant to the current task.

Includes 6 meta-skills (routing, discovery, CLI/auth, API/SDK, safety, troubleshooting) and 20 service skills (covering ECS, OBS, VPC, IAM, RDS, GaussDB, FunctionGraph, APIG, CCE, SMN/DMS, ModelArts, Cloud Eye, CTS, DEW, Billing, CBR, WAF/AAD, DDS/DCS, Deployment, Getting Started).

Browse the [`skills/`](plugins/huaweicloud-core/skills/) directory for all available skills.

### Rules Files

Recommended project-level config files that tell agents how to use Huawei Cloud effectively — for example, preferring the MCP server, discovering available skills, and following least-privilege IAM principles.

See [`rules/huawei-agent-rules.md`](rules/huawei-agent-rules.md).

### MCP Server

A local MCP server (`plugins/huaweicloud-core/src/mcp-server.mjs`) provides secure KooCLI access to agents over the Model Context Protocol.

- **Safety-first execution** — every `hcloud` command is classified (read/write/secret) before execution; write operations require explicit user approval.
- **Output redaction** — credential-shaped values (AK/SK, tokens, passwords) are automatically replaced with `***REDACTED***`.
- **16 structured tools** — skill search, CLI checks, read-only commands, region discovery, error explanation, hook risk checks, and more.
- **Zero runtime dependencies** — pure Node.js (>= 20), no `npm install` needed.

See the [MCP tools table](#mcp-tools).

## Safety Model

Three-layer defense:

| Layer | Mechanism | Description |
|-------|-----------|-------------|
| Skills | `SKILL.md` workflow docs | Teach agents correct behavior and safe usage |
| Hooks | `huaweicloud-safety.py` | PreToolUse Hook blocks high-risk tool calls |
| MCP | `safety-policy.mjs` | Node.js safety policy wrapper enforced in all agent environments |

See [`docs/safety-model.md`](docs/safety-model.md).

## MCP Tools

| Category | Tool | Description |
|----------|------|-------------|
| Discovery | `huaweicloud_search_docs` | Full-text search across skill files and docs |
| Discovery | `huaweicloud_retrieve_skill` | Load a full skill with its reference files by name |
| Discovery | `huaweicloud_list_regions` | List available Huawei Cloud regions |
| Discovery | `huaweicloud_get_regional_availability` | Check service availability in a target region |
| CLI | `huaweicloud_check_cli` | Check whether KooCLI `hcloud` is installed |
| CLI | `huaweicloud_plan_cli_command` | Classify and plan a command (read/write/secret) without executing |
| CLI | `huaweicloud_list_operations` | List available KooCLI operations for a service |
| CLI | `huaweicloud_run_readonly_command` | Run a read-only command with redacted output |
| CLI | `huaweicloud_run_approved_command` | Run a write command after explicit user approval |
| Safety | `huaweicloud_show_profile_redacted` | Safely view KooCLI config (credentials redacted) |
| Safety | `huaweicloud_hook_check_command` | Check Shell/KooCLI command risk before execution |
| Safety | `huaweicloud_hook_check_artifacts` | Check generated code, IaC, IAM/OBS policies, and config files for risk |
| Safety | `huaweicloud_hook_check_deploy_plan` | Check sandbox, preview, and cloud resource deploy plans for risk |
| Routing | `huaweicloud_service_catalog` | Return recommended capability source ordering |
| Troubleshooting | `huaweicloud_explain_error` | Explain error codes and suggest diagnostic steps |

## Documentation

- [Architecture](docs/architecture.md)
- [Safety Model](docs/safety-model.md)
- [Open Source Positioning](docs/open-source-positioning.md)
- [Changelog](docs/CHANGELOG.md)
- [KooCLI official docs](https://support.huaweicloud.com/qs-hcli/hcli_02_003.html)

## Contributors

Thanks to all the people who have contributed to this project!

<a href="https://github.com/coconut1919"><img src="https://github.com/coconut1919.png" width="60" height="60" alt="coconut1919" /></a>
<a href="https://github.com/guangkunBryant"><img src="https://github.com/guangkunBryant.png" width="60" height="60" alt="guangkunBryant" /></a>
<a href="https://github.com/zrr000212-netizen"><img src="https://github.com/zrr000212-netizen.png" width="60" height="60" alt="zrr000212-netizen" /></a>
<a href="https://github.com/huaweiclouddev"><img src="https://github.com/huaweiclouddev.png" width="60" height="60" alt="huaweiclouddev" /></a>
<a href="https://github.com/BeyondTianxingjian"><img src="https://github.com/BeyondTianxingjian.png" width="60" height="60" alt="BeyondTianxingjian" /></a>

## License

This project is licensed under the Apache-2.0 License. See [LICENSE](LICENSE).
