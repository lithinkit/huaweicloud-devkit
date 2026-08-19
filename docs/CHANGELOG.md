# Changelog

## 1.0.2 (2026-08-19)

- fix(release): update release trigger to workflow_dispatch and main push only
- feat(release): sync release workflow to main, seed manifest with 1.0.1
- fix(release): retire the live Publish Dev workflow on main
- fix(release): restore full publish flow with quoted step names
- fix(release): probe publish job with environment only
- fix(release): probe without job outputs and needs.outputs wiring
- fix(release): restore full tag-gated publish logic
- fix(release): reduce npm-publish workflow to minimal probe
- fix(release): drop workflow_dispatch inputs, derive dist-tag from the tag version
- fix(release): rename publish workflow to npm-publish to recover a fresh workflow_dispatch index
- fix(release): add pack-verify script to main
- fix(release): sync ci.yml with pack verification to main
- fix(release): add tag-gated Publish workflow to main so workflow_dispatch works from tags
- docs: fix README Node.js requirement, discussions badge link, and repo URL
- refactor(sandbox): remove huaweicloud_sandbox_release tool
- refactor(auth): point AK/SK guide directly to IAM access keys page
- refactor(install): Chinese next-steps prompt
- feat(install): next-steps prompt with unified auth init first, then restart and doctor
- fix(huawei-sandbox): workspace dir is /workspace at filesystem root, not \C:\Users\sunzy/workspace
- feat(huawei-sandbox): clone projects into sandbox workspace dir, never /tmp
- fix(install-hcloud): append+dedupe user PATH via SetEnvironmentVariable instead of clobbering setx PATH
- feat(huawei-sandbox): hide tunnel/DevBridge details from developers, treat as internal implementation
- refactor(auth): simplify credential hints to plain auth init command
- fix(auth): route credential hints to unified auth init instead of KooCLI-only configure init
- feat(huawei-sandbox): DevBridge reverse proxy workflow - install, AK/SK login, expose, return URL, no local downgrade
- feat(skills): route deploy-a-repo prompts to sandbox, detect web apps and offer sandbox proactively
- feat(auth): add AK/SK acquisition guide (Chinese) to auth init
- refactor(auth): single 'Credentials synchronized' message instead of per-target sync details
- feat(huawei-sandbox): install Node.js from Huawei Cloud mirror when sandbox lacks it
- fix(auth): skip 0600 check on native Windows (no POSIX modes, avoids false warnings)
- feat(auth): verify 0600 on credential files, warn on WSL-mounted drives
- feat(huawei-sandbox): offer sandbox proactively for runtime tasks, hide agreement/DevBridge details (#58)
- Update CONTRIBUTING.md
- Update README.md
- Update README.zh-CN.md
- fix: publish-dev bump tolerates package.json already at base (no 'Version not changed' failure)
- fix: sync plugin manifest versions to 1.0.1 and harden publish.yml against version drift
- fix: clear install marker when MCP server loads so doctor stops false 'restart needed' warnings
- fix: write obsutilconfig in flat key=value format for KooCLI 7.x (#49)
- release 1.0.1

Release notes are generated from GitHub Releases. See https://github.com/huaweicloud/HuaweiCloud-Devkit/releases
