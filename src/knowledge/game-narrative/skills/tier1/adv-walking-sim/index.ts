/**
 * adv-walking-sim — 品类叙事包（步行模拟）★ 旗舰
 *
 * 碎片叙事型（氛围纯粹 / 弱角色 / 第一人称回忆）：几乎没有玩法挑战，
 * 叙事全由"行走 + 物件触发的独白与回忆"承载。玩家在空间里漫步，
 * 触碰遗物，听见逝去的声音（伊迪芬奇的记忆 / 亲爱的艾斯特 / 壁炉之下）。
 *
 * 碎片链（无角色塑造段）：通用前驱(偏好→初步方案) + [世界观 → 道具 → 场景]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 步行模拟世界观原型（"可被漫步的记忆容器"）
- 空间即记忆：一座空屋、一座小镇、一段海岸，承载着已经发生过的人生
- "缺席的在场"：故事的人都已离去/逝去，世界靠他们留下的痕迹继续低语
- 第一人称的私密视角：玩家是回访者/继承者/旁观者，带着一个想被解答的疑问
- 时间的叠层：同一空间叠合着不同年代的痕迹，行走即穿越一段段过往
- 一个温柔而沉重的核心命题：关于死亡、记忆、家族、遗憾或告别
`.trim();

const WORLDVIEW_STYLE = `
- 语调：温柔、私密、诗化、略带感伤；宏大情感用最日常的物件承载
- 世界观以"空间—记忆"映射铺设：每个房间/区域对应一段人生与一种情绪
- 用"缺席"叙事：不展示活着的人，而展示他们刚离开的余温与遗留
- 为"漫步触发"留接口：叙事节点须能由玩家自由走近物件而被唤起，无强制顺序
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁用任务/战斗/失败惩罚污染氛围；推进只靠"行走与触碰"
- 核心命题须收敛为 1 个可被反复回响的情感母题，避免主题游离
- 每个空间须绑定一段可被物件触发的独白，杜绝纯装饰性空房
- 第一人称私密视角须贯穿全程，旁白节制、留白、不替玩家下结论
`.trim();

const ITEM_DATABASE_STYLE = `
# 步行模拟物件守则（物件即回忆触发器）
- 每个可交互物件是一段记忆的钥匙：照片、信件、玩具、唱片、未洗的杯子
- 物件文案/触发独白用第一人称回忆口吻，唤起一个具体的人与一个瞬间
- 日常物的反差张力：越平凡的物件越能承载越沉重的情感（一只断了带的手表）
- 物件之间形成隐性叙事链：多件物证拼出一个无法被任何单件说清的真相
- 关键物件作为情感高潮的触发点，位置与抵达时机经过情绪节奏设计
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 严禁说明书式物品描述；每个物件触发的是回忆与情绪，而非属性
- 物件独白须服务核心情感母题，杜绝无关的信息噪音
- 平凡物与沉重情感的反差须真实可信，避免刻意煽情
- 物件叙事链须可"分散触发、整体回响"，单件留白却共同指向真相
`.trim();

const SCENE_GENERATION_STYLE = `
# 步行模拟环境叙事守则（用空间与遗留讲故事）
- 空间布置即人物侧写：从一间房的陈设读出住客的性格、习惯与心事
- 用"刚离开的痕迹"制造在场感：未关的灯、半杯凉茶、压皱的床单
- 光线、声场、季节是情绪的画笔：晨光的房间与黄昏的房间讲不同的故事
- 行走路径设计为情感曲线：从外围日常逐步深入到那个被回避的核心房间
- 留白与静默是核心手法：让空间自己说话，给玩家停留与体会的余地
`.trim();

const SCENE_GENERATION_CONSTRAINTS = `
- 场景须以"读懂一个人"为目标布置，禁止纯美术堆砌的空场
- 每个空间至少埋 2-3 处可读的生活痕迹，与该空间的人物呼应
- 环境光影/声场须与情绪曲线同步，杜绝氛围与情感错位
- 核心房间须留足静默与停留空间，慎用强引导打断沉浸
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："返乡老宅 / 步行模拟 / 家族与告别"
- 空间—记忆映射：玄关(归来) → 孩子的房间(失去) → 阁楼(被封存的秘密) → 后院(和解)
- 核心母题：一个家族如何用沉默掩埋一场无人提起的离世
- 物件触发：阁楼里一盒未寄出的生日卡，每张写给同一个早已不在的人
- 缺席在场：餐桌摆着四副碗筷却只有三把椅子，无需一句旁白已道尽缺口
`.trim();

export const ADV_WALKING_SIM_SKILL: NarrativeSkill = {
  genreCode: "adv-walking-sim",
  tier: "tier1",
  matchKeywords: ["步行模拟", "walking sim", "Walking Simulator", "伊迪芬奇的记忆", "What Remains of Edith Finch", "亲爱的艾斯特", "Dear Esther", "壁炉之下", "Gone Home", "叙事漫步"],
  // 碎片链（氛围纯粹，无角色塑造段）：世界观 → 道具 → 场景
  narrativeSteps: ["worldview", "item_database", "scene_plan"],
  stepSkills: {
    worldview: {
      slots: {
        worldview_archetype: WORLDVIEW_ARCHETYPE,
        style_guide: WORLDVIEW_STYLE,
        constraints: WORLDVIEW_CONSTRAINTS,
        examples: FEW_SHOT_EXAMPLES,
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

registerSkill(ADV_WALKING_SIM_SKILL);
