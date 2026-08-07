# Friendly Topics, Localized Notifications, and Compact Setup Design

## Summary

Noutify will make new ntfy topics easier to enter on a phone, send notification
content in the language selected during installation, provide a project-local
`/noutify language <language>` command, and reduce the happy-path setup contract
and command output substantially.

The change preserves deterministic hooks, local private configuration,
idempotent setup, explicit phone confirmation, and all existing advanced CLI
capabilities.

## Goals

- Generate a recognizable topic that is secure enough to function as an
  unauthenticated ntfy key and easy to transcribe on a phone.
- Remove topic customization from the normal agent-guided onboarding flow.
- Have Claude show the generated topic clearly once during onboarding.
- Send test and waiting notifications in the installation language.
- Support Spanish and English deterministically in the first localized release.
- Let a user change notification language with `/noutify language español` or
  `/noutify language english`.
- Reduce recurring setup context from about 1,000 words to at most 350 words.
- Reduce successful installation command output while retaining actionable
  failure details.
- Preserve existing installations, hooks, skills, configuration and manual CLI
  options.

## Non-goals

- User-defined topic labels in the agent-guided flow.
- Removing the existing advanced `--topic` CLI option.
- Rotating topics for existing installations.
- Translating notification content through a model at hook runtime.
- Supporting languages other than Spanish and English in this release.
- Translating commands, paths, filenames, configuration keys or raw program
  output.
- Adding ntfy accounts, ACLs, QR codes or a Noutify mobile application.

## 1. Friendly Topic Format

### Format

Every new default topic uses:

```text
Noutify-<12 random characters>
```

Example:

```text
Noutify-54h7ja8k9p2m
```

The suffix alphabet is:

```text
23456789abcdefghjkmnpqrstuvwxyz
```

It contains lowercase letters and digits while excluding visually ambiguous
`0`, `o`, `1`, `l`, and `i`. Twelve uniformly selected characters from this
31-character alphabet provide approximately 59 bits of entropy. The complete
topic contains 20 URL-safe characters and remains below ntfy's 64-character
documented limit.

Generation must use Node's cryptographically secure random source with unbiased
selection. It must not use `Math.random`, timestamps, project names, usernames
or machine identifiers.

### Compatibility

- New setup without `--topic` uses the friendly generator.
- Explicit `--topic` continues to use the existing validator and behavior.
- Existing private configurations keep their current topic unchanged.
- Re-running setup never rotates or redisplays an existing topic as a newly
  generated one.

## 2. Topic Presentation During Onboarding

The earlier blanket rule against repeating the topic is narrowed deliberately.
Claude may display the topic once during the subscription stage of an initial
setup. It must use the selected interaction language and a clear block such as:

```text
Your private ntfy topic:

Noutify-54h7ja8k9p2m

Open ntfy, create a subscription, and enter this topic exactly.
Keep it private because it works as your notification key.
```

Spanish installation uses the equivalent Spanish guidance. After this one
onboarding display, Claude must not include the topic in summaries, commits,
documentation, issues, diagnostics or unrelated messages.

The value remains in `.noutify.local.json`, which is ignored by Git. Noutify
does not claim that a topic shown in a model conversation has the same secrecy as
a value that never left the terminal; the one-time display is an approved
usability trade-off.

## 3. Language Model

### Supported languages

The canonical stored values are:

```ts
type NotificationLanguage = "en" | "es";
```

Accepted user aliases are normalized without case or accents:

| Canonical | Accepted input |
|---|---|
| `en` | `en`, `english`, `inglés`, `ingles` |
| `es` | `es`, `spanish`, `español`, `espanol`, `castellano` |

Unsupported values produce a concise error listing English and Spanish and do
not modify configuration.

### Storage

Language is a local user preference and belongs in `.noutify.local.json`, not in
the versionable public configuration:

```json
{
  "server": "https://ntfy.sh",
  "topic": "Noutify-54h7ja8k9p2m",
  "language": "es",
  "setupCompleted": false
}
```

The private validator accepts configurations created before this field existed
and normalizes a missing language to `en`. The next private configuration write
persists the normalized field. This is a backward-compatible read migration;
there is no schema-version bump in Phase 0.

### Installation language

Claude continues to choose its interaction language from the conversation, then
the OS UI locale, then English. It passes canonical `es` or `en` to the compact
installer. If the interaction language is unsupported, notification language
falls back to English and Claude explains that limitation in the interaction
language.

## 4. Deterministic Notification Catalog

Notification text comes from a code-owned catalog, never from runtime model
generation. The first catalog contains:

| Key | English | Spanish |
|---|---|---|
| test title | `Noutify connected` | `Noutify conectado` |
| test message | `<project>: Test notification delivered by Noutify.` | `<project>: Notificación de prueba enviada por Noutify.` |
| waiting title | `Agent waiting` | `Agente en espera` |
| waiting message | `<project>: The agent finished its response and is waiting for instructions.` | `<project>: El agente terminó su respuesta y espera instrucciones.` |

The project name remains unchanged. Notification tags and priority do not vary
by language. Future event types must add catalog entries for every supported
language before they can ship.

Both the `test` command and the Claude Stop hook read the stored language and use
the same catalog. Notification failure behavior remains silent, bounded and
non-blocking.

## 5. Language Commands

### CLI

The CLI adds:

```text
noutify language <language> [--project PATH]
```

Examples:

```text
noutify language español
noutify language english --project D:\Projects\Example
```

The command:

1. requires an existing valid Noutify configuration;
2. normalizes the alias to `es` or `en`;
3. changes only the private `language` field;
4. preserves server, topic, confirmation and public configuration;
5. writes atomically through the existing configuration layer;
6. responds in the newly selected language;
7. never sends a notification or prints the topic.

### Claude Code project skill

Setup installs this owned project skill:

```text
.claude/skills/noutify/SKILL.md
```

Claude Code exposes it as `/noutify` and passes the remaining text as arguments.
The supported initial invocation is:

```text
/noutify language español
/noutify language english
```

The skill is manually invocable and must not trigger autonomously. Its body is
short, validates that the first argument is `language`, invokes the absolute
project-local Noutify CLI path, and reports the result without reading or
printing private configuration.

The installer owns only a file containing the exact Noutify marker and generated
content. Behavior is conservative:

- create the skill when absent;
- keep it unchanged when the exact current version is already installed;
- update it when an older Noutify-owned version is recognized;
- stop instead of overwriting an unrelated `.claude/skills/noutify/SKILL.md`;
- uninstall only an exact recognized Noutify-owned skill;
- preserve every other project skill and command.

Setup checks for an unrelated skill-path collision before changing target
configuration. For a new installation, it snapshots the target `.gitignore`,
public/private configuration, Claude settings and Noutify skill path. A failure
while writing any owned component restores every snapshot, so the new skill does
not introduce an additional partial-install state.

The skill may become visible immediately through Claude Code live discovery or
on the next session. Documentation must not promise availability before Claude
Code discovers the new file.

## 6. Compact Installer

### Entry point

A plain Node.js entry point that does not require a prior TypeScript build is
added at:

```text
Noutify/scripts/install.mjs
```

From the target project root, Claude runs:

```powershell
node Noutify/scripts/install.mjs --language es
```

The script resolves its own Noutify root and the parent target project. An
advanced `--project PATH` override exists for tests and nonstandard automation,
but the normal contract does not use it.

### Stages

The installer executes in this order:

1. validate Windows, Node.js 24+ and required source files;
2. run `npm ci` inside `Noutify/`;
3. run the full test suite;
4. run TypeScript type checking;
5. build the production CLI;
6. run CLI setup for the target with the selected canonical language;
7. return the new topic and server for the subscription stage.

Target-project configuration is not modified until dependency installation,
tests, type checking and build succeed.

### Output policy

Successful stages produce only concise status lines. Child command output is
captured rather than streamed. On failure, the installer prints:

- the failed stage;
- the child exit code;
- the captured stdout/stderr required for diagnosis;
- a pointer to the on-demand troubleshooting document.

The final successful first-install response uses a stable machine-readable
record containing status, canonical language, server and topic. Claude uses this
record to present the localized subscription message once.

An existing installation returns a distinct status without representing the
topic as newly generated.

## 7. Compact Agent Contract

`SETUP.md` becomes a happy-path state machine of at most:

- 350 words;
- 2,500 UTF-8 characters excluding line-ending differences.

It contains only:

1. interaction-language precedence;
2. the compact installer invocation;
3. the one-time localized topic presentation rule;
4. the pause for phone subscription;
5. `test` and the pause for explicit receipt;
6. `confirm` and `doctor` after receipt;
7. truthful real-agent acceptance wording;
8. a link to troubleshooting loaded only after a failure.

Detailed prerequisites, recovery, security rationale, existing-install behavior
and uninstall guidance move to an English troubleshooting/reference document.
Claude must not read that document on a successful installation.

The installed `/noutify` skill is also compact and loaded only when invoked.

## 8. Data Flow

### New Spanish installation

```text
Spanish conversation
  -> Claude selects es
  -> install.mjs --language es
  -> CLI creates friendly topic and stores language=es privately
  -> Claude displays topic once in Spanish
  -> user subscribes and confirms test receipt
  -> Stop hook reads language=es
  -> Spanish waiting notification reaches phone
```

### Language change

```text
/noutify language english
  -> project skill invokes CLI
  -> CLI normalizes english to en
  -> atomic private-config update
  -> subsequent test and waiting notifications use English
```

Changing language does not rotate the topic, reinstall hooks, alter confirmation
or send a notification.

## 9. Error Handling

- Unsupported language: no write; list supported languages.
- Missing legacy language: normalize to English without rejecting the config.
- Invalid persisted language: reject the private config as malformed.
- Skill path collision: stop setup before overwriting unrelated content.
- Failure after target mutation begins: restore configuration, ignore rules,
  Claude settings and the Noutify skill path to their pre-setup state.
- Compact installer child failure: expose that stage's captured diagnostics and
  stop before later stages.
- Existing incomplete setup: preserve its topic and language; continue from the
  appropriate phone gate without claiming a new topic was created.
- Notification delivery failure: retain existing bounded retry and non-blocking
  hook behavior.
- Malformed Claude settings or private configuration: preserve the file and
  report the blocker without replacement.

## 10. Testing

### Topic generation

- exact `Noutify-` prefix and 12-character suffix;
- suffix contains only the approved alphabet;
- ambiguous characters are impossible;
- deterministic injected random source proves index-to-character mapping;
- explicit `--topic` remains unchanged;
- repeated setup preserves an existing topic.

### Localization

- alias normalization for English and Spanish, including accents and casing;
- unsupported aliases leave configuration unchanged;
- legacy private config without language reads as English;
- Spanish and English test notifications match the catalog;
- Spanish and English waiting notifications match the catalog;
- changing language preserves every unrelated configuration field.

### Claude skill lifecycle

- absent skill is created;
- exact owned skill is idempotent;
- older owned skill is updated;
- unrelated collision is preserved and blocks setup;
- uninstall removes only recognized Noutify content;
- other skills remain unchanged.

### Compact setup

- success suppresses verbose child output;
- failure includes the failed stage and captured diagnostics;
- target configuration is untouched when validation stages fail;
- structured first-install output exposes the generated topic once;
- existing-install output does not misrepresent topic creation;
- target snapshots are restored when hook or skill installation fails;
- `SETUP.md` stays within both word and character budgets;
- the happy-path document points to but does not inline troubleshooting.

### Regression and acceptance

- existing core, CLI, provider, configuration and installer tests remain green;
- a nested `TargetProject/Noutify` smoke test completes to the phone gate;
- Spanish installation delivers Spanish test and waiting messages;
- `/noutify language english` makes later notifications English;
- no private config, generated topic, build output or dependency directory enters
  Git.

## 11. Documentation

- `README.md` leads with the compact installation and friendly topic example.
- `SETUP.md` contains only the token-budgeted happy path.
- A separate troubleshooting document contains conditional detail.
- `NOUTIFY_CONTEXT.md` records friendly topics, local language preference,
  deterministic catalogs and the `/noutify` project skill.
- CLI help lists `language` and its positional value.
- Security text explicitly permits one onboarding display and prohibits later
  repetition.

## 12. Acceptance Criteria

The feature is complete when:

1. New default topics match `Noutify-[approved alphabet]{12}`.
2. Claude asks no topic customization question.
3. Claude clearly displays a new topic once during localized onboarding.
4. `SETUP.md` is no more than 350 words and 2,500 characters.
5. Successful preparation output is compact; failure output remains actionable.
6. Spanish installation stores `es` and sends Spanish test and waiting messages.
7. English installation stores `en` and sends English test and waiting messages.
8. `/noutify language español` and `/noutify language english` update subsequent
   notification language without changing topic or confirmation.
9. Existing configurations without language remain valid and default to English.
10. Existing explicit topics and advanced `--topic` behavior remain compatible.
11. Noutify installs and removes only its recognized project skill.
12. A failed new setup restores all target files touched by Noutify.
13. Automated tests, type checking, build, audit and nested-layout smoke tests
    pass without exposing private values.
