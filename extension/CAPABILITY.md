# 叙事工坊 · 能力说明

这份写「它能做什么、做到什么程度、不做什么」。接入细节(凭证、返回结构、写入
位置、进程模型)在 [`CONTRACT.md`](./CONTRACT.md)。

---

## 它解决什么

游戏叙事的难处不在写一段故事,在于**一整套设定要互相自洽,并且能落成工程文件**。
世界观定了,角色的动机得跟着变;剧情改一个分支,下游的任务文本可能整片失效。
手工维护这张网,规模一大就维护不住。

叙事工坊把这件事做成可重跑的管线:从一句话需求出发,逐层展开成世界观、势力、
角色、剧情结构与分支,每一步的产物都落盘、可评审、可单独重生成,且**改动会沿依赖
链标出哪些下游过期了**。

---

## 两个入口,给两类人

| | 谁用 | 什么时候 |
|:--|:--|:--|
| **浏览器创作界面** | 人 | 选标签、传素材、确认 IP 改编范围、逐段评审改稿 —— 这些是要人做判断的步骤 |
| **模型驱动的 40 个操作** | Agent | 用户让模型代劳时;或做批量、续跑、定向重生成这类机械动作 |

两条路走的是**同一份服务和同一张 handler 表**,不会各自演化出不同的行为。

> [!NOTE]
> Skill 明确要求模型「把地址交给用户,让用户自己决定」,而不是替用户打开界面,
> 也不把「打开了界面」当成一项已完成的任务。

---

## 能力分组

40 个操作,按你要干什么分:

### 生成

| | |
|:--|:--|
| `start-pipeline` | 主入口。支持 **117 个游戏品类 × 9 套模板**,自动 Tier/Mode 路由 |
| `run-seat` | 只跑**二十席叙事单品助手**里的某一席,不走全管线 |
| `resume-pipeline` | 从断点续跑未完成的运行,写回同一目录 |

### 改与重生成

这一组是叙事工坊区别于「让模型写一段故事」的地方。

| | |
|:--|:--|
| `analyze-impact` | 改之前先算:这处改动会波及哪些节点 |
| `get-stale-steps` | 给定起点,列出会因此过期、需要重生成的下游步骤与字段 |
| `regenerate-step` | 定向重生成,可注入用户指令、可按节点过滤 |
| `save-step-edit` | 人工改稿落盘,**原稿自动存进 `_original/`** |
| `restore-original` | 把某步还原成模型原稿,撤掉编辑账本里那一条 |

### 评审与定稿

| | |
|:--|:--|
| `set-review` / `get-review` | 逐步骤标 approved / rejected 并附反馈 |
| `confirm-asset` | 把某份产物确认为定稿,可钉住版本号 |
| `list-assets` | 列出已定稿的产物 —— **下游生成只引用这张表里的文件** |

### IP 改编(`ip-dna-*`,11 个操作)

把既有 IP(小说、设定集、多模态素材)拆成可复用的「IP DNA」,再改编成游戏叙事。
流程带**确认门**:摄入建树之后停下来,等人确认裁剪范围和游戏单元,才继续生成。

| | |
|:--|:--|
| `ip-dna-ingest` | 摄入、标准化、建层级树,含干扰项过滤;停在确认门前 |
| `ip-dna-confirm-scope` / `-confirm-units` | 两道确认:裁剪范围、游戏单元与改编维度 |
| `ip-dna-decompose` | 体量超线时按单元闭环拆解 |
| `ip-dna-generate` | 确认后一路跑到底,中途不再暂停 |

### 查询与导出

`list-genres` / `list-axes` / `list-modes` / `list-seats` / `list-teams` 是
**填参数前该先查的词表**;`get-story-tree` / `get-ip-dna` 读结构;
`list-files` / `read-file` 读产物;`export-result` 导出到项目目录。

---

## 产物落在哪

```
<项目根>/.forgeax/games/<slug>/narrative/
├── input/     素材与输入
└── output/    分步产物、编辑账本、_original/ 原稿
```

与平台的文件区共享同一份磁盘数据,不是另开一份。

---

## 质量取决于用哪个模型

| `credentialSource` | 效果 |
|:--|:--|
| `narrative` | 完整质量 —— 本插件自己配置的 Key |
| `engine` | 完整质量 —— 借用环境里已有的 ForgeaX 引擎网关,只读转发 |
| `platform` | **降级** —— 没找到 Key,借宿主 Agent 的模型 |

降级时 `degraded` 为 true,Skill 要求模型**在开始生成前就告知用户**,而不是等
产出质量不对了再解释。

---

## 它不做什么

- **不替用户写叙事**。用户要求工坊产出时,模型不应该自己编一段交差 —— 这是 Skill
  里的硬规则。
- **不自动打开浏览器**。返回地址,由用户决定。
- **不常驻**。服务空闲够久会自行退出,忘了关也不会一直占着。
- **不碰引擎版本**。叙事不依赖 `forgeax-engine`,引擎升级不影响它。
- **不落盘密钥**。任何来源的 Key 都不写进 Skill、命令行、日志或包产物。

---

## 安装

叙事工坊是两半:插件壳(40 KB,零依赖)和服务本体(2.9 MB,11 万行业务逻辑)。
Codex 装插件就是**逐字复制一个目录**,不编译、不装依赖,所以服务塞不进插件壳,
两半各走各的路 —— 装的时候两条命令,一条给壳一条给服务。

### 只有 Codex 的用户

```bash
npm i -g @forgeax-extension/narrative        # 服务。省掉也行,首次 start 会 npx 现拉
codex plugin marketplace add ForgeaX-Games/forgeax-ex-narrative
codex plugin add narrative@forgeax
```

市场来源支持本地路径、`owner/repo[@ref]`、HTTPS Git URL、SSH Git URL 四种,
所以本地 clone 时把第二行换成 `codex plugin marketplace add .` 即可。
远端简写这条路**尚未实测**,需要本分支先合入默认分支。

未发版时想完整测一遍,把服务换成本地 tarball:`npm i -g ./xxx-0.2.0.tgz`。
`start` 找服务的顺序是「`FORGEAX_NARRATIVE_SERVICE_CMD` → PATH 上的
`forgeax-narrative` → npx」,装在 PATH 上就完全不碰 registry ——
这同时是沙箱断网时的正常路径,不是测试专用的绕法。

> [!WARNING]
> 装服务必须用 tarball 或包名,别用 `npm i -g <源码目录>`:目录安装会软链到源码,
> 而源码里的 bin 没有执行位,`spawn` 直接报 `EACCES`。npm 只在解包 tarball 时补 `+x`。

> [!NOTE]
> Codex 复制的是快照,不是引用。改了 `cli.mjs` 之后必须
> `codex plugin remove` 再 `add`,否则跑的还是安装那一刻的旧版本。

### 已经在用 ForgeaX 的用户

这条路上插件壳随 `@forgeax/game` 的 npm 包一起来,叙事是它的一个扩展:
`install --ide codex` → `init` → `narrative enable`,见 [`CONTRACT.md`](./CONTRACT.md)。

两条路不冲突:同一个 `extension/` 目录里放了两套门牌(`extension.json` 对
`@forgeax/game`、`.codex-plugin/plugin.json` 对 Codex),真正干活的 `cli.mjs` 只有一份。

装完新开一个会话,直接说需求即可,例如:

- 「帮我做一个赛博朋克侦探游戏的世界观和主角」
- 「把这份设定文档扩写成完整的剧情结构」
- 「检查当前叙事里的设定冲突并修掉」
