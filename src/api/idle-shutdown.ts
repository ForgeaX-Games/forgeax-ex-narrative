import type { Express, NextFunction, Request, Response } from "express";

/**
 * A workshop started by the extension is an orphan by design: the extension CLI
 * is one-shot and exits the moment it has spawned us, so nothing upstream will
 * ever reap this process. Without a self-imposed deadline it would hold port
 * 8900 until the machine reboots.
 *
 * Idle means no HTTP traffic *and* no pipeline still running. A generation run
 * goes minutes between requests, and exiting under one would destroy the work.
 */
export interface IdleShutdownOptions {
  /** Zero or negative disables self-shutdown entirely (the Studio-hosted case). */
  timeoutMs: number;
  /** True while background work must not be interrupted. */
  busy: () => boolean;
  now?: () => number;
  exit?: (code: number) => void;
}

export interface IdleShutdown {
  enter: () => void;
  leave: () => void;
  /** Returns true when this tick decided to exit. */
  tick: () => boolean;
}

export function createIdleShutdown(options: IdleShutdownOptions): IdleShutdown {
  const now = options.now ?? Date.now;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let lastActive = now();
  let inFlight = 0;

  return {
    enter() {
      inFlight++;
      lastActive = now();
    },
    leave() {
      inFlight = Math.max(0, inFlight - 1);
      lastActive = now();
    },
    tick() {
      // Being busy counts as activity, so the countdown restarts once the run
      // ends rather than firing the instant it does.
      if (inFlight > 0 || options.busy()) {
        lastActive = now();
        return false;
      }
      if (now() - lastActive < options.timeoutMs) return false;
      exit(0);
      return true;
    },
  };
}

/**
 * Registers the activity middleware and the polling timer. Must be called
 * before any route is declared, otherwise matched routes short-circuit past it.
 */
export function installIdleShutdown(
  app: Express,
  options: IdleShutdownOptions & { intervalMs?: number },
): IdleShutdown | undefined {
  if (!(options.timeoutMs > 0)) return undefined;
  const guard = createIdleShutdown(options);

  app.use((_req: Request, res: Response, next: NextFunction) => {
    guard.enter();
    // `finish` and `close` both fire for a normal response; leave exactly once.
    let left = false;
    const leave = () => {
      if (left) return;
      left = true;
      guard.leave();
    };
    res.on("finish", leave);
    res.on("close", leave);
    next();
  });

  const timer = setInterval(() => guard.tick(), options.intervalMs ?? 30_000);
  // Never let the countdown be the only thing keeping the event loop alive.
  timer.unref?.();
  return guard;
}
