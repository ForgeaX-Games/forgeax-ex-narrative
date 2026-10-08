import { useEffect } from "react";
import { stepIdForFile } from "../composer/seats.generated";
import { useNarrativeStore } from "../store/narrativeStore";

/**
 * 左栏点开一份产物时，把节点视图挪到产它的那个节点上。
 *
 * 文本视图那侧由 FilePreview 直接铺正文；节点视图没法「铺一个文件」，
 * 对它而言等价的动作是定位——展开产这份东西的节点，把镜头带过去。
 *
 * 文件反查步骤靠 seats.generated 里那张前缀表（由后端 STEP_FILE_MAP 投影），
 * 查不到就什么都不做：老管线产物与运行簿记本来就没有对应的节点。
 *
 * 只到步骤为止：一份产物装的是这一步的全部节点，从文件本身问不出「是哪一个节点」。
 * 再往下的节点粒度由点节点本身触发（图上点子节点、文本里点跨步 chip），走
 * `focusedChildNodeId`。
 */
export function useFocusedFileFocus(): void {
  const focusedFile = useNarrativeStore((s) => s.focusedFile);
  const viewMode = useNarrativeStore((s) => s.viewMode);
  const setFocus = useNarrativeStore((s) => s.setFocus);

  useEffect(() => {
    if (!focusedFile || viewMode !== "graph") return;
    const stepId = stepIdForFile(focusedFile.path);
    if (stepId) setFocus(stepId);
  }, [focusedFile, viewMode, setFocus]);
}
