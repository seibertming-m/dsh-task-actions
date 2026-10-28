# dsh-task-actions · 任务管理增强

> Delete a DSH sidebar task or move it to another workspace — directly from the row menu.
>
> 在 DSH 侧栏直接删除任务，或把任务移动到其他空间。

- **作者 / Author:** 明白了
- **版本 / Version:** 0.1.0
- **许可证 / License:** MIT
- **兼容 / Requires:** DSH `^0.2.0` (Node.js 24+)

---

## 它解决什么问题

DSH 的左侧任务列表只提供置顶、重命名、分叉、归档和复制 ID。想把一个任务挪到
另一个空间，或者彻底清掉一个不想再看到的任务，原生界面没有入口。这个插件补上
这两件事，并且沿用 DSH 自己的空间注册表和会话格式，不做旁路数据库。

## 功能

| 菜单项 | 行为 |
| --- | --- |
| **移动到其他空间…** | 选择目标空间 → 会话日志目录搬到该空间、会话头 `cwd` 改写、工作区归属同步更新 → 页面自动刷新 |
| **删除任务…** | 二次确认 → 会话目录移入 `~/.dsh/trash/sessions/<时间戳>-<会话ID>`，从侧栏、空间归属和搜索索引移除 |

菜单出现在每个任务行的「…」里，排在原生「复制 Session ID」之后。

## 安装

从插件市场安装，或使用 CLI：

```powershell
dsh plugin --profile desktop add "dsh-task-actions@0.1.0"
```

本地目录安装（开发）：

```powershell
dsh plugin --profile desktop add "file:D:/path/to/dsh-task-actions"
```

安装后刷新页面一次，插件才会进入浏览器模块图。

## 发布状态（2026-10-28）

- **仓库**：<https://github.com/seibertming-m/dsh-task-actions>
- **市场索引**：<https://cdn.jsdelivr.net/gh/seibertming-m/dsh-task-actions@1b4b90dcda242c662c3716de6530ed8cc67070a0/market/index.json>
- **作者**：明白了 · **版本**：0.1.0 · **安装源**：git @ `549eca1`

> 国内网络下 `raw.githubusercontent.com` 的 DNS 会被污染（解析到非公网地址），
> 所以索引走 jsDelivr 的固定 commit 地址；升级时换成新的 commit 即可。

## 安全边界

- **删除不是永久删除。** 文件进入 DSH 回收站，目录结构完整保留；把它搬回
  `~/.dsh/sessions/<空间目录>/` 即可恢复。
- **正在打开或运行的任务会被拒绝。** 日志文件被占用时，移动/删除会返回
  「请先切换到其他任务」，不会留下半完成状态。
- **移动是原子的。** 先改写会话头，再搬目录，最后改工作区归属；任何一步失败都会
  回滚到原空间和原 `cwd`。
- **只监听回环地址。** 管理路由挂在 DSH 自己的 Web 服务器上，仅接受带
  `x-session-actions: 1` 请求头、且 `Origin` 与 Host 一致的调用。

## 已知限制

- 没有内置「撤销」按钮；删除后需要手动从回收站恢复。
- 删除时对 `session-query.sqlite` 的清理是尽力而为；数据库被占用时该任务可能
  仍出现在搜索结果中，重启 DSH 后消失。
- 移动依赖会话日志第一个 Zstandard 帧只包含会话头这一格式事实；遇到其他布局会
  中止并回滚，不会写入半截数据。

## 工作原理

- 宿主端（`lib/index.js`）是一个 Cordis 插件，注入 `webServer`，注册
  `/x-session-actions` 前缀路由，并使用 `workspaceRegistry` 服务做归属变更。
- 浏览器端（`lib/client.js`）向 `sidebar.workspaces.session.menu.item` 注册两个
  菜单项，向 `shell.overlay` 注册一个共享对话框，不打包任何第三方依赖。
- 会话日志是多帧 Zstandard 追加文件：插件只重压第一帧（会话头），其余帧逐字节保留。

## 开发

```
lib/index.js       宿主半侧（无构建步骤）
lib/client.js      浏览器半侧（window.__ModuleLoader__ 工厂）
locale/*.json      插件市场与插件页的展示文案
icon.svg           插件图标
cordis.patch.yml   bundle 挂载补丁
market/            市场索引与发布说明（不随包发布）
```

## 许可证

MIT © 2026 明白了
