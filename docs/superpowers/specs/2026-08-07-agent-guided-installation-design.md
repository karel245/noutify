# Agent-Guided Installation Design

## Summary

Noutify will provide a project-local installation experience driven by Claude
Code. A user downloads or clones Noutify into a `Noutify/` directory inside the
target project, then sends one short prompt:

```text
Install Noutify following Noutify/SETUP.md.
```

Claude Code reads the English operational contract, determines the target
project and the user's preferred language, performs the technical setup, and
guides the real-phone confirmation. The `Noutify/` directory remains in the
project because the Phase 0 hook invokes its compiled runtime by absolute path.

## Goals

- Reduce the user-visible installation procedure to downloading or cloning one
  directory and sending one prompt.
- Remove the need for users to define installation paths or type Noutify CLI
  commands themselves.
- Keep one language-neutral source of truth by writing agent instructions in
  English.
- Have Claude communicate in the user's language without maintaining translated
  copies of the setup document.
- Preserve the existing security, idempotency and phone-confirmation rules.
- Make the streamlined flow the primary installation path throughout the GitHub
  repository documentation.

## Non-goals

- Publishing Noutify to npm or supporting `npx` installation.
- Adding operating systems, coding agents, or notification providers beyond the
  current Phase 0 scope.
- Localizing CLI output or maintaining translated documentation files.
- Automatically completing setup before the user confirms receipt on a real
  phone.
- Moving or deleting the project-local `Noutify/` directory after installation.

## User Experience

### Acquire Noutify

The user places the repository at this layout:

```text
TargetProject/
|-- Noutify/
|   |-- SETUP.md
|   |-- package.json
|   `-- src/
`-- ...
```

Downloading and extracting the GitHub ZIP is the simplest path. Cloning into
`Noutify/` is also supported. Documentation will note that `Noutify/` must stay
at the same path after setup.

### Start installation

From a Claude Code session rooted in `TargetProject/`, the user sends:

```text
Install Noutify following Noutify/SETUP.md.
```

No path variables or installation commands are required from the user.

### Complete phone acceptance

Claude performs all local work, then gives localized instructions for adding the
ntfy subscription. It sends a test only when the user says the subscription is
ready. It runs `confirm` only after the user explicitly says the notification
arrived. Finally, it runs `doctor` and explains the result in the selected
language.

## Language Selection

`SETUP.md` remains in English. It instructs Claude to choose its conversational
language in this order:

1. Use the language of the user's latest clear request or established
   conversation.
2. If the conversation does not reveal a preference, inspect the operating
   system UI locale.
3. If neither is conclusive, use English.

Claude keeps commands, filenames, configuration keys and literal program output
unchanged. It translates explanations and questions naturally rather than
performing word-for-word translation. A user may override the inferred language
at any time.

The operating-system locale is only a fallback because a system language does
not reliably represent the language a user wants for a particular conversation.

## Agent Installation Contract

The revised `SETUP.md` will direct Claude to execute these stages in order.

### 1. Locate and validate

- Resolve the directory containing `SETUP.md` as the Noutify root.
- Resolve its parent directory as the target project.
- Confirm that required Noutify files exist.
- If the layout is ambiguous or the parent does not appear to be a project, stop
  and ask the user instead of guessing another target.

### 2. Select language

- Infer the preferred language using the defined precedence.
- Continue all user-facing guidance in that language.

### 3. Run preflight

- Verify Windows and Node.js 24 or newer.
- Verify npm is available.
- Explain any missing prerequisite in the selected language and stop without
  partially modifying the target project.

### 4. Prepare the local runtime

Within `Noutify/`, Claude runs the locked dependency installation, tests, type
checking and build. It does not proceed if any validation fails.

### 5. Configure the parent project

Claude invokes the compiled CLI with the parent directory as `--project`.
Existing configuration and unrelated Claude hooks remain intact. Re-running the
same prompt is safe and uses the existing idempotent setup behavior.

### 6. Protect the secret

The generated ntfy topic may be visible in the user's local terminal during the
first setup. Claude never repeats it in conversation, summaries, documentation,
commits, issues or logs that it creates. `.noutify.local.json` remains ignored by
the target repository.

### 7. Guide phone setup

Claude explains how to install ntfy, add a subscription, use the configured
server and enter the locally displayed topic. It pauses for the user to say the
subscription is ready.

### 8. Test, confirm and diagnose

- Run `test` after the user is ready.
- Ask whether the phone received `Noutify connected`.
- Run `confirm` only after an explicit positive answer.
- Run `doctor` and require every check to pass.
- Ask the user to validate a later real Claude `Stop` event and accurately
  describe any remaining acceptance step.

## Documentation Changes

### `README.md`

- Put the short agent-guided installation flow near the top.
- Show the exact directory layout and prompt.
- Explain language selection, prerequisites, security and the requirement to
  keep `Noutify/` in place.
- Retain manual command documentation as a secondary advanced path.

### `SETUP.md`

- Replace the current path-variable-oriented procedure with the operational
  agent contract in this design.
- Use English throughout and explicitly require localized interaction.
- Include deterministic PowerShell commands based on the discovered Noutify and
  parent roots.
- Preserve every existing safety and manual phone-acceptance rule.

### `NOUTIFY_CONTEXT.md`

- Update installation principles and Phase 0 status to identify the
  project-local, agent-guided flow as the default experience.
- Keep architecture and future package-distribution plans internally
  consistent.

## Error Handling

- Missing or old Node.js: stop before setup and provide localized remediation.
- Dependency, test, type-check or build failure: report the failing stage and do
  not claim installation success.
- Ambiguous directory layout: ask for the target project rather than inferring a
  different directory.
- Malformed existing Claude settings: preserve the file and explain the blocker.
- Failed ntfy delivery: do not run `confirm`; help verify the subscription
  without printing the topic.
- Existing valid installation: reuse it and continue with the appropriate
  verification stage.

## Security and Repository Hygiene

- The private ntfy topic never enters public configuration or agent-authored
  prose.
- The target project's `.gitignore` protects `.noutify.local.json`.
- The installation must not remove or replace unrelated Claude hooks.
- The source folder's existing ignore rules keep `node_modules/` and `dist/`
  outside commits when the extracted source is tracked by the parent project.
- Documentation will mention the nested-repository behavior of `git clone` and
  recommend the ZIP route for users who do not intentionally want an embedded
  Git repository.

## Verification

Implementation verification will include:

- the existing automated test suite;
- TypeScript type checking and production build;
- a documentation consistency scan for obsolete primary-install instructions;
- a clean temporary-project smoke test using the documented nested layout;
- confirmation that no generated private configuration or topic is staged;
- review of the rendered GitHub Markdown structure and links.

## Acceptance Criteria

The change is complete when:

1. A user can place `Noutify/` inside a target project and provide only the
   documented one-line prompt.
2. Claude can derive both paths without asking the user to type them in the
   normal layout.
3. Claude communicates in the conversation language, with OS locale and English
   as fallbacks.
4. All preparation, setup and diagnosis commands are executed by Claude.
5. The topic is not repeated by Claude and confirmation cannot occur without an
   explicit report of phone receipt.
6. README, setup instructions and master context describe the same default flow.
7. Existing tests, type checking, build and the nested-layout smoke test pass.
8. The resulting documentation and implementation are committed and pushed to
   the GitHub `main` branch requested by the user.
