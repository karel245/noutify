#!/usr/bin/env node

import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { readProjectConfig } from "./config/project-config.js";
import { normalizeNotificationLanguage } from "./config/language.js";
import { handleClaudeStop } from "./agents/claude-code/stop.js";
import type { Notification } from "./core/types.js";
import {
  confirmProject,
  doctorProject,
  setProjectLanguage,
  setupProject,
  testProject,
  uninstallProject,
  type NotificationSender,
} from "./installer/setup.js";
import { sendNtfy, type SendResult } from "./providers/ntfy.js";

export interface CliIo {
  readStdin: () => Promise<string>;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
}

export interface CliDependencies {
  nodePath?: string;
  cliPath?: string;
  send?: NotificationSender;
}

const HELP = `Noutify Phase 0

Commands: setup | test | confirm | doctor | uninstall | language

  noutify setup [--project PATH] [--server URL] [--topic TOPIC] [--language LANGUAGE] [--format json]
  noutify language <language> [--project PATH]
  noutify test [--project PATH]
  noutify confirm [--project PATH]
  noutify doctor [--project PATH]
  noutify uninstall [--project PATH]
`;

async function readProcessStdin(): Promise<string> {
  let input = "";
  for await (const chunk of process.stdin) {
    input += String(chunk);
  }
  return input;
}

const defaultIo: CliIo = {
  readStdin: readProcessStdin,
  writeStdout: (text) => process.stdout.write(`${text}\n`),
  writeStderr: (text) => process.stderr.write(`${text}\n`),
};

interface ParsedArguments {
  command: string;
  subcommand?: string;
  operands: string[];
  options: Map<string, string>;
}

function parseArguments(argv: string[]): ParsedArguments {
  const [command = "--help", ...tokens] = argv;
  let subcommand: string | undefined;
  let argumentTokens = tokens;

  if (command === "hook" && tokens[0] && !tokens[0].startsWith("--")) {
    subcommand = tokens[0];
    argumentTokens = tokens.slice(1);
  }

  const options = new Map<string, string>();
  const operands: string[] = [];
  for (let index = 0; index < argumentTokens.length; index += 1) {
    const token = argumentTokens[index];
    if (token === undefined) break;
    if (!token.startsWith("--")) {
      operands.push(token);
      continue;
    }
    const value = argumentTokens[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`invalid option near ${token}`);
    }
    options.set(token.slice(2), value);
    index += 1;
  }

  const parsed: ParsedArguments = { command, operands, options };
  if (subcommand !== undefined) parsed.subcommand = subcommand;
  return parsed;
}

function validateOptions(parsed: ParsedArguments): void {
  const allowedByCommand: Record<string, readonly string[]> = {
    setup: ["project", "server", "topic", "language", "format"],
    language: ["project"],
    test: ["project"],
    confirm: ["project"],
    doctor: ["project"],
    uninstall: ["project"],
    hook: ["project"],
    help: [],
    "--help": [],
    "-h": [],
  };
  const allowed = allowedByCommand[parsed.command] ?? [];
  const unexpected = [...parsed.options.keys()].find(
    (option) => !allowed.includes(option),
  );
  if (unexpected !== undefined) {
    throw new Error(`unknown option --${unexpected} for ${parsed.command}`);
  }
  if (parsed.command === "setup" && parsed.options.get("format") !== undefined && parsed.options.get("format") !== "json") {
    throw new Error("setup format must be json");
  }
  if (parsed.command === "language") {
    if (parsed.operands.length !== 1) {
      throw new Error("language requires exactly one language");
    }
  } else if (parsed.operands.length > 0) {
    throw new Error(`unexpected operand ${parsed.operands[0]} for ${parsed.command}`);
  }
}

function phaseZeroDependencies(dependencies: CliDependencies) {
  return {
    nodePath: dependencies.nodePath ?? process.execPath,
    cliPath: dependencies.cliPath ?? fileURLToPath(import.meta.url),
    send: dependencies.send ?? sendNtfy,
  };
}

async function runClaudeStopHook(
  projectRoot: string,
  io: CliIo,
  sender: NotificationSender,
): Promise<number> {
  try {
    const [input, bundle] = await Promise.all([
      io.readStdin(),
      readProjectConfig(projectRoot),
    ]);
    if (!bundle.private.setupCompleted || !bundle.public.events.waiting) {
      return 0;
    }
    await handleClaudeStop(input, {
      projectName: bundle.public.project.name,
      language: bundle.private.language,
      send: (notification) => sender(notification, bundle.private),
    });
  } catch {
    // Internal hooks must be silent and non-blocking under every failure mode.
  }
  return 0;
}

export async function runCli(
  argv: string[],
  io: CliIo = defaultIo,
  dependencies: CliDependencies = {},
): Promise<number> {
  let parsed: ParsedArguments;
  try {
    parsed = parseArguments(argv);
    validateOptions(parsed);
  } catch (error) {
    if (argv[0] === "hook") {
      return 0;
    }
    io.writeStderr(error instanceof Error ? error.message : "invalid arguments");
    return 1;
  }

  const runtime = phaseZeroDependencies(dependencies);
  const projectRoot = resolve(parsed.options.get("project") ?? process.cwd());

  try {
    switch (parsed.command) {
      case "--help":
      case "-h":
      case "help":
        io.writeStdout(HELP);
        return 0;
      case "setup": {
        const input: Parameters<typeof setupProject>[0] = {
          projectRoot,
          nodePath: runtime.nodePath,
          cliPath: runtime.cliPath,
        };
        const server = parsed.options.get("server");
        const topic = parsed.options.get("topic");
        const language = parsed.options.get("language");
        if (server !== undefined) input.server = server;
        if (topic !== undefined) input.topic = topic;
        if (language !== undefined) input.language = normalizeNotificationLanguage(language);
        const result = await setupProject(input);
        if (parsed.options.get("format") === "json") {
          io.writeStdout(JSON.stringify(
            result.created
              ? {
                  status: "created",
                  language: result.language,
                  server: result.server,
                  topic: result.topic,
                }
              : {
                  status: "existing",
                  language: result.language,
                  server: result.server,
                },
          ));
        } else {
          io.writeStdout(
            result.created
              ? `Noutify installed. Subscribe your phone to topic: ${result.topic}`
              : "Noutify is already configured; the Stop hook is ready.",
          );
          io.writeStdout("Run `noutify test` after subscribing your phone.");
        }
        return 0;
      }
      case "language": {
        const value = parsed.operands[0];
        if (value === undefined) {
          throw new Error("language requires exactly one language");
        }
        const language = await setProjectLanguage(projectRoot, value);
        io.writeStdout(
          language === "es"
            ? "Idioma de notificaciones actualizado a español."
            : "Notification language updated to English.",
        );
        return 0;
      }
      case "test": {
        const result = await testProject(projectRoot, runtime.send);
        if (!result.ok) {
          io.writeStderr(
            `Test notification failed after ${result.attempts} attempt(s).`,
          );
          return 1;
        }
        io.writeStdout(
          "Test notification sent. If it arrived, run `noutify confirm`.",
        );
        return 0;
      }
      case "confirm":
        await confirmProject(projectRoot);
        io.writeStdout("Phone receipt confirmed. Noutify setup is active.");
        return 0;
      case "doctor": {
        const result = await doctorProject(projectRoot, runtime);
        for (const check of result.checks) {
          io.writeStdout(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.message}`);
        }
        return result.ok ? 0 : 1;
      }
      case "uninstall": {
        const result = await uninstallProject(projectRoot, runtime);
        io.writeStdout(
          result.changed
            ? "Noutify hook removed; configuration was preserved."
            : "No matching Noutify hook was installed; configuration was preserved.",
        );
        return 0;
      }
      case "hook":
        if (parsed.subcommand === "claude-stop") {
          return runClaudeStopHook(projectRoot, io, runtime.send);
        }
        return 0;
      default:
        io.writeStderr(`Unknown command: ${parsed.command}`);
        return 1;
    }
  } catch (error) {
    if (parsed.command !== "hook") {
      io.writeStderr(error instanceof Error ? error.message : "Noutify command failed");
    }
    return parsed.command === "hook" ? 0 : 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  runCli(process.argv.slice(2)).then((exitCode: number) => {
    process.exitCode = exitCode;
  });
}
