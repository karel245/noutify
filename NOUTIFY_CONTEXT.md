# Noutify — master project context

> Status: minimal multi-agent distribution, Plan 1
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
Private `.noutify.local.json` holds the topic and is ignored by Git. Topics,
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
proposes the current platform but asks for explicit one-or-more agent selections.

After a new installation, the topic is shown once only. The owner subscribes,
receives a manual localized test, explicitly confirms it, and checks `doctor`.
This confirms the phone channel, not automatic delivery. Each native adapter
needs its own later real-turn receipt and `confirm-agent <id>`; `doctor` never
infers receipt from installed files or delivery success.

Codex additionally requires the owner to review and trust the project-local
hook through `/hooks`. Generic adapters use a user-identified durable memory
file when available; without one they are pending, and with one they remain
best effort rather than a lifecycle guarantee. The `Noutify/` folder must stay
in its installed position until explicit uninstall.

## Compatibility

| Platform | Current claim |
| --- | --- |
| Codex | native unverified until project-local hook trust and later real-turn receipt are recorded |
| Claude Code | native unverified until real-turn acceptance is recorded |
| Generic durable-memory agent | memory best effort |
| Gemini CLI, GitHub Copilot CLI, Windsurf | unsupported or untested until Plan 2 |
| Other agents | unsupported or untested without a validated adapter or memory path |

Native adapters presently implemented in Plan 1 are Codex and Claude Code.
Gemini CLI, GitHub Copilot CLI, and Windsurf identifiers are reserved but their
native installation is deferred to Plan 2. Do not claim automatic notification
support for every agent.

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

Plan 1 supplies the minimal artifact, multi-agent configuration, Codex and
Claude Code adapters, generic memory fallback, transactionality, confirmation,
diagnostics, and packaging. Plan 2 may add and verify native adapters for
Gemini CLI, local GitHub Copilot CLI, and Windsurf. Future work may add other
providers, operating systems, a package distribution channel, richer event
types, or a stable public API only after separate approval and validation.
