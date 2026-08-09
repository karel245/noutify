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

const PUBLIC_PATH = ".windsurf/hooks.json";

interface WindsurfHookEntry {
  command: string;
  show_output: false;
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

export function buildWindsurfPostResponseHookCommand(
  projectRoot: string,
  runtime: RuntimePaths,
): string {
  validateRuntimePaths(runtime);
  const argumentsList = [
    runtime.nodePath,
    runtime.cliPath,
    "hook",
    "windsurf-post-response",
    "--project",
    resolve(projectRoot),
  ];
  const script = `& ${argumentsList
    .map(quotePowerShellArgument)
    .join(" ")}; exit $LASTEXITCODE`;
  return `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
}

function isOwnedEntry(value: unknown, command: string): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    value.command === command &&
    value.show_output === false
  );
}

function hookSpec(
  context: AdapterContext,
): JsonHookFileSpec<WindsurfHookEntry> {
  const command = buildWindsurfPostResponseHookCommand(
    context.projectRoot,
    context.runtime,
  );
  return {
    relativePath: PUBLIC_PATH,
    arrayPath: ["hooks", "post_cascade_response"],
    owned: { command, show_output: false },
    isOwned: (value) => isOwnedEntry(value, command),
    errorLabel: "Windsurf hooks",
  };
}

export const windsurfAdapter: AgentAdapter = {
  id: "windsurf",
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
        ? "Windsurf integration is installed"
        : "Windsurf integration is missing or modified",
    };
  },
  uninstall: async (context) =>
    uninstallJsonHook(context.projectRoot, hookSpec(context)),
};
