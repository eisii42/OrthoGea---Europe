import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/core",
  "packages/harvester",
  "packages/client",
  "packages/catalog"
]);
