<script lang="ts">
  import { validateSiteLogoUrl } from "@alphaping/contracts";
  import alphaPingLogo from "$lib/assets/alphaping.svg";

  let {
    logoUrl = "",
    size = 40,
    onStatus,
  }: {
    logoUrl?: string | undefined;
    size?: number;
    onStatus?: (status: "loaded" | "error") => void;
  } = $props();
  const source = $derived.by(() => {
    try {
      return validateSiteLogoUrl(logoUrl);
    } catch {
      return "";
    }
  });
  let loadedSource = $state("");

  function observeImage(node: HTMLImageElement) {
    const expectedSource = source;
    function update() {
      if (source !== expectedSource) return;
      const loaded = node.naturalWidth > 0;
      loadedSource = loaded ? expectedSource : "";
      onStatus?.(loaded ? "loaded" : "error");
    }
    node.addEventListener("load", update);
    node.addEventListener("error", update);
    // Cached loads and failures can happen before hydration attaches listeners.
    if (node.complete) update();
    return {
      destroy() {
        node.removeEventListener("load", update);
        node.removeEventListener("error", update);
      },
    };
  }
</script>

<span class="site-logo" style:width={`${size}px`} style:height={`${size}px`} aria-hidden="true">
  <img
    class:replaced={source !== "" && loadedSource === source}
    src={alphaPingLogo}
    alt=""
    width={size}
    height={size}
  />
  {#if source}
    {#key source}
      <img
        class="custom-logo"
        class:loaded={loadedSource === source}
        src={source}
        alt=""
        width={size}
        height={size}
        decoding="async"
        referrerpolicy="no-referrer"
        use:observeImage
      />
    {/key}
  {/if}
</span>

<style>
  .site-logo {
    position: relative;
    display: inline-grid;
    flex: none;
    vertical-align: middle;
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .replaced {
    visibility: hidden;
  }
  .custom-logo {
    position: absolute;
    inset: 0;
    opacity: 0;
  }
  .custom-logo.loaded {
    opacity: 1;
  }
</style>
