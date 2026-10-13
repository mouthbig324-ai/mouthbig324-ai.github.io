import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const slug = process.argv[2]?.replace(/\.md$/i, "");
if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
  console.error("用法：pnpm new-post my-first-trip（英文小写、数字和短横线）");
  process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.join(root, "src/content/posts", `${slug}.md`);
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const content = `---\ntitle: ${JSON.stringify(slug)}\npublished: ${date}\ndescription: ''\nimage: ''\ntags: []\ncategory: 生活碎片\ndraft: true\n---\n\n在这里开始记录。\n`;
try {
  fs.writeFileSync(destination, content, { flag: "wx" });
  console.log(`已创建草稿：${destination}\n写好后把 draft 改为 false，再提交发布。`);
} catch (error) {
  if (error.code === "EEXIST") console.error("同名文章已经存在，未覆盖。");
  else console.error(error.message);
  process.exit(1);
}
