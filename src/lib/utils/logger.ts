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

function formatMessage(message: string, error?: unknown): string {
  if (error === undefined) return message;
  const detail = error instanceof Error ? error.message : JSON.stringify(error);
  return `${message} ${detail}`;
}

export const log = {
  async info(message: string, error?: unknown): Promise<void> {
    const fns = await ensureLog();
    void fns.info(formatMessage(message, error));
  },
  async warn(message: string, error?: unknown): Promise<void> {
    const fns = await ensureLog();
    void fns.warn(formatMessage(message, error));
  },
  async error(message: string, error?: unknown): Promise<void> {
    const fns = await ensureLog();
    void fns.error(formatMessage(message, error));
  },
  async debug(message: string, error?: unknown): Promise<void> {
    const fns = await ensureLog();
    void fns.debug(formatMessage(message, error));
  },
  async trace(message: string, error?: unknown): Promise<void> {
    const fns = await ensureLog();
    void fns.trace(formatMessage(message, error));
  },
};
