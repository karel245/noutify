# Noutify installation contract

Use this contract from the target project's root. Keep `Noutify/` in that
location after setup. Do not read, print, request, or copy
`.noutify.local.json`.

1. Choose the user's latest clear request language; otherwise use their
   established conversation language, then the operating-system UI language,
   then English. Select `es` for Spanish. For every other language select `en`
   and explain, in the interaction language, that notifications will be in
   English. Never translate commands, paths, JSON, or agent identifiers.
2. Detect and propose the current platform, then ask: “Which agents will use
   Noutify in this project?” The user may choose one or more native IDs:
   `claude-code`, `codex`, `gemini-cli`, `copilot-cli`, and `windsurf`.
   Detection is advisory; do not install an integration without an explicit
   selection. `copilot-cli` means the local CLI only, never Copilot cloud.
3. For another platform with durable project instructions, use
   `generic:<lowercase-agent-name>`. Ask for its real project-relative memory
   file and add a matching `--memory-link`; otherwise continue without it and
   report a pending, best-effort integration. Never guess a file path.
4. Run the installer with explicit, repeatable selections. For example:

   ```text
   node Noutify/install.mjs --language es --agent codex --agent claude-code
   ```

   To install all native adapters together:

   ```text
   node Noutify/install.mjs --language en --agent claude-code --agent codex --agent gemini-cli --agent copilot-cli --agent windsurf
   ```

   A generic-memory selection looks like:

   ```text
   node Noutify/install.mjs --language en --agent generic:cursor --memory-link generic:cursor=AGENTS.md
   ```

   Read only the final JSON record. If it says `created`, display its topic
   once, explain that it is a private notification key, and do not repeat it in
   text, files, logs, or summaries. If it says `existing`, never display a
   topic.
5. Ask the owner to subscribe their ntfy app, then run:

   ```text
   node Noutify/dist/cli.js test
   ```

   Wait for explicit receipt of the localized manual test. Only then run:

   ```text
   node Noutify/dist/cli.js confirm
   node Noutify/dist/cli.js doctor
   ```

6. Complete the selected platform's native acceptance below. Reload or restart
   the platform after it notices the project configuration, finish a later real
   turn, wait for the owner's explicit automatic-phone receipt, then run:

   ```text
   node Noutify/dist/cli.js confirm-agent <agent-id>
   node Noutify/dist/cli.js doctor
   ```

   `confirm` proves the phone channel only. `confirm-agent` records a separate
   real automatic receipt for one selected adapter.

## Native-platform acceptance

| Agent ID | Project-local integration | Lifecycle event | Owner action before real-turn acceptance |
| --- | --- | --- | --- |
| `claude-code` | `.claude/settings.local.json` plus the Noutify project skill | `Stop` | Reload Claude Code so it reads the project hook and skill. |
| `codex` | `.codex/hooks.json` | `Stop` | Open `/hooks`, review the project-local Noutify command hook, and trust it. Do not bypass trust. |
| `gemini-cli` | `.gemini/settings.json` | `AfterAgent` | Review the new project-hook security warning and its source in the `/hooks` panel, inspect and approve it, then start or restart Gemini CLI. |
| `copilot-cli` | `.github/copilot/settings.local.json` | `agentStop` | Start or restart GitHub Copilot CLI; hook configuration is loaded at startup. Copilot cloud is unsupported and untested. |
| `windsurf` | `.windsurf/hooks.json` | `post_cascade_response` | Reload Windsurf Cascade after it reads the project hook. |

Every native adapter remains **native unverified** until the manual phone gate,
the platform-specific trust or reload action, a real later turn, the owner's
explicit automatic receipt, `confirm-agent <agent-id>`, and a clean `doctor`
have all occurred. An installed file, process exit, or provider response is not
proof of delivery.

## Other agents

`generic:<agent-name>` is memory best effort, not a lifecycle hook. It can be
used for durable project-memory agents only after the owner identifies the
memory file. Cursor, OpenCode, and Cline have no native adapter in this release;
do not describe them as automatically supported or native verified.

For exact platform hook behavior and official references, read
[troubleshooting](docs/setup-troubleshooting.md) only when recovery is needed.
