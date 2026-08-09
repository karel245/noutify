import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AgentAdapter } from "../../src/installer/agent-adapter.js";
import {
  buildCopilotAgentStopHookCommand,
  copilotCliAdapter,
} from "../../src/installer/adapters/copilot-cli.js";
import {
  confirmAgent,
  doctorProject,
  setupProject,
  uninstallProject,
} from "../../src/installer/setup.js";

const temporaryRoots: string[] = [];

async function temporaryProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "noutify-copilot-"));
  temporaryRoots.push(root);
  return root;
}

function settingsPath(root: string): string {
  return join(root, ".github", "copilot", "settings.local.json");
}

async function settings(root: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(settingsPath(root), "utf8")) as Record<
    string,
    unknown
  >;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("GitHub Copilot CLI adapter", () => {
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
        'let input = "";',
        "for await (const chunk of process.stdin) input += String(chunk);",
        "const root = values.at(-1);",
        'if (!root) throw new Error("missing project root");',
        'writeFileSync(join(root, "copilot-hook-args.json"), JSON.stringify({ values, input }));',
        "",
      ].join("\n"),
      "utf8",
    );

    const command = buildCopilotAgentStopHookCommand(projectRoot, {
      nodePath: process.execPath,
      cliPath,
    });

    expect(command).toMatch(
      /^powershell\.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/,
    );
    if (process.platform === "win32") {
      const input = '{"prompt":"& whoami; $(Get-ChildItem) | %PATH% !bang!"}';
      const result = spawnSync(
        process.env.ComSpec ?? "cmd.exe",
        ["/d", "/s", "/c", command],
        { encoding: "utf8", input, windowsHide: true, shell: false },
      );
      expect(result.status, String(result.stderr)).toBe(0);
      await expect(
        readFile(join(projectRoot, "copilot-hook-args.json"), "utf8"),
      ).resolves.toBe(
        JSON.stringify({
          values: ["hook", "copilot-agent-stop", "--project", projectRoot],
          input,
        }),
      );
    }
  });

  it("installs only the local inline agentStop hook and exact private ignore rule", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/Program Files/nodejs/node.exe",
      cliPath: "C:/Noutify Tool/dist/cli.js",
    };
    const command = buildCopilotAgentStopHookCommand(root, runtime);
    await writeFile(join(root, ".gitignore"), "dist/\r\n", "utf8");

    await setupProject({ projectRoot: root, agents: ["copilot-cli"], ...runtime });

    await expect(settings(root)).resolves.toEqual({
      hooks: {
        agentStop: [
          { type: "command", powershell: command, timeoutSec: 10 },
        ],
      },
    });
    await expect(readFile(join(root, ".gitignore"), "utf8")).resolves.toBe(
      "dist/\r\n/.github/copilot/settings.local.json\n.noutify.local.json\n",
    );
    await expect(access(join(root, ".github", "hooks"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(join(root, ".github", "copilot", "settings.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("adds agentStop to commented trailing-comma JSONC without touching unrelated bytes", async () => {
    const root = await temporaryProject();
    const runtime = { nodePath: "C:/node.exe", cliPath: "C:/noutify/cli.js" };
    const command = buildCopilotAgentStopHookCommand(root, runtime);
    const ownedText = JSON.stringify({
      type: "command",
      powershell: command,
      timeoutSec: 10,
    });
    const path = settingsPath(root);
    const contents = [
      "\uFEFF{",
      "  // top-level user comment",
      '  "theme": "dark",',
      '  "hooks" /* nested-key comment */: {',
      "    /* unrelated hook comment */",
      '    "sessionStart": [',
      '      { "type": "command", "powershell": "Write-Host existing" }, // keep',
      "    ],",
      "  },",
      "}",
    ].join("\r\n");
    const expected = contents.replace(
      "  },\r\n}",
      `    "agentStop": [${ownedText}],\r\n  },\r\n}`,
    );
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");
    await writeFile(
      join(root, ".gitignore"),
      "/.github/copilot/settings.local.json\r\n",
      "utf8",
    );

    await expect(
      copilotCliAdapter.install({ projectRoot: root, runtime }),
    ).resolves.toEqual({ changed: true });
    await expect(readFile(path, "utf8")).resolves.toBe(expected);
    await expect(
      copilotCliAdapter.inspect({ projectRoot: root, runtime }),
    ).resolves.toMatchObject({ installed: true });
  });

  it("keeps an exact commented JSONC installation byte-for-byte", async () => {
    const root = await temporaryProject();
    const runtime = { nodePath: "C:/node.exe", cliPath: "C:/noutify/cli.js" };
    const command = buildCopilotAgentStopHookCommand(root, runtime);
    const ownedText = JSON.stringify({
      type: "command",
      powershell: command,
      timeoutSec: 10,
    });
    const path = settingsPath(root);
    const contents = [
      "\uFEFF{",
      "  // keep this file exactly",
      '  "hooks": {',
      '    "agentStop": [',
      `      ${ownedText}, // exact owned hook`,
      "    ],",
      "  },",
      "}",
      "",
    ].join("\r\n");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");
    await writeFile(
      join(root, ".gitignore"),
      "/.github/copilot/settings.local.json\n",
      "utf8",
    );

    await expect(
      copilotCliAdapter.install({ projectRoot: root, runtime }),
    ).resolves.toEqual({ changed: false });
    await expect(readFile(path, "utf8")).resolves.toBe(contents);
  });

  it("repairs duplicate exact JSONC hooks while retaining comments and unrelated entries", async () => {
    const root = await temporaryProject();
    const runtime = { nodePath: "C:/node.exe", cliPath: "C:/noutify/cli.js" };
    const command = buildCopilotAgentStopHookCommand(root, runtime);
    const ownedText = JSON.stringify({
      type: "command",
      powershell: command,
      timeoutSec: 10,
    });
    const unrelatedText = JSON.stringify({
      type: "command",
      powershell: "Write-Host existing",
      timeoutSec: 10,
    });
    const path = settingsPath(root);
    const contents = [
      "{",
      '  "hooks": {',
      '    "agentStop": [',
      `      ${unrelatedText},`,
      `      ${ownedText},`,
      "      /* comment between exact duplicates */",
      `      ${ownedText},`,
      "    ],",
      "  },",
      "}",
      "",
    ].join("\n");
    const duplicateStart = contents.lastIndexOf(ownedText);
    const expected =
      contents.slice(0, duplicateStart) +
      contents.slice(duplicateStart + ownedText.length + 1);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");
    await writeFile(
      join(root, ".gitignore"),
      "/.github/copilot/settings.local.json\n",
      "utf8",
    );

    await expect(
      copilotCliAdapter.install({ projectRoot: root, runtime }),
    ).resolves.toEqual({ changed: true });
    await expect(readFile(path, "utf8")).resolves.toBe(expected);
    await expect(
      copilotCliAdapter.inspect({ projectRoot: root, runtime }),
    ).resolves.toMatchObject({ installed: true });
  });

  it("uninstalls only exact-owned JSONC entries and preserves surrounding bytes", async () => {
    const root = await temporaryProject();
    const runtime = { nodePath: "C:/node.exe", cliPath: "C:/noutify/cli.js" };
    const command = buildCopilotAgentStopHookCommand(root, runtime);
    const ownedText = JSON.stringify({
      type: "command",
      powershell: command,
      timeoutSec: 10,
    });
    const similarText = JSON.stringify({
      type: "command",
      powershell: command,
      timeoutSec: 11,
    });
    const unrelatedText = JSON.stringify({
      type: "command",
      powershell: "Write-Host existing",
      timeoutSec: 10,
    });
    const path = settingsPath(root);
    const contents = [
      "{",
      "  // top-level comment",
      '  "hooks": {',
      '    "agentStop": [',
      `      ${ownedText},`,
      "      /* preserve unrelated entries */",
      `      ${unrelatedText},`,
      `      ${similarText},`,
      "    ],",
      "  },",
      "}",
      "",
    ].join("\n");
    const ownedStart = contents.indexOf(ownedText);
    const expected =
      contents.slice(0, ownedStart) +
      contents.slice(ownedStart + ownedText.length + 1);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");

    await expect(
      copilotCliAdapter.uninstall({ projectRoot: root, runtime }),
    ).resolves.toEqual({ changed: true });
    await expect(readFile(path, "utf8")).resolves.toBe(expected);
  });

  it("preserves unrelated local settings and does not rewrite a correct installation", async () => {
    const root = await temporaryProject();
    const runtime = { nodePath: "C:/node.exe", cliPath: "C:/noutify/cli.js" };
    const command = buildCopilotAgentStopHookCommand(root, runtime);
    const owned = { type: "command", powershell: command, timeoutSec: 10 };
    const unrelated = { type: "command", powershell: "Write-Host existing" };
    const path = settingsPath(root);
    await mkdir(dirname(path), { recursive: true });
    const contents = `${JSON.stringify({ theme: "dark", hooks: { sessionStart: [unrelated], agentStop: [unrelated, owned] } }, null, 2)}\n`;
    await writeFile(path, contents, "utf8");
    await writeFile(
      join(root, ".gitignore"),
      "dist/\n/.github/copilot/settings.local.json\n",
      "utf8",
    );

    await expect(
      setupProject({ projectRoot: root, agents: ["copilot-cli"], ...runtime }),
    ).resolves.toMatchObject({ created: true });
    await expect(readFile(path, "utf8")).resolves.toBe(contents);
    const afterFirst = await readFile(join(root, ".gitignore"), "utf8");

    await expect(
      setupProject({ projectRoot: root, agents: ["copilot-cli"], ...runtime }),
    ).resolves.toMatchObject({ created: false });
    expect(await readFile(join(root, ".gitignore"), "utf8")).toBe(afterFirst);
    expect(afterFirst.split(/\r?\n/).filter(
      (line) => line === "/.github/copilot/settings.local.json",
    )).toHaveLength(1);
  });

  it("rejects an agentStop collision without changing local settings bytes", async () => {
    const root = await temporaryProject();
    const path = settingsPath(root);
    const contents = '{\n  "hooks": { "agentStop": {} }\n}\n';
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");

    await expect(
      copilotCliAdapter.install({
        projectRoot: root,
        runtime: { nodePath: "C:/node.exe", cliPath: "C:/noutify/cli.js" },
      }),
    ).rejects.toThrow("Copilot local settings hooks.agentStop must be an array");
    await expect(readFile(path, "utf8")).resolves.toBe(contents);
  });

  it("rejects JSONC structural collisions and malformed comments without changing bytes", async () => {
    const root = await temporaryProject();
    const path = settingsPath(root);
    const runtime = { nodePath: "C:/node.exe", cliPath: "C:/noutify/cli.js" };
    await mkdir(dirname(path), { recursive: true });

    const collision = [
      "{",
      '  "hooks" /* valid comment */: {',
      '    "agentStop": {},',
      "  },",
      "}",
      "",
    ].join("\n");
    await writeFile(path, collision, "utf8");
    await expect(
      copilotCliAdapter.preflight({ projectRoot: root, runtime }),
    ).rejects.toThrow("Copilot local settings hooks.agentStop must be an array");
    await expect(readFile(path, "utf8")).resolves.toBe(collision);

    const malformed = '{\n  /* never closed\n  "hooks": {}\n}\n';
    await writeFile(path, malformed, "utf8");
    await expect(
      copilotCliAdapter.preflight({ projectRoot: root, runtime }),
    ).rejects.toThrow("Copilot local settings contains invalid JSONC");
    await expect(readFile(path, "utf8")).resolves.toBe(malformed);
  });

  it("never writes local settings when the private ignore rule cannot be established", async () => {
    const root = await temporaryProject();
    await mkdir(join(root, ".gitignore"));

    await expect(
      copilotCliAdapter.install({
        projectRoot: root,
        runtime: { nodePath: "C:/node.exe", cliPath: "C:/noutify/cli.js" },
      }),
    ).rejects.toBeDefined();
    await expect(access(settingsPath(root))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects a linked local settings path before writing outside the project", async () => {
    const root = await temporaryProject();
    const outside = await temporaryProject();
    await mkdir(join(root, ".github"), { recursive: true });
    await symlink(outside, join(root, ".github", "copilot"), "junction");

    await expect(
      setupProject({
        projectRoot: root,
        agents: ["copilot-cli"],
        nodePath: "C:/node.exe",
        cliPath: "C:/noutify/cli.js",
      }),
    ).rejects.toThrow("unsafe project path crosses a symbolic link or junction");
    await expect(access(join(outside, "settings.local.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rolls settings and ignore bytes back when a later adapter fails", async () => {
    const root = await temporaryProject();
    const runtime = { nodePath: "C:/node.exe", cliPath: "C:/noutify/cli.js" };
    const path = settingsPath(root);
    const settingsBefore = '\uFEFF{\r\n  // keep rollback bytes\r\n  "theme": "dark",\r\n}\r\n';
    const ignoreBefore = "dist/\r\n";
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, settingsBefore, "utf8");
    await writeFile(join(root, ".gitignore"), ignoreBefore, "utf8");
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
        { projectRoot: root, agents: ["copilot-cli", "windsurf"], ...runtime },
        { adapters: [copilotCliAdapter, failingWindsurf] },
      ),
    ).rejects.toThrow("later adapter failed");
    await expect(readFile(path, "utf8")).resolves.toBe(settingsBefore);
    await expect(readFile(join(root, ".gitignore"), "utf8")).resolves.toBe(ignoreBefore);
  });

  it("treats a trackable local settings file as not installed and setup repairs it", async () => {
    const root = await temporaryProject();
    const runtime = { nodePath: "C:/node.exe", cliPath: "C:/noutify/cli.js" };
    await setupProject({ projectRoot: root, agents: ["copilot-cli"], ...runtime });
    const ignorePath = join(root, ".gitignore");
    await writeFile(ignorePath, "dist/\n.noutify.local.json\n# keep me\n", "utf8");

    await expect(
      copilotCliAdapter.inspect({ projectRoot: root, runtime }),
    ).resolves.toMatchObject({
      installed: false,
      detail: expect.stringContaining("not ignored"),
    });

    await setupProject({ projectRoot: root, agents: ["copilot-cli"], ...runtime });
    await expect(
      copilotCliAdapter.inspect({ projectRoot: root, runtime }),
    ).resolves.toMatchObject({ installed: true });
    await expect(readFile(ignorePath, "utf8")).resolves.toBe(
      "dist/\n.noutify.local.json\n# keep me\n/.github/copilot/settings.local.json\n",
    );
  });

  it("fails doctor when Copilot local settings are not ignored", async () => {
    const root = await temporaryProject();
    const runtime = { nodePath: "C:/node.exe", cliPath: "C:/noutify/cli.js" };
    await setupProject({ projectRoot: root, agents: ["copilot-cli"], ...runtime });
    await writeFile(join(root, ".gitignore"), ".noutify.local.json\n", "utf8");

    const result = await doctorProject(root, runtime);
    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual({
      name: "copilot-cli-integration",
      status: "fail",
      message: expect.stringContaining("not ignored"),
    });
  });

  it("refuses Copilot confirmation while local settings are trackable", async () => {
    const root = await temporaryProject();
    const runtime = { nodePath: "C:/node.exe", cliPath: "C:/noutify/cli.js" };
    await setupProject({ projectRoot: root, agents: ["copilot-cli"], ...runtime });
    await writeFile(join(root, ".gitignore"), ".noutify.local.json\n", "utf8");
    const privatePath = join(root, ".noutify.local.json");
    const privateBefore = await readFile(privatePath);

    await expect(confirmAgent(root, "copilot-cli", runtime)).rejects.toThrow(
      "agent integration is not installed: copilot-cli",
    );
    await expect(readFile(privatePath)).resolves.toEqual(privateBefore);
  });

  it("rolls newly created settings and gitignore back to absence after a later failure", async () => {
    const root = await temporaryProject();
    const runtime = { nodePath: "C:/node.exe", cliPath: "C:/noutify/cli.js" };
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
        { projectRoot: root, agents: ["copilot-cli", "windsurf"], ...runtime },
        { adapters: [copilotCliAdapter, failingWindsurf] },
      ),
    ).rejects.toThrow("later adapter failed");
    await expect(access(settingsPath(root))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(join(root, ".gitignore"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("uninstalls only the exact-owned hook and keeps local settings ignored", async () => {
    const root = await temporaryProject();
    const runtime = { nodePath: "C:/node.exe", cliPath: "C:/noutify/cli.js" };
    const command = buildCopilotAgentStopHookCommand(root, runtime);
    const owned = { type: "command", powershell: command, timeoutSec: 10 };
    const similar = { ...owned, timeoutSec: 11 };
    const unrelated = { type: "command", powershell: "Write-Host existing" };
    const path = settingsPath(root);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify({ hooks: { sessionStart: [unrelated], agentStop: [owned, similar] } }, null, 2)}\n`,
      "utf8",
    );

    await setupProject({ projectRoot: root, agents: ["copilot-cli"], ...runtime });
    await expect(uninstallProject(root, runtime)).resolves.toEqual({
      changed: true,
      configPreserved: true,
    });

    await expect(settings(root)).resolves.toEqual({
      hooks: { sessionStart: [unrelated], agentStop: [similar] },
    });
    await expect(readFile(join(root, ".gitignore"), "utf8")).resolves.toContain(
      "/.github/copilot/settings.local.json\n",
    );
  });
});
