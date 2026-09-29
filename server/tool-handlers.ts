/**
 * Studio loads this path (forgeax-extension.json `entry.backend`). The handlers
 * themselves live under src/ so that `tsc` emits them into dist/, which is what
 * lets the standalone service dispatch tools over HTTP for non-Studio hosts.
 */
export * from '../src/tools/handlers.js';
export { default } from '../src/tools/handlers.js';
