/**
 * 品类 → 管线形态族映射。
 *
 * ⚠️ 名字有历史包袱：这里的 `NarrativeType` 指的是**管线形态族**
 * （该品类的叙事按哪种方式生产：linear/branching/fragmented/emergent/minimal），
 * 按"玩法/叙事生产结构"归类，不含运营视角。
 *
 * 它**不是** PRD v1.4 §3.2.2 里那个用户可选的「叙事类型」轴
 * （剧情/喜剧/悲剧/科幻…）—— 后者在 narrative-axes/story-types.ts，类型名为 `StoryTypeCode`。
 * 两者不可互相转换，也不要在同一处混用。文档中提到本枚举时一律称"管线形态"。
 */

export type NarrativeType =
  | "linear"
  | "branching"
  | "fragmented"
  | "emergent"
  | "minimal";

export const GENRE_NARRATIVE_TYPE: Record<string, NarrativeType> = {
  // linear: 线性主线（JRPG/3A动作/仙侠/剧情FPS）
  "rpg-jrpg": "linear",
  "rpg-wuxia": "linear",
  "rpg-open-world": "linear",
  "act-linear": "linear",
  "act-adventure": "linear",
  "act-character": "linear",
  "act-stealth": "linear",
  "fps-story": "linear",
  "tps-adventure": "linear",
  "puz-narrative": "linear",
  "str-tactics": "linear",
  "rpg-srpg": "linear",
  "act-immersive-sim": "linear",

  // branching: 重度分支（AVG/互动叙事/CRPG/乙女/恋爱/文字冒险）
  "adv-vn": "branching",
  "adv-interactive": "branching",
  "rpg-crpg": "branching",
  "adv-otome": "branching",
  "adv-text": "branching",
  "sim-dating": "branching",
  "adv-detective": "branching",
  "adv-pointclick": "branching",
  "adv-puzzle": "branching",
  "card-narrative": "branching",
  "adv-horror-vn": "branching",
  "adv-raising": "branching",
  "adv-life-sim": "branching",
  "hor-psychological": "branching",

  // fragmented: 碎片化叙事（Souls-like/银河恶魔城/ARPG/步行模拟/生存恐怖）
  "rpg-arpg": "fragmented",
  "rpg-soulslike": "fragmented",
  "rpg-dungeon": "fragmented",
  "act-metroidvania": "fragmented",
  "act-2d-platformer": "fragmented",
  "adv-walking-sim": "fragmented",
  "adv-horror": "fragmented",
  "hor-survival": "fragmented",
  "hor-cosmic": "fragmented",
  "hor-chase": "fragmented",
  "fps-looter": "fragmented",
  "fps-extraction": "fragmented",
  "act-survival": "fragmented",

  // emergent: 涌现叙事（沙盒/生存/4X/模拟经营）
  "sim-sandbox": "emergent",
  "sim-survival": "emergent",
  "sim-tycoon": "emergent",
  "sim-life": "emergent",
  "sim-social": "emergent",
  "sim-raising": "emergent",
  "sim-creature": "emergent",
  "srv-open": "emergent",
  "srv-craft": "emergent",
  "srv-space": "emergent",
  "srv-creative": "emergent",
  "str-4x": "emergent",
  "str-tbs": "emergent",
  "sim-colony": "emergent",
  "str-grand": "emergent",
  "rpg-sandbox": "emergent",
  "misc-farm": "emergent",
  "misc-pokemon": "emergent",

  // ── 原 operational 重归类（按玩法/叙事生产结构，不再用"运营"视角）──
  // linear：MMO/抽卡/偶像·叙事·音乐动作 — 有授权主线与角色剧情
  "rpg-mmorpg": "linear",
  "rpg-gacha": "linear",
  "rhy-idol": "linear",
  "rhy-narrative": "linear",
  "rhy-action": "linear",
  // emergent：策略/管理 — 叙事由世界框架 + 系统事件涌现
  "str-slg": "emergent",
  "spt-mgmt": "emergent",
  // fragmented：Roguelike — 多周目碎片叙事
  "rpg-roguelike": "fragmented",
  // minimal：MOBA/英雄射击/大逃杀/格斗/体育模拟 — 叙事仅作角色与世界点缀
  "str-moba": "minimal",
  "fps-hero": "minimal",
  "fps-br": "minimal",
  "fgt-traditional": "minimal",
  "fgt-anime": "minimal",
  "fgt-weapon": "minimal",
  "spt-sim": "minimal",

  // minimal: 极简叙事（超休闲/IO/纯解谜/纯节奏）
  "cas-hyper": "minimal",
  "cas-io": "minimal",
  "cas-idle": "minimal",
  "cas-party": "minimal",
  "cas-puzzle": "minimal",
  "puz-pure": "minimal",
  "puz-physics": "minimal",
  "puz-match": "minimal",
  "rhy-pure": "minimal",
  "race-sim": "minimal",
  "race-kart": "minimal",
  "spt-extreme": "minimal",
  "spt-fighting": "minimal",
  "fgt-platform": "minimal",
  "stg-bullet": "minimal",
  "str-autobattle": "minimal",
  "str-rts": "minimal",
  "str-td": "minimal",
  "rpg-idle": "minimal",
  "act-musou": "minimal",
  "cas-cozy": "minimal",
  "act-beatup": "minimal",
  "card-ccg": "minimal",
  "card-dbg": "minimal",
  "card-boardgame": "minimal",
  "hor-coop": "minimal",
  "misc-pinball": "minimal",
  "misc-edu": "minimal",
  "misc-survivor": "minimal",

  // T4 微叙事扩展（叙事卡预设升格品类）
  "puz-merge": "minimal",
  "puz-connect": "minimal",
  "puz-tetris": "minimal",
  "puz-bubble": "minimal",
  "puz-word": "minimal",
  "cas-runner": "minimal",
  "cas-snake": "minimal",
  "cas-stack": "minimal",
  "cas-timing": "minimal",
  "cas-sling": "minimal",
  "cas-fishing": "minimal",
  "cas-action": "minimal",
  "cas-spot": "minimal",
};

export function getNarrativeType(genreCode: string): NarrativeType {
  return GENRE_NARRATIVE_TYPE[genreCode] ?? "linear";
}
