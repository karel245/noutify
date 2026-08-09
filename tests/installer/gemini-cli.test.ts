import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AgentAdapter } from "../../src/installer/agent-adapter.js";
import {
  buildGeminiAfterAgentHookCommand,
  geminiCliAdapter,
} from "../../src/installer/adapters/gemini-cli.js";
import { setupProject, uninstallProject } from "../../src/installer/setup.js";

const temporaryRoots: string[] = [];

async function temporaryProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "noutify-gemini-"));
  temporaryRoots.push(root);
  return root;
}

async function settings(root: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(join(root, ".gemini", "settings.json"), "utf8"),
  ) as Record<string, unknown>;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("Gemini CLI adapter", () => {
  it("builds and executes one shell-safe fixed Windows invocation", async () => {
    const base = await temporaryProject();
    const projectRoot = join(base, "Project & ! % (test)");
    const toolDirectory = join(base, "Tool & O'Brien %");
    const cliPath = join(toolDirectory, "capture.mjs");
    await mkdir(projectRoot);
    await mkdir(toolDirectory);
    await writeFile(
      cliPath,
      [
        'import { writeFileSync } from "node:fs";',
        'import { join } from "node:path";',
        "const values = process.argv.slice(2);",
        "const root = values.at(-1);",
        'if (!root) throw new Error("missing project root");',
        'writeFileSync(join(root, "gemini-hook-args.json"), JSON.stringify(values));',
        "",
      ].join("\n"),
      "utf8",
    );

    const command = buildGeminiAfterAgentHookCommand(projectRoot, {
      nodePath: process.execPath,
      cliPath,
    });

    expect(command).toMatch(
      /^powershell\.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/,
    );
    if (process.platform === "win32") {
      const result = spawnSync(
        process.env.ComSpec ?? "cmd.exe",
        ["/d", "/s", "/c", command],
        { encoding: "utf8", windowsHide: true, shell: false },
      );
      expect(result.status, String(result.stderr)).toBe(0);
      await expect(
        readFile(join(projectRoot, "gemini-hook-args.json"), "utf8"),
      ).resolves.toBe(
        JSON.stringify(["hook", "gemini-after-agent", "--project", projectRoot]),
      );
    }
  });

  it("installs the official AfterAgent schema and no other agent directory", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/Program Files/nodejs/node.exe",
      cliPath: "C:/Noutify Tool/dist/cli.js",
    };
    const command = buildGeminiAfterAgentHookCommand(root, runtime);

    await setupProject({ projectRoot: root, agents: ["gemini-cli"], ...runtime });

    await expect(settings(root)).resolves.toEqual({
      hooks: {
        AfterAgent: [
          {
            hooks: [{ type: "command", command, timeout: 10000 }],
          },
        ],
      },
    });
    await expect(access(join(root, ".claude"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(root, ".codex"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(root, ".github"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(root, ".windsurf"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves unrelated settings and repairs duplicate exact-owned entries", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    const command = buildGeminiAfterAgentHookCommand(root, runtime);
    const owned = { hooks: [{ type: "command", command, timeout: 10000 }] };
    const unrelated = { matcher: "other", hooks: [{ type: "command", command: "existing" }] };
    const path = join(root, ".gemini", "settings.json");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify({ theme: "dark", hooks: { BeforeAgent: [unrelated], AfterAgent: [owned, unrelated, owned] } }, null, 2)}\n`,
      "utf8",
    );

    await expect(geminiCliAdapter.install({ projectRoot: root, runtime })).resolves.toEqual({ changed: true });

    await expect(settings(root)).resolves.toEqual({
      theme: "dark",
      hooks: {
        BeforeAgent: [unrelated],
        AfterAgent: [unrelated, owned],
      },
    });
  });

  it("rejects a hooks.AfterAgent collision without changing file bytes", async () => {
    const root = await temporaryProject();
    const path = join(root, ".gemini", "settings.json");
    const contents = '{\n  "hooks": { "AfterAgent": {} }\n}\n';
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");

    await expect(
      geminiCliAdapter.install({
        projectRoot: root,
        runtime: { nodePath: "C:/node.exe", cliPath: "C:/noutify/cli.js" },
      }),
    ).rejects.toThrow("Gemini settings hooks.AfterAgent must be an array");
    await expect(readFile(path, "utf8")).resolves.toBe(contents);
  });

  it("uninstalls only the exact-owned entry", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    const command = buildGeminiAfterAgentHookCommand(root, runtime);
    const owned = { hooks: [{ type: "command", command, timeout: 10000 }] };
    const similar = { hooks: [{ type: "command", command, timeout: 9999 }] };
    const path = join(root, ".gemini", "settings.json");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify({ hooks: { AfterAgent: [owned, similar] } }, null, 2)}\n`,
      "utf8",
    );

    await setupProject({ projectRoot: root, agents: ["gemini-cli"], ...runtime });
    await expect(uninstallProject(root, runtime)).resolves.toEqual({
      changed: true,
      configPreserved: true,
    });

    await expect(settings(root)).resolves.toEqual({
      hooks: { AfterAgent: [similar] },
    });
  });

  it("rolls back the Gemini hook when a later adapter installation fails", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    const failingWindsurf: AgentAdapter = {
      id: "windsurf",
      mode: "native",
      publicPath: ".windsurf/hooks.json",
      ownedPaths: () => [".windsurf/hooks.json"],
      preflight: async () => undefined,
      install: async () => {
        throw new Error("later adapter failed");
      },
      inspect: async () => ({ installed: false, detail: "not installed" }),
      uninstall: async () => ({ changed: false }),
    };

    await expect(
      setupProject(
        { projectRoot: root, agents: ["gemini-cli", "windsurf"], ...runtime },
        { adapters: [geminiCliAdapter, failingWindsurf] },
      ),
    ).rejects.toThrow("later adapter failed");
    await expect(access(join(root, ".gemini", "settings.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(join(root, "noutify.config.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
