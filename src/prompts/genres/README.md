# prompts/genres/ — 品类专属提示词覆盖（落地目录）

本目录用于按品类（genre_code）放置**专属提示词覆盖**，命名约定：

```
prompts/genres/<genre_code>/<step>.md      # 覆盖该品类该 step 的基模板
```

## 当前状态与消费方

- 当前为**空目录**（landing），供后续按需放入品类专属 prompt。
- 唯一会读取品类专属 .md 的是实验引擎 `pipeline/blueprint/prompt-resolver.ts`
  （`useNewRunner` 路径，生产默认不启用，详见该文件头注释）。
- **生产提示词引擎是 `pipeline/prompt-composer.ts` 的 `composeSystemPrompt`**：
  品类差异通过 `knowledge/game-narrative` 的 skill slots（`{{SKILL.*}}`）+ specialist 反向索引注入，
  不依赖本目录。新增/修改生产提示词请改 PromptComposer.blocks，勿在此放生产依赖。
