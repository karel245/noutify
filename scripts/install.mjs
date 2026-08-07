#!/usr/bin/env node

import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const supportedLanguages = new Set(["en", "es"]);

function defaultRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function defaultDependencies() {
  return {
    platform: process.platform,
    nodeVersion: process.versions.node,
    noutifyRoot: defaultRoot(),
    isFile: (path) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    },
    run: (command, argumentsList, options) =>
      spawnSync(command, argumentsList, { ...options, encoding: "utf8" }),
    writeStdout: (text) => process.stdout.write(text),
    writeStderr: (text) => process.stderr.write(text),
  };
}

export function parseArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option !== "--language" && option !== "--project") {
      throw new Error(`unknown argument: ${option}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`missing value for ${option}`);
    }
    if (option === "--language") parsed.language = value;
    if (option === "--project") parsed.project = value;
    index += 1;
  }
  return parsed;
}

function writeFailure(dependencies, stage, status, diagnostics = "") {
  dependencies.writeStderr(`FAIL ${stage} (exit ${status})\n`);
  if (diagnostics) {
    dependencies.writeStderr(diagnostics.endsWith("\n") ? diagnostics : `${diagnostics}\n`);
  }
  dependencies.writeStderr("See Noutify/docs/setup-troubleshooting.md\n");
  return 1;
}

function sourceIsValid(root, isFile) {
  return ["package.json", "package-lock.json", join("src", "cli.ts")].every((file) =>
    isFile(join(root, file)),
  );
}

function isSetupRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (!supportedLanguages.has(value.language) || typeof value.server !== "string") return false;
  if (value.status === "existing") return true;
  return value.status === "created" && typeof value.topic === "string";
}

function runStage(dependencies, stage, command, argumentsList, cwd, writePass = true) {
  const result = dependencies.run(command, argumentsList, { cwd });
  if (result.status !== 0) {
    return {
      ok: false,
      exitCode: result.status ?? 1,
      diagnostics: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    };
  }
  if (writePass) dependencies.writeStdout(`PASS ${stage}\n`);
  return {
    ok: true,
    stdout: String(result.stdout ?? ""),
    diagnostics: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

export async function runInstall(argv, suppliedDependencies = {}) {
  const dependencies = { ...defaultDependencies(), ...suppliedDependencies };
  let parsed;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    return writeFailure(
      dependencies,
      "arguments",
      1,
      error instanceof Error ? error.message : "invalid arguments",
    );
  }

  if (dependencies.platform !== "win32") {
    return writeFailure(dependencies, "prerequisites", 1, "Noutify setup requires Windows.");
  }
  if (Number.parseInt(dependencies.nodeVersion, 10) < 24) {
    return writeFailure(dependencies, "prerequisites", 1, "Node.js 24 or newer is required.");
  }
  if (!sourceIsValid(dependencies.noutifyRoot, dependencies.isFile)) {
    return writeFailure(dependencies, "prerequisites", 1, "Noutify source files are incomplete.");
  }
  if (!supportedLanguages.has(parsed.language)) {
    return writeFailure(dependencies, "arguments", 1, `unsupported language: ${parsed.language ?? ""}`);
  }

  const target = parsed.project ?? dirname(dependencies.noutifyRoot);
  const cliPath = join(dependencies.noutifyRoot, "dist", "cli.js");
  const stages = [
    ["dependencies", "npm.cmd", ["ci"]],
    ["tests", "npm.cmd", ["test"]],
    ["typecheck", "npm.cmd", ["run", "typecheck"]],
    ["build", "npm.cmd", ["run", "build"]],
    [
      "setup",
      "node",
      [cliPath, "setup", "--project", target, "--language", parsed.language, "--format", "json"],
    ],
  ];

  for (const [stage, command, argumentsList] of stages) {
    const result = runStage(
      dependencies,
      stage,
      command,
      argumentsList,
      dependencies.noutifyRoot,
      stage !== "setup",
    );
    if (!result.ok) {
      return writeFailure(dependencies, stage, result.exitCode, result.diagnostics);
    }
    if (stage === "setup") {
      const finalLine = result.stdout.trim().split(/\r?\n/).at(-1);
      try {
        if (!isSetupRecord(JSON.parse(finalLine))) throw new Error("invalid setup record");
      } catch {
        return writeFailure(dependencies, "setup", 1, result.diagnostics);
      }
      dependencies.writeStdout("PASS setup\n");
      dependencies.writeStdout(`${finalLine}\n`);
    }
  }
  return 0;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  runInstall(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
