import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  assertSafeProjectPath,
  assertSafeProjectPaths,
} from "../core/project-path.js";

export interface FileSnapshot {
  path: string;
  contents: Uint8Array | null;
}

function isMissingFile(error: unknown): error is { code: "ENOENT" } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function writeFileAtomic(
  projectRoot: string,
  path: string,
  contents: Uint8Array,
): Promise<void> {
  await assertSafeProjectPath(projectRoot, path);
  await mkdir(dirname(path), { recursive: true });
  await assertSafeProjectPath(projectRoot, path);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await assertSafeProjectPath(projectRoot, temporaryPath);
    await writeFile(temporaryPath, contents);
    await assertSafeProjectPath(projectRoot, temporaryPath);
    await assertSafeProjectPath(projectRoot, path);
    await rename(temporaryPath, path);
  } finally {
    await assertSafeProjectPath(projectRoot, temporaryPath);
    await unlink(temporaryPath).catch((error: unknown) => {
      if (!isMissingFile(error)) throw error;
    });
  }
}

export async function snapshotFiles(
  projectRoot: string,
  paths: string[],
): Promise<FileSnapshot[]> {
  await assertSafeProjectPaths(projectRoot, paths);
  return Promise.all(
    paths.map(async (path) => {
      await assertSafeProjectPath(projectRoot, path);
      try {
        return { path, contents: await readFile(path) };
      } catch (error) {
        if (isMissingFile(error)) {
          return { path, contents: null };
        }
        throw error;
      }
    }),
  );
}

export async function restoreFileSnapshots(
  projectRoot: string,
  snapshots: FileSnapshot[],
): Promise<void> {
  await assertSafeProjectPaths(
    projectRoot,
    snapshots.map((snapshot) => snapshot.path),
  );
  await Promise.all(
    snapshots.map(async (snapshot) => {
      if (snapshot.contents === null) {
        await assertSafeProjectPath(projectRoot, snapshot.path);
        await unlink(snapshot.path).catch((error: unknown) => {
          if (!isMissingFile(error)) throw error;
        });
        return;
      }
      await writeFileAtomic(projectRoot, snapshot.path, snapshot.contents);
    }),
  );
}
