/**
 * 双模式产物根解析（M-A：叙事工坊平台接入对齐 · 双模式路径映射）。
 *
 * 独立模式（不接入平台时的默认状态，也是本模块存在前唯一的状态）：产物落
 * `process.cwd()/output`，输入落 `process.cwd()/input`——这条取值与迁移前逐
 * 字节一致，是本模块的分界线：判定为独立模式时，绝不改变任何一个已有调用点
 * 原来拿到的值，`src/pipeline/` 与 `src/ip-dna/` 的独立接口写法完全不动。
 *
 * 插件模式（作为 Studio 扩展接入、平台把叙事进程的 `FORGEAX_PROJECT_ROOT` 设成
 * 了项目根时）：产物与输入映射到 `forgeax-extension.json` 早已声明的权限范围
 * `<projectRoot>/.forgeax/games/<slug>/narrative/{output,input}`，从而与平台
 * 文件区共享同一份磁盘数据——这不是新设计，是兑现一条已经声明但没有落实的
 * 契约（manifest 权限段与 `narrative:export-result` 的目标目录早就是这个形状）。
 *
 * 两种模式的判定与切换只在这一个文件里发生：其余 40+ 处调用点只管
 * `outputDir()` / `resolveNarrativeRoot()`，不关心自己被谁托管、slug 怎么来。
 */

import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { readPluginEnv } from "../utils/plugin-env.js";

/** 一次请求解析出的插件模式上下文；缺失时视为独立模式。 */
export interface ArtifactRootContext {
  readonly slug: string;
}

const contextStorage = new AsyncLocalStorage<ArtifactRootContext>();

/** 独立模式取值——与迁移前 `OUTPUT_DIR` / ip-dna `resolveCwd()` 的默认值逐字节一致。 */
const STANDALONE_CWD = process.cwd();

/** 平台注入的项目根；未接入平台时为空，此时永远走独立模式，零额外开销。 */
function platformProjectRoot(): string | undefined {
  return readPluginEnv("FORGEAX_PROJECT_ROOT") || undefined;
}

/** 平台侧「当前激活项目」的磁盘 SSOT（`packages/server/src/game/active-game.ts`
 *  持久化的同一份文件），slug 在请求头/查询参数都缺失时的最后一道回退。只读，
 *  不产生新的事实源；读不到或格式不对都静默返回 undefined，不抛错。 */
function readActiveGameSlugFromDisk(projectRoot: string): string | undefined {
  try {
    const file = path.join(projectRoot, ".forgeax", "active-game.json");
    if (!fs.existsSync(file)) return undefined;
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as { slug?: unknown };
    return typeof parsed.slug === "string" && parsed.slug ? parsed.slug : undefined;
  } catch {
    return undefined;
  }
}

/** 在给定 slug 上下文里运行 `fn`；无 slug 时原样运行（= 独立模式）。 */
export function runWithArtifactSlug<T>(slug: string | undefined, fn: () => T): T {
  if (!slug) return fn();
  return contextStorage.run({ slug }, fn);
}

/**
 * Express 中间件：按「请求头 → 查询参数 → 平台 active-game 磁盘 SSOT」的顺序解析
 * slug，写入本请求的 AsyncLocalStorage 上下文。平台没有给这个进程注入项目根时
 * 直接放行（不读盘、不解析），独立模式零开销。
 */
export function narrativeArtifactContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const projectRoot = platformProjectRoot();
  if (!projectRoot) {
    next();
    return;
  }
  const headerSlug = req.headers["x-forgeax-slug"];
  const querySlug = req.query?.slug;
  const slug =
    (typeof headerSlug === "string" && headerSlug) ||
    (typeof querySlug === "string" && querySlug) ||
    readActiveGameSlugFromDisk(projectRoot);
  runWithArtifactSlug(slug || undefined, next);
}

/**
 * 叙事的「进程根」：独立模式 = `process.cwd()`；插件模式 = 平台项目目录下已
 * 声明的叙事命名空间。`output/` 与 `input/` 都是这个根的子目录，双模式判定
 * 因此只需要在这一层做一次分支，其余路径拼接逻辑（`src/ip-dna/filesystem.ts`
 * 的媒体优先布局、`src/api/server.ts` 的 `output/<entryKey>/`）都不必分叉。
 */
export function resolveNarrativeRoot(): string {
  const projectRoot = platformProjectRoot();
  const ctx = contextStorage.getStore();
  if (!projectRoot || !ctx) return STANDALONE_CWD;
  return path.join(projectRoot, ".forgeax", "games", ctx.slug, "narrative");
}

/** 产物根（迁移前 `OUTPUT_DIR` 常量的替代）；调用即确保目录存在，行为与旧常量初始化一致。 */
export function outputDir(): string {
  const dir = path.join(resolveNarrativeRoot(), "output");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 当前请求是否命中插件模式（供诊断端点/日志使用，不参与路径拼接逻辑）。 */
export function isPluginMode(): boolean {
  return Boolean(platformProjectRoot()) && contextStorage.getStore() !== undefined;
}

/**
 * 插件模式下当前项目（= 游戏）的根目录；独立模式返回 undefined。
 *
 * 与 `resolveNarrativeRoot()` 差一层：叙事根是它的 `narrative/` 子目录。平台文件区
 * 以游戏根为浏览根（`CBFile.path` 是「相对游戏根」的展示路径），所以把产物指给
 * 文件区时需要的是这一层，而不是叙事根。
 */
export function resolveGameRoot(): string | undefined {
  const projectRoot = platformProjectRoot();
  const ctx = contextStorage.getStore();
  if (!projectRoot || !ctx) return undefined;
  return path.join(projectRoot, ".forgeax", "games", ctx.slug);
}

/**
 * 把产物的绝对路径折成平台文件区认的「相对游戏根」路径（POSIX 分隔符）。
 *
 * 独立模式、或该路径根本不在游戏根之内时返回 undefined——调用方据此决定不给
 * 「定位」这个动作，而不是送一条文件区匹配不上的路径过去静默失败。
 */
export function toGameRelativePath(absPath: string): string | undefined {
  const gameRoot = resolveGameRoot();
  if (!gameRoot) return undefined;
  const rel = path.relative(gameRoot, absPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  return rel.split(path.sep).join("/");
}
