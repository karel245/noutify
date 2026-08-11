import { isDeepStrictEqual } from "node:util";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  inspectJsonHook,
  installJsonHook,
  preflightJsonHook,
  uninstallJsonHook,
  type JsonHookFileSpec,
} from "../../src/installer/json-hook-file.js";

const temporaryRoots: string[] = [];
const owned = { type: "command", command: "node noutify", timeout: 10 };
const spec: JsonHookFileSpec<typeof owned> = {
  relativePath: ".agent/settings.json",
  arrayPath: ["hooks", "Stop"],
  owned,
  isOwned: (value) => isDeepStrictEqual(value, owned),
};

async function temporaryProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "noutify-json-hook-"));
  temporaryRoots.push(root);
  return root;
}

function hookPath(root: string): string {
  return join(root, ".agent", "settings.json");
}

async function json(root: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(hookPath(root), "utf8")) as Record<string, unknown>;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe("JSON hook file merge", () => {
  it("creates missing containers and installs one exact owned entry", async () => {
    const root = await temporaryProject();

    await expect(installJsonHook(root, spec)).resolves.toEqual({ changed: true });
    await expect(inspectJsonHook(root, spec)).resolves.toEqual({
      installed: true,
      count: 1,
    });
    expect(await json(root)).toEqual({ hooks: { Stop: [owned] } });
  });

  it("repairs duplicate owned entries while preserving unrelated data", async () => {
    const root = await temporaryProject();
    const path = hookPath(root);
    const unrelated = { type: "command", command: "existing" };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({
      preferences: { enabled: true },
      hooks: { BeforeTool: [unrelated], Stop: [owned, structuredClone(owned), unrelated] },
    }), "utf8");

    await expect(installJsonHook(root, spec)).resolves.toEqual({ changed: true });
    expect(await json(root)).toEqual({
      preferences: { enabled: true },
      hooks: { BeforeTool: [unrelated], Stop: [unrelated, owned] },
    });
  });

  it("does not rewrite an already correct owned entry", async () => {
    const root = await temporaryProject();
    const path = hookPath(root);
    const contents = '{\n  "hooks": { "Stop": [{ "type": "command", "command": "node noutify", "timeout": 10 }] }\n}\n';
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");

    await expect(installJsonHook(root, spec)).resolves.toEqual({ changed: false });
    await expect(readFile(path, "utf8")).resolves.toBe(contents);
  });

  it("removes only exact owned entries and leaves an empty original container", async () => {
    const root = await temporaryProject();
    const path = hookPath(root);
    const similar = { ...owned, timeout: 11 };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ hooks: { Stop: [owned, similar] } }), "utf8");

    await expect(uninstallJsonHook(root, spec)).resolves.toEqual({ changed: true });
    expect(await json(root)).toEqual({ hooks: { Stop: [similar] } });

    await writeFile(path, JSON.stringify({ hooks: { Stop: [owned] } }), "utf8");
    await uninstallJsonHook(root, spec);
    expect(await json(root)).toEqual({ hooks: {} });
  });

  it.each([
    ["invalid JSON", "{ malformed", "JSON hook file contains invalid JSON"],
    ["non-object root", "[]", "JSON hook file must be an object"],
    ["non-object container", '{"hooks":[]}', "JSON hook file hooks must be an object"],
    ["non-array target", '{"hooks":{"Stop":{}}}', "JSON hook file hooks.Stop must be an array"],
  ])("rejects %s without changing the file", async (_label, contents, message) => {
    const root = await temporaryProject();
    const path = hookPath(root);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");

    await expect(preflightJsonHook(root, spec)).rejects.toThrow(message);
    await expect(installJsonHook(root, spec)).rejects.toThrow(message);
    await expect(readFile(path, "utf8")).resolves.toBe(contents);
  });

  it("uses an atomic replacement without leaving temporary files", async () => {
    const root = await temporaryProject();

    await installJsonHook(root, spec);

    await expect(readdir(join(root, ".agent"))).resolves.toEqual(["settings.json"]);
  });
});
