import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { SpawnOptions, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';

/**
 * Claude Code processes this module started and that have not exited yet. The SDK's own fallback
 * kill runs on timers that do not keep Node alive, so a program that exits right after a job can
 * leave its session behind. The exit hook below is the last resort.
 */
const live = new Set<ChildProcess>();
let exitHookInstalled = false;

/** Kills a process and, where the platform allows, everything it started (stdio MCP servers). */
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGKILL'); // the child leads its own process group (see spawn below)
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', () => {
    for (const child of live) killTree(child);
  });
}

async function within(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise.then(() => true), new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

export type ExitOutcome = 'none' | 'exited' | 'killed' | 'leaked';

/**
 * Starts the job's Claude Code process on the SDK's behalf (`spawnClaudeCodeProcess`), so the
 * runner holds its handle and can wait for it to exit. The command, arguments, working directory
 * and environment are exactly the ones the SDK chose.
 */
export class ProcessTracker {
  private child: ChildProcess | null = null;
  private exited: Promise<void> = Promise.resolve();
  private readonly onStderr: ((chunk: string) => void) | undefined;

  constructor(onStderr?: (chunk: string) => void) {
    this.onStderr = onStderr;
  }

  readonly spawner = (options: SpawnOptions): SpawnedProcess => {
    installExitHook();
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    this.child = child;
    live.add(child);
    this.exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.once('error', () => resolve());
    });
    child.once('exit', () => live.delete(child));
    child.once('error', () => live.delete(child));
    // stderr must always be drained, or a chatty process stalls on a full pipe.
    child.stderr?.on('data', (data: Buffer) => this.onStderr?.(data.toString()));
    // The SDK aborts this signal only after its own graceful close (stdin closed, a short grace).
    options.signal.addEventListener('abort', () => killTree(child), { once: true });
    return child as unknown as SpawnedProcess;
  };

  get pid(): number | undefined {
    return this.child?.pid;
  }

  /**
   * Waits for the process to exit; if it has not within `graceMs`, kills it and its children, and
   * waits `killMs` more. `leaked` means it was still there after that.
   */
  async waitForExit(graceMs: number, killMs = 3000): Promise<ExitOutcome> {
    const child = this.child;
    if (!child) return 'none';
    if (child.exitCode !== null || child.signalCode !== null) return 'exited';
    if (await within(this.exited, graceMs)) return 'exited';
    killTree(child);
    return (await within(this.exited, killMs)) ? 'killed' : 'leaked';
  }
}
