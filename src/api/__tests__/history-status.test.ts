/**
 * `resolveHistoryStatus` / `aggregateLaneStatuses`（键权层方案 M5）。
 *
 * 前者是原来揉在 `parseDirEntry` 里的五分支决策树：内存活跃态 > IP 生成中/预处理中 >
 * 磁盘残留 running（僵尸态）> 用户取消旗标 > 磁盘原始值。抽成纯函数后逐条断言优先级，
 * 不必再靠通读 if/else 顺序去确认谁盖过谁。
 *
 * 后者是条目级多泳道聚合：任一泳道 running → running；全部 completed → completed；
 * 否则 → interrupted。
 */
import { describe, it, expect } from "vitest";
import { resolveHistoryStatus, aggregateLaneStatuses } from "../server.js";

describe("resolveHistoryStatus", () => {
  it("内存活跃态优先于一切——即使磁盘还是 completed", () => {
    expect(
      resolveHistoryStatus({ activeRunStatus: "running", ipJobClass: null, diskStatus: "completed" }),
    ).toBe("running");
  });

  it("IP 生成中：没有活跃态时次优先，报 running", () => {
    expect(
      resolveHistoryStatus({ activeRunStatus: undefined, ipJobClass: "generating", diskStatus: "interrupted" }),
    ).toBe("running");
  });

  it("IP 预处理中（停在确认门）：报 config，不是 running", () => {
    expect(
      resolveHistoryStatus({ activeRunStatus: undefined, ipJobClass: "preprocessing", diskStatus: "unknown" }),
    ).toBe("config");
  });

  it("磁盘残留 running（进程重启后的僵尸态）：无人再更新，判定为 interrupted", () => {
    expect(resolveHistoryStatus({ activeRunStatus: undefined, ipJobClass: null, diskStatus: "running" })).toBe(
      "interrupted",
    );
  });

  it("用户取消旗标：磁盘落的是 failed，但对作者是暂停，报 interrupted 而非 failed", () => {
    expect(
      resolveHistoryStatus({
        activeRunStatus: undefined,
        ipJobClass: null,
        diskStatus: "failed",
        cancelled: true,
      }),
    ).toBe("interrupted");
  });

  it("以上都不命中：原样透传磁盘状态", () => {
    expect(resolveHistoryStatus({ activeRunStatus: undefined, ipJobClass: null, diskStatus: "completed" })).toBe(
      "completed",
    );
    expect(resolveHistoryStatus({ activeRunStatus: undefined, ipJobClass: null, diskStatus: "failed" })).toBe(
      "failed",
    );
  });

  it("优先级次序：活跃态 > IP job 态", () => {
    expect(
      resolveHistoryStatus({ activeRunStatus: "completed", ipJobClass: "generating", diskStatus: "running" }),
    ).toBe("completed");
  });

  it("优先级次序：IP job 态 > 磁盘 running 判定", () => {
    expect(
      resolveHistoryStatus({ activeRunStatus: undefined, ipJobClass: "preprocessing", diskStatus: "running" }),
    ).toBe("config");
  });

  it("优先级次序：磁盘 running 判定 > cancelled 旗标（同时命中时前者先触发返回）", () => {
    expect(
      resolveHistoryStatus({ activeRunStatus: undefined, ipJobClass: null, diskStatus: "running", cancelled: true }),
    ).toBe("interrupted");
  });
});

describe("aggregateLaneStatuses", () => {
  it("任一泳道 running：条目级 running", () => {
    expect(aggregateLaneStatuses(["completed", "running", "interrupted"])).toBe("running");
  });

  it("全部 completed：条目级 completed", () => {
    expect(aggregateLaneStatuses(["completed", "completed"])).toBe("completed");
  });

  it("有失败有成功、没有在跑的：条目级 interrupted（不能被多数成功糊弄过去）", () => {
    expect(aggregateLaneStatuses(["completed", "failed"])).toBe("interrupted");
  });

  it("全部 failed：条目级 interrupted", () => {
    expect(aggregateLaneStatuses(["failed", "failed"])).toBe("interrupted");
  });

  it("空数组：没有泳道可聚合，报 interrupted（调用方应先判断非空再调用）", () => {
    expect(aggregateLaneStatuses([])).toBe("interrupted");
  });

  it("单一泳道 completed：等同该泳道自身状态", () => {
    expect(aggregateLaneStatuses(["completed"])).toBe("completed");
  });
});
