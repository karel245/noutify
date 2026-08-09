import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  readProjectConfig,
  writeProjectConfig,
} from "../../src/config/project-config.js";
import type { Notification } from "../../src/core/types.js";
import {
  hasClaudeStopHook,
  uninstallClaudeStopHook,
} from "../../src/installer/claude-settings.js";
import { hasClaudeSkill } from "../../src/installer/claude-skill.js";
import {
  buildClaudeHookCommand,
  buildLegacyClaudeHookCommand,
  confirmProject,
  doctorProject,
  setProjectLanguage,
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
  it("installs a linked generic memory adapter without native hook directories", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };

    await setupProject({
      projectRoot: root,
      topic: "private_topic_1234567890",
      agents: ["generic:cursor"],
      memoryLinks: [
        { agent: "generic:cursor", relativePath: "AGENTS.md" },
      ],
      ...runtime,
    });

    expect((await readProjectConfig(root)).public.integrations).toEqual([
      { agent: "generic:cursor", mode: "memory", path: "AGENTS.md" },
    ]);
    await expect(readFile(join(root, "AGENTS.md"), "utf8")).resolves.toContain(
      "<!-- noutify:generic:cursor:start -->",
    );
    await expect(access(join(root, ".claude"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(join(root, ".codex"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("records an unlinked generic adapter as pending without inventing a path", async () => {
    const root = await temporaryProject();

    await setupProject({
      projectRoot: root,
      topic: "private_topic_1234567890",
      agents: ["generic:cursor"],
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    });

    expect((await readProjectConfig(root)).public.integrations).toEqual([
      { agent: "generic:cursor", mode: "memory" },
    ]);
    await expect(access(join(root, "AGENTS.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(join(root, ".noutify", "instructions", "cursor.md"), "utf8"),
    ).resolves.toContain("notify waiting --agent generic:cursor");
  });

  it("rejects an unsafe generic memory file before writing configuration", async () => {
    const root = await temporaryProject();
    const memoryPath = join(root, "AGENTS.md");
    await writeFile(memoryPath, "broken\0memory", "utf8");

    await expect(
      setupProject({
        projectRoot: root,
        agents: ["generic:cursor"],
        memoryLinks: [
          { agent: "generic:cursor", relativePath: "AGENTS.md" },
        ],
        nodePath: "C:/node.exe",
        cliPath: "C:/noutify/dist/cli.js",
      }),
    ).rejects.toThrow(/text file/);

    await expect(readFile(memoryPath, "utf8")).resolves.toBe("broken\0memory");
    await expect(access(join(root, "noutify.config.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(join(root, ".noutify.local.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects memory links that are duplicated or not selected", async () => {
    const root = await temporaryProject();
    const base = {
      projectRoot: root,
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    const link = { agent: "generic:cursor" as const, relativePath: "AGENTS.md" };

    await expect(
      setupProject({ ...base, agents: ["generic:cursor"], memoryLinks: [link, link] }),
    ).rejects.toThrow(/duplicate memory link/);
    await expect(
      setupProject({ ...base, agents: ["codex"], memoryLinks: [link] }),
    ).rejects.toThrow(/not selected/);
    await expect(access(join(root, "noutify.config.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("records an explicitly selected Claude integration with its public path", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };

    await setupProject({
      projectRoot: root,
      topic: "private_topic_1234567890",
      agents: ["claude-code"],
      ...runtime,
    });

    expect((await readProjectConfig(root)).public.integrations).toEqual([
      {
        agent: "claude-code",
        mode: "native",
        path: ".claude/settings.local.json",
      },
    ]);
  });

  it("defaults an omitted agent selection to Claude for source compatibility", async () => {
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

    expect((await readProjectConfig(root)).public.integrations).toEqual([
      {
        agent: "claude-code",
        mode: "native",
        path: ".claude/settings.local.json",
      },
    ]);
  });

  it("installs only Codex files for a Codex-only selection", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };

    await setupProject({
      projectRoot: root,
      topic: "private_topic_1234567890",
      agents: ["codex"],
      ...runtime,
    });

    expect((await readProjectConfig(root)).public.integrations).toEqual([
      { agent: "codex", mode: "native", path: ".codex/hooks.json" },
    ]);
    await expect(
      readFile(join(root, ".codex", "hooks.json"), "utf8"),
    ).resolves.toContain("codex-stop");
    await expect(
      access(join(root, ".claude", "settings.local.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("installs each selected native adapter exactly once", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };

    await setupProject({
      projectRoot: root,
      topic: "private_topic_1234567890",
      agents: ["claude-code", "codex"],
      ...runtime,
    });

    const claude = await readFile(
      join(root, ".claude", "settings.local.json"),
      "utf8",
    );
    const codex = await readFile(join(root, ".codex", "hooks.json"), "utf8");
    expect(claude.match(/claude-stop/g)).toHaveLength(1);
    expect(codex.match(/codex-stop/g)).toHaveLength(1);
  });

  it("rejects an explicitly empty agent selection before writing", async () => {
    const root = await temporaryProject();
    const ignorePath = join(root, ".gitignore");
    await writeFile(ignorePath, "dist/\n", "utf8");

    await expect(
      setupProject({
        projectRoot: root,
        topic: "private_topic_1234567890",
        agents: [],
        nodePath: "C:/node.exe",
        cliPath: "C:/noutify/dist/cli.js",
      }),
    ).rejects.toThrow("at least one agent is required");

    await expect(readFile(ignorePath, "utf8")).resolves.toBe("dist/\n");
    await expect(access(join(root, "noutify.config.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects an unimplemented native adapter before snapshots or writes", async () => {
    const root = await temporaryProject();
    const settingsPath = join(root, ".claude", "settings.local.json");
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(settingsPath, "not-json\n", "utf8");

    await expect(
      setupProject({
        projectRoot: root,
        agents: ["gemini-cli"],
        nodePath: "C:/node.exe",
        cliPath: "C:/noutify/dist/cli.js",
      }),
    ).rejects.toThrow("native adapter is not available: gemini-cli");

    await expect(readFile(settingsPath, "utf8")).resolves.toBe("not-json\n");
    await expect(access(join(root, "noutify.config.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("migrates an existing v1 Claude install without changing stored values", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    const legacyCommand = buildLegacyClaudeHookCommand(root, runtime);
    await writeFile(
      join(root, "noutify.config.json"),
      `${JSON.stringify({
        version: 1,
        project: { name: " Legacy Demo " },
        provider: { type: "ntfy" },
        events: { waiting: false },
      }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(root, ".noutify.local.json"),
      `${JSON.stringify({
        server: "https://ntfy.example/path/",
        topic: "private_topic_1234567890",
        language: "es",
        setupCompleted: true,
      }, null, 2)}\n`,
      "utf8",
    );
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(
      join(root, ".claude", "settings.local.json"),
      `${JSON.stringify({
        permissions: { allow: ["Read"] },
        hooks: {
          Stop: [
            {
              hooks: [
                { type: "command", command: legacyCommand, timeout: 12 },
                { type: "command", command: "other-command", timeout: 12 },
              ],
            },
          ],
        },
      }, null, 2)}\n`,
      "utf8",
    );

    await setupProject({ projectRoot: root, ...runtime });

    const publicConfig = JSON.parse(
      await readFile(join(root, "noutify.config.json"), "utf8"),
    ) as Record<string, unknown>;
    const privateConfig = JSON.parse(
      await readFile(join(root, ".noutify.local.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(publicConfig).toMatchObject({
      version: 2,
      project: { name: " Legacy Demo " },
      events: { waiting: false },
      integrations: [
        {
          agent: "claude-code",
          mode: "native",
          path: ".claude/settings.local.json",
        },
      ],
    });
    expect(privateConfig).toMatchObject({
      server: "https://ntfy.example/path/",
      topic: "private_topic_1234567890",
      language: "es",
      setupCompleted: true,
      automaticReceipts: {},
    });
    expect(
      JSON.parse(
        await readFile(join(root, ".claude", "settings.local.json"), "utf8"),
      ),
    ).toMatchObject({
      permissions: { allow: ["Read"] },
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: "other-command", timeout: 12 },
            ],
          },
          {
            hooks: [
              {
                type: "command",
                command: runtime.nodePath,
                args: [
                  runtime.cliPath,
                  "hook",
                  "claude-stop",
                  "--project",
                  root,
                ],
                timeout: 12,
              },
            ],
          },
        ],
      },
    });
  });

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
    await expect(hasClaudeSkill(root, runtime)).resolves.toBe(true);

    const settingsText = await readFile(
      join(root, ".claude", "settings.local.json"),
      "utf8",
    );
    expect(settingsText.match(/claude-stop/g)).toHaveLength(1);

    const sent: Notification[] = [];
    const configured = await readProjectConfig(root);
    configured.private.language = "es";
    await writeProjectConfig(root, configured);
    const testResult = await testProject(root, async (notification) => {
      sent.push(notification);
      return { ok: true, attempts: 1 } as const;
    });
    expect(testResult).toEqual({ ok: true, attempts: 1 });
    expect(sent).toEqual([
      {
        title: "Noutify conectado",
        message: "Demo: Notificación de prueba enviada por Noutify.",
        tags: ["white_check_mark"],
        priority: "default",
      },
    ]);
    expect((await readProjectConfig(root)).private.setupCompleted).toBe(false);

    await confirmProject(root);
    expect((await readProjectConfig(root)).private.setupCompleted).toBe(true);

    const diagnosis = await doctorProject(root, runtime);
    expect(diagnosis.ok).toBe(true);
    expect(diagnosis.checks).toHaveLength(5);
    expect(diagnosis.checks.every((check) => check.ok)).toBe(true);
    expect(JSON.stringify(diagnosis)).not.toContain(topic);

    const uninstall = await uninstallProject(root, runtime);
    expect(uninstall).toEqual({ changed: true, configPreserved: true });
    await expect(hasClaudeStopHook(root, command)).resolves.toBe(false);
    await expect(hasClaudeSkill(root, runtime)).resolves.toBe(false);
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

  it("fails doctor when only the legacy shell-form hook remains", async () => {
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
      hooks: { Stop: Array<{ hooks: unknown[] }> };
    };
    value.hooks.Stop[0] = {
      hooks: [
        {
          type: "command",
          command: buildLegacyClaudeHookCommand(root, runtime),
          timeout: 12,
        },
      ],
    };
    await writeFile(settingsPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");

    const result = await doctorProject(root, runtime);

    expect(result.ok).toBe(false);
    expect(
      result.checks.find((check) => check.name === "claude-stop-hook"),
    ).toMatchObject({
      ok: false,
      message: "expected one current Noutify Stop hook; found 1 legacy",
    });
  });

  it("fails doctor when the Noutify skill is modified", async () => {
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
    await writeFile(
      join(root, ".claude", "skills", "noutify", "SKILL.md"),
      "<!-- noutify-managed:v2 -->\nmodified\n",
      "utf8",
    );

    const result = await doctorProject(root, runtime);

    expect(result.ok).toBe(false);
    expect(
      result.checks.find((check) => check.name === "claude-skill"),
    ).toMatchObject({ ok: false });
  });

  it("reports changed when uninstall removes only the Noutify skill", async () => {
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
    await uninstallClaudeStopHook(root, buildClaudeHookCommand(root, runtime));

    await expect(uninstallProject(root, runtime)).resolves.toEqual({
      changed: true,
      configPreserved: true,
    });
    await expect(hasClaudeSkill(root, runtime)).resolves.toBe(false);
  });

  it("sets an existing project's normalized notification language", async () => {
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

    await expect(setProjectLanguage(root, "espa\u00f1ol")).resolves.toBe("es");
    expect((await readProjectConfig(root)).private.language).toBe("es");
  });

  it("restores every setup target when the final skill write fails", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    const ignorePath = join(root, ".gitignore");
    const settingsPath = join(root, ".claude", "settings.local.json");
    const backupPath = `${settingsPath}.noutify-backup`;
    const publicPath = join(root, "noutify.config.json");
    const privatePath = join(root, ".noutify.local.json");
    const skillPath = join(root, ".claude", "skills", "noutify", "SKILL.md");
    const launcherPath = join(root, ".claude", "skills", "noutify", "launcher.mjs");
    const noutifySkillDirectory = join(root, ".claude", "skills", "noutify");
    const otherSkill = join(root, ".claude", "skills", "other", "SKILL.md");
    const originalIgnore = "dist/\n";
    const originalSettings = '{\n  "permissions": { "allow": ["Read"] }\n}\n';
    await writeFile(ignorePath, originalIgnore, "utf8");
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(settingsPath, originalSettings, "utf8");
    await mkdir(join(root, ".claude", "skills", "other"), { recursive: true });
    await writeFile(otherSkill, "# Other skill\n", "utf8");

    await expect(
      setupProject(
        {
          projectRoot: root,
          topic: "private_topic_1234567890",
          ...runtime,
        },
        {
          installSkill: async () => {
            await mkdir(noutifySkillDirectory, { recursive: true });
            await writeFile(skillPath, "partial skill\n", "utf8");
            await writeFile(launcherPath, "partial launcher\n", "utf8");
            throw new Error("skill write failed");
          },
        },
      ),
    ).rejects.toThrow("skill write failed");

    await expect(readFile(ignorePath, "utf8")).resolves.toBe(originalIgnore);
    await expect(readFile(settingsPath, "utf8")).resolves.toBe(originalSettings);
    await expect(access(publicPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(privatePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(skillPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(launcherPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(noutifySkillDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(otherSkill, "utf8")).resolves.toBe("# Other skill\n");
    await expect(access(backupPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves a pre-existing empty Noutify skill directory during rollback", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    const skillDirectory = join(root, ".claude", "skills", "noutify");
    const skillPath = join(skillDirectory, "SKILL.md");
    const launcherPath = join(skillDirectory, "launcher.mjs");
    await mkdir(skillDirectory, { recursive: true });

    await expect(
      setupProject(
        {
          projectRoot: root,
          topic: "private_topic_1234567890",
          ...runtime,
        },
        {
          installSkill: async () => {
            await writeFile(skillPath, "partial skill\n", "utf8");
            await writeFile(launcherPath, "partial launcher\n", "utf8");
            throw new Error("skill write failed");
          },
        },
      ),
    ).rejects.toThrow("skill write failed");

    await expect(access(skillDirectory)).resolves.toBeUndefined();
    await expect(access(skillPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(launcherPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["nodePath", { nodePath: "node", cliPath: "C:/noutify/dist/cli.js" }],
    ["cliPath", { nodePath: "C:/node.exe", cliPath: "dist/cli.js" }],
  ] as const)(
    "rejects a non-absolute runtime %s before mutating the target",
    async (field, runtime) => {
      const root = await temporaryProject();
      const ignorePath = join(root, ".gitignore");
      await writeFile(ignorePath, "dist/\n", "utf8");

      await expect(
        setupProject({
          projectRoot: root,
          topic: "private_topic_1234567890",
          ...runtime,
        }),
      ).rejects.toThrow(`runtime ${field} must be absolute`);

      await expect(readFile(ignorePath, "utf8")).resolves.toBe("dist/\n");
      await expect(access(join(root, "noutify.config.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(access(join(root, ".noutify.local.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(access(join(root, ".claude", "settings.local.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );
});
