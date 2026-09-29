import { useCallback, useEffect, useRef, useState } from "react";
import type { ComposerDelivery } from "../lib/bridge";

/** 反馈停留多久。够看清，又不至于让连点两个 @ 的人等。 */
const FLASH_MS = 1600;

/**
 * @ 按钮的共享反馈。
 *
 * 嵌在平台里时引用直接落进宿主对话框，用户看得见结果，本来不需要反馈；独立形态下
 * 它落进剪贴板，不给反馈就跟点了没反应没有区别。两种形态共用一套代码，所以反馈统一
 * 由这里给，各调用点不必自己记状态。
 *
 * 按键记录而不是布尔值：一份清单里有很多张卡，各自都有 @，共用一个布尔值会让整列一起闪。
 */
export function useMention(): {
  /** 刚刚完成的那个 key，以及它的去向。 */
  flashed: { key: string; delivery: ComposerDelivery } | null;
  mention: (key: string, send: () => Promise<ComposerDelivery>) => void;
} {
  const [flashed, setFlashed] = useState<{ key: string; delivery: ComposerDelivery } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const mention = useCallback((key: string, send: () => Promise<ComposerDelivery>) => {
    void send().then((delivery) => {
      setFlashed({ key, delivery });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setFlashed(null), FLASH_MS);
    });
  }, []);

  return { flashed, mention };
}
