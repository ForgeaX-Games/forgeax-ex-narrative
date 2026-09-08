# 归档：agents-promptresolver

这 15 份 md 曾被当作"提示词库"，实际只有实验引擎 `blueprint/prompt-resolver.ts`
（`useNewRunner` 分支）会读，生产从不执行。它们与生产内联块**长期互不同步**，
到归档时内容已明显落后——例如 `worldview.md` 描述的输出 schema 是
`geography / factions / history`，而生产版早已是十二槽位的
`基础架构层 / 交互叙事层`，两者对不上。

四期把其中唯一还有价值的部分——「机制与流程（CoT）」段——按各 step 的**实际数据模型**
改写后，吸收进了生产 `PromptComposer` 的 `cot` 槽（骨架第 ⑥ 段）。其余部分
（身份、约束、输出模板）生产版本更新更全，无可吸收。

## 从此以后

改提示词只有一个地方：对应 step 文件里的 `PromptComposer.blocks`。
本目录只为保留吸收前的原貌以便复核，**不要再改这里的文件**，改了也不会生效。

如果哪天 `prompt-resolver.ts` 这条实验路线被正式弃用，本目录可以一并删除。
