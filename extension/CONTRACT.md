# 叙事工坊扩展 · 接入契约

给主仓维护者的交付说明。按 [`docs/plugin-integration-standard.md`](../../../fxgame-dev/docs/plugin-integration-standard.md)
「作者与维护者的接入步骤」第 1 条要求的六项组织：外部服务、网络前提、凭证环境变量、
业务命令、返回结构、写入位置。

目录直接放进主仓 `extensions/narrative/`,不需要改主源码,不需要在
`src/cli/dispatch.ts` 加领域分支。

---

## 一句话

模型通过一个零依赖 CLI 驱动一个本地叙事服务,把一句话需求展开成世界观、角色、
剧情等工程文件,落在项目的 `.forgeax/games/<slug>/narrative/` 下。

---

## 外部服务

**扩展本身不连任何第三方服务。** 它只做两件事:把叙事服务拉起来,然后用 HTTP 调它。

| | |
|:--|:--|
| 服务包 | `@forgeax-extension/narrative`(独立 npm 包,不是主包依赖) |
| 默认地址 | `http://127.0.0.1:8900` |
| 谁拉起 | 扩展 CLI 的 `start`,或首次调用工具时 |
| 谁回收 | 服务自己 —— 见下方「进程模型」 |

叙事服务内部会调 LLM。那是服务的事,凭证由扩展解析后**以环境变量交给子进程**,
不经过命令行参数,也不落盘。

## 网络前提

| 场景 | 是否需要网络 |
|:--|:--|
| 服务包已全局安装(`npm i -g @forgeax-extension/narrative`) | 启动**不需要**网络 |
| 服务包未安装 | 首次启动走 `npx` 拉包,**需要** registry 可达 |
| 任何叙事生成 | 需要,LLM 调用走网络 |

> [!IMPORTANT]
> Codex 沙箱默认禁网,`npx` 会以 `EAI_AGAIN` 失败。CLI 为此加了免网络快路径:
> `forgeax-narrative` 在 `PATH` 上时直接用它,不走 registry。启动失败时错误信息
> 会带上服务日志尾巴和 `npm i -g` 的建议,而不是只抛一个 DNS 错误。

## 凭证环境变量

三个来源,**按顺序**取第一个命中的。`doctor` 会报出用了哪一个,但**只报来源名,
不报密钥本身**。

| 顺序 | 来源 | 读什么 | 说明 |
|:--|:--|:--|:--|
| 1 | 叙事自己的 | `FORGEAX_NARRATIVE_API_KEY` 或 `GEMINI_API_KEY`;或 `LITELLM_PROXY_KEY` + `LLM_PROXY_URL`;或叙事私有配置文件 | 本插件专属,与引擎无关 |
| 2 | 引擎的 | `FORGEAX_LITELLM_API_KEY` + `FORGEAX_LITELLM_BASE_URL` | **只读转发,不落盘、不复制、不改写** |
| 3 | 平台基座模型 | 无 —— 走 `codex exec` 借宿主的模型 | 降级路径,`degraded: true` |

顺序可由 `credentials.ts` 的 `PRECEDENCE` 一处改动调整。

### 第 3 条的代价与边界

借宿主模型是为了让「一把 key 都没配」也能用,不是为了省钱:每次调用都是一个
全新宿主会话,要**重付它自带的系统提示词和工具定义**。实测一句话提示词往返约
13 秒、约 13k tokens 开销,自带 key 没有这笔。

| 能力 | 自带 key(直连) | 借宿主模型 |
|:--|:--|:--|
| 文本生成 | ✅ | ✅ |
| 强制 JSON | ✅ 模型侧 `responseMimeType` | ⚠️ 只能靠指令约束 —— 宿主的 `--output-schema` 要求严格 schema,而调用方不提供 |
| 多模态图片 | ✅ inlineData | ✅ 图片落临时文件走 `-i` |
| 真流式 | ✅ | ❌ 整段返回后模拟分块(与代理同路数) |
| 联网检索 | ✅ 带来源清单 | ❌ 拿不回来源,**宁可报错也不假装检索过** |

找宿主可执行文件是**薄壳**的职责:薄壳跑在宿主里看得见它,服务是脱离的子进程
只能猜。PATH 优先,Windows 桌面版例外 —— 它把 CLI 放在
`%LOCALAPPDATA%\OpenAI\Codex\bin\<build>\codex.exe` 且刻意不进 PATH,所以要扫。
宿主的登录态在 `CODEX_HOME` 下,薄壳一并转发,否则一个用户手动能跑的二进制
会回 401,看起来像我们的 bug。

> [!IMPORTANT]
> 第 3 条找不到宿主时返回的是 `source: 'none'`,**不是**一个报着 `degraded: true`
> 的可用凭据。一个跑不起来的兜底比没有兜底更坏:调用方会照那句话继续往下走。
> `doctor` 与 `start` 都在 spawn **之前**据此拒绝并给出配置命令。

#### 沙箱会让这条路整条不通

> [!WARNING]
> Codex 在 Windows 上的沙箱**禁止被沙箱的进程创建任何子进程**。实测
> `codex exec -s workspace-write` 里 `cmd` / `node` / `codex` 三种 spawn 全部
> `EPERM`,`-s danger-full-access` 下全部正常。而借宿主模型的做法就是启动宿主的
> CLI,所以在默认沙箱下这条兜底从机制上走不通 —— 不是偶发故障,重试没有意义。

**能不能 spawn 只有服务自己知道。** 实测外壳起得了服务、服务起不了 codex:外壳跑
在宿主的命令层,服务是它派生的后台进程,受的限制不同。所以探针必须在服务里跑,
且在**开始应答之前**跑一次 —— 先说「我好了」再去发现自己借不到模型,等于把第一个
提问的人推进那条不通的路。

探针结论沿这条链上报:服务 `/api/health` 的 `backend` 从 `host-agent` 变成
`host-agent-blocked`(附 `backendError`),外壳把它翻成 `doctor` / `start` 的
`blocked` 字段并置 `ok: false`。真到了调用那一步,`spawn EPERM` 也会被翻成同一句
话,而不是把它当成内容生成失败。

不拒绝启动:界面仍然可用,key 也可以随后再配。拒绝的只是"假装生成得出来"。

密钥从不写入 Skill 文件、命令行参数、日志、`config.json` 或包产物。卸载不销毁
其他项目仍在使用的 Key。

## 业务命令

CLI 有两个不相交的命名空间。

**生命周期(8 个,CLI 自己实现):**

| 命令 | 作用 |
|:--|:--|
| `enable` | 宿主侧配置。**只返回非密信息** —— 宿主会把返回值逐字写进 `config.json`,放密钥进去就是泄漏。密钥只经 `--with-key-stdin` 走标准输入 |
| `doctor` / `status` | 报健康状况、项目根、状态目录、服务地址、PID、凭证来源 |
| `start` | 拉起服务;`--idle-timeout SECONDS` 指定空闲多久自结 |
| `stop` | 按 PID 文件停掉服务 |
| `open` | **返回地址,不自动开浏览器** —— 工坊应当被提供,而不是在对话中途被强塞给用户 |
| `tools` | 列出全部 40 个业务工具及其参数 |
| `call <tool>` | 显式调用,与直接写工具名等价 |

**业务工具(40 个,转发给服务):** 直接写工具名即可,例如
`start-pipeline`、`get-run-status`、`export-result`、`ip-dna-extract`。
完整清单用 `tools --json` 取,不要照抄文档里的列表 —— 它由
`scripts/gen-tool-catalog.mjs` 从 `forgeax-extension.json` 生成,会漂移。

两个命名空间靠 `verbs.ts` 的 `LIFECYCLE` 常量保持不相交,所以工具名永远不会
被生命周期命令遮住。`enable` 不在 `LIFECYCLE` 里 —— 它由 `cli.ts` 的 `check()`
接,是宿主契约的一部分,不走 `dispatch()`。

业务工具全部走 Studio 宿主用的**同一张 handler 表**,两个接入面不会各自演化。

## 返回结构

成功:

```json
{ "tool": "start-pipeline", "value": { "runId": "..." } }
```

失败一律抛 `Error`,消息形如 `<原因码>: <可读说明>`:

| 原因码 | 什么时候 |
|:--|:--|
| `narrative_arguments_invalid` | 参数缺失、未知命令、`--idle-timeout` 不是秒数 |
| `narrative_service_unavailable` | 地址上没人应答(提示先 `start`) |
| `<tool>_failed` | 服务返回了业务错误 |

加 `--json` 时结构化输出;不加时人读格式。

## 写入位置

| 写什么 | 写到哪 |
|:--|:--|
| 叙事产物与输入 | `<projectRoot>/.forgeax/games/<slug>/narrative/{output,input}` |
| 服务 PID 与日志 | `<stateDir>/service.pid`、`<stateDir>/service.log` |

`stateDir` 由宿主给出(`.forgeax/extensions/narrative`)。产物路径与
`forgeax-extension.json` 早已声明的权限范围一致,不是新增的写入面。

> [!NOTE]
> 叙事服务有两种模式,判定只发生在 `src/runtime/artifact-root.ts` 一个文件里。
> 平台注入 `FORGEAX_PROJECT_ROOT` 时走上表的插件模式;未接入平台时落
> `cwd()/output`,与接入前逐字节一致。

---

## 进程模型:为什么服务要自己了结自己

宿主的扩展 CLI 是**一次性进程**:执行完就退,没有常驻方在之后回收它派生的子进程。
服务因此是孤儿 —— 没人会来关它。

所以由服务自己定期限:扩展启动时注入 `NARRATIVE_IDLE_TIMEOUT_MS`(默认 30 分钟),
服务据此在空闲够久后自行退出。

「空闲」的定义是**既没有请求、也没有在跑的管线**。只看请求是不够的:一次叙事生成
可能跑好几分钟且中途没有任何 HTTP 流量,只按流量判定会把它拦腰砍断。

Studio 托管时不注入这个变量,服务读到 0 就把自结整个关掉,行为与接入前完全一致。

### 端口上有人应答,不等于那是我们的服务

`start` 不会因为 `/api/health` 有回应就接管它。`/api/health` 同时交代自己的
`backend`(实际启动时用的模型通道)和 `projectRoot`(为哪个项目而起),外壳拿这两项
跟自己的项目根核对;对不上、或者压根没有这两项(说明不是本外壳起的),`doctor`
报 `conflict` 且 `ok: false`,`start`、`open` 和每一次工具调用都直接拒绝。

> [!IMPORTANT]
> 这条不是洁癖。WSL 的 localhost 转发会把另一个系统里的旧服务映射到 Windows 回环,
> 且映射的存续并不稳定。少了身份核对时:`start` 认领了它并报告成功,`doctor` 按
> **自己**解析出的凭据来源作答,于是「用的是平台兜底」这句话描述的是一个从未被启动的
> 进程 —— 真正在跑的那个用着另一把 key,几步之后以 `API key not valid` 失败,而在场
> 的每一份报告都指向别处。

判据是**项目根而非版本号**:全局装的服务包合理地可能略落后于启动它的插件,拿版本号
当判据会把这种正常情况判成冲突。唯一的例外是本外壳自己记了活 pid 的旧服务 —— 那是
我们起的,放行。

版本对不上会体现在另一处:`doctor` 和 `start` 会在 `serviceBackend` 里报出**正在跑的**
那个服务实际用的通道,与外壳将要注入的不一致时附一句 `credentialNote`。凭据这一栏从此
说的是"跑着的那个在用什么",不是"我重启它会用什么"。

## 一个目录,两个宿主

同一份目录同时满足两套加载器,不是两份拷贝:

| | `@forgeax/game` 读 | Codex 读 |
|:--|:--|:--|
| 清单 | `extension.json` | `.codex-plugin/plugin.json` |
| Skill | `skills/narrative-workshop/` | `codex-skills/narrative-workshop/` |
| CLI | `cli.mjs` | `cli.mjs`(同一个) |

两份 Skill 的差别只有两处,且都是 Codex 的安装方式逼出来的 —— **Codex 是逐字复制
插件目录,从不执行构建**:

1. `{{CLI}}` 占位符由 `@forgeax/game` 在挂载时替换;Codex 不替换,所以
   `codex-skills/` 那份是预先解析好的。
2. `cli.mjs` 必须提交进仓库,不能只在构建时产出。

`build.mjs` 取的是**白名单**而不是排除表:它只拷 `extension.json`、清单里声明的
`skills/*/SKILL.md`,再把 CLI 编译成 `cli.mjs`。所以 `.codex-plugin/`、
`codex-skills/`、`src/` 以及这两份交接文档都不会进 `@forgeax/game` 的 tarball ——
Codex 侧的东西对主包是零成本的,发布闸门不受影响。

---

## 已验证的

| 项 | 结论 |
|:--|:--|
| 宿主清单硬校验 | 通过(`schemaVersion` 1 / `id` 与目录名一致 / `cli` 以 `.mjs` 结尾 / skill 路径匹配 `^skills/[a-z][a-z0-9-]*$`) |
| 发布闸门 | 带 narrative 跑 `check-package-artifact.ts` 通过;扩展零依赖,不触碰主包 dependencies 白名单 |
| 空闲自结 | 注入 6 秒超时 → 46 秒自行退出;不注入 → 50 秒仍在(Studio 行为不变) |
| 免网络快路径 | 服务在 `PATH` 上时不访问 registry |
| 同名 Skill 共存 | Codex 两份都加载、不去重不警告;两份都能跑通。选择靠描述区分,实测 2/2 正确 |

## 尚未验证的

| 项 | 为什么 |
|:--|:--|
| 装进已发布的主包 | 等 `@forgeax/game` 0.3.9 发布 |
| Codex 里端到端 | 需真人在真实 Codex 中操作 |
| macOS 真机 | 同上,且需真机 |
| Skill 选错后的回退 | 首选 CLI 拉不到包时,模型 4 次里只有 1 次回头用旁边可用的离线 CLI。要做到确定性得改宿主 CLI 的代码,不在本仓范围 |

## 源码 review 索引

| 想看什么 | 文件 |
|:--|:--|
| 作者交付清单 | [`extension.json`](./extension.json) |
| 模型实际读到的指令 | [`skills/narrative-workshop/SKILL.md`](./skills/narrative-workshop/SKILL.md) |
| 命令入口与独立模式上下文 | [`cli.ts`](./cli.ts) |
| 生命周期命令与工具转发 | [`src/verbs.ts`](./src/verbs.ts) |
| 服务启停、PID、日志、免网络快路径 | [`src/service.ts`](./src/service.ts) |
| 凭证三来源与优先级 | [`src/credentials.ts`](./src/credentials.ts) |
| 40 个工具的参数与必填项 | [`src/catalog.generated.ts`](./src/catalog.generated.ts) |
| Codex 侧清单 | [`.codex-plugin/plugin.json`](./.codex-plugin/plugin.json) |
