<script lang="ts">
  import { Article, TableOfContents } from "svedocs/theme";
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
    <div class="ap-sidebar-title">{context.t("article.kind.doc")}</div>
    <nav><Sidebar items={navigationTree} currentPath={page.routePath} /></nav>
    <div class="ap-sidebar-help">
      <a href="https://github.com/BackRunner/alphaping/issues">{context.t("ap.sidebar.feedback")}</a
      >
    </div>
  </aside>
  <TableOfContents {page} controller={tocController} {context} />
  <main id="content" class="ap-docs-main">
    <Article {page} {content} {context} {themeComponents} />
  </main>
</div>
