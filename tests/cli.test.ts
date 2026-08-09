import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Notification } from "../src/core/types.js";
import {
  readProjectConfig,
  writeProjectConfig,
} from "../src/config/project-config.js";
import { uninstallClaudeStopHook } from "../src/installer/claude-settings.js";
import { buildClaudeHookCommand } from "../src/installer/setup.js";
import { optionValues, parseArguments, runCli } from "../src/cli.js";

const temporaryRoots: string[] = [];

async function temporaryProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "noutify-cli-"));
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

function memoryIo(input = "") {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      readStdin: async () => input,
      writeStdout: (text: string) => stdout.push(text),
      writeStderr: (text: string) => stderr.push(text),
    },
  };
}

describe("runCli", () => {
  it("preserves repeated agent options in occurrence order for future setup selection", () => {
    const parsed = parseArguments([
      "setup",
      "--agent",
      "codex",
      "--agent",
      "claude-code",
    ]);

    expect(parsed.options.get("agent")).toEqual(["codex", "claude-code"]);
    expect(optionValues(parsed, "agent")).toEqual(["codex", "claude-code"]);
  });

  it("rejects duplicate single-value options instead of silently overwriting one", async () => {
    const output = memoryIo();

    expect(
      await runCli(
        ["doctor", "--project", "C:/first", "--project", "C:/second"],
        output.io,
      ),
    ).toBe(1);
    expect(output.stderr).toEqual(["duplicate option --project for doctor"]);
  });

  it("forwards explicit repeated agent selections to setup", async () => {
    const root = await temporaryProject();
    const output = memoryIo();

    expect(
      await runCli(
        [
          "setup",
          "--project",
          root,
          "--agent",
          "claude-code",
          "--agent",
          "codex",
        ],
        output.io,
        { nodePath: "C:/node.exe", cliPath: "C:/noutify/dist/cli.js" },
      ),
    ).toBe(0);
    expect(output.stderr).toEqual([]);
    expect((await readProjectConfig(root)).public.integrations).toEqual([
      { agent: "claude-code", mode: "native", path: ".claude/settings.local.json" },
      { agent: "codex", mode: "native", path: ".codex/hooks.json" },
    ]);
  });

  it("routes the complete Phase 0 command lifecycle", async () => {
    const root = await temporaryProject();
    const topic = "private_topic_1234567890";
    const sent: Notification[] = [];
    const dependencies = {
      nodePath: "C:/Program Files/nodejs/node.exe",
      cliPath: "C:/tools/noutify/dist/cli.js",
      send: async (notification: Notification) => {
        sent.push(notification);
        return { ok: true, attempts: 1 } as const;
      },
    };

    const setupIo = memoryIo();
    expect(
      await runCli(
        [
          "setup",
          "--project",
          root,
          "--server",
          "https://ntfy.example",
          "--topic",
          topic,
        ],
        setupIo.io,
        dependencies,
      ),
    ).toBe(0);
    expect(setupIo.stdout.join("\n")).toContain(topic);

    const testIo = memoryIo();
    expect(
      await runCli(["test", "--project", root], testIo.io, dependencies),
    ).toBe(0);
    expect(sent).toHaveLength(1);
    expect(testIo.stdout.join("\n")).not.toContain(topic);

    expect(
      await runCli(
        ["confirm", "--project", root],
        memoryIo().io,
        dependencies,
      ),
    ).toBe(0);
    expect(
      await runCli(
        ["doctor", "--project", root],
        memoryIo().io,
        dependencies,
      ),
    ).toBe(0);
    expect(
      await runCli(
        ["uninstall", "--project", root],
        memoryIo().io,
        dependencies,
      ),
    ).toBe(0);
  });

  it("reports an integration removal when uninstall removes only the skill", async () => {
    const root = await temporaryProject();
    const dependencies = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    await runCli(
      [
        "setup",
        "--project",
        root,
        "--topic",
        "private_topic_1234567890",
      ],
      memoryIo().io,
      dependencies,
    );
    await uninstallClaudeStopHook(
      root,
      buildClaudeHookCommand(root, dependencies),
    );
    const output = memoryIo();

    expect(
      await runCli(["uninstall", "--project", root], output.io, dependencies),
    ).toBe(0);
    expect(output.stdout).toEqual([
      "Noutify integration removed; configuration was preserved.",
    ]);
  });

  it("keeps the internal Stop hook silent on stdout and stderr", async () => {
    const root = await temporaryProject();
    const setupIo = memoryIo();
    const dependencies = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
      send: async () => {
        throw new Error("provider unavailable");
      },
    };
    await runCli(
      [
        "setup",
        "--project",
        root,
        "--topic",
        "private_topic_1234567890",
      ],
      setupIo.io,
      dependencies,
    );
    const hookIo = memoryIo("not-json");

    const exitCode = await runCli(
      ["hook", "claude-stop", "--project", root],
      hookIo.io,
      dependencies,
    );

    expect(exitCode).toBe(0);
    expect(hookIo.stdout).toEqual([]);
    expect(hookIo.stderr).toEqual([]);
  });

  it("routes a confirmed Codex Stop event through the same silent dispatcher", async () => {
    const root = await temporaryProject();
    const sent: Notification[] = [];
    const dependencies = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
      send: async (notification: Notification) => {
        sent.push(notification);
        return { ok: true, attempts: 1 } as const;
      },
    };
    await runCli(
      [
        "setup",
        "--project",
        root,
        "--topic",
        "private_topic_1234567890",
        "--agent",
        "codex",
      ],
      memoryIo().io,
      dependencies,
    );
    await runCli(["confirm", "--project", root], memoryIo().io, dependencies);
    const hookIo = memoryIo('{"hook_event_name":"Stop","stop_hook_active":false}');

    expect(
      await runCli(
        ["hook", "codex-stop", "--project", root],
        hookIo.io,
        dependencies,
      ),
    ).toBe(0);
    expect(sent).toHaveLength(1);
    expect(hookIo.stdout).toEqual([]);
    expect(hookIo.stderr).toEqual([]);
  });

  it("suppresses recursive Codex Stop events without writing output", async () => {
    const root = await temporaryProject();
    let sends = 0;
    const dependencies = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
      send: async () => {
        sends += 1;
        return { ok: true, attempts: 1 } as const;
      },
    };
    await runCli(
      [
        "setup",
        "--project",
        root,
        "--topic",
        "private_topic_1234567890",
        "--agent",
        "codex",
      ],
      memoryIo().io,
      dependencies,
    );
    await runCli(["confirm", "--project", root], memoryIo().io, dependencies);
    const hookIo = memoryIo('{"hook_event_name":"Stop","stop_hook_active":true}');

    await runCli(["hook", "codex-stop", "--project", root], hookIo.io, dependencies);
    expect(sends).toBe(0);
    expect(hookIo.stdout).toEqual([]);
    expect(hookIo.stderr).toEqual([]);
  });

  it("keeps a failing Codex notification delivery silent", async () => {
    const root = await temporaryProject();
    const dependencies = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
      send: async () => {
        throw new Error("provider unavailable");
      },
    };
    await runCli(
      [
        "setup",
        "--project",
        root,
        "--topic",
        "private_topic_1234567890",
        "--agent",
        "codex",
      ],
      memoryIo().io,
      dependencies,
    );
    await runCli(["confirm", "--project", root], memoryIo().io, dependencies);
    const hookIo = memoryIo('{"hook_event_name":"Stop"}');

    await expect(
      runCli(["hook", "codex-stop", "--project", root], hookIo.io, dependencies),
    ).resolves.toBe(0);
    expect(hookIo.stdout).toEqual([]);
    expect(hookIo.stderr).toEqual([]);
  });

  it("passes stored Spanish language to the silent Stop hook", async () => {
    const root = await temporaryProject();
    const sent: Notification[] = [];
    const dependencies = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
      send: async (notification: Notification) => {
        sent.push(notification);
        return { ok: true, attempts: 1 } as const;
      },
    };
    await runCli(
      [
        "setup",
        "--project",
        root,
        "--topic",
        "private_topic_1234567890",
      ],
      memoryIo().io,
      dependencies,
    );
    await runCli(["confirm", "--project", root], memoryIo().io, dependencies);
    const bundle = await readProjectConfig(root);
    bundle.private.language = "es";
    await writeProjectConfig(root, bundle);
    const hookIo = memoryIo('{"stop_hook_active":false}');

    expect(
      await runCli(
        ["hook", "claude-stop", "--project", root],
        hookIo.io,
        dependencies,
      ),
    ).toBe(0);
    expect(sent).toEqual([
      {
        title: "Agente en espera",
        message: `${basename(root)}: El agente terminó su respuesta y espera instrucciones.`,
        tags: ["speech_balloon", "hourglass"],
        priority: "default",
      },
    ]);
    expect(hookIo.stdout).toEqual([]);
    expect(hookIo.stderr).toEqual([]);
  });

  it("shows every Phase 0 command in help", async () => {
    const output = memoryIo();

    expect(await runCli(["--help"], output.io)).toBe(0);

    expect(output.stdout.join("\n")).toContain(
      "setup | test | confirm | doctor | uninstall",
    );
  });

  it("does not send Stop notifications before phone confirmation", async () => {
    const root = await temporaryProject();
    let sends = 0;
    const dependencies = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
      send: async () => {
        sends += 1;
        return { ok: true, attempts: 1 } as const;
      },
    };
    await runCli(
      [
        "setup",
        "--project",
        root,
        "--topic",
        "private_topic_1234567890",
      ],
      memoryIo().io,
      dependencies,
    );

    const hookIo = memoryIo('{"stop_hook_active":false}');
    expect(
      await runCli(
        ["hook", "claude-stop", "--project", root],
        hookIo.io,
        dependencies,
      ),
    ).toBe(0);
    expect(sends).toBe(0);
    expect(hookIo.stdout).toEqual([]);
    expect(hookIo.stderr).toEqual([]);
  });

  it("honors a disabled WAITING policy after confirmation", async () => {
    const root = await temporaryProject();
    let sends = 0;
    const dependencies = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
      send: async () => {
        sends += 1;
        return { ok: true, attempts: 1 } as const;
      },
    };
    await runCli(
      [
        "setup",
        "--project",
        root,
        "--topic",
        "private_topic_1234567890",
      ],
      memoryIo().io,
      dependencies,
    );
    await runCli(["confirm", "--project", root], memoryIo().io, dependencies);
    const bundle = await readProjectConfig(root);
    bundle.public.events.waiting = false;
    await writeProjectConfig(root, bundle);

    await runCli(
      ["hook", "claude-stop", "--project", root],
      memoryIo('{"stop_hook_active":false}').io,
      dependencies,
    );
    expect(sends).toBe(0);
  });

  it("rejects unknown options before resolving a project", async () => {
    const root = await temporaryProject();
    const output = memoryIo();

    expect(
      await runCli(["doctor", "--projet", root], output.io),
    ).toBe(1);
    expect(output.stdout).toEqual([]);
    expect(output.stderr).toEqual(["unknown option --projet for doctor"]);
  });

  it("keeps malformed internal hook arguments silent and successful", async () => {
    const output = memoryIo();

    expect(await runCli(["hook", "claude-stop", "--project"], output.io)).toBe(
      0,
    );
    expect(output.stdout).toEqual([]);
    expect(output.stderr).toEqual([]);
  });

  it("updates a project's notification language", async () => {
    const root = await temporaryProject();
    const dependencies = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    await runCli(
      [
        "setup",
        "--project",
        root,
        "--topic",
        "Noutify-54h7ja8k9p2m",
      ],
      memoryIo().io,
      dependencies,
    );
    const output = memoryIo();

    expect(
      await runCli(["language", "espa\u00f1ol", "--project", root], output.io, dependencies),
    ).toBe(0);
    expect((await readProjectConfig(root)).private.language).toBe("es");
    expect(output.stdout).toEqual(["Idioma de notificaciones actualizado a espa\u00f1ol."]);
  });

  it("rejects an unsupported language without changing or revealing the configuration", async () => {
    const root = await temporaryProject();
    const topic = "Noutify-54h7ja8k9p2m";
    const dependencies = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    await runCli(
      ["setup", "--project", root, "--topic", topic],
      memoryIo().io,
      dependencies,
    );
    const before = await readProjectConfig(root);
    const output = memoryIo();

    expect(
      await runCli(["language", "fran\u00e7ais", "--project", root], output.io, dependencies),
    ).toBe(1);
    expect(await readProjectConfig(root)).toEqual(before);
    expect(output.stdout).toEqual([]);
    expect([...output.stdout, ...output.stderr].join("\n")).not.toContain(topic);
  });

  it("creates a Spanish setup and emits its machine-readable record", async () => {
    const root = await temporaryProject();
    const output = memoryIo();

    expect(
      await runCli(
        [
          "setup",
          "--project",
          root,
          "--topic",
          "Noutify-54h7ja8k9p2m",
          "--language",
          "es",
          "--format",
          "json",
        ],
        output.io,
        { nodePath: "C:/node.exe", cliPath: "C:/noutify/dist/cli.js" },
      ),
    ).toBe(0);
    expect(output.stdout).toEqual([
      JSON.stringify({
        status: "created",
        language: "es",
        server: "https://ntfy.sh",
        topic: "Noutify-54h7ja8k9p2m",
      }),
    ]);
  });

  it("reports the stored language for an existing JSON setup without changing it", async () => {
    const root = await temporaryProject();
    const dependencies = { nodePath: "C:/node.exe", cliPath: "C:/noutify/dist/cli.js" };
    await runCli(
      [
        "setup",
        "--project",
        root,
        "--topic",
        "Noutify-54h7ja8k9p2m",
        "--language",
        "es",
      ],
      memoryIo().io,
      dependencies,
    );
    const output = memoryIo();

    expect(
      await runCli(
        ["setup", "--project", root, "--language", "en", "--format", "json"],
        output.io,
        dependencies,
      ),
    ).toBe(0);
    expect(output.stdout).toEqual([
      JSON.stringify({
        status: "existing",
        language: "es",
        server: "https://ntfy.sh",
      }),
    ]);
    expect((await readProjectConfig(root)).private.language).toBe("es");
  });

  it.each([
    ["missing subcommand", ["hook"]],
    ["unknown subcommand", ["hook", "unknown"]],
    ["options without subcommand", ["hook", "--project", "C:/tmp"]],
  ])("keeps %s silent and successful", async (_label, argv) => {
    const output = memoryIo();

    expect(await runCli(argv, output.io)).toBe(0);
    expect(output.stdout).toEqual([]);
    expect(output.stderr).toEqual([]);
  });
});
