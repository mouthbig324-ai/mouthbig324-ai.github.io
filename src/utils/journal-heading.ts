import MarkdownIt from "markdown-it";
const parser = new MarkdownIt({ html: false });
export type HeadingLevel = 0 | 2 | 3;

/** Format the active line while preserving text and protecting fenced code and lists. */
export function applyJournalHeading(text: string, start: number, end: number, level: HeadingLevel) {
  const from = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
  const next = text.indexOf("\n", start), to = next < 0 ? text.length : next;
  const line = text.slice(from, to), lineNumber = text.slice(0, from).split("\n").length - 1;
  const blocked = parser.parse(text, {}).some(token => token.map && ["fence", "code_block"].includes(token.type) && token.map[0] <= lineNumber && lineNumber < token.map[1]);
  if (end > to || blocked || /^\s*(?:[-+*]\s|\d+[.)]\s|>)/.test(line)) {
    return { text, start, end, changed: false, message: "请把光标放在一行普通文字中，小标题不会改动代码块或列表。" };
  }
  const oldPrefix = line.match(/^[ \t]{0,3}#{1,6}[ \t]+/)?.[0] || "";
  const prefix = level ? "#".repeat(level) + " " : "";
  const content = line.slice(oldPrefix.length);
  const shift = (position: number) => from + prefix.length + Math.max(0, position - from - oldPrefix.length);
  return { text: text.slice(0, from) + prefix + content + text.slice(to), start: shift(start), end: shift(end), changed: prefix !== oldPrefix,
    message: level === 2 ? "已设为大标题，预览和发布页会显示较大字号并加入目录。" : level === 3 ? "已设为小标题，预览和发布页会显示次级标题并加入目录。" : "已恢复为正文。" };
}
