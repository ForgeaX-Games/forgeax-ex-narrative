/**
 * rpg-dungeon — 品类叙事包（地牢探索 / Dungeon Crawler）
 *
 * 碎片叙事型：没有完整的 L0-L5 主线剧情链，叙事被拆解进地牢层级、
 * 遗物 Lore 与场景残骸之中。玩家通过"层层下潜 + 拾取解读"拼凑真相
 * （暗黑破坏神 / 世界树迷宫 / 火炬之光）。
 *
 * 碎片链：通用前驱(偏好→初步方案) + [世界观 → 角色 → 道具 → 场景]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 地牢探索世界观原型（"逐层下潜的诅咒之地"）
- 垂直叙事结构：地牢以"层"为单位组织世界，越深越古老、越危险、越接近核心秘密
- 每一层是一个"凝固的时代切片"：废弃矿坑 / 被吞噬的图书馆 / 古神祭坛，各有独立来历
- 灾变母题：地牢的存在源于一次失败的仪式 / 沉睡之物 / 文明的贪婪，留下不断滋生的怪物
- 地表据点（小镇/营地）作为安全锚点：商人、铁匠、酒馆传闻是世界碎片的口述来源
- 装备与战利品是世界的"考古层"：随层数加深，遗物年代与文明背景逐级揭示
`.trim();

const WORLDVIEW_STYLE = `
- 语调：阴郁、危险、带"贪婪驱动探索"的宿命感；地表温暖，地底冰冷
- 世界观以"层"为骨架描述，每层给出"环境主题 + 历史来历 + 怪物生态"三要素
- 真相不靠过场叙述，而靠玩家从层级递进与遗物拾取中自行拼合
- 为随机生成/重复刷层留接口：世界设定须能支撑"同一层不同布局"的复玩逻辑
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁用线性主线交代世界真相；真相必须可被拆成可拾取、可分布的碎片
- 每层须有独立可辨识的视觉与历史标签，避免"千层一面"的换皮地牢
- 地表据点须承担"碎片汇集与解读"的功能，不做纯功能性商店背景
- 灾变根源须埋在最深层，前期只给侧影与传闻，杜绝开局即剧透
`.trim();

const CHARACTER_ARCHETYPE = `
# 地牢探索角色原型（下潜者与据点群像）
- 主角：动机驱动的下潜者（赏金 / 复仇 / 寻人 / 偿债），性格可留白以承载代入
- 据点 NPC 群像：铁匠、商人、神官、退役冒险者——每人是一条口述传闻的来源
- 已逝者：地牢中遇见的尸体、日记主人、前辈冒险者，以"缺席"的方式参与叙事
- 怪物作为"角色"：精英怪 / 层主须有可读的来历，是这一层历史的具象化产物
- 反派/核心存在：盘踞最深层的诅咒源头，玩家全程只闻其名、终局方见其形
`.trim();

const CHARACTER_CONSTRAINTS = `
- 主角性格须适度留白，让"下潜动机"承担代入感，而非塑造满的固定主角
- 据点 NPC 须各自携带 1 条可被遗物/层级印证的传闻种子
- "已逝前辈"是关键叙事载体：其遗物、遗言须与某层历史互相印证
- 层主须是该层历史的人格化产物，禁止纯数值堆砌的无背景 Boss
`.trim();

const ITEM_DATABASE_STYLE = `
# 地牢遗物 Lore 守则（道具描述即世界碎片）
- 每件高品质遗物附一段"考古短文"：来历 / 原主 / 失落经过，串起世界年代轴
- 装备词条与外观须呼应所属层级的文明与年代（越深越古老越诡异）
- 系列遗物（套装）讲一个跨层故事：集齐才拼出某段失落历史的全貌
- 普通掉落也带微叙事标签（"沾血的矿工护符"），让刷怪过程持续渗透氛围
- 关键剧情物品藏于特定层级，作为"碎片拼图"的核心节点
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 严禁纯属性描述的遗物；每件值得记忆的物品都要带一句世界 Lore
- 遗物 Lore 须与其掉落层级的历史标签自洽，杜绝年代/文明错位
- 套装叙事须可"分段获得、终局拼合"，单件能暗示整体却不剧透
- 道具文案语气须统一为"考古残卷感"，避免现代说明书腔调
`.trim();

const SCENE_GENERATION_STYLE = `
# 地牢环境叙事守则（用层级场景与残骸讲故事）
- 每层入口给"一眼可读的氛围印象"：光线、声音、空气、残留痕迹
- 用环境讲历史：干涸的血迹、半截的日记、坍塌的祭坛、定格的死亡姿态
- 可交互的"无声叙事点"：血字、刻痕、被啃食的尸骸、未完成的法阵
- 越深层环境越扭曲：从人造结构逐渐过渡到非自然的、违背常理的空间
- 据点与地牢形成强烈对比：温暖灯火 vs 永恒幽暗，强化下潜的心理压力
`.trim();

const SCENE_GENERATION_CONSTRAINTS = `
- 场景须主动"讲故事"，禁止只做战斗场地的功能性堆砌
- 每层至少布置 2-3 个无声叙事点（残骸/血字/遗物现场），与该层 Lore 呼应
- 环境扭曲度须随层数单调递进，杜绝深浅层氛围错乱
- 随机布局下仍须保证关键叙事点稳定出现，不被生成算法淹没
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："被诅咒的矿井 / 地牢探索 / 失落文明"
- 层级切片：废弃矿坑(贪婪) → 被淹的工人居所(灾变) → 矮人古城(文明巅峰) → 封印祭坛(根源)
- 遗物 Lore："锈蚀的工头铭牌"记录最后一次开采令；集齐三枚矿工护符拼出封印崩裂的真相
- 无声叙事点：祭坛前定格的祈祷姿态尸群，暗示仪式在瞬间失败
- 终局存在：最深层苏醒的"被开采出的古神"，全程只在墙刻与遗物中现身
`.trim();

export const RPG_DUNGEON_SKILL: NarrativeSkill = {
  genreCode: "rpg-dungeon",
  tier: "tier2",
  matchKeywords: ["dungeon crawler", "地牢", "地牢探索", "暗黑破坏神", "Diablo", "世界树迷宫", "火炬之光", "Roguelike地牢", "刷宝"],
  // 碎片链：世界观 → 角色 → 道具 → 场景（无 L0-L5 主线）
  narrativeSteps: ["worldview", "character_enrichment", "item_database", "scene_plan"],
  stepSkills: {
    worldview: {
      slots: {
        worldview_archetype: WORLDVIEW_ARCHETYPE,
        style_guide: WORLDVIEW_STYLE,
        constraints: WORLDVIEW_CONSTRAINTS,
        examples: FEW_SHOT_EXAMPLES,
      },
    },
    character_enrichment: {
      slots: {
        character_archetype: CHARACTER_ARCHETYPE,
        style_guide: "地牢角色塑造：主角留白承载代入，据点 NPC 各持一条传闻，已逝前辈与层主皆是历史的人格化碎片。",
        constraints: CHARACTER_CONSTRAINTS,
      },
    },
    item_database: {
      slots: {
        style_guide: ITEM_DATABASE_STYLE,
        constraints: ITEM_DATABASE_CONSTRAINTS,
      },
    },
    scene_plan: {
      slots: {
        style_guide: SCENE_GENERATION_STYLE,
        constraints: SCENE_GENERATION_CONSTRAINTS,
      },
    },
  },
};

registerSkill(RPG_DUNGEON_SKILL);
