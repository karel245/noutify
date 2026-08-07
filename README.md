# Noutify

Noutify connects coding-agent lifecycle events to private mobile notifications.
Phase 0 provides a Windows-first integration for Claude Code and ntfy.

## Quick install with Claude Code

You do not need to type installation commands or configure paths manually.

### 1. Download Noutify

Use GitHub's **Code → Download ZIP** option, or download the current ZIP
directly:

<https://github.com/karel245/noutify/archive/refs/heads/main.zip>

Extract it and rename the extracted repository directory to `Noutify`.

Cloning also works:

```powershell
git clone https://github.com/karel245/noutify.git Noutify
```

Cloning inside another repository creates a nested Git repository. Use the ZIP
route unless you deliberately want that Git layout.

### 2. Place it in your project

The expected layout is:

```text
TargetProject/
|-- Noutify/
|   `-- SETUP.md
`-- ...
```

### 3. Ask Claude to install it

Open Claude Code from `TargetProject/` and send this one-line prompt:

```text
Install Noutify following Noutify/SETUP.md.
```

Claude will locate both directories, verify Node.js, install dependencies, run
the test suite and type checker, build Noutify, configure the project-local Stop
hook, and guide the phone connection.

### 4. Follow the phone prompts

Claude will ask you to subscribe to a private ntfy topic and then send a
`Noutify connected` test. Tell Claude whether it arrived. Noutify becomes active
only after your explicit confirmation, followed by a successful diagnostic.

Never publish or paste the topic. Treat it like a password.

## How language selection works

The setup contract is written once in English, but Claude conducts the
installation in your conversation language. If the conversation does not reveal
a preference, Claude checks the operating-system UI locale and finally falls
back to English. You can request another language at any time.

Commands, paths, filenames, configuration keys and literal program output stay
unchanged so the procedure remains reproducible in every language.

## Requirements

- Windows for the validated Phase 0 path;
- Node.js 24 or newer;
- npm;
- Claude Code with project-local hooks;
- the ntfy Android, iOS or compatible web application.

See the official ntfy phone guide:
<https://docs.ntfy.sh/subscribe/phone/>.

## What installation changes

Noutify creates or merges these files in the target project:

```text
TargetProject/
|-- Noutify/                    local Noutify source and runtime
|-- noutify.config.json         public, safe to version
|-- .noutify.local.json         private, automatically ignored by Git
|-- .gitignore                  private-config rule merged once
`-- .claude/
    `-- settings.local.json     Stop hook merged with existing settings
```

Setup is idempotent. Re-running the prompt preserves the existing topic and does
not duplicate the hook. Existing unrelated Claude hooks are preserved.

## Keep the folder in place

Do not move or delete `Noutify/` after setup. Phase 0 stores the absolute path to
`Noutify/dist/cli.js` in the local Claude hook. If the folder moves, run the
agent-guided setup again from the new location.

When the ZIP is extracted into a tracked project, the parent repository may
track the Noutify source files. The included Noutify `.gitignore` excludes its
`node_modules/`, `dist/` and `work/` directories. Decide whether to version the
source folder according to your project's policy; never version
`.noutify.local.json`.

## Advanced manual commands

The one-line Claude prompt is the default installation path. These commands are
available for troubleshooting or automation:

```text
noutify setup [--project PATH] [--server URL] [--topic TOPIC]
noutify test [--project PATH]
noutify confirm [--project PATH]
noutify doctor [--project PATH]
noutify uninstall [--project PATH]
```

From a target project containing `Noutify/`:

```powershell
$NOUTIFY_ROOT = (Resolve-Path 'Noutify').Path
$TARGET_ROOT = (Resolve-Path (Split-Path -Parent $NOUTIFY_ROOT)).Path
node "$NOUTIFY_ROOT\dist\cli.js" doctor --project "$TARGET_ROOT"
```

`hook claude-stop` is internal. It reads the Claude hook payload from stdin,
writes nothing to stdout and never blocks Claude when delivery fails.

## Development

From the Noutify repository root:

```powershell
npm ci
npm test
npm run typecheck
npm run build
```

The compiled CLI is `dist/cli.js`.

## Security model

- The public configuration never contains the private ntfy topic.
- `.noutify.local.json` is ignored by Git idempotently.
- Topics accept only 16–128 URL-safe characters.
- The Stop adapter reads only `stop_hook_active`, never the transcript.
- Notification delivery is best-effort, time-bounded and non-blocking.
- The internal hook emits no stdout or permission decision.
- Claude must never repeat the topic in conversation or generated artifacts.
- `confirm` is valid only after the phone owner explicitly reports receipt.

## Uninstall

Ask Claude from the target project:

```text
Uninstall Noutify following Noutify/SETUP.md.
```

Or run the advanced command:

```powershell
node "$NOUTIFY_ROOT\dist\cli.js" uninstall --project "$TARGET_ROOT"
```

Uninstall removes only the exact Noutify Stop hook. It preserves unrelated
Claude hooks and keeps configuration available for inspection or reuse.

## Current limitations

- Phase 0 is validated only on Windows, Claude Code and ntfy.
- The `WAITING` notification represents a finished agent turn, not necessarily a
  completed task.
- Real-phone subscription and receipt confirmation remain manual security and
  acceptance gates.
- Moving the project-local Noutify folder requires reinstalling the hook.
- Package-based installation such as `npx noutify init` remains future work.

See [NOUTIFY_CONTEXT.md](./NOUTIFY_CONTEXT.md) for the canonical product vision,
architecture, rules and roadmap.
