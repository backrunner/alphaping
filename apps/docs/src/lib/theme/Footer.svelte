<script lang="ts">
  import { ArrowUpRight } from "@lucide/svelte";
  import { resolveLocalizedHref } from "svedocs/theme/headless";
  import type { SvedocsFooterProps } from "svedocs/theme/types";
  let { context }: SvedocsFooterProps = $props();
</script>

<footer class="ap-footer">
  <div class="ap-footer-top">
    <a class="ap-brand" href={resolveLocalizedHref("/", context)}
      ><img src="/alphaping.svg" alt="" width="32" height="32" /><span>AlphaPing</span></a
    >
    <p>{context.t("ap.footer.description")}</p>
    <nav aria-label={context.t("nav.footer")}>
      <a href={resolveLocalizedHref("/docs", context)}>{context.t("nav.docs")}</a>
      <a href="https://github.com/BackRunner/alphaping">GitHub<ArrowUpRight size={13} /></a>
      <a href="/llms.txt">llms.txt<ArrowUpRight size={13} /></a>
    </nav>
  </div>
  <div class="ap-footer-bottom">
    <span>{context.t("ap.footer.copyright")}</span><a href="https://github.com/BackRunner/svedocs"
      >{context.t("ap.footer.built")}</a
    >
  </div>
</footer>
