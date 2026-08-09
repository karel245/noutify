# Noutify — master project context

> Status: minimal multi-agent distribution, Plan 2
> Audience: maintainers and coding agents

## Purpose

Noutify is a local bridge between coding-agent lifecycle events and private
phone notifications. Its promise is truthful, private notification: it tells a
user that an agent is `WAITING`, never that work is complete without separate
evidence. Delivery failure must never change, block, or substantially delay the
agent's actual response.

The runtime is project-local, TypeScript/Node based, and currently uses ntfy.
It has no Noutify service, account, telemetry, transcript store, or mobile app.

## Current architecture

`release/Noutify/` is the portable artifact. It contains only the installer,
compiled runtime, manifest, license, setup contract, and recovery guide. Its
installer validates the manifest, Windows, and Node.js 24+ before calling the
compiled CLI. A target project never runs npm, source compilation, type checks,
or repository tests. The artifact is generated locally with `npm run package`,
ignored by Git, and is not yet published or downloadable from the repository.

Public configuration records selected integrations and safe project settings.
Private configuration holds the topic and phone-confirmation state. Topics,
prompts, transcripts, agent responses, credentials, and device data must never
enter documentation, diagnostics, manifests, hooks, tests, or commits.

Adapters are exact-owned and transactional: setup preflights and snapshots
every target before mutation; failure restores original bytes or absence;
repeated setup is idempotent; uninstall removes only Noutify-owned entries.
Hooks are silent, bounded, and non-blocking.

## Installation and acceptance

The public entry point is exactly:

```text
Install Noutify following Noutify/SETUP.md.
```

The executing agent uses the latest clear user-request language, then the
established conversation language, then OS UI language, then English. Spanish
selects `es`; all other interaction languages select `en` and receive an
interaction-language explanation that notifications will use English. It
proposes the current platform but asks for explicit one-or-more agent
selections.

After a new installation, the topic is shown once only. The owner subscribes,
receives a manual localized test, explicitly confirms it, and checks `doctor`.
This confirms the phone channel, not automatic delivery. Each native adapter
needs its own later real-turn receipt and `confirm-agent <id>`; `doctor` never
infers receipt from installed files or delivery success. Codex additionally
requires the owner to review and trust the project-local hook through `/hooks`.
Gemini CLI requires the owner to review the new project-hook security warning and its source in the `/hooks` panel, inspect and approve it, then start or restart Gemini CLI. Start or restart GitHub Copilot CLI; hook configuration is loaded at startup.
The `Noutify/` folder must stay in its installed position until explicit
uninstall.

## Compatibility

| Platform | Current claim |
| --- | --- |
| Claude Code | native unverified until a later real-turn receipt is recorded |
| Codex | native unverified until hook trust and a later real-turn receipt are recorded |
| Gemini CLI | native unverified until a later real-turn receipt is recorded |
| GitHub Copilot CLI (local) | native unverified until a later real-turn receipt is recorded; Copilot cloud is unsupported and untested |
| Windsurf Cascade | native unverified until a later real-turn receipt is recorded |
| Generic durable-memory agent | memory best effort |
| Cursor, OpenCode, Cline, and other unsupported surfaces | unsupported or untested |

Native adapters exist for Claude Code `Stop`, Codex `Stop`, Gemini CLI
`AfterAgent`, local GitHub Copilot CLI `agentStop`, and Windsurf
`post_cascade_response`. No real-device automatic-receipt gate has yet been
recorded for any of them, so none may be described as native verified.

## Rules that cannot change silently

- `WAITING` is an end-of-turn state, never a completion claim.
- Native hooks are preferred to model memory; generic memory is an explicit
  fallback only.
- The topic is a private key and may be displayed once only when newly created.
- Project-local integration is preferred over user-global configuration.
- Manual phone confirmation and per-agent automatic receipt are separate gates.
- Compatibility language must say `native verified`, `native unverified`,
  `memory best effort`, or `unsupported or untested`.
- Any structural product or security decision requires an explicit update here.

## Roadmap

Plan 1 supplied the minimal artifact, multi-agent configuration, Claude Code
and Codex adapters, generic memory fallback, transactionality, confirmation,
diagnostics, and packaging. Plan 2 adds deterministic project-local adapters
for Gemini CLI, local GitHub Copilot CLI, and Windsurf. A native adapter moves
to `native verified` only after its supported platform performs a real later
turn, the owner explicitly confirms phone receipt, and the recorded acceptance
is visible through `doctor`. Future work may add other providers, operating
systems, a package distribution channel, richer event types, or a stable public
API only after separate approval and validation.
