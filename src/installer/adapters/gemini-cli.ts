import { isAbsolute, resolve } from "node:path";

import {
  inspectJsonHook,
  installJsonHook,
  preflightJsonHook,
  uninstallJsonHook,
  type JsonHookFileSpec,
} from "../json-hook-file.js";
import type {
  AdapterContext,
  AgentAdapter,
  RuntimePaths,
} from "../agent-adapter.js";

const PUBLIC_PATH = ".gemini/settings.json";

interface GeminiCommandHandler {
  type: "command";
  command: string;
  timeout: 10000;
}

interface GeminiHookDefinition {
  hooks: [GeminiCommandHandler];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function quotePowerShellArgument(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function validateRuntimePaths(runtime: RuntimePaths): void {
  if (!isAbsolute(runtime.nodePath)) {
    throw new Error("runtime nodePath must be absolute");
  }
  if (!isAbsolute(runtime.cliPath)) {
    throw new Error("runtime cliPath must be absolute");
  }
}

export function buildGeminiAfterAgentHookCommand(
  projectRoot: string,
  runtime: RuntimePaths,
): string {
  validateRuntimePaths(runtime);
  const argumentsList = [
    runtime.nodePath,
    runtime.cliPath,
    "hook",
    "gemini-after-agent",
    "--project",
    resolve(projectRoot),
  ];
  const script = `& ${argumentsList
    .map(quotePowerShellArgument)
    .join(" ")}; exit $LASTEXITCODE`;
  return `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
}

function isOwnedHandler(value: unknown, command: string): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).length === 3 &&
    value.type === "command" &&
    value.command === command &&
    value.timeout === 10000
  );
}

function isOwnedDefinition(value: unknown, command: string): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    Array.isArray(value.hooks) &&
    value.hooks.length === 1 &&
    isOwnedHandler(value.hooks[0], command)
  );
}

function hookSpec(context: AdapterContext): JsonHookFileSpec<GeminiHookDefinition> {
  const command = buildGeminiAfterAgentHookCommand(
    context.projectRoot,
    context.runtime,
  );
  return {
    relativePath: PUBLIC_PATH,
    arrayPath: ["hooks", "AfterAgent"],
    owned: {
      hooks: [{ type: "command", command, timeout: 10000 }],
    },
    isOwned: (value) => isOwnedDefinition(value, command),
    errorLabel: "Gemini settings",
  };
}

export const geminiCliAdapter: AgentAdapter = {
  id: "gemini-cli",
  mode: "native",
  publicPath: PUBLIC_PATH,
  ownedPaths: () => [PUBLIC_PATH],
  preflight: async (context) => {
    await preflightJsonHook(context.projectRoot, hookSpec(context));
  },
  install: async (context) =>
    installJsonHook(context.projectRoot, hookSpec(context)),
  inspect: async (context) => {
    const inspection = await inspectJsonHook(
      context.projectRoot,
      hookSpec(context),
    );
    return {
      installed: inspection.installed,
      detail: inspection.installed
        ? "Gemini CLI integration is installed"
        : "Gemini CLI integration is missing or modified",
    };
  },
  uninstall: async (context) =>
    uninstallJsonHook(context.projectRoot, hookSpec(context)),
};
