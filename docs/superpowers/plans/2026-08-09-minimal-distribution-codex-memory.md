# Minimal Distribution, Codex, and Generic Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a self-contained `release/Noutify/` folder that installs Claude Code, Codex, and generic memory integrations without development dependencies or target-side compilation.

**Architecture:** Introduce a versioned integration model and an adapter registry while preserving existing v1 Claude installations through explicit migration. Native hooks and generic memory links share one silent localized `WAITING` dispatcher, and setup uses one transaction that snapshots every selected adapter path before writing. A release packager builds and verifies the runtime once, then a lightweight installer validates the content-hash manifest and invokes only compiled code in the target project.

**Tech Stack:** Node.js 24+, TypeScript 7, ESM, Vitest 4, JSON project-local hook files, Markdown agent instructions, ntfy HTTP API.

## Global Constraints

- The validated target-installation path remains Windows-only and requires Node.js 24 or newer.
- The provider remains ntfy; no transcript, prompt, response body, or private topic may enter public configuration, hook output, logs, manifests, tests, or documentation.
- New topics retain `Noutify-` plus 12 characters from `23456789abcdefghjkmnpqrstuvwxyz`.
- `SETUP.md` is agent-neutral English and the executing agent communicates in the user's established language, then OS UI language, then English.
- Selected agent identifiers are `codex`, `claude-code`, or `generic:<agent-slug>` in this plan; the shared type also reserves `gemini-cli`, `copilot-cli`, and `windsurf` for the follow-up plan.
- Native hooks are project-local, exact-owned, idempotent, merge-safe, silent, bounded, non-blocking, and reversible.
- A generic memory link is experimental, project-relative, non-symlinked, exact-owned by markers, and never claimed as a reliable lifecycle hook.
- Setup snapshots every possible target file before the first mutation and restores both prior bytes and prior absence on failure.
- Manual phone confirmation and per-agent automatic receipt confirmation are separate explicit gates; `doctor` never infers either from files or HTTP success.
- Target installation runs no package manager, source compilation, type checking, or repository tests.
- Packaging runs the full tests, type checking, build, manifest validation, and an offline nested-install smoke test.
- The distribution allowlist is exactly `SETUP.md`, `install.mjs`, `manifest.json`, `LICENSE`, `dist/**`, and `docs/setup-troubleshooting.md`.
- The repository and distribution use the MIT License, copyright 2026 karel245.

---

## File Map

- Create `src/config/integrations.ts`: canonical agent identifiers, validated selections, integration records, and stable sorting.
- Modify `src/config/project-config.ts`: public v2 integration list, private per-agent acceptance map, and exact v1 migration.
- Create `src/agents/waiting-hook.ts`: shared silent `WAITING` dispatch used by every adapter and the memory command.
- Modify `src/agents/claude-code/stop.ts`: payload parsing only, delegated through the shared dispatcher.
- Create `src/agents/codex/stop.ts`: minimal Codex Stop payload parser.
- Create `src/installer/agent-adapter.ts`: registry contract and common install/inspect/uninstall result types.
- Create `src/installer/codex-hooks.ts`: exact-owned merge for `.codex/hooks.json`.
- Create `src/installer/agent-memory.ts`: owned instruction file and safe marker merge into an explicit memory file.
- Modify `src/installer/setup.ts`: multi-adapter transaction, migration, confirmation, doctor, and uninstall orchestration.
- Modify `src/cli.ts`: repeatable options, new hook/memory commands, and per-agent confirmation.
- Create `scripts/package.mjs`: verified deterministic release generation.
- Create `scripts/distribution-install.mjs`: dependency-free target installer copied as `release/Noutify/install.mjs`.
- Modify `scripts/install.mjs`: retain source-tree developer installation while forwarding explicit agents through the compiled CLI.
- Create `LICENSE`: MIT license text.
- Modify `package.json`: package and distribution scripts.
- Modify `.gitignore`: ignore generated `release/`.
- Rewrite `SETUP.md`, `README.md`, and `docs/setup-troubleshooting.md`: agent-neutral minimal flow and truthful compatibility language.
- Modify `NOUTIFY_CONTEXT.md`: current architecture and release workflow.
- Add focused behavioral tests under `tests/config/`, `tests/agents/`, `tests/installer/`, and `tests/scripts/`; human-facing prose is reviewed manually against executable command evidence.

---

### Task 1: Version the multi-agent configuration model

**Files:**
- Create: `src/config/integrations.ts`
- Modify: `src/config/project-config.ts`
- Modify: `tests/config/project-config.test.ts`
- Create: `tests/config/integrations.test.ts`

**Interfaces:**
- Produces: `NativeAgentId`, `AgentId`, `IntegrationMode`, `IntegrationConfig`, `parseAgentId(value: string): AgentId`, `normalizeIntegrations(values: readonly IntegrationConfig[]): IntegrationConfig[]`.
- Produces: `PublicProjectConfig` version 2 with `integrations: IntegrationConfig[]`.
- Produces: `PrivateProjectConfig.automaticReceipts: Partial<Record<AgentId, true>>`.
- Migration rule: a valid v1 public/private pair normalizes to v2 with `[{ agent: "claude-code", mode: "native" }]` and an empty `automaticReceipts`; the topic, server, language, project name, waiting flag, and `setupCompleted` remain byte-equivalent values.

- [ ] **Step 1: Write failing integration and migration tests**

```ts
expect(parseAgentId("generic:cursor")).toBe("generic:cursor");
expect(() => parseAgentId("generic:Cursor Settings")).toThrow("invalid agent identifier");
expect(normalizeIntegrations([
  { agent: "codex", mode: "native", path: ".codex/hooks.json" },
  { agent: "claude-code", mode: "native", path: ".claude/settings.local.json" },
])).toEqual([
  { agent: "claude-code", mode: "native", path: ".claude/settings.local.json" },
  { agent: "codex", mode: "native", path: ".codex/hooks.json" },
]);

expect(validateProjectConfig(v1Public, v1Private)).toMatchObject({
  public: { version: 2, integrations: [{ agent: "claude-code", mode: "native" }] },
  private: { topic: v1Private.topic, automaticReceipts: {} },
});
```

- [ ] **Step 2: Run the focused tests and verify the new APIs fail**

Run: `npm test -- tests/config/integrations.test.ts tests/config/project-config.test.ts`

Expected: FAIL because `src/config/integrations.ts`, v2 validation, and migration do not exist.

- [ ] **Step 3: Implement canonical identifiers, deterministic normalization, and v1-to-v2 normalization**

```ts
export const NATIVE_AGENT_IDS = [
  "claude-code", "codex", "gemini-cli", "copilot-cli", "windsurf",
] as const;
export type NativeAgentId = (typeof NATIVE_AGENT_IDS)[number];
export type AgentId = NativeAgentId | `generic:${string}`;
export type IntegrationMode = "native" | "memory";
export interface IntegrationConfig {
  agent: AgentId;
  mode: IntegrationMode;
  path?: string;
}

export function parseAgentId(value: string): AgentId {
  if ((NATIVE_AGENT_IDS as readonly string[]).includes(value)) return value as NativeAgentId;
  if (/^generic:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) return value as AgentId;
  throw new Error(`invalid agent identifier: ${value}`);
}
```

Validate exact keys, reject duplicate agent identities, require native mode for native IDs and memory mode for generic IDs, sort by `agent`, and write only v2. Accept v1 only at read/validation time and normalize it in memory.

- [ ] **Step 4: Run configuration tests and the full suite**

Run: `npm test -- tests/config/integrations.test.ts tests/config/project-config.test.ts && npm test`

Expected: both focused tests and the existing suite PASS without exposing a topic.

- [ ] **Step 5: Commit the configuration migration**

```powershell
git add src/config/integrations.ts src/config/project-config.ts tests/config/integrations.test.ts tests/config/project-config.test.ts
git commit -m "feat: add versioned agent integrations"
```

---

### Task 2: Share silent waiting delivery and support repeatable CLI options

**Files:**
- Create: `src/agents/waiting-hook.ts`
- Modify: `src/agents/claude-code/stop.ts`
- Modify: `src/cli.ts`
- Create: `tests/agents/waiting-hook.test.ts`
- Modify: `tests/agents/claude-stop.test.ts`
- Modify: `tests/cli.test.ts`

**Interfaces:**
- Consumes: `AgentId` and v2 `ProjectConfigBundle` from Task 1.
- Produces: `WaitingHookPayload { recursive: boolean; valid: boolean }`.
- Produces: `runWaitingHook(input: string, context: WaitingHookContext): Promise<void>` where context contains `agent`, `projectName`, `language`, `enabled`, `confirmed`, `parse`, and `send`.
- Produces: `ParsedArguments.options: Map<string, string[]>` and `optionValues(parsed, name): readonly string[]`.
- Keeps `hook claude-stop` active through the shared dispatcher. The repeatable parser reserves the syntax needed by later internal routes, but Task 4 owns `hook codex-stop` behavior and Task 5 owns `notify waiting --agent <id>` behavior; neither future route is activated in this task. Every active internal hook command is silent and exits 0 on malformed payload, missing config, or send failure.

- [ ] **Step 1: Write failing dispatcher and repeated-option tests**

```ts
await runWaitingHook("{}", {
  agent: "codex",
  projectName: "Atlas",
  language: "es",
  enabled: true,
  confirmed: true,
  parse: () => ({ recursive: false, valid: true }),
  send,
});
expect(send).toHaveBeenCalledWith({
  title: "Agente en espera",
  message: "Atlas: El agente terminó su respuesta y espera instrucciones.",
  tags: ["speech_balloon", "hourglass"],
  priority: "default",
});

expect(parseArguments(["setup", "--agent", "codex", "--agent", "claude-code"])
  .options.get("agent")).toEqual(["codex", "claude-code"]);
```

Also assert no send for disabled, unconfirmed, invalid, or recursive events; malformed Claude internal commands must write neither stdout nor stderr.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npm test -- tests/agents/waiting-hook.test.ts tests/agents/claude-stop.test.ts tests/cli.test.ts`

Expected: FAIL because the shared dispatcher and repeated option model do not exist.

- [ ] **Step 3: Implement the dispatcher and CLI parser**

```ts
export interface WaitingHookContext {
  agent: AgentId;
  projectName: string;
  language: NotificationLanguage;
  enabled: boolean;
  confirmed: boolean;
  parse: (input: string) => WaitingHookPayload;
  send: (notification: Notification) => Promise<unknown>;
}

export async function runWaitingHook(input: string, context: WaitingHookContext): Promise<void> {
  try {
    const payload = context.parse(input);
    if (!context.enabled || !context.confirmed || !payload.valid || payload.recursive) return;
    await context.send(createWaitingNotification(context.projectName, context.language));
  } catch {
    // Lifecycle notification delivery never changes the agent's turn.
  }
}
```

Change the CLI parser so every option stores all occurrences, reject duplicates for single-value options, preserve occurrence order for the future `--agent` and `--memory-link` consumers, and keep active hook parsing silent. Refactor Claude's parser to return `WaitingHookPayload` and remove its direct notification construction. Do not add Codex or generic notification behavior before Tasks 4 and 5.

- [ ] **Step 4: Run focused tests, type checking, and the full suite**

Run: `npm test -- tests/agents/waiting-hook.test.ts tests/agents/claude-stop.test.ts tests/cli.test.ts && npm run typecheck && npm test`

Expected: PASS; hook error cases emit no output.

- [ ] **Step 5: Commit the shared runtime path**

```powershell
git add src/agents/waiting-hook.ts src/agents/claude-code/stop.ts src/cli.ts tests/agents/waiting-hook.test.ts tests/agents/claude-stop.test.ts tests/cli.test.ts
git commit -m "refactor: share waiting hook delivery"
```

---

### Task 3: Introduce the adapter registry and preserve Claude behavior

**Files:**
- Create: `src/installer/agent-adapter.ts`
- Create: `src/installer/adapters/claude-code.ts`
- Modify: `src/installer/setup.ts`
- Modify: `tests/installer/setup.test.ts`
- Create: `tests/installer/agent-adapter.test.ts`

**Interfaces:**
- Consumes: existing Claude settings and skill installers.
- Produces: `AgentAdapter` with `id`, `mode`, `ownedPaths`, `preflight`, `install`, `inspect`, and `uninstall`.
- Produces: `AdapterContext { projectRoot: string; runtime: RuntimePaths }`.
- Produces: `AdapterInspection { installed: boolean; detail: string }` and `AdapterMutation { changed: boolean }`.
- Produces: `nativeAdapter(id: NativeAgentId): AgentAdapter`, initially implemented for `claude-code` and throwing `native adapter is not available: <id>` for deferred IDs.

- [ ] **Step 1: Write failing registry and Claude-only orchestration tests**

```ts
const adapter = nativeAdapter("claude-code");
expect(adapter.id).toBe("claude-code");
expect(adapter.ownedPaths(context)).toEqual([
  ".claude/settings.local.json",
  ".claude/settings.local.json.noutify-backup",
  ".claude/skills/noutify/SKILL.md",
  ".claude/skills/noutify/launcher.mjs",
]);

await setupProject({ ...runtime, projectRoot, agents: ["claude-code"] });
expect((await readProjectConfig(projectRoot)).public.integrations)
  .toEqual([{ agent: "claude-code", mode: "native", path: ".claude/settings.local.json" }]);
```

- [ ] **Step 2: Run focused tests and verify registry failures**

Run: `npm test -- tests/installer/agent-adapter.test.ts tests/installer/setup.test.ts`

Expected: FAIL because the adapter interface and `agents` input do not exist.

- [ ] **Step 3: Wrap Claude in the registry and route setup through selected adapters**

```ts
export interface AgentAdapter {
  id: NativeAgentId;
  mode: "native";
  publicPath: string;
  ownedPaths(context: AdapterContext): string[];
  preflight(context: AdapterContext): Promise<void>;
  install(context: AdapterContext): Promise<AdapterMutation>;
  inspect(context: AdapterContext): Promise<AdapterInspection>;
  uninstall(context: AdapterContext): Promise<AdapterMutation>;
}
```

Extend `SetupProjectInput` with `agents: readonly AgentId[]`; require at least one selection for new installs, retain migrated Claude for v1 existing installs when `agents` is omitted, and reject a requested native adapter before snapshots if it is not registered. Keep exact legacy Claude migration in its adapter.

- [ ] **Step 4: Run installer tests and regression suite**

Run: `npm test -- tests/installer/agent-adapter.test.ts tests/installer/setup.test.ts && npm test`

Expected: PASS for new Claude-only setup, existing v1 setup, collision, rollback, idempotency, doctor, and exact-owned uninstall.

- [ ] **Step 5: Commit the adapter boundary**

```powershell
git add src/installer/agent-adapter.ts src/installer/adapters/claude-code.ts src/installer/setup.ts tests/installer/agent-adapter.test.ts tests/installer/setup.test.ts
git commit -m "refactor: install agents through adapters"
```

---

### Task 4: Add the project-local Codex Stop adapter

**Files:**
- Create: `src/agents/codex/stop.ts`
- Create: `src/installer/codex-hooks.ts`
- Create: `src/installer/adapters/codex.ts`
- Modify: `src/installer/agent-adapter.ts`
- Modify: `src/cli.ts`
- Create: `tests/agents/codex-stop.test.ts`
- Create: `tests/installer/codex-hooks.test.ts`
- Modify: `tests/installer/setup.test.ts`
- Modify: `tests/cli.test.ts`

**Interfaces:**
- Consumes: shared `WaitingHookPayload`, `AgentAdapter`, and setup transaction.
- Produces: `parseCodexStopPayload(input: string): WaitingHookPayload` validating `hook_event_name === "Stop"` when present and mapping `stop_hook_active === true` to `recursive`.
- Produces: Codex-owned command `{ command: runtime.nodePath, args: [runtime.cliPath, "hook", "codex-stop", "--project", root], timeout: 10 }`.
- Owns exactly one entry under `.codex/hooks.json` key `hooks.Stop`; unrelated keys and hook entries are preserved.

- [ ] **Step 1: Write failing payload, merge, collision, and silence tests**

```ts
expect(parseCodexStopPayload('{"hook_event_name":"Stop","stop_hook_active":false}'))
  .toEqual({ valid: true, recursive: false });
expect(parseCodexStopPayload('{"hook_event_name":"BeforeTool"}').valid).toBe(false);

await installCodexStopHook(projectRoot, command);
expect(JSON.parse(await readFile(join(projectRoot, ".codex/hooks.json"), "utf8")))
  .toMatchObject({ hooks: { Stop: [{ hooks: [command] }] } });
```

Cover invalid JSON collision, existing unrelated hooks, duplicate repair, exact-owned uninstall, recursive suppression, ignored transcript/message fields, send failure, and empty stdout/stderr.

- [ ] **Step 2: Run the Codex tests and verify they fail**

Run: `npm test -- tests/agents/codex-stop.test.ts tests/installer/codex-hooks.test.ts tests/installer/setup.test.ts tests/cli.test.ts`

Expected: FAIL because Codex parsing, settings merge, registry entry, and CLI route are absent.

- [ ] **Step 3: Implement Codex parsing, exact-owned settings merge, and adapter registration**

```ts
export function parseCodexStopPayload(input: string): WaitingHookPayload {
  if (!input.trim()) return { valid: false, recursive: false };
  try {
    const value: unknown = JSON.parse(input);
    if (!isRecord(value)) return { valid: false, recursive: false };
    if ("hook_event_name" in value && value.hook_event_name !== "Stop")
      return { valid: false, recursive: false };
    return { valid: true, recursive: value.stop_hook_active === true };
  } catch {
    return { valid: false, recursive: false };
  }
}
```

Use atomic JSON writes and exact structural ownership. Reject a non-object root or non-array `hooks.Stop` before mutation. Add `codex` to `nativeAdapter`, and route `hook codex-stop` through the shared dispatcher using only project config and the parser.

- [ ] **Step 4: Run Codex tests, type checking, and full regression**

Run: `npm test -- tests/agents/codex-stop.test.ts tests/installer/codex-hooks.test.ts tests/installer/setup.test.ts tests/cli.test.ts && npm run typecheck && npm test`

Expected: PASS; Codex-only setup creates no `.claude/`, and combined setup installs each native adapter once.

- [ ] **Step 5: Commit Codex support**

```powershell
git add src/agents/codex/stop.ts src/installer/codex-hooks.ts src/installer/adapters/codex.ts src/installer/agent-adapter.ts src/cli.ts tests/agents/codex-stop.test.ts tests/installer/codex-hooks.test.ts tests/installer/setup.test.ts tests/cli.test.ts
git commit -m "feat: add project-local Codex notifications"
```

---

### Task 5: Add the safe generic memory integration

**Files:**
- Create: `src/installer/agent-memory.ts`
- Create: `src/installer/adapters/generic-memory.ts`
- Modify: `src/installer/agent-adapter.ts`
- Modify: `src/installer/setup.ts`
- Modify: `src/cli.ts`
- Create: `tests/installer/agent-memory.test.ts`
- Modify: `tests/installer/setup.test.ts`
- Modify: `tests/cli.test.ts`

**Interfaces:**
- Consumes: `generic:<agent-slug>` and shared waiting dispatcher.
- Produces: `MemoryLink { agent: AgentId; relativePath: string }` parsed from `<agent>=<project-relative-path>`.
- Produces: `installMemoryIntegration(projectRoot, link, runtime): Promise<{ changed: boolean; pending: boolean }>`.
- Owns `.noutify/instructions/<agent-slug>.md` and the exact block `<!-- noutify:<agent>:start -->...<!-- noutify:<agent>:end -->` in the explicit memory file.
- Produces internal `notify waiting --agent <id> --project <root>` command; it sends only when manual setup is confirmed and the selected integration exists.

- [ ] **Step 1: Write failing path-safety, merge, pending, and generic-send tests**

```ts
expect(parseMemoryLink("generic:cursor=AGENTS.md")).toEqual({
  agent: "generic:cursor",
  relativePath: "AGENTS.md",
});
expect(() => parseMemoryLink("generic:cursor=../AGENTS.md")).toThrow();

const result = await installMemoryIntegration(projectRoot, {
  agent: "generic:cursor",
  relativePath: "AGENTS.md",
}, runtime);
expect(result).toEqual({ changed: true, pending: false });
expect(await readFile(join(projectRoot, "AGENTS.md"), "utf8"))
  .toContain("<!-- noutify:generic:cursor:start -->");
```

Cover symlink traversal at every existing path segment, directory targets, binary/NUL content, unmatched owned markers, unrelated content preservation, no-link pending status, idempotency, exact-owned uninstall, and topic-free instructions.

- [ ] **Step 2: Run memory tests and verify failures**

Run: `npm test -- tests/installer/agent-memory.test.ts tests/installer/setup.test.ts tests/cli.test.ts`

Expected: FAIL because memory parsing, safe merging, and `notify waiting` are absent.

- [ ] **Step 3: Implement owned instructions and safe memory linking**

```md
<!-- noutify-managed:memory-v1 -->
When this agent is about to return control to the user, run exactly once:
`node Noutify/dist/cli.js notify waiting --agent generic:cursor`
This means WAITING, not task completion. Never read or reveal `.noutify.local.json`.
Notification failure must not change or block the answer.
```

Resolve the memory path beneath `projectRoot`, reject absolute/traversing paths, walk existing components with `lstat` and reject symbolic links, accept only a regular UTF-8 text file or a creatable final path, and snapshot both the instruction and memory file. If no link is provided, create only the owned instruction and store the integration without `path`, returning `pending: true`.

- [ ] **Step 4: Run memory, setup, CLI, and full tests**

Run: `npm test -- tests/installer/agent-memory.test.ts tests/installer/setup.test.ts tests/cli.test.ts && npm run typecheck && npm test`

Expected: PASS; generic setup never creates native hook directories and never claims a pending link is installed.

- [ ] **Step 5: Commit generic memory support**

```powershell
git add src/installer/agent-memory.ts src/installer/adapters/generic-memory.ts src/installer/agent-adapter.ts src/installer/setup.ts src/cli.ts tests/installer/agent-memory.test.ts tests/installer/setup.test.ts tests/cli.test.ts
git commit -m "feat: add generic agent memory integration"
```

---

### Task 6: Complete transactional status, confirmation, and uninstall

**Files:**
- Modify: `src/installer/setup.ts`
- Modify: `src/cli.ts`
- Modify: `tests/installer/setup.test.ts`
- Modify: `tests/cli.test.ts`

**Interfaces:**
- Consumes: adapter registry and public/private v2 config.
- Produces: `confirmAgent(projectRoot: string, agent: AgentId): Promise<void>` which requires an installed selected integration and writes `automaticReceipts[agent] = true`.
- Produces: `DoctorCheck { name: string; status: "pass" | "warn" | "fail"; message: string }`; overall failure occurs only for configuration, privacy, collision, or missing selected integration, while unconfirmed real delivery is `warn`.
- Produces: `SetupProjectResult` as a discriminated union: `{ created: true; topic: string; language: NotificationLanguage; server: string; integrations: IntegrationSetupResult[] } | { created: false; language: NotificationLanguage; server: string; integrations: IntegrationSetupResult[] }`, where `IntegrationSetupResult` is `{ agent: AgentId; mode: IntegrationMode; status: "installed" | "pending" }`.

- [ ] **Step 1: Write failing multi-adapter transaction and status tests**

```ts
await setupProject({ ...runtime, projectRoot, agents: ["codex", "claude-code"] });
await confirmProject(projectRoot);
await confirmAgent(projectRoot, "codex");
const result = await doctorProject(projectRoot, runtime);
expect(result.checks).toContainEqual(expect.objectContaining({
  name: "codex-automatic-receipt", status: "pass",
}));
expect(result.checks).toContainEqual(expect.objectContaining({
  name: "claude-code-automatic-receipt", status: "warn",
}));
```

Inject failure in the second adapter and assert every prior file is byte-identical or absent afterward. Test deselection does not silently uninstall an existing adapter, invalid confirmations fail without changing config, and uninstall removes every configured exact-owned integration but preserves config.

- [ ] **Step 2: Run focused lifecycle tests and verify failures**

Run: `npm test -- tests/installer/setup.test.ts tests/cli.test.ts`

Expected: FAIL because per-agent confirmation, warning status, and complete multi-file rollback are incomplete.

- [ ] **Step 3: Implement preflight-before-write and one transaction across all selected adapters**

```ts
export interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export async function confirmAgent(projectRoot: string, agentValue: string): Promise<void> {
  const root = resolve(projectRoot);
  const agent = parseAgentId(agentValue);
  const bundle = await readProjectConfig(root);
  if (!bundle.public.integrations.some((entry) => entry.agent === agent))
    throw new Error(`agent integration is not selected: ${agent}`);
  bundle.private.automaticReceipts[agent] = true;
  await writeProjectConfig(root, bundle);
}
```

Collect and de-duplicate all owned paths, snapshot once, run every preflight before any write, install in sorted agent order, write normalized config, and restore the complete snapshot set on any error. Update CLI output to use `PASS`, `WARN`, or `FAIL`; add `confirm-agent <id>`; never include an existing topic in setup JSON.

- [ ] **Step 4: Run lifecycle tests and the complete quality gate**

Run: `npm test -- tests/installer/setup.test.ts tests/cli.test.ts && npm run typecheck && npm run build && npm test`

Expected: PASS; no test fixture value resembling a private topic appears in diagnostics or snapshots.

- [ ] **Step 5: Commit multi-agent lifecycle completion**

```powershell
git add src/installer/setup.ts src/cli.ts tests/installer/setup.test.ts tests/cli.test.ts
git commit -m "feat: track multi-agent acceptance"
```

---

### Task 7: Build and validate the minimal distribution

**Files:**
- Create: `scripts/package.mjs`
- Create: `scripts/distribution-install.mjs`
- Modify: `scripts/install.mjs`
- Create: `tests/scripts/package.test.mjs`
- Create: `tests/scripts/distribution-install.test.mjs`
- Modify: `tests/scripts/install.test.mjs`
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `LICENSE`

**Interfaces:**
- Produces: `npm run package` invoking tests, type checking, build, artifact generation, allowlist validation, and nested offline smoke.
- Produces: `manifest.json` shape `{ formatVersion: 1, version: "0.0.1", node: ">=24", files: Array<{ path: string; sha256: string }> }`, sorted by relative POSIX path. `files` hashes every artifact file except `manifest.json` itself; validation requires the actual tree to equal those paths plus `manifest.json`.
- Produces: dependency-free `release/Noutify/install.mjs` accepting repeatable `--agent`, repeatable `--memory-link`, `--language`, and optional `--project`.
- Distribution installer resolves its own folder, validates exact manifest membership and SHA-256 hashes, requires Windows/Node 24, derives the target as its parent by default, and executes `node dist/cli.js setup ... --format json` without a shell.

- [ ] **Step 1: Write failing allowlist, manifest, tamper, and offline-install tests**

```js
const artifact = await packageDistribution({ runQualityGates: false, root });
expect(await listRelativeFiles(artifact)).toEqual([
  "LICENSE",
  "SETUP.md",
  "dist/agents/claude-code/stop.js",
  // The test inserts every sorted dist/**/*.js path produced by the build here.
  "docs/setup-troubleshooting.md",
  "install.mjs",
  "manifest.json",
]);
expect(JSON.stringify(await readManifest(artifact))).not.toContain("Noutify-");
```

Derive the expected compiled runtime list in the test from `dist/**/*.js` after build, then assert no declaration, source-map, `src`, `tests`, `node_modules`, `.git`, `package.json`, lockfile, plan, or spec path exists. Copy the artifact into a temporary target with networking disabled, run setup for `codex`, and assert only target setup files are created. Tamper with one compiled byte and assert failure occurs before target mutation.

- [ ] **Step 2: Run packaging tests and verify they fail**

Run: `npm test -- tests/scripts/package.test.mjs tests/scripts/distribution-install.test.mjs tests/scripts/install.test.mjs`

Expected: FAIL because release generation and the lightweight installer do not exist.

- [ ] **Step 3: Implement guarded packaging, manifest hashing, MIT license, and lightweight installation**

```js
export function validateReleasePath(repositoryRoot, releaseRoot) {
  const expected = resolve(repositoryRoot, "release", "Noutify");
  if (resolve(releaseRoot) !== expected || dirname(expected) === expected)
    throw new Error("unsafe release output path");
  return expected;
}

export function manifestEntry(relativePath, bytes) {
  return {
    path: relativePath.replaceAll("\\", "/"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
```

Remove only the validated `release/Noutify` path. Copy the exact static allowlist and only compiled `dist/**/*.js`, write sorted hashes for every file except the manifest, validate the final tree as `manifest.files + manifest.json`, then run a nested installer smoke without fetching dependencies. Add `package: "node scripts/package.mjs"`, ignore `/release/`, and create `LICENSE` with this exact text:

```text
MIT License

Copyright (c) 2026 karel245

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 4: Run package tests and the real packaging gate**

Run: `npm test -- tests/scripts/package.test.mjs tests/scripts/distribution-install.test.mjs tests/scripts/install.test.mjs && npm run package`

Expected: PASS; `release/Noutify/` contains only the allowlist, the nested smoke succeeds offline, and no manifest or output contains a topic.

- [ ] **Step 5: Commit the minimal distribution**

```powershell
git add scripts/package.mjs scripts/distribution-install.mjs scripts/install.mjs tests/scripts/package.test.mjs tests/scripts/distribution-install.test.mjs tests/scripts/install.test.mjs package.json .gitignore LICENSE
git commit -m "feat: package minimal Noutify distribution"
```

---

### Task 8: Publish the agent-neutral setup contract and acceptance flow

**Files:**
- Rewrite: `SETUP.md`
- Rewrite: `README.md`
- Modify: `docs/setup-troubleshooting.md`
- Modify: `NOUTIFY_CONTEXT.md`
- Delete: `tests/docs/agent-installation.test.ts`

**Interfaces:**
- Consumes: `node Noutify/install.mjs --language <en|es> --agent <id>...` and the CLI commands from Tasks 2, 5, and 6.
- Produces: a one-prompt installation contract usable by any capable coding agent.
- Produces: compatibility states `native verified`, `native unverified`, `memory best effort`, and `unsupported or untested`.

- [ ] **Step 1: Remove prose change-detector tests and preserve executable coverage**

Delete `tests/docs/agent-installation.test.ts`; do not replace it with tests that search Markdown source. Confirm the product behavior that the old prose assertions tried to protect is already exercised by the installer, CLI, privacy, manifest, and nested-install tests from Tasks 2, 5, 6, and 7.

- [ ] **Step 2: Run the executable setup contract before changing prose**

Run: `npm test -- tests/scripts/distribution-install.test.mjs tests/scripts/package.test.mjs tests/cli.test.ts tests/installer/setup.test.ts`

Expected: PASS; installation, privacy, confirmation gates, and generated-artifact behavior remain covered without asserting Markdown text.

- [ ] **Step 3: Rewrite setup, public docs, troubleshooting, and context**

Document this exact happy path: infer language; detect and propose current platform; ask for one or multiple agents; run the minimal installer; show a newly created topic exactly once; pause for subscription; run manual test; wait for explicit receipt; run `confirm`; run `doctor`; trust Codex through `/hooks`; end a real agent turn; wait for explicit automatic receipt; run `confirm-agent codex`; rerun `doctor`. For generic agents, require an explicit memory file or report pending and best effort. State that the folder must remain in place.

Manually review the finished prose against this checklist: the primary prompt is exactly `Install Noutify following Noutify/SETUP.md.`; language precedence is preserved; manual and automatic receipts remain distinct; every literal command exists in CLI help or the distribution installer; local Markdown links resolve; external links use the official sources in the design spec; Gemini/Copilot/Windsurf are planned or unsupported until plan 2 installs them.

- [ ] **Step 4: Run all verification from a clean generated artifact**

Run: `npm test && npm run typecheck && npm run build && npm run package && git status --short`

Expected: tests/typecheck/build/package PASS; only intentional source and plan changes appear, while generated `release/` remains ignored.

- [ ] **Step 5: Commit documentation and final plan-1 verification**

```powershell
git add SETUP.md README.md docs/setup-troubleshooting.md NOUTIFY_CONTEXT.md tests/docs/agent-installation.test.ts
git commit -m "docs: publish multi-agent minimal setup"
```

---

## Plan 1 Acceptance Checklist

- [ ] `npm test`, `npm run typecheck`, `npm run build`, and `npm run package` pass.
- [ ] A generated artifact installs offline in a clean nested Windows project without `npm`.
- [ ] Claude-only, Codex-only, combined, and generic-memory setup paths are idempotent and transactional.
- [ ] A real Codex project-local Stop hook is manually trusted and produces one localized phone notification after a later turn.
- [ ] The phone owner explicitly confirms that automatic notification before `confirm-agent codex` is run.
- [ ] Claude Code real-turn acceptance is repeated when both native adapters are selected.
- [ ] No topic is present in Git changes, release contents, test output, hook output, diagnostics, or documentation.
