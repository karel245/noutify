import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readProjectConfig } from "../../src/config/project-config.js";
import type { Notification } from "../../src/core/types.js";
import { hasClaudeStopHook } from "../../src/installer/claude-settings.js";
import {
  buildClaudeHookCommand,
  confirmProject,
  doctorProject,
  setupProject,
  testProject,
  uninstallProject,
} from "../../src/installer/setup.js";

const temporaryRoots: string[] = [];

async function temporaryProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "noutify-setup-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("Phase 0 setup lifecycle", () => {
  it("installs, tests, confirms, diagnoses and uninstalls idempotently", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/Program Files/nodejs/node.exe",
      cliPath: "C:/tools/noutify/dist/cli.js",
    };
    const topic = "private_topic_1234567890";
    const command = buildClaudeHookCommand(root, runtime);

    const first = await setupProject({
      projectRoot: root,
      projectName: "Demo",
      server: "https://ntfy.example",
      topic,
      ...runtime,
    });
    const second = await setupProject({
      projectRoot: root,
      projectName: "Ignored on rerun",
      ...runtime,
    });

    expect(first).toMatchObject({ created: true, hookChanged: true, topic });
    expect(second).toMatchObject({
      created: false,
      hookChanged: false,
      topic,
    });
    await expect(hasClaudeStopHook(root, command)).resolves.toBe(true);

    const settingsText = await readFile(
      join(root, ".claude", "settings.local.json"),
      "utf8",
    );
    expect(settingsText.match(/hook claude-stop/g)).toHaveLength(1);

    const sent: Notification[] = [];
    const testResult = await testProject(root, async (notification) => {
      sent.push(notification);
      return { ok: true, attempts: 1 } as const;
    });
    expect(testResult).toEqual({ ok: true, attempts: 1 });
    expect(sent).toEqual([
      {
        title: "Noutify connected",
        message: "Demo: Test notification delivered by Noutify.",
        tags: ["white_check_mark"],
        priority: "default",
      },
    ]);
    expect((await readProjectConfig(root)).private.setupCompleted).toBe(false);

    await confirmProject(root);
    expect((await readProjectConfig(root)).private.setupCompleted).toBe(true);

    const diagnosis = await doctorProject(root, runtime);
    expect(diagnosis.ok).toBe(true);
    expect(diagnosis.checks.every((check) => check.ok)).toBe(true);
    expect(JSON.stringify(diagnosis)).not.toContain(topic);

    const uninstall = await uninstallProject(root, runtime);
    expect(uninstall).toEqual({ changed: true, configPreserved: true });
    await expect(hasClaudeStopHook(root, command)).resolves.toBe(false);
    await expect(readProjectConfig(root)).resolves.toBeDefined();
  });

  it("repairs the private ignore rule on an existing installation", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    await setupProject({
      projectRoot: root,
      topic: "private_topic_1234567890",
      ...runtime,
    });
    await writeFile(join(root, ".gitignore"), "dist/\n", "utf8");

    await setupProject({ projectRoot: root, ...runtime });

    await expect(readFile(join(root, ".gitignore"), "utf8")).resolves.toContain(
      ".noutify.local.json",
    );
  });

  it("fails doctor when duplicate Noutify hooks are present", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    await setupProject({
      projectRoot: root,
      topic: "private_topic_1234567890",
      ...runtime,
    });
    await confirmProject(root);
    const settingsPath = join(root, ".claude", "settings.local.json");
    const value = JSON.parse(await readFile(settingsPath, "utf8")) as {
      hooks: { Stop: unknown[] };
    };
    value.hooks.Stop.push(structuredClone(value.hooks.Stop[0]));
    await writeFile(settingsPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");

    const result = await doctorProject(root, runtime);

    expect(result.ok).toBe(false);
    expect(
      result.checks.find((check) => check.name === "claude-stop-hook"),
    ).toMatchObject({ ok: false, message: "expected one Noutify Stop hook; found 2" });
  });
});
