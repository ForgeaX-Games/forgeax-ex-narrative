import * as fs from "node:fs";
import { describe, it, expect } from "vitest";
import {
  createHttpQueryEmbedder,
  createOnnxQueryEmbedder,
  createLocalE5Embedder,
  resolveQueryEmbedder,
} from "../embedder.js";
import { loadRetrievalConfig } from "../phase3-vector.js";

describe("local query embedder (D-B)", () => {
  it("HTTP embedder posts queries and parses {embeddings: number[][]}", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const embed = createHttpQueryEmbedder({
      url: "http://127.0.0.1:8080/embed",
      model: "e5-small",
      fetchImpl: async (url, init) => {
        calls.push({ url, body: init.body });
        return { ok: true, status: 200, json: async () => ({ embeddings: [[1, 0, 0], [0, 1, 0]] }) };
      },
    });
    const out = await embed(["query: a", "query: b"]);
    expect(out.length).toBe(2);
    expect(Array.from(out[0])).toEqual([1, 0, 0]);
    expect(calls[0].url).toBe("http://127.0.0.1:8080/embed");
    expect(JSON.parse(calls[0].body)).toMatchObject({ input: ["query: a", "query: b"], model: "e5-small" });
  });

  it("HTTP embedder parses OpenAI-style {data:[{embedding}]} and filters by dim", async () => {
    const embed = createHttpQueryEmbedder({
      url: "http://x/embed",
      dim: 3,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: [1, 2, 3] }, { embedding: [9, 9] }] }),
      }),
    });
    const out = await embed(["q"]);
    // 第二条维度不符被过滤。
    expect(out.length).toBe(1);
    expect(Array.from(out[0])).toEqual([1, 2, 3]);
  });

  it("HTTP embedder throws on non-ok response", async () => {
    const embed = createHttpQueryEmbedder({
      url: "http://x/embed",
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    });
    await expect(embed(["q"])).rejects.toThrow(/503/);
  });

  it("ONNX embedder returns null without a tokenizer seam", async () => {
    const e = await createOnnxQueryEmbedder({ modelPath: "/nonexistent/e5.onnx" });
    expect(e).toBeNull();
  });

  it("ONNX embedder returns null when onnxruntime-node is unavailable", async () => {
    const e = await createOnnxQueryEmbedder({
      modelPath: "/nonexistent/e5.onnx",
      tokenize: () => ({ inputIds: [1, 2], attentionMask: [1, 1] }),
    });
    expect(e).toBeNull();
  });

  it("resolveQueryEmbedder prefers HTTP url, else undefined", async () => {
    const e1 = await resolveQueryEmbedder({ NARRATIVE_EMBED_URL: "http://x/embed" });
    expect(typeof e1).toBe("function");
    const e2 = await resolveQueryEmbedder({});
    expect(e2).toBeUndefined();
  });

  it("local e5 embedder returns null when model dir is absent", async () => {
    const e = await createLocalE5Embedder({ modelDir: "/nonexistent/e5-small" });
    expect(e).toBeNull();
  });

  it("resolveQueryEmbedder falls back to local e5 dir, degrades when absent", async () => {
    const e = await resolveQueryEmbedder({}, { localModelDir: "/nonexistent/e5-small" });
    expect(e).toBeUndefined();
  });
});

// 真实本地模型存在时才跑（CI/无模型环境自动跳过）：验证查询侧向量维度与语义可分。
const MODEL_DIR = loadRetrievalConfig().model_path_local;
const HAS_LOCAL_MODEL = !!MODEL_DIR && fs.existsSync(MODEL_DIR);

describe.skipIf(!HAS_LOCAL_MODEL)("local e5 process-in embedding (real model)", () => {
  it("vectorizes to 384-dim and separates semantics by cosine", async () => {
    const embed = await createLocalE5Embedder({ modelDir: MODEL_DIR as string, dim: 384 });
    expect(embed).not.toBeNull();
    const [tragic, healing, tragicEcho] = await embed!([
      "query: 救赎与代价的悲剧主题",
      "query: 轻松治愈的日常喜剧",
      "query: 牺牲自我换取救赎的沉重结局",
    ]);
    expect(tragic.length).toBe(384);
    const cos = (a: Float32Array, b: Float32Array) => {
      let dot = 0;
      for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
      return dot; // 已 L2 归一化
    };
    // 同为悲剧/救赎语义应比与治愈喜剧更相近。
    expect(cos(tragic, tragicEcho)).toBeGreaterThan(cos(tragic, healing));
  }, 60000);
});
