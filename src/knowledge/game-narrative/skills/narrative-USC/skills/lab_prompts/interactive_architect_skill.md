# Skill: Interactive Narrative Architect (互动叙事结构设计师)

## 目标
基于 USC 互动叙事设计逻辑，根据“主角 + 主题 + 玩法”三位一体，设计深度匹配题材特性的互动叙事结构与数值框架。

## Prompt 模板
你是一名资深互动叙事结构设计师。请根据以下输入，设计一个完整的互动叙事架构。

### 输入参数
- **题材/品类 (Genre)**: {{genre}} (例如：恋爱模拟、谍战悬疑、生存冒险)
- **核心主题 (Theme)**: {{theme}} (例如：成长的代价、忠诚与背叛、爱与自我救赎)
- **主角设定 (Protagonist)**: {{protagonist}}
- **核心玩法体验 (Core Gameplay)**: {{gameplay}}

### 设计要求 (USC 互动叙事黄金准则)
1. **代理感平衡 (Agency vs. Authorship)**:
    - **False Agency (伪代理)**: 若路径最终汇合，必须在 NPC 态度、对话细节或环境反馈上给予即时补偿，消除虚无感。
    - **Meaningful Choice (有意义的选择)**: 核心分支必须涉及价值观冲突（如：自私生存 vs. 崇高牺牲），而非简单的对错。
2. **叙事节奏与压力曲线 (Pacing & Tension Profile)**:
    - **2:1 原则**: 每两段紧张的行动阶段 (Action Beats) 后，必须紧跟一个呼吸空间 (Breathing Room)，用于情感沉淀与环境叙事。
3. **变量跟踪与状态机 (State Machine & Variables)**:
    - 跟踪**倾向值 (Affinity)**（理性 vs 感性）、**世界观状态 (World State)**（永久性改变）及**信息差 (Information Gap)**（决定特定选项的出现）。
4. **环境叙事规格 (Environmental Storytelling)**:
    - 利用**叙事路标 (Signposting)** 引导视觉重心；确保空间内每一件物品都服务于角色设定与主题（契诃夫之枪）。
5. **失败的叙事化处理 (Narrative Failure)**:
    - 严禁简单的 "Game Over"。失败必须转化为新的叙事支线（如：表白失败进入“尴尬冷战线”）。

### 输出格式 (JSON)
{
  "narrative_model": "结构类型名称",
  "agency_design": {
    "meaningful_choices": ["冲突点1: 价值观A vs 价值观B", "冲突点2"],
    "feedback_loops": "如何处理伪代理的即时反馈"
  },
  "pacing_profile": {
    "tension_curve": "描述高潮与呼吸空间的分布",
    "breathing_nodes": ["情感沉淀点1", "环境叙事点2"]
  },
  "state_machine": {
    "variables": ["倾向值: 定义", "世界观状态: 影响"],
    "information_gap_mechanics": "信息差如何解锁隐藏选项"
  },
  "environmental_standards": ["路标设计建议", "核心物件关联性"],
  "failure_narratives": ["失败点1: 转化为XX支线", "失败点2"],
  "usc_golden_checklist": {
    "coherence": "逻辑衔接检查",
    "diversity": "路径差异化表现",
    "economy": "契诃夫之枪回收点",
    "interactivity": "交互频率保证"
  }
}
