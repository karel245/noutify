# Noutify setup troubleshooting

Use this guide only when the normal contract in [SETUP.md](../SETUP.md) cannot
finish. Keep topics and `.noutify.local.json` out of chat, logs, commits, and
generated files.

## Before retrying

The supported target path is Windows with Node.js 24 or newer. The release
folder must remain `Noutify/` inside the target project and must retain its
`manifest.json`, `install.mjs`, and `dist/` files. Target installation validates
the release manifest and uses no package manager, source compilation, or test
suite.

Use explicit agent values. This release installs native adapters only for
`codex` and `claude-code`. A generic agent uses `generic:<lowercase-name>`;
provide `--memory-link` only when the owner identifies a real project-relative
memory file. Gemini CLI, GitHub Copilot CLI, and Windsurf must not be selected
until their adapters are shipped.

## Installer failure

Read the final installer error, correct that specific prerequisite, and rerun
the same command. Do not bypass a manifest failure or manually edit a protected
hook file. Unsupported agent identifiers, malformed hook settings, modified
Noutify-owned files, or unsafe memory paths stop before partial installation.

If setup returns `existing`, it intentionally does not reveal a topic. The
owner may inspect their own `.noutify.local.json` locally to subscribe a device,
but an agent must never open, copy, or request that value. If the owner cannot
recover it, request explicit approval before any reset or replacement.

## Phone and automatic-receipt gates

Run `node Noutify/dist/cli.js test` only after the owner has subscribed. A
successful command proves only an attempted manual notification; wait for the
owner's receipt before `node Noutify/dist/cli.js confirm`. Then inspect:

```text
node Noutify/dist/cli.js doctor
```

`WARN` means a confirmation is still needed, while `FAIL` means configuration
or an installed integration needs repair. For Codex, the owner must trust the
project-local entry through `/hooks`, finish a later real turn, explicitly
report receipt, and only then run:

```text
node Noutify/dist/cli.js confirm-agent codex
```

Claude Code follows the equivalent real-turn and
`confirm-agent claude-code` process. A generic memory integration remains
pending without an explicit memory file and remains best effort even after a
link is present.

## Moving or uninstalling

While the original `Noutify/` folder is still present, run:

```text
node Noutify/dist/cli.js uninstall
```

Then move the folder and run the installation contract again. If it was already
moved, restore it at the original path before uninstalling. Uninstall removes
only exact Noutify-owned hooks, skills, instructions, and memory blocks; it
preserves unrelated agent configuration and Noutify configuration files.
