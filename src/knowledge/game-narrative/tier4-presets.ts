/**
 * Tier4 休闲品类叙事卡预设 — 从 tier4-narrative-card/presets/ 转化
 * 22 个品类预设 + 1 个 generic 通用兜底
 */

export interface ElementRow {
  type: string;
  variants: string;
}

export interface ElementTable {
  category: string;
  rows: ElementRow[];
}

export interface ComboExample {
  name: string;
  protagonist: string;
  motivation: string;
  target: string;
  challenge: string;
  ending: string;
}

export interface Tier4Preset {
  id: string;
  name: string;
  comboLogic: string;
  elements: ElementTable[];
  examples: ComboExample[];
}

export interface CategoryKeyword {
  keywords: string[];
  presetId: string;
}

export const CATEGORY_KEYWORDS: CategoryKeyword[] = [
  { keywords: ["三消", "消消乐", "宝石", "糖果", "羊了个羊"], presetId: "match3" },
  { keywords: ["合成", "merge", "2048", "合并", "大西瓜"], presetId: "merge" },
  { keywords: ["跑酷", "runner", "躲避", "flappybird"], presetId: "runner" },
  { keywords: ["放置", "挂机", "idle", "自动"], presetId: "idle" },
  { keywords: ["io", "大作战", "吞噬", ".io"], presetId: "io" },
  { keywords: ["贪食蛇", "蛇", "吃变长"], presetId: "snake" },
  { keywords: ["音游", "节奏", "钢琴块"], presetId: "rhythm" },
  { keywords: ["解谜", "puzzle", "华容道", "推箱子"], presetId: "puzzle" },
  { keywords: ["堆叠", "叠高高", "平衡"], presetId: "stack" },
  { keywords: ["切水果", "飞刀", "打砖块"], presetId: "action" },
  { keywords: ["模拟", "经营", "种菜", "开店"], presetId: "simulation" },
  { keywords: ["棋牌", "扑克", "麻将", "纸牌"], presetId: "card" },
  { keywords: ["猜词", "wordle", "填字", "成语"], presetId: "word" },
  { keywords: ["塔防", "保卫萝卜", "植物大战僵尸"], presetId: "tower" },
  { keywords: ["打飞机", "射击", "雷电", "弹幕"], presetId: "shooter" },
  { keywords: ["连连看", "配对连线"], presetId: "connect" },
  { keywords: ["俄罗斯方块", "tetris", "方块消除"], presetId: "tetris" },
  { keywords: ["泡泡龙", "泡泡射击"], presetId: "bubble" },
  { keywords: ["跳一跳", "跳跃", "接东西", "doodle jump"], presetId: "timing" },
  { keywords: ["找茬", "找不同", "找隐藏", "大家来找茬"], presetId: "spot" },
  { keywords: ["弹弓", "愤怒的小鸟", "投篮", "高尔夫"], presetId: "sling" },
  { keywords: ["钓鱼", "捕鱼", "钓鱼大亨"], presetId: "fishing" },
];

export const WRITING_CORE = {
  formula: "[动词] + [角色/对象] + [做什么] + [目标/限制]！",
  storyStructure: {
    p1: "世界发生了什么（2-3句）— 建立背景和世界观，制造问题或缺失",
    p2: "你要做什么（3-5句）— 介绍角色、说明动机、描述行动，有画面感",
    p3: "为什么要赢（1-2句）— 成功愿景/悬念钩子/挑战召唤，三选一",
  },
  principles: [
    "用具体画面代替抽象描述",
    "用情感语言代替功能语言",
    "用留白代替解释",
    "用短句保持节奏",
  ],
};

export const OUTPUT_TEMPLATE = `# 《游戏名称》

## 一句话
[15-30字，秒懂+想玩]

## 故事
[三段式，共150-200字，段落间空一行]

## 玩法映射
| 元素 | 叙事包装 |
|-----|---------|
| 你是 | |
| 核心行动 | |
| 收集/消除 | |
| 失败意味着 | |
| 最终目标 | |

## 关卡拓展
- 场景线：（如：森林→雪山→火山→海底）
- 难度线：（如：敌人更强/时间更紧/空间更小）
- 最终章：（如：Boss战/大团圆/真相揭晓）`;

/** 根据用户输入匹配品类预设 */
export function matchPreset(userInput: string): Tier4Preset {
  const lower = userInput.toLowerCase();
  for (const ck of CATEGORY_KEYWORDS) {
    for (const kw of ck.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        const p = TIER4_PRESETS.find((x) => x.id === ck.presetId);
        if (p) return p;
      }
    }
  }
  return TIER4_PRESETS.find((x) => x.id === "generic")!;
}

export const TIER4_PRESETS: Tier4Preset[] = [
  {
    id: "match3",
    name: "三消品类预设",
    comboLogic: `[世界/被拯救者] 陷入 [困境]。三个 [消除元素] 连在一起会 [魔法效果]，从而解救一点点。失败 = 步数用尽；成功 = 所有人获救。故事必须解释：为什么三个一样的连在一起会消失/产生效果？`,
    elements: [
      { category: "困境类型", rows: [{ type: "黑暗笼罩", variants: "三颗宝石聚齐→爆发光芒驱散黑暗" }, { type: "封印困住", variants: "三个相同配对→解除封印" }, { type: "订单任务", variants: "三个同类凑齐→完成订单" }, { type: "魔法收集", variants: "三颗聚齐→收集魔力" }, { type: "污染清理", variants: "三个配对→净化区域" }] },
      { category: "被拯救者", rows: [{ type: "生物类", variants: "精灵, 小动物, 村民, 公主" }, { type: "区域类", variants: "村庄, 森林, 王国, 星球" }, { type: "物品类", variants: "星星, 宝石, 糖果, 花朵" }, { type: "抽象类", variants: "光明, 希望, 记忆, 梦想" }] },
      { category: "消除元素", rows: [{ type: "宝石类", variants: "红宝石, 蓝宝石, 绿宝石, 钻石" }, { type: "糖果类", variants: "棒棒糖, 软糖, 巧克力, 饼干" }, { type: "自然类", variants: "花朵, 水果, 树叶, 星星" }, { type: "生物类", variants: "小动物头像, 精灵, 表情" }, { type: "抽象类", variants: "符文, 魔法球, 能量块" }] },
      { category: "场景递进", rows: [{ type: "王国线", variants: "边境村庄→森林→山谷→城镇→王宫" }, { type: "自然线", variants: "花园→森林→雪山→沙漠→火山" }, { type: "深度线", variants: "地表→洞穴→地下湖→熔岩层→核心" }] },
    ],
    examples: [
      { name: "宝石王国保卫战", protagonist: "宝石使者", motivation: "黑暗魔法笼罩，居民沉睡", target: "王国的村庄和居民", challenge: "三颗宝石聚齐爆发光芒驱散黑暗", ending: "边境→森林→山顶→城镇→王宫" },
      { name: "糖果精灵救援", protagonist: "糖果精灵使者", motivation: "女巫把精灵变成糖果封印", target: "糖果森林的小精灵", challenge: "三个同色糖果配对解除封印", ending: "森林→糖果沼泽→棒棒糖山→女巫城堡" },
    ],
  },
  {
    id: "merge",
    name: "合成/2048品类预设",
    comboLogic: `传说中的 [最终目标物] 拥有神奇力量。两个相同的 [低级物] 碰撞会合成更高级的。失败 = 空间填满；成功 = 终极目标物诞生。故事必须解释：为什么两个一样的碰在一起会变成更高级的？`,
    elements: [
      { category: "合成逻辑", rows: [{ type: "进化", variants: "基因融合进化成更高形态" }, { type: "合体", variants: "合体变成更大更强" }, { type: "成长", variants: "融合长成更大植物" }, { type: "锻造", variants: "合并锻造更高级材料" }] },
      { category: "合成对象", rows: [{ type: "数字", variants: "2→4→8→...→2048" }, { type: "水果", variants: "葡萄→樱桃→...→西瓜" }, { type: "生物", variants: "蛋→幼崽→少年→成年→王者→神兽" }, { type: "建筑", variants: "帐篷→小屋→房子→别墅→城堡→宫殿" }] },
      { category: "最终目标", rows: [{ type: "生物类", variants: "神兽, 龙王, 凤凰, 守护神" }, { type: "物品类", variants: "神器, 圣杯, 世界树果实" }, { type: "建筑类", variants: "天空之城, 神殿, 世界奇观" }] },
    ],
    examples: [
      { name: "合成大西瓜", protagonist: "水果精灵", motivation: "培育传说大西瓜", target: "传说中的大西瓜", challenge: "相同水果融合成长", ending: "水果精灵融合成长" },
      { name: "怪物进化岛", protagonist: "怪物", motivation: "培育守护岛屿的神龙", target: "神龙守护神", challenge: "相同怪物合体进化", ending: "怪物合体进化" },
    ],
  },
  {
    id: "runner",
    name: "跑酷品类预设",
    comboLogic: `[主角] 因为 [动机] 必须不停地跑。躲避 [障碍]，收集 [物品]。失败 = 被追上/撞到障碍；成功 = 到达目的地。故事必须解释：为什么不能停下来？`,
    elements: [
      { category: "主角类型", rows: [{ type: "可爱动物", variants: "小鸡, 小猫, 小狗, 兔子" }, { type: "小人物", variants: "小男孩, 小女孩, 精灵" }, { type: "英雄角色", variants: "小骑士, 小忍者, 小海盗" }] },
      { category: "动机类型", rows: [{ type: "逃离追捕", variants: "被怪物/猎人追赶" }, { type: "寻找亲人", variants: "和妈妈走散要跑回家" }, { type: "追寻梦想", variants: "跑到传说中的地方" }] },
      { category: "场景递进", rows: [{ type: "自然线", variants: "森林→河流→山地→雪原→火山" }, { type: "城市线", variants: "街道→屋顶→地铁→摩天楼" }] },
    ],
    examples: [
      { name: "小鸡回家路", protagonist: "走散的小鸡", motivation: "和妈妈走散", target: "鸡窝", challenge: "坑洞、河流、老鹰、狐狸", ending: "和妈妈团聚" },
      { name: "姜饼人大逃亡", protagonist: "姜饼人", motivation: "不想被吃掉", target: "森林（自由）", challenge: "刀叉、热锅、面粉堆", ending: "逃到森林获得自由" },
    ],
  },
  {
    id: "idle",
    name: "放置/挂机品类预设",
    comboLogic: `[主角] 怀揣梦想，经营 [事业]。通过 [核心行动] 积累资源升级扩张，[自动机制] 让离开时也能持续收益。成功 = 从零建成 [最终形态]。`,
    elements: [
      { category: "经营对象", rows: [{ type: "商业", variants: "柠檬水摊→小店→连锁→帝国" }, { type: "农场", variants: "小菜园→农场→庄园→农业王国" }, { type: "王国", variants: "小村庄→城镇→城市→王国" }] },
      { category: "自动机制", rows: [{ type: "员工/助手", variants: "雇佣员工自动工作" }, { type: "自动化设备", variants: "建造机器自动生产" }, { type: "自然生长", variants: "种下的东西自然生长" }] },
    ],
    examples: [
      { name: "柠檬水大亨", protagonist: "柠檬水老板", motivation: "成为柠檬水大亨", target: "柠檬水帝国", challenge: "卖柠檬水赚钱；雇员工自动卖", ending: "建立全球帝国" },
      { name: "猫咪咖啡馆", protagonist: "咖啡馆老板", motivation: "建造猫咪天堂", target: "猫咪王国", challenge: "收养猫咪招待顾客", ending: "最受欢迎的猫咪咖啡馆" },
    ],
  },
  {
    id: "io",
    name: "IO/大作战品类预设",
    comboLogic: `在 [竞技场] 中，所有参与者都想成为最强。吃 [食物] 变大，够大就能吃掉其他玩家。失败 = 被更大的吞噬；成功 = 称霸竞技场。`,
    elements: [
      { category: "主角类型", rows: [{ type: "生物类", variants: "细胞, 蛇, 鱼, 史莱姆" }, { type: "物体类", variants: "黑洞, 雪球, 纸团" }] },
      { category: "成长方式", rows: [{ type: "吞噬成长", variants: "吃掉比自己小的变大" }, { type: "收集成长", variants: "收集散落资源变强" }] },
    ],
    examples: [
      { name: "球球大作战", protagonist: "彩色小球", motivation: "成为竞技场最大", target: "散落的光点+小球", challenge: "吞噬比自己小的球", ending: "成为竞技场最大的球" },
      { name: "黑洞大作战", protagonist: "小黑洞", motivation: "吞噬整个城市", target: "路灯→汽车→大楼", challenge: "吞噬物体变大", ending: "吞噬整个城市" },
    ],
  },
  {
    id: "snake",
    name: "贪食蛇品类预设",
    comboLogic: `[主角] 想要成长到 [最终形态]。吃 [食物] 变长，身体越长越难控制。失败 = 撞墙/咬到自己；成功 = 成长到最终形态。`,
    elements: [
      { category: "主角类型", rows: [{ type: "蛇类", variants: "小蛇, 彩虹蛇, 龙蛇" }, { type: "队伍", variants: "蚂蚁队伍, 小鸭子队伍" }] },
      { category: "最终目标", rows: [{ type: "进化目标", variants: "进化成最终形态（龙/蝴蝶）" }, { type: "收集目标", variants: "收集齐所有伙伴/宝物" }] },
    ],
    examples: [
      { name: "小蛇成龙记", protagonist: "小青蛇", motivation: "进化成神龙", target: "能量珠", challenge: "吃能量珠变长积累能量进化", ending: "化身神龙翱翔天际" },
      { name: "毛毛虫变蝴蝶", protagonist: "小毛毛虫", motivation: "变成美丽蝴蝶", target: "树叶", challenge: "吃树叶长大结茧", ending: "破茧成蝶" },
    ],
  },
  {
    id: "rhythm",
    name: "音游/节奏品类预设",
    comboLogic: `[音乐世界] 需要 [主角] 用节奏力量来 [目的]。跟随节拍在正确时机操作。失败 = 节奏混乱；成功 = 完美演奏。`,
    elements: [
      { category: "主角类型", rows: [{ type: "演奏者", variants: "钢琴家, 吉他手, DJ" }, { type: "角色", variants: "音乐精灵, 节奏小人" }] },
      { category: "目的/动机", rows: [{ type: "演奏音乐", variants: "完美演奏曲子" }, { type: "拯救世界", variants: "用音乐驱散黑暗" }] },
    ],
    examples: [
      { name: "钢琴块", protagonist: "钢琴演奏者", motivation: "成为世界级钢琴家", target: "下落琴键", challenge: "点击下落的黑白琴键", ending: "成为世界级钢琴家" },
    ],
  },
  {
    id: "puzzle",
    name: "解谜品类预设",
    comboLogic: `[目标/出口] 被 [障碍/机关] 挡住。通过 [操作] 移动/触发机关一步步解开。失败 = 被困住；成功 = 解开谜题到达目标。`,
    elements: [
      { category: "解谜类型", rows: [{ type: "推箱子", variants: "把箱子推到指定位置" }, { type: "华容道", variants: "移动方块让目标通过" }, { type: "路径规划", variants: "找到从起点到终点的路" }] },
      { category: "场景递进", rows: [{ type: "建筑线", variants: "仓库→工厂→实验室→神秘基地" }, { type: "遗迹线", variants: "入口→走廊→大厅→宝藏室" }] },
    ],
    examples: [
      { name: "仓库管理员", protagonist: "仓库小工", motivation: "成为最优秀管理员", target: "所有箱子归位", challenge: "推箱子到指定位置", ending: "成为最优秀管理员" },
    ],
  },
  {
    id: "stack",
    name: "堆叠/叠高高品类预设",
    comboLogic: `[主角] 想要建造 [建筑目标] 越高越好。一层层叠要对齐，偏差导致面积变小。失败 = 偏差太大无法继续；成功 = 建成通天塔。`,
    elements: [
      { category: "堆叠物", rows: [{ type: "建筑类", variants: "楼层, 砖块, 积木" }, { type: "食物类", variants: "汉堡层, 蛋糕层, 冰淇淋球" }] },
      { category: "场景递进", rows: [{ type: "高度线", variants: "地面→云层→平流层→太空" }] },
    ],
    examples: [
      { name: "盖楼大师", protagonist: "建筑工", motivation: "建造世界最高大楼", target: "摩天大楼", challenge: "楼层左右移动点击放下偏差切掉", ending: "世界最高摩天大楼" },
    ],
  },
  {
    id: "action",
    name: "动作/打砖块品类预设",
    comboLogic: `[被困者] 被 [障碍物] 层层包围。用 [弹射物] 击碎障碍弹来弹去。失败 = 球掉落；成功 = 击碎所有障碍解救目标。`,
    elements: [
      { category: "弹射物", rows: [{ type: "球类", variants: "弹球, 能量球, 光球" }] },
      { category: "障碍物", rows: [{ type: "建筑类", variants: "砖块, 石块, 冰块" }, { type: "敌人类", variants: "小怪物, 入侵者" }] },
    ],
    examples: [
      { name: "勇者救公主", protagonist: "魔法弹板", motivation: "救出城堡顶层公主", target: "被困公主", challenge: "光之球击碎砖块", ending: "击碎所有砖块救出公主" },
    ],
  },
  {
    id: "simulation",
    name: "模拟经营品类预设",
    comboLogic: `[主角] 开始经营 [店铺/农场]。通过服务/生产满足顾客需求赚取资源升级。失败 = 顾客不满意；成功 = 从小店发展成最终形态。`,
    elements: [
      { category: "经营对象", rows: [{ type: "餐饮类", variants: "餐厅, 咖啡馆, 甜品店" }, { type: "服务类", variants: "美容院, 宠物店, 医院" }] },
      { category: "场景递进", rows: [{ type: "规模线", variants: "小摊→小店→大店→连锁→帝国" }] },
    ],
    examples: [
      { name: "美味餐厅", protagonist: "餐厅老板", motivation: "成为米其林星级", target: "各种食客", challenge: "烹饪美食服务顾客", ending: "成为米其林星级餐厅" },
    ],
  },
  {
    id: "card",
    name: "棋牌品类预设",
    comboLogic: `[主角] 进入棋牌世界想要 [目的]。运用智慧策略与 [对手] 对决。失败 = 输掉比赛；成功 = 一路过关斩将成为最高称号。`,
    elements: [
      { category: "游戏类型", rows: [{ type: "纸牌类", variants: "扑克, 斗地主, 21点, 接龙" }, { type: "棋类", variants: "象棋, 围棋, 五子棋" }] },
      { category: "场景递进", rows: [{ type: "竞技线", variants: "新手桌→普通桌→高手桌→大师桌→传说桌" }] },
    ],
    examples: [
      { name: "麻将江湖", protagonist: "麻将世家传人", motivation: "找回失传秘籍", target: "麻将宗师", challenge: "麻将对决", ending: "成为新一代麻将之王" },
    ],
  },
  {
    id: "word",
    name: "猜词/文字品类预设",
    comboLogic: `[神秘词语] 隐藏在谜题中等待被发现。通过猜测，反馈机制告诉你离答案有多近。失败 = 机会用尽；成功 = 解开谜题。`,
    elements: [
      { category: "游戏类型", rows: [{ type: "猜词类", variants: "Wordle, 猜单词, 成语接龙" }, { type: "成语类", variants: "成语填空, 看图猜成语" }] },
      { category: "反馈机制", rows: [{ type: "颜色提示", variants: "绿=正确, 黄=有但位置错, 灰=没有" }] },
    ],
    examples: [
      { name: "每日一词", protagonist: "词汇爱好者", motivation: "每天猜出神秘单词", target: "神秘单词", challenge: "颜色提示逐步接近", ending: "成为猜词大师" },
    ],
  },
  {
    id: "tower",
    name: "塔防品类预设",
    comboLogic: `[入侵者] 要破坏 [守护对象]。[主角] 用防御手段在路线上阻止。失败 = 守护对象被破坏；成功 = 击退所有入侵者。`,
    elements: [
      { category: "入侵者", rows: [{ type: "怪物", variants: "史莱姆→哥布林→巨魔→魔王" }, { type: "僵尸", variants: "普通→铁桶→巨人→僵尸博士" }] },
      { category: "防御手段", rows: [{ type: "炮塔类", variants: "箭塔→火炮→激光→终极炮" }, { type: "植物类", variants: "豌豆→向日葵→坚果→加农炮" }] },
    ],
    examples: [
      { name: "保卫萝卜", protagonist: "萝卜守护者", motivation: "保护魔法萝卜", target: "怪物军团", challenge: "各种炮塔击退怪物", ending: "森林→沙漠→雪地→火山→魔王城堡" },
    ],
  },
  {
    id: "shooter",
    name: "射击品类预设",
    comboLogic: `[入侵者] 大举进攻 [守护对象]。[主角] 驾驶 [载具] 迎击消灭敌人。失败 = 被击落/守护对象被摧毁；成功 = 击败Boss守护成功。`,
    elements: [
      { category: "主角类型", rows: [{ type: "战机", variants: "战斗机, 宇宙飞船, 直升机" }, { type: "生物", variants: "喷火龙, 战斗蜜蜂" }] },
      { category: "入侵者", rows: [{ type: "外星人", variants: "侦察机→战斗机→母舰→外星领主" }] },
    ],
    examples: [
      { name: "雷电战机", protagonist: "联盟战斗机", motivation: "保卫地球", target: "外星机械军团", challenge: "激光炮导弹护盾", ending: "击败外星领主" },
    ],
  },
  {
    id: "connect",
    name: "连连看品类预设",
    comboLogic: `[配对对象] 散落各处想要 [配对目的]。找到两个相同的用线连起来团聚/消失。失败 = 时间耗尽/无法连接；成功 = 所有配对完成。`,
    elements: [
      { category: "配对对象", rows: [{ type: "动物", variants: "小猫, 小狗, 小鸟, 小鱼" }, { type: "水果", variants: "苹果, 橙子, 草莓, 葡萄" }] },
      { category: "连接规则", rows: [{ type: "直线/折线", variants: "通道只能转弯有限次（0-2次）" }] },
    ],
    examples: [
      { name: "小动物找伙伴", protagonist: "小动物们", motivation: "走散的伙伴要团聚", target: "各种小动物图案", challenge: "画出路径让它们相遇", ending: "所有动物找到了伙伴" },
    ],
  },
  {
    id: "tetris",
    name: "俄罗斯方块品类预设",
    comboLogic: `[下落物] 不断从天而降填满 [空间]。排列整齐填满一行就消除腾出空间。失败 = 堆到顶部溢出；成功 = 坚持足够久/达成目标。`,
    elements: [
      { category: "下落物", rows: [{ type: "建筑材料", variants: "砖块, 积木, 石块" }, { type: "食物", variants: "蛋糕块, 巧克力块" }] },
      { category: "消除机制", rows: [{ type: "完工运走", variants: "一层建好就被验收运走" }, { type: "魔法消失", variants: "排列整齐触发魔法消失" }] },
    ],
    examples: [
      { name: "建筑大师", protagonist: "建筑工人", motivation: "成为建筑大师", target: "尽可能高的建筑", challenge: "积木下落一层建好就验收运走", ending: "成为传说建筑大师" },
    ],
  },
  {
    id: "bubble",
    name: "泡泡龙品类预设",
    comboLogic: `[被困者] 被泡泡/宝石困在上方。发射泡泡，三个同色连在一起就消除。失败 = 泡泡堆太低/步数用尽；成功 = 消除所有泡泡，被困者获救。`,
    elements: [
      { category: "主角", rows: [{ type: "可爱生物", variants: "小恐龙, 小龙, 青蛙" }] },
      { category: "泡泡类型", rows: [{ type: "彩色泡泡", variants: "红/蓝/绿/黄/紫" }, { type: "宝石球", variants: "红宝石, 蓝宝石, 绿宝石" }] },
    ],
    examples: [
      { name: "泡泡龙救小恐龙", protagonist: "小恐龙泡泡龙", motivation: "救出所有小恐龙伙伴", target: "被泡泡困住的伙伴", challenge: "三个同色泡泡连接释放被困者", ending: "救出所有伙伴" },
    ],
  },
  {
    id: "timing",
    name: "时机类品类预设",
    comboLogic: `[主角] 想要 [到达目标/收集东西/躲避危险]。在正确时机跳跃/接住/躲开。失败 = 掉落/接漏/碰到危险；成功 = 到达目的地/收集足够/存活到最后。`,
    elements: [
      { category: "玩法子类", rows: [{ type: "跳跃类", variants: "跳一跳, Doodle Jump" }, { type: "接东西", variants: "接金币, 接水果" }, { type: "躲避类", variants: "别踩白块, 躲避球" }] },
      { category: "场景递进", rows: [{ type: "高度线", variants: "草地→树梢→云端→星空→月球" }] },
    ],
    examples: [
      { name: "跳一跳小青蛙", protagonist: "小青蛙", motivation: "跳到月亮上找妈妈", target: "荷叶→石头→云朵→月亮", challenge: "按压蓄力松开跳跃", ending: "在月亮上和妈妈团聚" },
    ],
  },
  {
    id: "spot",
    name: "找茬/找不同品类预设",
    comboLogic: `[场景] 中藏着 [隐藏目标/不同之处]。仔细观察找出所有目标。失败 = 时间耗尽/点错太多；成功 = 全部找到。`,
    elements: [
      { category: "玩法子类", rows: [{ type: "找不同", variants: "对比两张图找出不同" }, { type: "找隐藏", variants: "在场景中找隐藏物品" }] },
      { category: "动机类型", rows: [{ type: "侦探破案", variants: "找出线索解开谜团" }, { type: "寻宝探险", variants: "找到隐藏的宝藏" }] },
    ],
    examples: [
      { name: "小侦探找线索", protagonist: "小侦探", motivation: "收集线索破案", target: "隐藏线索物品", challenge: "在案发现场找隐藏物", ending: "找齐线索真相大白" },
    ],
  },
  {
    id: "sling",
    name: "弹弓/投掷品类预设",
    comboLogic: `[目标/敌人] 在远处需要被击中/击倒/投进。拉动瞄准调整角度力度发射 [弹射物]。失败 = 弹药用尽；成功 = 击倒所有目标。`,
    elements: [
      { category: "玩法子类", rows: [{ type: "弹弓类", variants: "拉弹弓发射击倒建筑/敌人" }, { type: "投篮类", variants: "调整角度力度投进目标" }, { type: "高尔夫类", variants: "瞄准击球进洞" }] },
      { category: "物理机制", rows: [{ type: "抛物线", variants: "重力影响形成弧线轨迹" }, { type: "连锁", variants: "击中一个引发连锁反应" }] },
    ],
    examples: [
      { name: "愤怒的小鸟", protagonist: "各种能力的小鸟", motivation: "绿猪偷了鸟蛋", target: "绿猪和建筑", challenge: "弹弓发射抛物线+建筑倒塌", ending: "打败绿猪夺回鸟蛋" },
    ],
  },
  {
    id: "fishing",
    name: "钓鱼品类预设",
    comboLogic: `[水域] 里藏着各种 [鱼类/宝物]。抛竿等待，在正确时机收杆。失败 = 鱼跑了/线断了；成功 = 钓到目标鱼/收集齐图鉴。`,
    elements: [
      { category: "玩法子类", rows: [{ type: "时机钓鱼", variants: "等待咬钩时机点击收杆" }, { type: "拉扯钓鱼", variants: "鱼咬钩后拉扯对抗控制张力" }] },
      { category: "猎物类型", rows: [{ type: "普通鱼", variants: "小鱼→中鱼→大鱼" }, { type: "稀有鱼", variants: "金鱼→彩虹鱼→传说之鱼" }] },
    ],
    examples: [
      { name: "小猫钓鱼记", protagonist: "爱吃鱼的小猫", motivation: "钓鱼给猫妈妈做生日大餐", target: "小鱼→鲤鱼→金鱼→传说锦鲤", challenge: "时机点击收杆", ending: "钓到最大的鱼，妈妈过了最棒生日" },
    ],
  },
  {
    id: "generic",
    name: "通用休闲游戏叙事框架",
    comboLogic: `[主角] 想要 [完成目标]。通过 [核心操作] 一步步接近目标。失败 = [失败条件] 触发；成功 = 目标达成，愿望实现。故事必须解释：为什么要做这个操作？成功后能得到什么？`,
    elements: [
      { category: "主角类型", rows: [{ type: "可爱动物", variants: "小猫, 小狗, 小鸟, 小兔, 小熊" }, { type: "小人物", variants: "小骑士, 小精灵, 小忍者, 小厨师" }, { type: "拟人物品", variants: "小方块, 小星星, 小糖果, 小机器人" }] },
      { category: "目标类型", rows: [{ type: "收集类", variants: "收集足够的XX, 集齐所有XX" }, { type: "到达类", variants: "到达终点, 到达最高处" }, { type: "解救类", variants: "救出伙伴, 解除封印" }, { type: "建造类", variants: "建成XX, 完成XX" }] },
      { category: "动机类型", rows: [{ type: "救援", variants: "救伙伴, 救家人, 救世界" }, { type: "回家", variants: "找妈妈, 回到家" }, { type: "梦想", variants: "实现梦想, 成为最强" }] },
      { category: "场景递进", rows: [{ type: "自然线", variants: "草地→森林→山地→云端" }, { type: "难度线", variants: "简单→普通→困难→极限" }] },
    ],
    examples: [
      { name: "未知玩法A（点击收集类）", protagonist: "小松鼠", motivation: "收集足够松果过冬", target: "松果", challenge: "点击收集；时间耗尽/被老鹰抓走", ending: "松果满仓温暖过冬" },
      { name: "未知玩法B（躲避生存类）", protagonist: "小萤火虫", motivation: "在黑夜中存活到天亮", target: "天亮", challenge: "控制方向躲避蝙蝠", ending: "迎来黎明找到伙伴" },
    ],
  },
];
