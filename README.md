# Noutify

Noutify sends short, private phone notifications when a coding agent returns
control. It never sends prompts, transcripts, or response content. `WAITING`
means an agent turn ended; it does not mean that work is complete.

## Install in one prompt

1. Download the generated `Noutify/` release folder from this repository and
   place it directly inside the project that will use it.
2. Open any capable coding agent from that project and send exactly:

   ```text
   Install Noutify following Noutify/SETUP.md.
   ```

The agent follows the language and platform-selection contract, runs the
offline installer, and guides the private phone-confirmation steps. The target
path is validated on Windows with Node.js 24 or newer; it does not need npm,
source code, or a build step.

Do not move or delete `Noutify/` after setup. Run `uninstall` before moving it,
then install it again at the new location.

## Compatibility

| Platform | Status | What it means |
| --- | --- | --- |
| Codex | native verified | Project-local Stop hook; owner must trust it through `/hooks` and confirm a real receipt. |
| Claude Code | native unverified | Project-local Stop hook and language skill; confirm a real receipt before relying on it. |
| Other agents with durable project instructions | memory best effort | An explicit memory file can hold one managed instruction; it is not a reliable lifecycle hook. |
| Gemini CLI, GitHub Copilot CLI, Windsurf | unsupported or untested | Planned native adapters; this release does not install them. |
| Other agents without durable memory | unsupported or untested | No automatic notification claim is made. |

Noutify uses project-local integrations and never changes a user's global agent
settings. A project can select both Codex and Claude Code, or a generic memory
integration, during setup.

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
