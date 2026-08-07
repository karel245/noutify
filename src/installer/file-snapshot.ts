import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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

async function writeFileAtomic(path: string, contents: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents);
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if (!isMissingFile(error)) throw error;
    });
  }
}

export async function snapshotFiles(paths: string[]): Promise<FileSnapshot[]> {
  return Promise.all(
    paths.map(async (path) => {
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
  snapshots: FileSnapshot[],
): Promise<void> {
  await Promise.all(
    snapshots.map(async (snapshot) => {
      if (snapshot.contents === null) {
        await unlink(snapshot.path).catch((error: unknown) => {
          if (!isMissingFile(error)) throw error;
        });
        return;
      }
      await writeFileAtomic(snapshot.path, snapshot.contents);
    }),
  );
}
