/**
 * custom-team/distill-prompts.ts — 两个蒸馏专家的提示词
 *
 * ─────────────────────────────────────────────────────────────────
 * 蒸馏专家不读原文
 * ─────────────────────────────────────────────────────────────────
 * 它读的是 IP 提炼管线已经产出的**模板 + 算子**。这是产品侧的原话
 * （「复用IP提炼管线（IP提炼专家）和书籍模板蒸馏工具」）：提炼把书读成结构化数据，
 * 蒸馏只做最后一步——把这些数据收敛成一份能挂进各席位的技能包。
 *
 * 让蒸馏再读一遍全文是重复劳动，而且会绕过提炼的层级归纳，退化成"看了个开头就总结风格"。
 *
 * ─────────────────────────────────────────────────────────────────
 * 两席的差别在**归纳的跨度**
 * ─────────────────────────────────────────────────────────────────
 * 2.4.1 归纳一本书：结构骨架可以具体到"第几幕出现什么"，因为只有这一本。
 * 2.4.2 归纳跨作品：凡是只在某一本里成立的都要被过滤掉，留下的才是作者的方法论。
 *       所以它额外吃作者本人资料（访谈/创作谈/百科检索），那是"作者怎么想"的直接证据。
 */
import type { TeamRecord } from "./types.js";

/** 蒸馏的输入证据：每本书一段（由 IP 提炼产出摘要而来）。 */
export interface BookEvidence {
  title: string;
  bookUid: string;
  /** 提炼出的模板要点（世界观/角色/结构/核心元素）。 */
  templateDigest: string;
  /** 提炼出的算子要点（名称 + 定义）。 */
  operatorDigest: string;
  /** 引用到的算子 uid，供 profile 追溯。 */
  operatorUids: string[];
  /** 这本书的提炼 run 键，回填进 BookGroup 以便日后回到提炼产物。 */
  ipDnaRunId?: string;
}

export interface DistillEvidence {
  books: BookEvidence[];
  /** 2.4.2：作者本人资料原文（用户上传的访谈/创作谈等）。 */
  authorMaterials?: string;
  /** 2.4.2：百科娘检索到的作者公开资料。 */
  encyclopedia?: string;
}

/** 技能包按席位建键；这里列出可被注入的席位与它们各自要什么。 */
export const SKILL_TARGET_SEATS: readonly { seatId: string; name: string; asks: string }[] = [
  { seatId: "worldview", name: "世界观设定助手", asks: "这位作者/这本书怎么立世界：规则从哪来、哪些留白、信息怎么释放" },
  { seatId: "character", name: "角色档案助手", asks: "人物怎么立：欲望与缺口怎么配、弧光怎么走、声音怎么区分" },
  { seatId: "item", name: "道具清单助手", asks: "器物在叙事里承担什么：是线索、是象征，还是关系的载体" },
  { seatId: "scene_list", name: "场景列表助手", asks: "空间怎么参与叙事：环境施加什么压力、透露什么信息" },
  { seatId: "outline", name: "故事大纲助手", asks: "宏观怎么切：单元如何划分、主题如何贯穿" },
  { seatId: "structure", name: "故事结构助手", asks: "剧情树怎么长：分支在哪开、代价怎么设、如何收束" },
  { seatId: "plot", name: "故事情节助手", asks: "节点内容怎么写：场面怎么起、转折怎么落、留白留在哪" },
  { seatId: "quest", name: "任务助手", asks: "把叙事转成任务时保住什么：动机的来源、完成条件的叙事含义" },
  { seatId: "storyboard", name: "分镜助手", asks: "画面语言：视角、景别节奏、情绪的视觉落点" },
  { seatId: "deai", name: "去 AI 味助手", asks: "这位作者的笔迹特征——哪些写法一眼能认出是他，而不是通稿" },
];

const OUTPUT_SCHEMA = `## 输出格式（严格 JSON）
{
  "displayName": "展示名",
  "summary": "一句话说清这位成员擅长什么",
  "signatureTraits": ["风格签名，3-6 条，每条要具体到能照着写"],
  "taboos": ["禁区：这位作者/这本书不会做的事，2-5 条"],
  "structureTemplate": "结构骨架（仅单本蒸馏填；跨作品蒸馏留空字符串）",
  "methodology": "创作方法论（仅跨作品蒸馏填；单本蒸馏留空字符串）",
  "stageSkills": {
    "<席位id>": "写给该席位的技能段，直接进它的提示词，用第二人称祈使句"
  },
  "operatorUids": ["引用到的算子 uid"]
}

stageSkills 的每一段都要**可执行**：写"注意人物弧光"没有用，
要写"他的人物弧光从不靠顿悟推进，而是靠反复失败后的一次让步——请照此安排转折"。`;

const COMMON_DISCIPLINE = `## 纪律

1. **只归纳证据里有的**。材料没体现的偏好不要补——蒸馏出一份放之四海皆准的"好好写"，
   等于没有蒸馏，而且它会挤掉真正的品类技能。
2. **不要复述情节**。技能包是方法，不是剧情摘要；下游席位要写的是**新故事**。
3. **禁区与签名一样重要**。只说"该做什么"，模型会把它当锦上添花；
   说清"不做什么"，风格才有边界。
4. **有多少证据说多少话**。某个席位在材料里找不到依据，就不要给它写 stageSkills 条目——
   宁缺勿滥：假技能会以真技能的身份注入进提示词，且没有任何一步会报错。`;

function bookEvidenceBlock(evidence: DistillEvidence): string {
  if (evidence.books.length === 0) return "（没有提炼产物：这次蒸馏没有可用证据）";
  return evidence.books
    .map((b) => `### 《${b.title}》\n#### 提炼出的模板\n${b.templateDigest}\n#### 提炼出的算子\n${b.operatorDigest}`)
    .join("\n\n");
}

/** 2.4.1 模板创作助手蒸馏专家。 */
export function bookTemplateSystemPrompt(record: TeamRecord): string {
  return `你是书籍模板蒸馏专家。你的产物是一位**《${record.source}》模板创作助手**——
一个能照这本书的骨架与笔法去写新故事的助手。

你拿到的是 IP 提炼管线对这本书的产出（模板 + 算子），不是原文。请在此之上做最后一步归纳：
把"这本书是怎么被写出来的"收敛成各创作环节能直接照办的技能。

## 单本蒸馏的特权与义务

因为只有这一本，你**可以**具体：结构骨架可以写到"哪一段该出现什么功能位"。
但也因此你**必须**分清"这本书的写法"与"这本书的故事"——助手要能写别的故事，
拿它去复刻同一个情节就是失败的蒸馏。

${COMMON_DISCIPLINE}

## 可注入的席位
${SKILL_TARGET_SEATS.map((s) => `- \`${s.seatId}\`（${s.name}）：${s.asks}`).join("\n")}

${OUTPUT_SCHEMA}`;
}

/** 2.4.2 作家创作顾问蒸馏专家。 */
export function authorAdvisorSystemPrompt(record: TeamRecord): string {
  return `你是作家创作顾问蒸馏专家。你的产物是一位**${record.source}创作顾问**——
不是某一本书的复刻器，而是这位作者跨作品稳定的创作方法论。

你拿到的是 IP 提炼管线对这位作者多部作品的产出，外加作者本人的资料
（访谈、创作谈、公开检索）。后者是"他怎么想"的直接证据，前者是"他实际怎么做"。
两者冲突时**以作品为准**——作者自述的偏好未必是他真正的手法。

## 跨作品蒸馏的判据

只在一本书里成立的写法**不算方法论**，请剔除。留下的应当满足：至少两部作品里都能看到，
或者作者自己在资料里明确当成信条、且作品不与之矛盾。
只有一本书可用时，如实在 summary 里说明证据不足，不要把单本特征伪装成跨作品规律。

${COMMON_DISCIPLINE}

## 可注入的席位
${SKILL_TARGET_SEATS.map((s) => `- \`${s.seatId}\`（${s.name}）：${s.asks}`).join("\n")}

${OUTPUT_SCHEMA}`;
}

export function distillUserPrompt(record: TeamRecord, evidence: DistillEvidence): string {
  const parts: string[] = [];
  parts.push(
    record.kind === "book_template"
      ? `## 蒸馏目标\n《${record.source}》——单本蒸馏`
      : `## 蒸馏目标\n${record.source}——跨 ${evidence.books.length} 部作品的全维度蒸馏`,
  );
  parts.push(`## IP 提炼产出（按书分组，分组由用户上传时声明）\n${bookEvidenceBlock(evidence)}`);

  if (record.kind === "author_advisor") {
    parts.push(
      evidence.authorMaterials?.trim()
        ? `## 作者本人资料（用户上传）\n${evidence.authorMaterials}`
        : "## 作者本人资料（用户上传）\n（未上传）",
    );
    parts.push(
      evidence.encyclopedia?.trim()
        ? `## 作者公开资料（百科娘检索）\n${evidence.encyclopedia}`
        : "## 作者公开资料（百科娘检索）\n（本次没有检索结果，不得以记忆补充）",
    );
  }
  return parts.join("\n\n");
}
