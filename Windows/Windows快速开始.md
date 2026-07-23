# Windows 快速开始

本版本支持 Windows 10 或 Windows 11 的 x64 电脑。Windows ARM、WSL 和云端语音转录不在当前支持范围内。

## 准备

1. 安装 Node.js 20 LTS 或更新版本：[nodejs.org](https://nodejs.org/)。安装后关闭并重新打开资源管理器。
2. 下载仓库 ZIP 并解压，或用 Git 克隆。推荐使用短路径，例如 `D:\JPWClips`；不要放进 OneDrive、桌面或包含很深层目录的位置。
3. 双击 `Windows/install.cmd`。首次安装会下载依赖、本地 Whisper.cpp 和约 500 MB 的 `small` 模型，过程需要网络。

安装完成后，`npm run doctor` 的每一项都应显示“正常”。

## 制作直播切片

1. 将一段直播录像放进 `输入/媒体素材/直播录像/`。
2. 在 Codex 中打开该仓库并发送：

```text
请读取 skills/extract-livestream-clips/SKILL.md，从
输入/媒体素材/直播录像/<视频文件>.mp4 筛选精彩切片。
先给我候选审核稿，切点和最终视觉都必须在 Studio 确认，不要直接渲染成片。
```

3. 当 Agent 需要 Studio 审核时，双击 `Windows/open-studio.cmd`。

原始录像、逐字稿、缓存和最终成片全部保留在本机。切片候选、切点、视觉和最终标题仍需分别由你确认。

维护者会在每次变更时运行 Windows 模板渲染检查；发布前还会手动触发 Windows 原生转录冒烟检查，验证 Whisper 二进制、模型下载和实际转录。

## 常见问题

- **提示找不到 Node.js**：安装 Node.js 20 LTS 后重新打开资源管理器，再双击 `install.cmd`。
- **安装被安全软件拦截**：允许 Node.js 和 PowerShell 完成本地 Whisper 安装；不要关闭实时防护后忘记恢复。
- **路径或文件名异常**：将仓库移到 `D:\JPWClips`，并避免用 Windows 不支持的文件名字符。
- **Studio 无法启动**：先重新运行 `Windows/install.cmd`，再查看 `npm run doctor` 的输出。
