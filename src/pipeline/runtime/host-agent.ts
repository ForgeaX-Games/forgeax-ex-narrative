/**
 * 借用宿主 agent 的模型作为 LLM 后端（`codex exec` 非交互模式）。
 *
 * 为什么存在：插件装在 Codex 里的用户已经为一个模型付过费了，再要他配一把
 * Gemini key 才是采纳门槛。这条路让「没有任何 key」也能跑起来。
 *
 * 它跟另两条路（Gemini SDK 直连 / LiteLLM 代理）不是等价替换，差别写在
 * `HOST_AGENT_LIMITS` 里，由 LLMClient 诚实上报，不悄悄降级。
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** 宿主 agent 与直连模型的能力差，供调用方与 doctor 交代。 */
export const HOST_AGENT_LIMITS = {
  /** 每次调用都是一个全新会话，宿主自带的系统提示词与工具定义要重新计费。 */
  tokenOverheadPerCall: 13_000,
  /** 实测一句话提示词的往返耗时，含进程启动与会话建立。 */
  typicalLatencyMs: 13_000,
  /** 没有 system/user 两个槽位，两段提示词只能合并成一段喂进去。 */
  mergesSystemPrompt: true,
  /** 无联网检索通道：拿不回 groundingChunks，无法交代来源。 */
  webSearch: false,
} as const;

/** 已解析好的宿主 agent 可执行文件。薄壳负责找到它并通过环境变量传进来。 */
export interface HostAgentSpec {
  command: string;
}

export interface HostAgentCallOptions {
  model?: string;
  timeoutMs?: number;
  /** 要求只输出 JSON。宿主没有结构化输出槽位可用，只能靠指令约束。 */
  json?: boolean;
  /** 随提示词附上的图片。宿主只收文件路径，这里负责落盘并随调用一起清掉。 */
  images?: readonly HostAgentImage[];
}

export interface HostAgentImage {
  mimeType: string;
  data: string | Buffer;
}

const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * 借不到宿主模型时的说法。
 *
 * Codex 在 Windows 上的沙箱**禁止被沙箱的进程创建任何子进程** —— cmd / node /
 * codex 一律 EPERM。而借用宿主模型的做法恰恰是启动宿主的 CLI，于是这条兜底在
 * 默认沙箱下从根上走不通。原样抛出 `spawn EPERM` 会把这件事伪装成偶发故障，
 * 用户看到的是管线第一步挂了,而不是"这台机器上这条路不通,要么配 key、要么放开沙箱"。
 */
export const HOST_AGENT_BLOCKED = "host_agent_blocked";

function describeSpawnFailure(command: string, error: NodeJS.ErrnoException): Error {
  if (error.code !== "EPERM" && error.code !== "EACCES") return error;
  return new Error(
    `${HOST_AGENT_BLOCKED}: the sandbox this service runs in will not let it start ${command}, ` +
      `so the host's model cannot be borrowed here (${error.code}). ` +
      `Configure a key for the workshop, or run the host with full access.`,
  );
}

/**
 * 这台机器上、这个进程里，究竟能不能启动宿主 CLI。
 *
 * 只有服务自己能回答:外壳跑在宿主的命令层、还创建得了子进程,服务是它派生出来
 * 的后台进程,受的限制不同 —— 实测外壳能起服务,服务起不了 codex。所以这个探针
 * 必须在服务里、在接活之前跑一次,而不是等到用户的第一次生成跑到第 12 秒。
 */
export async function probeHostAgent(spec: HostAgentSpec): Promise<Error | undefined> {
  return new Promise((done) => {
    const child = spawn(spec.command, ["--version"], { stdio: "ignore" });
    const timer = setTimeout(() => { child.kill(); done(new Error("host agent did not answer --version")); }, 15_000);
    child.on("error", (error) => { clearTimeout(timer); done(describeSpawnFailure(spec.command, error)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      done(code === 0 ? undefined : new Error(`host agent exited ${code} for --version`));
    });
  });
}

/**
 * 把两段提示词并成一段。
 *
 * `codex exec` 只收一个 prompt，没有 systemInstruction 槽位，所以角色边界
 * 只能靠标记表达——这是本后端与直连路径最主要的保真度损失。
 *
 * 末尾那句「不要执行命令」不是客套：宿主是个带工具的编码 agent，默认倾向去
 * 读文件、跑命令。这里只要它回答。
 */
function framePrompt(systemPrompt: string, userPrompt: string, json: boolean): string {
  const rules = [
    "You are being called as a text generation model, not as an agent.",
    "Answer the request directly. Do not run commands, read files or use tools.",
  ];
  if (json) {
    rules.push("Respond with a single JSON value and nothing else: no prose, no code fences.");
  }
  return [
    "<instructions>",
    systemPrompt.trim(),
    "",
    ...rules,
    "</instructions>",
    "",
    userPrompt.trim(),
  ].join("\n");
}

/** 宿主只收文件路径，收不了 inlineData，所以图片先落到本次调用的临时目录。 */
function writeImages(dir: string, images: readonly HostAgentImage[]): string[] {
  return images.map((image, index) => {
    const extension = image.mimeType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin";
    const file = path.join(dir, `image-${index}.${extension}`);
    writeFileSync(file, typeof image.data === "string" ? Buffer.from(image.data, "base64") : image.data);
    return file;
  });
}

/**
 * 跑一次宿主 agent，返回它的最终答复。
 *
 * 几个参数都是为了让它当纯模型用，而不是当 agent 用：`--ephemeral` 不留会话
 * 文件，`-s read-only` 即使它不听话也动不了盘，`-C` 指向临时目录让它无从翻
 * 用户的工程，`-o` 只取最终那条消息（省去解析 JSONL 事件流）。
 * 提示词走 stdin，所以再长也不进 argv、不进进程列表、不进日志。
 */
export async function runHostAgent(
  spec: HostAgentSpec,
  systemPrompt: string,
  userPrompt: string,
  options: HostAgentCallOptions = {},
): Promise<string> {
  const workDir = mkdtempSync(path.join(tmpdir(), "forgeax-narrative-host-"));
  const answerFile = path.join(workDir, "answer.txt");
  const args = [
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "--color", "never",
    "-s", "read-only",
    "-C", workDir,
    "-o", answerFile,
  ];
  if (options.model) args.push("-m", options.model);

  try {
    for (const file of writeImages(workDir, options.images ?? [])) args.push("-i", file);
    args.push("-");
    await new Promise<void>((done, fail) => {
      const child = spawn(spec.command, args, { stdio: ["pipe", "ignore", "pipe"] });
      const noise: Buffer[] = [];
      const timer = setTimeout(() => {
        child.kill();
        fail(new Error(`host agent timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`));
      }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      // stderr 只在失败时有用：成功时它装的是沙箱之类的例行提醒。
      child.stderr?.on("data", (chunk: Buffer) => noise.push(chunk));
      child.on("error", (error) => { clearTimeout(timer); fail(describeSpawnFailure(spec.command, error)); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) return done();
        const text = Buffer.concat(noise).toString("utf8").trim();
        fail(new Error(`host agent exited ${code}: ${text.slice(-600) || "(no output)"}`));
      });
      child.stdin?.end(framePrompt(systemPrompt, userPrompt, options.json ?? false));
    });
    const answer = readFileSync(answerFile, "utf8").trim();
    if (!answer) throw new Error("host agent returned empty response");
    return answer;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
