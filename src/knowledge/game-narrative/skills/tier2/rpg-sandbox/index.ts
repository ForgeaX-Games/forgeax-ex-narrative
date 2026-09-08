/**
 * rpg-sandbox — 品类叙事包（沙盒 RPG / Open-ended Sandbox RPG）
 *
 * 涌现叙事型（中等叙事 30-50%）：作者不写死主线，而是搭好一个充满张力的
 * 活体世界——多势力割据、经济与战争模拟、可自由站队/叛变/建国。玩家的命运
 * 由自己的选择与系统涌现共同书写（骑马与砍杀 / 剑士 Kenshi）。
 *
 * 沙盒链：通用前驱(偏好→初步方案) +
 *   [世界观 → 角色 → 道具 → L0框架 → 大纲批次 → (任务∥场景)]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 沙盒 RPG 世界观原型（"自行运转的活体大陆"）
- 系统即世界：多势力割据的版图，各阵营有领地、军队、经济与外交关系，无需玩家也在持续博弈
- 经济/战争模拟为底座：物价随战乱波动、商路因劫掠中断、王国会主动开战与议和
- 玩家是"无名之辈"而非天选之子：从流民/雇佣兵起步，凭实力自定义命运（商队主、领主、佣兵团长、起义军）
- 涌现式历史：故事不来自剧本，而来自势力兴衰、围城攻防、背叛与联姻在系统中自然发生
- 低引导高自由：世界只给"处境与规则"，不给"该去哪"；意义由玩家在沙盒里自行赋予
- 代表母题：乱世求存（骑砍卡拉迪亚）、废土夹缝中的渺小个体（剑士 Kenshi）
`.trim();

const WORLDVIEW_STYLE = `
- 语调：粗粝、写实、不浪漫化；世界对玩家冷漠中立，强者生弱者亡
- 世界观以"势力 + 资源 + 矛盾"三件套铺设：每个阵营给出地盘、经济命脉、与谁为敌
- 留足系统接口：地形/物产/政体差异要能驱动 AI 势力的真实行为（贸易、扩张、内乱）
- 不预设主角光环，世界设定须支撑"任何身份起步都能玩出故事"
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁线性救世主叙事；世界须是"无玩家也在运转"的自洽系统
- 每个势力须有可被模拟驱动的经济命脉与领土野心，杜绝纯背景板阵营
- 设定须为"玩家可叛变/可建国/可灭国"预留空间，不锁死阵营归属
- 地理与资源分布须制造天然冲突（咽喉商道、争议边境），为涌现战争供燃料
`.trim();

const WORLDVIEW_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："中世纪乱世佣兵 / 沙盒 RPG / 列国争霸"
- 活体版图：五大王国因王位空悬陷入混战，盐道与铁矿是各国必争的经济命脉
- 势力矛盾：北方游牧靠劫掠商队为生，南方城邦靠雇佣兵团防御，二者天然为敌
- 玩家处境：以破产小商人身份开局，可选择押镖致富、投军受封、或拉队伍自立
`.trim();

const CHARACTER_ARCHETYPE = `
# 沙盒 RPG 角色原型（玩家自塑 + 系统群像）
- 主角彻底留白：无预设性格与出身，身份由玩家行动定义（一念商贾，一念军阀）
- 同伴是"可招募的活人"：各有出身故事、技能专长、忠诚阈值，会因待遇/理念离队或哗变
- 势力领袖群像：国王、领主、族长——有性格化的扩张欲与外交倾向，是玩家结盟或开战的对象
- NPC 作为"系统节点"：村长、商人、酒馆雇佣兵，是任务、情报与经济循环的接口
- 宿敌由玩法生成：被你劫过的领主、抢过地盘的对手会记仇，关系是博弈出来的而非写定的
`.trim();

const CHARACTER_STYLE = `
沙盒角色塑造：主角留白以承载玩家投射；同伴用"一句出身 + 一个执念 + 一条忠诚红线"立住，
让招募与流失本身成为故事。势力领袖要有可被系统驱动的鲜明诉求，使外交与战争各有动机。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 主角性格须留白，杜绝固定人设压制玩家命运的自由书写
- 同伴须带可触发的忠诚/离队条件，让人际关系随玩法演变而非静态陪跑
- 势力领袖动机须可驱动 AI 行为（贪婪、复仇、自保），避免无诉求的工具人
- 敌友关系须可逆：今日盟友可因利益反目，杜绝写死的永久阵营标签
`.trim();

const ITEM_DATABASE_STYLE = `
# 沙盒资产 Lore 守则（装备/商品/产业即玩法资源）
- 物品首先是"经济与战争的筹码"：武器决定战力、商品决定财路、地契决定根基
- 装备带地域来历标签：某国锻造的板甲、游牧民的复合弓，外观与产地呼应世界版图
- 稀有物承载微叙事：传家宝剑、亡国君主的印玺，掉落即带一段乱世残卷
- 资产可经营化：作坊、商队、城堡是"可叙事的产业"，其兴衰本身就是玩家的故事线
- 价格即叙事：战乱区盐价飞涨、铁器禁运，物品清单要反映世界的动态经济状态
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 物品须兼具玩法功能与世界归属，杜绝纯数值且无产地来历的道具
- 稀有/独特物须带乱世风味的一句来历，避免现代说明书腔调
- 可经营资产须能反映系统状态（受战乱/商路影响），不做静态摆设
- 物价/供给描述须与当前势力局势自洽，杜绝脱离经济模拟的孤立标价
`.trim();

const STORY_FRAMEWORK_STYLE = `
# 沙盒 RPG 故事框架（处境驱动的开放骨架）
- L0 不是线性主线，而是"初始处境 + 若干可激活的势力剧情钩子"
- 给玩家三类可自选的命运轨道：经商致富 / 投效受封 / 拥兵自立，每条只给起点与张力，不给终点
- 用"世界事件"代替章节：王位之争、瘟疫、入侵等大事件作为可介入的涌现节点
- 框架须为"玩家中途改道"留弹性：从商队主转为起义领袖也能自然衔接
`.trim();

const STORY_FRAMEWORK_EXAMPLES = `
# L0 骨架风味示例
## 主题："乱世佣兵的崛起"
- 初始处境：身无分文流落边境小镇，唯一资产是一把旧剑与三名饥肠辘辘的同伴
- 命运钩子A（经商）：盐道因战乱中断，囤盐转手可获暴利，但要穿越劫匪盘踞的山口
- 命运钩子B（投效）：边境领主正募兵抗击游牧入侵，立功可受封一座破败村庄
- 命运钩子C（自立）：流民聚集成势，若你愿做头目，可在三不管地带建起第一个营寨
`.trim();

const STORY_FRAMEWORK_CONSTRAINTS = `
- L0 禁止规定唯一结局；须以"可自由组合的命运轨道 + 世界事件"组织
- 每条命运轨道须只给起点与核心张力，把走向交还给玩家与系统
- 须标注玩家可"中途改道"的衔接点，杜绝锁死单一身份的剧情
- 世界事件须可在无玩家参与时也推进，玩家是介入者而非唯一推动力
`.trim();

const OUTLINE_BATCH_STYLE = `
# 沙盒大纲批次守则（模块化的涌现素材库）
- 大纲产出的是"可被系统调用的剧情模块"，而非固定先后的章节序列
- 每个模块自带触发条件（地点/势力关系/玩家身份），由玩法状态决定是否激活
- 模块须高度可组合、可重入：同一围城剧情在不同阵营视角下应能复用
- 优先批量产出"涌现引信"：劫掠、叛变、联姻、起义等可反复发生的事件骨架
`.trim();

const OUTLINE_BATCH_CONSTRAINTS = `
- 大纲须以"条件触发的独立模块"组织，杜绝强制线性的章节链
- 每个模块须声明触发条件与可复用场景，避免一次性写死的孤立桥段
- 模块间须可自由拼接、可在不同身份下重入，禁止互相强依赖的硬顺序
- 须覆盖多种玩家身份路径，杜绝只服务单一命运轨道的偏科大纲
`.trim();

const QUEST_GENERATION_STYLE = `
# 沙盒任务守则（处境型任务，非线性指令）
- 任务源于世界状态：领主求援、商会悬赏、村庄被劫，由当前局势自然生成
- 多解优先：同一任务可用战斗/贿赂/潜入/谈判等多路径达成，尊重玩家自定义打法
- 任务结果反作用于世界：完成与否会改变势力关系、声望与经济，制造涟漪
- 提供"灰色委托"：劫镖、暗杀、走私等不分善恶的任务，强化沙盒的道德自由
- 任务发布者是活人：其立场与你的声望决定能否接到、报酬几何
`.trim();

const QUEST_GENERATION_CONSTRAINTS = `
- 任务须由世界状态驱动生成，杜绝与局势脱节的孤立跑腿
- 关键任务须提供多解路径，禁止唯一正确解法压制玩家自由
- 任务结局须对世界产生可感知反馈（声望/势力/经济），不做无后果的功能格
- 须包含道德灰色选项，避免非黑即白的善恶绑架
`.trim();

const SCENE_GENERATION_STYLE = `
# 沙盒环境叙事守则（用地貌与据点讲世界状态）
- 场景即世界状态的快照：被烧毁的村庄、戒严的城门、繁荣的边境市集，一眼读出局势
- 据点反映归属与兴衰：领主城堡的旗帜、驻军数量、市集物资体现谁在掌权、是战是和
- 用环境暗示涌现历史：战场遗骸、废弃营寨、难民营，是系统过往博弈留下的痕迹
- 自由探索的"无引导"留白：荒野、废墟、隘口不挂任务标记，奖励主动闯荡的玩家
- 场景须随势力变动而变：易主的城镇换旗换守军，杜绝一成不变的静态据点
`.trim();

const SCENE_GENERATION_CONSTRAINTS = `
- 场景须承载世界状态信息，禁止与局势无关的纯战斗场地
- 据点视觉标签须反映当前归属与兴衰，并能随势力更替而变化
- 须保留无引导的探索留白，杜绝处处任务标记的强引导设计
- 环境叙事须呼应系统的涌现历史，避免与势力局势矛盾的孤立布景
`.trim();

export const RPG_SANDBOX_SKILL: NarrativeSkill = {
  genreCode: "rpg-sandbox",
  tier: "tier2",
  matchKeywords: ["沙盒rpg", "骑马与砍杀", "剑士", "mount and blade", "kenshi"],
  // 沙盒涌现链：世界观 → 角色 → 道具 → L0框架 → 大纲批次 → (任务∥场景)
  narrativeSteps: [
    "worldview",
    "character_enrichment",
    "item_database",
    "story_framework",
    "outline_batch",
    ["quest_generation", "scene_plan"],
  ],
  stepSkills: {
    worldview: {
      slots: {
        worldview_archetype: WORLDVIEW_ARCHETYPE,
        style_guide: WORLDVIEW_STYLE,
        constraints: WORLDVIEW_CONSTRAINTS,
        examples: WORLDVIEW_EXAMPLES,
      },
    },
    character_enrichment: {
      slots: {
        character_archetype: CHARACTER_ARCHETYPE,
        style_guide: CHARACTER_STYLE,
        constraints: CHARACTER_CONSTRAINTS,
      },
    },
    item_database: {
      slots: {
        style_guide: ITEM_DATABASE_STYLE,
        constraints: ITEM_DATABASE_CONSTRAINTS,
      },
    },
    story_framework: {
      slots: {
        style_guide: STORY_FRAMEWORK_STYLE,
        examples: STORY_FRAMEWORK_EXAMPLES,
        constraints: STORY_FRAMEWORK_CONSTRAINTS,
      },
    },
    outline_batch: {
      slots: {
        style_guide: OUTLINE_BATCH_STYLE,
        constraints: OUTLINE_BATCH_CONSTRAINTS,
      },
    },
    quest_generation: {
      slots: {
        style_guide: QUEST_GENERATION_STYLE,
        constraints: QUEST_GENERATION_CONSTRAINTS,
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

registerSkill(RPG_SANDBOX_SKILL);
