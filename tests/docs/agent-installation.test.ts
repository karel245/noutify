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
});
