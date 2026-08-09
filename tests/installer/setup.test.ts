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
  confirmAgent,
  confirmProject,
  doctorProject,
  setProjectLanguage,
  setupProject,
  testProject,
  uninstallProject,
} from "../../src/installer/setup.js";
import { createClaudeCodeAdapter } from "../../src/installer/adapters/claude-code.js";
import { codexAdapter } from "../../src/installer/adapters/codex.js";
import { createGenericMemoryAdapter } from "../../src/installer/adapters/generic-memory.js";
import type { AgentAdapter } from "../../src/installer/agent-adapter.js";

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

    const result = await setupProject({
      projectRoot: root,
      topic: "private_topic_1234567890",
      agents: ["generic:cursor"],
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    });

    expect((await readProjectConfig(root)).public.integrations).toEqual([
      { agent: "generic:cursor", mode: "memory" },
    ]);
    expect(result.integrations).toEqual([
      { agent: "generic:cursor", mode: "memory", status: "pending" },
    ]);
    await expect(access(join(root, "AGENTS.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(join(root, ".noutify", "instructions", "cursor.md"), "utf8"),
    ).resolves.toContain("notify waiting --agent generic:cursor");
  });

  it("preserves an installed generic memory path when setup omits a new link", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    await writeFile(join(root, "AGENTS.md"), "# Existing\n", "utf8");
    await setupProject({
      projectRoot: root,
      agents: ["generic:cursor"],
      memoryLinks: [{ agent: "generic:cursor", relativePath: "AGENTS.md" }],
      ...runtime,
    });
    const memoryBefore = await readFile(join(root, "AGENTS.md"));
    const instructionBefore = await readFile(
      join(root, ".noutify", "instructions", "cursor.md"),
    );

    const result = await setupProject({
      projectRoot: root,
      agents: ["generic:cursor"],
      ...runtime,
    });

    expect(result.integrations).toEqual([
      { agent: "generic:cursor", mode: "memory", status: "installed" },
    ]);
    expect((await readProjectConfig(root)).public.integrations).toEqual([
      { agent: "generic:cursor", mode: "memory", path: "AGENTS.md" },
    ]);
    await expect(readFile(join(root, "AGENTS.md"))).resolves.toEqual(memoryBefore);
    await expect(
      readFile(join(root, ".noutify", "instructions", "cursor.md")),
    ).resolves.toEqual(instructionBefore);
  });

  it("moves an exact generic memory block to a newly selected path", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    const oldPath = join(root, "AGENTS.md");
    const newPath = join(root, "docs", "AI.md");
    await mkdir(join(root, "docs"));
    await writeFile(oldPath, "# Old instructions\n", "utf8");
    await writeFile(newPath, "# New instructions\n", "utf8");
    await setupProject({
      projectRoot: root,
      agents: ["generic:cursor"],
      memoryLinks: [{ agent: "generic:cursor", relativePath: "AGENTS.md" }],
      ...runtime,
    });

    await setupProject({
      projectRoot: root,
      agents: ["generic:cursor"],
      memoryLinks: [{ agent: "generic:cursor", relativePath: "docs/AI.md" }],
      ...runtime,
    });

    await expect(readFile(oldPath, "utf8")).resolves.toBe("# Old instructions\n");
    await expect(readFile(newPath, "utf8")).resolves.toContain(
      "<!-- noutify:generic:cursor:start -->",
    );
    expect((await readProjectConfig(root)).public.integrations).toEqual([
      { agent: "generic:cursor", mode: "memory", path: "docs/AI.md" },
    ]);
    expect((await doctorProject(root, runtime)).checks).toContainEqual(
      expect.objectContaining({
        name: "generic:cursor-integration",
        status: "pass",
      }),
    );

    await uninstallProject(root, runtime);
    await expect(readFile(oldPath, "utf8")).resolves.toBe("# Old instructions\n");
    await expect(readFile(newPath, "utf8")).resolves.toBe("# New instructions\n");
  });

  it("restores old and new memory paths plus native and config bytes when migration fails", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    const oldPath = join(root, "AGENTS.md");
    const newPath = join(root, "NEW.md");
    await writeFile(oldPath, "# Old instructions\n", "utf8");
    await writeFile(newPath, "# New instructions\n", "utf8");
    await setupProject({
      projectRoot: root,
      agents: ["generic:cursor"],
      memoryLinks: [{ agent: "generic:cursor", relativePath: "AGENTS.md" }],
      ...runtime,
    });
    const trackedPaths = [
      join(root, ".gitignore"),
      join(root, "noutify.config.json"),
      join(root, ".noutify.local.json"),
      oldPath,
      newPath,
      join(root, ".noutify", "instructions", "cursor.md"),
      join(root, ".codex", "hooks.json"),
    ];
    const before = await Promise.all(
      trackedPaths.map((path) => readFile(path).catch(() => null)),
    );
    const generic = createGenericMemoryAdapter("generic:cursor", "NEW.md");
    let oldPathDuringInstall = "";
    const failingGeneric: AgentAdapter = {
      ...generic,
      install: async (context) => {
        oldPathDuringInstall = await readFile(oldPath, "utf8");
        await generic.install(context);
        throw new Error("migration install failed");
      },
    };

    await expect(
      setupProject(
        {
          projectRoot: root,
          agents: ["codex", "generic:cursor"],
          memoryLinks: [{ agent: "generic:cursor", relativePath: "NEW.md" }],
          ...runtime,
        },
        { adapters: [failingGeneric] },
      ),
    ).rejects.toThrow("migration install failed");

    expect(oldPathDuringInstall).toBe("# Old instructions\n");
    const after = await Promise.all(
      trackedPaths.map((path) => readFile(path).catch(() => null)),
    );
    expect(after).toEqual(before);
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

  it.each([
    [["codex", "generic:codex"] as const, "codex"],
    [["claude-code", "generic:claude-code"] as const, "claude-code"],
  ])("rejects two trigger modes for the %s identity before writing", async (agents, identity) => {
    const root = await temporaryProject();

    await expect(
      setupProject({
        projectRoot: root,
        agents,
        nodePath: "C:/node.exe",
        cliPath: "C:/noutify/dist/cli.js",
      }),
    ).rejects.toThrow(`multiple trigger modes for platform identity: ${identity}`);

    await expect(access(join(root, "noutify.config.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(join(root, ".codex"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(join(root, ".claude"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects a selected generic trigger that conflicts with a retained native identity", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    await setupProject({ projectRoot: root, agents: ["codex"], ...runtime });
    const paths = [
      join(root, ".gitignore"),
      join(root, "noutify.config.json"),
      join(root, ".noutify.local.json"),
      join(root, ".codex", "hooks.json"),
    ];
    const before = await Promise.all(paths.map((path) => readFile(path)));

    await expect(
      setupProject({
        projectRoot: root,
        agents: ["generic:codex"],
        memoryLinks: [{ agent: "generic:codex", relativePath: "AGENTS.md" }],
        ...runtime,
      }),
    ).rejects.toThrow("multiple trigger modes for platform identity: codex");

    await expect(Promise.all(paths.map((path) => readFile(path)))).resolves.toEqual(before);
    await expect(access(join(root, "AGENTS.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["codex" as const, ".codex", "hooks.json"],
    ["claude-code" as const, ".claude", "settings.local.json"],
  ])("rejects the %s adapter through a directory junction without touching its target", async (agent, directory, file) => {
    const root = await temporaryProject();
    const outside = await temporaryProject();
    const outsideHook = join(outside, file);
    const outsideBytes = '{"outside":true}\n';
    await writeFile(outsideHook, outsideBytes, "utf8");
    await symlink(
      outside,
      join(root, directory),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      setupProject({
        projectRoot: root,
        agents: [agent],
        nodePath: "C:/node.exe",
        cliPath: "C:/noutify/dist/cli.js",
      }),
    ).rejects.toThrow(/symbolic link|junction|reparse|unsafe project path/i);

    await expect(readFile(outsideHook, "utf8")).resolves.toBe(outsideBytes);
    await expect(access(join(root, "noutify.config.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(join(root, ".noutify.local.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects a linked final gitignore entry without outside or partial writes", async () => {
    const root = await temporaryProject();
    const outside = await temporaryProject();
    const outsideIgnore = process.platform === "win32"
      ? join(outside, "sentinel")
      : join(outside, "outside-ignore");
    const outsideBytes = "outside-only\n";
    await writeFile(outsideIgnore, outsideBytes, "utf8");
    await symlink(
      process.platform === "win32" ? outside : outsideIgnore,
      join(root, ".gitignore"),
      process.platform === "win32" ? "junction" : "file",
    );

    await expect(
      setupProject({
        projectRoot: root,
        agents: ["codex"],
        nodePath: "C:/node.exe",
        cliPath: "C:/noutify/dist/cli.js",
      }),
    ).rejects.toThrow(/symbolic link|junction|reparse|unsafe project path/i);

    await expect(readFile(outsideIgnore, "utf8")).resolves.toBe(outsideBytes);
    await expect(access(join(root, "noutify.config.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(join(root, ".noutify.local.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(join(root, ".codex"))).rejects.toMatchObject({ code: "ENOENT" });
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

  it("returns deterministic per-integration status for selected adapters", async () => {
    const root = await temporaryProject();
    const result = await setupProject({
      projectRoot: root,
      topic: "private_topic_1234567890",
      agents: ["codex", "claude-code"],
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    });

    expect(result).toMatchObject({
      created: true,
      integrations: [
        { agent: "claude-code", mode: "native", status: "installed" },
        { agent: "codex", mode: "native", status: "installed" },
      ],
    });
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
        agents: ["copilot-cli"],
        nodePath: "C:/node.exe",
        cliPath: "C:/noutify/dist/cli.js",
      }),
    ).rejects.toThrow("native adapter is not available: copilot-cli");

    await expect(readFile(settingsPath, "utf8")).resolves.toBe("not-json\n");
    await expect(access(join(root, "noutify.config.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("runs every selected adapter preflight before the first installation write", async () => {
    const root = await temporaryProject();
    const rejectingCodex: AgentAdapter = {
      ...codexAdapter,
      preflight: async () => {
        throw new Error("codex collision");
      },
    };

    await expect(
      setupProject(
        {
          projectRoot: root,
          agents: ["claude-code", "codex"],
          nodePath: "C:/node.exe",
          cliPath: "C:/noutify/dist/cli.js",
        },
        { adapters: [createClaudeCodeAdapter(), rejectingCodex] },
      ),
    ).rejects.toThrow("codex collision");

    await expect(access(join(root, "noutify.config.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      access(join(root, ".claude", "settings.local.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
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

    expect(first).toMatchObject({ created: true, topic });
    expect(second).toMatchObject({
      created: false,
    });
    expect("topic" in second).toBe(false);
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

    await confirmAgent(root, "claude-code");

    const diagnosis = await doctorProject(root, runtime);
    expect(diagnosis.ok).toBe(true);
    expect(diagnosis.checks.every((check) => check.status !== "fail")).toBe(true);
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
      result.checks.find((check) => check.name === "claude-code-integration"),
    ).toMatchObject({ status: "fail" });
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
      result.checks.find((check) => check.name === "claude-code-integration"),
    ).toMatchObject({ status: "fail" });
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
      result.checks.find((check) => check.name === "claude-code-integration"),
    ).toMatchObject({ status: "fail" });
  });

  it("tracks automatic receipt confirmation independently for each selected agent", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    await setupProject({
      projectRoot: root,
      agents: ["codex", "claude-code"],
      ...runtime,
    });
    await confirmProject(root);
    await confirmAgent(root, "codex");

    const result = await doctorProject(root, runtime);

    expect(result.ok).toBe(true);
    expect(result.checks).toContainEqual(expect.objectContaining({
      name: "codex-automatic-receipt",
      status: "pass",
    }));
    expect(result.checks).toContainEqual(expect.objectContaining({
      name: "claude-code-automatic-receipt",
      status: "warn",
    }));
  });

  it("rejects confirmation for an unselected agent without changing private config bytes", async () => {
    const root = await temporaryProject();
    await setupProject({
      projectRoot: root,
      agents: ["codex"],
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    });
    const privatePath = join(root, ".noutify.local.json");
    const before = await readFile(privatePath);

    await expect(confirmAgent(root, "claude-code")).rejects.toThrow(
      "agent integration is not selected: claude-code",
    );

    await expect(readFile(privatePath)).resolves.toEqual(before);
  });

  it("rejects confirmation for a selected pending memory integration without changing config bytes", async () => {
    const root = await temporaryProject();
    await setupProject({
      projectRoot: root,
      agents: ["generic:cursor"],
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    });
    const privatePath = join(root, ".noutify.local.json");
    const before = await readFile(privatePath);

    await expect(confirmAgent(root, "generic:cursor")).rejects.toThrow(
      "agent integration is not installed: generic:cursor",
    );

    await expect(readFile(privatePath)).resolves.toEqual(before);
  });

  it("rejects confirmation for a selected missing native integration without changing config bytes", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    await setupProject({ projectRoot: root, agents: ["codex"], ...runtime });
    await rm(join(root, ".codex", "hooks.json"));
    const privatePath = join(root, ".noutify.local.json");
    const before = await readFile(privatePath);

    await expect(confirmAgent(root, "codex")).rejects.toThrow(
      "agent integration is not installed: codex",
    );

    await expect(readFile(privatePath)).resolves.toEqual(before);
  });

  it("keeps a deselected installed adapter and its configuration unchanged", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    await setupProject({
      projectRoot: root,
      agents: ["claude-code", "codex"],
      ...runtime,
    });
    const codexPath = join(root, ".codex", "hooks.json");
    const before = await readFile(codexPath);

    await setupProject({
      projectRoot: root,
      agents: ["claude-code"],
      ...runtime,
    });

    await expect(readFile(codexPath)).resolves.toEqual(before);
    expect((await readProjectConfig(root)).public.integrations).toContainEqual({
      agent: "codex",
      mode: "native",
      path: ".codex/hooks.json",
    });
  });

  it("restores the whole setup transaction when the second sorted adapter fails", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    await setupProject({ projectRoot: root, agents: ["claude-code"], ...runtime });
    const paths = [
      join(root, ".gitignore"),
      join(root, "noutify.config.json"),
      join(root, ".noutify.local.json"),
      join(root, ".claude", "settings.local.json"),
      join(root, ".claude", "settings.local.json.noutify-backup"),
      join(root, ".claude", "skills", "noutify", "SKILL.md"),
      join(root, ".claude", "skills", "noutify", "launcher.mjs"),
      join(root, ".codex", "hooks.json"),
    ];
    const before = await Promise.all(paths.map((path) => readFile(path).catch(() => null)));
    const failingCodex: AgentAdapter = {
      ...codexAdapter,
      install: async (context) => {
        await codexAdapter.install(context);
        throw new Error("second adapter failed");
      },
    };

    await expect(
      setupProject(
        { projectRoot: root, agents: ["codex", "claude-code"], ...runtime },
        { adapters: [createClaudeCodeAdapter(), failingCodex] },
      ),
    ).rejects.toThrow("second adapter failed");

    const after = await Promise.all(paths.map((path) => readFile(path).catch(() => null)));
    expect(after).toEqual(before);
  });

  it("uninstalls every configured exact-owned integration and preserves config", async () => {
    const root = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    const memoryPath = join(root, "AGENTS.md");
    await writeFile(memoryPath, "# Existing instructions\n", "utf8");
    await setupProject({
      projectRoot: root,
      agents: ["claude-code", "codex", "generic:cursor"],
      memoryLinks: [{ agent: "generic:cursor", relativePath: "AGENTS.md" }],
      ...runtime,
    });
    const publicPath = join(root, "noutify.config.json");
    const privatePath = join(root, ".noutify.local.json");
    const configBefore = await Promise.all([
      readFile(publicPath),
      readFile(privatePath),
    ]);

    await expect(uninstallProject(root, runtime)).resolves.toEqual({
      changed: true,
      configPreserved: true,
    });

    await expect(Promise.all([
      readFile(publicPath),
      readFile(privatePath),
    ])).resolves.toEqual(configBefore);
    await expect(readFile(memoryPath, "utf8")).resolves.toBe("# Existing instructions\n");
    await expect(hasClaudeSkill(root, runtime)).resolves.toBe(false);
    await expect(
      readFile(join(root, ".codex", "hooks.json"), "utf8"),
    ).resolves.not.toContain("codex-stop");
    const diagnosis = await doctorProject(root, runtime);
    expect(diagnosis.ok).toBe(false);
    expect(diagnosis.checks).toContainEqual(expect.objectContaining({
      name: "claude-code-integration",
      status: "fail",
    }));
    expect(diagnosis.checks).toContainEqual(expect.objectContaining({
      name: "codex-integration",
      status: "fail",
    }));
    expect(diagnosis.checks).toContainEqual(expect.objectContaining({
      name: "generic:cursor-integration",
      status: "fail",
    }));
  });

  it("rejects uninstall through a native junction without touching outside bytes", async () => {
    const root = await temporaryProject();
    const outside = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    await setupProject({ projectRoot: root, agents: ["codex"], ...runtime });
    const configPaths = [
      join(root, "noutify.config.json"),
      join(root, ".noutify.local.json"),
    ];
    const configBefore = await Promise.all(configPaths.map((path) => readFile(path)));
    const outsideHook = join(outside, "hooks.json");
    const outsideBytes = await readFile(join(root, ".codex", "hooks.json"));
    await writeFile(outsideHook, outsideBytes);
    await rm(join(root, ".codex"), { recursive: true });
    await symlink(
      outside,
      join(root, ".codex"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(uninstallProject(root, runtime)).rejects.toThrow(
      /symbolic link|junction|reparse|unsafe project path/i,
    );

    await expect(readFile(outsideHook)).resolves.toEqual(outsideBytes);
    await expect(Promise.all(configPaths.map((path) => readFile(path)))).resolves.toEqual(
      configBefore,
    );
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

  it("rejects language and confirmation writes through a linked private config", async () => {
    const root = await temporaryProject();
    const outside = await temporaryProject();
    const runtime = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    await setupProject({ projectRoot: root, agents: ["codex"], ...runtime });
    const privatePath = join(root, ".noutify.local.json");
    const outsidePrivate = join(outside, "private.json");
    const outsideBytes = await readFile(privatePath);
    await writeFile(outsidePrivate, outsideBytes);
    await rm(privatePath);
    await symlink(
      process.platform === "win32" ? outside : outsidePrivate,
      privatePath,
      process.platform === "win32" ? "junction" : "file",
    );

    await expect(setProjectLanguage(root, "es")).rejects.toThrow(
      /symbolic link|junction|reparse|unsafe project path/i,
    );
    await expect(confirmProject(root)).rejects.toThrow(
      /symbolic link|junction|reparse|unsafe project path/i,
    );
    await expect(confirmAgent(root, "codex", runtime)).rejects.toThrow(
      /symbolic link|junction|reparse|unsafe project path/i,
    );

    await expect(readFile(outsidePrivate)).resolves.toEqual(outsideBytes);
    await expect(readFile(join(root, "noutify.config.json"))).resolves.toBeDefined();
    await expect(readFile(join(root, ".codex", "hooks.json"))).resolves.toBeDefined();
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
