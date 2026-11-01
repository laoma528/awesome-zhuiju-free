# Typecho 博客文章库

这个目录用于存放未来发布到 Typecho 博客的文章。每篇文章都按「用文本编辑器打开文件，复制 Markdown 原始内容到 Typecho 即可发布」的目标编写，尽量减少发布前二次整理。

## 常更新文章

- **iOS影视APP-追剧必备**：线上固定链接 <https://b.zhuiju.me/p/23>（文章 ID：23）；仓库源文件 `blog/articles/2026-09-13-ios-yingshi-app.md`。这篇文章会经常更新，修改时保留原链接，并同步更新源文件与线上正文。

- **安卓Android影视APP-追剧必备**：线上固定链接 <https://b.zhuiju.me/p/27>（文章 ID：27）；仓库源文件 `blog/articles/2026-11-01-android-yingshi-app.md`，下载地址备份 `resources/android-yingshi-app-downloads.json`。更新时保留原链接，并同步本地与线上正文。

## 目录约定

```text
blog/
├── README.md              # 写作与发布规范
├── _template.md           # Typecho 文章模板
└── articles/              # 正式文章或待发布草稿
```

文章文件建议放在 `articles/` 目录，命名格式：

```text
YYYY-MM-DD-文章主题.md
```

示例：

```text
2026-07-12-awesome-zhuiju-free-guide.md
```

## Typecho 复制规范

发布时建议用 VS Code、记事本或其他文本编辑器打开 `.md` 文件，复制原始 Markdown 内容到 Typecho 编辑器。不要从 GitHub 预览页、浏览器渲染页或聊天窗口的预览效果里复制，否则 Markdown 标题、表格和列表可能会丢失。

文章文件直接从 `# 标题` 开始，不在顶部放 HTML 注释、发布检查项或其他不会展示给读者的内容。标题、分类、标签、Slug 和摘要在 Typecho 后台填写。

正文中可以保留：

- `<!--more-->`：Typecho 摘要分隔符。
- Markdown 标题、列表、表格、引用、代码块。
- 需要网友复制的地址，建议用代码格式包起来，例如 `` `http://example.com/config.json` ``。

## 推荐文章结构

一篇教程文章建议使用下面的节奏：

1. 先讲用户痛点：为什么需要这个教程。
2. 给出结论：读者能得到什么。
3. 分步骤操作：每一步尽量有明确动作。
4. 补充常见问题：减少评论区重复解释。
5. 结尾给入口：网站、GitHub、反馈渠道。

## 发布前检查

- 标题是否具体，避免只写「使用教程」。
- 首屏 3 段内是否说明了文章价值。
- 每个步骤是否能独立照做。
- 外部链接是否完整；需要网友复制的地址不要做成超链接。
- 是否包含 `<!--more-->`。
- 是否避免承诺「永久可用」「绝对安全」这类不准确表达。
- 是否说明资源可用性会随时间变化。

## 本地 XML-RPC 管理

项目根目录的 `.typecho.local.json` 保存本机账号配置，并已由 `.gitignore` 排除。管理脚本仅使用 Python 标准库，无需安装依赖。先执行不会修改博客的连接检查：

```powershell
python scripts/publish-typecho.py check
```

### 管理文章

```powershell
# 列出最近 10 篇文章
python scripts/publish-typecho.py post list

# 查看文章；加 --output 可导出为 Markdown 后编辑
python scripts/publish-typecho.py post get 19
python scripts/publish-typecho.py post get 19 --output blog/articles/article-19.md

# 新建草稿或正式发布
python scripts/publish-typecho.py post new blog/articles/文章.md --status draft
python scripts/publish-typecho.py post new blog/articles/文章.md --status publish --category 教程 --tag Typecho --slug article-slug

# 更新已有文章；未重新指定的分类、标签、Slug 等属性会从原文章保留
python scripts/publish-typecho.py post update 19 blog/articles/文章.md --status publish
```

原有的 `new`、`update` 顶级命令仍可继续使用，它们分别等同于 `post new`、`post update`。

### 管理独立页面

```powershell
# 列出、查看或导出独立页面
python scripts/publish-typecho.py page list
python scripts/publish-typecho.py page get 2
python scripts/publish-typecho.py page get 2 --output blog/pages/about.md

# 新增页面草稿或直接发布
python scripts/publish-typecho.py page new blog/pages/about.md --status draft --slug about
python scripts/publish-typecho.py page new blog/pages/about.md --status publish --slug about --order 1

# 编辑并发布已有页面
python scripts/publish-typecho.py page update 2 blog/pages/about.md --status publish

# 永久删除页面，必须再次输入相同 ID
python scripts/publish-typecho.py page delete 2 --confirm 2
```

当前网站的 `wp.getPage` 对部分旧页面会返回 500，`wp.getPages` 还会混入 PHP Deprecated 警告。脚本已内置兼容回退，会从批量响应中恢复页面正文、Slug 和排序等已返回字段。如果兼容读取仍然失败，更新会自动停止；确认接受属性重置风险时，才使用 `--force-without-metadata`，并通过 `--slug`、`--order`、`--template` 等参数明确提供页面属性。服务端后续仍建议升级 Typecho 或调整 PHP 错误显示设置。

Markdown 文件第一行必须是 `# 标题`。Typecho 会根据后台的 XML-RPC Markdown 设置保存正文，脚本不会重复添加 `<!--markdown-->` 标记。所有新增与更新命令都必须显式传入 `--status draft` 或 `--status publish`，避免误发。

## 常用项目入口

- 网站：https://zhuiju.me
- GitHub：https://github.com/laoma528/awesome-zhuiju-free
- Gitee 镜像：https://gitee.com/laoma2053/awesome-zhuiju-free
- 推荐新资源：https://github.com/laoma528/awesome-zhuiju-free/issues/new?template=resource.yml
- 报告失效：https://github.com/laoma528/awesome-zhuiju-free/issues/new?template=broken-link.yml
