import { describe, expect, it } from "vitest";
import {
  artifactRunDir,
  parseArtifactRef,
  resolveArtifactAddress,
  type RunAnchor,
} from "../artifact-address.js";

describe("artifactRunDir", () => {
  it("keeps the primary pipeline at the entry root", () => {
    expect(artifactRunDir({ entryKey: "draft-1" })).toBe("draft-1");
  });

  it("nests secondary pipelines under pipelines/", () => {
    expect(artifactRunDir({ entryKey: "draft-1", pipelineId: "pipe-abc" })).toBe(
      "draft-1/pipelines/pipe-abc",
    );
  });
});

describe("parseArtifactRef", () => {
  it("round-trips both layouts", () => {
    expect(parseArtifactRef("draft-1")).toEqual({ entryKey: "draft-1" });
    expect(parseArtifactRef("draft-1/pipelines/pipe-abc")).toEqual({
      entryKey: "draft-1",
      pipelineId: "pipe-abc",
    });
  });

  it("rejects traversal and unknown shapes", () => {
    for (const bad of ["../etc", "a/b", "a/b/c/d", "a/wrong/c", "", ".."]) {
      expect(parseArtifactRef(bad)).toBeNull();
    }
  });
});

describe("resolveArtifactAddress", () => {
  it("treats a plain entry key as the primary pipeline", () => {
    expect(resolveArtifactAddress({ ref: "draft-1" })).toEqual({
      entryKey: "draft-1",
      pipelineId: undefined,
      stepId: undefined,
      nodeId: undefined,
      version: undefined,
    });
  });

  it("reads entryKey off a secondary pipeline dir rather than the last segment", () => {
    const addr = resolveArtifactAddress({ ref: "draft-1/pipelines/pipe-abc" });
    // 关键回归：basename 会把 pipelineId 当 entryKey。
    expect(addr?.entryKey).toBe("draft-1");
    expect(addr?.pipelineId).toBe("pipe-abc");
  });

  it("translates a live runId through its source dir", () => {
    const anchors: Record<string, RunAnchor> = {
      run_1: { sourceDir: "draft-1/pipelines/pipe-abc", entryKey: "draft-1" },
    };
    const addr = resolveArtifactAddress({
      ref: "run_1",
      lookupRun: (id) => anchors[id],
    });
    expect(addr).toMatchObject({ entryKey: "draft-1", pipelineId: "pipe-abc" });
  });

  it("does not invent an address for a dead runId", () => {
    // runId 形态里带下划线与点，parseRunDirName 视为合法单段，故会被当磁盘键。
    // 这是刻意的兼容行为：真读不到时由落盘侧回 404，而不是在这里猜。
    expect(resolveArtifactAddress({ ref: "run_1", lookupRun: () => undefined })).toEqual({
      entryKey: "run_1",
      pipelineId: undefined,
      stepId: undefined,
      nodeId: undefined,
      version: undefined,
    });
  });

  it("lets an explicit pipelineId override the parsed lane", () => {
    const addr = resolveArtifactAddress({
      ref: "draft-1",
      pipelineId: "pipe-xyz",
      stepId: "worldview",
      nodeId: "1_1_1",
      version: 2,
    });
    expect(addr).toEqual({
      entryKey: "draft-1",
      pipelineId: "pipe-xyz",
      stepId: "worldview",
      nodeId: "1_1_1",
      version: 2,
    });
  });

  it("ignores blank and non-integer refinements", () => {
    const addr = resolveArtifactAddress({
      ref: "draft-1",
      pipelineId: "  ",
      stepId: "",
      version: Number.NaN,
    });
    expect(addr).toEqual({
      entryKey: "draft-1",
      pipelineId: undefined,
      stepId: undefined,
      nodeId: undefined,
      version: undefined,
    });
  });

  it("refuses malformed refs outright", () => {
    expect(resolveArtifactAddress({ ref: "../../etc/passwd" })).toBeNull();
    expect(resolveArtifactAddress({ ref: "" })).toBeNull();
  });
});
