import { isTauri } from "$lib/utils/environment";

let _consoleDetach: (() => void) | null = null;

export async function initLogger(): Promise<void> {
  if (!isTauri()) return;
  const { attachConsole } = await import("@tauri-apps/plugin-log");
  _consoleDetach = await attachConsole();
}

function noop(..._args: unknown[]): void {}

async function getLogFunctions() {
  if (!isTauri()) {
    return { info: noop, warn: noop, error: noop, debug: noop, trace: noop };
  }
  return await import("@tauri-apps/plugin-log");
}

let _logFns: Awaited<ReturnType<typeof getLogFunctions>> | null = null;

async function ensureLog() {
  if (!_logFns) {
    _logFns = await getLogFunctions();
  }
  return _logFns;
}

export const log = {
  async info(message: string): Promise<void> {
    const fns = await ensureLog();
    void fns.info(message);
  },
  async warn(message: string): Promise<void> {
    const fns = await ensureLog();
    void fns.warn(message);
  },
  async error(message: string): Promise<void> {
    const fns = await ensureLog();
    void fns.error(message);
  },
  async debug(message: string): Promise<void> {
    const fns = await ensureLog();
    void fns.debug(message);
  },
  async trace(message: string): Promise<void> {
    const fns = await ensureLog();
    void fns.trace(message);
  },
};
