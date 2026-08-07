# Agent-Guided Installation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Noutify installable from a project-local `Noutify/` directory through one short Claude Code prompt, with Claude automatically communicating in the user's language.

**Architecture:** Treat `SETUP.md` as an executable agent contract: Claude derives the target as the parent of `Noutify/`, validates and builds the local runtime, invokes the existing CLI, and pauses at real-phone gates. A focused documentation-contract test protects the critical prompt, path, language and secret-handling rules while `README.md` and `NOUTIFY_CONTEXT.md` expose the same default flow.

**Tech Stack:** Markdown, PowerShell commands, Node.js 24+, TypeScript, Vitest 4, GitHub Markdown.

## Global Constraints

- Phase 0 remains Windows-only, Claude Code-only and ntfy-only.
- Node.js 24 or newer is required.
- `SETUP.md` and repository documentation use English as the single source language.
- Claude uses the latest clear user/conversation language first, the operating-system UI locale second and English last.
- Commands, filenames, configuration keys and literal program output remain untranslated.
- `Noutify/` remains at the same project-local path because the hook stores an absolute runtime path.
- Never repeat the private ntfy topic in conversation, documentation, commits, issues or agent-authored logs.
- Never run `confirm` without an explicit positive report that the phone received the test notification.
- Existing Claude hooks and valid Noutify configuration must remain intact.
- The GitHub ZIP route is recommended; cloning inside a repository is supported but creates a nested Git repository.

---

## File Map

- Create `tests/docs/agent-installation.test.ts`: automated contract for the user prompt, path derivation, language precedence, safety gates and documentation alignment.
- Rewrite `SETUP.md`: authoritative English operational instructions consumed by Claude Code.
- Rewrite `README.md`: concise GitHub-facing quick start, prerequisites, expected behavior and secondary manual commands.
- Modify `NOUTIFY_CONTEXT.md`: align installation principles, Phase 0 status and future distribution roadmap with the project-local agent-guided default.
- Modify `docs/superpowers/plans/2026-08-07-agent-guided-installation.md`: mark executed checkboxes as work proceeds.

---

### Task 1: Protect and implement the Claude setup contract

**Files:**
- Create: `tests/docs/agent-installation.test.ts`
- Rewrite: `SETUP.md`

**Interfaces:**
- Consumes: existing CLI commands `setup`, `test`, `confirm` and `doctor`; the layout `<target>/Noutify/SETUP.md`.
- Produces: an English `SETUP.md` contract that derives `$NOUTIFY_ROOT` and `$TARGET_ROOT`, plus automated assertions used by later documentation work.

- [ ] **Step 1: Write the failing setup-contract tests**

Create `tests/docs/agent-installation.test.ts` with:

```ts
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

async function readRepositoryFile(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

describe("agent-guided installation documentation", () => {
  it("defines deterministic project discovery and language selection", async () => {
    const setup = await readRepositoryFile("SETUP.md");

    expect(setup).toContain("Install Noutify following Noutify/SETUP.md.");
    expect(setup).toContain("latest clear user request or established conversation");
    expect(setup).toContain(
      "[System.Globalization.CultureInfo]::CurrentUICulture",
    );
    expect(setup).toContain(
      "$TARGET_ROOT = (Resolve-Path (Split-Path -Parent $NOUTIFY_ROOT)).Path",
    );
    expect(setup).not.toContain("$TARGET_ROOT = 'D:\\\\path\\\\to\\\\target-project'");
  });

  it("keeps secrets and phone confirmation behind explicit gates", async () => {
    const setup = await readRepositoryFile("SETUP.md");

    expect(setup).toContain("Never repeat the topic");
    expect(setup).toContain("Do not run `confirm`");
    expect(setup).toContain("explicitly confirms");
    expect(setup).toContain("npm ci");
    expect(setup).toContain("npm test");
    expect(setup).toContain("npm run typecheck");
    expect(setup).toContain("npm run build");
  });
});
```

- [ ] **Step 2: Run the focused test and verify the contract is absent**

Run:

```powershell
npm test -- tests/docs/agent-installation.test.ts
```

Expected: FAIL because the current `SETUP.md` does not contain the one-line prompt, language precedence or automatic parent-path expression.

- [ ] **Step 3: Rewrite `SETUP.md` as the operational contract**

Use these exact top-level sections, in order:

```markdown
# Noutify agent-guided setup

## Trigger
## Supported environment
## Interaction language
## Non-negotiable safety rules
## Installation procedure
### 1. Locate Noutify and the target project
### 2. Run preflight checks
### 3. Prepare the Noutify runtime
### 4. Configure the target project
### 5. Guide the phone subscription
### 6. Send the test
### 7. Confirm receipt
### 8. Run diagnostics
### 9. Complete real-agent acceptance
## Existing installation behavior
## Uninstall
```

The trigger section must show only this required user prompt:

```text
Install Noutify following Noutify/SETUP.md.
```

The interaction-language section must require this precedence:

```markdown
1. Use the language of the user's latest clear request or established conversation.
2. If that is inconclusive, inspect `[System.Globalization.CultureInfo]::CurrentUICulture`.
3. If that is also inconclusive, use English.
```

The path-discovery block must be directly runnable from the target-project root:

```powershell
$NOUTIFY_ROOT = (Resolve-Path 'Noutify').Path
$TARGET_ROOT = (Resolve-Path (Split-Path -Parent $NOUTIFY_ROOT)).Path
```

It must validate `SETUP.md`, `package.json` and `src/cli.ts` under `$NOUTIFY_ROOT`; if any are absent, stop and ask the user instead of selecting another directory.

The preflight must run `node --version` and `npm --version`, parse the Node major version and stop before target changes when it is below 24:

```powershell
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 24) { throw 'Noutify requires Node.js 24 or newer.' }
```

The runtime preparation and project setup commands must be:

```powershell
Set-Location $NOUTIFY_ROOT
npm ci
npm test
npm run typecheck
npm run build
node "$NOUTIFY_ROOT\dist\cli.js" setup --project "$TARGET_ROOT"
```

The phone stages must require Claude to pause before `test`, ask whether `Noutify connected` arrived, pause again, and run these commands only at their valid gates:

```powershell
node "$NOUTIFY_ROOT\dist\cli.js" test --project "$TARGET_ROOT"
node "$NOUTIFY_ROOT\dist\cli.js" confirm --project "$TARGET_ROOT"
node "$NOUTIFY_ROOT\dist\cli.js" doctor --project "$TARGET_ROOT"
```

State verbatim: `Never repeat the topic in conversation, summaries, documentation, commits, issues, or agent-authored logs.` State that Claude must not run `confirm` until the user explicitly confirms receipt.

- [ ] **Step 4: Run the focused test and verify the setup contract passes**

Run:

```powershell
npm test -- tests/docs/agent-installation.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Review the contract for operational safety**

Run:

```powershell
Select-String -Path SETUP.md -Pattern 'topic|confirm|settings.local.json|transcript|Node.js 24'
```

Expected: the document protects the topic, forbids premature confirmation, preserves existing settings, forbids transcript reading and enforces Node.js 24+.

- [ ] **Step 6: Commit Task 1**

```powershell
git add -- SETUP.md tests/docs/agent-installation.test.ts
git diff --cached --check
git commit -m "docs: add agent-guided setup contract"
```

---

### Task 2: Make the one-prompt flow the repository default

**Files:**
- Modify: `tests/docs/agent-installation.test.ts`
- Rewrite: `README.md`
- Modify: `NOUTIFY_CONTEXT.md`

**Interfaces:**
- Consumes: exact prompt and safety contract established by Task 1.
- Produces: consistent GitHub landing documentation and master context, protected by the same test suite.

- [ ] **Step 1: Add failing cross-document consistency tests**

Append these tests inside the existing `describe` block:

```ts
it("presents the same one-line quick start in the GitHub README", async () => {
  const readme = await readRepositoryFile("README.md");

  expect(readme).toContain("## Quick install with Claude Code");
  expect(readme).toContain("Install Noutify following Noutify/SETUP.md.");
  expect(readme).toContain("Download ZIP");
  expect(readme).toContain("conversation language");
  expect(readme).toContain("nested Git repository");
  expect(readme).toContain("Do not move or delete `Noutify/`");
});

it("records agent-guided setup as the default Phase 0 flow", async () => {
  const context = await readRepositoryFile("NOUTIFY_CONTEXT.md");

  expect(context).toContain("project-local agent-guided installation");
  expect(context).toContain("Install Noutify following Noutify/SETUP.md.");
  expect(context).toContain("conversation language");
  expect(context).toContain("OS UI locale");
});
```

- [ ] **Step 2: Run the focused test and verify README/context are outdated**

Run:

```powershell
npm test -- tests/docs/agent-installation.test.ts
```

Expected: the two new tests fail because the current repository landing page and master context still lead with manual path variables.

- [ ] **Step 3: Rewrite `README.md` around the quick install**

Use this order:

```markdown
# Noutify
## Quick install with Claude Code
### 1. Download Noutify
### 2. Place it in your project
### 3. Ask Claude to install it
### 4. Follow the phone prompts
## How language selection works
## Requirements
## What installation changes
## Keep the folder in place
## Advanced manual commands
## Development
## Security model
## Uninstall
## Current limitations
```

The first screenful must contain the GitHub `Download ZIP` route, this layout, and the exact prompt:

```text
TargetProject/
|-- Noutify/
|   `-- SETUP.md
`-- ...
```

```text
Install Noutify following Noutify/SETUP.md.
```

Explain that cloning to `Noutify/` works but creates a nested Git repository. State `Do not move or delete `Noutify/` after setup.` Keep manual CLI commands as an advanced reference, not the primary workflow.

- [ ] **Step 4: Align `NOUTIFY_CONTEXT.md`**

Update its installation and roadmap prose so it states:

```markdown
The default Phase 0 experience is a project-local agent-guided installation.
The user places `Noutify/` in the target project and sends
`Install Noutify following Noutify/SETUP.md.` Claude performs the technical
steps and communicates in the conversation language, using the OS UI locale and
then English only as fallbacks.
```

Preserve package-based distribution as a future improvement. Remove any claim that the primary user flow requires manually declaring `$NOUTIFY_ROOT` or `$TARGET_ROOT`.

- [ ] **Step 5: Run documentation and full project verification**

Run:

```powershell
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: all documentation-contract and existing tests pass, type checking and build exit successfully, and Git reports no whitespace errors.

- [ ] **Step 6: Commit Task 2**

```powershell
git add -- README.md NOUTIFY_CONTEXT.md tests/docs/agent-installation.test.ts
git diff --cached --check
git commit -m "docs: simplify project-local installation"
```

---

### Task 3: Verify the nested-project journey and publish

**Files:**
- Verify only: repository and a disposable directory under `work/`
- Update during execution: `docs/superpowers/plans/2026-08-07-agent-guided-installation.md` checkboxes

**Interfaces:**
- Consumes: the completed setup contract and built CLI.
- Produces: fresh end-to-end evidence and synchronized `origin/main` history.

- [ ] **Step 1: Create a disposable nested-project layout without copying private or generated files**

Create `work/agent-install-smoke/TargetProject/Noutify/`, copy the tracked Noutify files into it while excluding `.git`, `node_modules`, `dist` and `work`, then verify:

```text
work/agent-install-smoke/TargetProject/Noutify/SETUP.md
work/agent-install-smoke/TargetProject/Noutify/package-lock.json
work/agent-install-smoke/TargetProject/Noutify/src/cli.ts
```

- [ ] **Step 2: Execute the documented non-phone stages in the disposable layout**

From `TargetProject/`, use the documented path expressions, then run:

```powershell
Set-Location $NOUTIFY_ROOT
npm ci
npm test
npm run typecheck
npm run build
node "$NOUTIFY_ROOT\dist\cli.js" setup --project "$TARGET_ROOT" | Out-Null
node "$NOUTIFY_ROOT\dist\cli.js" doctor --project "$TARGET_ROOT"
```

Expected: build and tests succeed; setup creates the public/private configuration and one Claude Stop hook; `doctor` passes configuration, private-ignore and hook checks while reporting phone confirmation as pending. Do not run `test` or `confirm` in this smoke test because no real phone subscription was authorized.

- [ ] **Step 3: Inspect generated files without printing secrets**

Verify existence and structure only:

```powershell
Test-Path "$TARGET_ROOT\noutify.config.json"
Test-Path "$TARGET_ROOT\.noutify.local.json"
Test-Path "$TARGET_ROOT\.claude\settings.local.json"
Select-String -Path "$TARGET_ROOT\.gitignore" -SimpleMatch '.noutify.local.json'
```

Expected: every path check is `True` and the private ignore entry is present. Do not output `.noutify.local.json`.

- [ ] **Step 4: Run final repository verification**

```powershell
npm test
npm run typecheck
npm run build
npm audit --audit-level=high
git diff --check
git status -sb
```

Expected: all tests pass, type checking and build succeed, audit reports zero high-severity vulnerabilities, no whitespace errors exist and only the intentional plan-checkbox update remains.

- [ ] **Step 5: Commit the executed plan record**

```powershell
git add -- docs/superpowers/plans/2026-08-07-agent-guided-installation.md
git diff --cached --check
git commit -m "docs: record installation verification"
```

- [ ] **Step 6: Verify commit scope and secret hygiene**

Run staged/history inspections that confirm no `.noutify.local.json`, topic value, `node_modules`, `dist` or `work` content entered Git. Compare the complete diff from `origin/main` and ensure it contains only the approved design, plan, documentation and documentation-contract test.

- [ ] **Step 7: Push and verify GitHub synchronization**

```powershell
git push origin main
git status -sb
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

Expected: `main` tracks `origin/main` without ahead/behind markers, and the local and remote commit hashes are identical.
