import { describe, expect, it } from "vitest";
import { createIdleShutdown } from "../idle-shutdown.js";

/** Drives the clock by hand so the tests say nothing about wall time. */
function harness(options: { timeoutMs: number; busy?: () => boolean }) {
  let now = 0;
  const exits: number[] = [];
  const guard = createIdleShutdown({
    timeoutMs: options.timeoutMs,
    busy: options.busy ?? (() => false),
    now: () => now,
    exit: (code) => exits.push(code),
  });
  return { guard, exits, advance: (ms: number) => { now += ms; } };
}

describe("idle shutdown", () => {
  it("exits once the timeout passes with no traffic", () => {
    const { guard, exits, advance } = harness({ timeoutMs: 1000 });
    advance(999);
    expect(guard.tick()).toBe(false);
    advance(1);
    expect(guard.tick()).toBe(true);
    expect(exits).toEqual([0]);
  });

  it("does not exit while a request is in flight, however long it takes", () => {
    const { guard, exits, advance } = harness({ timeoutMs: 1000 });
    guard.enter();
    advance(60_000);
    expect(guard.tick()).toBe(false);
    expect(exits).toEqual([]);
  });

  it("restarts the countdown when the last request finishes", () => {
    const { guard, advance } = harness({ timeoutMs: 1000 });
    guard.enter();
    advance(5000);
    guard.leave();
    advance(999);
    expect(guard.tick()).toBe(false);
    advance(1);
    expect(guard.tick()).toBe(true);
  });

  it("stays alive through a long pipeline run that sends no requests", () => {
    let running = true;
    const { guard, advance } = harness({ timeoutMs: 1000, busy: () => running });
    advance(600_000);
    expect(guard.tick()).toBe(false);
    // The run ending is activity, so the full timeout still applies afterwards.
    running = false;
    expect(guard.tick()).toBe(false);
    advance(1000);
    expect(guard.tick()).toBe(true);
  });

  it("tolerates a response that emits both finish and close", () => {
    const { guard, advance } = harness({ timeoutMs: 1000 });
    guard.enter();
    guard.leave();
    guard.leave();
    guard.enter();
    advance(2000);
    expect(guard.tick()).toBe(false);
  });
});
