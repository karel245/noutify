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

  it("forwards every explicit native agent selection in canonical installed order", async () => {
    const root = await temporaryProject();
    const output = memoryIo();

    expect(
      await runCli(
        [
          "setup",
          "--project",
          root,
          "--agent",
          "windsurf",
          "--agent",
          "copilot-cli",
          "--agent",
          "gemini-cli",
          "--agent",
          "codex",
          "--agent",
          "claude-code",
        ],
        output.io,
        { nodePath: "C:/node.exe", cliPath: "C:/noutify/dist/cli.js" },
      ),
    ).toBe(0);
    expect(output.stderr).toEqual([]);
    expect((await readProjectConfig(root)).public.integrations).toEqual([
      { agent: "claude-code", mode: "native", path: ".claude/settings.local.json" },
      { agent: "codex", mode: "native", path: ".codex/hooks.json" },
      {
        agent: "copilot-cli",
        mode: "native",
        path: ".github/copilot/settings.local.json",
      },
      { agent: "gemini-cli", mode: "native", path: ".gemini/settings.json" },
      { agent: "windsurf", mode: "native", path: ".windsurf/hooks.json" },
    ]);
  });

  it("rejects conflicting native and generic trigger modes through the CLI", async () => {
    const root = await temporaryProject();
    const output = memoryIo();

    expect(
      await runCli(
        [
          "setup",
          "--project",
          root,
          "--agent",
          "codex",
          "--agent",
          "generic:codex",
        ],
        output.io,
        { nodePath: "C:/node.exe", cliPath: "C:/noutify/dist/cli.js" },
      ),
    ).toBe(1);
    expect(output.stdout).toEqual([]);
    expect(output.stderr).toEqual([
      "multiple trigger modes for platform identity: codex",
    ]);
    await expect(readProjectConfig(root)).rejects.toBeDefined();
  });

  it("forwards an explicit generic memory link and installs no native hooks", async () => {
    const root = await temporaryProject();
    const output = memoryIo();

    expect(
      await runCli(
        [
          "setup",
          "--project",
          root,
          "--topic",
          "private_topic_1234567890",
          "--agent",
          "generic:cursor",
          "--memory-link",
          "generic:cursor=AGENTS.md",
        ],
        output.io,
        { nodePath: "C:/node.exe", cliPath: "C:/noutify/dist/cli.js" },
      ),
    ).toBe(0);
    expect(output.stderr).toEqual([]);
    expect((await readProjectConfig(root)).public.integrations).toEqual([
      { agent: "generic:cursor", mode: "memory", path: "AGENTS.md" },
    ]);
  });

  it("routes confirmed selected generic WAITING notifications silently", async () => {
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
        "generic:cursor",
      ],
      memoryIo().io,
      dependencies,
    );
    await runCli(["confirm", "--project", root], memoryIo().io, dependencies);
    const output = memoryIo();

    expect(
      await runCli(
        [
          "notify",
          "waiting",
          "--agent",
          "generic:cursor",
          "--project",
          root,
        ],
        output.io,
        dependencies,
      ),
    ).toBe(0);
    expect(sent).toHaveLength(1);
    expect(output.stdout).toEqual([]);
    expect(output.stderr).toEqual([]);
  });

  it("suppresses generic WAITING before confirmation or for an unselected agent", async () => {
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
        "generic:cursor",
      ],
      memoryIo().io,
      dependencies,
    );

    await runCli(
      ["notify", "waiting", "--agent", "generic:cursor", "--project", root],
      memoryIo().io,
      dependencies,
    );
    await runCli(["confirm", "--project", root], memoryIo().io, dependencies);
    await runCli(
      ["notify", "waiting", "--agent", "generic:other", "--project", root],
      memoryIo().io,
      dependencies,
    );
    expect(sends).toBe(0);
  });

  it("keeps malformed or failed generic internal notifications silent", async () => {
    const root = await temporaryProject();
    const dependencies = {
      send: async () => {
        throw new Error("provider unavailable");
      },
    };
    const malformed = memoryIo();
    const failed = memoryIo();
    await runCli(
      [
        "setup",
        "--project",
        root,
        "--topic",
        "private_topic_1234567890",
        "--agent",
        "generic:cursor",
      ],
      memoryIo().io,
    );
    await runCli(["confirm", "--project", root], memoryIo().io);

    expect(await runCli(["notify", "waiting", "--agent"], malformed.io)).toBe(0);
    expect(
      await runCli(
        ["notify", "waiting", "--agent", "generic:cursor", "--project", root],
        failed.io,
        dependencies,
      ),
    ).toBe(0);
    expect(malformed.stdout).toEqual([]);
    expect(malformed.stderr).toEqual([]);
    expect(failed.stdout).toEqual([]);
    expect(failed.stderr).toEqual([]);
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

  it("confirms every selected native agent and renders one passing receipt per agent", async () => {
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
        "--agent",
        "claude-code",
        "--agent",
        "codex",
        "--agent",
        "copilot-cli",
        "--agent",
        "gemini-cli",
        "--agent",
        "windsurf",
      ],
      memoryIo().io,
      dependencies,
    );
    await runCli(["confirm", "--project", root], memoryIo().io, dependencies);
    const agents = [
      "windsurf",
      "copilot-cli",
      "gemini-cli",
      "codex",
      "claude-code",
    ];
    const confirmOutput = memoryIo();
    const doctorOutput = memoryIo();

    for (const agent of agents) {
      expect(
        await runCli(
          ["confirm-agent", agent, "--project", root],
          confirmOutput.io,
          dependencies,
        ),
      ).toBe(0);
    }
    expect(confirmOutput.stdout).toEqual(agents.map(
      (agent) => `Automatic receipt confirmed for ${agent}.`,
    ));
    expect(
      await runCli(["doctor", "--project", root], doctorOutput.io, dependencies),
    ).toBe(0);
    for (const agent of [
      "claude-code",
      "codex",
      "copilot-cli",
      "gemini-cli",
      "windsurf",
    ]) {
      expect(doctorOutput.stdout).toContain(
        `PASS ${agent}-automatic-receipt: automatic delivery receipt is confirmed`,
      );
    }
  });

  it("rejects confirm-agent for an unselected integration without changing config", async () => {
    const root = await temporaryProject();
    const dependencies = {
      nodePath: "C:/node.exe",
      cliPath: "C:/noutify/dist/cli.js",
    };
    await runCli(
      ["setup", "--project", root, "--agent", "codex"],
      memoryIo().io,
      dependencies,
    );
    const before = await readProjectConfig(root);
    const output = memoryIo();

    expect(
      await runCli(
        ["confirm-agent", "claude-code", "--project", root],
        output.io,
        dependencies,
      ),
    ).toBe(1);
    expect(await readProjectConfig(root)).toEqual(before);
    expect(output.stdout).toEqual([]);
    expect(output.stderr).toEqual([
      "agent integration is not selected: claude-code",
    ]);
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

  it.each([
    ["valid", '{"hook_event_name":"AfterAgent","stop_hook_active":false}', false, 1],
    ["recursive", '{"hook_event_name":"AfterAgent","stop_hook_active":true}', false, 0],
    ["wrong event", '{"hook_event_name":"BeforeAgent"}', false, 0],
    ["malformed", "not-json", false, 0],
    ["send failure", '{"hook_event_name":"AfterAgent"}', true, 1],
  ])(
    "returns Gemini's exact empty-object response for a %s hook path",
    async (_label, input, rejectSend, expectedAttempts) => {
      const root = await temporaryProject();
      let sendAttempts = 0;
      const dependencies = {
        nodePath: "C:/node.exe",
        cliPath: "C:/noutify/dist/cli.js",
        send: async () => {
          sendAttempts += 1;
          if (rejectSend) throw new Error("provider unavailable");
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
          "gemini-cli",
        ],
        memoryIo().io,
        dependencies,
      );
      await runCli(["confirm", "--project", root], memoryIo().io, dependencies);
      const hookIo = memoryIo(input);

      expect(
        await runCli(
          ["hook", "gemini-after-agent", "--project", root],
          hookIo.io,
          dependencies,
        ),
      ).toBe(0);
      expect(sendAttempts).toBe(expectedAttempts);
      expect(hookIo.stdout).toEqual(["{}"]);
      expect(hookIo.stderr).toEqual([]);
    },
  );

  it("does not apply Gemini's output contract to other lifecycle hooks", async () => {
    const output = memoryIo("not-json");

    expect(
      await runCli(["hook", "codex-stop", "--project", "C:/missing"], output.io),
    ).toBe(0);
    expect(output.stdout).toEqual([]);
    expect(output.stderr).toEqual([]);
  });

  it.each([
    [
      "native",
      '{"stopReason":"end_turn","stop_hook_active":false,"prompt":"private prompt","transcriptPath":"C:/private/transcript.jsonl"}',
      false,
      1,
    ],
    [
      "VS Code compatible",
      '{"hook_event_name":"Stop","stop_reason":"end_turn","stop_hook_active":false}',
      false,
      1,
    ],
    ["recursive", '{"stopReason":"end_turn","stop_hook_active":true}', false, 0],
    ["mixed", '{"stopReason":"end_turn","hook_event_name":"BeforeTool"}', false, 0],
    ["malformed", "not-json", false, 0],
    ["send failure", '{"stopReason":"end_turn"}', true, 1],
  ])(
    "returns Copilot's exact empty-object response for a %s hook path",
    async (_label, input, rejectSend, expectedAttempts) => {
      const root = await temporaryProject();
      let sendAttempts = 0;
      const dependencies = {
        nodePath: "C:/node.exe",
        cliPath: "C:/noutify/dist/cli.js",
        send: async () => {
          sendAttempts += 1;
          if (rejectSend) throw new Error("provider unavailable");
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
          "copilot-cli",
        ],
        memoryIo().io,
        dependencies,
      );
      await runCli(["confirm", "--project", root], memoryIo().io, dependencies);
      const hookIo = memoryIo(input);

      expect(
        await runCli(
          ["hook", "copilot-agent-stop", "--project", root],
          hookIo.io,
          dependencies,
        ),
      ).toBe(0);
      expect(sendAttempts).toBe(expectedAttempts);
      expect(hookIo.stdout).toEqual(["{}"]);
      expect(hookIo.stderr).toEqual([]);
      expect(hookIo.stdout.join("\n")).not.toContain("private_topic_1234567890");
      expect(hookIo.stdout.join("\n")).not.toContain("transcript");
    },
  );

  it("returns Copilot's exact response even when its arguments or project are invalid", async () => {
    for (const argv of [
      ["hook", "copilot-agent-stop", "--project"],
      ["hook", "copilot-agent-stop", "--unknown", "value"],
      ["hook", "copilot-agent-stop", "unexpected"],
      ["hook", "copilot-agent-stop", "--project", "C:/missing"],
    ]) {
      const output = memoryIo('{"stopReason":"end_turn"}');
      expect(await runCli(argv, output.io)).toBe(0);
      expect(output.stdout).toEqual(["{}"]);
      expect(output.stderr).toEqual([]);
    }
  });

  it.each([
    [
      "valid",
      JSON.stringify({
        agent_action_name: "post_cascade_response",
        tool_info: { response: "private response" },
        workspace_root: "C:/spoofed/project",
      }),
      false,
      1,
    ],
    [
      "wrong event",
      '{"agent_action_name":"pre_cascade_response"}',
      false,
      0,
    ],
    ["malformed", "not-json", false, 0],
    [
      "send failure",
      '{"agent_action_name":"post_cascade_response"}',
      true,
      1,
    ],
  ])(
    "keeps a Windsurf %s hook silent and successful",
    async (_label, input, rejectSend, expectedAttempts) => {
      const root = await temporaryProject();
      const sent: Notification[] = [];
      let sendAttempts = 0;
      const dependencies = {
        nodePath: "C:/node.exe",
        cliPath: "C:/noutify/dist/cli.js",
        send: async (notification: Notification) => {
          sendAttempts += 1;
          sent.push(notification);
          if (rejectSend) throw new Error("provider unavailable");
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
          "windsurf",
        ],
        memoryIo().io,
        dependencies,
      );
      await runCli(["confirm", "--project", root], memoryIo().io, dependencies);
      const hookIo = memoryIo(input);

      expect(
        await runCli(
          ["hook", "windsurf-post-response", "--project", root],
          hookIo.io,
          dependencies,
        ),
      ).toBe(0);
      expect(sendAttempts).toBe(expectedAttempts);
      expect(hookIo.stdout).toEqual([]);
      expect(hookIo.stderr).toEqual([]);
      expect(JSON.stringify(sent)).not.toContain("private response");
      expect(JSON.stringify(sent)).not.toContain("spoofed");
      if (expectedAttempts > 0) {
        expect(sent[0]?.message).toContain(basename(root));
      }
    },
  );

  it("keeps invalid Windsurf hook arguments and missing projects silent", async () => {
    for (const argv of [
      ["hook", "windsurf-post-response", "--project"],
      ["hook", "windsurf-post-response", "--unknown", "value"],
      ["hook", "windsurf-post-response", "unexpected"],
      ["hook", "windsurf-post-response", "--project", "C:/missing"],
    ]) {
      const output = memoryIo('{"agent_action_name":"post_cascade_response"}');
      expect(await runCli(argv, output.io)).toBe(0);
      expect(output.stdout).toEqual([]);
      expect(output.stderr).toEqual([]);
    }
  });

  it.each([
    [
      "Claude",
      "claude-stop",
      '{"stop_hook_active":false}',
      "codex",
      [] as const,
    ],
    [
      "Codex",
      "codex-stop",
      '{"hook_event_name":"Stop","stop_hook_active":false}',
      "claude-code",
      [] as const,
    ],
    [
      "Gemini",
      "gemini-after-agent",
      '{"hook_event_name":"AfterAgent","stop_hook_active":false}',
      "codex",
      ["{}"] as const,
    ],
    [
      "Copilot",
      "copilot-agent-stop",
      '{"stopReason":"end_turn","stop_hook_active":false}',
      "codex",
      ["{}"] as const,
    ],
    [
      "Windsurf",
      "windsurf-post-response",
      '{"agent_action_name":"post_cascade_response"}',
      "codex",
      [] as const,
    ],
  ] as const)(
    "suppresses the %s hook when its native integration is not selected",
    async (_label, subcommand, input, selectedAgent, expectedStdout) => {
      const root = await temporaryProject();
      let sendAttempts = 0;
      const dependencies = {
        nodePath: "C:/node.exe",
        cliPath: "C:/noutify/dist/cli.js",
        send: async () => {
          sendAttempts += 1;
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
          selectedAgent,
        ],
        memoryIo().io,
        dependencies,
      );
      await runCli(["confirm", "--project", root], memoryIo().io, dependencies);
      const hookIo = memoryIo(input);

      expect(
        await runCli(
          ["hook", subcommand, "--project", root],
          hookIo.io,
          dependencies,
        ),
      ).toBe(0);
      expect(sendAttempts).toBe(0);
      expect(hookIo.stdout).toEqual([...expectedStdout]);
      expect(hookIo.stderr).toEqual([]);
    },
  );

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
      "setup | test | confirm | confirm-agent | doctor | uninstall",
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
        integrations: [
          { agent: "claude-code", mode: "native", status: "installed" },
        ],
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
        integrations: [
          { agent: "claude-code", mode: "native", status: "installed" },
        ],
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
