# Minimal Multi-Agent Distribution Design

## Summary

Noutify will produce a small, self-contained `Noutify/` installation folder
that can be copied into a target project without carrying source code, tests,
Git history, development dependencies, or implementation plans.

The installation remains agent-guided. The agent asks which coding platforms
will use the project, then installs one integration per selected platform.
Claude Code, Codex, Gemini CLI, local GitHub Copilot CLI, and Windsurf receive
deterministic native lifecycle hooks. Other agents receive an explicitly
experimental memory-based integration when they can read project instructions
and execute Node.js.

This design separates three claims:

- the installation protocol is agent-neutral;
- automatic notifications are reliable only for tested native adapters;
- memory-based notifications are best effort until validated per agent.

## Goals

- Reduce the copied installation folder to runtime essentials.
- Remove dependency installation, source compilation, and repository tests from
  the target-project installation path.
- Let one project select one or several coding agents during setup.
- Add a project-local Codex `Stop` adapter without changing user-global Codex
  configuration.
- Add project-local native adapters for Gemini CLI `AfterAgent`, local GitHub
  Copilot CLI `agentStop`, and Windsurf `post_cascade_response`.
- Keep the existing Claude Code adapter independent and reversible.
- Provide a generic memory fallback for agents without supported lifecycle
  events.
- Preserve topic privacy, explicit phone confirmation, localization,
  idempotency, rollback, collision protection, and non-blocking delivery.
- Generate the distributable folder reproducibly from the verified source tree.

## Non-goals

- Claiming reliable automatic support for every coding agent.
- Modifying global agent configuration or user-wide notification commands.
- Reading transcripts or sending assistant response text to ntfy.
- Shipping repository source, tests, plans, specifications, Git metadata, or
  development dependencies in the copied folder.
- Publishing an npm package, marketplace plugin, or signed installer in this
  iteration.
- Supporting operating systems other than the validated Windows path.
- Claiming native support for Cursor, OpenCode, Cline, or cloud-hosted Copilot
  execution in this iteration.

## 1. Source Tree and Distribution Artifact

Development continues in the repository. A deterministic packaging command
creates a disposable release artifact outside the runtime source tree:

```text
release/
`-- Noutify/
    |-- SETUP.md
    |-- install.mjs
    |-- manifest.json
    |-- LICENSE
    |-- dist/
    |   `-- <compiled runtime modules>
    `-- docs/
        `-- setup-troubleshooting.md
```

Only files required to install, run, diagnose, change language, and uninstall
Noutify belong in this artifact. `package.json`, lockfiles, `node_modules/`,
TypeScript sources, tests, coverage, plans, specifications, worktrees, and Git
metadata are excluded.

`manifest.json` records the distribution format version, Noutify version,
required Node version, and exact relative file list. The lightweight installer
validates this manifest before mutating the target project. The manifest never
contains a topic, target path, username, or machine-specific value.

The packaging command removes and recreates only the exact owned
`release/Noutify/` directory after validating its resolved path. It never
deletes a workspace root or an arbitrary caller-supplied directory.

## 2. Development and Target Installation Gates

Packaging is the development gate. Before producing the artifact, it runs:

1. the full automated test suite;
2. TypeScript type checking;
3. the production build;
4. distribution-content and manifest validation;
5. a nested offline installation smoke test.

Target installation no longer runs `npm ci`, repository tests, type checking,
or compilation. It performs only:

1. Node version validation;
2. distribution-manifest validation;
3. target and requested-agent validation;
4. transactional Noutify setup using the compiled CLI;
5. a concise, validated setup record.

This moves developer work out of user projects while retaining release-time
evidence.

## 3. Agent Selection

`SETUP.md` asks one short question before running the installer:

```text
Detected platform: Codex.
Which agents will use Noutify in this project?
Codex (recommended) / Claude Code / Other / Multiple
```

The executing agent proposes its own platform as the default. The user can
select multiple platforms because the same project may be opened by different
agents. The installer itself remains non-interactive and receives explicit,
repeatable options:

```text
node Noutify/install.mjs --language es --agent codex --agent claude-code
```

Supported canonical identifiers are `codex`, `claude-code`, `gemini-cli`,
`copilot-cli`, `windsurf`, and `generic:<agent-slug>`, where the slug uses
lowercase ASCII letters, digits, and hyphens. Unsupported or malformed values stop before target
mutation. Selected agents are stored in public configuration; no topic or other
secret is stored with them.

Automatic platform detection is advisory. It never silently installs a global
integration or assumes that one detected agent is the project's only agent.

## 4. Codex Native Adapter

The Codex integration owns one exact project-local entry in
`.codex/hooks.json` for the `Stop` event. It merges with unrelated hooks and
preserves malformed or colliding content rather than overwriting it.

The hook invokes the compiled Noutify CLI with a fixed project-relative command
and a short timeout. It receives the official Codex JSON payload on stdin. The
adapter:

- accepts only the `Stop` event shape it needs;
- checks `stop_hook_active` to avoid recursive continuation behavior;
- uses `cwd` only to resolve the configured project safely;
- ignores transcripts, prompts, and `last_assistant_message`;
- normalizes the event to truthful `WAITING`;
- emits no stdout, never asks Codex to continue, and exits successfully even
  when notification delivery fails.

Codex requires users to review and trust new project-local command hooks. The
setup flow instructs the user to open `/hooks`, trust the exact Noutify hook,
then complete the phone test. Installation must never bypass hook trust.

## 5. Claude Code Native Adapter

The existing Claude Code `Stop` hook and `/noutify language` skill remain a
separate adapter. Selecting Claude Code installs only its exact owned settings,
backup, skill, and launcher. Selecting Codex alone does not create `.claude/`.

Migration recognizes only byte-exact historical Noutify-owned Claude files.
Unrelated or modified Claude settings and skills remain untouched.

## 6. Additional Native Adapters

### Gemini CLI

Gemini CLI owns one exact `AfterAgent` command hook merged into the project
`.gemini/settings.json`. `AfterAgent` fires once after the final response for a
turn. The adapter validates `hook_event_name`, checks `stop_hook_active`, ignores
`prompt`, `prompt_response`, and `transcript_path`, emits one empty JSON object
on stdout, and treats delivery failure as non-fatal.

### GitHub Copilot CLI

Local GitHub Copilot CLI owns one exact `agentStop` command hook in
`.github/copilot/settings.local.json`, which is kept local and ignored by Git.
This location prevents the first release from installing the hook into Copilot
cloud-agent jobs, whose ephemeral sandbox has restricted outbound networking.
The adapter accepts the documented camelCase and VS Code-compatible stop input,
checks `stop_hook_active`, ignores the transcript path, emits one empty JSON
object, and never requests continuation.

### Windsurf Cascade

Windsurf owns one exact `post_cascade_response` hook merged into
`.windsurf/hooks.json` with `show_output: false`. The event is asynchronous after
Cascade finishes a response. The adapter validates `agent_action_name`, ignores
the complete response in `tool_info`, uses the workspace root only for safe
project resolution, writes no output, and never blocks Cascade.

All three integrations follow the same snapshot, collision, idempotency,
per-adapter acceptance, doctor, and exact-owned uninstall rules as Codex and
Claude Code.

### Deferred native candidates

- Cursor remains on the generic memory path until its local, CLI, and cloud hook
  surfaces pass separate compatibility tests against the current official hook
  contract.
- OpenCode remains on the generic memory path while its in-process plugin API is
  beta and would add a different runtime-loading model to the minimal package.
- Cline remains on the generic memory path because `TaskComplete` represents
  successful task completion rather than the universal `WAITING` state.

## 7. Generic Memory Integration

`generic:<agent-slug>` is a best-effort fallback, not a native hook. The
installer creates one compact, non-secret instruction file owned by Noutify.
The installing agent identifies the platform's established project-memory file
and passes an explicit, repeatable association:

```text
node Noutify/install.mjs --language es \
  --agent generic:example --memory-link generic:example=AGENTS.md
```

The installer, not free-form model editing, merges one marker-delimited owned
reference into that file. The path must remain inside the target root, must not
traverse a symbolic link, and must name a regular text file or a safely
creatable file. Existing content outside the owned block is preserved.

The instruction says, in substance:

1. when a turn is about to return control to the user, run the generic Noutify
   waiting command exactly once;
2. do not claim task completion; the event means only `WAITING`;
3. never read, print, or summarize private Noutify configuration;
4. notification failure must not change the agent's answer or block the task.

The generic runtime command is agent-neutral and accepts only a validated
display identifier. It reads normal project configuration and sends the same
localized `WAITING` catalog entry as native adapters.

Setup records which memory file was linked. If the agent cannot identify or
safely merge its durable project instructions, setup reports the generic
integration as pending instead of claiming automatic support. It never guesses
an arbitrary path or replaces an existing memory file. In that case the owned
instruction document remains available for an explicit per-session prompt, but
no automatic behavior is claimed.

Only one trigger mode is active for a given agent identity. A platform with a
native adapter does not also receive the memory-trigger instruction, preventing
duplicate notifications.

## 8. Configuration and Status

Public configuration gains a versioned list of integrations. Each entry records:

- canonical agent identifier;
- `native` or `memory` mode;
- owned public integration path when applicable.

Private configuration retains the topic and phone-confirmation state and gains
a per-agent acceptance map recording only whether the phone owner explicitly
confirmed a real automatic notification. It stores no transcript or message
content. Existing installations migrate without rotating or redisplaying the
topic.

`doctor` reports every selected integration independently, for example:

```text
PASS claude-code: native Stop hook and skill are installed
WARN codex: native Stop hook is installed; automatic receipt is unconfirmed
WARN generic-agent: memory link still requires confirmation
```

Static inspection can prove that a Codex hook is installed, but persisted trust
does not prove delivery. After the owner observes a real automatic notification,
the agent runs `confirm-agent <canonical-agent-id>`. `doctor` reports full
adapter acceptance only from that explicit per-agent confirmation. It must not
infer receipt from hook files, process exit status, or provider response alone.

## 9. Setup and Acceptance Flow

The compact agent flow is:

1. detect the current interaction language;
2. propose the current platform and ask which agents will use the project;
3. run the lightweight installer with explicit canonical agent options;
4. display a newly created topic once and explain that it is private;
5. complete any native-hook trust step;
6. pause while the owner subscribes;
7. send the localized manual test;
8. require explicit receipt before `confirm`;
9. run `doctor`;
10. end a real agent turn and require explicit receipt of each selected native
    adapter's automatic notification;
11. after each explicit receipt, run `confirm-agent <canonical-agent-id>` and
    rerun `doctor`.

The final report distinguishes:

- runtime installed;
- phone channel confirmed;
- adapter installed;
- adapter trusted or memory linked;
- real automatic delivery observed.

No earlier stage is presented as proof of a later stage.

## 10. Transactionality and Uninstall

Setup snapshots every target file it may mutate before the first write. A
failure restores byte content and absence state for:

- public and private Noutify configuration;
- ignore rules;
- Claude settings, backup, skill, and launcher when selected;
- Codex hooks when selected;
- Gemini settings when selected;
- local Copilot settings and ignore rules when selected;
- Windsurf hooks when selected;
- generic instruction and memory-link files when selected.

Uninstall removes only exact Noutify-owned entries and files for the selected
integrations. It preserves unrelated Claude hooks, Codex hooks, agent memory,
and Noutify configuration unless a future explicit purge command is designed.

## 11. Security and Privacy

- Topics retain the approved cryptographically random friendly format.
- Topics appear once only for a newly created installation.
- Setup, diagnostic, hook, package, and test artifacts never contain real topic
  values.
- Native and memory adapters ignore conversation content.
- Project-local integration is preferred over global agent configuration.
- Hooks have bounded execution and never block the agent on delivery failure.
- Exact ownership comparisons prevent removal or replacement of unrelated
  configuration.
- Generic memory support is always labeled experimental and best effort.

## 12. Testing and Acceptance

Automated coverage must include:

- exact minimal distribution file allowlist and manifest validation;
- absence of sources, tests, plans, Git metadata, and development dependencies;
- offline nested installation from the generated artifact;
- repeated setup and existing-topic preservation;
- multiple-agent selection and deterministic public configuration;
- Codex hook merge, collision, rollback, idempotency, payload handling, silence,
  bounded delivery, and exact-owned uninstall;
- equivalent lifecycle, merge, collision, rollback, silence, and uninstall
  coverage for Gemini CLI, local Copilot CLI, and Windsurf;
- Claude-only, Codex-only, combined, and generic-memory paths;
- generic memory collision and pending-link behavior;
- topic-free outputs and artifacts;
- truthful per-adapter doctor results.

Real acceptance for the first release requires:

1. generate a fresh minimal `Noutify/` artifact;
2. place it inside a clean Windows target project;
3. install from Codex using the compact contract;
4. trust the project-local Codex hook;
5. receive and confirm the manual Spanish test;
6. finish a later Codex turn;
7. receive the localized automatic `WAITING` notification;
8. repeat the native automatic check with Claude Code when both integrations are
   selected.

Gemini CLI, local Copilot CLI, and Windsurf move from `native unverified` to
`native verified` only after the same real-turn and explicit phone-receipt gate
is completed on their actual supported surface.

## 13. Public Compatibility Language

Documentation may say:

> Noutify uses an agent-neutral installation protocol. Reliable automatic
> notifications require a tested native adapter. Claude Code, Codex, Gemini CLI,
> local GitHub Copilot CLI, and Windsurf have project-local adapters; the
> compatibility table shows which have passed real-device acceptance. Other
> agents can use an experimental memory-based integration when they support
> durable project instructions and local Node.js commands.

Documentation must not say that automatic notifications work with every agent.
The compatibility table distinguishes `native verified`, `native unverified`,
`memory best effort`, and `unsupported or untested`.

## 14. Official Adapter References

- Codex lifecycle hooks: <https://developers.openai.com/codex/hooks>
- Claude Code hooks: <https://code.claude.com/docs/en/hooks>
- Gemini CLI hooks: <https://geminicli.com/docs/hooks/reference/>
- GitHub Copilot hooks: <https://docs.github.com/en/copilot/reference/hooks-reference>
- Windsurf Cascade hooks: <https://docs.windsurf.com/es/windsurf/cascade/hooks>
- Cursor hook rollout: <https://cursor.com/changelog>
- OpenCode plugin events: <https://opencode.ai/v2/docs/build/plugins>
- Cline hooks: <https://docs.cline.bot/customization/hooks>
