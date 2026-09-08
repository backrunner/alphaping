/** Keep horizontally scrolling code reachable by keyboard in prerendered HTML. */
export const focusableCode = {
  name: "alphaping:focusable-code",
  code(node: { properties: Record<string, unknown> }) {
    node.properties.tabIndex = 0;
  },
};
