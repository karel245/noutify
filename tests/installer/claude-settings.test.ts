import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  countClaudeStopHooks,
  hasClaudeStopHook,
  installClaudeStopHook,
  uninstallClaudeStopHook,
} from "../../src/installer/claude-settings.js";

const temporaryRoots: string[] = [];
const hook = {
  command: "C:/Program Files/nodejs/node.exe",
  args: [
    "C:/tools/noutify/dist/cli.js",
    "hook",
    "claude-stop",
    "--project",
    "C:/work/demo",
  ],
};
const legacyCommand =
  '"C:/Program Files/nodejs/node.exe" "C:/tools/noutify/dist/cli.js" hook claude-stop --project "C:/work/demo"';

async function temporaryProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "noutify-claude-"));
  temporaryRoots.push(root);
  return root;
}

async function settings(root: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(join(root, ".claude", "settings.local.json"), "utf8"),
  ) as Record<string, unknown>;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("Claude Code settings installation", () => {
  it("creates one project-local Stop hook in shell-free exec form", async () => {
    const root = await temporaryProject();

    const result = await installClaudeStopHook(root, hook);

    expect(result).toEqual({ changed: true, backupPath: null });
    expect(await settings(root)).toEqual({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: hook.command,
                args: hook.args,
                timeout: 12,
              },
            ],
          },
        ],
      },
    });
    await expect(hasClaudeStopHook(root, hook)).resolves.toBe(true);
  });

  it("preserves unrelated hooks and backs up existing settings", async () => {
    const root = await temporaryProject();
    const settingsPath = join(root, ".claude", "settings.local.json");
    await mkdir(dirname(settingsPath), { recursive: true });
    const original = {
      permissions: { allow: ["Read"] },
      hooks: {
        PostToolUse: [
          { hooks: [{ type: "command", command: "existing-post" }] },
        ],
        Stop: [{ hooks: [{ type: "command", command: "existing-stop" }] }],
      },
    };
    await writeFile(settingsPath, `${JSON.stringify(original, null, 2)}\n`, "utf8");

    const result = await installClaudeStopHook(root, hook);

    expect(result.changed).toBe(true);
    expect(result.backupPath).toBe(`${settingsPath}.noutify-backup`);
    expect(
      JSON.parse(await readFile(result.backupPath as string, "utf8")),
    ).toEqual(original);
    const installed = await settings(root);
    expect(installed.permissions).toEqual(original.permissions);
    expect(installed.hooks).toEqual({
      PostToolUse: original.hooks.PostToolUse,
      Stop: [
        ...original.hooks.Stop,
        {
          hooks: [
            {
              type: "command",
              command: hook.command,
              args: hook.args,
              timeout: 12,
            },
          ],
        },
      ],
    });
  });

  it("is idempotent and does not create duplicate hooks", async () => {
    const root = await temporaryProject();
    await installClaudeStopHook(root, hook);
    const first = JSON.stringify(await settings(root));

    const result = await installClaudeStopHook(root, hook);

    expect(result).toEqual({ changed: false, backupPath: null });
    expect(JSON.stringify(await settings(root))).toBe(first);
  });

  it("uses command plus args as the exact hook identity", async () => {
    const root = await temporaryProject();
    const unrelated = { ...hook, args: [...hook.args.slice(0, -1), "C:/work/other"] };
    await installClaudeStopHook(root, unrelated);
    await installClaudeStopHook(root, hook);

    await expect(countClaudeStopHooks(root, hook)).resolves.toBe(1);
    await expect(countClaudeStopHooks(root, unrelated)).resolves.toBe(1);

    await uninstallClaudeStopHook(root, hook);

    await expect(hasClaudeStopHook(root, hook)).resolves.toBe(false);
    await expect(hasClaudeStopHook(root, unrelated)).resolves.toBe(true);
  });

  it("migrates only the exact legacy shell-form hook and deduplicates current hooks", async () => {
    const root = await temporaryProject();
    const settingsPath = join(root, ".claude", "settings.local.json");
    await mkdir(dirname(settingsPath), { recursive: true });
    const currentHandler = {
      type: "command",
      command: hook.command,
      args: hook.args,
      timeout: 12,
    };
    const modifiedLegacy = {
      type: "command",
      command: legacyCommand,
      timeout: 13,
    };
    await writeFile(
      settingsPath,
      `${JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                { type: "command", command: legacyCommand, timeout: 12 },
                modifiedLegacy,
              ],
            },
            { hooks: [currentHandler, structuredClone(currentHandler)] },
          ],
        },
      })}\n`,
      "utf8",
    );

    await expect(
      installClaudeStopHook(root, hook, [legacyCommand]),
    ).resolves.toMatchObject({ changed: true });

    const installed = JSON.stringify(await settings(root));
    expect(installed.match(/claude-stop/g)).toHaveLength(2);
    expect(installed).toContain(JSON.stringify(modifiedLegacy));
    await expect(countClaudeStopHooks(root, hook)).resolves.toBe(1);
  });

  it("uninstalls exact current and legacy handlers while preserving unrelated hooks", async () => {
    const root = await temporaryProject();
    const settingsPath = join(root, ".claude", "settings.local.json");
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(
      settingsPath,
      `${JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: "command",
                  command: hook.command,
                  args: hook.args,
                  timeout: 12,
                },
                { type: "command", command: legacyCommand, timeout: 12 },
                { type: "command", command: "existing-stop" },
              ],
            },
          ],
        },
      })}\n`,
      "utf8",
    );

    const result = await uninstallClaudeStopHook(root, hook, [legacyCommand]);

    expect(result).toEqual({ changed: true });
    expect(JSON.stringify(await settings(root))).toContain("existing-stop");
    expect(JSON.stringify(await settings(root))).not.toContain("claude-stop");
  });

  it("refuses malformed JSON without overwriting it", async () => {
    const root = await temporaryProject();
    const settingsPath = join(root, ".claude", "settings.local.json");
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, "{ malformed", "utf8");

    await expect(installClaudeStopHook(root, hook)).rejects.toThrow(
      "Claude settings contain invalid JSON",
    );
    await expect(readFile(settingsPath, "utf8")).resolves.toBe("{ malformed");
  });

  it("restores pre-existing empty hook containers on uninstall", async () => {
    const root = await temporaryProject();
    const settingsPath = join(root, ".claude", "settings.local.json");
    await mkdir(dirname(settingsPath), { recursive: true });
    const original = { hooks: { Stop: [] } };
    await writeFile(settingsPath, `${JSON.stringify(original)}\n`, "utf8");
    await installClaudeStopHook(root, hook);

    await uninstallClaudeStopHook(root, hook);

    await expect(settings(root)).resolves.toEqual(original);
  });

  it("counts every exact exec handler even inside one Stop entry", async () => {
    const root = await temporaryProject();
    const settingsPath = join(root, ".claude", "settings.local.json");
    await mkdir(dirname(settingsPath), { recursive: true });
    const handler = {
      type: "command",
      command: hook.command,
      args: hook.args,
      timeout: 12,
    };
    await writeFile(
      settingsPath,
      `${JSON.stringify({
        hooks: { Stop: [{ hooks: [handler, structuredClone(handler)] }] },
      })}\n`,
      "utf8",
    );

    await expect(countClaudeStopHooks(root, hook)).resolves.toBe(2);
  });

  const windowsIt = process.platform === "win32" ? it : it.skip;

  windowsIt("executes shell-active Windows paths literally and remains silent", async () => {
    const temporaryRoot = await temporaryProject();
    const root = join(temporaryRoot, "Project $() & ` notes");
    const runtimeDirectory = join(temporaryRoot, "Runtime $() & ` files");
    const cliPath = join(runtimeDirectory, "hook runner.mjs");
    const receiptPath = join(runtimeDirectory, "receipt.json");
    await Promise.all([
      mkdir(root, { recursive: true }),
      mkdir(runtimeDirectory, { recursive: true }),
    ]);
    await writeFile(
      cliPath,
      [
        'import { writeFileSync } from "node:fs";',
        `writeFileSync(${JSON.stringify(receiptPath)}, JSON.stringify({ execPath: process.execPath, args: process.argv.slice(2) }));`,
        "",
      ].join("\n"),
      "utf8",
    );
    const literalHook = {
      command: process.execPath,
      args: [cliPath, "hook", "claude-stop", "--project", root],
    };
    await installClaudeStopHook(root, literalHook);
    const installed = await settings(root) as {
      hooks: { Stop: Array<{ hooks: Array<{ command: string; args: string[] }> }> };
    };
    const handler = installed.hooks.Stop[0]?.hooks[0];
    expect(handler).toBeDefined();

    const result = spawnSync(handler?.command ?? "", handler?.args ?? [], {
      encoding: "utf8",
      input: '{"stop_hook_active":true}',
      shell: false,
      windowsHide: true,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(JSON.parse(await readFile(receiptPath, "utf8"))).toEqual({
      execPath: process.execPath,
      args: ["hook", "claude-stop", "--project", root],
    });
  });
});
