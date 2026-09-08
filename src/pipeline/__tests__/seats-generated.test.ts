import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderSeatsModule } from "../routing/seats-projection.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const generated = path.join(root, "viz/src/composer/seats.generated.ts");

describe("前端席位投影", () => {
  it("与后端注册表同步（不同步就跑 npx tsx scripts/gen-seats.ts）", () => {
    const onDisk = fs.readFileSync(generated, "utf8");
    expect(onDisk).toBe(renderSeatsModule());
  });
});
