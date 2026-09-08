/**
 * act-2d-platformer — 品类叙事包（2D 横版动作）
 *
 * 碎片叙事型（氛围纯粹 / 弱角色）：叙事不靠对白主线，而靠背景演出、
 * 环境寓言、可选探索区与道具线索层层渗透（空洞骑士 / 奥日 / 蔚蓝）。
 * 主角往往沉默，世界用画面与隐喻说话。
 *
 * 碎片链（无角色塑造段）：通用前驱(偏好→初步方案) + [世界观 → 道具 → 场景]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 2D 横版世界观原型（"沉默之地的寓言地图"）
- 互联的横向世界（Metroidvania）：地图本身即叙事，区域风格暗示其历史与堕落
- 衰败母题：曾经辉煌的王国/文明在某场灾变后沉寂，玩家是闯入废墟的探索者
- 隐喻化的核心冲突：用瘟疫、辐光、心魔等意象承载抽象主题（执念 / 创伤 / 牺牲）
- 沉默主角 + 碎片化口述：偶遇的 NPC 给出零散视角，从不和盘托出全貌
- 环境分区的情绪曲线：从荒凉外围逐步深入到世界创伤的核心，氛围逐级浓缩
`.trim();

const WORLDVIEW_STYLE = `
- 语调：忧郁、诗意、克制；宏大悲剧用极简文字与浓烈画面传达
- 世界观以"区域"为单位铺设，每区给"视觉母题 + 堕落来历 + 探索情绪"
- 核心主题以意象承载（一个可视觉化的隐喻），而非直白说教
- 为非线性探索留接口：区域间的解锁关系本身就是叙事进度的隐性表达
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁大段过场旁白交代背景；世界须能被"看懂"而非"被告知"
- 核心主题须收敛为 1 个可贯穿全局的核心意象，避免主题发散
- 每个区域须有独立视觉与情绪标识，杜绝换色不换魂的关卡
- 沉默主角的设定须坚持到底，不得中途破例塞入大量主角独白
`.trim();

const ITEM_DATABASE_STYLE = `
# 横版道具/收藏品守则（道具描述即世界碎片）
- 收集品（护符/徽记/壁画残片）各附一句诗意短描，拼合出世界往事
- 能力道具的获得须绑定一段环境演出或一位逝者的遗留，让"变强"也叙事
- 隐藏区奖励侧重 Lore 价值：日志残页、旧时代器物，奖励"好奇心"而非纯数值
- 道具文案极简、留白、可回味，一句胜过一段，契合横版的诗化气质
- 关键叙事物品作为非线性拼图节点，散落在需技巧抵达的隐藏角落
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 严禁说明书式长文案；每件道具一句意象化短描，点到为止
- 道具 Lore 须服务核心意象，不引入与主题无关的设定噪音
- 隐藏奖励须"值得抵达"：要么补全一块叙事拼图，要么深化一层情绪
- 能力解锁与叙事须同步，杜绝纯机制掉落破坏氛围沉浸
`.trim();

const SCENE_GENERATION_STYLE = `
# 横版环境叙事守则（用背景与场景讲故事）
- 背景演出是主叙事手段：远景的崩塌城邦、缓慢移动的巨物、定格的悲剧群像
- 用场景细节讲历史：枯萎的圣树、石化的居民、废弃的祭坛、循环的机关残骸
- 前景—中景—远景分层叙事：玩家路过处是"现在"，背景深处是"曾经"
- 关键节点用"一镜静默"营造仪式感：让画面与音乐替代台词完成情绪高潮
- 区域过渡承担情绪转折：光影、色调、音景的变化即章节的呼吸
`.trim();

const SCENE_GENERATION_CONSTRAINTS = `
- 场景须主动叙事，禁止纯跳跃挑战的无意义空场
- 每个区域至少布置 2-3 处背景叙事点，与该区堕落来历呼应
- 情绪高潮处优先用静默演出，慎用文字解说稀释画面张力
- 视觉母题须在区域内保持一致，杜绝风格拼贴破坏沉浸
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："沉睡王国 / 横版动作 / 执念与遗忘"
- 区域链：荒废边镇(遗忘) → 辉光神殿(执念之源) → 心渊深处(创伤核心)
- 核心意象："辉光"既是力量也是吞噬记忆的瘟疫，贯穿全局
- 背景演出：远景中缓缓沉没的王座，路过的玩家无人解说却已读懂衰亡
- 收集碎片：散落的壁画残片，集齐拼出国王为留住挚爱而引来辉光的旧事
`.trim();

export const ACT_2D_PLATFORMER_SKILL: NarrativeSkill = {
  genreCode: "act-2d-platformer",
  tier: "tier2",
  matchKeywords: ["横版", "2d平台", "2D横版", "横版动作", "类银河恶魔城", "Metroidvania", "空洞骑士", "奥日", "蔚蓝", "Celeste", "Hollow Knight", "Ori"],
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

registerSkill(ACT_2D_PLATFORMER_SKILL);
