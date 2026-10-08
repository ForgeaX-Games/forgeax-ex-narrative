/**
 * 叙事无限画布编排 — 角色调色板目录（五大类 agent）。
 *
 * 五类角色：
 *  - input     输入节点（适配 INPUT）：一次需求的锚点，一条管线以一个输入节点为起点。
 *  - routing   路由节点（适配 ROUTING）：承载三轴（叙事类型/题材/体量）与品类，决定下游生成管线。
 *  - expert    叙事策划专家组（按游戏类型两级展开：15 个游戏类型 → 该类型下的品类专家）。
 *  - engineer  叙事单品助手（复刻某一生成环节，对应后端 PIPELINE_STEPS 里的单步）。
 *  - team      自定义专属团队（2.4）：用户投喂作品蒸馏出的私有成员，不新增步骤、只改提示词。
 *
 * 三期起 12 种故事结构不再是 agent：它们降为 strategy/structure/<code>.md 策略卡，
 * 由「叙事结构」轴综合推导后自动装进提示词的叙事策略段，用户不再手动拖一个"结构助手"节点。
 * 旧条目里可能存着 category="assistant" 的节点，故类型联合保留该值，只是目录里不再供货。
 *
 * 说明：自定义步序**已由后端真执行** —— 画布解析出的链经 `requestedSteps` 直达 `/entry/start`，
 * 与 `/plan` 预览同一条链。（此前这里写着"后端执行延后"，那正是用户编排完点开始却跑预置
 * 管线且不报错的来源。）
 */
import type { TierId } from "../types";
import type { PipelineTemplateId } from "../pipeline-templates";
import { ASSISTANT_SEATS, seatPrimaryStep, type SeatPipelineRole } from "./seats.generated";

export type ComposerNodeCategory =
  | "input"
  | "routing"
  | "expert"
  /** @deprecated 三期起结构改由策略卡承载，目录不再供货；仅为反序列化旧条目保留。 */
  | "assistant"
  | "engineer"
  /** 自定义专属创作团队：用户投喂作品蒸馏出的私有成员。 */
  | "team";

export interface ComposerCatalogItem {
  /** 目录内唯一 id（用于拖拽 dataTransfer 与节点回溯）。 */
  id: string;
  category: ComposerNodeCategory;
  /** i18n 键（缺失时回退 label）。 */
  labelKey: string;
  /** 回退中文标签。 */
  label: string;
  icon: string;
  /**
   * @deprecated 旧 step 模板（tpl-*）。四期起专家跑的是席位管线，
   * 只为反序列化旧画布节点保留；展示与单跑都用 narrativePipelineId。
   */
  pipelineTemplate?: PipelineTemplateId;
  /** 专家：该品类实际会跑的席位管线 id（如 pl-film-game）。 */
  narrativePipelineId?: string;
  /** 专家：席位管线名（如「叙事管线（分镜）」），卡上作副标题。 */
  narrativePipelineName?: string;
  tier?: TierId;
  routeGroup?: "planning" | "narrative";
  /** 单品助手：对应 PIPELINE_STEPS 单步 id；modeId 对应生成模式。 */
  stepId?: string;
  modeId?: string;
  /** 单品助手：所属席位（编号 2.3.x）。 */
  seatId?: string;
  /** 席位契约已立但后端实现待建：可拖可 @，不可单跑。 */
  planned?: boolean;
  /**
   * 单品助手：跑一条管线会不会带上这一席（来自后端席位投影）。
   *
   * 面板上要说清楚，否则「不属于任何管线」的席位（百科娘）与默认必跑的席位长得
   * 一模一样，用户跑完一条管线发现它没产出，只能猜是不是坏了。
   */
  pipelineRole?: SeatPipelineRole;
  /**
   * 自定义专属团队 id（2.4）。挂在节点上、随管线一起提交，后端据它取 ready 的 profile
   * 并注入各席位。团队不是一个步骤，所以它不占 stepId——它是整条管线的修饰。
   */
  teamId?: string;
  /** 拖入画布时写到节点 config 的默认值。 */
  defaultConfig?: Record<string, unknown>;
}

export interface ComposerCategoryDef {
  category: ComposerNodeCategory;
  labelKey: string;
  label: string;
  icon: string;
  /** 单例类别（input/routing）只允许拖入一次锚点/路由（前端软约束）。 */
  singleton?: boolean;
  items: ComposerCatalogItem[];
}

/**
 * 需求入口节点的 catalog id —— 项目自带的那一枚，与平台右侧 chat 栏的那排选项卡同源同参。
 *
 * 它只装两样东西，且这两样是同一个决定的两面（只说需求不给轴跑不起来，只给轴没需求也没得跑）：
 *  - 三类需求输入：直接输入 / 标签选择 / 文件上传
 *  - 三轴路由：叙事类型 / 叙事题材 / 叙事体量（第四轴「叙事结构」由后端按类型+题材推导，不出面）
 *
 * 不装的另外两组参数各有归属，放这儿会让入口替别人做决定：
 *  - 游戏品类（JRPG/ARPG 那层，含其只读派生的层级）→ 顶栏「叙事策划专家组」，选专家即选品类
 *  - 叙事单品（单步/单模块生成）→ 顶栏「叙事单品助手团队」，拖哪一席就是跑哪一件
 */
export const ENTRY_CATALOG_ID = "input.entry";

/** 这枚节点既是管线锚点（category=input）也承载路由配置。 */
export function isEntryNode(node: Pick<ComposerNodeData, "catalogId">): boolean {
  return node.catalogId === ENTRY_CATALOG_ID;
}

/**
 * 四大类调色板目录。顺序即调色板从左到右的展示顺序。
 *
 * 与创作空间顶栏对齐（PRD v1.4 §5.2）：
 *  - input   三个入口：直接输入 / 标签选择 / 文件上传（节点内完全复刻其编辑面板）。
 *  - routing 两个入口：叙事全量 / 叙事单品（routeGroup=planning/narrative）。
 *  - expert  叙事策划专家组：这里只列四个原型模板，具体品类专家由 /genres 动态展开
 *            （15 游戏类型 → 品类），见 ComposerPalette 的中层。
 *  - engineer 叙事单品助手团队（全量二十席）。
 */
export const COMPOSER_CATALOG: ComposerCategoryDef[] = [
  {
    category: "input",
    labelKey: "composer.cat.input",
    label: "输入需求",
    icon: "⤓",
    items: [
      {
        id: ENTRY_CATALOG_ID,
        category: "input",
        labelKey: "composer.item.input.entry",
        label: "需求入口",
        icon: "⌾",
        defaultConfig: {
          inputTab: "authored",
          userInput: "",
          tagSelections: {},
          tagCustomTexts: {},
          storyType: null,
          storyTheme: null,
          complexity: undefined,
        },
      },
      // 目录里两枚，对应两条入口。曾经是三枚（直接输入 / 标签选择 / 文件上传），
      // 前两枚其实是同一条入口的两半 —— 需求文本与标签六维并存，不是二选一 —— 分成两枚
      // 节点就是把那个互斥摆进了目录：用户拖了"直接输入"，标签那一半便无处可填。
      {
        id: "input.authored",
        category: "input",
        labelKey: "composer.item.input.authored",
        label: "自己描述",
        icon: "✎",
        defaultConfig: {
          inputTab: "authored",
          userInput: "",
          tagSelections: {},
          tagCustomTexts: {},
        },
      },
      {
        id: "input.adapted",
        category: "input",
        labelKey: "composer.item.input.adapted",
        label: "上传原作改编",
        icon: "⇪",
        defaultConfig: { inputTab: "adapted", uploadedFileNames: [] },
      },
    ],
  },
  {
    category: "routing",
    labelKey: "composer.cat.routing",
    label: "叙事路由",
    icon: "⎇",
    items: [
      {
        id: "routing.planning",
        category: "routing",
        labelKey: "composer.item.routing.planning",
        label: "叙事全量",
        icon: "▤",
        routeGroup: "planning",
        defaultConfig: {
          routeGroup: "planning",
          tier: null,
          genreCode: null,
          complexity: undefined,
        },
      },
      {
        id: "routing.narrative",
        category: "routing",
        labelKey: "composer.item.routing.narrative",
        label: "叙事单品",
        icon: "◈",
        routeGroup: "narrative",
        defaultConfig: {
          routeGroup: "narrative",
          mode: "narrative_auto",
          complexity: undefined,
        },
      },
    ],
  },
  {
    category: "expert",
    labelKey: "composer.cat.expert",
    label: "叙事策划专家",
    icon: "◆",
    items: [
      // 四个常用专家的快捷入口。defaultConfig 必须带 genreCode：品类是专家的身份，
      // 缺了它后端只能按 tier 兜默认 mode（design_auto），跑出全量策划而非叙事管线。
      // 「其他品类」是唯一无品类项，交给后端自动识别。
      //
      // 这里不再挂 pipelineTemplate（tpl-jrpg / tpl-vn-v2 那套旧模板 id）：专家跑的是
      // 席位管线，管线由品类查表得出，前端抄一份只会像上一版那样在卡上写着 tpl-vn-v2、
      // 后端跑的却是 pl-film-game。管线名按 genreCode 现查 /genres。
      {
        id: "expert.jrpg",
        category: "expert",
        labelKey: "composer.item.expert.jrpg",
        label: "JRPG 品类叙事专家",
        icon: "◆",
        tier: "tier1",
        routeGroup: "planning",
        defaultConfig: { genreCode: "rpg-jrpg", routeGroup: "planning", tier: "tier1" },
      },
      {
        id: "expert.orpg",
        category: "expert",
        labelKey: "composer.item.expert.orpg",
        label: "ORPG 品类叙事专家",
        icon: "◆",
        tier: "tier1",
        routeGroup: "planning",
        defaultConfig: { genreCode: "rpg-open-world", routeGroup: "planning", tier: "tier1" },
      },
      {
        id: "expert.film_game",
        category: "expert",
        labelKey: "composer.item.expert.film_game",
        label: "影游品类叙事专家",
        icon: "◆",
        tier: "tier1",
        routeGroup: "planning",
        defaultConfig: { genreCode: "adv-interactive", routeGroup: "planning", tier: "tier1" },
      },
      {
        id: "expert.other",
        category: "expert",
        labelKey: "composer.item.expert.other",
        label: "其他品类叙事专家",
        icon: "◆",
        tier: "tier1",
        routeGroup: "planning",
      },
    ],
  },
  {
    category: "engineer",
    labelKey: "composer.cat.engineer",
    label: "叙事单品助手",
    icon: "▣",
    // 二十席不再手抄：由后端席位注册表投影而来，改席位跑 npm run gen:seats
    items: ASSISTANT_SEATS.map((seat) => ({
      id: `engineer.${seat.id}`,
      category: "engineer" as const,
      labelKey: `composer.item.engineer.${seat.id}`,
      label: seat.name,
      icon: "▣",
      seatId: seat.id,
      // 单节点试跑打到席位的第一步；planned 席位没有实现，前端据此禁用试跑
      stepId: seatPrimaryStep(seat.id),
      planned: seat.status === "planned",
      pipelineRole: seat.pipelineRole,
    })),
  },
  {
    category: "team",
    labelKey: "composer.cat.team",
    label: "自定义专属团队",
    icon: "✦",
    // 团队是用户蒸馏出来的，写不进静态目录：由顶栏拉后端列表后现造（customTeamItem）。
    // 这里留空类别是为了让调色板有个固定的位置与配色，不然团队节点拖进画布后没有归属色。
    items: [],
  },
];

const ITEM_INDEX: Record<string, ComposerCatalogItem> = (() => {
  const idx: Record<string, ComposerCatalogItem> = {};
  for (const cat of COMPOSER_CATALOG) {
    for (const item of cat.items) idx[item.id] = item;
  }
  return idx;
})();

export function findCatalogItem(id: string): ComposerCatalogItem | undefined {
  return ITEM_INDEX[id];
}

/**
 * 目录项在界面上显示的名字。
 *
 * 每个条目带两样东西：`labelKey` 是译文键，`label` 是后端注册表里的原名（中文）。
 * 二十席助手与叙事路由的译文其实早就写好了，只是没有一处统一去读它，于是
 * 各处直接渲染 `label`——英文界面上就冒出「需求清单助手」「去 AI 味助手」。
 *
 * 回落到原名而不是显示键名，是因为用户自建团队与现造的品类专家没有译文键，
 * 它们的名字本来就是运行时才有的。
 */
export function itemLabel(
  t: (key: string) => string,
  item: Pick<ComposerCatalogItem, "labelKey" | "label">,
): string {
  if (!item.labelKey) return item.label;
  const hit = t(item.labelKey);
  return hit === item.labelKey ? item.label : hit;
}

/** 画布节点的显示名：节点只存 catalogId，名字每次按当前语言现解析。 */
export function composerNodeLabel(
  t: (key: string) => string,
  node: { catalogId: string; label: string },
): string {
  const item = findCatalogItem(node.catalogId);
  return item ? itemLabel(t, item) : node.label;
}

/** 拖拽 payload 的 MIME 键（HTML5 dataTransfer）。 */
export const COMPOSER_DND_MIME = "application/x-forgeax-composer-role";

/**
 * 由 `/genres` 的一条品类现造一个专家角色项。
 * 15 个游戏类型下的品类是后端数据，写不进静态目录，所以按需现造；
 * id 带 code，拖进画布后仍能溯源到具体品类。
 */
export function genreExpertItem(
  g: {
    code: string;
    name: string;
    tier: TierId;
    /** 该品类实际会跑的席位管线（后端 /genres 给，前端不推算）。 */
    narrative_pipeline?: string;
    narrative_pipeline_name?: string;
  },
  /** 显示名由调用方给（顶栏已按 locale 加过「专家」后缀），缺省退回品类名。 */
  label?: string,
): ComposerCatalogItem {
  return {
    id: `expert.genre.${g.code}`,
    category: "expert",
    labelKey: "",
    label: label ?? g.name,
    icon: "◆",
    narrativePipelineId: g.narrative_pipeline,
    narrativePipelineName: g.narrative_pipeline_name,
    tier: g.tier,
    routeGroup: "planning",
    defaultConfig: { genreCode: g.code, routeGroup: "planning", tier: g.tier },
  };
}

/**
 * 由一条叙事单品路由现造一个路由角色项（顶栏「叙事工具 → 叙事单品助手」可拖进画布）。
 * 拖进去就是一枚预置好 mode 的路由节点，配合输入节点即可成一条可跑的单品管线。
 */
export function narrativeRouteItem(modeId: string, label: string): ComposerCatalogItem {
  return {
    id: `routing.narrative.${modeId}`,
    category: "routing",
    labelKey: `route.${modeId}.label`,
    label,
    icon: "◈",
    routeGroup: "narrative",
    modeId,
    defaultConfig: { routeGroup: "narrative", mode: modeId, complexity: undefined },
  };
}

/**
 * 由一个已蒸馏的自定义团队现造一个角色项（顶栏「自定义专属叙事团队」可拖进画布）。
 *
 * 拖进画布 = 这条管线带上这位成员：它不新增步骤，只让该管线各席位的提示词多一段
 * "这位作者/这本书怎么写"。所以 config 里只有 teamId。
 */
export function customTeamItem(team: { id: string; status: string }, label: string): ComposerCatalogItem {
  return {
    id: `team.${team.id}`,
    category: "team",
    labelKey: "",
    label,
    icon: "✦",
    teamId: team.id,
    // 只有 ready 的团队后端才有 profile；未就绪时按 planned 处理（可拖可 @、不落配置），
    // 与 planned 席位同一口径——不装作能用。
    planned: team.status !== "ready",
    defaultConfig: { teamId: team.id },
  };
}

/*
 * 这里曾有一张 CATEGORY_COLOR：六个角色各一色，节点边框、把手和小地图都取它。
 * 已删。设计规范里能用的颜色只有中性色、品牌色和四个带确定语义的状态色（成功 /
 * 警告 / 错误 / 信息），它拼不出六个互不混淆的并列色，凑数就只能把「成功绿」派去
 * 当专家节点——之后画布上的绿就同时可能是"跑完了"和"这是专家"，状态色自己先失效了。
 * 角色是谁本来就写在节点上：每个节点带 `icon` 和 `composer.cat.*` 的文字标签，
 * 颜色退出后这条信息一点没少。
 */

// ── 运行期编排数据（store composer 切片使用） ──────────────────────────────

export interface ComposerNodeData {
  id: string;
  category: ComposerNodeCategory;
  /** 溯源 catalog item id。 */
  catalogId: string;
  label: string;
  icon: string;
  position: { x: number; y: number };
  /** 节点级配置（输入文本 / 路由参数 / 专家与单品助手选项）。 */
  config: Record<string, unknown>;
  /** @deprecated 旧画布节点里存的 tpl-*；展示与单跑不再读它。 */
  pipelineTemplate?: PipelineTemplateId;
  narrativePipelineId?: string;
  narrativePipelineName?: string;
  tier?: TierId | null;
  routeGroup?: "planning" | "narrative";
  stepId?: string;
  modeId?: string;
}

export interface ComposerEdgeData {
  id: string;
  source: string;
  target: string;
}

/**
 * 文件锚点 IP 生成触发器注册表（非持久，运行期存活）：
 * 文件上传节点内的 IpStageFlow 上报 { canGenerate, generate }，
 * 顶部「开始编排生成」据此触发（生成入口统一在顶部，不在节点内）。
 */
export const composerIpGenerators = new Map<string, { canGenerate: boolean; generate: () => void }>();

/**
 * 文件上传件的会话级暂存（nodeId → 已读取的文件，含正文/base64）。
 *
 * 为什么不放 store：正文动辄几 MB，store 是要持久化的，进去就是把整本书写进
 * localStorage。为什么不只放组件本地态：节点收起、切视图、视口剔除都会卸载组件，
 * 本地态一并归零，用户投过的文件凭空消失。所以正文放这里（本轮会话内有效），
 * 文件名单另写进节点 config（跨会话可见"投过什么"）。
 */
export const composerUploads = new Map<string, import("../lib/uploads").UploadedItem[]>();

/** 以输入节点为锚点拆分出的一条可提交管线。 */
export interface AnchoredPipeline {
  inputNode: ComposerNodeData;
  /** 从输入节点前向可达的全部节点（含输入节点本身）。 */
  nodeIds: string[];
  /** 该管线内的路由节点（若有；取第一个可达路由节点）。 */
  routingNode?: ComposerNodeData;
  /** 可达节点，按到输入节点的距离排序（拓扑近似）。 */
  orderedNodes: ComposerNodeData[];
}

/** 拖入画布时把 catalog item 实例化为一个编排节点。 */
export function instantiateComposerNode(
  item: ComposerCatalogItem,
  position: { x: number; y: number },
  id: string,
): ComposerNodeData {
  return {
    id,
    category: item.category,
    catalogId: item.id,
    label: item.label,
    icon: item.icon,
    position,
    config: { ...(item.defaultConfig ?? {}) },
    // pipelineTemplate 不再随实例化透传：目录里没有任何条目会填这个 deprecated 字段
    // （专家跑的是席位管线，见下方品类目录的注释），新节点也就不该再带它。
    // `ComposerNodeData.pipelineTemplate` 类型仍保留，只为反序列化旧画布节点。
    narrativePipelineId: item.narrativePipelineId,
    narrativePipelineName: item.narrativePipelineName,
    tier: item.tier ?? null,
    routeGroup: item.routeGroup,
    stepId: item.stepId,
    modeId: item.modeId,
  };
}

/**
 * 以输入节点为锚点，前向 BFS 拆分子图。孤立节点（无输入节点可达）被忽略。
 * 每个输入节点独立成一条管线（对应多入口=多条目）。
 */
export function computeAnchoredPipelines(
  nodes: ComposerNodeData[],
  edges: ComposerEdgeData[],
): AnchoredPipeline[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }
  const pipelines: AnchoredPipeline[] = [];
  for (const input of nodes.filter((n) => n.category === "input")) {
    const visited = new Set<string>([input.id]);
    const ordered: ComposerNodeData[] = [input];
    const queue: string[] = [input.id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const next of adj.get(cur) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        const node = byId.get(next);
        if (node) ordered.push(node);
        queue.push(next);
      }
    }
    // 入口节点自带路由：它同时是锚点与路由，这条管线里不必再有独立的路由节点。
    // 画布上另接了路由节点时以那一枚为准——显式编排优先于入口自带的默认值。
    const routingNode =
      ordered.find((n) => n.category === "routing") ?? (isEntryNode(input) ? input : undefined);
    pipelines.push({
      inputNode: input,
      nodeIds: [...visited],
      routingNode,
      orderedNodes: ordered,
    });
  }
  return pipelines;
}
