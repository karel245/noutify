# Noutify installation contract

Use this contract from the target project's root. Do not read, print, or ask
for `.noutify.local.json`.

1. Use the user's latest clear request language, then their established
   conversation language, then the operating-system UI language, then English.
   Select `es` for Spanish and `en` otherwise. Never translate commands, paths,
   or JSON.
2. Detect and propose the current platform, but ask: “Which agents will use
   Noutify in this project?” The user may select `codex`, `claude-code`, or
   `generic:<lowercase-agent-name>`, including multiple selections.
3. For a generic agent, ask for its durable project-memory file. If known, add
   `--memory-link generic:<name>=<project-relative-file>`; otherwise continue
   without it and report pending, best-effort integration. Never guess a path.
4. Run the installer with explicit selections, for example:

   ```text
   node Noutify/install.mjs --language es --agent codex --agent claude-code
   ```

   A generic memory link looks like:

   ```text
   node Noutify/install.mjs --language en --agent generic:cursor --memory-link generic:cursor=AGENTS.md
   ```

   Read only the final JSON record. For `created`, display its topic once,
   explain that it is a private notification key, and never repeat it in text,
   files, logs, or summaries. For `existing`, never display a topic.
5. Ask the owner to subscribe their ntfy app and pause for confirmation. Then run:

   ```text
   node Noutify/dist/cli.js test
   ```

   Wait for explicit receipt of the localized manual test, then run:

   ```text
   node Noutify/dist/cli.js confirm
   node Noutify/dist/cli.js doctor
   ```

6. For Codex, have the owner review and trust the project-local hook through
   `/hooks`. Do not bypass trust. Finish a later real turn, wait for explicit
   automatic receipt, then run:

   ```text
   node Noutify/dist/cli.js confirm-agent codex
   node Noutify/dist/cli.js doctor
   ```

   Manual and automatic receipts are separate gates. For Claude Code, repeat
   the real-turn receipt and `confirm-agent claude-code` flow. Generic memory
   is best effort; confirm it only after the owner sees an automatic receipt.

Keep the `Noutify/` folder in place. Its project-local integrations call its
compiled runtime. Read [troubleshooting](docs/setup-troubleshooting.md) only
for recovery. Gemini CLI, GitHub Copilot CLI, and Windsurf are not installable
native adapters in this release.
