/**
 * custom-team/types.ts — 自定义专属创作团队的数据契约
 *
 * ─────────────────────────────────────────────────────────────────
 * 这是什么
 * ─────────────────────────────────────────────────────────────────
 * 用户投喂自己看重的作品，蒸馏出两种可复用的"团队成员"：
 *
 *   2.4.1 《书名》模板创作助手 —— 单本书 → 这本书的骨架与笔法；
 *   2.4.2 <作家>创作顾问     —— 同一作者多本书 + 作者本人资料 → 跨作品的创作方法论。
 *
 * 两者都**复用 IP 提炼管线**（src/ip-dna）：提炼负责把书读成模板 + 算子，
 * 蒸馏只做最后一步——把提炼结果收敛成一份能挂进各席位的技能包。
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么 stageSkills 按「席位」而不按 step 建键
 * ─────────────────────────────────────────────────────────────────
 * 同一个席位在不同品类下解析到不同 step（故事情节席在影游下是 vn_screenplay；
 * 写这段话时卡牌下还有 event_pool，已随 C3 封存进 `_archive/specialized/`）。
 * 按 step 建键必然漏掉这些变体，而且每加一条管线都要回来补登记。按席位建键
 * 一次到位——这与 `seatDerivedSlotSpec` 的理由相同。
 */

/** 单本蒸馏 / 全维度蒸馏。与前端 `viz/src/lib/customTeams.ts` 的取值逐字一致。 */
export type TeamKind = "book_template" | "author_advisor";

/**
 * draft   材料已登记，还没蒸馏（用户可以继续加材料）；
 * distilling 提炼 + 蒸馏在跑；
 * ready   profile 已产出，可被选中/注入；
 * failed  跑挂了，errorMessage 说明原因——不静默回 draft，否则用户不知道点过没点过。
 */
export type TeamStatus = "draft" | "distilling" | "ready" | "failed";

/**
 * 用户上传时**显式声明**的书籍分组。
 *
 * 为什么必须显式：`unit-identity.ts` 只能从文件名解析单部作品内的章/集/话序号，
 * 跨书归组它一个字都推不出来。让系统去猜"这三个文件是同一本书的三卷还是三本书"，
 * 猜错的代价是把三本书的风格搅成一团，而且不会报错。所以由用户声明，确定性无歧义。
 */
export interface BookGroup {
  /** 与算子语料的 `sources[].book_uid` 同格式（`BOOK::` 前缀），便于按书筛子集。 */
  bookUid: string;
  title: string;
  /** 归到这本书名下的材料文件名。 */
  files: string[];
  /** 提炼完成后回填的 IP DNA run 键，用来回到提炼产物。 */
  ipDnaRunId?: string;
}

/** 蒸馏出来的 profile —— 这就是"助手/顾问"本体。 */
export interface DistilledProfile {
  /** 展示名，如「《雨季手记》模板创作助手」。 */
  displayName: string;
  /** 一句话说清这位成员擅长什么。 */
  summary: string;
  /** 风格签名：读者一眼能认出来的那几个特征。 */
  signatureTraits: string[];
  /** 禁区：这位作者/这本书**不会**做的事。少了它，蒸馏出来的只会是泛泛的"写好一点"。 */
  taboos: string[];
  /** 2.4.1 专有：这本书的结构骨架。 */
  structureTemplate?: string;
  /** 2.4.2 专有：跨作品的创作方法论。 */
  methodology?: string;
  /**
   * 席位 id → 该席位拿到的技能段（注入进提示词的就是这一段）。
   * 键取 20 席的席位 id；没有条目的席位不注入。
   */
  stageSkills: Record<string, string>;
  /** 蒸馏引用到的算子 uid（可追溯"这条技能是从哪来的"）。 */
  operatorUids: string[];
}

export interface TeamRecord {
  id: string;
  kind: TeamKind;
  /** 单本蒸馏填书名，全维度蒸馏填作者名。 */
  source: string;
  /** 用户声明的书籍分组（单本蒸馏恒为 1 组）。 */
  books: BookGroup[];
  /**
   * 2.4.2 的作者本人资料（访谈、创作谈、年表……）文件名。
   * 与 books 分开：它们不是作品，不该进按书分组的提炼。
   */
  authorMaterials: string[];
  /** 是否让百科娘补检索作者公开资料（2.4.2 的另一半来源）。 */
  useEncyclopedia: boolean;
  status: TeamStatus;
  /** 失败原因；status=failed 时必填。 */
  errorMessage?: string;
  profile?: DistilledProfile;
  createdAt: string;
  updatedAt: string;
}

/** 归一化书名 → book_uid，与语料侧 `BOOK::` 约定对齐。 */
export function bookUidFor(title: string): string {
  const t = title.trim();
  return t.startsWith("BOOK::") ? t : `BOOK::${t}`;
}

/** 团队的展示名。用户不用自己起名——名字由形态与来源决定。 */
export function teamDisplayName(record: TeamRecord): string {
  return record.profile?.displayName
    ?? (record.kind === "book_template"
      ? `《${record.source}》模板创作助手`
      : `${record.source}创作顾问`);
}
