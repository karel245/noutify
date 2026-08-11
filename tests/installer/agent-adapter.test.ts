import { describe, expect, it } from "vitest";

import { nativeAdapter } from "../../src/installer/agent-adapter.js";

describe("native agent adapter registry", () => {
  it("exposes Claude Code's complete project-local ownership boundary", () => {
    const adapter = nativeAdapter("claude-code");
    const context = {
      projectRoot: "C:/projects/demo",
      runtime: {
        nodePath: "C:/node.exe",
        cliPath: "C:/noutify/dist/cli.js",
      },
    };

    expect(adapter.id).toBe("claude-code");
    expect(adapter.mode).toBe("native");
    expect(adapter.publicPath).toBe(".claude/settings.local.json");
    expect(adapter.ownedPaths(context)).toEqual([
      ".claude/settings.local.json",
      ".claude/settings.local.json.noutify-backup",
      ".claude/skills/noutify/SKILL.md",
      ".claude/skills/noutify/launcher.mjs",
    ]);
  });

  it("exposes Codex's isolated project hook ownership boundary", () => {
    const adapter = nativeAdapter("codex");
    const context = {
      projectRoot: "C:/projects/demo",
      runtime: {
        nodePath: "C:/node.exe",
        cliPath: "C:/noutify/dist/cli.js",
      },
    };

    expect(adapter.id).toBe("codex");
    expect(adapter.mode).toBe("native");
    expect(adapter.publicPath).toBe(".codex/hooks.json");
    expect(adapter.ownedPaths(context)).toEqual([".codex/hooks.json"]);
  });
});
