import { visit } from "unist-util-visit";

// Render typed line endings like the editor preview; code nodes stay untouched.
export default function remarkJournalBreaks() {
  return tree => {
    visit(tree, "text", (node, index, parent) => {
      if (!parent || index === undefined || !/[\r\n]/.test(node.value)) return;
      const lines = node.value.split(/\r\n|\r|\n/);
      const replacement = lines.flatMap((value, line) => [
        ...(line ? [{ type: "break" }] : []),
        ...(value ? [{ type: "text", value }] : []),
      ]);
      parent.children.splice(index, 1, ...replacement);
      return index + replacement.length;
    });
  };
}
