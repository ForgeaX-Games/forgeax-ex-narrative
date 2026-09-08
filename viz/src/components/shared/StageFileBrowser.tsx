import { useCallback, useEffect, useState } from "react";
import { fetchRunFiles, fetchRunFileContent, type RunFileGroup } from "../../hooks/useNarrativeStream";
import { useT } from "../../i18n";

/**
 * 环节文件浏览器（复用于文本阅读 / 节点视图两个模式）：
 * 按 run 键读取 input/ 与 output/ 两侧真实落盘文件，按环节分组列出；点击文件即拉取内容内联展示，
 * 内容区有最大高度 + 滚轮。让用户「看到每一个环节的文件」并可交互读取。
 */
export function StageFileBrowser({
  runKey,
  groups,
  autoOpenFirst = false,
}: {
  /** 真实落盘运行键（`<时间戳>_<标题>`）。 */
  runKey: string | null;
  /** 仅展示这些环节分组；不传则展示全部存在的分组。 */
  groups?: string[];
  /** 是否默认展开首个文件内容（文本视图常用 true）。 */
  autoOpenFirst?: boolean;
}) {
  const t = useT();
  const [data, setData] = useState<RunFileGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);

  const groupKey = groups ? groups.join(",") : "*";

  useEffect(() => {
    let alive = true;
    if (!runKey) {
      setData([]);
      return;
    }
    setLoading(true);
    fetchRunFiles(runKey).then((g) => {
      if (!alive) return;
      const filtered = groups ? g.filter((x) => groups.includes(x.group)) : g;
      setData(filtered);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
    // groupKey 是 groups 的稳定指纹，避免数组引用变动触发无谓重拉。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, groupKey]);

  const open = useCallback(
    async (groupedPath: string) => {
      if (!runKey) return;
      if (openPath === groupedPath) {
        setOpenPath(null);
        setContent(null);
        return;
      }
      setOpenPath(groupedPath);
      setContent(null);
      const c = await fetchRunFileContent(runKey, groupedPath);
      setContent(c ?? t("stageFiles.unreadable"));
    },
    [openPath, runKey, t],
  );

  // 自动展开首个文件（文本视图）。
  useEffect(() => {
    if (!autoOpenFirst || openPath || data.length === 0) return;
    const firstGroup = data.find((g) => g.files.length > 0);
    if (firstGroup) void open(`${firstGroup.group}/${firstGroup.files[0]}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenFirst, data]);

  if (!runKey) return null;
  const total = data.reduce((n, g) => n + g.files.length, 0);
  if (loading && total === 0) return <div className="stage-files stage-files--loading">{t("stageFiles.loading")}</div>;
  if (total === 0) return null;

  return (
    <div className="stage-files">
      <div className="stage-files__head">{t("stageFiles.head", { n: total })}</div>
      <div className="stage-files__scroll">
        {data.map((g) => (
          <div key={g.group} className="stage-files__group">
            <div className="stage-files__group-label">{g.label} · {g.files.length}</div>
            {g.files.map((f) => {
              const gp = `${g.group}/${f}`;
              const isOpen = openPath === gp;
              return (
                <div key={gp} className="stage-files__item">
                  <button
                    type="button"
                    className={`stage-files__file${isOpen ? " is-open" : ""}`}
                    onClick={() => open(gp)}
                    title={f}
                  >
                    <span className="stage-files__caret">{isOpen ? "▾" : "▸"}</span>
                    <span className="stage-files__name">{f}</span>
                  </button>
                  {isOpen && <pre className="stage-files__content">{content ?? t("stageFiles.reading")}</pre>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** IP 各环节 → 文件分组映射（与后端 runArtifactRoots 的 group 对齐）。返回 undefined 表示该步不挂文件浏览。 */
export function fileGroupsForStep(stepId: string): string[] | undefined {
  switch (stepId) {
    case "ip_input":
      return ["original", "package"];
    case "ip_standardize":
    case "ip_decompose":
      return ["processing"];
    case "ip_volume":
    case "ip_adapt_plan":
      return ["extraction_output"];
    case "ip_dna_extract":
      return ["extraction_output", "output"];
    default:
      return undefined;
  }
}
