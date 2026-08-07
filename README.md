# Noutify

Noutify connects coding-agent lifecycle events to mobile notifications. The
current Phase 0 implementation is a Windows-first vertical slice for Claude Code
and ntfy.

## Current status

Implemented and automated:

- truthful `WAITING` notification composition;
- Claude Code `Stop` payload handling;
- ntfy delivery with a five-second timeout and one transient retry;
- public and private configuration separation;
- idempotent project-local hook installation;
- `setup`, `test`, `confirm`, `doctor` and `uninstall` commands;
- automated tests for core, provider, configuration, installer and CLI behavior.

Still requires manual acceptance:

- subscribing a real phone to the generated ntfy topic;
- receiving the test notification on that phone;
- confirming receipt with `noutify confirm`.

## Requirements

- Windows for the validated Phase 0 path;
- Node.js 24 or newer;
- Claude Code with project-local hooks;
- the ntfy Android or iOS application.

The official ntfy phone guide lists the current Android, F-Droid, iOS and PWA
options: <https://docs.ntfy.sh/subscribe/phone/>.

## Develop locally

```powershell
npm install
npm test
npm run typecheck
npm run build
```

The compiled executable is `dist/cli.js`.

## Configure a target project

Build this repository, then run setup from a local terminal:

```powershell
$NOUTIFY_ROOT = (Resolve-Path .).Path
$TARGET_ROOT = 'D:\path\to\target-project'
node "$NOUTIFY_ROOT\dist\cli.js" setup --project "$TARGET_ROOT"
```

Phase 0 generates a high-entropy topic and displays it only during the initial
setup. Treat that value as a secret. Do not paste it into issues, commits,
documentation, screenshots or shared transcripts.

Setup creates:

```text
MyProject/
├── noutify.config.json       public, safe to version
├── .noutify.local.json       private, automatically ignored by Git
└── .claude/
    └── settings.local.json   merged; existing hooks are preserved
```

The installed hook invokes the absolute location of this build. Moving or
deleting the Noutify checkout invalidates the Phase 0 hook; package-based
distribution is planned for a later phase.

## Connect the phone

1. Install and open ntfy using the official phone guide.
2. Add a subscription.
3. Use the server displayed by setup; the default is `https://ntfy.sh`.
4. Enter the generated topic exactly as displayed locally.
5. Send a test:

```powershell
node "$NOUTIFY_ROOT\dist\cli.js" test --project "$TARGET_ROOT"
```

6. If the notification arrived, confirm it:

```powershell
node "$NOUTIFY_ROOT\dist\cli.js" confirm --project "$TARGET_ROOT"
```

7. Verify the installation:

```powershell
node "$NOUTIFY_ROOT\dist\cli.js" doctor --project "$TARGET_ROOT"
```

Do not run `confirm` when the phone did not receive the test.

## Commands

```text
noutify setup [--project PATH] [--server URL] [--topic TOPIC]
noutify test [--project PATH]
noutify confirm [--project PATH]
noutify doctor [--project PATH]
noutify uninstall [--project PATH]
```

`hook claude-stop` is an internal command. It reads the Claude hook payload from
stdin, writes nothing to stdout, and never blocks Claude when notification
delivery fails.

## Uninstall

```powershell
node "$NOUTIFY_ROOT\dist\cli.js" uninstall --project "$TARGET_ROOT"
```

Uninstall removes only the exact Noutify `Stop` command. It preserves unrelated
Claude hooks and keeps Noutify configuration so the user can inspect or reuse it.

## Security model

- The public config never contains the ntfy server topic.
- `.noutify.local.json` is added to `.gitignore` idempotently.
- Topics accept only 16–128 URL-safe characters.
- The Stop adapter reads only `stop_hook_active`, never the transcript.
- Notification failure is best-effort and non-blocking.
- The internal hook emits no stdout or permission decision.

See [NOUTIFY_CONTEXT.md](./NOUTIFY_CONTEXT.md) for the complete vision,
architecture and roadmap.
