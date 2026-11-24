import { defineConfig } from "tsup";

// Builds the factory-kit-check engine (check/ → dist/index.js) and autopilot
// (autopilot/ → dist/autopilot.js). The bin shims import from dist/.
export default defineConfig({
  entry: { index: "check/index.ts", autopilot: "autopilot/index.ts" },
  format: ["esm"],
  outDir: "dist",
  target: "node18",
  clean: true,
  splitting: false,
  sourcemap: false,
  dts: false,
});
