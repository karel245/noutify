import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

async function readRepositoryFile(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

describe("agent-guided installation documentation", () => {
  it("defines deterministic parent-project discovery", async () => {
    const setup = await readRepositoryFile("SETUP.md");

    expect(setup).toContain("Install Noutify following Noutify/SETUP.md.");
    expect(setup).toContain(
      "$TARGET_ROOT = (Resolve-Path (Split-Path -Parent $NOUTIFY_ROOT)).Path",
    );
    expect(setup).not.toContain(
      "$TARGET_ROOT = 'D:\\path\\to\\target-project'",
    );
  });

  it("defines language selection precedence", async () => {
    const setup = await readRepositoryFile("SETUP.md");

    expect(setup).toContain(
      "latest clear user request or established conversation",
    );
    expect(setup).toContain(
      "[System.Globalization.CultureInfo]::CurrentUICulture",
    );
    expect(setup).toContain("use English");
  });

  it("keeps secrets and phone confirmation behind explicit gates", async () => {
    const setup = await readRepositoryFile("SETUP.md");

    expect(setup).toContain("Never repeat the topic");
    expect(setup).toContain("Do not run `confirm`");
    expect(setup).toContain("explicitly confirms");
  });

  it("requires a validated runtime before target setup", async () => {
    const setup = await readRepositoryFile("SETUP.md");

    expect(setup).toContain("npm ci");
    expect(setup).toContain("npm test");
    expect(setup).toContain("npm run typecheck");
    expect(setup).toContain("npm run build");
  });

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
});
