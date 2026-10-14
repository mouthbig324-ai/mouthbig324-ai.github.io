type Comment = { id: string; name: string; body: string; created: string; owner?: boolean };
export function mountComments() {
  for (const section of document.querySelectorAll<HTMLElement>(".comments")) {
    if (section.dataset.mounted) continue;
    section.dataset.mounted = "true";
    const api = section.dataset.api!;
    const path = section.dataset.path!;
    const list = section.querySelector<HTMLElement>(".comment-list")!;
    const status = section.querySelector<HTMLElement>(".comment-status")!;
    const form = section.querySelector<HTMLFormElement>("form")!;
    async function refresh() {
      const response = await fetch(`${api}/comments?path=${encodeURIComponent(path)}`);
      if (!response.ok) throw new Error("留言暂时无法加载，请稍后再试。");
      const { comments } = await response.json() as { comments: Comment[] };
      list.replaceChildren();
      if (!comments.length) { const hint = document.createElement("p"); hint.className = "text-50 text-sm"; hint.textContent = "还没有留言，来聊两句吧。"; list.append(hint); }
      for (const item of comments) {
        const card = document.createElement("article"); card.className = "rounded-xl p-4 bg-black/[.03] dark:bg-white/[.03]";
        const name = document.createElement("strong"); name.className = "text-90"; name.textContent = item.name + (item.owner ? " · 博主" : "");
        const date = document.createElement("time"); date.className = "text-xs text-50 ml-3"; date.textContent = new Date(item.created).toLocaleString("zh-CN");
        const body = document.createElement("p"); body.className = "text-75 mt-2 whitespace-pre-wrap break-words"; body.textContent = item.body;
        card.append(name, date, body); list.append(card);
      }
    }
    refresh().catch(error => { status.textContent = error.message; });
    form.addEventListener("submit", async event => {
      event.preventDefault(); const button = form.querySelector<HTMLButtonElement>("button")!; button.disabled = true; status.textContent = "正在发送…";
      try {
        const fields = Object.fromEntries(new FormData(form));
        const response = await fetch(`${api}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...fields, path }) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || "留言暂时未发送成功。");
        form.querySelector<HTMLTextAreaElement>("textarea")!.value = ""; status.textContent = "留言已发表。"; await refresh();
      } catch (error) { status.textContent = error instanceof Error ? error.message : "请稍后再试。"; }
      finally { button.disabled = false; }
    });
  }
}
