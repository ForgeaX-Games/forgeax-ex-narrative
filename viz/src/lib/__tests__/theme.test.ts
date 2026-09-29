import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 这里桩掉 window / document 而不是引入 jsdom：需要的面只有 matchMedia、
 * location.search 和一个 documentElement，为此装一整套 DOM 不划算。
 *
 * 真实浏览器里的初始解析已用 Playwright 在深浅两种宿主偏好下各验过一次；
 * 这里补的是那条验不了的路径——宿主在运行中改了外观。
 */
type Listener = () => void;

function stubEnv(prefersDark: boolean, search = "") {
  const listeners: Listener[] = [];
  let matches = prefersDark;
  const root = {
    attrs: {} as Record<string, string>,
    setAttribute(name: string, value: string) { this.attrs[name] = value; },
  };
  vi.stubGlobal("location", { search });
  vi.stubGlobal("document", { documentElement: root });
  vi.stubGlobal("window", {
    matchMedia: () => ({
      get matches() { return matches; },
      addEventListener: (_type: string, fn: Listener) => { listeners.push(fn); },
    }),
  });
  return {
    theme: () => root.attrs["data-theme"],
    /** 模拟宿主把外观切了。 */
    switchHostTo(dark: boolean) {
      matches = dark;
      for (const fn of listeners) fn();
    },
    listenerCount: () => listeners.length,
  };
}

afterEach(() => vi.unstubAllGlobals());

async function freshApplyTheme() {
  vi.resetModules();
  const { applyTheme } = await import("../theme.js");
  applyTheme();
}

describe("主题跟随宿主", () => {
  it("宿主报深色就用深色", async () => {
    const env = stubEnv(true);
    await freshApplyTheme();
    expect(env.theme()).toBe("dark");
  });

  it("宿主没表态时按规范默认走浅色", async () => {
    const env = stubEnv(false);
    await freshApplyTheme();
    expect(env.theme()).toBe("light");
  });

  it("宿主运行中改外观，工坊跟着换", async () => {
    const env = stubEnv(false);
    await freshApplyTheme();
    expect(env.theme()).toBe("light");
    env.switchHostTo(true);
    expect(env.theme()).toBe("dark");
    env.switchHostTo(false);
    expect(env.theme()).toBe("light");
  });

  it("?theme= 显式指定后压过宿主，且不再跟随", async () => {
    const env = stubEnv(true, "?theme=light");
    await freshApplyTheme();
    expect(env.theme()).toBe("light");
    expect(env.listenerCount()).toBe(0);
  });

  it("?theme= 给了无法识别的值时退回跟随宿主", async () => {
    const env = stubEnv(true, "?theme=forgeax");
    await freshApplyTheme();
    expect(env.theme()).toBe("dark");
  });
});
