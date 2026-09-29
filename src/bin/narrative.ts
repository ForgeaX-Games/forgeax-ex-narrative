#!/usr/bin/env node
/**
 * Published entry point for the workshop as a standalone service.
 *
 * Hosts that embed the plugin (Studio) import the server module directly and
 * never come through here. Hosts that only have a shell — Codex being the one
 * that matters — reach the same server through `npx`, which needs a real bin.
 */
import { packageVersion } from "../utils/package-version.js";

const [verb] = process.argv.slice(2);

const usage = `forgeax-narrative <command>

  serve     Run the narrative workshop HTTP service (port from NARRATIVE_PORT, default 8900).
  version   Print the package version.
`;

switch (verb) {
  case "serve":
  case undefined:
    // Side-effecting import: the module starts listening on load.
    await import("../api/server.js");
    break;
  case "version":
    console.log(packageVersion());
    break;
  case "--help":
  case "-h":
  case "help":
    console.log(usage);
    break;
  default:
    console.error(`unknown command: ${verb}\n\n${usage}`);
    process.exit(2);
}
