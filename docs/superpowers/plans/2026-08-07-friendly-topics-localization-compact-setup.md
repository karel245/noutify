# Friendly Topics, Localization, and Compact Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate phone-friendly secure topics, localize test and waiting notifications in Spanish or English, add `/noutify language <language>`, and reduce the successful agent-guided setup to a compact installer and a 350-word contract.

**Architecture:** Keep topic generation and language normalization in focused configuration modules, and route all notification text through a deterministic two-language catalog. Install one conservative Claude project skill for `/noutify`, orchestrate preparation through a plain Node.js bootstrap script, and make new setup transactional across configuration, hooks, and the owned skill.

**Tech Stack:** Node.js 24+, TypeScript 7, Vitest 4, Node ESM, Claude Code project skills, PowerShell-facing CLI commands, ntfy.

## Global Constraints

- Phase 0 remains Windows-only, Claude Code-only and ntfy-only.
- Node.js 24 or newer is required.
- Default topics use `Noutify-` followed by exactly 12 uniformly random characters from `23456789abcdefghjkmnpqrstuvwxyz`.
- Topic generation uses cryptographically secure randomness and never uses `Math.random`, time, project name, username or machine identity.
- Existing topics never rotate; explicit advanced `--topic` behavior remains compatible.
- The normal installation never asks for topic customization.
- Claude may show a newly generated topic once during onboarding and must not repeat it in later prose or artifacts.
- Supported notification languages are canonical `en` and `es`; unsupported values do not mutate configuration.
- Language is stored in `.noutify.local.json`; a missing legacy value reads as `en`.
- Notification text is deterministic and code-owned; no model runs in the Stop hook.
- The project skill is manually invocable, never overwrites unrelated content, and uninstall removes only recognized Noutify-owned content.
- New setup is recoverable across `.gitignore`, public/private configuration, Claude settings, settings backup and Noutify skill files.
- `SETUP.md` must remain at or below 350 words and 2,500 UTF-8 characters.
- Successful bootstrap output is compact; failed-stage diagnostics remain available.
- Existing hook silence, timeout, retry, idempotency, privacy and phone-confirmation gates remain unchanged.

---

## File Map

- Create `src/config/language.ts`: canonical language type, alias normalization and persisted-value validation.
- Create `src/config/topic.ts`: friendly alphabet and cryptographically secure topic generator.
- Modify `src/config/project-config.ts`: private language storage, legacy migration and friendly default topic.
- Create `src/core/notification-catalog.ts`: deterministic English/Spanish notification strings.
- Modify `src/core/waiting-notification.ts`: language-aware waiting notification.
- Modify `src/agents/claude-code/stop.ts`: carry stored language into the core.
- Modify `src/installer/setup.ts`: localized test message, language mutation, skill lifecycle and transactional setup.
- Modify `src/cli.ts`: `language`, setup language/JSON options and localized results.
- Create `src/installer/claude-skill.ts`: owned `/noutify` project skill lifecycle.
- Create `src/installer/file-snapshot.ts`: reusable target-file snapshot and rollback.
- Create `scripts/install.mjs`: pre-build compact installer.
- Create `tests/scripts/install.test.mjs`: bootstrap orchestration and output tests.
- Modify focused existing tests under `tests/config`, `tests/core`, `tests/agents`, `tests/installer`, `tests/cli.test.ts` and `tests/docs`.
- Rewrite `SETUP.md`; create `docs/setup-troubleshooting.md`; update `README.md` and `NOUTIFY_CONTEXT.md`.

---

### Task 1: Friendly topics and backward-compatible language configuration

**Files:**
- Create: `src/config/topic.ts`
- Create: `src/config/language.ts`
- Modify: `src/config/project-config.ts`
- Modify: `tests/config/project-config.test.ts`
- Create: `tests/config/topic.test.ts`
- Create: `tests/config/language.test.ts`

**Interfaces:**
- Produces: `NotificationLanguage`, `normalizeNotificationLanguage(value)`, `validateStoredLanguage(value)`, `generateFriendlyTopic(randomIndex?)` and `FRIENDLY_TOPIC_ALPHABET`.
- Produces: `PrivateProjectConfig.language: NotificationLanguage` and `InitialConfigInput.language?: NotificationLanguage`.
- Consumed by: notification catalog, CLI language command, setup and bootstrap tasks.

- [x] **Step 1: Write failing topic and language tests**

Create `tests/config/topic.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  FRIENDLY_TOPIC_ALPHABET,
  generateFriendlyTopic,
} from "../../src/config/topic.js";

describe("friendly topic generation", () => {
  it("maps twelve secure random indexes to the approved alphabet", () => {
    const indexes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 30];
    const topic = generateFriendlyTopic(() => indexes.shift() ?? 0);
    expect(topic).toBe(
      `Noutify-${[0,1,2,3,4,5,6,7,8,9,10,30]
        .map((index) => FRIENDLY_TOPIC_ALPHABET[index])
        .join("")}`,
    );
    expect(topic).toMatch(/^Noutify-[23456789abcdefghjkmnpqrstuvwxyz]{12}$/);
    expect(topic.slice("Noutify-".length)).not.toMatch(/[01ilo]/);
  });
});
```

Create `tests/config/language.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  normalizeNotificationLanguage,
  validateStoredLanguage,
} from "../../src/config/language.js";

describe("notification language", () => {
  it.each([
    ["es", "es"], ["ESPAÑOL", "es"], ["castellano", "es"],
    ["en", "en"], ["English", "en"], ["inglés", "en"],
  ] as const)("normalizes %s to %s", (input, expected) => {
    expect(normalizeNotificationLanguage(input)).toBe(expected);
  });

  it("rejects unsupported aliases", () => {
    expect(() => normalizeNotificationLanguage("français")).toThrow(
      "supported languages: English, Spanish",
    );
  });

  it("defaults a missing legacy value to English", () => {
    expect(validateStoredLanguage(undefined)).toBe("en");
    expect(() => validateStoredLanguage("spanish")).toThrow(
      "stored language must be en or es",
    );
  });
});
```

Extend `tests/config/project-config.test.ts` to assert a new default topic matches the friendly regex, new configurations persist `language: "es"`, and a manually written legacy private config without `language` reads as `language: "en"`.

- [x] **Step 2: Run the focused tests and verify RED**

```powershell
npm test -- tests/config/topic.test.ts tests/config/language.test.ts tests/config/project-config.test.ts
```

Expected: failures because the two modules and private language field do not exist and the current topic lacks the prefix.

- [x] **Step 3: Implement the minimal configuration modules**

Create `src/config/language.ts` with these exports and behavior:

```ts
export type NotificationLanguage = "en" | "es";

function fold(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

export function normalizeNotificationLanguage(value: string): NotificationLanguage {
  const normalized = fold(value);
  if (["es", "spanish", "espanol", "castellano"].includes(normalized)) return "es";
  if (["en", "english", "ingles"].includes(normalized)) return "en";
  throw new Error("supported languages: English, Spanish");
}

export function validateStoredLanguage(value: unknown): NotificationLanguage {
  if (value === undefined) return "en";
  if (value === "en" || value === "es") return value;
  throw new Error("stored language must be en or es");
}
```

Create `src/config/topic.ts`:

```ts
import { randomInt } from "node:crypto";

export const FRIENDLY_TOPIC_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
type RandomIndex = (maxExclusive: number) => number;

export function generateFriendlyTopic(nextIndex: RandomIndex = randomInt): string {
  let suffix = "";
  for (let index = 0; index < 12; index += 1) {
    const character = FRIENDLY_TOPIC_ALPHABET[nextIndex(FRIENDLY_TOPIC_ALPHABET.length)];
    if (character === undefined) throw new Error("random topic index is out of range");
    suffix += character;
  }
  return `Noutify-${suffix}`;
}
```

Modify `project-config.ts` to allow `language` in private keys, return `validateStoredLanguage(privateValue.language)`, accept optional canonical language on initial input, and replace the `randomBytes` default with `generateFriendlyTopic()`.

- [x] **Step 4: Run focused and full configuration tests GREEN**

```powershell
npm test -- tests/config
npm run typecheck
```

Expected: topic/language/configuration tests pass and TypeScript reports no errors.

- [x] **Step 5: Commit Task 1**

```powershell
git add -- src/config/topic.ts src/config/language.ts src/config/project-config.ts tests/config
git diff --cached --check
git commit -m "feat: add friendly topics and language config"
```

---

### Task 2: Deterministic localized notification catalog

**Files:**
- Create: `src/core/notification-catalog.ts`
- Modify: `src/core/waiting-notification.ts`
- Modify: `src/agents/claude-code/stop.ts`
- Modify: `src/cli.ts`
- Modify: `src/installer/setup.ts`
- Modify: `tests/core/waiting-notification.test.ts`
- Modify: `tests/agents/claude-stop.test.ts`
- Modify: `tests/installer/setup.test.ts`
- Modify: `tests/cli.test.ts`

**Interfaces:**
- Consumes: `NotificationLanguage` and `PrivateProjectConfig.language` from Task 1.
- Produces: `notificationText(language, key, projectName)` and language-aware `createWaitingNotification(projectName, language)`.
- Produces: Spanish/English `testProject` and Stop-hook notifications.

- [x] **Step 1: Add failing English and Spanish notification tests**

Update waiting tests to call:

```ts
expect(createWaitingNotification("Demo", "en")).toMatchObject({
  title: "Agent waiting",
  message: "Demo: The agent finished its response and is waiting for instructions.",
});
expect(createWaitingNotification("Demo", "es")).toMatchObject({
  title: "Agente en espera",
  message: "Demo: El agente terminó su respuesta y espera instrucciones.",
});
```

Update setup tests so an `es` installation sends:

```ts
{
  title: "Noutify conectado",
  message: "Demo: Notificación de prueba enviada por Noutify.",
  tags: ["white_check_mark"],
  priority: "default",
}
```

Update Claude Stop tests so `ClaudeStopContext` requires `language` and verifies Spanish reaches the injected sender. Add a CLI hook assertion that its stored Spanish language reaches the Stop adapter while stdout/stderr remain empty.

- [x] **Step 2: Run focused tests and verify RED**

```powershell
npm test -- tests/core/waiting-notification.test.ts tests/agents/claude-stop.test.ts tests/installer/setup.test.ts tests/cli.test.ts
```

Expected: failures from the old one-argument composer and hard-coded English test notification.

- [x] **Step 3: Implement the catalog and language propagation**

Create `src/core/notification-catalog.ts` with a typed catalog:

```ts
import type { NotificationLanguage } from "../config/language.js";

interface NotificationCopy {
  testTitle: string;
  testMessage: (project: string) => string;
  waitingTitle: string;
  waitingMessage: (project: string) => string;
}

const catalog: Record<NotificationLanguage, NotificationCopy> = {
  en: {
    testTitle: "Noutify connected",
    testMessage: (project: string) => `${project}: Test notification delivered by Noutify.`,
    waitingTitle: "Agent waiting",
    waitingMessage: (project: string) => `${project}: The agent finished its response and is waiting for instructions.`,
  },
  es: {
    testTitle: "Noutify conectado",
    testMessage: (project: string) => `${project}: Notificación de prueba enviada por Noutify.`,
    waitingTitle: "Agente en espera",
    waitingMessage: (project: string) => `${project}: El agente terminó su respuesta y espera instrucciones.`,
  },
};

export function notificationCopy(language: NotificationLanguage) {
  return catalog[language];
}
```

Update `createWaitingNotification` and `ClaudeStopContext` with the canonical language. In `runClaudeStopHook`, pass `bundle.private.language`. In `testProject`, select title/message from the same catalog.

- [x] **Step 4: Run focused tests, full tests and typecheck GREEN**

```powershell
npm test -- tests/core tests/agents tests/installer/setup.test.ts tests/cli.test.ts
npm test
npm run typecheck
```

Expected: all localized and regression tests pass with no hook output changes.

- [x] **Step 5: Commit Task 2**

```powershell
git add -- src/core src/agents/claude-code/stop.ts src/installer/setup.ts src/cli.ts tests/core tests/agents tests/installer/setup.test.ts tests/cli.test.ts
git diff --cached --check
git commit -m "feat: localize Noutify notifications"
```

---

### Task 3: CLI language mutation and setup machine output

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/installer/setup.ts`
- Modify: `tests/cli.test.ts`
- Modify: `tests/installer/setup.test.ts`

**Interfaces:**
- Consumes: alias normalization and private language field.
- Produces: `setProjectLanguage(projectRoot, input): Promise<NotificationLanguage>`.
- Produces CLI: `language <language> [--project PATH]`, `setup --language <language>` and `setup --format json`.
- Produces JSON setup records consumed by Task 5.

- [x] **Step 1: Add failing CLI lifecycle tests**

Add tests that:

```ts
expect(await runCli(["language", "español", "--project", root], io, deps)).toBe(0);
expect((await readProjectConfig(root)).private.language).toBe("es");
expect(io.stdout).toEqual(["Idioma de notificaciones actualizado a español."]);
```

Also assert an unsupported language exits 1, preserves the complete previous bundle and never prints the topic. Add setup tests for `--language es` and `--format json` with these JSON shapes:

```json
{"status":"created","language":"es","server":"https://ntfy.sh","topic":"Noutify-54h7ja8k9p2m"}
{"status":"existing","language":"es","server":"https://ntfy.sh"}
```

Use an explicit deterministic topic in CLI tests; do not snapshot a real generated value.
For the `existing` record, seed an existing Spanish configuration first. Re-running
setup must report its stored language and must not use `--language` to silently
change an existing preference; `/noutify language` is the only language mutation
path for an existing installation.

- [x] **Step 2: Run CLI/setup tests and verify RED**

```powershell
npm test -- tests/cli.test.ts tests/installer/setup.test.ts
```

Expected: `language`, `--language`, and `--format` are unknown.

- [x] **Step 3: Implement positional language parsing and mutation**

Extend parsed arguments with `operands: string[]`. Allow one operand only for `language`, keep `hook claude-stop` handling unchanged, and reject operands for every other command. Allow setup options `project`, `server`, `topic`, `language`, `format`; accept only `format=json`.

Add to `setup.ts`:

```ts
export async function setProjectLanguage(
  projectRoot: string,
  value: string,
): Promise<NotificationLanguage> {
  const root = resolve(projectRoot);
  const bundle = await readProjectConfig(root);
  const language = normalizeNotificationLanguage(value);
  bundle.private.language = language;
  await writeProjectConfig(root, bundle);
  return language;
}
```

Extend `SetupProjectResult` with canonical `language` and validated `server` so
the CLI never re-reads or reconstructs those fields for JSON output.

Return Spanish confirmation for `es` and English confirmation for `en`. JSON setup output includes topic only when `result.created` is true. Human setup output keeps the new topic display for initial setup and never displays an existing topic as new.

- [x] **Step 4: Run CLI/setup tests, full suite and build GREEN**

```powershell
npm test -- tests/cli.test.ts tests/installer/setup.test.ts
npm test
npm run typecheck
npm run build
```

Expected: new command and setup formats pass without changing malformed-hook silence.

- [x] **Step 5: Commit Task 3**

```powershell
git add -- src/cli.ts src/installer/setup.ts tests/cli.test.ts tests/installer/setup.test.ts
git diff --cached --check
git commit -m "feat: add notification language command"
```

---

### Task 4: Owned Claude skill and recoverable setup

**Files:**
- Create: `src/installer/claude-skill.ts`
- Create: `src/installer/file-snapshot.ts`
- Create: `tests/installer/claude-skill.test.ts`
- Modify: `src/installer/setup.ts`
- Modify: `tests/installer/setup.test.ts`

**Interfaces:**
- Produces: `preflightClaudeSkill`, `installClaudeSkill`, `uninstallClaudeSkill`, `hasClaudeSkill`, `buildClaudeSkill`.
- Produces: `snapshotFiles(paths)` and `restoreFileSnapshots(snapshots)`.
- Consumes: runtime paths and target project root from setup.

- [x] **Step 1: Write failing skill ownership tests**

Create tests for absent creation, exact idempotency, recognized `v0` upgrade, unrelated collision refusal, exact uninstall and preservation of other skill directories. Assert the generated file begins with:

```markdown
<!-- noutify-managed:v1 -->
---
name: noutify
description: Configure Noutify for this project.
argument-hint: language <english|español>
disable-model-invocation: true
---
```

Assert the body mentions `$ARGUMENTS`, permits only `language <language>`, and invokes the quoted absolute Node/CLI/project paths.

Add a setup rollback test with injected `installSkill` that throws after config and hook writes. Snapshot the initial `.gitignore`, settings and absence of configs/skill; assert all are restored byte-for-byte and no settings backup remains.

- [x] **Step 2: Run installer tests and verify RED**

```powershell
npm test -- tests/installer/claude-skill.test.ts tests/installer/setup.test.ts
```

Expected: missing skill/snapshot modules and missing setup dependency injection.

- [x] **Step 3: Implement atomic owned-skill lifecycle**

Use `.claude/skills/noutify/SKILL.md`, a v1 exact template and one exact legacy v0 template. `preflightClaudeSkill` accepts absent/current/v0 only. Write atomically through a sibling UUID temp file. Uninstall removes current or v0 exact content only; modified or unrelated content is preserved.

Implement generic snapshots:

```ts
export interface FileSnapshot { path: string; contents: Uint8Array | null }
export async function snapshotFiles(paths: string[]): Promise<FileSnapshot[]>;
export async function restoreFileSnapshots(snapshots: FileSnapshot[]): Promise<void>;
```

Before target mutation, setup preflights the skill and snapshots `.gitignore`, both config files, Claude settings, Claude settings backup and the Noutify skill. Wrap configuration, hook and skill writes in one `try/catch`; restore every snapshot on failure. Inject only the skill installer through an optional second-parameter dependency for the rollback test.

Use the narrow dependency boundary:

```ts
export interface SetupDependencies {
  installSkill?: typeof installClaudeSkill;
}

export async function setupProject(
  input: SetupProjectInput,
  dependencies: SetupDependencies = {},
): Promise<SetupProjectResult>;
```

Production defaults to `installClaudeSkill`; tests replace only that final write.
When restoring an absent skill file, remove any now-empty Noutify-owned skill
directories created by the failed attempt, but never remove `.claude`, `skills`, or
directories containing unrelated files.

- [x] **Step 4: Extend doctor and uninstall without breaking return contracts**

Add a `claude-skill` doctor check requiring the exact current skill. `uninstallProject` removes both recognized hook and skill and returns `changed: true` if either changed while preserving `configPreserved: true`. Update exact tests to five doctor checks and verify unrelated skills survive.

- [x] **Step 5: Run installer, CLI and full regression tests GREEN**

```powershell
npm test -- tests/installer tests/cli.test.ts
npm test
npm run typecheck
npm run build
```

Expected: skill lifecycle and rollback pass; all earlier hooks/config behavior remains green.

- [x] **Step 6: Commit Task 4**

```powershell
git add -- src/installer tests/installer tests/cli.test.ts
git diff --cached --check
git commit -m "feat: install the Noutify Claude skill safely"
```

---

### Task 5: Compact pre-build installer

**Files:**
- Create: `scripts/install.mjs`
- Create: `tests/scripts/install.test.mjs`
- Modify: `package.json` only if a test discovery adjustment is required by an observed failing test.

**Interfaces:**
- Consumes: CLI `setup --language <canonical> --format json` from Task 3.
- Produces: `parseArguments(argv)` and `runInstall(argv, dependencies)` exports for tests plus direct Node execution.

- [x] **Step 1: Write failing JavaScript installer tests**

Create `tests/scripts/install.test.mjs` importing the script module. Inject a runner that records commands. Assert a Spanish happy path runs, in order:

```text
npm.cmd ci
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
node <cli> setup --project <target> --language es --format json
```

Assert verbose child success output is absent and the final CLI JSON line is forwarded. Add tests for Node below 24, unsupported language, a failing test stage with captured diagnostics, no later stage after failure, automatic target as the parent of Noutify, and advanced `--project` override.

- [x] **Step 2: Run the script test and verify RED**

```powershell
npm test -- tests/scripts/install.test.mjs
```

Expected: module-not-found failure for `scripts/install.mjs`.

- [x] **Step 3: Implement the compact installer**

Export pure argument parsing and an async runner. Production dependencies use `process.platform`, `process.versions.node`, `spawnSync`, `process.stdout` and `process.stderr`. Resolve Noutify from `import.meta.url`, then default target to its parent.

Each captured stage result has:

```js
{ status: 0, stdout: "", stderr: "" }
```

On success, write only `PASS <stage>` and the final JSON setup record. On failure, write `FAIL <stage> (exit <code>)`, captured stdout/stderr and `See Noutify/docs/setup-troubleshooting.md`, then return 1. Never execute setup if a preparation stage fails.

- [x] **Step 4: Run script, full tests and build GREEN**

```powershell
npm test -- tests/scripts/install.test.mjs
npm test
npm run typecheck
npm run build
```

Expected: compact output assertions and all regressions pass.

- [x] **Step 5: Commit Task 5**

```powershell
git add -- scripts/install.mjs tests/scripts/install.test.mjs package.json
git diff --cached --check
git commit -m "feat: add compact Noutify installer"
```

If `package.json` did not change, omit it from `git add`.

---

### Task 6: Token-budgeted setup and aligned documentation

**Files:**
- Rewrite: `SETUP.md`
- Create: `docs/setup-troubleshooting.md`
- Modify: `README.md`
- Modify: `NOUTIFY_CONTEXT.md`
- Modify: `tests/docs/agent-installation.test.ts`

**Interfaces:**
- Consumes: compact installer command, structured output, localized notifications and `/noutify` skill.
- Produces: happy-path contract within 350 words/2,500 characters and conditional troubleshooting reference.

- [x] **Step 1: Write failing documentation-budget tests**

Add assertions that normalize CRLF, count words with `trim().split(/\s+/)`, and require:

```ts
expect(wordCount(setup)).toBeLessThanOrEqual(350);
expect(setup.length).toBeLessThanOrEqual(2500);
expect(setup).toContain("node Noutify/scripts/install.mjs --language");
expect(setup).toContain("Show the new topic once");
expect(setup).toContain("docs/setup-troubleshooting.md");
expect(setup).not.toContain("npm ci");
expect(setup).toContain("/noutify language español");
```

Require README/context to mention `Noutify-[12 easy characters]`, Spanish/English notifications, and `/noutify language`. Require the troubleshooting file to contain prerequisites, setup recovery, existing installation, topic recovery, skill collision and uninstall sections.

- [x] **Step 2: Run docs tests and verify RED**

```powershell
npm test -- tests/docs/agent-installation.test.ts
```

Expected: SETUP exceeds both budgets and required new files/content are absent.

- [x] **Step 3: Rewrite the happy path and create conditional reference**

Keep `SETUP.md` to these compact sections only:

```markdown
# Install Noutify
## Language
## Prepare
## Subscribe
## Test and confirm
## Accept
## On failure
```

Instruct Claude to choose `es` for Spanish interaction and `en` for English, run one compact installer command, parse the final JSON, show the new topic once in the interaction language, pause for subscription, run `test`, pause for explicit receipt, then run `confirm` and `doctor`. Tell Claude not to load troubleshooting on success.

Move expanded operational detail to `docs/setup-troubleshooting.md`. Update README and master context without returning manual path variables to the primary flow.

- [x] **Step 4: Run docs budgets and complete verification GREEN**

```powershell
npm test -- tests/docs/agent-installation.test.ts
npm test
npm run typecheck
npm run build
npm audit --audit-level=high
git diff --check
```

Expected: budgets pass, all tests pass, build/typecheck succeed, audit has zero high vulnerabilities and diff is clean.

- [x] **Step 5: Commit Task 6**

```powershell
git add -- SETUP.md README.md NOUTIFY_CONTEXT.md docs/setup-troubleshooting.md tests/docs/agent-installation.test.ts
git diff --cached --check
git commit -m "docs: compact localized Noutify onboarding"
```

---

### Task 7: End-to-end verification and PR update

**Files:**
- Verify: disposable `work/friendly-localized-smoke/TargetProject/Noutify/`
- Modify: `docs/superpowers/plans/2026-08-07-friendly-topics-localization-compact-setup.md` checkboxes only.

**Interfaces:**
- Consumes: all completed tasks.
- Produces: fresh nested-layout evidence and updated remote PR branch.

- [x] **Step 1: Build a disposable tracked-source nested layout**

Archive `HEAD` into `work/friendly-localized-smoke/TargetProject/Noutify/`, excluding `.git`, dependencies, build output and private configuration. Verify `SETUP.md`, `scripts/install.mjs`, `package-lock.json` and `src/cli.ts` exist.

- [x] **Step 2: Run compact Spanish installation without printing the topic**

From `TargetProject/`, capture rather than display:

```powershell
$installOutput = & node Noutify/scripts/install.mjs --language es 2>&1
```

Assert exit 0, parse the final JSON internally, require a `created` status, `language=es`, default server and topic regex. Do not emit the captured topic in tool output or reports.

- [x] **Step 3: Verify installed state and localized sends with a local test harness**

Without contacting ntfy, run an inline Node ESM harness from `TargetProject/`.
Import `readProjectConfig` from `./Noutify/dist/config/project-config.js`,
`testProject` and `doctorProject` from `./Noutify/dist/installer/setup.js`, and
`handleClaudeStop` from `./Noutify/dist/agents/claude-code/stop.js`. The harness:

1. reads the target bundle and asserts `language === "es"` and the friendly topic regex;
2. calls `testProject` with an injected sender returning `{ ok: true, attempts: 1 }` and asserts `Noutify conectado`;
3. calls `handleClaudeStop('{"stop_hook_active":false}', context)` with the stored language and an injected sender, then asserts `Agente en espera`;
4. calls `doctorProject` with `process.execPath` and the resolved built CLI path and asserts only the `confirmed` check fails;
5. verifies `.claude/settings.local.json` contains one hook and `.claude/skills/noutify/SKILL.md` begins with the v1 ownership marker.

Invoke the CLI language command with `english`, assert the topic and confirmation fields are unchanged, and verify the injected waiting notification becomes English.

- [x] **Step 4: Run final repository gates after moving the smoke copy outside test discovery**

```powershell
npm test
npm run typecheck
npm run build
npm audit --audit-level=high
git diff --check
git status -sb
```

Expected: all tests pass once, compilation succeeds, zero high vulnerabilities, no whitespace errors and only the plan execution record is modified.

- [x] **Step 5: Run secret and artifact hygiene scans**

Confirm Git tracks no `.noutify.local.json`, `node_modules`, `dist`, `work` or real ntfy topic URL. Inspect `git diff origin/agent/agent-guided-installation...HEAD` and require only approved implementation, tests, docs, spec and plan files.

- [ ] **Step 6: Commit the executed plan and push the PR branch**

```powershell
git add -- docs/superpowers/plans/2026-08-07-friendly-topics-localization-compact-setup.md
git diff --cached --check
git commit -m "docs: record localized setup verification"
git push origin agent/agent-guided-installation
```

- [ ] **Step 7: Verify remote synchronization and update PR description**

Compare `git rev-parse HEAD` with `git ls-remote origin refs/heads/agent/agent-guided-installation`. Update PR #1 summary and verification counts to cover friendly topics, localized notifications, `/noutify`, compact setup and the final suite. Keep the PR as draft unless the user explicitly requests ready-for-review status.
