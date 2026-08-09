import { isAbsolute, resolve } from "node:path";

import { assertSafeProjectPath } from "../../core/project-path.js";
import { ensureIgnoreRules } from "../../config/project-config.js";
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

const LOCAL_SETTINGS_PATH = ".github/copilot/settings.local.json";
export const COPILOT_LOCAL_SETTINGS = "/.github/copilot/settings.local.json";

interface CopilotCommandHandler {
  type: "command";
  powershell: string;
  timeoutSec: 10;
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

export function buildCopilotAgentStopHookCommand(
  projectRoot: string,
  runtime: RuntimePaths,
): string {
  validateRuntimePaths(runtime);
  const argumentsList = [
    runtime.nodePath,
    runtime.cliPath,
    "hook",
    "copilot-agent-stop",
    "--project",
    resolve(projectRoot),
  ];
  const script = `& ${argumentsList
    .map(quotePowerShellArgument)
    .join(" ")}; exit $LASTEXITCODE`;
  return `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
}

function isOwnedHandler(value: unknown, powershell: string): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).length === 3 &&
    value.type === "command" &&
    value.powershell === powershell &&
    value.timeoutSec === 10
  );
}

function hookSpec(context: AdapterContext): JsonHookFileSpec<CopilotCommandHandler> {
  const powershell = buildCopilotAgentStopHookCommand(
    context.projectRoot,
    context.runtime,
  );
  return {
    relativePath: LOCAL_SETTINGS_PATH,
    arrayPath: ["hooks", "agentStop"],
    owned: { type: "command", powershell, timeoutSec: 10 },
    isOwned: (value) => isOwnedHandler(value, powershell),
    errorLabel: "Copilot local settings",
  };
}

export const copilotCliAdapter: AgentAdapter = {
  id: "copilot-cli",
  mode: "native",
  publicPath: LOCAL_SETTINGS_PATH,
  ownedPaths: () => [LOCAL_SETTINGS_PATH],
  preflight: async (context) => {
    await assertSafeProjectPath(
      context.projectRoot,
      resolve(context.projectRoot, ".gitignore"),
    );
    await preflightJsonHook(context.projectRoot, hookSpec(context));
  },
  install: async (context) => {
    const mutation = await installJsonHook(
      context.projectRoot,
      hookSpec(context),
    );
    await ensureIgnoreRules(context.projectRoot, [COPILOT_LOCAL_SETTINGS]);
    return mutation;
  },
  inspect: async (context) => {
    const inspection = await inspectJsonHook(
      context.projectRoot,
      hookSpec(context),
    );
    return {
      installed: inspection.installed,
      detail: inspection.installed
        ? "GitHub Copilot CLI integration is installed"
        : "GitHub Copilot CLI integration is missing or modified",
    };
  },
  uninstall: async (context) =>
    uninstallJsonHook(context.projectRoot, hookSpec(context)),
};
