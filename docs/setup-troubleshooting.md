# Noutify setup troubleshooting

Use this guide only when the compact setup flow does not produce a new,
successful record. Keep private values out of chat, logs, and generated files.

## Prerequisites

Run setup from the target project's root, with `Noutify/` directly inside it.
The validated path needs Windows, Node.js 24 or newer, npm, Claude Code
project-local hooks, and an ntfy-compatible phone app. The installer verifies
the Noutify source and runs `npm ci`, `npm test`, `npm run typecheck`, and
`npm run build` before it changes the target.

## Setup recovery

Read the installer's `FAIL <stage>` message and correct that prerequisite or
failing project condition. Re-run the same compact installer command from the
target root. Do not substitute manual paths or bypass a failed stage. Malformed
Claude settings and incomplete public/private Noutify configuration need manual
repair; do not replace unrelated settings.

## Existing installation

An `existing` final JSON record means the configuration and owned hook already
exist; it intentionally contains no topic. Preserve the installation and its
unrelated hooks. Continue with the phone gates only if its owner can verify the
subscription; otherwise use topic recovery. Run `doctor` after any explicit
phone receipt.

## Topic recovery

Ask the owner to inspect `.noutify.local.json` locally and enter its topic in
their ntfy app. Never open, copy, print, or request that value in chat. If it
cannot be recovered, stop and ask whether the owner wants an explicit reset;
do not invent or expose a replacement topic.

## Skill collision

If `.claude/skills/noutify/SKILL.md` is occupied by unrecognized content, setup
stops to protect it. Do not overwrite it. Ask the owner whether to preserve,
rename, or remove that separate skill, then re-run setup. The Noutify-owned
skill accepts `/noutify language español` and `/noutify language english`.

## Uninstall

Only on an explicit request, run `node Noutify/dist/cli.js uninstall` from the
target root. It removes only recognized Noutify hooks and skills, preserving
unrelated Claude configuration and Noutify configuration files.
