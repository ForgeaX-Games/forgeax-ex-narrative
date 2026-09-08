/**
 * 品类循环模板——三大循环的品类默认模板。
 * D0 的 prompt 使用这些模板作为"起点"，LLM 基于用户需求个性化调整。
 */

export interface GameplayStageTemplate {
  name: string;
  player_action: string;
  systems_involved: string[];
  emotion: string;
}

export interface ResourceNodeTemplate {
  name: string;
  type: "source" | "sink" | "transform";
  description: string;
}

export interface LoopTemplate {
  system_loop?: {
    description: string;
    core_systems: string[];
    gameplay_systems: string[];
    support_systems: string[];
    flow: string;
  };
  gameplay_loop?: {
    description: string;
    stages: GameplayStageTemplate[];
    session_length: string;
    meta_loop?: string;
  };
  resource_loop?: {
    description: string;
    currencies: string[];
    sources: ResourceNodeTemplate[];
    sinks: ResourceNodeTemplate[];
    growth_driver: string;
  };
}

export const GENRE_LOOPS: Record<string, LoopTemplate> = {
  "rpg-jrpg": {
    system_loop: {
      description: "回合制战斗驱动的冒险RPG系统架构",
      core_systems: ["entity", "input", "scene", "event", "save"],
      gameplay_systems: ["combat", "skill", "buff", "stats", "turn_based"],
      support_systems: ["dialogue", "quest", "story", "map", "ui_interaction"],
      flow: "探索(场景)→触发战斗(事件)→回合战斗(战斗+技能+Buff)→结算(经验+掉落)→成长(等级+装备)",
    },
    gameplay_loop: {
      description: "探索-战斗-成长驱动的冒险循环",
      stages: [
        { name: "探索", player_action: "移动/对话/收集", systems_involved: ["scene", "input", "dialogue"], emotion: "好奇" },
        { name: "战斗", player_action: "回合制战斗/技能选择", systems_involved: ["combat", "skill", "buff", "ai"], emotion: "紧张" },
        { name: "收集", player_action: "获得经验/金币/道具", systems_involved: ["loot", "inventory"], emotion: "满足" },
        { name: "成长", player_action: "升级/学技能/强化装备", systems_involved: ["leveling", "skill_tree", "equipment"], emotion: "进步感" },
      ],
      session_length: "30-60分钟",
      meta_loop: "章节制",
    },
    resource_loop: {
      description: "经验-金币-材料三元经济",
      currencies: ["经验值", "金币", "材料"],
      sources: [
        { name: "战斗奖励", type: "source", description: "击败敌人获得经验和金币" },
        { name: "任务奖励", type: "source", description: "完成任务获得丰厚奖励" },
        { name: "宝箱/探索", type: "source", description: "场景中的隐藏奖励" },
      ],
      sinks: [
        { name: "商店消费", type: "sink", description: "购买装备和消耗品" },
        { name: "强化/升级", type: "sink", description: "装备强化消耗材料" },
        { name: "技能学习", type: "sink", description: "学习新技能消耗点数" },
      ],
      growth_driver: "等级提升解锁区域和故事",
    },
  },

  "rpg-open-world": {
    system_loop: {
      description: "开放世界探索+任务驱动的大型RPG系统架构",
      core_systems: ["entity", "input", "scene", "event", "save", "map"],
      gameplay_systems: ["combat", "skill", "ai", "quest", "dialogue", "vehicle", "stealth", "wanted"],
      support_systems: ["inventory", "economy", "shop", "weather", "day_night", "ui_interaction"],
      flow: "自由探索(地图)→接取任务(任务)→任务执行(战斗/潜行/载具)→奖励结算(经济)→解锁新区域/剧情(场景)",
    },
    gameplay_loop: {
      description: "开放世界自由探索+主线/支线任务驱动",
      stages: [
        { name: "自由探索", player_action: "驾车/步行探索城市/野外", systems_involved: ["map", "vehicle", "scene", "weather"], emotion: "自由感" },
        { name: "任务执行", player_action: "主线/支线/随机事件", systems_involved: ["quest", "dialogue", "combat", "stealth"], emotion: "紧张/沉浸" },
        { name: "战斗/追逐", player_action: "枪战/近战/载具追逐", systems_involved: ["combat", "vehicle", "ai", "wanted"], emotion: "刺激" },
        { name: "收集/购买", player_action: "赚钱/购物/升级装备", systems_involved: ["economy", "shop", "inventory"], emotion: "满足" },
        { name: "剧情推进", player_action: "触发关键剧情/解锁新区域", systems_involved: ["quest", "dialogue", "event", "scene"], emotion: "成就感" },
      ],
      session_length: "30-120分钟",
      meta_loop: "章节制+自由漫游",
    },
    resource_loop: {
      description: "金钱驱动的都市经济",
      currencies: ["现金", "声望", "通缉等级"],
      sources: [
        { name: "任务报酬", type: "source" as const, description: "完成主线/支线获得大量报酬" },
        { name: "犯罪活动", type: "source" as const, description: "抢劫/贩卖等灰色收入" },
        { name: "合法收入", type: "source" as const, description: "房产/生意/投资等被动收入" },
      ],
      sinks: [
        { name: "武器/载具", type: "sink" as const, description: "购买或改装武器和载具" },
        { name: "房产", type: "sink" as const, description: "购买安全屋/企业" },
        { name: "外观/服装", type: "sink" as const, description: "角色外观定制" },
      ],
      growth_driver: "声望提升解锁高级任务和区域",
    },
  },

  "rpg-arpg": {
    system_loop: {
      description: "动作战斗+装备驱动的刷刷刷循环",
      core_systems: ["entity", "input", "combat", "skill", "stats"],
      gameplay_systems: ["loot", "equipment", "buff", "ai", "leveling"],
      support_systems: ["inventory", "map", "scene", "save"],
      flow: "进入区域(场景)→即时战斗(战斗+技能)→击杀掉落(掉落)→装备对比(装备)→Push更深层(关卡)",
    },
    gameplay_loop: {
      description: "战斗-掉落-Build构筑的循环",
      stages: [
        { name: "探索地牢", player_action: "进入新区域/击杀小怪", systems_involved: ["scene", "map", "ai"], emotion: "期待" },
        { name: "Boss战", player_action: "高强度即时战斗", systems_involved: ["combat", "skill", "buff"], emotion: "紧张" },
        { name: "拾取装备", player_action: "对比装备/筛选词缀", systems_involved: ["loot", "equipment", "inventory"], emotion: "满足/期待" },
        { name: "强化Build", player_action: "组合装备/技能搭配", systems_involved: ["equipment", "skill_tree", "stats"], emotion: "创造感" },
      ],
      session_length: "20-45分钟",
      meta_loop: "赛季/难度层级",
    },
    resource_loop: {
      description: "装备驱动的成长经济",
      currencies: ["金币", "强化材料", "稀有材料"],
      sources: [
        { name: "怪物掉落", type: "source", description: "击杀产出装备和材料" },
        { name: "Boss掉落", type: "source", description: "高品质稀有装备" },
      ],
      sinks: [
        { name: "强化/附魔", type: "sink", description: "提升装备品质" },
        { name: "重铸/洗词缀", type: "sink", description: "调整装备属性" },
      ],
      growth_driver: "装备品质提升 → 更高难度 → 更好掉落",
    },
  },

  "adv-vn": {
    system_loop: {
      description: "文本叙事驱动的互动体验",
      core_systems: ["entity", "input", "event", "save"],
      gameplay_systems: ["dialogue", "story"],
      support_systems: ["audio", "animation", "ui_interaction"],
      flow: "阅读文本(对话)→选择分支(事件)→观察结果(剧情)→解锁新路线(存档)",
    },
    gameplay_loop: {
      description: "阅读-选择-反馈的沉浸循环",
      stages: [
        { name: "阅读", player_action: "阅读文本/观看演出", systems_involved: ["dialogue", "story"], emotion: "沉浸" },
        { name: "选择", player_action: "在关键节点做出决策", systems_involved: ["dialogue", "event"], emotion: "纠结" },
        { name: "反馈", player_action: "观察选择带来的后果", systems_involved: ["story", "event"], emotion: "惊喜/后悔" },
      ],
      session_length: "10-20分钟(一个场景)",
      meta_loop: "路线制",
    },
    resource_loop: {
      description: "好感度/信任度经济",
      currencies: ["好感度", "信任度"],
      sources: [
        { name: "对话选择", type: "source", description: "正确选择提升好感" },
      ],
      sinks: [
        { name: "剧情检定", type: "sink", description: "好感度阈值触发分支" },
      ],
      growth_driver: "好感度积累解锁深层路线",
    },
  },

  "adv-interactive": {
    system_loop: {
      description: "互动电影式叙事体验",
      core_systems: ["entity", "input", "event", "save"],
      gameplay_systems: ["dialogue", "story"],
      support_systems: ["camera", "audio", "animation", "ui_interaction"],
      flow: "播放(演出)→互动(QTE/选择)→分支(剧情)→结局(多结局)",
    },
    gameplay_loop: {
      description: "观看-决策-分支的电影式体验",
      stages: [
        { name: "观看演出", player_action: "观看CG/动画", systems_involved: ["camera", "animation", "audio"], emotion: "沉浸" },
        { name: "关键决策", player_action: "选择对话/QTE操作", systems_involved: ["input", "dialogue"], emotion: "紧张" },
        { name: "剧情分支", player_action: "体验不同后果", systems_involved: ["story", "event"], emotion: "震撼" },
      ],
      session_length: "15-30分钟(一章)",
      meta_loop: "章节制+多结局",
    },
    resource_loop: {
      description: "关系网络经济",
      currencies: ["角色关系值", "线索收集度"],
      sources: [
        { name: "互动选择", type: "source", description: "与角色互动影响关系" },
        { name: "探索发现", type: "source", description: "发现线索推进调查" },
      ],
      sinks: [
        { name: "关键检定", type: "sink", description: "关系/线索决定可用选项" },
      ],
      growth_driver: "选择积累决定结局走向",
    },
  },

  "cas-hyper": {
    system_loop: {
      description: "极简操作的即时反馈系统",
      core_systems: ["entity", "input", "scene", "event"],
      gameplay_systems: ["stage"],
      support_systems: ["ui_feedback", "audio"],
      flow: "操作(输入)→判定(碰撞/条件)→反馈(得分/失败)→重来(重开)",
    },
    gameplay_loop: {
      description: "操作-反馈-挑战的极简循环",
      stages: [
        { name: "操作", player_action: "点击/滑动/拖拽", systems_involved: ["input"], emotion: "专注" },
        { name: "反馈", player_action: "观察即时结果", systems_involved: ["ui_feedback"], emotion: "满足" },
        { name: "挑战", player_action: "难度逐渐提升", systems_involved: ["stage"], emotion: "紧张" },
      ],
      session_length: "30-90秒",
    },
    resource_loop: {
      description: "分数经济",
      currencies: ["分数"],
      sources: [
        { name: "操作得分", type: "source", description: "每次操作产出分数" },
      ],
      sinks: [
        { name: "皮肤解锁", type: "sink", description: "积分解锁外观(可选)" },
      ],
      growth_driver: "高分记录驱动重玩",
    },
  },

  "str-4x": {
    system_loop: {
      description: "宏观策略决策系统",
      core_systems: ["entity", "input", "event", "map"],
      gameplay_systems: ["turn_based", "ai", "economy", "building"],
      support_systems: ["save", "ui_interaction", "leaderboard"],
      flow: "探索地图(地图)→建设城市(建造)→发展科技(经济)→外交/军事(AI)→扩张领土(循环)",
    },
    gameplay_loop: {
      description: "4X大循环",
      stages: [
        { name: "探索(eXplore)", player_action: "发现新区域和资源", systems_involved: ["map", "scene"], emotion: "好奇" },
        { name: "扩张(eXpand)", player_action: "建立新城市/前哨", systems_involved: ["building", "map"], emotion: "掌控感" },
        { name: "开发(eXploit)", player_action: "发展科技和经济", systems_involved: ["economy", "building"], emotion: "满足" },
        { name: "消灭(eXterminate)", player_action: "军事征服或外交胜利", systems_involved: ["combat", "ai"], emotion: "成就感" },
      ],
      session_length: "60-180分钟",
      meta_loop: "纪元/时代",
    },
    resource_loop: {
      description: "多资源宏观经济",
      currencies: ["金币", "科技点", "文化值", "军事力"],
      sources: [
        { name: "城市产出", type: "source", description: "城市每回合产出资源" },
        { name: "贸易", type: "source", description: "与其他文明交易" },
        { name: "征服", type: "source", description: "战争掠夺资源" },
      ],
      sinks: [
        { name: "科技研发", type: "sink", description: "消耗科技点解锁科技" },
        { name: "军队维护", type: "sink", description: "持续消耗金币" },
        { name: "建筑建造", type: "sink", description: "消耗多种资源" },
      ],
      growth_driver: "科技进步+领土扩张",
    },
  },

  "rpg-mmorpg": {
    system_loop: {
      description: "大型多人在线RPG的社交+PvE+PvP系统",
      core_systems: ["entity", "input", "scene", "event", "save", "stats"],
      gameplay_systems: ["combat", "skill", "buff", "quest", "dialogue", "economy"],
      support_systems: ["social_friend", "social_guild", "social_chat", "matchmaking", "leaderboard", "map"],
      flow: "接任务(任务)→组队(社交)→刷副本(战斗)→拍卖/交易(经济)→升级/装备(成长)",
    },
    gameplay_loop: {
      description: "社交驱动的PvE/PvP混合循环",
      stages: [
        { name: "日常/周常", player_action: "完成日常任务获取资源", systems_involved: ["quest", "combat"], emotion: "例行" },
        { name: "副本/Raid", player_action: "组队挑战高难内容", systems_involved: ["combat", "skill", "social_guild"], emotion: "紧张/协作" },
        { name: "PvP/竞技", player_action: "与其他玩家对战", systems_involved: ["matchmaking", "combat", "leaderboard"], emotion: "竞争" },
        { name: "社交/交易", player_action: "交易/聊天/公会活动", systems_involved: ["economy", "social_chat", "social_guild"], emotion: "归属感" },
      ],
      session_length: "30-120分钟",
      meta_loop: "赛季/版本更新",
    },
    resource_loop: {
      description: "多币种运营经济",
      currencies: ["金币", "绑定货币", "副本代币", "荣誉点"],
      sources: [
        { name: "副本奖励", type: "source", description: "通关获得装备和代币" },
        { name: "日常任务", type: "source", description: "稳定产出基础货币" },
        { name: "PvP奖励", type: "source", description: "竞技赛季奖励" },
      ],
      sinks: [
        { name: "装备强化", type: "sink", description: "消耗材料提升装备" },
        { name: "外观/坐骑", type: "sink", description: "消耗货币购买外观" },
        { name: "拍卖行", type: "sink", description: "玩家间交易抽税" },
      ],
      growth_driver: "装备分数+赛季排名",
    },
  },

  "rpg-gacha": {
    system_loop: {
      description: "抽卡收集+养成的运营RPG",
      core_systems: ["entity", "input", "event", "save", "stats"],
      gameplay_systems: ["combat", "skill", "buff", "collection", "leveling"],
      support_systems: ["quest", "dialogue", "economy", "shop", "ui_interaction"],
      flow: "抽卡(收集)→养成(等级+突破)→战斗(关卡/副本)→收集奖励(掉落)→继续抽卡(循环)",
    },
    gameplay_loop: {
      description: "抽卡-养成-战斗的核心循环",
      stages: [
        { name: "抽卡/收集", player_action: "消耗抽卡资源获取角色", systems_involved: ["collection", "economy"], emotion: "期待/惊喜" },
        { name: "养成强化", player_action: "升级/突破/装备角色", systems_involved: ["leveling", "equipment", "stats"], emotion: "成就感" },
        { name: "战斗挑战", player_action: "通关主线/活动关卡", systems_involved: ["combat", "skill", "stage"], emotion: "紧张" },
        { name: "剧情体验", player_action: "阅读角色故事/主线", systems_involved: ["story", "dialogue"], emotion: "沉浸" },
      ],
      session_length: "15-30分钟(一轮体力)",
      meta_loop: "活动/版本更新",
    },
    resource_loop: {
      description: "多层抽卡经济",
      currencies: ["原石/水晶", "金币", "体力", "突破材料"],
      sources: [
        { name: "每日任务", type: "source", description: "基础产出" },
        { name: "活动奖励", type: "source", description: "限时活动丰厚奖励" },
        { name: "深渊/高难", type: "source", description: "挑战内容产出高级材料" },
      ],
      sinks: [
        { name: "抽卡", type: "sink", description: "消耗原石获取角色/武器" },
        { name: "角色养成", type: "sink", description: "消耗材料提升角色" },
        { name: "体力消耗", type: "sink", description: "刷材料消耗体力" },
      ],
      growth_driver: "角色收集+阵容强化",
    },
  },

  "sim-sandbox": {
    gameplay_loop: {
      description: "创造-探索-展示的沙盒循环",
      stages: [
        { name: "收集资源", player_action: "挖掘/采集/收集", systems_involved: ["interaction", "inventory"], emotion: "目标感" },
        { name: "建造创造", player_action: "建造建筑/制作工具", systems_involved: ["building", "crafting"], emotion: "创造力" },
        { name: "探索发现", player_action: "探索新区域/生态", systems_involved: ["map", "scene"], emotion: "好奇" },
      ],
      session_length: "30-120分钟",
    },
    resource_loop: {
      description: "采集-制作经济",
      currencies: ["原材料", "加工品"],
      sources: [
        { name: "采集", type: "source", description: "从世界中获取原材料" },
      ],
      sinks: [
        { name: "建造", type: "sink", description: "建筑消耗大量材料" },
        { name: "制作", type: "transform", description: "原材料转化为高级物品" },
      ],
      growth_driver: "建筑规模+探索范围",
    },
  },

  "rpg-roguelike": {
    gameplay_loop: {
      description: "死亡-学习-重来的循环",
      stages: [
        { name: "开局选择", player_action: "选择角色/初始道具", systems_involved: ["collection", "entity"], emotion: "期待" },
        { name: "推进关卡", player_action: "战斗+选择奖励", systems_involved: ["combat", "loot", "roguelike"], emotion: "紧张" },
        { name: "Boss挑战", player_action: "挑战关底Boss", systems_involved: ["combat", "ai"], emotion: "兴奋" },
        { name: "死亡/通关", player_action: "结算局内成果", systems_involved: ["achievement", "save"], emotion: "复盘" },
      ],
      session_length: "20-45分钟",
      meta_loop: "局外进度解锁",
    },
    resource_loop: {
      description: "局内临时+局外永久双层经济",
      currencies: ["局内金币", "局外货币"],
      sources: [
        { name: "关卡掉落", type: "source", description: "局内战斗掉落" },
        { name: "通关奖励", type: "source", description: "局外进度积累" },
      ],
      sinks: [
        { name: "局内商店", type: "sink", description: "局内购买升级" },
        { name: "局外解锁", type: "sink", description: "永久解锁新角色/道具" },
      ],
      growth_driver: "局外解锁扩展可能性",
    },
  },

  "misc-survivor": {
    gameplay_loop: {
      description: "自动战斗+选择升级的循环",
      stages: [
        { name: "战斗生存", player_action: "移动躲避/自动攻击", systems_involved: ["combat", "input"], emotion: "紧张" },
        { name: "升级选择", player_action: "选择技能/武器升级", systems_involved: ["leveling", "skill"], emotion: "决策" },
        { name: "波次推进", player_action: "应对越来越强的敌人", systems_involved: ["wave", "ai"], emotion: "压迫感" },
      ],
      session_length: "15-30分钟",
      meta_loop: "局外解锁",
    },
    resource_loop: {
      description: "经验驱动的局内成长",
      currencies: ["经验宝石", "金币"],
      sources: [
        { name: "击杀掉落", type: "source", description: "击杀敌人掉落经验" },
      ],
      sinks: [
        { name: "升级消耗", type: "sink", description: "经验值触发升级选择" },
      ],
      growth_driver: "Build构筑的爽快感",
    },
  },
};

/**
 * 获取品类的循环模板。如果精确品类没有模板，尝试匹配大类。
 */
export function getLoopTemplate(genreCode: string): LoopTemplate | null {
  if (GENRE_LOOPS[genreCode]) return GENRE_LOOPS[genreCode];

  const prefix = genreCode.split("-")[0];
  const fallbacks: Record<string, string> = {
    rpg: "rpg-jrpg",
    act: "rpg-arpg",
    adv: "adv-vn",
    str: "str-4x",
    sim: "sim-sandbox",
    cas: "cas-hyper",
    srv: "sim-sandbox",
    fps: "rpg-arpg",
    hor: "rpg-arpg",
    fgt: "rpg-arpg",
    rhy: "cas-hyper",
    puz: "cas-hyper",
    spt: "cas-hyper",
    card: "rpg-roguelike",
    misc: "rpg-jrpg",
  };
  const fallbackCode = fallbacks[prefix];
  return fallbackCode ? (GENRE_LOOPS[fallbackCode] ?? null) : null;
}
