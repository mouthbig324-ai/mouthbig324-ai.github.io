# 嘴哥 · 旅行、影像与生活碎片

基于 [Fuwari](https://github.com/saicaca/fuwari) 的中文个人博客，部署在 GitHub Pages。

**网站：** https://mouthbig324-ai.github.io/

## 日常使用

完整说明见 [使用说明](docs/使用说明.md)。

- 旅行日记：Markdown 文章的 `category` 写 `旅行日记`。
- 生活碎片：`category` 写 `生活碎片`，在动态页显示全文，可放照片或视频。
- 相册：运行照片导入工具生成压缩版和缩略图，本地原件不变。
- 支持外部 HTTPS 图片、视频地址，便于以后接入独立存储。

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

当前未连接第三方图片或视频存储，也没有网页上传后台。少量压缩图片可以随网站发布；长期积累的照片和视频建议接入独立存储。网站展示文件不替代本地原件备份。

## 主题许可

Fuwari 原始代码使用 MIT 许可，见 [LICENSE](LICENSE)。保留原主题署名。网站的原创文字和照片未额外授予 Creative Commons 许可。
