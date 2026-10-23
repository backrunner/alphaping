<script lang="ts">
  import { Article, TableOfContents } from "svedocs/theme";
  import { ArrowUpRight, BookOpen } from "@lucide/svelte";
  import type { SvedocsDocsShellProps } from "svedocs/theme/types";
  import Sidebar from "./Sidebar.svelte";
  let {
    page,
    navigationTree = [],
    content,
    context,
    tocController,
    themeComponents = {},
  }: SvedocsDocsShellProps = $props();
</script>

<div class="ap-docs-layout">
  <aside class="ap-docs-sidebar" aria-label={context.t("nav.documentation")}>
    <div class="ap-sidebar-title"><BookOpen size={17} />{context.t("article.kind.doc")}</div>
    <nav><Sidebar items={navigationTree} currentPath={page.routePath} /></nav>
    <div class="ap-sidebar-help">
      <span>{context.t("ap.sidebar.help")}</span>
      <a href="https://github.com/BackRunner/alphaping/issues"
        >{context.t("ap.sidebar.feedback")}<ArrowUpRight size={14} /></a
      >
    </div>
  </aside>
  <TableOfContents {page} controller={tocController} {context} />
  <main id="content" class="ap-docs-main">
    <Article {page} {content} {context} {themeComponents} />
  </main>
</div>
