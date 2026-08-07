import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const command =
  'node "C:/tools/noutify/dist/cli.js" hook claude-stop --project "C:/work/demo"';

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
  it("creates one project-local Stop hook when settings are absent", async () => {
    const root = await temporaryProject();

    const result = await installClaudeStopHook(root, command);

    expect(result).toEqual({ changed: true, backupPath: null });
    expect(await settings(root)).toEqual({
      hooks: {
        Stop: [
          {
            hooks: [{ type: "command", command, timeout: 12 }],
          },
        ],
      },
    });
    await expect(hasClaudeStopHook(root, command)).resolves.toBe(true);
  });

  it("preserves unrelated hooks and backs up existing settings", async () => {
    const root = await temporaryProject();
    const settingsPath = join(root, ".claude", "settings.local.json");
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(dirname(settingsPath), { recursive: true }),
    );
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

    const result = await installClaudeStopHook(root, command);

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
        { hooks: [{ type: "command", command, timeout: 12 }] },
      ],
    });
  });

  it("is idempotent and does not create duplicate hooks", async () => {
    const root = await temporaryProject();
    await installClaudeStopHook(root, command);
    const first = JSON.stringify(await settings(root));

    const result = await installClaudeStopHook(root, command);

    expect(result).toEqual({ changed: false, backupPath: null });
    expect(JSON.stringify(await settings(root))).toBe(first);
  });

  it("uninstalls only the exact Noutify command", async () => {
    const root = await temporaryProject();
    await installClaudeStopHook(root, "existing-stop");
    await installClaudeStopHook(root, command);

    const result = await uninstallClaudeStopHook(root, command);

    expect(result).toEqual({ changed: true });
    await expect(hasClaudeStopHook(root, command)).resolves.toBe(false);
    await expect(hasClaudeStopHook(root, "existing-stop")).resolves.toBe(true);
  });

  it("refuses malformed JSON without overwriting it", async () => {
    const root = await temporaryProject();
    const settingsPath = join(root, ".claude", "settings.local.json");
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(dirname(settingsPath), { recursive: true }),
    );
    await writeFile(settingsPath, "{ malformed", "utf8");

    await expect(installClaudeStopHook(root, command)).rejects.toThrow(
      "Claude settings contain invalid JSON",
    );
    await expect(readFile(settingsPath, "utf8")).resolves.toBe("{ malformed");
  });

  it("restores pre-existing empty hook containers on uninstall", async () => {
    const root = await temporaryProject();
    const settingsPath = join(root, ".claude", "settings.local.json");
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(dirname(settingsPath), { recursive: true }),
    );
    const original = { hooks: { Stop: [] } };
    await writeFile(settingsPath, `${JSON.stringify(original)}\n`, "utf8");
    await installClaudeStopHook(root, command);

    await uninstallClaudeStopHook(root, command);

    await expect(settings(root)).resolves.toEqual(original);
  });

  it("counts every owned command even inside one Stop entry", async () => {
    const root = await temporaryProject();
    const settingsPath = join(root, ".claude", "settings.local.json");
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(dirname(settingsPath), { recursive: true }),
    );
    await writeFile(
      settingsPath,
      `${JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                { type: "command", command },
                { type: "command", command },
              ],
            },
          ],
        },
      })}\n`,
      "utf8",
    );

    await expect(countClaudeStopHooks(root, command)).resolves.toBe(2);
  });
});
