# Noutify

Noutify sends short, private phone notifications when a coding agent returns
control. `WAITING` means an agent turn ended; it never means that work is
complete. Noutify never sends prompts, transcripts, or response content.

## Generate the release folder

`release/Noutify/` is generated locally and ignored by Git; it is not currently
published or downloadable from this repository. A maintainer creates it from a
source checkout:

```text
git clone https://github.com/karel245/noutify.git
cd noutify
npm ci
npm run package
```

Copy the resulting `release/Noutify/` folder directly into the target project.

## Install in one prompt

Open a capable coding agent from that target project and send exactly:

```text
Install Noutify following Noutify/SETUP.md.
```

The agent selects the notification language from the interaction, proposes its
detected platform, asks which agents will use the project, and runs the offline
installer with explicit selections. The validated target path is Windows with
Node.js 24 or newer; it does not need npm, source code, or a build step.

Do not move or delete `Noutify/` after setup. Run `uninstall` before moving it,
then install it again at the new location.

## Compatibility

| Platform | Status | What it means |
| --- | --- | --- |
| Claude Code | native unverified | Project-local `Stop` hook and Noutify skill are installed; a later real-turn receipt and `confirm-agent claude-code` are still required. |
| Codex | native unverified | Project-local `Stop` hook is installed; the owner must review and trust it through `/hooks`, then confirm a later real-turn receipt. |
| Gemini CLI | native unverified | Project-local `AfterAgent` hook is installed; review the project hook source, acknowledge the security warning when the hook executes, use the `/hooks` panel to verify it is present, enabled, and reporting status, then start or restart Gemini CLI before a later real-turn receipt. |
| GitHub Copilot CLI (local) | native unverified | Project-local `agentStop` hook is installed for the local CLI only. Start or restart GitHub Copilot CLI; hook configuration is loaded at startup. Copilot cloud is unsupported and untested. |
| Windsurf Cascade | native unverified | Project-local `post_cascade_response` hook is installed; reload, receive a real later-turn notification, and confirm it before relying on it. |
| Durable-memory agents | memory best effort | An explicit project-memory file can contain one managed instruction; it is not a lifecycle hook. |
| Cursor, OpenCode, Cline, Copilot cloud | unsupported or untested | No native automatic-notification claim is made. |

“Native” means a deterministic project-local adapter exists. “Unverified” is
intentional: no native adapter is promoted to verified until a real device has
received an automatic notification and the owner has explicitly confirmed that
receipt. A project may select multiple native agents in one transaction.

## Confirmation is deliberate

The installer displays a newly created ntfy topic once. Treat it as a private
key: subscribe the phone, receive the localized manual test, and explicitly
confirm it. `doctor` then reports the remaining adapter checks. Native hooks
need a separate real-turn receipt and `confirm-agent`; files, process exits, or
HTTP success never substitute for that receipt.

## Security and removal

- Public configuration contains no topic; `.noutify.local.json` is private and
  ignored by Git.
- Hooks and memory links are exact-owned, quiet, non-blocking, and reversible.
- `node Noutify/dist/cli.js uninstall` removes only Noutify-owned integration
  entries and preserves configuration for inspection or reuse.

For recovery, see [setup troubleshooting](docs/setup-troubleshooting.md). For
the product direction and release workflow, see
[NOUTIFY_CONTEXT.md](NOUTIFY_CONTEXT.md).

## Official platform references

- [Codex hooks](https://developers.openai.com/codex/hooks)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Gemini CLI hooks](https://geminicli.com/docs/hooks/reference/)
- [GitHub Copilot hooks](https://docs.github.com/en/copilot/reference/hooks-reference)
- [Windsurf Cascade hooks](https://docs.windsurf.com/es/windsurf/cascade/hooks)
