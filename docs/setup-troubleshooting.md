# Noutify setup troubleshooting

Use this guide only when [SETUP.md](../SETUP.md) cannot finish. Keep topics,
`.noutify.local.json`, prompts, transcripts, and machine-specific values out of
chat, logs, commits, and generated files.

## Before retrying

The supported target path is Windows with Node.js 24 or newer. The release
folder must remain `Noutify/` inside the target project and retain its
`manifest.json`, `install.mjs`, and `dist/` files. Target installation validates
the release manifest and uses no package manager, source compilation, or test
suite.

Use explicit, repeatable `--agent` values. Native IDs are `claude-code`,
`codex`, `gemini-cli`, `copilot-cli`, and `windsurf`. The installer accepts
combined selections, for example:

```text
node Noutify/install.mjs --language en --agent codex --agent gemini-cli --agent windsurf
```

For other durable-memory agents, use `generic:<lowercase-agent-name>` and add a
matching `--memory-link` only for a known project-relative memory file. Cursor,
OpenCode, and Cline are memory best effort at most; they are not native
adapters. `copilot-cli` is strictly the local CLI integration—do not attempt to
use it for Copilot cloud.

## Installer failure

Read the final installer error, correct that specific prerequisite, and rerun
the same command. Do not bypass a manifest failure or manually edit a protected
hook file. Unsupported identifiers, malformed hook settings, modified
Noutify-owned files, or unsafe memory paths stop before partial installation.

If setup returns `existing`, it intentionally does not reveal a topic. The
owner may inspect their private configuration locally to subscribe a device,
but an agent must never open, copy, or request that value. If the owner cannot
recover it, request explicit approval before any reset or replacement.

## Phone and automatic-receipt gates

Run `node Noutify/dist/cli.js test` only after the owner has subscribed. A
successful command proves only an attempted manual notification; wait for the
owner's receipt before `node Noutify/dist/cli.js confirm`. Then run:

```text
node Noutify/dist/cli.js doctor
```

`WARN` means a confirmation is still needed, while `FAIL` means configuration
or an installed integration needs repair. For each selected native ID, reload
the platform, complete its trust step when applicable, finish a later real
turn, wait for explicit receipt, and then run:

```text
node Noutify/dist/cli.js confirm-agent <agent-id>
node Noutify/dist/cli.js doctor
```

Codex requires reviewing and trusting the project hook through `/hooks`. Claude
Code uses `Stop`; Gemini CLI uses `AfterAgent`; local Copilot CLI uses
`agentStop`; Windsurf uses `post_cascade_response`. Each one remains native
unverified until this receipt is recorded. A generic memory integration remains
best effort even after a memory link is present.

## Hook output and platform-specific checks

Gemini CLI and local Copilot CLI intentionally emit only `{}` from the internal
hook. That output is not a notification receipt and belongs only to hook
troubleshooting. Windsurf's hook is intentionally silent. Do not treat either
behavior as a problem, completion signal, or acceptance proof.

Check the official platform reference before changing platform configuration:

- [Codex hooks](https://developers.openai.com/codex/hooks) — `Stop` in `.codex/hooks.json`.
- [Claude Code hooks](https://code.claude.com/docs/en/hooks) — `Stop` in `.claude/settings.local.json`.
- [Gemini CLI hooks](https://geminicli.com/docs/hooks/reference/) — `AfterAgent` in `.gemini/settings.json`.
- [GitHub Copilot hooks](https://docs.github.com/en/copilot/reference/hooks-reference) — local `agentStop` in `.github/copilot/settings.local.json`.
- [Windsurf Cascade hooks](https://docs.windsurf.com/es/windsurf/cascade/hooks) — `post_cascade_response` in `.windsurf/hooks.json`.

## Moving or uninstalling

While the original `Noutify/` folder is still present, run:

```text
node Noutify/dist/cli.js uninstall
```

Then move the folder and run the installation contract again. If it was already
moved, restore it at the original path before uninstalling. Uninstall removes
only exact Noutify-owned hooks, skills, instructions, and memory blocks; it
preserves unrelated agent configuration and Noutify configuration files.
