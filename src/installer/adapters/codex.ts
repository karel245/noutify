import { isAbsolute, resolve } from "node:path";

import {
  countCodexStopHooks,
  installCodexStopHook,
  uninstallCodexStopHook,
  type CodexHookCommand,
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

export function buildCodexStopHookCommand(
  projectRoot: string,
  runtime: RuntimePaths,
): CodexHookCommand {
  validateRuntimePaths(runtime);
  return {
    command: runtime.nodePath,
    args: [runtime.cliPath, "hook", "codex-stop", "--project", resolve(projectRoot)],
    timeout: 10,
  };
}

export const codexAdapter: AgentAdapter = {
  id: "codex",
  mode: "native",
  publicPath: PUBLIC_PATH,
  ownedPaths: () => [PUBLIC_PATH],
  preflight: async (context) => {
    await countCodexStopHooks(
      context.projectRoot,
      buildCodexStopHookCommand(context.projectRoot, context.runtime),
    );
  },
  install: async (context) =>
    installCodexStopHook(
      context.projectRoot,
      buildCodexStopHookCommand(context.projectRoot, context.runtime),
    ),
  inspect: async (context) => {
    const installed =
      (await countCodexStopHooks(
        context.projectRoot,
        buildCodexStopHookCommand(context.projectRoot, context.runtime),
      )) === 1;
    return {
      installed,
      detail: installed
        ? "Codex integration is installed"
        : "Codex integration is missing or modified",
    };
  },
  uninstall: async (context) =>
    uninstallCodexStopHook(
      context.projectRoot,
      buildCodexStopHookCommand(context.projectRoot, context.runtime),
    ),
};
