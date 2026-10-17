import MarkdownIt from "markdown-it";

const parser = new MarkdownIt({ html: false });

/** Ordinary Chinese journal paragraphs should not become indented code blocks. */
export function normalizeJournalText(body: string): string {
  const lines = body.split("\n");
  const edits: { start: number; end: number; lines: string[] }[] = [];
  for (const token of parser.parse(body, {})) {
    if (token.type !== "code_block" || token.level !== 0 || !token.map) continue;
    const prose = token.content.split("\n").filter(line => line.trim());
    if (!prose.length || !prose.every(line => /^[ \t]*(?:\p{Script=Han}|\d{1,4}[年月日号])/u.test(line))) continue;
    const [start, end] = token.map;
    const replacement = lines.slice(start, end).map(line => line.replace(/^[ \t]+/, ""));
    // Each deliberately indented prose line is its own paragraph.
    const paragraphs = replacement.flatMap((line, index) => index > 0 && line && replacement[index - 1] ? ["", line] : [line]);
    edits.push({ start, end, lines: paragraphs });
  }
  for (const edit of edits.reverse()) lines.splice(edit.start, edit.end - edit.start, ...edit.lines);
  return lines.join("\n");
}
