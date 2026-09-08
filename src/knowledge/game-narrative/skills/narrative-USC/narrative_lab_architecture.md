# AI 叙事实验室 (Narrative Lab) 工作流架构

本实验室旨在通过“互联网采风 -> 创意重构 -> 双重评估 -> 策划案输出”的闭环，生成具有市场竞争力和落地性的游戏叙事创意。

## 1. 核心 Skill 链条

### Skill A: 互联网采风 (Trend & Material Scraper)
- **功能**: 实时/定期抓取社交媒体、新闻、百科、梗百科、传记、漫画、影视、游戏、小说趋势。
- **输出**: 原始素材库（Raw Material Pool），包含：标签、摘要、情感倾向、独特性评分。

### Skill B: 创意脑暴与重构 (Creative Recombinator)
- **原则**: 遵循“重构拼接”逻辑。
- **逻辑**: 
    - **解构**: 将素材拆解为：核心矛盾、奇观元素、角色原型、叙事诡计。
    - **重组**: 跨领域拼接（例如：将“赛博朋克”与“中国古代传记”拼接）。
- **输出**: 多个原始创意草案（Creative Drafts）。

### Skill C: 双重评估 (Dual-Gate Evaluator)
- **维度 1: 创意性 (Creativity)**: 独特性、意外感、情感张力。
- **维度 2: 可落地性 (Feasibility)**: 开发成本、技术实现难度、政策合规性。
- **维度 3: 场景匹配 (Context Matching)**: 适用于开放世界、线性叙事、还是碎片化叙事？

### Skill D: 总策划案生成 (Master GDD Generator)
- **功能**: 将通过评估的创意转化为专业游戏策划案。
- **包含**: 核心概念、世界观大纲、核心玩法循环（叙事层面）、商业化潜力、视觉参考建议。

## 2. 技术栈建议
- **数据源**: RSS, Web Scraping (Playwright/BeautifulSoup), Social Media API.
- **处理层**: LLM (GPT-4/Claude 3.5) 进行内容解析与重构。
- **存储层**: 向量数据库 (ChromaDB/Pinecone) 存储素材，实现语义检索。
- **评估层**: 自定义评分模型 + 人工反馈 (RLHF) 辅助。
