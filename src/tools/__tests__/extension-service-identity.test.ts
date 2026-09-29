import { describe, expect, it } from "vitest";
import { foreignService, type Health } from "../../../extension/src/service.js";
import { pickBinPath } from "../../../extension/src/locate.js";

/**
 * Regression: a workshop running inside WSL was forwarded onto the Windows
 * loopback, so the plugin's health probe succeeded, `start` adopted it, and the
 * agent drove a service with a different credential for eight steps while every
 * report it printed described the one that was never launched.
 */
const health = (over: Partial<Health> = {}): Health => ({
  status: "ok", service: "narrative-studio", version: "0.2.0",
  backend: "host-agent", projectRoot: "/home/you/game", ...over,
});

describe("service identity", () => {
  it("accepts the service started for this project", () => {
    expect(foreignService(health(), { projectRoot: "/home/you/game", startedByUs: true })).toBeUndefined();
  });

  it("accepts it even without a recorded pid, since the project still matches", () => {
    expect(foreignService(health(), { projectRoot: "/home/you/game/", startedByUs: false })).toBeUndefined();
  });

  it("rejects one started for another project", () => {
    expect(foreignService(health(), { projectRoot: "/home/you/other", startedByUs: true }))
      .toContain("/home/you/game");
  });

  it("rejects one that reports no project at all", () => {
    expect(foreignService(health({ projectRoot: null }), { projectRoot: "/home/you/game", startedByUs: false }))
      .toContain("did not come from this shell");
  });

  it("keeps our own older service when a live pid vouches for it", () => {
    expect(foreignService(health({ backend: undefined, projectRoot: undefined }),
      { projectRoot: "/home/you/game", startedByUs: true })).toBeUndefined();
  });

  it("does not judge on version, which may legitimately lag the plugin", () => {
    expect(foreignService(health({ version: "0.1.9" }), { projectRoot: "/home/you/game", startedByUs: false }))
      .toBeUndefined();
  });
});

/**
 * Regression: npm's own `bin` lists `npm` before `npx`, so resolving "the
 * package's entry" instead of "the entry for this name" launched `npm-cli.js`
 * for a caller that asked for npx. Only the cold path hit it — a machine with
 * the service already installed globally never reaches npx at all.
 */
describe("bin resolution", () => {
  const npm = { npm: "bin/npm-cli.js", npx: "bin/npx-cli.js" };

  it("picks the entry for the name that was asked for", () => {
    expect(pickBinPath(npm, "npx")).toBe("bin/npx-cli.js");
    expect(pickBinPath(npm, "npm")).toBe("bin/npm-cli.js");
  });

  it("takes the only entry when a package ships one under another name", () => {
    expect(pickBinPath({ "forgeax-narrative": "dist/bin/narrative.js" }, "anything"))
      .toBe("dist/bin/narrative.js");
  });

  it("accepts the string shorthand and rejects nothing usable", () => {
    expect(pickBinPath("cli.js", "whatever")).toBe("cli.js");
    expect(pickBinPath(undefined, "npx")).toBeUndefined();
    expect(pickBinPath({}, "npx")).toBeUndefined();
  });
});
