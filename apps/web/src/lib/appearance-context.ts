import { getContext, setContext } from "svelte";
import type { SiteAppearance } from "@alphaping/contracts";

export interface AppearanceContext {
  readonly defaults: SiteAppearance;
  readonly palette: SiteAppearance["palette"] | "site";
  readonly mode: SiteAppearance["mode"] | "site";
  readonly density: SiteAppearance["density"] | "site";
  set: (key: "palette" | "mode" | "density", value: string) => void;
  reset: () => void;
}
const key = Symbol("site-appearance");
export const provideAppearance = (value: AppearanceContext) => setContext(key, value);
export const useAppearance = () => getContext<AppearanceContext | undefined>(key);
