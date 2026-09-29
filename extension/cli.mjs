// extension/cli.ts
import { mkdirSync as mkdirSync3 } from "node:fs";
import { resolve as resolve4 } from "node:path";
import { pathToFileURL } from "node:url";

// extension/src/catalog.generated.ts
var SERVICE_VERSION = "0.2.0";
var CATALOG = [
  {
    name: "analyze-impact",
    id: "narrative:analyze-impact",
    description: "重生成前预判:对若干节点的拟改动做差异+影响分析,返回受影响范围",
    params: [
      "sourceDir",
      "modifications"
    ],
    hints: {
      sourceDir: "运行输出目录名",
      modifications: "拟改动列表"
    },
    required: [
      "sourceDir",
      "modifications"
    ],
    requireConfirm: false
  },
  {
    name: "cancel-run",
    id: "narrative:cancel-run",
    description: "取消/暂停正在运行的管线 · 已跑完的步保留断点，随后可用 resume-pipeline 续跑",
    params: [
      "runId"
    ],
    hints: {
      runId: "Run ID of the currently running pipeline to cancel"
    },
    required: [
      "runId"
    ],
    requireConfirm: false
  },
  {
    name: "confirm-asset",
    id: "narrative:confirm-asset",
    description: "确认或撤销确认一份产物 · 可钉住版本号（缺省跟随最新）",
    params: [
      "entryKey",
      "path",
      "pipelineId",
      "version",
      "confirmed"
    ],
    hints: {
      entryKey: "条目键（任务的磁盘目录名）",
      path: "要确认的产物，`<group>/<相对路径>`，取自 narrative:list-files",
      pipelineId: "泳道；缺省 = 主管线。次管线产物必须带上，否则会与主管线同名产物互相顶掉",
      version: "钉住这一稿；缺省表示跟随最新",
      confirmed: "false 表示撤销确认；缺省视为确认"
    },
    required: [
      "entryKey",
      "path"
    ],
    requireConfirm: false
  },
  {
    name: "create-entry",
    id: "narrative:create-entry",
    description: "建/改条目 · 与节点入口同一份 _entry.json · 先建条目再带 entryKey 开跑",
    params: [
      "key",
      "inputType",
      "userInput",
      "tags",
      "routeGroup",
      "tier",
      "mode",
      "genreCode",
      "storyType",
      "storyTheme",
      "complexity",
      "locale"
    ],
    hints: {
      key: "Entry key, used verbatim as the output directory name. Must be a safe relative directory name (no slashes, no '..').",
      inputType: "How the requirement was given: free text, tag selection, or uploaded works. Recorded so the task panel can show what the author actually submitted.",
      userInput: "The requirement text for this entry.",
      tags: "Raw tag selections when inputType is 'tags': { selections, customTexts }. Not used for routing, recorded for restore.",
      storyType: "Narrative type axis code (see narrative:list-axes).",
      storyTheme: "Narrative theme axis code (see narrative:list-axes)."
    },
    required: [
      "key"
    ],
    requireConfirm: false
  },
  {
    name: "export-result",
    id: "narrative:export-result",
    description: "导出叙事结果到项目目录",
    params: [
      "runId",
      "slug",
      "targetDir"
    ],
    hints: {
      runId: "Run ID of a completed pipeline run",
      slug: "Game slug for the output path. Defaults to '_default'.",
      targetDir: "Explicit export directory. Overrides slug-based default path (.forgeax/games/<slug>/narrative/)."
    },
    required: [
      "runId"
    ],
    requireConfirm: false
  },
  {
    name: "get-ip-dna",
    id: "narrative:get-ip-dna",
    description: "只读:按 runId 读取 IP DNA 层级树摘要(节点/层级/标题),用于审阅与可视化",
    params: [
      "runId"
    ],
    hints: {
      runId: "IP DNA 运行 id(story_timestamp 或目录名)"
    },
    required: [
      "runId"
    ],
    requireConfirm: false
  },
  {
    name: "get-pipeline-nodes",
    id: "narrative:get-pipeline-nodes",
    description: "读取正在运行的管线各步骤节点及状态(仅对内存中活动 run 有效)",
    params: [
      "runId"
    ],
    hints: {
      runId: "活动运行 id"
    },
    required: [
      "runId"
    ],
    requireConfirm: false
  },
  {
    name: "get-review",
    id: "narrative:get-review",
    description: "读取某次运行的评审状态(各步骤 approved/rejected/反馈)",
    params: [
      "dir"
    ],
    hints: {
      dir: "运行输出目录名"
    },
    required: [
      "dir"
    ],
    requireConfirm: false
  },
  {
    name: "get-run-status",
    id: "narrative:get-run-status",
    description: "查询管线运行状态 · 步骤进度 · 结果获取",
    params: [
      "runId",
      "includeResult"
    ],
    hints: {
      runId: "Run ID returned by start-pipeline",
      includeResult: "When true and run is completed, fetch and include the full NarrativeContext result"
    },
    required: [
      "runId"
    ],
    requireConfirm: false
  },
  {
    name: "get-stale-steps",
    id: "narrative:get-stale-steps",
    description: "给定起始步骤,返回会因其变更而过期、需重生成的下游步骤与字段",
    params: [
      "sourceDir",
      "fromStepId"
    ],
    hints: {
      sourceDir: "运行输出目录名",
      fromStepId: "起始步骤 id"
    },
    required: [
      "sourceDir",
      "fromStepId"
    ],
    requireConfirm: false
  },
  {
    name: "get-story-tree",
    id: "narrative:get-story-tree",
    description: "读取某次运行的叙事树结构(分层节点),用于把握整体故事骨架",
    params: [
      "dir"
    ],
    hints: {
      dir: "运行输出目录名(checkpoint 所在)"
    },
    required: [
      "dir"
    ],
    requireConfirm: false
  },
  {
    name: "get-team",
    id: "narrative:get-team",
    description: "查看某个专属团队 · 蒸馏状态与风格签名 / 禁区 / 各席位技能",
    params: [
      "teamId"
    ],
    hints: {
      teamId: "Team id from narrative:list-teams."
    },
    required: [
      "teamId"
    ],
    requireConfirm: false
  },
  {
    name: "ip-dna-analyze-impact",
    id: "narrative:ip-dna-analyze-impact",
    description: "IP DNA 改写影响面分析(蓝图§10/§15):给定改动字段,沿 data-atlas 推导受影响下游与输入层级节点",
    params: [
      "runId",
      "changedKeys"
    ],
    hints: {
      runId: "IP DNA 运行 id",
      changedKeys: "拟改动的 data-atlas 字段键列表(如 ['A.characters'])"
    },
    required: [
      "runId",
      "changedKeys"
    ],
    requireConfirm: false
  },
  {
    name: "ip-dna-cancel",
    id: "narrative:ip-dna-cancel",
    description: "取消生产(§5.1):取消正在运行的 IP DNA 异步任务(与前端「取消生成」按钮能力对等)",
    params: [
      "jobId"
    ],
    hints: {
      jobId: "任务 id(由 async 阶段门返回)"
    },
    required: [
      "jobId"
    ],
    requireConfirm: false
  },
  {
    name: "ip-dna-confirm-scope",
    id: "narrative:ip-dna-confirm-scope",
    description: "确认裁剪范围(§4.4 第①步):回填嵌套层级选择;缺省=全量。确认门终点",
    params: [
      "runId",
      "scopeSelections",
      "scopeFull",
      "adaptationNotes"
    ],
    hints: {
      runId: "运行 id(=时间戳_故事名)",
      scopeSelections: "裁剪范围。两种形态二选一:(a) 嵌套层级选择 nodeId(+childRange);(b) 最小单元闭区间 leafRange(每部=一个区间,起止为叶子 id,文档序)。缺省=全量改编",
      scopeFull: "是否全量(无 selections 时默认 true)",
      adaptationNotes: "作者自定义改编补充(§5.1 自由文本):描述所选范围想怎么改;下游据此判断改哪些维度并定点替换。缺省=忠实把原 IP 转化为目标品类叙事"
    },
    required: [
      "runId"
    ],
    requireConfirm: false
  },
  {
    name: "ip-dna-confirm-units",
    id: "narrative:ip-dna-confirm-units",
    description: "确认游戏单元 + 改编维度(§4.4 第②③步):回填 game_unit_plan/adaptation_dimensions/mode",
    params: [
      "runId",
      "gameUnitPlan",
      "adaptationDimensions",
      "mode",
      "targetUnits"
    ],
    hints: {
      runId: "运行 id(=时间戳_故事名)",
      gameUnitPlan: "用户精确选填的游戏单元规划(§4.4 第②步);提供则优先采用并直接生成 N 个游戏单元,覆盖默认切分。契约:一行/一部=一个游戏单元(1:1),units 数即游戏单元数。",
      adaptationDimensions: "改编维度(叙事层级数+模板字段);缺省=全维度模板",
      mode: "完整游戏模式(仅在不传 gameUnitPlan 时按默认切分参考)",
      targetUnits: "默认切分时'每游戏单元最小单元数'(默认 25,非游戏单元个数);传 gameUnitPlan 时忽略"
    },
    required: [
      "runId"
    ],
    requireConfirm: false
  },
  {
    name: "ip-dna-decompose",
    id: "narrative:ip-dna-decompose",
    description: "IP 半自动(§5 步骤6-10):体量超线时按标记/单元闭环拆解→再标准化→重写骨架层级树",
    params: [
      "runId"
    ],
    hints: {
      runId: "运行 id(=时间戳_故事名)"
    },
    required: [
      "runId"
    ],
    requireConfirm: false
  },
  {
    name: "ip-dna-extract",
    id: "narrative:ip-dna-extract",
    description: "生成 scoped IP DNA(§5 步骤4):仅提取不跑下游生成,消费已确认裁剪范围/单元/维度",
    params: [
      "runId",
      "pipelineFamily",
      "tier",
      "generationMode",
      "complexity",
      "maxGameUnits",
      "equipOperators",
      "model",
      "async"
    ],
    hints: {
      runId: "运行 id(=时间戳_故事名)",
      pipelineFamily: "可选,生成管线族",
      tier: "可选,透传生成管线 tier",
      generationMode: "可选,透传生成管线 mode",
      complexity: "可选,目标复杂度 1-5",
      maxGameUnits: "可选,最多处理多少个游戏单元",
      equipOperators: "为每个游戏单元装备三视角算子并消费,默认 false",
      model: "可选,覆盖默认 LLM 模型",
      async: "true 立即返回 jobId,轮询 ip-dna-get-job"
    },
    required: [
      "runId"
    ],
    requireConfirm: false
  },
  {
    name: "ip-dna-generate",
    id: "narrative:ip-dna-generate",
    description: "开始生成(§5 步骤4→5):提取(=生成 scoped IP DNA)+下游叙事生成自动串跑。改编范围确认后触发,中途不暂停",
    params: [
      "runId",
      "pipelineFamily",
      "tier",
      "generationMode",
      "complexity",
      "maxGameUnits",
      "equipOperators",
      "model",
      "async"
    ],
    hints: {
      runId: "运行 id(=时间戳_故事名)",
      pipelineFamily: "可选,生成管线族",
      tier: "可选,透传生成管线 tier",
      generationMode: "可选,透传生成管线 mode",
      complexity: "可选,目标复杂度 1-5",
      maxGameUnits: "可选,最多生成多少个游戏单元",
      equipOperators: "为每个游戏单元装备三视角算子并消费,默认 false",
      model: "可选,覆盖默认 LLM 模型",
      async: "true 立即返回 jobId,轮询 ip-dna-get-job"
    },
    required: [
      "runId"
    ],
    requireConfirm: false
  },
  {
    name: "ip-dna-get-hierarchy",
    id: "narrative:ip-dna-get-hierarchy",
    description: "只读:摄入后的层级树 + 默认裁剪/单元/维度 + 体量,供确认裁剪范围引导(半自动/agent 共用)",
    params: [
      "runId"
    ],
    hints: {
      runId: "运行 id(=时间戳_故事名)"
    },
    required: [
      "runId"
    ],
    requireConfirm: false
  },
  {
    name: "ip-dna-get-job",
    id: "narrative:ip-dna-get-job",
    description: "轮询异步任务(ingest/extract/generate)的状态/进度/结果",
    params: [
      "jobId"
    ],
    hints: {
      jobId: "任务 id(由 async 阶段门返回)"
    },
    required: [
      "jobId"
    ],
    requireConfirm: false
  },
  {
    name: "ip-dna-ingest",
    id: "narrative:ip-dna-ingest",
    description: "IP 半自动阶段门①(§5.1):摄入+标准化+建树(含干扰项过滤),停在确认裁剪范围前。返回层级树骨架+体量/拆解建议+默认裁剪/单元/维度",
    params: [
      "files",
      "title",
      "decompose",
      "model",
      "async",
      "storyTimestamp"
    ],
    hints: {
      files: "输入文件(至少一个)。三种给法任选:path 工程内路径(聊天附件走这条)、content 文本、contentBase64 二进制",
      title: "可选,故事标题(缺省取首文件名)",
      decompose: "超体量时执行拆解闭环(再标准化),默认 false",
      model: "可选,覆盖默认 LLM 模型",
      async: "true 立即返回 jobId,轮询 ip-dna-get-job 取层级树摘要",
      storyTimestamp: "可选,指定完整故事时间戳(续跑/对齐 jobId)"
    },
    required: [
      "files"
    ],
    requireConfirm: false
  },
  {
    name: "ip-dna-start",
    id: "narrative:ip-dna-start",
    description: "IP DNA 端到端入口(蓝图§5):上传/指定全模态 IP 文件 → 理解 → 改编 → (可选)全品类游戏叙事生成。可能较久,默认仅产出 IP DNA+改编指令+生成输入",
    params: [
      "files",
      "title",
      "mode",
      "scopeSelections",
      "gameUnitPlan",
      "adaptationDimensions",
      "adaptationNotes",
      "targetUnits",
      "complexity",
      "runGeneration",
      "maxGameUnits",
      "pipelineFamily",
      "tier",
      "generationMode",
      "routeGroup",
      "genreCode",
      "model"
    ],
    hints: {
      files: "输入文件(至少一个)。三种给法任选:path 工程内路径(聊天附件走这条)、content 文本、contentBase64 二进制",
      title: "可选,故事标题(缺省取首文件名)",
      mode: "完整游戏模式,默认 series",
      scopeSelections: "§4.4 第①步对话产物:裁剪范围(嵌套层级选择)。缺省=全量改编",
      gameUnitPlan: "§4.4 第②步对话产物:用户精确选填的游戏单元规划。缺省=默认切分",
      adaptationDimensions: "§4.4 第③步对话产物:改编维度(叙事层级数 + 模板字段)。缺省=全维度模板",
      adaptationNotes: "§5.1 自定义补充:作者改编意图自由文本(描述所选范围想怎么改);下游据此判断改哪些维度并定点替换。缺省=忠实把原 IP 转化为目标品类叙事",
      targetUnits: "可选,默认切分时'每游戏单元最小单元数'(默认 25,非游戏单元个数);传 gameUnitPlan 时忽略",
      complexity: "可选,目标复杂度 1-5",
      runGeneration: "是否真正跑生成管线,默认 false(仅理解+改编)",
      maxGameUnits: "可选,最多生成多少个游戏单元",
      pipelineFamily: "可选,生成管线族",
      tier: "可选,透传生成管线 tier",
      generationMode: "可选,透传生成管线 mode",
      routeGroup: "可选,ROUTING 路由组(§5.1),与主管线对齐",
      genreCode: "可选,品类编码(如 rpg-jrpg/adv-interactive);决定下游 vn/rpg 生成管线",
      model: "可选,覆盖默认 LLM 模型"
    },
    required: [
      "files"
    ],
    requireConfirm: false
  },
  {
    name: "list-assets",
    id: "narrative:list-assets",
    description: "列出某条目里作者已确认为定稿的产物 · 下游生成只引用这张表里的文件",
    params: [
      "entryKey",
      "pipelineId"
    ],
    hints: {
      entryKey: "条目键（任务的磁盘目录名）；不是 runId —— runId 是内存态，重启即失效",
      pipelineId: "只看某条泳道；缺省给整个条目的定稿清单"
    },
    required: [
      "entryKey"
    ],
    requireConfirm: false
  },
  {
    name: "list-axes",
    id: "narrative:list-axes",
    description: "三轴词表 · 叙事类型 / 题材 / 结构 · 填 storyType 与 storyTheme 前先查",
    params: [],
    hints: {},
    required: [],
    requireConfirm: false
  },
  {
    name: "list-files",
    id: "narrative:list-files",
    description: "列出某次运行(runId 或输出目录名)的全部产出文件",
    params: [
      "runId"
    ],
    hints: {
      runId: "运行 id 或输出目录名"
    },
    required: [
      "runId"
    ],
    requireConfirm: false
  },
  {
    name: "list-genres",
    id: "narrative:list-genres",
    description: "列出全部游戏品类(按大类分组,含 code/名称/tier/叙事比重/模板),选 genreCode 前先查",
    params: [],
    hints: {},
    required: [],
    requireConfirm: false
  },
  {
    name: "list-modes",
    id: "narrative:list-modes",
    description: "列出各 tier 可用的运行模式/模板及步骤数",
    params: [],
    hints: {},
    required: [],
    requireConfirm: false
  },
  {
    name: "list-runs",
    id: "narrative:list-runs",
    description: "列出历史运行记录 · 支持断点续跑与分叉重生成",
    params: [
      "limit"
    ],
    hints: {
      limit: "Max number of history entries to return"
    },
    required: [],
    requireConfirm: false
  },
  {
    name: "list-seats",
    id: "narrative:list-seats",
    description: "列出全部二十席叙事单品助手 · id/名称/kind/是否能被单独调用(canRunStandalone)/单跑前还缺什么输入",
    params: [],
    hints: {},
    required: [],
    requireConfirm: false
  },
  {
    name: "list-teams",
    id: "narrative:list-teams",
    description: "列出自定义专属创作团队 · 单本模板助手与作家创作顾问 · 只有 ready 的能带进生成",
    params: [],
    hints: {},
    required: [],
    requireConfirm: false
  },
  {
    name: "load-history",
    id: "narrative:load-history",
    description: "加载某条历史运行记录的详情(拿到 tier/mode/result 及目录名,供后续续跑/编辑)",
    params: [
      "key"
    ],
    hints: {
      key: "历史记录 key(来自 list-runs)"
    },
    required: [
      "key"
    ],
    requireConfirm: false
  },
  {
    name: "read-file",
    id: "narrative:read-file",
    description: "读取某次运行下指定相对路径的产出文件内容(json/文本,自动截断防爆上下文)",
    params: [
      "runId",
      "filePath"
    ],
    hints: {
      runId: "运行 id 或输出目录名",
      filePath: "相对该运行目录的文件路径,如 narrative.md / characters/hero.md"
    },
    required: [
      "runId",
      "filePath"
    ],
    requireConfirm: false
  },
  {
    name: "regenerate-step",
    id: "narrative:regenerate-step",
    description: "重生成指定步骤 · 支持用户指令注入与节点级过滤",
    params: [
      "sourceDir",
      "fromStepId",
      "userInstructions",
      "stopAfterStep",
      "model",
      "skipSteps",
      "nodeFilter",
      "editDrafts"
    ],
    hints: {
      sourceDir: "Source run directory key (from list-runs 'key' field)",
      fromStepId: "Step ID to regenerate from (e.g. 'story_framework', 'outline_batch')",
      userInstructions: "Natural language instructions for how to change the regenerated content",
      stopAfterStep: "Stop pipeline after this step instead of running to completion",
      model: "Override LLM model for this regeneration",
      skipSteps: "Step IDs to skip during regeneration",
      nodeFilter: "Per-step node ID filter: only regenerate listed nodes within each step (partial regen)",
      editDrafts: "Pre-edited content drafts keyed by stepId or 'stepId::nodeId'"
    },
    required: [
      "sourceDir",
      "fromStepId"
    ],
    requireConfirm: false
  },
  {
    name: "restore-original",
    id: "narrative:restore-original",
    description: "把某一步(或某个节点)的内容还原为模型原稿，撤掉编辑账本里那一条 · 没存过原稿则报错",
    params: [
      "sourceDir",
      "stepId",
      "nodeId"
    ],
    hints: {},
    required: [
      "sourceDir",
      "stepId"
    ],
    requireConfirm: false
  },
  {
    name: "resume-pipeline",
    id: "narrative:resume-pipeline",
    description: "从 checkpoint 断点续跑某次未完成的运行(写入同一目录)",
    params: [
      "dir",
      "model"
    ],
    hints: {
      dir: "运行输出目录名(含 checkpoint)",
      model: "可选,覆盖默认 LLM 模型"
    },
    required: [
      "dir"
    ],
    requireConfirm: false
  },
  {
    name: "run-seat",
    id: "narrative:run-seat",
    description: "按席位 id 单独跑一个叙事单品助手(二十席之一) · 不遍历全管线 · 给 entryKey 可并入该条目落盘供后续管线消费",
    params: [
      "seatId",
      "userInput",
      "ctx",
      "inputs",
      "model",
      "entryKey"
    ],
    hints: {
      seatId: "席位 id(先用 narrative:list-seats 查有哪些席、canRunStandalone 是否为真)，也接受直接传 step id",
      ctx: "补齐/覆盖上下文字段，如上游席位的产出",
      inputs: "覆盖/追加输入字段，写入后再校验 requiredInputs",
      entryKey: "绑定到某条目并落盘(G2)；不给则只在响应体里回结果，不落盘"
    },
    required: [
      "seatId"
    ],
    requireConfirm: false
  },
  {
    name: "save-step-edit",
    id: "narrative:save-step-edit",
    description: "改稿落盘 · 与界面文本视图保存同一端点 · 原稿自动存 _original/ 供还原 · 省略 editedContent 只回读不写盘",
    params: [
      "sourceDir",
      "stepId",
      "nodeId",
      "editedContent",
      "userInput"
    ],
    hints: {
      editedContent: "省略则只回读当前内容、不写盘",
      userInput: "这一改的说明/意图，供后续影响面分析与重新生成参考"
    },
    required: [
      "sourceDir",
      "stepId"
    ],
    requireConfirm: false
  },
  {
    name: "set-review",
    id: "narrative:set-review",
    description: "标记某步骤的评审结论(approved/rejected/pending)并附反馈",
    params: [
      "dir",
      "stepId",
      "status",
      "feedback",
      "regenerateRunId"
    ],
    hints: {
      dir: "运行输出目录名",
      stepId: "步骤 id",
      status: "评审结论",
      feedback: "可选,评审反馈",
      regenerateRunId: "可选,关联的重生成 run id"
    },
    required: [
      "dir",
      "stepId",
      "status"
    ],
    requireConfirm: false
  },
  {
    name: "start-pipeline",
    id: "narrative:start-pipeline",
    description: "启动叙事管线 · 支持 117 品类 × 9 模板 · 自动 Tier/Mode 路由",
    params: [
      "userInput",
      "tier",
      "mode",
      "genreCode",
      "complexity",
      "routeGroup",
      "routingMode",
      "model",
      "teamId",
      "storyType",
      "storyTheme",
      "entryKey",
      "activateSeats"
    ],
    hints: {
      userInput: "Story requirements in any language (free text). May include genre hints, theme, setting, character concepts, or an entire brief.",
      tier: "Narrative intensity tier. Omit to let the pipeline auto-detect via LLM.",
      mode: "Pipeline mode (step sequence). Omit to use tier default (design_auto).",
      genreCode: "Explicit genre code from the 94-entry taxonomy (e.g. 'rpg-jrpg'). Skips LLM genre detection when provided.",
      complexity: "Narrative complexity level (1=minimal, 5=maximum depth).",
      routeGroup: "Route group: 'planning' for game design pipeline, 'narrative' for story-only.",
      routingMode: "Routing strategy. 'auto' = full LLM detection, 'semi' = tier given / mode auto, 'manual' = both given.",
      model: "Override LLM model for this run (e.g. 'gemini-2.5-pro'). Uses NARRATIVE_MODEL env default when omitted.",
      teamId: "Custom creative team to bring along, distilled from user-supplied books or an author's body of work. Call narrative:list-teams first and pass an id whose status is 'ready'; other statuses are treated as no team at all. When the user mentions a team via '@', the inserted text carries 'team=<id>'.",
      storyType: "Narrative type axis code (call narrative:list-axes for the vocabulary). Omit to let the pipeline infer it from the request text.",
      storyTheme: "Narrative theme axis code (call narrative:list-axes for the vocabulary). Omit to let the pipeline infer it. The third axis, narrative structure, is derived server-side from type + theme and cannot be set directly.",
      entryKey: "Entry this run belongs to, as returned by narrative:create-entry. Omit and the run mints its own timestamp directory with no _entry.json, which leaves it in the left rail with no recorded parameters. Create the entry first when you want the same entry record the node canvas produces.",
      activateSeats: "Off-by-default polish seats to attach after plot generation. Each one rewrites the generated script in place as a new version of the same field. All off by default: three extra LLM passes over the plot layer."
    },
    required: [
      "userInput"
    ],
    requireConfirm: false
  }
];
var BY_NAME = new Map(CATALOG.map((entry) => [entry.name, entry]));

// extension/src/credentials.ts
import { chmodSync, existsSync as existsSync2, mkdirSync, readFileSync as readFileSync2, renameSync, writeFileSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname as dirname2, resolve as resolve2 } from "node:path";
import { randomUUID } from "node:crypto";

// extension/src/locate.ts
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
var WINDOWS = process.platform === "win32";
function findOnPath(name) {
  const candidates = WINDOWS ? [`${name}.cmd`, `${name}.exe`, `${name}.bat`, name] : [name];
  for (const dir of (process.env.PATH ?? "").split(WINDOWS ? ";" : ":")) {
    if (!dir)
      continue;
    for (const file of candidates) {
      const full = resolve(dir, file);
      if (existsSync(full))
        return full;
    }
  }
  return;
}
function jsEntryBehind(binPath, packageName, binName) {
  try {
    const real = realpathSync(binPath);
    if (real.endsWith(".js") || real.endsWith(".mjs"))
      return real;
  } catch {}
  const root = join(dirname(binPath), "node_modules", ...packageName.split("/"));
  return binEntry(root, join(root, "package.json"), binName);
}
function pickBinPath(bin, binName) {
  if (typeof bin === "string")
    return bin;
  if (!bin || typeof bin !== "object")
    return;
  const table = bin;
  return table[binName] ?? Object.values(table)[0];
}
function binEntry(root, manifest, binName) {
  if (!existsSync(manifest))
    return;
  try {
    const relative = pickBinPath(JSON.parse(readFileSync(manifest, "utf8")).bin, binName);
    if (!relative)
      return;
    const entry = join(root, relative);
    return existsSync(entry) ? entry : undefined;
  } catch {
    return;
  }
}
function globalRoots() {
  const prefix = process.env.npm_config_prefix?.trim();
  const nodeDir = dirname(process.execPath);
  const roots = prefix ? [WINDOWS ? join(prefix, "node_modules") : join(prefix, "lib", "node_modules")] : [];
  if (WINDOWS) {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    roots.push(join(appData, "npm", "node_modules"), join(nodeDir, "node_modules"));
  } else {
    roots.push(join(nodeDir, "..", "lib", "node_modules"), "/usr/local/lib/node_modules", "/usr/lib/node_modules", join(homedir(), ".npm-global", "lib", "node_modules"));
  }
  return roots;
}
function jsEntryInGlobalRoots(packageName, binName) {
  for (const root of globalRoots()) {
    const manifest = join(root, ...packageName.split("/"), "package.json");
    if (!existsSync(manifest))
      continue;
    const entry = binEntry(join(root, ...packageName.split("/")), manifest, binName);
    if (entry)
      return entry;
  }
  return;
}
function locateNodeBin(binName, packageName) {
  const onPath = findOnPath(binName);
  if (onPath) {
    const entry = jsEntryBehind(onPath, packageName, binName);
    if (entry)
      return { command: process.execPath, args: [entry] };
    return { command: onPath, args: [] };
  }
  const global = jsEntryInGlobalRoots(packageName, binName);
  return global ? { command: process.execPath, args: [global] } : undefined;
}
function locateNpx() {
  const found = findOnPath("npx");
  if (!found)
    return;
  const entry = jsEntryBehind(found, "npm", "npx");
  return entry ? { command: process.execPath, args: [entry] } : { command: found, args: [] };
}
function needsShell(launcher) {
  return WINDOWS && /\.(cmd|bat)$/i.test(launcher.command);
}
function spawnForm(launcher) {
  const shell = needsShell(launcher);
  if (!shell)
    return { command: launcher.command, args: launcher.args, shell };
  const quote = (value) => /\s/u.test(value) ? `"${value}"` : value;
  return { command: quote(launcher.command), args: launcher.args.map(quote), shell };
}
function findHostAgent() {
  const override = process.env.FORGEAX_NARRATIVE_HOST_AGENT?.trim();
  if (override)
    return existsSync(override) ? override : undefined;
  const onPath = findOnPath("codex");
  if (onPath)
    return onPath;
  if (!WINDOWS)
    return;
  const base = join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "OpenAI", "Codex", "bin");
  if (!existsSync(base))
    return;
  try {
    const found = readdirSync(base).map((entry) => join(base, entry, "codex.exe")).filter((file) => existsSync(file) && statSync(file).isFile()).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    return found[0];
  } catch {}
  return;
}

// extension/src/credentials.ts
var PRECEDENCE = ["narrative", "engine", "platform"];
var NARRATIVE_ENV = "FORGEAX_NARRATIVE_API_KEY";
var ENGINE_KEY_ENV = "FORGEAX_LITELLM_API_KEY";
var ENGINE_URL_ENV = "FORGEAX_LITELLM_BASE_URL";
function defaultCredentialFile() {
  return resolve2(homedir2(), ".forgeax", "narrative", "credentials.json");
}
var trimmed = (name) => process.env[name]?.trim() || undefined;
function fromNarrative(file) {
  const direct = trimmed(NARRATIVE_ENV) ?? trimmed("GEMINI_API_KEY");
  if (direct) {
    return {
      source: "narrative",
      origin: trimmed(NARRATIVE_ENV) ? `${NARRATIVE_ENV} (env)` : "GEMINI_API_KEY (env)",
      env: { GEMINI_API_KEY: direct },
      degraded: false
    };
  }
  const proxyKey = trimmed("LITELLM_PROXY_KEY");
  const proxyUrl = trimmed("LLM_PROXY_URL");
  if (proxyKey && proxyUrl) {
    return {
      source: "narrative",
      origin: "LITELLM_PROXY_KEY + LLM_PROXY_URL (env)",
      env: { LITELLM_PROXY_KEY: proxyKey, LLM_PROXY_URL: proxyUrl },
      degraded: false
    };
  }
  if (!existsSync2(file))
    return;
  const value = JSON.parse(readFileSync2(file, "utf8"));
  if (typeof value.apiKey !== "string" || !value.apiKey.trim()) {
    throw new Error(`narrative_credential_invalid: ${file} has no usable apiKey`);
  }
  const key = value.apiKey.trim();
  const url = typeof value.baseUrl === "string" ? value.baseUrl.trim() : "";
  return {
    source: "narrative",
    origin: file,
    env: url ? { LITELLM_PROXY_KEY: key, LLM_PROXY_URL: url } : { GEMINI_API_KEY: key },
    degraded: false
  };
}
function fromEngine() {
  const key = trimmed(ENGINE_KEY_ENV);
  const url = trimmed(ENGINE_URL_ENV);
  if (!key || !url)
    return;
  return {
    source: "engine",
    origin: `${ENGINE_KEY_ENV} + ${ENGINE_URL_ENV} (env, read-only)`,
    env: { LITELLM_PROXY_KEY: key, LLM_PROXY_URL: url },
    degraded: false
  };
}
function fromPlatform() {
  const command = findHostAgent();
  if (!command)
    return;
  const codexHome = trimmed("CODEX_HOME");
  return {
    source: "platform",
    origin: `host agent via \`${command} exec\``,
    env: {
      NARRATIVE_LLM_BACKEND: "host-agent",
      NARRATIVE_HOST_AGENT_CMD: command,
      ...codexHome ? { CODEX_HOME: codexHome } : {}
    },
    degraded: true
  };
}
var NO_CREDENTIAL = {
  source: "none",
  origin: "nothing configured and no host agent found",
  env: {},
  degraded: true
};
function resolveCredential(file = defaultCredentialFile()) {
  for (const source of PRECEDENCE) {
    const found = source === "narrative" ? fromNarrative(file) : source === "engine" ? fromEngine() : fromPlatform();
    if (found)
      return found;
  }
  return NO_CREDENTIAL;
}
function writeCredential(key, baseUrl, file = defaultCredentialFile()) {
  mkdirSync(dirname2(file), { recursive: true, mode: 448 });
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify({ apiKey: key, ...baseUrl ? { baseUrl } : {} }) + `
`, { mode: 384 });
  renameSync(temp, file);
  chmodSync(file, 384);
}
async function readKeyFromStdin() {
  const chunks = [];
  for await (const chunk of process.stdin)
    chunks.push(chunk);
  const key = Buffer.concat(chunks).toString("utf8").trim();
  if (!key)
    throw new Error("narrative_credential_missing: no key on stdin");
  return key;
}

// extension/src/service.ts
import { spawn } from "node:child_process";
import { existsSync as existsSync3, mkdirSync as mkdirSync2, openSync, readFileSync as readFileSync3, rmSync, writeFileSync as writeFileSync2 } from "node:fs";
import { resolve as resolve3 } from "node:path";
var DEFAULT_PORT = 8900;
var DEFAULT_BASE_URL = `http://127.0.0.1:${DEFAULT_PORT}`;
var SERVICE_PACKAGE = "@forgeax-extension/narrative";
var COMMAND_OVERRIDE = "FORGEAX_NARRATIVE_SERVICE_CMD";
async function probeHealth(baseUrl, timeoutMs = 3000) {
  try {
    const response = await fetch(new URL("/api/health", baseUrl), { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok)
      return;
    const value = await response.json();
    if (value.service !== "narrative-studio")
      return;
    return {
      status: String(value.status),
      service: value.service,
      version: String(value.version),
      ...typeof value.backend === "string" ? { backend: value.backend } : {},
      ...typeof value.backendError === "string" ? { backendError: value.backendError } : {},
      ...typeof value.projectRoot === "string" ? { projectRoot: value.projectRoot } : {}
    };
  } catch {
    return;
  }
}
var samePath = (a, b) => (WINDOWS ? a.toLowerCase() : a).replace(/[\\/]+$/u, "") === (WINDOWS ? b.toLowerCase() : b).replace(/[\\/]+$/u, "");
function foreignService(health, expected) {
  if (!health.projectRoot) {
    if (expected.startedByUs)
      return;
    return `its health reports no project, so it did not come from this shell (version ${health.version})`;
  }
  if (samePath(health.projectRoot, expected.projectRoot))
    return;
  return `it was started for ${health.projectRoot}, not ${expected.projectRoot} (version ${health.version})`;
}
var pidFile = (stateDir) => resolve3(stateDir, "service.pid");
var logFile = (stateDir) => resolve3(stateDir, "service.log");
function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function logTail(stateDir, lines = 12) {
  try {
    return readFileSync3(logFile(stateDir), "utf8").trimEnd().split(`
`).slice(-lines).join(`
`);
  } catch {
    return "(no output)";
  }
}
function recordedPid(stateDir) {
  const path = pidFile(stateDir);
  if (!existsSync3(path))
    return;
  const pid = Number.parseInt(readFileSync3(path, "utf8").trim(), 10);
  if (!Number.isInteger(pid) || !running(pid)) {
    rmSync(path, { force: true });
    return;
  }
  return pid;
}
var SERVICE_BIN = "forgeax-narrative";
function launchCommand(version) {
  const override = process.env[COMMAND_OVERRIDE]?.trim();
  if (override) {
    if (existsSync3(override))
      return { command: override, args: [] };
    const [command, ...args] = override.split(/\s+/u);
    return { command, args };
  }
  const installed = locateNodeBin(SERVICE_BIN, SERVICE_PACKAGE);
  if (installed)
    return { ...installed, args: [...installed.args, "serve"] };
  const npx = locateNpx();
  if (!npx) {
    throw new Error(`narrative_service_unavailable: ${SERVICE_PACKAGE} is not installed and npx was not found.
` + `Install the service once with \`npm i -g ${SERVICE_PACKAGE}\`.`);
  }
  return {
    ...npx,
    args: [...npx.args, "-y", `--package=${SERVICE_PACKAGE}@${version}`, "--", SERVICE_BIN, "serve"]
  };
}
async function startService(options) {
  const existing = await probeHealth(options.baseUrl);
  if (existing)
    return { started: false, pid: recordedPid(options.stateDir), baseUrl: options.baseUrl, health: existing };
  mkdirSync2(options.stateDir, { recursive: true });
  const log = openSync(logFile(options.stateDir), "a");
  const { command, args, shell } = spawnForm(launchCommand(options.version));
  const child = spawn(command, args, {
    detached: true,
    shell,
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      ...options.env,
      FORGEAX_PROJECT_ROOT: options.projectRoot,
      NARRATIVE_PORT: String(new URL(options.baseUrl).port || DEFAULT_PORT),
      NARRATIVE_IDLE_TIMEOUT_MS: String(options.idleTimeoutMs)
    }
  });
  let spawnFailure;
  child.on("error", (error) => {
    spawnFailure = error;
  });
  child.unref();
  if (child.pid)
    writeFileSync2(pidFile(options.stateDir), `${child.pid}
`, { mode: 384 });
  const deadline = Date.now() + (options.readyTimeoutMs ?? 90000);
  while (Date.now() < deadline) {
    const health = await probeHealth(options.baseUrl, 2000);
    if (health)
      return { started: true, pid: child.pid, baseUrl: options.baseUrl, health };
    if (spawnFailure)
      break;
    if (child.pid && !running(child.pid))
      break;
    await new Promise((done) => setTimeout(done, 750));
  }
  throw new Error(`narrative_service_unavailable: did not answer at ${options.baseUrl}
` + `launched: ${command} ${args.join(" ")}
` + (spawnFailure ? `spawn failed: ${spawnFailure.message}
` : "") + `log (${logFile(options.stateDir)}):
${logTail(options.stateDir)}
` + `If the registry is unreachable, install the service once with ` + `\`npm i -g ${SERVICE_PACKAGE}\` and retry; start will then use it directly.`);
}
function stopService(stateDir) {
  const pid = recordedPid(stateDir);
  if (!pid)
    return { stopped: false };
  try {
    process.kill(pid);
  } catch {}
  rmSync(pidFile(stateDir), { force: true });
  return { stopped: true, pid };
}

// extension/src/verbs.ts
import { readFileSync as readFileSync4 } from "node:fs";
var DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
var LIFECYCLE = ["doctor", "status", "start", "stop", "open", "tools", "call"];
function parseOptions(input, usage) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    json: false,
    idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
    timeoutMs: 240000,
    positional: []
  };
  for (let i = 0;i < input.length; i++) {
    const option = input[i];
    if (option === "--json")
      options.json = true;
    else if (option === "--base-url" && input[i + 1])
      options.baseUrl = input[++i];
    else if (option === "--idle-timeout" && input[i + 1])
      options.idleTimeoutMs = Number(input[++i]) * 1000;
    else if (option === "--timeout" && input[i + 1])
      options.timeoutMs = Number(input[++i]) * 1000;
    else if (option === "--args-json" && input[i + 1])
      options.args = JSON.parse(input[++i]);
    else if (option === "--args-file" && input[i + 1])
      options.args = JSON.parse(readFileSync4(input[++i], "utf8"));
    else if (!option.startsWith("-"))
      options.positional.push(option);
    else
      throw new Error(`narrative_arguments_invalid: ${usage}`);
  }
  new URL(options.baseUrl);
  if (!Number.isFinite(options.idleTimeoutMs) || options.idleTimeoutMs < 0) {
    throw new Error("narrative_arguments_invalid: --idle-timeout takes seconds");
  }
  return options;
}
function plannedBackend(resolution) {
  if (resolution.env.LLM_PROXY_URL)
    return "proxy";
  if (resolution.env.GEMINI_API_KEY)
    return "gemini";
  if (resolution.env.NARRATIVE_LLM_BACKEND === "host-agent")
    return "host-agent";
  return "none";
}
function credentialReport(resolution, health) {
  const planned = plannedBackend(resolution);
  const chosen = health?.backend?.replace(/-blocked$/u, "");
  return {
    credentialSource: resolution.source,
    credentialOrigin: resolution.origin,
    degraded: resolution.degraded,
    ...health ? { serviceBackend: health.backend ?? "unknown" } : {},
    ...chosen && chosen !== planned ? { credentialNote: `the running service is using ${chosen}; restarting it would use ${planned}` } : {}
  };
}
function conflictReport(health, context, baseUrl) {
  const reason = foreignService(health, {
    projectRoot: context.projectRoot,
    startedByUs: recordedPid(context.stateDir) !== undefined
  });
  if (!reason)
    return;
  return `narrative_service_conflict: something else is already answering at ${baseUrl} — ${reason}.
` + `Its credential, its version and where it writes are not the ones reported here, so driving it ` + `would produce results this installation cannot account for.
` + `Stop that process, or give this one a port of its own: ` + `\`start --base-url http://127.0.0.1:8901\` (pass the same --base-url to every later command).`;
}
var CONFIGURE_A_KEY = `Configure a key without putting it in argv or shell history:
` + "  <your key> | narrative enable --with-key-stdin";
function credentialBlocker(resolution) {
  if (resolution.source !== "none")
    return;
  return `narrative_credential_missing: no API key and no host agent to borrow.
${CONFIGURE_A_KEY}
` + "Or install the Codex CLI so the workshop can borrow the host model.";
}
function generationBlocker(health) {
  if (health.backend !== "host-agent-blocked")
    return;
  return `narrative_generation_unavailable: the workshop has no key of its own, and cannot borrow ` + `the host's model from where it is running.
${health.backendError ?? ""}
${CONFIGURE_A_KEY}`;
}
async function diagnose(context, options, operation) {
  const resolution = resolveCredential();
  const health = await probeHealth(options.baseUrl);
  const blocker = health ? generationBlocker(health) : credentialBlocker(resolution);
  const conflict = health ? conflictReport(health, context, options.baseUrl) : undefined;
  return {
    ok: !conflict && !blocker,
    operation,
    projectRoot: context.projectRoot,
    stateDir: context.stateDir,
    baseUrl: options.baseUrl,
    service: health ?? null,
    pid: recordedPid(context.stateDir) ?? null,
    ...credentialReport(resolution, health),
    ...conflict ? { conflict } : {},
    ...blocker ? { blocked: blocker } : {}
  };
}
async function dispatch(context, argv) {
  const [operation, ...rest] = argv;
  if (operation === "doctor" || operation === "status") {
    return diagnose(context, parseOptions(rest, `${operation} [--base-url URL] [--json]`), operation);
  }
  if (operation === "start") {
    const options = parseOptions(rest, "start [--base-url URL] [--idle-timeout SECONDS] [--json]");
    const resolution = resolveCredential();
    const existing = await probeHealth(options.baseUrl);
    if (existing) {
      const conflict = conflictReport(existing, context, options.baseUrl);
      if (conflict)
        throw new Error(conflict);
    }
    const blocker = credentialBlocker(resolution);
    if (blocker && !existing)
      throw new Error(blocker);
    const result = await startService({
      projectRoot: context.projectRoot,
      stateDir: context.stateDir,
      baseUrl: options.baseUrl,
      env: resolution.env,
      version: context.serviceVersion,
      idleTimeoutMs: options.idleTimeoutMs
    });
    const unusable = generationBlocker(result.health);
    return {
      ...result,
      url: options.baseUrl,
      ...credentialReport(resolution, result.health),
      ...unusable ? { blocked: unusable } : {}
    };
  }
  if (operation === "stop") {
    parseOptions(rest, "stop [--json]");
    return stopService(context.stateDir);
  }
  if (operation === "open") {
    const options = parseOptions(rest, "open [--base-url URL] [--json]");
    const health = await probeHealth(options.baseUrl);
    const conflict = health ? conflictReport(health, context, options.baseUrl) : undefined;
    if (conflict)
      throw new Error(conflict);
    return {
      url: options.baseUrl,
      running: Boolean(health),
      service: health ?? null,
      hint: health ? "Offer this address to the user." : "Run `start` first."
    };
  }
  if (operation === "tools") {
    parseOptions(rest, "tools [--json]");
    return { count: CATALOG.length, tools: CATALOG };
  }
  const tool = operation === "call" ? rest[0] : operation;
  const tail = operation === "call" ? rest.slice(1) : rest;
  if (tool && BY_NAME.has(tool)) {
    const entry = BY_NAME.get(tool);
    const options = parseOptions(tail, `${tool} --args-json '{...}' | --args-file PATH`);
    const args = options.args ?? {};
    const missing = entry.required.filter((name) => !(name in args));
    if (missing.length)
      throw new Error(`narrative_arguments_invalid: ${tool} requires ${missing.join(", ")}`);
    const health = await probeHealth(options.baseUrl);
    if (!health) {
      throw new Error(`narrative_service_unavailable: nothing answering at ${options.baseUrl}; run \`start\` first`);
    }
    const conflict = conflictReport(health, context, options.baseUrl);
    if (conflict)
      throw new Error(conflict);
    const response = await fetch(new URL(`/api/tools/${tool}`, options.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ args, projectRoot: context.projectRoot }),
      signal: AbortSignal.timeout(options.timeoutMs)
    });
    const body = await response.json();
    if (!response.ok || body.ok === false)
      throw new Error(`${tool}_failed: ${body.error ?? response.statusText}`);
    return { tool, value: body.value };
  }
  throw new Error(`narrative_arguments_invalid: unknown operation ${operation ?? "(none)"}; ` + `expected ${LIFECYCLE.join(", ")} or a tool name from \`tools --json\``);
}

// extension/cli.ts
var INSTALL_SCHEMA = 1;
async function check(context, args) {
  let baseUrl = DEFAULT_BASE_URL;
  let model;
  let credentialBaseUrl;
  let withKeyStdin = false;
  for (let i = 0;i < args.length; i++) {
    const option = args[i];
    if (option === "--json")
      continue;
    else if (option === "--with-key-stdin")
      withKeyStdin = true;
    else if (option === "--base-url" && args[i + 1])
      baseUrl = args[++i];
    else if (option === "--model" && args[i + 1])
      model = args[++i];
    else if (option === "--llm-base-url" && args[i + 1])
      credentialBaseUrl = args[++i];
    else
      throw new Error("narrative_arguments_invalid: enable [--base-url URL] [--model NAME] [--llm-base-url URL] [--with-key-stdin]");
  }
  new URL(baseUrl);
  if (withKeyStdin)
    writeCredential(await readKeyFromStdin(), credentialBaseUrl);
  const resolution = resolveCredential();
  return {
    schemaVersion: INSTALL_SCHEMA,
    adapterVersion: context.packageVersion,
    serviceVersion: SERVICE_VERSION,
    baseUrl,
    model: model ?? null,
    credentialFile: defaultCredentialFile(),
    credentialSource: resolution.source,
    credentialOrigin: resolution.origin,
    degraded: resolution.degraded,
    idleTimeoutSeconds: DEFAULT_IDLE_TIMEOUT_MS / 1000
  };
}
async function run(context, args) {
  return dispatch({ projectRoot: context.projectRoot, stateDir: context.stateDir, serviceVersion: SERVICE_VERSION }, args);
}
function standaloneContext() {
  const projectRoot = process.cwd();
  const stateDir = resolve4(projectRoot, ".forgeax/extensions/narrative");
  mkdirSync3(stateDir, { recursive: true });
  return { projectRoot, stateDir, packageVersion: SERVICE_VERSION };
}
async function main(argv) {
  const [operation, ...rest] = argv;
  if (!operation || operation === "--help" || operation === "-h" || operation === "help") {
    console.log(`narrative <command> [options]

  enable   Configure this installation (accepts --with-key-stdin).
  doctor   Report setup, service and credential source.
  status | start | stop | open | tools | call <tool>

Run \`tools\` for the full operation list.`);
    return 0;
  }
  const context = standaloneContext();
  const result = operation === "enable" ? await check(context, rest) : await run(context, [operation, ...rest]);
  console.log(JSON.stringify(result, null, 2));
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    process.exit(1);
  });
}
export {
  run,
  check
};
