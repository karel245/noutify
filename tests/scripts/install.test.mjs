import { afterEach, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  parseArguments,
  runInstall,
  runProductionCommand,
} from "../../scripts/install.mjs";

const noutifyRoot = join("workspace", "TargetProject", "Noutify");
const targetRoot = dirname(noutifyRoot);
const cliPath = join(noutifyRoot, "dist", "cli.js");
const nodePath = "C:\\Program Files\\nodejs\\node.exe";
const overrideRoot = join("workspace", "Elsewhere");
const friendlyTopic = "Noutify-23456789abcd";
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function successfulRunner(commands) {
  return (command, argumentsList, options) => {
    commands.push({ command, argumentsList, options });
    return {
      status: 0,
      stdout:
        command === nodePath
          ? JSON.stringify({
              status: "created",
              language: argumentsList[argumentsList.indexOf("--language") + 1],
              server: "https://ntfy.sh",
              topic: friendlyTopic,
            }) + "\n"
          : "verbose child output\n",
      stderr: "",
    };
  };
}

function createDependencies(overrides = {}) {
  const output = { stdout: [], stderr: [] };
  const commands = [];
  return {
    commands,
    output,
    dependencies: {
      platform: "win32",
      nodePath,
      nodeVersion: "24.0.0",
      noutifyRoot,
      isFile: () => true,
      run: successfulRunner(commands),
      writeStdout: (line) => output.stdout.push(line),
      writeStderr: (line) => output.stderr.push(line),
      ...overrides,
    },
  };
}

describe("production process runner", () => {
  const windowsIt = process.platform === "win32" ? it : it.skip;

  windowsIt("runs npm.cmd through the real Windows production runner", () => {
    const result = runProductionCommand("npm.cmd", ["--version"], { cwd: process.cwd() });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("wraps safe cmd tokens with the configured command processor", () => {
    const calls = [];
    const result = runProductionCommand(
      "npm.cmd",
      ["run", "typecheck"],
      { cwd: noutifyRoot },
      {
        platform: "win32",
        comSpec: "C:\\Windows\\System32\\cmd.exe",
        spawn: (command, argumentsList, options) => {
          calls.push({ command, argumentsList, options });
          return { status: 0, stdout: "ok\n", stderr: "" };
        },
      },
    );

    expect(result.status).toBe(0);
    expect(calls).toEqual([
      {
        command: "C:\\Windows\\System32\\cmd.exe",
        argumentsList: ["/d", "/s", "/c", "npm.cmd run typecheck"],
        options: { cwd: noutifyRoot, encoding: "utf8", windowsHide: true },
      },
    ]);
  });

  it("rejects shell-active cmd tokens without spawning", () => {
    let spawned = false;

    const result = runProductionCommand(
      "npm.cmd",
      ["run", "test&whoami"],
      { cwd: noutifyRoot },
      {
        platform: "win32",
        comSpec: "cmd.exe",
        spawn: () => {
          spawned = true;
          return { status: 0, stdout: "", stderr: "" };
        },
      },
    );

    expect(spawned).toBe(false);
    expect(result.status).toBeNull();
    expect(result.stderr).toContain("unsafe command token");
  });

  it("keeps setup arguments out of shell parsing", () => {
    const calls = [];
    const argumentsList = [cliPath, "setup", "--project", "C:\\Target & Notes"];

    runProductionCommand(nodePath, argumentsList, { cwd: noutifyRoot }, {
      platform: "win32",
      comSpec: "cmd.exe",
      spawn: (command, receivedArguments, options) => {
        calls.push({ command, receivedArguments, options });
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    expect(calls).toEqual([
      {
        command: nodePath,
        receivedArguments: argumentsList,
        options: { cwd: noutifyRoot, encoding: "utf8", windowsHide: true },
      },
    ]);
  });
});

describe("compact installer", () => {
  it("uses the validated Node executable for Spanish setup and emits a sanitized record", async () => {
    const fixture = createDependencies();

    const exitCode = await runInstall(["--language", "es"], fixture.dependencies);

    expect(exitCode).toBe(0);
    expect(fixture.commands).toEqual([
      { command: "npm.cmd", argumentsList: ["ci"], options: { cwd: noutifyRoot } },
      { command: "npm.cmd", argumentsList: ["test"], options: { cwd: noutifyRoot } },
      { command: "npm.cmd", argumentsList: ["run", "typecheck"], options: { cwd: noutifyRoot } },
      { command: "npm.cmd", argumentsList: ["run", "build"], options: { cwd: noutifyRoot } },
      {
        command: nodePath,
        argumentsList: [
          cliPath,
          "setup",
          "--project",
          targetRoot,
          "--language",
          "es",
          "--format",
          "json",
        ],
        options: { cwd: noutifyRoot },
      },
    ]);
    expect(fixture.output.stdout).toEqual([
      "PASS dependencies\n",
      "PASS tests\n",
      "PASS typecheck\n",
      "PASS build\n",
      "PASS setup\n",
      `{"status":"created","language":"es","server":"https://ntfy.sh","topic":"${friendlyTopic}"}\n`,
    ]);
    expect(fixture.output.stdout.join("")).not.toContain("verbose child output");
    expect(fixture.output.stderr).toEqual([]);
  });

  it("reconstructs an exact successful record instead of forwarding child formatting", async () => {
    const fixture = createDependencies({
      run: (command, argumentsList, options) => {
        fixture.commands.push({ command, argumentsList, options });
        return {
          status: 0,
          stdout: command === nodePath
            ? `{ "topic": "${friendlyTopic}", "server": "https://ntfy.example", "language": "en", "status": "created" }\n`
            : "",
          stderr: "",
        };
      },
    });

    const exitCode = await runInstall(["--language", "en"], fixture.dependencies);

    expect(exitCode).toBe(0);
    expect(fixture.output.stdout.at(-1)).toBe(
      `{"status":"created","language":"en","server":"https://ntfy.example","topic":"${friendlyTopic}"}\n`,
    );
  });

  it("accepts a canonical stored language mismatch for an existing record", async () => {
    const fixture = createDependencies({
      run: (command, argumentsList, options) => {
        fixture.commands.push({ command, argumentsList, options });
        return {
          status: 0,
          stdout: command === nodePath
            ? '{"server":"https://ntfy.sh","status":"existing","language":"es"}\n'
            : "",
          stderr: "",
        };
      },
    });

    const exitCode = await runInstall(["--language", "en"], fixture.dependencies);

    expect(exitCode).toBe(0);
    expect(fixture.output.stdout.at(-1)).toBe(
      '{"status":"existing","language":"es","server":"https://ntfy.sh"}\n',
    );
  });

  it("rejects Node versions below 24 before running any stage", async () => {
    const fixture = createDependencies({ nodeVersion: "23.9.0" });

    const exitCode = await runInstall(["--language", "en"], fixture.dependencies);

    expect(exitCode).toBe(1);
    expect(fixture.commands).toEqual([]);
    expect(fixture.output.stderr.join("")).toContain("Node.js 24 or newer is required");
  });

  it("rejects a required source path that is a directory before running any stage", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "noutify-install-"));
    temporaryRoots.push(temporaryRoot);
    const sourceRoot = join(temporaryRoot, "Noutify");
    await mkdir(join(sourceRoot, "src"), { recursive: true });
    await mkdir(join(sourceRoot, "package.json"));
    await writeFile(join(sourceRoot, "package-lock.json"), "{}\n");
    await writeFile(join(sourceRoot, "src", "cli.ts"), "export {};\n");
    const fixture = createDependencies({ noutifyRoot: sourceRoot });
    delete fixture.dependencies.isFile;

    const exitCode = await runInstall(["--language", "en"], fixture.dependencies);

    expect(exitCode).toBe(1);
    expect(fixture.commands).toEqual([]);
    expect(fixture.output.stderr.join("")).toContain("Noutify source files are incomplete");
  });

  it("rejects unsupported languages before running any stage", async () => {
    const fixture = createDependencies();

    const exitCode = await runInstall(["--language", "fr"], fixture.dependencies);

    expect(exitCode).toBe(1);
    expect(fixture.commands).toEqual([]);
    expect(fixture.output.stderr.join("")).toContain("unsupported language: fr");
  });

  it("prints captured diagnostics and stops when a preparation stage fails", async () => {
    const fixture = createDependencies({
      run: (command, argumentsList, options) => {
        fixture.commands.push({ command, argumentsList, options });
        if (argumentsList[0] === "test") {
          return { status: 7, stdout: "failing assertion\n", stderr: "stack trace\n" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    const exitCode = await runInstall(["--language", "en"], fixture.dependencies);

    expect(exitCode).toBe(1);
    expect(fixture.commands.map(({ command, argumentsList }) => [command, ...argumentsList])).toEqual([
      ["npm.cmd", "ci"],
      ["npm.cmd", "test"],
    ]);
    expect(fixture.output.stdout).toEqual(["PASS dependencies\n"]);
    expect(fixture.output.stderr).toEqual([
      "FAIL tests (exit 7)\n",
      "failing assertion\nstack trace\n",
      "See Noutify/docs/setup-troubleshooting.md\n",
    ]);
  });

  it("surfaces preparation launch errors and termination signals", async () => {
    const launchFixture = createDependencies({
      run: () => ({ status: null, stdout: "", stderr: "", error: new Error("spawn EACCES") }),
    });

    await expect(runInstall(["--language", "en"], launchFixture.dependencies)).resolves.toBe(1);
    expect(launchFixture.output.stderr.join("")).toContain("launch error: spawn EACCES");

    const signalFixture = createDependencies({
      run: () => ({ status: null, signal: "SIGTERM", stdout: "", stderr: "" }),
    });

    await expect(runInstall(["--language", "en"], signalFixture.dependencies)).resolves.toBe(1);
    expect(signalFixture.output.stderr.join("")).toContain("terminated by signal SIGTERM");
  });

  it("uses a generic topic-free explanation for an invalid setup record", async () => {
    const privateValue = "unexpected-private-value";
    const fixture = createDependencies({
      run: (command, argumentsList, options) => {
        fixture.commands.push({ command, argumentsList, options });
        return {
          status: 0,
          stdout: command === nodePath
            ? `{"status":"created","language":"en","server":"","topic":"${privateValue}"}\n`
            : "",
          stderr: command === nodePath ? `setup warning ${privateValue}\n` : "",
        };
      },
    });

    const exitCode = await runInstall(["--language", "en"], fixture.dependencies);

    expect(exitCode).toBe(1);
    expect(fixture.output.stdout).not.toContain("PASS setup\n");
    expect(fixture.output.stdout.join("")).not.toContain(privateValue);
    expect(fixture.output.stderr.join("")).not.toContain(privateValue);
    expect(fixture.output.stderr).toEqual([
      "FAIL setup (exit 1)\n",
      "invalid setup record\n",
      "See Noutify/docs/setup-troubleshooting.md\n",
    ]);
  });

  it("never emits an unexpected topic from an existing setup record", async () => {
    const privateValue = "unexpected-private-value";
    const fixture = createDependencies({
      run: (command, argumentsList, options) => {
        fixture.commands.push({ command, argumentsList, options });
        return {
          status: 0,
          stdout: command === nodePath
            ? `{"status":"existing","language":"en","server":"https://ntfy.sh","topic":"${privateValue}"}\n`
            : "",
          stderr: "",
        };
      },
    });

    const exitCode = await runInstall(["--language", "en"], fixture.dependencies);

    expect(exitCode).toBe(1);
    expect(fixture.output.stdout.join("")).not.toContain(privateValue);
    expect(fixture.output.stderr.join("")).not.toContain(privateValue);
    expect(fixture.output.stderr.join("")).toContain("invalid setup record");
  });

  it("rejects extra created keys without emitting their values", async () => {
    const privateValue = "unexpected-private-value";
    const fixture = createDependencies({
      run: (command, argumentsList, options) => {
        fixture.commands.push({ command, argumentsList, options });
        return {
          status: 0,
          stdout: command === nodePath
            ? `{"status":"created","language":"en","server":"https://ntfy.sh","topic":"${friendlyTopic}","extra":"${privateValue}"}\n`
            : "",
          stderr: "",
        };
      },
    });

    const exitCode = await runInstall(["--language", "en"], fixture.dependencies);

    expect(exitCode).toBe(1);
    expect(fixture.output.stdout.join("")).not.toContain(privateValue);
    expect(fixture.output.stderr.join("")).not.toContain(privateValue);
  });

  it("rejects a created record whose language differs without forwarding child output", async () => {
    const fixture = createDependencies({
      run: (command, argumentsList, options) => {
        fixture.commands.push({ command, argumentsList, options });
        return {
          status: 0,
          stdout: command === nodePath
            ? `{"status":"created","language":"es","server":"https://ntfy.sh","topic":"${friendlyTopic}"}\n`
            : "",
          stderr: "",
        };
      },
    });

    const exitCode = await runInstall(["--language", "en"], fixture.dependencies);

    expect(exitCode).toBe(1);
    expect(fixture.output.stdout).not.toContain("PASS setup\n");
    expect(fixture.output.stderr).toEqual([
      "FAIL setup (exit 1)\n",
      "invalid setup record\n",
      "See Noutify/docs/setup-troubleshooting.md\n",
    ]);
  });

  it("reports safe launch diagnostics for setup without echoing setup streams", async () => {
    const privateValue = "unexpected-private-value";
    const fixture = createDependencies({
      run: (command, argumentsList, options) => {
        fixture.commands.push({ command, argumentsList, options });
        if (command === nodePath) {
          return {
            status: null,
            signal: "SIGTERM",
            error: new Error("spawn failed"),
            stdout: privateValue,
            stderr: privateValue,
          };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    const exitCode = await runInstall(["--language", "en"], fixture.dependencies);

    expect(exitCode).toBe(1);
    const diagnostics = fixture.output.stderr.join("");
    expect(diagnostics).toContain("launch error: spawn failed");
    expect(diagnostics).toContain("terminated by signal SIGTERM");
    expect(diagnostics).not.toContain(privateValue);
  });

  it("uses an advanced project override only for the final setup stage", async () => {
    const fixture = createDependencies();

    const exitCode = await runInstall(
      ["--language", "en", "--project", overrideRoot],
      fixture.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(fixture.commands.at(-1).argumentsList).toContain(overrideRoot);
    expect(fixture.commands.slice(0, 4).every(({ options }) => options.cwd === noutifyRoot)).toBe(true);
  });

  it("parses only supported installer arguments", () => {
    expect(parseArguments(["--language", "es", "--project", overrideRoot])).toEqual({
      language: "es",
      project: overrideRoot,
    });
    expect(() => parseArguments(["--language"])).toThrow("missing value for --language");
  });
});
