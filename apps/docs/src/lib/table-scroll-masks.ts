/** Enhance svedocs tables without replacing their native scroll containers. */
export function mountTableScrollMasks(root: ParentNode): () => void {
  const cleanups = Array.from(
    root.querySelectorAll<HTMLTableElement>(".sd-prose table"),
    (table) => {
      const originalTabIndex = table.getAttribute("tabindex");

      function update() {
        const maxScroll = Math.max(0, table.scrollWidth - table.clientWidth);
        const left = Math.min(maxScroll, Math.max(0, table.scrollLeft));
        const right = maxScroll - left;
        table.toggleAttribute("data-ap-scroll-mask", maxScroll > 1);
        // scrollLeft can be fractional while scrollWidth/clientWidth are rounded.
        table.style.setProperty("--ap-table-fade-left", `${left <= 1 ? 0 : Math.min(32, left)}px`);
        table.style.setProperty(
          "--ap-table-fade-right",
          `${right <= 1 ? 0 : Math.min(32, right)}px`,
        );

        if (originalTabIndex === null) {
          if (maxScroll > 1 || table.scrollHeight > table.clientHeight + 1) {
            table.tabIndex = 0;
          } else {
            table.removeAttribute("tabindex");
          }
        }
      }

      const observer = new ResizeObserver(update);
      observer.observe(table);
      // Row groups can resize after fonts load without changing the scroll viewport.
      for (const child of table.children) observer.observe(child);
      table.addEventListener("scroll", update, { passive: true });
      update();

      return () => {
        observer.disconnect();
        table.removeEventListener("scroll", update);
        table.removeAttribute("data-ap-scroll-mask");
        table.style.removeProperty("--ap-table-fade-left");
        table.style.removeProperty("--ap-table-fade-right");
        if (originalTabIndex === null) table.removeAttribute("tabindex");
      };
    },
  );

  return () => cleanups.forEach((cleanup) => cleanup());
}
