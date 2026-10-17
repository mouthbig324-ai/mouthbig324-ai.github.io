import { emojiPicker } from "./emoji-picker";
type Comment = { id: string; name: string; body: string; created: string; owner?: boolean; parent_id?: string | null };

export function mountComments() {
  for (const section of document.querySelectorAll<HTMLElement>(".comments")) {
    if (section.dataset.mounted) continue;
    section.dataset.mounted = "true";
    const api = section.dataset.api!;
    const path = section.dataset.path!;
    const list = section.querySelector<HTMLElement>(".comment-list")!;
    const status = section.querySelector<HTMLElement>(".comment-status")!;
    const form = section.querySelector<HTMLFormElement>("form")!;
    const input = form.querySelector<HTMLTextAreaElement>("textarea")!;
    const context = form.querySelector<HTMLElement>(".comment-reply-context")!;
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    let parentId: string | null = null;
    let sending = false;
    input.after(emojiPicker(input));
    function replyTo(item: Comment | null) {
      if (sending) return;
      parentId = item?.id || null; context.hidden = !item;
      context.querySelector("span")!.textContent = item ? `正在回复 ${item.name}` : "";
      submit.textContent = item ? "发表回复" : "发表留言";
      input.placeholder = item ? `回复 ${item.name}…` : "写下你的留言…";
      if (item) { form.scrollIntoView({ behavior: "smooth", block: "center" }); input.focus({ preventScroll: true }); }
    }
    form.querySelector(".comment-cancel-reply")!.addEventListener("click", () => replyTo(null));
    async function refresh() {
      const response = await fetch(`${api}/comments?path=${encodeURIComponent(path)}`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error("留言暂时无法加载，请稍后重试。");
      const { comments } = await response.json() as { comments: Comment[] };
      list.replaceChildren();
      if (!comments.length) { const hint = document.createElement("p"); hint.className = "text-50 text-sm"; hint.textContent = "还没有留言，来聊两句吧。"; list.append(hint); }
      const byId = new Map(comments.map(item => [item.id, item]));
      const cards = new Map<string, HTMLElement>();
      const replies = new Map<string, HTMLElement>();
      // Keep replies one level deep on phones, while naming the exact recipient.
      function rootId(item: Comment) {
        const seen = new Set([item.id]); let current = item;
        while (current.parent_id && byId.has(current.parent_id)) {
          if (seen.has(current.parent_id)) return item.id;
          seen.add(current.parent_id); current = byId.get(current.parent_id)!;
        }
        return current.id;
      }
      for (const item of comments) {
        const card = document.createElement("article"); card.className = "comment-card"; card.id = `comment-${item.id}`;
        const name = document.createElement("strong"); name.className = "text-90"; name.textContent = item.name + (item.owner ? " · 博主" : "");
        const date = document.createElement("time"); date.className = "text-xs text-50 ml-3"; date.dateTime = item.created; date.textContent = new Date(item.created).toLocaleString("zh-CN");
        card.append(name, date);
        if (item.parent_id) {
          const target = document.createElement("p"); target.className = "comment-reply-target text-50";
          const parent = byId.get(item.parent_id);
          if (parent) { const link = document.createElement("a"); link.href = `#comment-${parent.id}`; link.textContent = `回复 ${parent.name}`; target.append(link); }
          else target.textContent = "回复的原留言已隐藏或暂不可见";
          card.append(target);
        }
        const body = document.createElement("p"); body.className = "text-75 mt-2 whitespace-pre-wrap break-words"; body.textContent = item.body;
        const reply = document.createElement("button"); reply.type = "button"; reply.className = "comment-reply-button"; reply.textContent = "回复"; reply.setAttribute("aria-label", `回复 ${item.name}`); reply.addEventListener("click", () => replyTo(item));
        const children = document.createElement("div"); children.className = "comment-replies";
        card.append(body, reply, children); cards.set(item.id, card); replies.set(item.id, children);
      }
      for (const item of comments) {
        const root = rootId(item);
        (root === item.id ? list : replies.get(root)!).append(cards.get(item.id)!);
      }
    }
    refresh().catch(error => { status.textContent = error.message; });
    form.addEventListener("submit", async event => {
      event.preventDefault(); if (sending) return;
      sending = true; submit.disabled = true; status.textContent = "正在发送…";
      let published = false;
      try {
        const fields = Object.fromEntries(new FormData(form));
        const response = await fetch(`${api}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...fields, path, parent_id: parentId }) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || "留言暂时未发送成功。");
        published = true; input.value = ""; sending = false; replyTo(null); status.textContent = "留言已发表。"; await refresh();
      } catch (error) { status.textContent = published ? "留言已发表，列表刷新失败，请稍后刷新页面查看。" : error instanceof Error ? error.message : "请稍后再试。"; }
      finally { sending = false; submit.disabled = false; }
    });
  }
}
