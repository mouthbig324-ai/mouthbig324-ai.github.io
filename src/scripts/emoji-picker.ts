const emojis = ["😀", "😂", "🥰", "😎", "😭", "🤔", "😅", "😍", "👍", "👏", "🎉", "❤️", "🙏", "🌹", "🍻", "🤝"];

export function emojiPicker(input: HTMLTextAreaElement) {
  const bar = document.createElement("div");
  bar.className = "emoji-picker";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "常用表情");
  for (const emoji of emojis) {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = emoji; button.title = `插入 ${emoji}`;
    button.setAttribute("aria-label", `插入表情 ${emoji}`);
    button.addEventListener("mousedown", event => event.preventDefault());
    button.addEventListener("click", () => {
      if (input.disabled) return;
      if (input.maxLength > 0 && input.value.length - (input.selectionEnd - input.selectionStart) + emoji.length > input.maxLength) return;
      input.setRangeText(emoji, input.selectionStart, input.selectionEnd, "end");
      input.dispatchEvent(new Event("input", { bubbles: true })); input.focus();
    });
    bar.append(button);
  }
  return bar;
}
