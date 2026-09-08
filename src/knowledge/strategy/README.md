# 叙事策略库

四轴策略卡的存放地。**把 md 放进对应目录、文件名取词表 code，即刻生效，不需要改任何代码。**

```
strategy/
  genre/<genreCode>.md          游戏品类叙事策略    code 来自 knowledge/genre-taxonomy.ts
  type/<storyTypeCode>.md       叙事类型策略        code 来自 narrative-axes/story-types.ts
  theme/<storyThemeCode>.md     叙事题材策略        code 来自 narrative-axes/story-themes.ts
  structure/<structureCode>.md  叙事结构策略        code 来自 narrative-axes/story-structures.ts
```

## 文件格式

frontmatter 全部可选，正文即策略卡内容：

```markdown
---
name: JRPG
stages: [demand, design, outline, structure]
---

## 叙事重心
...
```

| 字段 | 缺省 | 说明 |
| --- | --- | --- |
| `name` | 文件名 | 展示名，会写进提示词的子槽标题 |
| `stages` | 四个环节全生效 | 限定这张卡在哪些环节装配 |

`stages` 的四个取值对应四个装配环节，也是全流程里仅有的四个吃策略卡的环节：

| stage | 环节 | 该环节要策略卡回答什么 |
| --- | --- | --- |
| `demand` | 需求清单 | 这个方向适不适合本轴，先做适配性预判 |
| `design` | 策划文档 | 确立基调与策略，把结论落盘 |
| `outline` | 故事大纲 | 宏观走向怎么按本轴组织 |
| `structure` | 故事结构 | 剧情树怎么分叉、怎么收束 |

## 约定与校验

- 文件名必须精确等于词表 code；对不上的文件会被 `npm run lint:strategy` 报出来。
- 下划线开头的文件（如 `_draft.md`）会被跳过，可用来放草稿。
- 正文为空的文件视为未提供，不会注入空段落。
- 缺卡是合法状态：该轴的子槽留空，其余三轴照常装配。

## 覆盖进度

四轴各自独立推进，不要求同步齐全。当前只放了四份样例卡用于打通链路：
`genre/rpg-jrpg.md`、`type/drama.md`、`theme/workplace.md`、`structure/linear.md`。

叙事类型与叙事题材两轴的结构倾向（`structureHints`）在词表里仍是空的，
等这两轴的策略定稿后填进 `narrative-axes/story-types.ts` 与 `story-themes.ts`，
结构综合器无需改动即可把它们纳入投票。
