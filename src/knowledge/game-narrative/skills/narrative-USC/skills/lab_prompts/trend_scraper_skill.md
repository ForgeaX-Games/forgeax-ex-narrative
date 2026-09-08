# Skill: Trend Scraper & Material Parser (采风与解析)

## 目标
从互联网杂乱的信息中提取具有“叙事潜力”的素材。

## Prompt 模板
你是一名资深叙事采风员。请分析以下互联网内容（文本、新闻、梗、传记片段等），提取其核心叙事价值。

### 输入内容
{{raw_content}}

### 评估要求 (Gameplay-Narrative Synergy)
1. **核心梗概**: 提取内容的最简短描述。
2. **叙事张力点**: 哪里最吸引人？（如：身份反转、道德困境、奇观设定）。
3. **玩法体验组合猜想 (Gameplay Synergy)**: 
    - 思考该素材如何转化为**玩法机制**？（例如：一个“遗忘”的梗，是否可以转化为“UI 逐渐消失”的玩法？）。
    - 提供 2-3 个“叙事+玩法”的组合猜想。
4. **罕见程度评估 (Uniqueness & Market Gap)**:
    - **叙事罕见度**: 该题材在文学/影视中是否常见？
    - **玩法罕见度**: 该题材与特定玩法的结合是否从未见过？
    - **综合罕见度评分 (1-10)**: 结合两者给出最终评分。

### 输出格式 (JSON)
{
  "summary": "...",
  "tension_points": ["...", "..."],
  "gameplay_synergy_guesses": [
    {
      "mechanic": "核心玩法机制描述",
      "narrative_reason": "为什么这个机制能体现素材的叙事内核？"
    }
  ],
  "uniqueness_analysis": {
    "narrative_rarity": "高/中/低",
    "gameplay_rarity": "高/中/低",
    "market_gap_description": "市场空白点分析"
  },
  "total_uniqueness_score": 8
}
