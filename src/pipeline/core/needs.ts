/**
 * needs.ts —— 九维 needs 矩阵的词表。
 *
 * 这三个类型原来住在 `universal-agent/types.ts` 里。那套通用三件套框架（plan /
 * execute / eval）已随它的七个 stub step 一并封存进 `_archive/universal-agent/`，
 * 但 needs 词表本身没有跟着退役：品类分类表（`GENRE_TAXONOMY.needs`）、
 * 步骤注册表（`StepDescriptor.needsKeys`）、agent 契约（`AgentDef`）都还在读它。
 *
 * 拆出来放在 core/ 而不是继续从归档区引：归档区的规矩是"没有任何活跃代码再
 * import 它们"，留一根线过去就等于那条规矩不成立，下一个人也就无从判断归档区
 * 里哪些还活着。
 *
 * 九维：W=Worldview, C=Character, S=Story, D=Dialogue, Q=Quest,
 * E=Environment, I=Item, U=UI, L=Lore。
 */

export type NeedsKey = "W" | "C" | "S" | "D" | "Q" | "E" | "I" | "U" | "L";
export type NeedsScore = 0 | 1 | 2 | 3;
export type NeedsMatrix = Partial<Record<NeedsKey, NeedsScore>>;
