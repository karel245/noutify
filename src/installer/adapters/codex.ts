import { isAbsolute, resolve } from "node:path";

import {
  countCodexStopHooks,
  installCodexStopHook,
  uninstallCodexStopHook,
  type CodexHookCommand,
  type LegacyCodexHookCommand,
} from "../codex-hooks.js";
import type {
  AdapterContext,
  AgentAdapter,
  RuntimePaths,
} from "../agent-adapter.js";

const PUBLIC_PATH = ".codex/hooks.json";

function validateRuntimePaths(runtime: RuntimePaths): void {
  if (!isAbsolute(runtime.nodePath)) {
    throw new Error("runtime nodePath must be absolute");
  }
  if (!isAbsolute(runtime.cliPath)) {
    throw new Error("runtime cliPath must be absolute");
  }
}

function quotePortableArgument(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function quotePowerShellArgument(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildCodexStopHookCommand(
  projectRoot: string,
  runtime: RuntimePaths,
): CodexHookCommand {
  validateRuntimePaths(runtime);
  const argumentsList = [
    runtime.nodePath,
    runtime.cliPath,
    "hook",
    "codex-stop",
    "--project",
    resolve(projectRoot),
  ];
  const windowsScript = `& ${argumentsList
    .map(quotePowerShellArgument)
    .join(" ")}; exit $LASTEXITCODE`;
  return {
    type: "command",
    command: argumentsList.map(quotePortableArgument).join(" "),
    commandWindows:
      `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(windowsScript, "utf16le").toString("base64")}`,
  };
}

export function buildLegacyCodexStopHookCommand(
  projectRoot: string,
  runtime: RuntimePaths,
): LegacyCodexHookCommand {
  validateRuntimePaths(runtime);
  return {
    command: runtime.nodePath,
    args: [
      runtime.cliPath,
      "hook",
      "codex-stop",
      "--project",
      resolve(projectRoot),
    ],
    timeout: 10,
  };
}

function commands(context: AdapterContext): {
  current: CodexHookCommand;
  legacy: LegacyCodexHookCommand;
} {
  return {
    current: buildCodexStopHookCommand(context.projectRoot, context.runtime),
    legacy: buildLegacyCodexStopHookCommand(context.projectRoot, context.runtime),
  };
}

export const codexAdapter: AgentAdapter = {
  id: "codex",
  mode: "native",
  publicPath: PUBLIC_PATH,
  ownedPaths: () => [PUBLIC_PATH],
  preflight: async (context) => {
    const hook = commands(context);
    await countCodexStopHooks(
      context.projectRoot,
      hook.current,
      [hook.legacy],
    );
  },
  install: async (context) => {
    const hook = commands(context);
    return installCodexStopHook(
      context.projectRoot,
      hook.current,
      [hook.legacy],
    );
  },
  inspect: async (context) => {
    const hook = commands(context);
    const [currentCount, ownedCount] = await Promise.all([
      countCodexStopHooks(context.projectRoot, hook.current),
      countCodexStopHooks(context.projectRoot, hook.current, [hook.legacy]),
    ]);
    const installed = currentCount === 1 && ownedCount === currentCount;
    return {
      installed,
      detail: installed
        ? "Codex integration is installed"
        : "Codex integration is missing or modified",
    };
  },
  uninstall: async (context) => {
    const hook = commands(context);
    return uninstallCodexStopHook(
      context.projectRoot,
      hook.current,
      [hook.legacy],
    );
  },
};
