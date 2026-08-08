import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

async function readRepositoryFile(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

function normalizeCrlf(contents: string): string {
  return contents.replace(/\r\n/g, "\n");
}

function wordCount(contents: string): number {
  return contents.trim().split(/\s+/).length;
}

function normalizeWhitespace(contents: string): string {
  return contents.replace(/\s+/g, " ").trim();
}

describe("agent-guided installation documentation", () => {
  it("keeps parent-project discovery in the compact one-line quick start", async () => {
    const [setup, readme] = await Promise.all([
      readRepositoryFile("SETUP.md"),
      readRepositoryFile("README.md"),
    ]);

    expect(setup).toContain("target project's root");
    expect(setup).toContain("node Noutify/scripts/install.mjs --language");
    expect(setup).not.toContain("$TARGET_ROOT");
    expect(readme).toContain("## Quick install with Claude Code");
    expect(readme).toContain("Install Noutify following Noutify/SETUP.md.");
  });

  it("defines interaction, OS-locale, and English language precedence", async () => {
    const [setup, readme, context] = await Promise.all([
      readRepositoryFile("SETUP.md"),
      readRepositoryFile("README.md"),
      readRepositoryFile("NOUTIFY_CONTEXT.md"),
    ]);

    const setupContract = normalizeWhitespace(setup);
    expect(setupContract).toContain("latest clear user request or established conversation");
    expect(setupContract).toContain("[System.Globalization.CultureInfo]::CurrentUICulture");
    expect(setupContract).toContain("use English notifications");
    expect(setupContract).toContain("Spanish to `es`");
    expect(setupContract).toContain("English to `en`");
    expect(setupContract).toContain(
      "tell the user in the interaction language that notifications will use English",
    );
    for (const document of [readme, context]) {
      const normalizedDocument = normalizeWhitespace(document);
      expect(normalizedDocument).toContain("conversation language");
      expect(normalizedDocument).toContain("OS UI locale");
      expect(normalizedDocument).toContain("English notifications");
    }
  });

  it("keeps the created-only topic display and phone gates explicit", async () => {
    const setup = await readRepositoryFile("SETUP.md");
    const setupContract = normalizeWhitespace(setup);

    expect(setupContract).toContain("For `created`, Show the new topic once");
    expect(setupContract).toContain(
      "Never repeat the topic after that display in chat, logs, summaries, commits, docs, issues, diagnostics, artifacts, or generated files.",
    );
    expect(setupContract).toContain(
      "tell the user in the interaction language that it is private because it functions as the notification key",
    );
    expect(setup).toContain("subscription is ready");
    expect(setup).toContain("explicit receipt");
    expect(setup).toContain("dist/cli.js test");
    expect(setup).toContain("dist/cli.js confirm");
    expect(setup).toContain("dist/cli.js doctor");
    expect(setupContract).toContain(
      "Automatic Stop-hook phone acceptance remains pending until the owner observes a real Stop notification.",
    );
  });

  it("keeps preparation stages in recovery documentation, not the compact setup", async () => {
    const [setup, troubleshooting] = await Promise.all([
      readRepositoryFile("SETUP.md"),
      readRepositoryFile("docs/setup-troubleshooting.md"),
    ]);

    expect(setup).not.toContain("npm ci");
    expect(troubleshooting).toContain("`npm ci`");
    expect(troubleshooting).toContain("`npm test`");
    expect(troubleshooting).toContain("`npm run typecheck`");
    expect(troubleshooting).toContain("`npm run build`");
  });

  it("keeps the successful setup state machine within its token budget", async () => {
    const setup = normalizeCrlf(await readRepositoryFile("SETUP.md"));

    expect(wordCount(setup)).toBeLessThanOrEqual(350);
    expect(setup.length).toBeLessThanOrEqual(2500);
    expect(setup).toContain("# Install Noutify");
    expect(setup).toContain("## Language");
    expect(setup).toContain("## Prepare");
    expect(setup).toContain("## Subscribe");
    expect(setup).toContain("## Test and confirm");
    expect(setup).toContain("## Accept");
    expect(setup).toContain("## On failure");
    expect(setup).toContain("node Noutify/scripts/install.mjs --language");
    expect(setup).toContain("Show the new topic once");
    expect(setup).toContain("docs/setup-troubleshooting.md");
    expect(setup).not.toContain("npm ci");
    expect(setup).toContain("/noutify language español");
  });

  it("keeps recovery details outside the successful path", async () => {
    const troubleshooting = await readRepositoryFile("docs/setup-troubleshooting.md");

    expect(troubleshooting).toContain("## Prerequisites");
    expect(troubleshooting).toContain("## Setup recovery");
    expect(troubleshooting).toContain("## Existing installation");
    expect(troubleshooting).toContain("## Topic recovery");
    expect(troubleshooting).toContain("## Skill collision");
    expect(troubleshooting).toContain("## Uninstall");
  });

  it("aligns public and master documentation with localized onboarding", async () => {
    const [readme, context] = await Promise.all([
      readRepositoryFile("README.md"),
      readRepositoryFile("NOUTIFY_CONTEXT.md"),
    ]);

    for (const document of [readme, context]) {
      const normalizedDocument = normalizeWhitespace(document);
      expect(normalizedDocument).toContain("Noutify-[12 easy characters]");
      expect(normalizedDocument).toContain("Spanish and English notifications");
      expect(normalizedDocument).toContain("/noutify language");
      expect(normalizedDocument).toContain("deterministic notification catalog");
      expect(normalizedDocument).toContain('"language": "es"');
      expect(normalizedDocument).toContain("--language LANGUAGE");
      expect(normalizedDocument).toContain("--format json");
      expect(normalizedDocument).toContain("launcher.mjs");
      expect(normalizedDocument).toContain("exact Noutify-owned Stop hook and skill files");
    }
  });

  it("keeps README safeguards and master-context installation contract visible", async () => {
    const [readme, context] = await Promise.all([
      readRepositoryFile("README.md"),
      readRepositoryFile("NOUTIFY_CONTEXT.md"),
    ]);

    expect(readme).toContain("Download ZIP");
    expect(readme).toContain("nested Git repository");
    expect(readme).toContain("Do not move or delete `Noutify/`");
    expect(readme).toContain("Install Noutify following Noutify/SETUP.md.");
    expect(readme).toContain("settings.local.json.noutify-backup");
    expect(readme).toContain("Noutify/docs/setup-troubleshooting.md#uninstall");
    expect(normalizeWhitespace(readme)).toContain(
      "uninstall while the original path is still available, move `Noutify/`, then run setup again",
    );
    expect(context).toContain("project-local agent-guided installation");
    expect(context).toContain("Install Noutify following Noutify/SETUP.md.");
    expect(context).toContain("conversation language");
    expect(context).toContain("OS UI locale");
  });

  it("documents safe recovery when Noutify has moved", async () => {
    const troubleshooting = normalizeWhitespace(
      await readRepositoryFile("docs/setup-troubleshooting.md"),
    );

    expect(troubleshooting).toContain(
      "uninstall while the original Noutify path still exists, move the folder, then run setup again",
    );
    expect(troubleshooting).toContain(
      "If the folder was already moved, restore its old path first",
    );
    expect(troubleshooting).not.toContain("move the folder and rerun setup");
  });
});
