# Noutify Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a testable Windows-first vertical slice that installs a Claude Code `Stop` hook, sends a truthful `WAITING` notification through ntfy, keeps the private topic outside Git, verifies delivery, diagnoses the installation, and removes only Noutify-owned configuration.

**Architecture:** A TypeScript CLI owns setup and lifecycle commands. The Claude Code adapter normalizes `Stop` payloads into a provider-independent notification, the core composes a fixed truthful message, and the ntfy provider performs a short non-blocking HTTP delivery with one retry for transient failures. Installer modules handle config files and idempotent merge/uninstall separately from runtime delivery.

**Tech Stack:** Node.js 24+, TypeScript 7.0.2, Vitest 4.1.10, Node built-ins (`fetch`, `crypto`, `fs`, `path`, `readline`).

## Global Constraints

- Active scope is Phase 0 only: Windows, Claude Code, ntfy, `WAITING`, safe local config, setup/test/confirm/doctor/uninstall.
- Require Node.js `>=24` for this development baseline; broader compatibility is a later roadmap decision.
- Use ESM and strict TypeScript.
- Use no runtime dependencies in Phase 0.
- Never read a Claude transcript or forward raw hook metadata.
- The `Stop` hook writes nothing to stdout and always returns control without changing Claude behavior.
- ntfy failure never blocks the agent; use a five-second timeout and at most one retry for transient network errors.
- Public config is `noutify.config.json`; private config is `.noutify.local.json` and must be added to `.gitignore`.
- Setup must preserve existing Claude hooks and be idempotent.
- Uninstall removes only the exact Noutify hook command.
- The current directory is not a Git repository. Do not run `git init` implicitly; commit steps are handoff points only.

---

## Planned File Map

```text
package.json                                scripts, bin and dependency versions
package-lock.json                           reproducible development dependencies
tsconfig.json                               strict editor/test type checking
tsconfig.build.json                         production build into dist/
.gitignore                                  source-repo build and private config ignores
src/core/types.ts                           normalized event and notification contracts
src/core/waiting-notification.ts            truthful WAITING message composition
src/providers/ntfy.ts                       HTTP send, timeout and one retry
src/agents/claude-code/stop.ts              safe Stop payload handling
src/config/project-config.ts                config schemas, validation and persistence
src/installer/claude-settings.ts            idempotent merge and precise uninstall
src/installer/setup.ts                      setup/confirm/doctor/uninstall orchestration
src/cli.ts                                  command parsing and user-facing output
tests/core/waiting-notification.test.ts      WAITING truthfulness contract
tests/providers/ntfy.test.ts                 delivery and retry behavior
tests/agents/claude-stop.test.ts             Stop payload and silence behavior
tests/config/project-config.test.ts          public/private separation and validation
tests/installer/claude-settings.test.ts      merge/idempotency/uninstall preservation
tests/installer/setup.test.ts                end-to-end filesystem lifecycle
tests/cli.test.ts                            command routing and hook stdout contract
README.md                                   product and development entry point
SETUP.md                                    operational setup instructions for agents
```

---

### Task 1: Bootstrap and truthful WAITING core

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `.gitignore`
- Create: `src/core/types.ts`
- Create: `src/core/waiting-notification.ts`
- Test: `tests/core/waiting-notification.test.ts`

**Interfaces:**
- Produces: `NoutifyEvent`, `Notification`, and `createWaitingNotification(projectName: string): Notification`.
- Consumes: no earlier task interfaces.

- [x] **Step 1: Create the test/tooling configuration without production behavior**

Create scripts `build`, `typecheck`, and `test`; configure ESM, strict TypeScript, and Vitest. Install exactly `typescript@7.0.2`, `vitest@4.1.10`, and `@types/node@24` as development dependencies.

- [x] **Step 2: Write the failing WAITING notification test**

```ts
import { describe, expect, it } from "vitest";
import { createWaitingNotification } from "../../src/core/waiting-notification.js";

describe("createWaitingNotification", () => {
  it("states only that the agent is waiting", () => {
    expect(createWaitingNotification("Demo")).toEqual({
      title: "Agent waiting",
      message: "Demo: The agent finished its response and is waiting for the next prompt.",
      tags: ["speech_balloon", "hourglass"],
      priority: "default",
    });
  });

  it("never claims that work completed", () => {
    const result = createWaitingNotification("Demo");
    expect(result.message.toLowerCase()).not.toMatch(/completed|validated|finished the task/);
  });
});
```

- [x] **Step 3: Run the test and verify RED**

Run: `npm test -- tests/core/waiting-notification.test.ts`
Expected: FAIL because `src/core/waiting-notification.ts` does not exist.

- [x] **Step 4: Implement the minimal types and composer**

```ts
export interface Notification {
  title: string;
  message: string;
  tags: string[];
  priority: "default" | "high" | "urgent";
}

export function createWaitingNotification(projectName: string): Notification {
  return {
    title: "Agent waiting",
    message: `${projectName}: The agent finished its response and is waiting for the next prompt.`,
    tags: ["speech_balloon", "hourglass"],
    priority: "default",
  };
}
```

- [x] **Step 5: Run the focused and full checks**

Run: `npm test -- tests/core/waiting-notification.test.ts`
Expected: PASS, 2 tests.

Run: `npm run typecheck`
Expected: exit 0.

- [x] **Step 6: Commit handoff point**

Suggested commit once Git exists: `feat(core): add truthful waiting notification`.

---

### Task 2: ntfy provider with bounded failure behavior

**Files:**
- Create: `src/providers/ntfy.ts`
- Test: `tests/providers/ntfy.test.ts`

**Interfaces:**
- Consumes: `Notification` from `src/core/types.ts`.
- Produces: `sendNtfy(notification, config, dependencies?): Promise<SendResult>`.

- [x] **Step 1: Write failing tests for HTTP shape and retry boundaries**

Test a successful POST with title, tags, priority and body; a transient thrown network error followed by success; and an HTTP 400 response with no retry. Inject `fetch` and `sleep` so tests never use the network.

```ts
const result = await sendNtfy(notification, config, {
  fetch: fakeFetch,
  sleep: async () => undefined,
});
expect(result).toEqual({ ok: true, attempts: 1 });
expect(request.headers).toMatchObject({ Title: "Agent waiting" });
```

- [x] **Step 2: Run provider tests and verify RED**

Run: `npm test -- tests/providers/ntfy.test.ts`
Expected: FAIL because `sendNtfy` does not exist.

- [x] **Step 3: Implement minimal delivery**

Implement:

```ts
interface NtfyConfig { server: string; topic: string }
type SendResult =
  | { ok: true; attempts: number }
  | { ok: false; attempts: number; reason: "network" | "http" | "timeout" };
```

Use `AbortSignal.timeout(5000)`, POST the message body, encode the topic as one URL segment, and retry once only for a thrown `TypeError`, abort/timeout, or HTTP `408`, `429`, or `5xx` response.

- [x] **Step 4: Run focused tests and refactor only after GREEN**

Run: `npm test -- tests/providers/ntfy.test.ts`
Expected: PASS for success, transient retry and permanent failure.

Run: `npm test`
Expected: all tests pass.

- [x] **Step 5: Commit handoff point**

Suggested commit: `feat(provider): add bounded ntfy delivery`.

---

### Task 3: Claude Code Stop adapter

**Files:**
- Create: `src/agents/claude-code/stop.ts`
- Test: `tests/agents/claude-stop.test.ts`

**Interfaces:**
- Consumes: `createWaitingNotification` and `sendNtfy`.
- Produces: `parseClaudeStopPayload(input: string): StopPayload` and `handleClaudeStop(input, context): Promise<void>`.

- [x] **Step 1: Write failing payload tests**

Cover valid JSON, malformed/empty input, `stop_hook_active: true`, absence of transcript reads, provider failure, and the requirement that the handler resolves rather than throws.

```ts
it("does not notify a recursively activated Stop hook", async () => {
  let sends = 0;
  await handleClaudeStop('{"stop_hook_active":true}', context(() => sends++));
  expect(sends).toBe(0);
});
```

- [x] **Step 2: Run adapter tests and verify RED**

Run: `npm test -- tests/agents/claude-stop.test.ts`
Expected: FAIL because the Stop adapter does not exist.

- [x] **Step 3: Implement minimal safe handling**

Parse only `stop_hook_active`; ignore every other payload field. When active, return immediately. Otherwise create the fixed `WAITING` notification and call the injected sender inside a catch-all boundary. Return `Promise<void>` and never produce a permission decision.

- [x] **Step 4: Run tests and verify GREEN**

Run: `npm test -- tests/agents/claude-stop.test.ts`
Expected: PASS.

Run: `npm test && npm run typecheck`
Expected: all checks pass.

- [x] **Step 5: Commit handoff point**

Suggested commit: `feat(claude): normalize stop events safely`.

---

### Task 4: Public/private project configuration

**Files:**
- Create: `src/config/project-config.ts`
- Test: `tests/config/project-config.test.ts`

**Interfaces:**
- Produces: `createInitialConfig`, `readProjectConfig`, `writeProjectConfig`, `validateProjectConfig`, and `ensurePrivateIgnore`.
- Consumes: Node filesystem APIs only.

- [x] **Step 1: Write failing filesystem tests**

Use a fresh temporary directory per test. Assert that public config has project/provider/event policy but no topic; private config has server/topic/setup state; `.gitignore` gains exactly one `.noutify.local.json` entry; topics shorter than 16 URL-safe characters are rejected; and repeated writes remain valid.

- [x] **Step 2: Run configuration tests and verify RED**

Run: `npm test -- tests/config/project-config.test.ts`
Expected: FAIL because the config module does not exist.

- [x] **Step 3: Implement explicit runtime validation**

Use hand-written type guards with precise error messages and atomic writes through a sibling temporary file followed by rename. Generate topics with `randomBytes(18).toString("base64url")`. Never serialize the private object into the public file or logs.

- [x] **Step 4: Run focused and full tests**

Run: `npm test -- tests/config/project-config.test.ts`
Expected: PASS.

Run: `npm test && npm run typecheck`
Expected: all checks pass.

- [x] **Step 5: Commit handoff point**

Suggested commit: `feat(config): separate public and private settings`.

---

### Task 5: Idempotent Claude settings installation

**Files:**
- Create: `src/installer/claude-settings.ts`
- Test: `tests/installer/claude-settings.test.ts`

**Interfaces:**
- Produces: `installClaudeStopHook(projectRoot, command): Promise<HookInstallResult>`, `hasClaudeStopHook`, and `uninstallClaudeStopHook`.
- Consumes: an exact hook command generated by setup.

- [x] **Step 1: Write failing preservation tests**

Test an absent settings file, an existing unrelated `PostToolUse` hook, an existing unrelated `Stop` hook, a second Noutify setup, uninstall, and malformed JSON. Assert that setup creates one backup before the first mutation and refuses malformed JSON without overwriting it.

- [x] **Step 2: Run installer tests and verify RED**

Run: `npm test -- tests/installer/claude-settings.test.ts`
Expected: FAIL because the installer module does not exist.

- [x] **Step 3: Implement exact command ownership**

Store the hook in `.claude/settings.local.json` with Claude's `Stop` array shape. Identify ownership only when `hook.type === "command"` and `hook.command === expectedCommand`. Preserve unknown keys and all non-owned hooks. On uninstall, remove empty Noutify-created containers but preserve unrelated structures.

- [x] **Step 4: Run focused and full checks**

Run: `npm test -- tests/installer/claude-settings.test.ts`
Expected: PASS.

Run: `npm test && npm run typecheck`
Expected: all checks pass.

- [x] **Step 5: Commit handoff point**

Suggested commit: `feat(installer): merge and remove Claude hooks safely`.

---

### Task 6: Setup lifecycle and CLI

**Files:**
- Create: `src/installer/setup.ts`
- Create: `src/cli.ts`
- Test: `tests/installer/setup.test.ts`
- Test: `tests/cli.test.ts`

**Interfaces:**
- Consumes: config, hook installer, Stop adapter and ntfy provider.
- Produces: `setupProject`, `testProject`, `confirmProject`, `doctorProject`, `uninstallProject`, and the `noutify` executable.

- [x] **Step 1: Write failing setup lifecycle tests**

Create a temporary project and verify this sequence:

```text
setup      -> public/private files + gitignore + one Claude Stop hook
setup      -> no duplicates
test       -> one injected notification, setupCompleted remains false
confirm    -> setupCompleted becomes true
doctor     -> all required checks pass
uninstall  -> Noutify hook removed, unrelated hooks and configs preserved
```

- [x] **Step 2: Write failing CLI contract tests**

Test commands `setup`, `test`, `confirm`, `doctor`, `uninstall`, and internal `hook claude-stop`. Capture stdout/stderr. Assert that the internal hook command writes zero stdout even for malformed input and provider failure.

- [x] **Step 3: Run lifecycle and CLI tests and verify RED**

Run: `npm test -- tests/installer/setup.test.ts tests/cli.test.ts`
Expected: FAIL because orchestration and CLI files do not exist.

- [x] **Step 4: Implement orchestration and argument parsing**

Support:

```text
noutify setup [--project PATH] [--server URL] [--topic TOPIC]
noutify test [--project PATH]
noutify confirm [--project PATH]
noutify doctor [--project PATH]
noutify uninstall [--project PATH]
noutify hook claude-stop --project PATH
```

Default project path is `process.cwd()`. `setup` prints mobile instructions but never the private topic after initial interactive display. `test` sends “Noutify connected” without completing setup. `confirm` is the only command that sets `setupCompleted: true`. `doctor` reports named checks without printing private values. `uninstall` keeps configuration by default.

- [x] **Step 5: Run focused tests and complete the TDD cycle**

Run: `npm test -- tests/installer/setup.test.ts tests/cli.test.ts`
Expected: PASS.

Run: `npm test && npm run typecheck && npm run build`
Expected: all commands exit 0.

- [x] **Step 6: Commit handoff point**

Suggested commit: `feat(cli): deliver phase zero setup lifecycle`.

---

### Task 7: Operational documentation and final verification

**Files:**
- Create: `README.md`
- Create: `SETUP.md`
- Modify: `NOUTIFY_CONTEXT.md`

**Interfaces:**
- Consumes: the completed CLI behavior.
- Produces: human onboarding, agent-operable setup instructions, and an updated phase status.

- [x] **Step 1: Write documentation against the real CLI**

Document prerequisites, local development, exact commands, mobile ntfy steps, confirmation, doctor, uninstall, privacy rules and current Phase 0 limitations. `SETUP.md` must instruct an agent to detect, explain, run setup, wait for the user's phone action, send a test, ask for confirmation, run `confirm`, then run `doctor`.

- [x] **Step 2: Verify documentation examples mechanically**

Run every non-network help or dry command shown in the docs. Search for personal paths, real ntfy topics, unfinished-work markers (`T[O]DO` and `T[B]D`), and claims of unsupported operating systems or agents.

- [x] **Step 3: Run the full verification suite**

Run:

```text
npm test
npm run typecheck
npm run build
node dist/cli.js --help
node dist/cli.js doctor --project "$env:TEMP\noutify-phase0-fixture"
```

Expected: tests pass, typecheck/build exit 0, help lists all Phase 0 commands, and doctor returns structured failures or success without secrets.

- [x] **Step 4: Perform a dry end-to-end install**

Against a temporary project containing an unrelated Claude hook, run setup twice, doctor, uninstall, and compare settings before/after. Do not send a real notification in automated verification.

- [x] **Step 5: Record the real-device gate honestly**

Do not mark phone delivery complete until the user supplies an ntfy topic, subscribes the phone, runs the test command, and confirms receipt. Automated completion means the software path is verified; the real-device gate remains a named manual acceptance step.

- [x] **Step 6: Commit handoff point**

Suggested commit: `docs: add phase zero setup and verification guide`.
