import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 本包的版本号,取自 package.json。
 *
 * 版本号只有一处真值。`/api/health` 曾经自己写死一个数,于是 doctor 报的版本、
 * 发布的版本、npm 上的版本互不相同,三个数字谁也证明不了谁。
 */
export function packageVersion(): string {
  const path = fileURLToPath(new URL("../../package.json", import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")).version as string;
}
