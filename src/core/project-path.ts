import { lstat, realpath } from "node:fs/promises";
import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function comparablePath(value: string): string {
  const normalized = resolve(value).replace(/^\\\\\?\\/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function projectTarget(projectRoot: string, target: string): {
  root: string;
  absolutePath: string;
  segments: string[];
} {
  const root = resolve(projectRoot);
  const absolutePath = isAbsolute(target) ? resolve(target) : resolve(root, target);
  const back = relative(root, absolutePath);
  if (
    back === "" ||
    back === ".." ||
    back.startsWith(`..${sep}`) ||
    isAbsolute(back)
  ) {
    throw new Error("unsafe project path must remain inside the project");
  }
  return { root, absolutePath, segments: back.split(sep) };
}

async function assertNotLinked(path: string): Promise<"missing" | "present"> {
  let stat;
  try {
    stat = await lstat(path);
  } catch (error) {
    if (isMissing(error)) return "missing";
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new Error("unsafe project path crosses a symbolic link or junction");
  }
  if (process.platform === "win32") {
    const canonical = await realpath(path);
    if (comparablePath(canonical) !== comparablePath(path)) {
      throw new Error("unsafe project path crosses a reparse point");
    }
  }
  return "present";
}

export async function assertSafeProjectPath(
  projectRoot: string,
  target: string,
): Promise<string> {
  const { root, absolutePath, segments } = projectTarget(projectRoot, target);
  const rootState = await assertNotLinked(root);
  if (rootState === "missing") {
    throw new Error("project root must be an existing directory");
  }
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory()) {
    throw new Error("project root must be a directory");
  }

  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    if ((await assertNotLinked(current)) === "missing") break;
  }
  return absolutePath;
}

export async function assertSafeProjectPaths(
  projectRoot: string,
  targets: readonly string[],
): Promise<string[]> {
  return Promise.all(
    targets.map((target) => assertSafeProjectPath(projectRoot, target)),
  );
}
