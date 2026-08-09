import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  countCodexStopHooks,
  installCodexStopHook,
  uninstallCodexStopHook,
} from "../../src/installer/codex-hooks.js";

const temporaryRoots: string[] = [];
const command = {
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
    const similar = { ...command, timeout: 11 };
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
