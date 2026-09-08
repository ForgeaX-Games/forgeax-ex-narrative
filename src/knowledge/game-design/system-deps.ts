/**
 * 系统间依赖关系图。
 * 用于 D1 步骤中按依赖排序生成系统架构。
 * "from" depends on "to"（from 需要 to 先设计）。
 */

export interface SystemDep {
  from: string;
  to: string;
  reason: string;
}

export const SYSTEM_DEPS: SystemDep[] = [
  // 战斗子系统依赖链
  { from: "combat", to: "entity", reason: "战斗需要实体作为目标" },
  { from: "combat", to: "stats", reason: "伤害计算需要属性系统" },
  { from: "skill", to: "entity", reason: "技能需要实体作为施放者" },
  { from: "skill", to: "stats", reason: "技能效果基于属性" },
  { from: "buff", to: "stats", reason: "Buff修改属性" },
  { from: "buff", to: "event", reason: "Buff的触发和过期需要事件" },
  { from: "ai", to: "entity", reason: "AI控制实体行为" },
  { from: "ai", to: "combat", reason: "AI决策需要战斗上下文" },

  // 经济子系统依赖链
  { from: "equipment", to: "stats", reason: "装备提供属性加成" },
  { from: "equipment", to: "inventory", reason: "装备存储在背包中" },
  { from: "inventory", to: "entity", reason: "背包挂载在实体上" },
  { from: "shop", to: "economy", reason: "商店消耗货币" },
  { from: "shop", to: "inventory", reason: "购买物品进入背包" },
  { from: "economy", to: "event", reason: "经济交易触发事件" },
  { from: "crafting", to: "inventory", reason: "制作消耗/产出物品" },
  { from: "loot", to: "entity", reason: "掉落物关联实体" },
  { from: "loot", to: "stats", reason: "掉落概率可能基于属性" },

  // 成长子系统依赖链
  { from: "leveling", to: "stats", reason: "升级提升属性" },
  { from: "leveling", to: "event", reason: "升级触发事件" },
  { from: "skill_tree", to: "skill", reason: "技能树解锁技能" },
  { from: "skill_tree", to: "leveling", reason: "技能点来自等级" },

  // 叙事子系统依赖链
  { from: "dialogue", to: "entity", reason: "对话参与者是实体" },
  { from: "dialogue", to: "event", reason: "对话选择触发事件" },
  { from: "story", to: "dialogue", reason: "剧情由对话推动" },
  { from: "story", to: "event", reason: "剧情进度基于事件" },
  { from: "quest", to: "event", reason: "任务完成条件是事件" },
  { from: "quest", to: "dialogue", reason: "任务通过对话接取" },

  // 世界子系统依赖链
  { from: "scene", to: "entity", reason: "场景包含实体" },
  { from: "map", to: "scene", reason: "地图管理场景切换" },
  { from: "interaction", to: "entity", reason: "交互对象是实体" },
  { from: "interaction", to: "input", reason: "交互需要输入" },
  { from: "building", to: "scene", reason: "建筑放置在场景中" },
  { from: "building", to: "economy", reason: "建造消耗资源" },
  { from: "time_weather", to: "event", reason: "时间/天气变化触发事件" },
  { from: "vehicle", to: "entity", reason: "载具是实体" },
  { from: "vehicle", to: "input", reason: "载具需要输入控制" },

  // 社交子系统依赖链
  { from: "social_friend", to: "entity", reason: "好友是玩家实体" },
  { from: "social_guild", to: "social_friend", reason: "公会基于好友系统" },
  { from: "social_chat", to: "social_friend", reason: "聊天需要好友关系" },
  { from: "matchmaking", to: "entity", reason: "匹配玩家实体" },
  { from: "leaderboard", to: "stats", reason: "排行基于属性/分数" },

  // 表现子系统（较独立）
  { from: "camera", to: "scene", reason: "相机跟踪场景实体" },
  { from: "particle", to: "entity", reason: "粒子挂载在实体上" },
  { from: "animation", to: "entity", reason: "动画播放在实体上" },
  { from: "audio", to: "event", reason: "音效由事件触发" },

  // 玩法结构
  { from: "stage", to: "scene", reason: "关卡由场景组成" },
  { from: "stage", to: "event", reason: "关卡进度基于事件" },
  { from: "wave", to: "ai", reason: "波次生成AI敌人" },
  { from: "wave", to: "stage", reason: "波次在关卡内执行" },
  { from: "tower_defense", to: "stage", reason: "塔防在关卡中运行" },
  { from: "tower_defense", to: "ai", reason: "塔防需要AI路径寻路" },
  { from: "roguelike", to: "stage", reason: "Roguelike通过关卡推进" },
  { from: "roguelike", to: "loot", reason: "随机奖励来自掉落" },
  { from: "turn_based", to: "combat", reason: "回合制是战斗的一种形式" },
  { from: "card", to: "entity", reason: "卡牌作为实体管理" },
  { from: "card", to: "buff", reason: "卡牌效果通过Buff实现" },
  { from: "pet", to: "entity", reason: "宠物是实体" },
  { from: "pet", to: "ai", reason: "宠物需要AI行为" },

  // 元系统
  { from: "save", to: "event", reason: "存档时机由事件触发" },
  { from: "achievement", to: "event", reason: "成就由事件触发" },
  { from: "collection", to: "entity", reason: "收集对象是实体" },
  { from: "reputation", to: "event", reason: "声望变化由事件驱动" },
  { from: "tutorial", to: "event", reason: "教程步骤由事件推进" },
  { from: "tutorial", to: "ui_interaction", reason: "教程依赖UI交互引导" },
  { from: "ui_interaction", to: "input", reason: "UI交互响应输入" },
  { from: "ui_feedback", to: "event", reason: "UI反馈由事件触发" },
];

/**
 * 对给定的系统列表进行拓扑排序，返回生成顺序（先依赖后被依赖）。
 */
export function topologicalSort(systemIds: string[]): string[] {
  const set = new Set(systemIds);
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const id of set) {
    graph.set(id, []);
    inDegree.set(id, 0);
  }

  for (const dep of SYSTEM_DEPS) {
    if (set.has(dep.from) && set.has(dep.to)) {
      graph.get(dep.to)!.push(dep.from);
      inDegree.set(dep.from, (inDegree.get(dep.from) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    queue.sort();
    const current = queue.shift()!;
    sorted.push(current);
    for (const neighbor of graph.get(current) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  for (const id of set) {
    if (!sorted.includes(id)) sorted.push(id);
  }

  return sorted;
}

/**
 * 获取某系统的直接依赖（它需要哪些系统先存在）。
 */
export function getDependencies(systemId: string): SystemDep[] {
  return SYSTEM_DEPS.filter((d) => d.from === systemId);
}
