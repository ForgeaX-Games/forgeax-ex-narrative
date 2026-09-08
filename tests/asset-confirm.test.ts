import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  confirmAsset,
  normalizeAssets,
  unconfirmAsset,
  loadEntry,
  writeEntry,
} from "../src/api/entry-store.js";
import {
  createProject,
  deleteProject,
  listProjects,
  loadProject,
  patchProject,
  isSafeProjectId,
} from "../src/api/project-store.js";

/**
 * 确认与归档是两张正交的表（契约 docs/contracts.md §三）。
 *
 * 这份测试守的是那条分界：确认状态落在条目旁边（下游按 entryKey 一读就有），
 * 归档组织落在 projects（跨任务）。两表不同步——一份产物可以已确认但没归档，
 * 也可以归档进多个项目。谁要是哪天把它们并成一张，这里会红。
 */

describe("确认状态表 · _entry.json.assets[]", () => {
  it("裸路径按跟随最新读出来（旧条目不迁移也能读）", () => {
    expect(normalizeAssets(["output/01_worldview.json"])).toEqual([
      { path: "output/01_worldview.json", version: undefined, confirmedAt: undefined },
    ]);
  });

  it("缺省不写 version：跟随最新与钉住初稿是两件事", () => {
    const assets = confirmAsset(undefined, { path: "output/a.json" });
    expect(assets[0]!.version).toBeUndefined();
    expect(assets[0]!.confirmedAt).toBeTruthy();
  });

  it("给了 version 就钉住那一稿", () => {
    const assets = confirmAsset([], { path: "output/plot/plot_3.json", version: 3 });
    expect(assets[0]).toMatchObject({ path: "output/plot/plot_3.json", version: 3 });
  });

  it("重复确认是改钉住的版本，不是攒两条互相矛盾的记录", () => {
    let assets = confirmAsset([], { path: "output/a.json", version: 1 });
    assets = confirmAsset(assets, { path: "output/a.json", version: 2 });
    expect(assets).toHaveLength(1);
    expect(assets[0]!.version).toBe(2);
  });

  it("撤销确认只摘掉那一条", () => {
    const assets = unconfirmAsset(
      [{ path: "output/a.json" }, { path: "output/b.json", version: 2 }],
      "output/a.json",
    );
    expect(assets.map((a) => a.path)).toEqual(["output/b.json"]);
  });

  it("非法项丢掉：空路径与缺 path 的对象都不该混进定稿清单", () => {
    expect(normalizeAssets(["", "  ", { version: 2 } as never, null as never])).toEqual([]);
  });

  it("非法的 version 退化为跟随最新，而不是把 0 / 负数写进钉子", () => {
    const assets = normalizeAssets([{ path: "output/a.json", version: 0 }]);
    expect(assets[0]!.version).toBeUndefined();
  });

  it("两条泳道的同名产物各占一条：确认次管线那份不会把主管线的也点亮", () => {
    let assets = confirmAsset(undefined, { path: "output/01_worldview.json" });
    assets = confirmAsset(assets, { path: "output/01_worldview.json", pipelineId: "pipe-b" });
    expect(assets).toHaveLength(2);
    expect(assets.map((a) => a.pipelineId)).toEqual([undefined, "pipe-b"]);
    // 撤销也按泳道分开，否则撤一条会连带撤掉另一条泳道的定稿。
    const left = unconfirmAsset(assets, { path: "output/01_worldview.json", pipelineId: "pipe-b" });
    expect(left).toHaveLength(1);
    expect(left[0]!.pipelineId).toBeUndefined();
  });
});

describe("确认状态 · 落盘往返", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "narrative-assets-"));
    fs.mkdirSync(path.join(dir, "draft-1"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("写进 _entry.json 后原样读回，且不动条目里其它字段", () => {
    writeEntry(dir, "draft-1", { userInput: "一个故事" });
    writeEntry(dir, "draft-1", {
      assets: confirmAsset(undefined, { path: "output/01_worldview.json", version: 2 }),
    });
    const entry = loadEntry(dir, "draft-1");
    expect(entry?.userInput).toBe("一个故事");
    expect(normalizeAssets(entry?.assets)).toMatchObject([
      { path: "output/01_worldview.json", version: 2 },
    ]);
  });
});

describe("归档表 · projects 持久层", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "narrative-projects-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("建项目落成一文件一项目，列表由扫目录得出", () => {
    const a = createProject({ title: "都市异能", tags: ["都市"] }, dir);
    createProject({ title: "科幻长篇" }, dir);
    expect(listProjects(dir).map((p) => p.title)).toContain("都市异能");
    expect(loadProject(a.id, dir)?.tags).toEqual(["都市"]);
  });

  it("资产只记引用，不复制文件本体", () => {
    const p = createProject({ title: "柜子" }, dir);
    const next = patchProject(
      p.id,
      {
        assets: [
          {
            id: "ast_1",
            taskKey: "draft-1",
            path: "output/01_worldview.json",
            name: "01_worldview.json",
            contentType: "worldview",
            categoryId: null,
            addedAt: new Date().toISOString(),
          },
        ],
      },
      dir,
    );
    expect(next?.assets[0]).toMatchObject({ taskKey: "draft-1", path: "output/01_worldview.json" });
    // 引用模型的证据：项目目录里只有那一个 json，没有被搬过来的产物。
    expect(fs.readdirSync(path.join(dir, "projects"))).toEqual([`${p.id}.json`]);
  });

  it("类别没了的资产退回未归类，而不是凭空消失", () => {
    const p = createProject({ title: "柜子" }, dir);
    const withCat = patchProject(
      p.id,
      {
        categories: [{ id: "cat_1", name: "角色档案" }],
        assets: [
          {
            id: "ast_1",
            taskKey: "draft-1",
            path: "output/03_characters.json",
            name: "03_characters.json",
            contentType: null,
            categoryId: "cat_1",
            addedAt: new Date().toISOString(),
          },
        ],
      },
      dir,
    );
    expect(withCat?.assets[0]!.categoryId).toBe("cat_1");
    const dropped = patchProject(p.id, { categories: [] }, dir);
    expect(dropped?.assets).toHaveLength(1);
    expect(dropped?.assets[0]!.categoryId).toBeNull();
  });

  it("id 直接参与文件名，路径穿越必须被挡在门外", () => {
    expect(isSafeProjectId("../../etc/passwd")).toBe(false);
    expect(isSafeProjectId("prj_abc-123")).toBe(true);
    expect(loadProject("..%2Fetc", dir)).toBeUndefined();
  });

  it("删项目只删引用，不认的 id 返回 false 而不是抛", () => {
    const p = createProject({ title: "临时" }, dir);
    expect(deleteProject(p.id, dir)).toBe(true);
    expect(deleteProject(p.id, dir)).toBe(false);
    expect(deleteProject("../x", dir)).toBe(false);
  });

  it("两表不互相校验：没归档也能确认，归档进两个项目也不冲突", () => {
    const confirmed = confirmAsset(undefined, { path: "output/01_worldview.json" });
    const a = createProject({ title: "项目 A" }, dir);
    const b = createProject({ title: "项目 B" }, dir);
    const asset = {
      id: "ast_1",
      taskKey: "draft-1",
      path: "output/01_worldview.json",
      name: "01_worldview.json",
      contentType: null,
      categoryId: null,
      addedAt: new Date().toISOString(),
    };
    patchProject(a.id, { assets: [asset] }, dir);
    patchProject(b.id, { assets: [{ ...asset, id: "ast_2" }] }, dir);
    // 确认表没有"归档到哪"的概念，项目表也没有"是否定稿"的概念。
    expect(confirmed[0]).not.toHaveProperty("categoryId");
    expect(loadProject(a.id, dir)?.assets[0]).not.toHaveProperty("version");
    expect(loadProject(b.id, dir)?.assets).toHaveLength(1);
  });
});
