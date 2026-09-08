/**
 * 系统 Skill 精炼摘要注册表。
 * 每个系统对应一条精炼摘要（50-100字），供 D2 步骤 prompt 注入，避免全文超出上下文窗口。
 * 源文件路径：knowledge/game-design/skills/skills/<SystemName>.md
 */

export interface SystemSkillSummary {
  id: string;
  name: string;
  summary: string;
  key_features: string[];
}

export const SYSTEM_SKILL_REGISTRY: SystemSkillSummary[] = [
  {
    id: "entity",
    name: "实体系统",
    summary: "管理游戏中所有对象的生命周期，采用组件化架构(ECS)实现灵活组合。",
    key_features: ["组件化架构", "对象池管理", "生命周期管理", "唯一ID标识"],
  },
  {
    id: "input",
    name: "输入系统",
    summary: "统一处理键盘/鼠标/手柄/触屏等多端输入，通过按键映射实现可配置化。",
    key_features: ["多端输入适配", "按键映射/重绑定", "输入缓冲", "手势识别"],
  },
  {
    id: "scene",
    name: "场景系统",
    summary: "管理场景加载/切换/卸载，支持场景分区和异步加载。",
    key_features: ["场景切换", "异步加载", "场景分区", "过渡效果"],
  },
  {
    id: "event",
    name: "事件系统",
    summary: "发布-订阅模式实现系统间解耦通信，支持事件队列和优先级。",
    key_features: ["发布-订阅模式", "事件队列", "优先级排序", "事件溯源"],
  },
  {
    id: "save",
    name: "存档系统",
    summary: "序列化/反序列化游戏状态，支持多槽位存档、自动存档和云存档。",
    key_features: ["多槽位存档", "自动存档", "增量保存", "版本兼容"],
  },
  {
    id: "stats",
    name: "属性系统",
    summary: "管理角色数值属性(基础值+修饰器)，支持属性计算公式和百分比/固定值修饰。",
    key_features: ["基础值+修饰器", "属性依赖计算", "临时/永久修饰", "属性上下限"],
  },
  {
    id: "combat",
    name: "战斗系统",
    summary: "核心玩法系统，包含伤害计算公式、命中/闪避/暴击判定、元素反应等战斗机制。",
    key_features: ["伤害公式", "命中/暴击判定", "元素反应", "仇恨/锁定", "连击系统"],
  },
  {
    id: "skill",
    name: "技能系统",
    summary: "管理主动/被动技能的释放流程，包含CD/消耗/范围/效果等参数。",
    key_features: ["技能释放流程", "冷却/消耗管理", "范围检测", "技能效果链"],
  },
  {
    id: "buff",
    name: "Buff/Debuff系统",
    summary: "管理状态效果的施加/叠加/移除，支持增益/减益/控制/特殊四大类。",
    key_features: ["叠加规则(刷新/独立/层数)", "持续时间管理", "免疫/净化", "属性修改器集成"],
  },
  {
    id: "ai",
    name: "AI系统",
    summary: "控制NPC/敌人行为，采用行为树/状态机/效用AI实现智能决策。",
    key_features: ["行为树", "状态机", "寻路(A*/NavMesh)", "感知系统(视野/听觉)", "难度自适应"],
  },
  {
    id: "inventory",
    name: "背包系统",
    summary: "管理物品的获取/使用/丢弃，支持分类/排序/堆叠/容量限制。",
    key_features: ["容量管理", "物品堆叠", "分类筛选", "快捷栏", "拖拽操作"],
  },
  {
    id: "equipment",
    name: "装备系统",
    summary: "管理装备的穿戴/卸下/强化，支持套装效果、词缀系统和品质等级。",
    key_features: ["装备槽位", "词缀/随机属性", "套装效果", "强化/精炼", "品质等级"],
  },
  {
    id: "economy",
    name: "经济系统",
    summary: "管理多币种的产出/消耗平衡，确保游戏经济健康运转。",
    key_features: ["多币种管理", "产出/消耗追踪", "通胀控制", "交易税收", "保底机制"],
  },
  {
    id: "shop",
    name: "商店系统",
    summary: "提供商品展示/购买/出售功能，支持限购/折扣/刷新/随机商店。",
    key_features: ["商品分类", "限购/库存", "折扣/促销", "随机刷新商店"],
  },
  {
    id: "crafting",
    name: "制作系统",
    summary: "通过配方将材料转化为成品，支持配方发现/熟练度/品质浮动。",
    key_features: ["配方管理", "材料消耗", "成功率/品质", "熟练度成长"],
  },
  {
    id: "loot",
    name: "掉落系统",
    summary: "管理战斗/活动奖励掉落，支持掉落表配置/概率计算/保底机制。",
    key_features: ["掉落表配置", "概率权重", "保底/悲惜", "稀有度等级", "条件掉落"],
  },
  {
    id: "leveling",
    name: "等级系统",
    summary: "管理角色/账号经验积累与等级提升，解锁内容和属性。",
    key_features: ["经验公式", "等级上限", "升级奖励", "突破/转职"],
  },
  {
    id: "skill_tree",
    name: "技能树系统",
    summary: "管理技能/天赋的解锁树形结构，支持多路径/重置/专精。",
    key_features: ["树形/网状结构", "前置条件", "技能点分配", "重置机制"],
  },
  {
    id: "achievement",
    name: "成就系统",
    summary: "追踪玩家完成特定目标，提供奖励/展示/称号。",
    key_features: ["条件追踪", "进度百分比", "隐藏成就", "成就奖励"],
  },
  {
    id: "collection",
    name: "收集系统",
    summary: "管理图鉴/收集品的发现与记录，提供完成度追踪。",
    key_features: ["图鉴登录", "完成度", "收集奖励", "稀有度标识"],
  },
  {
    id: "reputation",
    name: "声望系统",
    summary: "管理玩家与阵营/NPC的好感度，影响可用内容和对话选项。",
    key_features: ["阵营关系", "好感度等级", "解锁内容", "互斥阵营"],
  },
  {
    id: "stage",
    name: "关卡系统",
    summary: "管理关卡选择/进入/评价/结算，支持星级评价和关卡解锁条件。",
    key_features: ["关卡选择/地图", "星级评价", "解锁条件", "难度设置"],
  },
  {
    id: "quest",
    name: "任务系统",
    summary: "管理主线/支线/日常任务的接取/追踪/完成，驱动游戏进度。",
    key_features: ["任务链", "目标追踪", "任务分类", "自动导航", "分支任务"],
  },
  {
    id: "dialogue",
    name: "对话系统",
    summary: "管理NPC对话的文本展示/分支选择/条件触发，支持多语言。",
    key_features: ["对话树", "条件分支", "情感表达", "语音集成", "选择后果"],
  },
  {
    id: "story",
    name: "剧情系统",
    summary: "管理游戏剧情的章节推进/CG演出/回忆录功能。",
    key_features: ["章节管理", "CG/过场动画", "回忆录", "多结局"],
  },
  {
    id: "map",
    name: "地图系统",
    summary: "管理世界地图/小地图/区域导航，支持传送/迷雾探索。",
    key_features: ["世界/小地图", "区域标记", "传送点", "迷雾探索", "路径规划"],
  },
  {
    id: "time_weather",
    name: "时间天气系统",
    summary: "管理游戏内时间流逝和天气变化，影响NPC行为/作物/事件触发。",
    key_features: ["日夜循环", "季节变化", "天气类型", "时间敏感事件"],
  },
  {
    id: "interaction",
    name: "交互系统",
    summary: "管理玩家与世界物体的交互(拾取/开门/对话触发/开关)。",
    key_features: ["交互检测", "交互提示", "物理交互", "上下文菜单"],
  },
  {
    id: "building",
    name: "建造系统",
    summary: "管理建筑物的放置/建造/升级/拆除，支持网格/自由放置。",
    key_features: ["放置预览", "网格/自由放置", "建筑升级", "资源消耗"],
  },
  {
    id: "social_friend",
    name: "好友系统",
    summary: "管理玩家好友关系(添加/删除/屏蔽)，支持好友列表和在线状态。",
    key_features: ["好友列表", "在线状态", "好友互动", "推荐好友"],
  },
  {
    id: "social_guild",
    name: "公会系统",
    summary: "管理公会的创建/加入/管理，支持公会任务/排行/战争。",
    key_features: ["公会管理", "权限等级", "公会任务", "公会战"],
  },
  {
    id: "social_chat",
    name: "聊天系统",
    summary: "提供文字/语音/表情聊天功能，支持私聊/群聊/频道。",
    key_features: ["频道管理", "私聊/群聊", "表情系统", "消息过滤"],
  },
  {
    id: "leaderboard",
    name: "排行榜",
    summary: "管理玩家排名展示，支持多维度排行/赛季重置。",
    key_features: ["多维度排行", "赛季重置", "实时/周期更新", "奖励分发"],
  },
  {
    id: "matchmaking",
    name: "匹配系统",
    summary: "基于ELO/MMR进行玩家匹配，支持快速/排位/自定义匹配。",
    key_features: ["ELO/MMR算法", "匹配池管理", "等待时间优化", "组队匹配"],
  },
  {
    id: "card",
    name: "卡牌系统",
    summary: "管理卡组构建/手牌管理/出牌规则/卡牌效果。",
    key_features: ["卡组构建", "手牌管理", "费用系统", "卡牌效果", "稀有度"],
  },
  {
    id: "pet",
    name: "宠物系统",
    summary: "管理宠物/伙伴的捕获/养成/战斗/跟随。",
    key_features: ["捕获/孵化", "养成进化", "战斗辅助", "跟随AI"],
  },
  {
    id: "vehicle",
    name: "载具系统",
    summary: "管理载具的驾驶/物理/损坏/改装。",
    key_features: ["驾驶物理", "速度/操控", "载具改装", "损坏模型"],
  },
  {
    id: "roguelike",
    name: "Roguelike系统",
    summary: "管理随机地图/随机道具/永久死亡/局外进度的Rogue玩法。",
    key_features: ["程序化生成", "永久死亡", "局外进度", "随机奖励选择"],
  },
  {
    id: "tower_defense",
    name: "塔防系统",
    summary: "管理防御塔的放置/升级/攻击逻辑/路径管理。",
    key_features: ["防御塔放置", "升级分支", "攻击目标选择", "路径管理"],
  },
  {
    id: "wave",
    name: "波次系统",
    summary: "管理敌人波次的配置/生成/难度递增/奖励。",
    key_features: ["波次配置表", "敌人生成", "难度递增", "波间休息"],
  },
  {
    id: "turn_based",
    name: "回合制系统",
    summary: "管理回合战斗的行动顺序/时间轴/回合阶段。",
    key_features: ["速度/先手计算", "行动点/时间轴", "回合阶段", "连锁反应"],
  },
  {
    id: "ui_interaction",
    name: "UI交互系统",
    summary: "管理游戏中复杂UI的交互逻辑(拖拽/菜单/弹窗/HUD)。",
    key_features: ["拖拽操作", "弹窗管理", "HUD布局", "快捷键绑定"],
  },
  {
    id: "ui_feedback",
    name: "UI反馈系统",
    summary: "管理伤害飘字/击中反馈/屏幕特效等即时视觉反馈。",
    key_features: ["伤害飘字", "击中停顿", "屏幕震动", "状态提示"],
  },
  {
    id: "tutorial",
    name: "教程系统",
    summary: "管理新手引导的步骤触发/高亮提示/强制流程。",
    key_features: ["步骤触发", "UI高亮", "强制/非强制", "进度记录"],
  },
  {
    id: "audio",
    name: "音频系统",
    summary: "管理BGM/音效/语音的播放/混合/3D定位。",
    key_features: ["BGM管理", "音效播放", "3D音效", "音量控制", "音频混合"],
  },
  {
    id: "camera",
    name: "相机系统",
    summary: "管理游戏视角(跟随/自由/锁定)，支持相机震动/过渡。",
    key_features: ["跟随/锁定", "自由视角", "相机震动", "过渡效果"],
  },
  {
    id: "particle",
    name: "粒子系统",
    summary: "管理粒子特效的生成/更新/销毁，用于技能/环境特效。",
    key_features: ["粒子发射器", "生命周期管理", "粒子参数", "对象池优化"],
  },
  {
    id: "animation",
    name: "动画系统",
    summary: "管理角色/物体动画的播放/混合/过渡，支持骨骼/帧动画。",
    key_features: ["动画状态机", "混合树", "IK/骨骼动画", "帧事件"],
  },
];

/**
 * 获取指定系统的 Skill 摘要。
 */
export function getSkillSummary(systemId: string): SystemSkillSummary | undefined {
  return SYSTEM_SKILL_REGISTRY.find((s) => s.id === systemId);
}

/**
 * 批量获取多个系统的 Skill 摘要，格式化为 prompt 可用的文本。
 */
export function formatSkillSummaries(systemIds: string[]): string {
  const lines: string[] = [];
  for (const id of systemIds) {
    const skill = getSkillSummary(id);
    if (skill) {
      lines.push(`### ${skill.name}(${skill.id})`);
      lines.push(skill.summary);
      lines.push(`关键特性: ${skill.key_features.join("、")}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}
