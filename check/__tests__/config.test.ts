import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";

const fixtures = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

describe("loadConfig", () => {
  it("reads disabledRules from .factory-check.json", async () => {
    const cfg = await loadConfig(fixtures("configured"));
    expect(cfg.disabledRules.has("update-delete-no-where")).toBe(true);
  });

  it("defaults to an empty set when no config file exists", async () => {
    const cfg = await loadConfig(fixtures("clean"));
    expect(cfg.disabledRules.size).toBe(0);
    expect(cfg.gateOnHigh).toBe(false);
    expect(cfg.ignorePaths).toEqual([]);
  });

  it("reads the kit's own ignorePaths (fixtures excluded)", async () => {
    const kitRoot = fileURLToPath(new URL("../..", import.meta.url));
    const cfg = await loadConfig(kitRoot);
    expect(cfg.ignorePaths).toContain("**/__tests__/**");
  });
});
