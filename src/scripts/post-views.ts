function visitorId() {
  try {
    const key = "zuige-view-visitor";
    const stored = localStorage.getItem(key);
    if (stored && /^[a-f0-9-]{36}$/i.test(stored)) return stored;
    const id = crypto.randomUUID(); localStorage.setItem(key, id); return id;
  } catch { return null; }
}
export function mountViews() {
  for (const element of document.querySelectorAll<HTMLElement>(".post-views")) {
    if (element.dataset.mounted) continue;
    element.dataset.mounted = "true";
    const load = async () => {
      if (!element.isConnected) return;
      const visitor = visitorId(); const target = element.querySelector("span")!;
      try {
        const endpoint = `${element.dataset.api}/views`;
        const response = await fetch(visitor ? endpoint : `${endpoint}?path=${encodeURIComponent(element.dataset.path!)}`, {
          ...(visitor ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: element.dataset.path, visitor }) } : {}),
          signal: AbortSignal.timeout(12000),
        });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!Number.isSafeInteger(data.views) || data.views < 0) throw new Error();
        target.textContent = data.views.toLocaleString("zh-CN");
      } catch { target.textContent = "暂时无法加载"; }
    };
    if (document.visibilityState === "visible") void load();
    else {
      const onVisible = () => {
        if (document.visibilityState !== "visible") return;
        document.removeEventListener("visibilitychange", onVisible); void load();
      };
      document.addEventListener("visibilitychange", onVisible);
    }
  }
}
