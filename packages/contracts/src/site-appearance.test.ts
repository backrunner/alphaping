import { describe, expect, it } from "vitest";
import {
  defaultSiteAppearance,
  normalizeSiteAppearance,
  parseSiteAppearance,
  validateSiteAppearance,
  validateSiteLogoUrl,
} from "./site-appearance.js";

describe("site appearance boundary", () => {
  it("accepts old empty settings and drops unknown public fields", () => {
    expect(parseSiteAppearance("{}")).toEqual(defaultSiteAppearance);
    expect(parseSiteAppearance("broken")).toEqual(defaultSiteAppearance);
    expect(
      normalizeSiteAppearance({
        palette: "mint",
        css: "url(https://tracker.test)",
        secret: "private",
      }),
    ).toEqual({ ...defaultSiteAppearance, palette: "mint" });
  });
  it("rejects CSS injection, unsupported options and unbounded text", () => {
    expect(() =>
      validateSiteAppearance({
        ...defaultSiteAppearance,
        palette: "iris; background: url(https://tracker.test)",
      }),
    ).toThrow();
    expect(() => validateSiteAppearance({ ...defaultSiteAppearance, mode: "anything" })).toThrow();
    expect(() => validateSiteAppearance({ ...defaultSiteAppearance, density: "huge" })).toThrow();
    expect(() =>
      validateSiteAppearance({ ...defaultSiteAppearance, title: "a".repeat(81) }),
    ).toThrow();
    expect(() =>
      validateSiteAppearance({ ...defaultSiteAppearance, description: "x".repeat(241) }),
    ).toThrow();
  });

  it("accepts public HTTPS logos and same-site paths, including legacy settings", () => {
    for (const logoUrl of [
      "https://cdn.example.com/brand.svg",
      "/brand/logo.png",
      "HTTPS://example.com/logo.webp",
    ]) {
      expect(validateSiteLogoUrl(` ${logoUrl} `)).toBe(logoUrl);
      expect(
        parseSiteAppearance(JSON.stringify({ ...defaultSiteAppearance, logoUrl })).logoUrl,
      ).toBe(logoUrl);
    }
    expect(validateSiteLogoUrl(undefined)).toBe("");
    expect(parseSiteAppearance('{"title":"Legacy","palette":"mint"}')).toEqual({
      ...defaultSiteAppearance,
      title: "Legacy",
      palette: "mint",
    });
  });

  it("rejects executable, ambiguous, credential-bearing and oversized logo addresses", () => {
    for (const logoUrl of [
      "javascript:alert(1)",
      "data:image/svg+xml,<svg onload='alert(1)'/>",
      "http://example.com/logo.png",
      "//example.com/logo.svg",
      "https:example.com/logo.svg",
      "https://user:password@example.com/logo.svg",
      "https://user@example.com/logo.svg",
      "/\\example.com/logo.svg",
      "https://example.com/lo\ngo.svg",
      "https://example.com/lo\u0000go.svg",
      "/" + "a".repeat(512),
      42,
    ]) {
      expect(() => validateSiteAppearance({ ...defaultSiteAppearance, logoUrl })).toThrow();
    }
    expect(
      normalizeSiteAppearance({ ...defaultSiteAppearance, logoUrl: "javascript:alert(1)" }).logoUrl,
    ).toBe("");
  });

  it("keeps multilingual branding and a logo within the existing D1 byte budget", () => {
    const appearance = validateSiteAppearance({
      ...defaultSiteAppearance,
      title: "探".repeat(80),
      description: "针".repeat(240),
      logoUrl: "/" + "a".repeat(511),
    });
    expect(new TextEncoder().encode(JSON.stringify(appearance)).byteLength).toBeLessThanOrEqual(
      2048,
    );
  });
});
