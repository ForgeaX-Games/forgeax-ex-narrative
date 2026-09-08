/**
 * hor-chase — 品类叙事包（跑酷恐怖 / 被追逐恐怖）
 *
 * 碎片叙事型（氛围纯粹 / 弱角色）：玩家手无寸铁，唯一选择是奔逃与躲藏。
 * 叙事极简，压迫极大——靠环境、追猎者的存在与零星线索维持恐惧，
 * 而非完整剧情（逃生 / 恐惧之间 / 暮色森林）。
 *
 * 碎片链（无角色塑造段）：通用前驱(偏好→初步方案) + [世界观 → 道具 → 场景]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 跑酷恐怖世界观原型（"无处可逃的猎场"）
- 猎场母题：一个被某种存在统治的封闭空间，玩家是猎物而非英雄
- 绝对无力：没有武器、没有反击，唯一的动词是"跑、躲、藏、屏息"
- 追猎者的"全知压迫"：敌人强大、执着、可能无法被杀死，制造持续的不安全感
- 极简叙事土壤：世界只交代"你为何在此、为何被追"，其余留给环境与想象
- 路线即生存：地图须充满可奔逃路径、藏身点与死路，空间本身就是恐怖装置
`.trim();

const WORLDVIEW_STYLE = `
- 语调：高肾上腺素、喘息感、被凝视的恐惧；安全只是下一次奔逃前的喘息
- 世界观极度克制：用最少的设定交代处境，把篇幅让给"逃命空间"的设计
- 追猎者的存在感优先于其背景：先让玩家怕它，再零星透露它是什么
- 为"奔逃—躲藏—再奔逃"循环留接口：路线、藏身点、视线遮蔽须密集且自洽
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁给玩家有效反击手段；"无力"是本品类压迫感的根基
- 叙事须保持极简，杜绝大段背景倾倒稀释逃命的紧张节奏
- 追猎者须保持"难以被理解透"的威胁感，过度解释会消解恐惧
- 空间须真正支撑奔逃与躲藏，杜绝只能直线狂奔的单调走廊
`.trim();

const ITEM_DATABASE_STYLE = `
# 跑酷恐怖道具守则（道具即逃命工具与零星线索）
- 道具围绕"逃命"而非"战斗"：电池、钥匙、可推倒的障碍、可躲藏的容器
- 极少量线索物品（残页、照片、录音）零星揭示"你为何被追"，点到即止
- 工具的稀缺与电量焦虑本身即恐怖语言：手电将熄、电池见底
- 拾得的私人物品暗示前一个猎物的下场，无声加重"我也会如此"的预感
- 关键道具（逃生路线钥匙）绑定空间推进，让"找到出路"成为唯一目标
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 严禁出现强力反击道具；工具只服务于逃跑、躲藏与开路
- 线索物品须极简克制，杜绝长文档拖慢逃命节奏
- 资源（电量/钥匙）须稀缺，放大"撑不下去"的焦虑
- 前猎物遗留须暗示下场而不直白剧透，保留想象空间
`.trim();

const SCENE_GENERATION_STYLE = `
# 跑酷恐怖环境叙事守则（用猎场与痕迹讲故事）
- 用空间制造压迫：狭窄管道、可钻入的床底、忽明忽暗的走廊、必经的开阔死亡区
- 追猎者的"痕迹叙事"：拖拽的血迹、被破坏的门、它经过留下的破坏路径
- 前猎物的下场散布场景：被处理的尸体、抓痕、绝望的逃跑止于死路
- 光影与声音是核心恐怖语言：脚步由远及近、心跳声、突然降临的黑暗
- 安全屋/藏身点的短暂喘息与下一段追逐形成强烈的张弛反差
`.trim();

const SCENE_GENERATION_CONSTRAINTS = `
- 场景须服务"逃命与压迫"，禁止纯装饰而无逃生功能的空场
- 每个关键区域须同时提供奔逃路径、藏身点与"赌命"死亡区，保证节奏
- 追猎者痕迹须与其行为逻辑自洽，强化"它一直都在"的不安
- 喘息点须稀少而短暂，杜绝长时间安全消解持续压迫
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："疯人院深夜 / 跑酷恐怖 / 被追猎"
- 处境交代（极简）：你是潜入调查的记者，断电后被院内"病人"察觉，唯一目标是活着出去
- 逃命空间：通风管、储物柜、铁床下，配合忽明忽暗的走廊与必经的开阔大厅死亡区
- 追猎者痕迹：墙上一路拖拽的血手印，指向它刚刚处理掉的上一个闯入者
- 零星线索：一卷只录到尖叫与奔跑喘息的 DV 带，暗示前人同样的结局
`.trim();

export const HOR_CHASE_SKILL: NarrativeSkill = {
  genreCode: "hor-chase",
  tier: "tier2",
  matchKeywords: ["跑酷恐怖", "追逐恐怖", "被追逐", "逃生", "Outlast", "恐惧之间", "无反击恐怖", "躲藏恐怖"],
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

registerSkill(HOR_CHASE_SKILL);
