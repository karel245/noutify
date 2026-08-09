# Additional Native Agent Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project-local native `WAITING` adapters for Gemini CLI, local GitHub Copilot CLI, and Windsurf Cascade to the verified minimal Noutify distribution.

**Architecture:** Each platform gets a small payload parser plus an exact-owned JSON settings adapter registered behind the interface established by the minimal-distribution plan. Platform-specific output requirements stay inside their parser/CLI route, while configuration, localization, notification delivery, transactionality, confirmation, doctor, packaging, and uninstall remain shared. Compatibility stays `native unverified` until a real turn and phone receipt are confirmed on that platform.

**Tech Stack:** Node.js 24+, TypeScript 7, ESM, Vitest 4, Gemini CLI hooks, GitHub Copilot CLI hooks, Windsurf Cascade hooks, ntfy.

## Global Constraints

- Complete `2026-08-09-minimal-distribution-codex-memory.md` before this plan.
- The validated target path remains Windows-only with Node.js 24 or newer and ntfy.
- Gemini CLI owns `.gemini/settings.json` `AfterAgent`; local Copilot CLI owns `.github/copilot/settings.local.json` `agentStop`; Windsurf owns `.windsurf/hooks.json` `post_cascade_response`.
- Copilot support is local-only; never install a project hook into cloud-agent execution or a committed shared Copilot settings path.
- Hooks ignore prompts, transcripts, response bodies, `tool_info`, and all other conversational content.
- Gemini and Copilot emit exactly one empty JSON object plus a newline on stdout; Windsurf and all failure paths are silent.
- Every hook is exact-owned, idempotent, merge-safe, bounded, non-blocking, and removed only by exact structural comparison.
- Setup snapshots all selected adapter files and ignore rules before the first write and restores prior bytes/absence on any failure.
- Automatic acceptance is stored only after explicit real-phone receipt through `confirm-agent <id>`.
- Documentation uses `native unverified` until real device acceptance is completed for that platform.
- The generated distribution remains limited to the established allowlist and contains compiled runtime only.

---

## File Map

- Create `src/installer/json-hook-file.ts`: reusable atomic exact-owned JSON array merge without platform semantics.
- Refactor `src/installer/codex-hooks.ts`: consume the JSON merge helper as a regression fixture.
- Create `src/agents/gemini-cli/after-agent.ts` and `src/installer/adapters/gemini-cli.ts`.
- Create `src/agents/copilot-cli/agent-stop.ts` and `src/installer/adapters/copilot-cli.ts`.
- Create `src/agents/windsurf/post-cascade-response.ts` and `src/installer/adapters/windsurf.ts`.
- Modify `src/installer/agent-adapter.ts`, `src/installer/setup.ts`, and `src/cli.ts`: register and execute the adapters.
- Modify `src/config/project-config.ts`: ignore local Copilot settings safely when selected.
- Modify `SETUP.md`, `README.md`, `docs/setup-troubleshooting.md`, and `NOUTIFY_CONTEXT.md`: platform-specific trust/acceptance and compatibility states.
- Add focused parser, installer, orchestration, CLI, documentation, and package tests.

---

### Task 1: Extract the exact-owned JSON hook merge primitive

**Files:**
- Create: `src/installer/json-hook-file.ts`
- Modify: `src/installer/codex-hooks.ts`
- Create: `tests/installer/json-hook-file.test.ts`
- Modify: `tests/installer/codex-hooks.test.ts`

**Interfaces:**
- Consumes: the proven Codex exact-owned structure from plan 1.
- Produces: `JsonHookFileSpec<T> { relativePath: string; arrayPath: readonly string[]; owned: T; isOwned(value: unknown): boolean }`.
- Produces: `preflightJsonHook`, `installJsonHook`, `inspectJsonHook`, and `uninstallJsonHook`, all preserving unrelated object keys and array entries.
- Ownership is structural equality through the platform's `isOwned`; invalid JSON, a non-object root, or a non-array owned path is a collision error before write.

- [ ] **Step 1: Write failing generic merge and Codex regression tests**

```ts
const spec = {
  relativePath: ".agent/settings.json",
  arrayPath: ["hooks", "Stop"],
  owned: { command: "node", args: ["noutify"] },
  isOwned: (value: unknown) => deepEqual(value, { command: "node", args: ["noutify"] }),
};
await installJsonHook(projectRoot, spec);
expect(await inspectJsonHook(projectRoot, spec)).toEqual({ installed: true, count: 1 });
```

Cover missing containers, unrelated siblings, duplicate owned entries, malformed containers, atomic writes, exact-owned removal, and restoration of empty container shape based on the first backup/snapshot behavior used by Codex.

- [ ] **Step 2: Run focused tests and verify the helper is missing**

Run: `npm test -- tests/installer/json-hook-file.test.ts tests/installer/codex-hooks.test.ts`

Expected: FAIL because the shared merge functions do not exist.

- [ ] **Step 3: Implement the generic helper and refactor Codex without behavior changes**

```ts
export interface JsonHookFileSpec<T> {
  relativePath: string;
  arrayPath: readonly string[];
  owned: T;
  isOwned(value: unknown): boolean;
}

export interface JsonHookInspection {
  installed: boolean;
  count: number;
}
```

Read JSON as an object, walk only object containers, require the final value to be an array when present, remove all exact-owned duplicates, append one owned entry on install, and remove exact-owned entries only on uninstall. Write atomically; do not normalize unrelated formatting until a Noutify mutation is required.

- [ ] **Step 4: Run helper, Codex, setup, and full regression tests**

Run: `npm test -- tests/installer/json-hook-file.test.ts tests/installer/codex-hooks.test.ts tests/installer/setup.test.ts && npm run typecheck && npm test`

Expected: PASS with byte-preserving no-op behavior for an already correct Codex hook.

- [ ] **Step 5: Commit the merge primitive**

```powershell
git add src/installer/json-hook-file.ts src/installer/codex-hooks.ts tests/installer/json-hook-file.test.ts tests/installer/codex-hooks.test.ts
git commit -m "refactor: share exact-owned JSON hook merge"
```

---

### Task 2: Add Gemini CLI AfterAgent support

**Files:**
- Create: `src/agents/gemini-cli/after-agent.ts`
- Create: `src/installer/adapters/gemini-cli.ts`
- Modify: `src/installer/agent-adapter.ts`
- Modify: `src/cli.ts`
- Create: `tests/agents/gemini-after-agent.test.ts`
- Create: `tests/installer/gemini-cli.test.ts`
- Modify: `tests/cli.test.ts`

**Interfaces:**
- Consumes: `runWaitingHook`, `AgentAdapter`, and `json-hook-file`.
- Produces: `parseGeminiAfterAgentPayload(input: string): WaitingHookPayload` requiring `hook_event_name === "AfterAgent"` and treating `stop_hook_active === true` as recursive.
- Owns one `.gemini/settings.json` entry under `hooks.AfterAgent` with command, fixed args, and 10-second timeout.
- Produces CLI route `hook gemini-after-agent`; after processing any syntactically valid Gemini hook event it writes exactly `{}\n`, including notification delivery failure, while malformed/wrong-event input remains safe and writes `{}\n` so Gemini receives a valid hook response.

- [ ] **Step 1: Write failing Gemini parser, merge, and output-contract tests**

```ts
expect(parseGeminiAfterAgentPayload(JSON.stringify({
  hook_event_name: "AfterAgent",
  stop_hook_active: false,
  prompt: "private",
  prompt_response: "private",
  transcript_path: "private",
}))).toEqual({ valid: true, recursive: false });

expect(await runCli(["hook", "gemini-after-agent", "--project", root], io, deps)).toBe(0);
expect(io.stdout).toEqual(["{}"]);
expect(io.stderr).toEqual([]);
```

Cover recursive suppression, wrong event, malformed JSON, sender rejection, ignored private fields, unrelated hook preservation, duplicate repair, collision, rollback, and exact-owned uninstall.

- [ ] **Step 2: Run Gemini tests and verify failures**

Run: `npm test -- tests/agents/gemini-after-agent.test.ts tests/installer/gemini-cli.test.ts tests/cli.test.ts`

Expected: FAIL because the Gemini parser, adapter, and CLI route are absent.

- [ ] **Step 3: Implement and register the Gemini adapter**

```ts
export function parseGeminiAfterAgentPayload(input: string): WaitingHookPayload {
  try {
    const value: unknown = JSON.parse(input);
    if (!isRecord(value) || value.hook_event_name !== "AfterAgent")
      return { valid: false, recursive: false };
    return { valid: true, recursive: value.stop_hook_active === true };
  } catch {
    return { valid: false, recursive: false };
  }
}
```

Register `gemini-cli`, build fixed shell-free args `[cliPath, "hook", "gemini-after-agent", "--project", root]`, use `.gemini/settings.json` as the public integration path, and ensure CLI output contains only the empty object expected by Gemini.

- [ ] **Step 4: Run Gemini, setup, type, and full tests**

Run: `npm test -- tests/agents/gemini-after-agent.test.ts tests/installer/gemini-cli.test.ts tests/installer/setup.test.ts tests/cli.test.ts && npm run typecheck && npm test`

Expected: PASS; Gemini-only setup creates no Claude, Codex, Copilot, or Windsurf settings.

- [ ] **Step 5: Commit Gemini support**

```powershell
git add src/agents/gemini-cli/after-agent.ts src/installer/adapters/gemini-cli.ts src/installer/agent-adapter.ts src/cli.ts tests/agents/gemini-after-agent.test.ts tests/installer/gemini-cli.test.ts tests/cli.test.ts
git commit -m "feat: add Gemini CLI notifications"
```

---

### Task 3: Add local GitHub Copilot CLI agentStop support

**Files:**
- Create: `src/agents/copilot-cli/agent-stop.ts`
- Create: `src/installer/adapters/copilot-cli.ts`
- Modify: `src/installer/agent-adapter.ts`
- Modify: `src/config/project-config.ts`
- Modify: `src/cli.ts`
- Create: `tests/agents/copilot-agent-stop.test.ts`
- Create: `tests/installer/copilot-cli.test.ts`
- Modify: `tests/config/project-config.test.ts`
- Modify: `tests/cli.test.ts`

**Interfaces:**
- Consumes: shared dispatcher, adapter registry, JSON hook helper, and ignore merge.
- Produces: `parseCopilotAgentStopPayload(input: string): WaitingHookPayload` accepting documented `hookEventName: "agentStop"` and VS Code-compatible `hook_event_name: "agentStop"`, but rejecting conflicting names.
- Owns `.github/copilot/settings.local.json` and ensures that exact path is ignored by Git once.
- Produces CLI route `hook copilot-agent-stop`, writing exactly `{}\n` and no stderr for every invocation.

- [ ] **Step 1: Write failing payload, local-path, ignore, and output tests**

```ts
expect(parseCopilotAgentStopPayload('{"hookEventName":"agentStop"}'))
  .toEqual({ valid: true, recursive: false });
expect(parseCopilotAgentStopPayload('{"hook_event_name":"agentStop"}'))
  .toEqual({ valid: true, recursive: false });
expect(parseCopilotAgentStopPayload(
  '{"hookEventName":"agentStop","hook_event_name":"beforeTool"}',
).valid).toBe(false);
```

Assert setup writes only `.github/copilot/settings.local.json`, adds `/.github/copilot/settings.local.json` once to `.gitignore`, never writes shared `.github/hooks/`, preserves unrelated local settings, restores both settings and ignore bytes on failure, and removes only the exact-owned hook.

- [ ] **Step 2: Run Copilot tests and verify failures**

Run: `npm test -- tests/agents/copilot-agent-stop.test.ts tests/installer/copilot-cli.test.ts tests/config/project-config.test.ts tests/cli.test.ts`

Expected: FAIL because the Copilot adapter and dedicated private ignore rule are absent.

- [ ] **Step 3: Implement local-only Copilot integration and safe ignore handling**

```ts
const COPILOT_LOCAL_SETTINGS = "/.github/copilot/settings.local.json";

export async function ensureIgnoreRules(projectRoot: string, rules: readonly string[]): Promise<void> {
  // Preserve existing bytes, append each missing exact line once, and write only when changed.
}
```

Use the documented `agentStop` hook array in the local settings file, fixed shell-free command/args, and a 10-second timeout. Snapshot `.gitignore` and settings before preflight/install; never advertise or configure Copilot cloud support.

- [ ] **Step 4: Run Copilot, transaction, type, and full tests**

Run: `npm test -- tests/agents/copilot-agent-stop.test.ts tests/installer/copilot-cli.test.ts tests/installer/setup.test.ts tests/config/project-config.test.ts tests/cli.test.ts && npm run typecheck && npm test`

Expected: PASS; `.gitignore` is unchanged on repeated setup and restored exactly after injected failure.

- [ ] **Step 5: Commit local Copilot support**

```powershell
git add src/agents/copilot-cli/agent-stop.ts src/installer/adapters/copilot-cli.ts src/installer/agent-adapter.ts src/config/project-config.ts src/cli.ts tests/agents/copilot-agent-stop.test.ts tests/installer/copilot-cli.test.ts tests/config/project-config.test.ts tests/cli.test.ts
git commit -m "feat: add local Copilot CLI notifications"
```

---

### Task 4: Add Windsurf Cascade post-response support

**Files:**
- Create: `src/agents/windsurf/post-cascade-response.ts`
- Create: `src/installer/adapters/windsurf.ts`
- Modify: `src/installer/agent-adapter.ts`
- Modify: `src/cli.ts`
- Create: `tests/agents/windsurf-post-response.test.ts`
- Create: `tests/installer/windsurf.test.ts`
- Modify: `tests/cli.test.ts`

**Interfaces:**
- Consumes: shared dispatcher, adapter registry, and JSON hook helper.
- Produces: `parseWindsurfPostResponsePayload(input: string): WaitingHookPayload` requiring `agent_action_name === "post_cascade_response"`.
- Owns one `.windsurf/hooks.json` `post_cascade_response` entry with `show_output: false` and fixed shell-free command/args.
- Produces CLI route `hook windsurf-post-response`, always silent and exit 0.

- [ ] **Step 1: Write failing Windsurf parser, merge, and silence tests**

```ts
expect(parseWindsurfPostResponsePayload(JSON.stringify({
  agent_action_name: "post_cascade_response",
  tool_info: { response: "private response" },
  workspace_root: projectRoot,
}))).toEqual({ valid: true, recursive: false });

expect(parseWindsurfPostResponsePayload(
  '{"agent_action_name":"pre_cascade_response"}',
).valid).toBe(false);
```

Assert `tool_info` and workspace payload content never reaches notification text or output, `show_output` is false, unrelated hooks remain, duplicates repair, malformed containers collide before mutation, delivery failure is silent, and uninstall removes only exact ownership.

- [ ] **Step 2: Run Windsurf tests and verify failures**

Run: `npm test -- tests/agents/windsurf-post-response.test.ts tests/installer/windsurf.test.ts tests/cli.test.ts`

Expected: FAIL because the Windsurf parser, adapter, and CLI route are absent.

- [ ] **Step 3: Implement and register the Windsurf adapter**

```ts
export function parseWindsurfPostResponsePayload(input: string): WaitingHookPayload {
  try {
    const value: unknown = JSON.parse(input);
    return {
      valid: isRecord(value) && value.agent_action_name === "post_cascade_response",
      recursive: false,
    };
  } catch {
    return { valid: false, recursive: false };
  }
}
```

Build the exact owned entry with `show_output: false`, fixed executable/args, and the shared timeout. Resolve the configured project from the fixed `--project` argument, never from untrusted `workspace_root` payload data.

- [ ] **Step 4: Run Windsurf, setup, type, and full tests**

Run: `npm test -- tests/agents/windsurf-post-response.test.ts tests/installer/windsurf.test.ts tests/installer/setup.test.ts tests/cli.test.ts && npm run typecheck && npm test`

Expected: PASS; Windsurf-only setup creates only its selected integration plus Noutify configuration.

- [ ] **Step 5: Commit Windsurf support**

```powershell
git add src/agents/windsurf/post-cascade-response.ts src/installer/adapters/windsurf.ts src/installer/agent-adapter.ts src/cli.ts tests/agents/windsurf-post-response.test.ts tests/installer/windsurf.test.ts tests/cli.test.ts
git commit -m "feat: add Windsurf notifications"
```

---

### Task 5: Prove combined rollback, doctor, uninstall, and distribution inclusion

**Files:**
- Modify: `src/installer/setup.ts`
- Modify: `tests/installer/setup.test.ts`
- Modify: `tests/cli.test.ts`
- Modify: `tests/scripts/package.test.mjs`
- Modify: `tests/scripts/distribution-install.test.mjs`

**Interfaces:**
- Consumes: all five native adapters and generic memory adapter.
- Produces deterministic integration ordering by canonical agent ID, one doctor install check and one automatic receipt check per selected agent, and complete exact-owned uninstall across every configured adapter.
- Distribution manifest automatically includes every compiled adapter/runtime file and rejects a missing compiled dependency.

- [ ] **Step 1: Write failing all-adapter lifecycle tests**

```ts
const agents = ["windsurf", "copilot-cli", "gemini-cli", "codex", "claude-code"] as const;
await setupProject({ ...runtime, projectRoot, agents });
expect((await readProjectConfig(projectRoot)).public.integrations.map(({ agent }) => agent))
  .toEqual(["claude-code", "codex", "copilot-cli", "gemini-cli", "windsurf"]);

for (const agent of agents) await confirmAgent(projectRoot, agent);
expect((await doctorProject(projectRoot, runtime)).checks
  .filter(({ name }) => name.endsWith("automatic-receipt"))
  .every(({ status }) => status === "pass")).toBe(true);
```

Inject a failure at each adapter position and assert all configs, hooks, skills, memory files, and ignore rules restore exactly. Then uninstall and assert unrelated entries remain in every agent settings file. Generate the distribution, remove one newly required compiled adapter file, and assert manifest validation fails before installation.

- [ ] **Step 2: Run combined lifecycle and distribution tests and verify gaps**

Run: `npm test -- tests/installer/setup.test.ts tests/cli.test.ts tests/scripts/package.test.mjs tests/scripts/distribution-install.test.mjs`

Expected: FAIL until orchestration and package expectations cover every new adapter.

- [ ] **Step 3: Complete registry enumeration and shared orchestration**

```ts
export const AVAILABLE_NATIVE_ADAPTERS: ReadonlyMap<NativeAgentId, AgentAdapter> = new Map([
  ["claude-code", claudeCodeAdapter],
  ["codex", codexAdapter],
  ["copilot-cli", copilotCliAdapter],
  ["gemini-cli", geminiCliAdapter],
  ["windsurf", windsurfAdapter],
]);
```

Use the registry for setup, doctor, uninstall, and hook eligibility. Keep each adapter inspection independent: missing/modified selected hook is `fail`; installed but unconfirmed automatic receipt is `warn`; explicitly confirmed receipt is `pass`. Ensure the packager derives compiled files from the complete build output rather than a hand-maintained adapter list.

- [ ] **Step 4: Run the complete automated and package gates**

Run: `npm test && npm run typecheck && npm run build && npm run package`

Expected: PASS with a minimal allowlisted artifact and successful offline nested install selecting all five native adapters.

- [ ] **Step 5: Commit combined lifecycle coverage**

```powershell
git add src/installer/setup.ts tests/installer/setup.test.ts tests/cli.test.ts tests/scripts/package.test.mjs tests/scripts/distribution-install.test.mjs
git commit -m "test: verify all native agent adapters"
```

---

### Task 6: Publish truthful compatibility and platform acceptance instructions

**Files:**
- Modify: `SETUP.md`
- Modify: `README.md`
- Modify: `docs/setup-troubleshooting.md`
- Modify: `NOUTIFY_CONTEXT.md`
- Modify: `tests/docs/agent-installation.test.ts`
- Modify: `tests/docs/compatibility.test.ts`

**Interfaces:**
- Consumes: canonical agent IDs and commands implemented in Tasks 2–5.
- Produces: exact install examples for Gemini CLI, local Copilot CLI, Windsurf, and multiple agents.
- Produces: separate acceptance instructions and compatibility state for each native platform.

- [ ] **Step 1: Write failing public-contract tests for all platforms**

```ts
for (const id of ["gemini-cli", "copilot-cli", "windsurf"]) {
  expect(setup).toContain(`--agent ${id}`);
  expect(setup).toContain(`confirm-agent ${id}`);
}
expect(readme).toContain("local GitHub Copilot CLI");
expect(readme).not.toContain("Copilot cloud: native verified");
expect(readme).toContain("Gemini CLI | native unverified");
expect(readme).toContain("Windsurf Cascade | native unverified");
```

Assert settings paths and events match the implementation, Gemini/Copilot empty-object behavior is documented only in troubleshooting, and the primary setup prompt stays one line and platform-neutral.

- [ ] **Step 2: Run documentation tests and verify missing platform guidance**

Run: `npm test -- tests/docs/agent-installation.test.ts tests/docs/compatibility.test.ts`

Expected: FAIL until the three platforms and local-only Copilot boundary are documented.

- [ ] **Step 3: Update the agent contract, compatibility matrix, and troubleshooting**

Document detection/default selection, repeatable `--agent`, per-platform settings/event, local-only Copilot limitation, trust/reload steps drawn from the official platform docs, real-turn acceptance, explicit phone receipt, `confirm-agent`, and doctor rerun. Keep Cursor, OpenCode, and Cline on `memory best effort` or `unsupported or untested`; never claim universal automatic support.

- [ ] **Step 4: Run final automated verification and inspect the generated artifact**

Run: `npm test && npm run typecheck && npm run build && npm run package && git status --short`

Expected: PASS; the generated `release/Noutify/SETUP.md` contains all native IDs, no release file contains a topic, and only intentional tracked changes remain.

- [ ] **Step 5: Commit documentation and final plan-2 verification**

```powershell
git add SETUP.md README.md docs/setup-troubleshooting.md NOUTIFY_CONTEXT.md tests/docs/agent-installation.test.ts tests/docs/compatibility.test.ts
git commit -m "docs: add native agent compatibility guidance"
```

---

## Plan 2 Acceptance Checklist

- [ ] `npm test`, `npm run typecheck`, `npm run build`, and `npm run package` pass.
- [ ] All five native adapters install together, remain idempotent, roll back as one transaction, and uninstall exact-owned entries only.
- [ ] Gemini CLI emits `{}` and sends one localized notification after a real `AfterAgent` event; explicit receipt is recorded.
- [ ] Local GitHub Copilot CLI emits `{}` and sends one localized notification after a real `agentStop` event; explicit receipt is recorded.
- [ ] Windsurf stays silent and sends one localized notification after a real `post_cascade_response` event; explicit receipt is recorded.
- [ ] Until each real-device gate passes, its public compatibility state remains `native unverified`.
- [ ] Copilot cloud, Cursor, OpenCode, and Cline are not presented as native verified.
- [ ] No topic, transcript, prompt, response text, or machine-specific path is present in committed or generated artifacts.
