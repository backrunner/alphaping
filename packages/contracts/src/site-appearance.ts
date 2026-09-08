export const appearancePalettes = ["iris", "ocean", "mint", "sunset", "rose"] as const;
export const appearanceModes = ["system", "light", "dark"] as const;
export const appearanceDensities = ["comfortable", "compact"] as const;

export interface SiteAppearance {
  title: string;
  description: string;
  logoUrl: string;
  palette: (typeof appearancePalettes)[number];
  mode: (typeof appearanceModes)[number];
  density: (typeof appearanceDensities)[number];
}

export const defaultSiteAppearance: Readonly<SiteAppearance> = {
  title: "",
  description: "",
  logoUrl: "",
  palette: "iris",
  mode: "system",
  density: "comfortable",
};

export function validateSiteLogoUrl(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new Error("Enter a public logo image address");
  const url = value.trim();
  if (!url) return "";
  if (
    url.length > 512 ||
    /[\s\\]/u.test(url) ||
    [...url].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  ) {
    throw new Error("Use a logo address of up to 512 characters without spaces or backslashes");
  }
  const local = url.startsWith("/") && !url.startsWith("//");
  let parsed: URL;
  try {
    parsed = new URL(url, local ? "https://alphaping.invalid" : undefined);
  } catch {
    throw new Error("Use an HTTPS logo address or a path beginning with /");
  }
  if (
    parsed.protocol !== "https:" ||
    (!local && !/^https:\/\//iu.test(url)) ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("Use an HTTPS logo address without credentials, or a path beginning with /");
  }
  return url;
}

export function validateSiteAppearance(value: unknown): SiteAppearance {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Appearance settings are invalid");
  }
  const input = value as Record<string, unknown>;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (title.length > 80 || description.length > 240) {
    throw new Error("Use up to 80 characters for the title and 240 for the introduction");
  }
  if (!appearancePalettes.includes(input.palette as SiteAppearance["palette"])) {
    throw new Error("Choose a supported color palette");
  }
  if (!appearanceModes.includes(input.mode as SiteAppearance["mode"])) {
    throw new Error("Choose a supported color mode");
  }
  if (!appearanceDensities.includes(input.density as SiteAppearance["density"])) {
    throw new Error("Choose a supported layout density");
  }
  const appearance: SiteAppearance = {
    title,
    description,
    logoUrl: validateSiteLogoUrl(input.logoUrl),
    palette: input.palette as SiteAppearance["palette"],
    mode: input.mode as SiteAppearance["mode"],
    density: input.density as SiteAppearance["density"],
  };
  if (new TextEncoder().encode(JSON.stringify(appearance)).byteLength > 2_048) {
    throw new Error("Appearance settings are too large");
  }
  return appearance;
}

// Tolerate old cached projections and pre-customization dashboards. Unknown
// properties never reach the public projection or a style attribute.
export function normalizeSiteAppearance(value: unknown): SiteAppearance {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return { ...defaultSiteAppearance };
    return validateSiteAppearance({ ...defaultSiteAppearance, ...value });
  } catch {
    return { ...defaultSiteAppearance };
  }
}

export function parseSiteAppearance(value: string | null | undefined): SiteAppearance {
  if (!value || value.length > 2_048) return { ...defaultSiteAppearance };
  try {
    return normalizeSiteAppearance(JSON.parse(value));
  } catch {
    return { ...defaultSiteAppearance };
  }
}
