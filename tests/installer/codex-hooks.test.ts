import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  countCodexStopHooks,
  installCodexStopHook,
  uninstallCodexStopHook,
} from "../../src/installer/codex-hooks.js";
import { buildCodexStopHookCommand } from "../../src/installer/adapters/codex.js";

const temporaryRoots: string[] = [];
const command = {
  type: "command" as const,
  command: "'/opt/Noutify Runtime/node' '/opt/Noutify Tool/cli.js' 'hook' 'codex-stop' '--project' '/work/demo'",
  commandWindows:
    "powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ZQB4AGkAdAAgADAA",
};
const legacyCommand = {
  command: "C:/Program Files/nodejs/node.exe",
  args: [
    "C:/tools/noutify/dist/cli.js",
    "hook",
    "codex-stop",
    "--project",
    "C:/work/demo",
  ],
  timeout: 10,
};

async function temporaryProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "noutify-codex-"));
  temporaryRoots.push(root);
  return root;
}

async function settings(root: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(join(root, ".codex", "hooks.json"), "utf8"),
  ) as Record<string, unknown>;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("Codex hooks installation", () => {
  it("builds the official command handler schema with shell-safe platform commands", () => {
    const projectRoot = "C:/Projects/Atlas's (Demo) & 100%";
    const runtime = {
      nodePath: "C:/Program Files/O'Brien & Runtime/node.exe",
      cliPath: "D:/Noutify %TEMP% (Tool)!/dist/cli.js",
    };

    const handler = buildCodexStopHookCommand(projectRoot, runtime);

    expect(Object.keys(handler).sort()).toEqual([
      "command",
      "commandWindows",
      "type",
    ]);
    expect(handler.type).toBe("command");
    expect(handler.command).toContain(
      "'C:/Program Files/O'\\''Brien & Runtime/node.exe'",
    );
    expect(handler.command).toContain("'D:/Noutify %TEMP% (Tool)!/dist/cli.js'");
    expect(handler.command).toContain("'hook' 'codex-stop' '--project'");
    expect(handler.commandWindows).toMatch(
      /^powershell\.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/,
    );
    if (handler.commandWindows === undefined) {
      throw new Error("Windows command override is required");
    }
    const encoded = handler.commandWindows.split(" ").at(-1) as string;
    const script = Buffer.from(encoded, "base64").toString("utf16le");
    expect(script).toBe(
      `& 'C:/Program Files/O''Brien & Runtime/node.exe' 'D:/Noutify %TEMP% (Tool)!/dist/cli.js' 'hook' 'codex-stop' '--project' '${projectRoot.replaceAll("/", "\\").replaceAll("'", "''")}'; exit $LASTEXITCODE`,
    );
  });

  it.runIf(process.platform === "win32")(
    "executes the Windows override without shell interpretation of path metacharacters",
    async () => {
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
          'writeFileSync(join(root, "hook-args.json"), JSON.stringify(values));',
          "",
        ].join("\n"),
        "utf8",
      );
      const handler = buildCodexStopHookCommand(projectRoot, {
        nodePath: process.execPath,
        cliPath,
      });
      if (handler.commandWindows === undefined) {
        throw new Error("Windows command override is required");
      }

      const result = spawnSync(
        process.env.ComSpec ?? "cmd.exe",
        ["/d", "/s", "/c", handler.commandWindows],
        { encoding: "utf8", windowsHide: true, shell: false },
      );

      expect(result.status, String(result.stderr)).toBe(0);
      await expect(
        readFile(join(projectRoot, "hook-args.json"), "utf8"),
      ).resolves.toBe(
        JSON.stringify(["hook", "codex-stop", "--project", projectRoot]),
      );
    },
  );

  it("creates one project-local Stop hook", async () => {
    const root = await temporaryProject();

    await expect(installCodexStopHook(root, command)).resolves.toEqual({
      changed: true,
    });
    await expect(settings(root)).resolves.toEqual({
      hooks: { Stop: [{ hooks: [command] }] },
    });
  });

  it("preserves unrelated Codex hooks while adding the owned Stop hook", async () => {
    const root = await temporaryProject();
    const path = join(root, ".codex", "hooks.json");
    const original = {
      preferences: { diagnostics: true },
      hooks: {
        BeforeTool: [{ hooks: [{ command: "existing-before" }] }],
        Stop: [{ hooks: [{ command: "existing-stop" }] }],
      },
    };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(original, null, 2)}\n`, "utf8");

    await installCodexStopHook(root, command);

    expect(await settings(root)).toEqual({
      ...original,
      hooks: {
        ...original.hooks,
        Stop: [...original.hooks.Stop, { hooks: [command] }],
      },
    });
  });

  it("repairs duplicate owned hooks without changing unrelated entries", async () => {
    const root = await temporaryProject();
    const path = join(root, ".codex", "hooks.json");
    const unrelated = { hooks: [{ command: "existing-stop" }] };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify({ hooks: { Stop: [{ hooks: [command, structuredClone(command)] }, unrelated] } })}\n`,
      "utf8",
    );

    await expect(installCodexStopHook(root, command)).resolves.toEqual({
      changed: true,
    });
    expect(await settings(root)).toEqual({
      hooks: { Stop: [unrelated, { hooks: [command] }] },
    });
    await expect(countCodexStopHooks(root, command)).resolves.toBe(1);
  });

  it("replaces the exact obsolete Noutify shape while preserving similar handlers", async () => {
    const root = await temporaryProject();
    const path = join(root, ".codex", "hooks.json");
    const similarLegacy = { ...legacyCommand, timeout: 11 };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify({ hooks: { Stop: [{ hooks: [legacyCommand, similarLegacy] }] } })}\n`,
      "utf8",
    );

    await installCodexStopHook(root, command, [legacyCommand]);

    expect(await settings(root)).toEqual({
      hooks: { Stop: [{ hooks: [similarLegacy] }, { hooks: [command] }] },
    });
    await expect(countCodexStopHooks(root, command, [legacyCommand])).resolves.toBe(1);
  });

  it("does not rewrite an already exact single owned hook", async () => {
    const root = await temporaryProject();
    await installCodexStopHook(root, command);
    const before = await readFile(join(root, ".codex", "hooks.json"), "utf8");

    await expect(installCodexStopHook(root, command)).resolves.toEqual({
      changed: false,
    });
    await expect(readFile(join(root, ".codex", "hooks.json"), "utf8")).resolves.toBe(
      before,
    );
  });

  it("extracts an owned command from a mixed Stop entry into its one owned entry", async () => {
    const root = await temporaryProject();
    const path = join(root, ".codex", "hooks.json");
    const mixed = { hooks: [command, { command: "existing-stop" }] };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify({ hooks: { Stop: [mixed] } })}\n`, "utf8");

    await expect(installCodexStopHook(root, command)).resolves.toEqual({
      changed: true,
    });
    expect(await settings(root)).toEqual({
      hooks: {
        Stop: [{ hooks: [{ command: "existing-stop" }] }, { hooks: [command] }],
      },
    });
  });

  it("removes only the exact owned command on uninstall", async () => {
    const root = await temporaryProject();
    const path = join(root, ".codex", "hooks.json");
    const similar = { ...command, statusMessage: "similar but not owned" };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify({ hooks: { Stop: [{ hooks: [command, similar, { command: "existing-stop" }] }] } })}\n`,
      "utf8",
    );

    await expect(uninstallCodexStopHook(root, command)).resolves.toEqual({
      changed: true,
    });
    expect(await settings(root)).toEqual({
      hooks: { Stop: [{ hooks: [similar, { command: "existing-stop" }] }] },
    });
  });

  it("keeps Codex's empty hooks container after removing its sole direct hook", async () => {
    const root = await temporaryProject();

    await installCodexStopHook(root, command);
    await expect(uninstallCodexStopHook(root, command)).resolves.toEqual({
      changed: true,
    });

    await expect(settings(root)).resolves.toEqual({ hooks: {} });
  });

  it("removes exact current and obsolete owned handlers together on uninstall", async () => {
    const root = await temporaryProject();
    const path = join(root, ".codex", "hooks.json");
    const unrelated = { type: "command", command: "existing-stop" };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify({ hooks: { Stop: [{ hooks: [legacyCommand, command, unrelated] }] } })}\n`,
      "utf8",
    );

    await uninstallCodexStopHook(root, command, [legacyCommand]);

    expect(await settings(root)).toEqual({
      hooks: { Stop: [{ hooks: [unrelated] }] },
    });
  });

  it.each([
    ["invalid JSON", "{ malformed", "Codex hooks contain invalid JSON"],
    ["a non-object root", "[]", "Codex hooks must be an object"],
    ["a non-object hooks container", '{"hooks":[]}', "Codex hooks hooks must be an object"],
    ["a non-array Stop container", '{"hooks":{"Stop":{}}}', "Codex hooks hooks.Stop must be an array"],
  ])("rejects %s before mutating the file", async (_label, contents, message) => {
    const root = await temporaryProject();
    const path = join(root, ".codex", "hooks.json");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");

    await expect(installCodexStopHook(root, command)).rejects.toThrow(message);
    await expect(readFile(path, "utf8")).resolves.toBe(contents);
  });
});
