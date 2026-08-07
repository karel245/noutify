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

describe("agent-guided installation documentation", () => {
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
      expect(document).toContain("Noutify-[12 easy characters]");
      expect(document).toContain("Spanish and English notifications");
      expect(document).toContain("/noutify language");
    }
  });
});
