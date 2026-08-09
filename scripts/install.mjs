#!/usr/bin/env node

import { statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const supportedLanguages = new Set(["en", "es"]);

function defaultRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

export function runProductionCommand(command, argumentsList, options, runtime = {}) {
  const spawn = runtime.spawn ?? spawnSync;
  const spawnOptions = {
    ...options,
    encoding: "utf8",
    windowsHide: true,
  };
  const platform = runtime.platform ?? process.platform;
  if (platform === "win32" && command.toLowerCase().endsWith(".cmd")) {
    const tokens = [command, ...argumentsList];
    if (tokens.some((token) => !/^[A-Za-z0-9._-]+$/.test(token))) {
      return {
        status: null,
        stdout: "",
        stderr: "unsafe command token rejected\n",
      };
    }
    return spawn(
      runtime.comSpec ?? process.env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/c", tokens.join(" ")],
      spawnOptions,
    );
  }
  return spawn(command, argumentsList, spawnOptions);
}

function defaultDependencies() {
  return {
    platform: process.platform,
    nodePath: process.execPath,
    nodeVersion: process.versions.node,
    noutifyRoot: defaultRoot(),
    isFile: (path) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    },
    run: runProductionCommand,
    writeStdout: (text) => process.stdout.write(text),
    writeStderr: (text) => process.stderr.write(text),
  };
}

export function parseArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (
      option !== "--language" &&
      option !== "--project" &&
      option !== "--agent" &&
      option !== "--memory-link"
    ) {
      throw new Error(`unknown argument: ${option}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`missing value for ${option}`);
    }
    if (option === "--language" || option === "--project") {
      const key = option.slice(2);
      if (parsed[key] !== undefined) throw new Error(`duplicate argument: ${option}`);
      parsed[key] = value;
    }
    if (option === "--agent") (parsed.agents ??= []).push(value);
    if (option === "--memory-link") (parsed.memoryLinks ??= []).push(value);
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

function isSetupRecord(value, requestedLanguage) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (!isHttpServer(value.server)) return false;
  if (value.status === "existing") {
    return (
      hasSetupKeys(value, ["status", "language", "server"]) &&
      hasValidIntegrations(value) &&
      supportedLanguages.has(value.language)
    );
  }
  return (
    value.status === "created" &&
    hasSetupKeys(value, ["status", "language", "server", "topic"]) &&
    hasValidIntegrations(value) &&
    value.language === requestedLanguage &&
    typeof value.topic === "string" &&
    /^Noutify-[23456789abcdefghjkmnpqrstuvwxyz]{12}$/.test(value.topic)
  );
}

function hasSetupKeys(value, baseKeys) {
  const keys = Object.hasOwn(value, "integrations")
    ? [...baseKeys, "integrations"]
    : baseKeys;
  return hasExactKeys(value, keys);
}

function hasValidIntegrations(value) {
  if (!Object.hasOwn(value, "integrations")) return true;
  return (
    Array.isArray(value.integrations) &&
    value.integrations.every((integration) =>
      integration !== null &&
      typeof integration === "object" &&
      !Array.isArray(integration) &&
      hasExactKeys(integration, ["agent", "mode", "status"]) &&
      typeof integration.agent === "string" &&
      (integration.mode === "native" || integration.mode === "memory") &&
      (integration.status === "installed" || integration.status === "pending")
    )
  );
}

function hasExactKeys(value, keys) {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function sanitizeSetupRecord(value) {
  return value.status === "created"
    ? {
        status: "created",
        language: value.language,
        server: value.server,
        topic: value.topic,
      }
    : {
        status: "existing",
        language: value.language,
        server: value.server,
      };
}

function isHttpServer(value) {
  if (typeof value !== "string") return false;
  try {
    const server = new URL(value);
    return server.protocol === "http:" || server.protocol === "https:";
  } catch {
    return false;
  }
}

function processDiagnostics(result, includeChildOutput) {
  let diagnostics = includeChildOutput
    ? `${result.stdout ?? ""}${result.stderr ?? ""}`
    : "";
  if (result.error && typeof result.error.message === "string") {
    diagnostics += `launch error: ${result.error.message}\n`;
  }
  if (typeof result.signal === "string" && result.signal) {
    diagnostics += `terminated by signal ${result.signal}\n`;
  }
  return diagnostics;
}

function runStage(
  dependencies,
  stage,
  command,
  argumentsList,
  cwd,
  writePass = true,
  includeChildDiagnostics = true,
) {
  const result = dependencies.run(command, argumentsList, { cwd });
  if (result.status !== 0) {
    return {
      ok: false,
      exitCode: result.status ?? 1,
      diagnostics: processDiagnostics(result, includeChildDiagnostics),
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
  if (!isAbsolute(dependencies.nodePath) || !dependencies.isFile(dependencies.nodePath)) {
    return writeFailure(dependencies, "prerequisites", 1, "The current Node.js executable is invalid.");
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
      dependencies.nodePath,
      [
        cliPath,
        "setup",
        "--project",
        target,
        "--language",
        parsed.language,
        ...(parsed.agents ?? []).flatMap((agent) => ["--agent", agent]),
        ...(parsed.memoryLinks ?? []).flatMap((link) => ["--memory-link", link]),
        "--format",
        "json",
      ],
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
      stage !== "setup",
    );
    if (!result.ok) {
      return writeFailure(dependencies, stage, result.exitCode, result.diagnostics);
    }
    if (stage === "setup") {
      const finalLine = result.stdout.trim().split(/\r?\n/).at(-1);
      let record;
      try {
        const parsedRecord = JSON.parse(finalLine);
        if (!isSetupRecord(parsedRecord, parsed.language)) throw new Error("invalid setup record");
        record = sanitizeSetupRecord(parsedRecord);
      } catch {
        return writeFailure(dependencies, "setup", 1, "invalid setup record");
      }
      dependencies.writeStdout("PASS setup\n");
      dependencies.writeStdout(`${JSON.stringify(record)}\n`);
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
