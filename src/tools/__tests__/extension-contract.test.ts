import { describe, expect, it } from "vitest";
import tools from "../handlers.js";
import { BY_NAME, CATALOG } from "../../../extension/src/catalog.generated.js";
import { LIFECYCLE } from "../../../extension/src/verbs.js";

/**
 * The Codex extension reaches the same handler table Studio uses. These checks
 * fail if the generated catalog drifts from the handlers, or if a new lifecycle
 * verb shadows a tool name and silently makes that tool unreachable.
 */
describe("extension tool surface", () => {
  it("every catalog entry has a handler", () => {
    for (const entry of CATALOG) {
      expect(Object.keys(tools), `handler missing for ${entry.id}`).toContain(entry.id);
    }
  });

  it("every AI-exposed handler is in the catalog", () => {
    for (const id of Object.keys(tools)) {
      expect(BY_NAME.has(id.replace(/^narrative:/u, "")), `catalog missing ${id}`).toBe(true);
    }
  });

  it("lifecycle verbs never shadow a tool name", () => {
    for (const verb of LIFECYCLE) {
      expect(BY_NAME.has(verb), `lifecycle verb ${verb} shadows a tool`).toBe(false);
    }
  });
});
