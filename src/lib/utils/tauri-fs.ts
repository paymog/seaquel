/**
 * Adapter wrapping @tauri-apps/plugin-fs and @tauri-apps/api/path.
 * All exported functions check isTauri() and no-op in browser/server mode.
 * Import from here instead of importing @tauri-apps/plugin-fs directly.
 */
import type { DirEntry, FileInfo } from "@tauri-apps/plugin-fs";
import {
  exists as fsExists,
  mkdir as fsMkdir,
  writeTextFile as fsWriteTextFile,
  writeFile as fsWriteFile,
  readTextFile as fsReadTextFile,
  readDir as fsReadDir,
  remove as fsRemove,
  rename as fsRename,
  stat as fsStat,
} from "@tauri-apps/plugin-fs";
import {
  join as pathJoin,
  dirname as pathDirname,
  tempDir as pathTempDir,
} from "@tauri-apps/api/path";
import { isTauri } from "./environment";

export type { DirEntry, FileInfo };

// Simple browser-mode path helpers (POSIX-style, used when isTauri() is false)
function browserJoin(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join("/")
    .replace(/\/+/g, "/");
}

function browserDirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : "/";
}

export async function exists(path: string): Promise<boolean> {
  if (!isTauri()) return false;
  return fsExists(path);
}

export async function mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
  if (!isTauri()) return;
  await fsMkdir(path, options);
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  if (!isTauri()) return;
  await fsWriteTextFile(path, content);
}

export async function writeFile(path: string, data: Uint8Array): Promise<void> {
  if (!isTauri()) return;
  await fsWriteFile(path, data);
}

export async function readTextFile(path: string): Promise<string> {
  if (!isTauri()) return "";
  return fsReadTextFile(path);
}

export async function readDir(path: string): Promise<DirEntry[]> {
  if (!isTauri()) return [];
  return fsReadDir(path);
}

export async function remove(path: string, options?: { recursive?: boolean }): Promise<void> {
  if (!isTauri()) return;
  await fsRemove(path, options);
}

export async function rename(from: string, to: string): Promise<void> {
  if (!isTauri()) return;
  await fsRename(from, to);
}

export async function stat(path: string): Promise<FileInfo> {
  if (!isTauri()) {
    return {
      isFile: false,
      isDirectory: false,
      isSymlink: false,
      size: 0,
      mtime: null,
      atime: null,
      birthtime: null,
      readonly: false,
      fileAttributes: null,
      dev: null,
      ino: null,
      mode: null,
      nlink: null,
      uid: null,
      gid: null,
      rdev: null,
      blksize: null,
      blocks: null,
    };
  }
  return fsStat(path);
}

export async function join(...parts: string[]): Promise<string> {
  if (!isTauri()) return browserJoin(...parts);
  return pathJoin(...parts);
}

export async function dirname(path: string): Promise<string> {
  if (!isTauri()) return browserDirname(path);
  return pathDirname(path);
}

export async function tempDir(): Promise<string> {
  if (!isTauri()) return "/tmp";
  return pathTempDir();
}
