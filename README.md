# 嘴哥 · 旅行、影像与生活碎片

基于 [Fuwari](https://github.com/saicaca/fuwari) 的中文个人博客，部署在 GitHub Pages。

**网站：** https://mouthbig324-ai.github.io/

## 日常使用

完整说明见 [使用说明](docs/使用说明.md)。

- 旅行日记：Markdown 文章的 `category` 写 `旅行日记`。
- 生活碎片：`category` 写 `生活碎片`，在动态页显示全文，可放照片或视频。
- 相册：在专用管理后台直接上传原图，本地原件不变。
- 照片和短视频存放在 Cloudflare R2，支持外部 HTTPS 图片、视频地址。

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm new-post my-first-trip
pnpm import-photos "D:\Photos\Trip" my-first-trip --title "第一次旅行" --date 2026-10-13
pnpm check
pnpm build
```

新文章默认是草稿。准备好后把 `draft: true` 改为 `draft: false`，提交到 `main`，GitHub Actions 会自动检查、构建和发布。请使用 Node.js 24 与 pnpm 9.14.4。

文章起始模板在 [docs/templates](docs/templates)。修改名称、头像和简介可编辑 `src/config.ts`。

已连接 Cloudflare R2 和网页管理后台。后台照片不压缩、不生成缩略图，按原文件上传；照片和视频单个最多 64 MiB，累计上传上限 10 GB。日常发布使用私下保存的免密码管理入口，上传文件保存在 R2，GitHub 只保存文字与链接。电脑照片导入工具仍是可选的压缩导入方式，会占用 GitHub 仓库空间。云端文件不替代本地原件备份。

## 主题许可

Fuwari 原始代码使用 MIT 许可，见 [LICENSE](LICENSE)。保留原主题署名。网站的原创文字和照片未额外授予 Creative Commons 许可。
