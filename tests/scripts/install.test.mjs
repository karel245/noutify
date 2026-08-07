import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";

import { parseArguments, runInstall } from "../../scripts/install.mjs";

const noutifyRoot = join("workspace", "TargetProject", "Noutify");
const targetRoot = dirname(noutifyRoot);
const cliPath = join(noutifyRoot, "dist", "cli.js");
const overrideRoot = join("workspace", "Elsewhere");

function successfulRunner(commands) {
  return (command, argumentsList, options) => {
    commands.push({ command, argumentsList, options });
    return {
      status: 0,
      stdout:
        command === "node"
          ? "{" + '"status":"created","language":"es","topic":"Noutify-safe-topic"' + "}\n"
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

describe("compact installer", () => {
  it("runs Spanish preparation stages before final setup without child success output", async () => {
    const fixture = createDependencies();

    const exitCode = await runInstall(["--language", "es"], fixture.dependencies);

    expect(exitCode).toBe(0);
    expect(fixture.commands).toEqual([
      { command: "npm.cmd", argumentsList: ["ci"], options: { cwd: noutifyRoot } },
      { command: "npm.cmd", argumentsList: ["test"], options: { cwd: noutifyRoot } },
      { command: "npm.cmd", argumentsList: ["run", "typecheck"], options: { cwd: noutifyRoot } },
      { command: "npm.cmd", argumentsList: ["run", "build"], options: { cwd: noutifyRoot } },
      {
        command: "node",
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
      '{"status":"created","language":"es","topic":"Noutify-safe-topic"}\n',
    ]);
    expect(fixture.output.stdout.join("")).not.toContain("verbose child output");
    expect(fixture.output.stderr).toEqual([]);
  });

  it("rejects Node versions below 24 before running any stage", async () => {
    const fixture = createDependencies({ nodeVersion: "23.9.0" });

    const exitCode = await runInstall(["--language", "en"], fixture.dependencies);

    expect(exitCode).toBe(1);
    expect(fixture.commands).toEqual([]);
    expect(fixture.output.stderr.join("")).toContain("Node.js 24 or newer is required");
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

  it("does not report setup passed when its successful process output lacks JSON", async () => {
    const fixture = createDependencies({
      run: (command, argumentsList, options) => {
        fixture.commands.push({ command, argumentsList, options });
        return {
          status: 0,
          stdout: command === "node" ? "unexpected setup output\n" : "",
          stderr: "",
        };
      },
    });

    const exitCode = await runInstall(["--language", "en"], fixture.dependencies);

    expect(exitCode).toBe(1);
    expect(fixture.output.stdout).toEqual([
      "PASS dependencies\n",
      "PASS tests\n",
      "PASS typecheck\n",
      "PASS build\n",
    ]);
    expect(fixture.output.stderr.join("")).toContain("setup did not return a JSON result");
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
