<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import {
    appearancePalettes,
    appearanceModes,
    appearanceDensities,
    normalizeSiteAppearance,
    type SiteAppearance,
  } from "@alphaping/contracts";
  import { provideAppearance } from "$lib/appearance-context";

  let {
    appearance,
    workspace,
    children,
  }: { appearance?: SiteAppearance | undefined; workspace: string; children: Snippet } = $props();
  const defaults = $derived(normalizeSiteAppearance(appearance));
  let palette = $state<SiteAppearance["palette"] | "site">("site");
  let mode = $state<SiteAppearance["mode"] | "site">("site");
  let density = $state<SiteAppearance["density"] | "site">("site");
  const storageKey = $derived(`alphaping:appearance:${workspace}`);

  function apply(value: Record<string, unknown>) {
    palette = appearancePalettes.includes(value.palette as SiteAppearance["palette"])
      ? (value.palette as SiteAppearance["palette"])
      : "site";
    mode = appearanceModes.includes(value.mode as SiteAppearance["mode"])
      ? (value.mode as SiteAppearance["mode"])
      : "site";
    density = appearanceDensities.includes(value.density as SiteAppearance["density"])
      ? (value.density as SiteAppearance["density"])
      : "site";
  }
  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ palette, mode, density }));
    } catch {
      /* Preferences still apply for this visit. */
    }
  }
  provideAppearance({
    get defaults() {
      return defaults;
    },
    get palette() {
      return palette;
    },
    get mode() {
      return mode;
    },
    get density() {
      return density;
    },
    set(key, value) {
      apply({ palette, mode, density, [key]: value });
      persist();
    },
    reset() {
      apply({});
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* Browser storage may be unavailable. */
      }
    },
  });
  function restore() {
    apply({});
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored))
        apply(stored as Record<string, unknown>);
    } catch {
      /* Use the site defaults. */
    }
  }
  $effect(() => {
    void storageKey;
    restore();
  });
  onMount(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) restore();
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  });
</script>

<div
  class="appearance-surface"
  data-palette={palette === "site" ? defaults.palette : palette}
  data-mode={mode === "site" ? defaults.mode : mode}
  data-density={density === "site" ? defaults.density : density}
>
  {@render children()}
</div>
