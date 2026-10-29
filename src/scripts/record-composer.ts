import MarkdownIt from "markdown-it";
import { normalizeJournalText } from "../utils/journal-text";
import { publicMediaUrl } from "../utils/media-utils";
import { applyJournalHeading, type HeadingLevel } from "../utils/journal-heading";

export type ComposerPhoto = { src: string; alt: string; width: number; height: number; thumbnail?: string; title?: string };
type TextBlock = { id: string; kind: "text"; text: string };
type PhotoBlock = { id: string; kind: "photo"; photo: ComposerPhoto };
type Block = TextBlock | PhotoBlock;
type Callbacks = { photoChanged: (src: string, alt: string) => void; photoRemoved: (src: string) => void };
const markdown = new MarkdownIt({ html: false });
const textBlock = (text = ""): TextBlock => ({ id: crypto.randomUUID(), kind: "text", text });
const literalMarkdown = (value: string) => value.replace(/[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/g, "\\$&");
const photoMarkdown = (photo: ComposerPhoto) => `![${literalMarkdown(photo.alt.replace(/\r?\n/g, " "))}](<${photo.src}>${photo.title ? ` "${literalMarkdown(photo.title)}"` : ""})`;

export class RecordComposer {
  private blocks: Block[] = [];
  private cursor = { id: "", start: 0, end: 0 };
  private disabled = false;
  private rendering = false;
  private expandedText = new Set<string>();
  private expandedCaptions = new Set<string>();

  constructor(private source: HTMLTextAreaElement, private host: HTMLElement, private callbacks: Callbacks) {
    this.setBody(source.value, []);
  }

  setBody(body: string, photos: ComposerPhoto[]) {
    body = normalizeJournalText(body);
    this.blocks = [];
    this.expandedText.clear(); this.expandedCaptions.clear();
    const lines = body.split("\n");
    const tokens = markdown.parse(body, {});
    let previous = 0;
    for (let index = 0; index < tokens.length; index++) {
      const paragraph = tokens[index]; const inline = tokens[index + 1];
      if (paragraph.type !== "paragraph_open" || paragraph.level !== 0 || !paragraph.map || inline?.type !== "inline") continue;
      const children = inline.children?.filter(token => token.type !== "text" || token.content.trim());
      if (children?.length !== 1 || children[0].type !== "image") continue;
      const image = children[0]; const src = image.attrGet("src") || "";
      if (!/^https:\/\//.test(src) && !/^\/(?!\/)/.test(src)) continue;
      const [start, end] = paragraph.map;
      this.blocks.push(textBlock(lines.slice(previous, start).join("\n").replace(/\n+$/, "")));
      const existing = photos.find(photo => photo.src === src);
      const alt = image.children?.map(token => token.content).join("") || image.content;
      this.blocks.push({ id: crypto.randomUUID(), kind: "photo", photo: { src, width: existing?.width || 0, height: existing?.height || 0, ...(existing?.thumbnail ? { thumbnail: existing.thumbnail } : {}), ...(image.attrGet("title") ? { title: image.attrGet("title")! } : {}), alt } });
      previous = end;
    }
    this.blocks.push(textBlock(lines.slice(previous).join("\n").replace(/^\n+/, "")));
    this.source.value = body;
    const last = this.blocks[this.blocks.length - 1] as TextBlock;
    this.cursor = { id: last.id, start: last.text.length, end: last.text.length };
    this.render();
  }

  insertPhoto(photo: ComposerPhoto) {
    let index = this.blocks.findIndex(block => block.kind === "text" && block.id === this.cursor.id);
    if (index < 0) { this.blocks.push(textBlock()); index = this.blocks.length - 1; }
    const before = this.blocks[index] as TextBlock;
    const start = Math.min(this.cursor.start, before.text.length);
    const after = textBlock(before.text.slice(start));
    before.text = before.text.slice(0, start);
    this.expandedText.delete(before.id);
    this.blocks.splice(index, 1, before, { id: crypto.randomUUID(), kind: "photo", photo: { ...photo } }, after);
    this.cursor = { id: after.id, start: 0, end: 0 };
    this.sync(); this.render(); this.focusCursor();
  }

  formatHeading(level: HeadingLevel) {
    if (this.disabled) return "请等待当前操作完成。";
    const block = this.blocks.find(block => block.kind === "text" && block.id === this.cursor.id);
    if (!block || block.kind !== "text") return "请先点进想设置标题的文字行。";
    const result = applyJournalHeading(block.text, this.cursor.start, this.cursor.end, level);
    if (!result.changed) return result.message;
    block.text = result.text;
    this.cursor = { id: block.id, start: result.start, end: result.end };
    this.sync();
    const control = this.host.querySelector<HTMLTextAreaElement>(`[data-block-id="${block.id}"] textarea`);
    if (control) {
      control.value = block.text; this.focusCursor();
      control.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return result.message;
  }

  hasPhoto(src: string) { return this.blocks.some(block => block.kind === "photo" && block.photo.src === src); }

  updatePhotoAlt(src: string, alt: string) {
    for (const block of this.blocks) if (block.kind === "photo" && block.photo.src === src) {
      block.photo.alt = alt;
      const control = this.host.querySelector<HTMLInputElement>(`[data-block-id="${block.id}"] input`);
      if (control && control !== document.activeElement) {
        control.value = alt; control.hidden = !alt && !this.expandedCaptions.has(block.id);
        const toggle = control.parentElement?.querySelector<HTMLButtonElement>(".composer-caption-toggle");
        if (toggle) toggle.hidden = !control.hidden;
      }
      const image = this.host.querySelector<HTMLImageElement>(`[data-block-id="${block.id}"] img`);
      if (image) image.alt = alt || "正文照片";
    }
    this.sync();
  }

  removePhoto(src: string) {
    this.blocks = this.blocks.filter(block => block.kind !== "photo" || block.photo.src !== src);
    this.mergeText(); this.sync(); this.render();
  }

  setDisabled(disabled: boolean) {
    this.disabled = disabled;
    for (const element of this.host.querySelectorAll<HTMLTextAreaElement | HTMLInputElement | HTMLButtonElement>("textarea,input,button")) element.disabled = disabled;
  }

  focusCursor() {
    if (this.disabled) return;
    const control = this.host.querySelector<HTMLTextAreaElement>(`[data-block-id="${this.cursor.id}"] textarea`);
    if (control) {
      const cursor = { ...this.cursor };
      control.focus({ preventScroll: true }); control.setSelectionRange(cursor.start, cursor.end);
      this.cursor = cursor;
    }
  }

  private sync() {
    this.source.value = normalizeJournalText(this.blocks.map(block => block.kind === "text" ? block.text : photoMarkdown(block.photo)).filter(Boolean).join("\n\n"));
  }

  private mergeText() {
    const merged: Block[] = [];
    for (const block of this.blocks) {
      const previous = merged[merged.length - 1];
      if (previous?.kind === "text" && block.kind === "text") {
        const separator = previous.text && block.text ? "\n\n" : "";
        if (this.cursor.id === block.id) this.cursor = { id: previous.id, start: previous.text.length + separator.length + this.cursor.start, end: previous.text.length + separator.length + this.cursor.end };
        previous.text += separator + block.text;
      } else merged.push(block);
    }
    if (merged[0]?.kind !== "text") merged.unshift(textBlock());
    if (merged[merged.length - 1]?.kind !== "text") merged.push(textBlock());
    this.blocks = merged;
  }

  private render() {
    this.rendering = true;
    this.host.replaceChildren();
    this.blocks.forEach((block, index) => {
      const wrapper = document.createElement(block.kind === "photo" ? "figure" : "div");
      wrapper.className = `composer-${block.kind}`; wrapper.dataset.blockId = block.id;
      if (block.kind === "text") {
        if (!block.text && index !== this.blocks.length - 1 && !this.expandedText.has(block.id)) {
          wrapper.classList.add("composer-gap");
          const insert = document.createElement("button"); insert.type = "button"; insert.className = "composer-insert-text";
          insert.textContent = "＋ 在这里写文字"; insert.disabled = this.disabled;
          insert.addEventListener("click", () => {
            this.expandedText.add(block.id); this.cursor = { id: block.id, start: 0, end: 0 };
            this.render(); this.focusCursor();
          });
          wrapper.append(insert); this.host.append(wrapper); return;
        }
        const control = document.createElement("textarea"); control.value = block.text; control.rows = 4; control.disabled = this.disabled;
        control.placeholder = index === 0 ? "写下这一段文字，点上方按钮插入照片…" : "接着写下一段文字…";
        control.setAttribute("aria-label", `第 ${index + 1} 段文字`);
        const resize = () => { control.style.height = "auto"; control.style.height = `${Math.max(130, Math.min(control.scrollHeight + 2, 540))}px`; };
        const remember = () => { if (!this.rendering) this.cursor = { id: block.id, start: control.selectionStart, end: control.selectionEnd }; };
        control.addEventListener("input", () => { block.text = control.value; remember(); resize(); this.sync(); });
        for (const event of ["focus", "click", "keyup", "select", "blur"]) control.addEventListener(event, remember);
        wrapper.append(control); requestAnimationFrame(resize);
      } else {
        const image = document.createElement("img"); image.src = publicMediaUrl(block.photo.src); image.alt = block.photo.alt || "正文照片"; if (block.photo.title) image.title = block.photo.title;
        const caption = document.createElement("input"); caption.value = block.photo.alt; caption.maxLength = 300; caption.placeholder = "照片说明（可选）"; caption.setAttribute("aria-label", "正文照片说明"); caption.disabled = this.disabled;
        caption.hidden = !block.photo.alt && !this.expandedCaptions.has(block.id);
        const captionToggle = document.createElement("button"); captionToggle.type = "button"; captionToggle.className = "composer-caption-toggle";
        captionToggle.textContent = "＋ 添加说明"; captionToggle.hidden = !caption.hidden; captionToggle.disabled = this.disabled;
        captionToggle.addEventListener("click", () => { this.expandedCaptions.add(block.id); caption.hidden = false; captionToggle.hidden = true; caption.focus(); });
        caption.addEventListener("blur", () => { if (!caption.value) { this.expandedCaptions.delete(block.id); caption.hidden = true; captionToggle.hidden = false; } });
        caption.addEventListener("input", () => { block.photo.alt = caption.value; image.alt = caption.value; this.sync(); this.callbacks.photoChanged(block.photo.src, caption.value); });
        const actions = document.createElement("div"); actions.className = "composer-photo-actions";
        for (const [label, direction] of [["上移", -1], ["下移", 1]] as const) {
          const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.disabled = this.disabled;
          button.addEventListener("click", () => {
            let target = index + direction;
            while (target >= 0 && target < this.blocks.length) {
              const candidate = this.blocks[target];
              if (candidate.kind !== "text" || candidate.text) break;
              target += direction;
            }
            if (target < 0 || target >= this.blocks.length) return;
            [this.blocks[index], this.blocks[target]] = [this.blocks[target], this.blocks[index]];
            this.mergeText(); this.sync(); this.render();
          }); actions.append(button);
        }
        const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "移除图片"; remove.disabled = this.disabled;
        remove.addEventListener("click", () => { this.blocks.splice(index, 1); this.mergeText(); this.sync(); this.render(); this.callbacks.photoRemoved(block.photo.src); });
        actions.append(remove); wrapper.append(image, caption, captionToggle, actions);
      }
      this.host.append(wrapper);
    });
    this.rendering = false;
  }
}
