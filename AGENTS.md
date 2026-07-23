# 项目 Agent 规则

这个仓库只处理已保存直播录像的精彩切片，不包含口播讲解或录屏教学工作流。

## 真源位置

- 直播原始录像：`输入/媒体素材/直播录像/`
- 草稿和已确认数据：`工作区/数据/`
- 直播派生母版：`工作区/派生媒体/直播切片/`
- 模板索引：`模板/模板索引.json`
- Remotion 引擎：`引擎/remotion/`
- 最终成片：`输出/最终成片/`

## 必须使用的 Skill 路由

- 直播精彩切片：读取并遵循 `skills/extract-livestream-clips/SKILL.md`。
- 提炼最终内容标题：读取并遵循 `skills/dbs-xhs-title/SKILL.md`。
- 处理任何 Remotion 代码或 CLI 任务：在项目 Skill 之后读取 `skills/remotion-best-practices/SKILL.md`。
- 创建或修改 Remotion React 组件、模板、布局或动画：额外读取 `skills/remotion-markup/SKILL.md`。
- 创建、转换或显示字幕：额外读取 `skills/remotion-captions/SKILL.md`；其中转写建议不得覆盖本项目的本地 Whisper.cpp 边界。
- 渲染检查图、低清预览或最终成片：额外读取 `skills/remotion-render/SKILL.md`，并且只通过本仓库封装命令执行。
- Remotion API、组件属性或 CLI 参数不确定时：读取 `skills/remotion-docs/SKILL.md`，查询当前官方文档后再实现。

## 硬性边界

- 只使用本地 Whisper.cpp，不得调用云端语音转写服务。
- 原始直播录像不可修改，原直播声音是最终视频唯一主音频来源。
- 每条切片只能映射一个已批准的连续原片区间。
- 直播候选评分必须覆盖 100% 原片时间轴，保存所有已评分区间和淘汰原因；总分严格大于 85 的区间排序去重后全部进入候选，数量不设上限。
- 切点和最终视觉都必须在 Studio 经用户明确确认；最终内容标题也必须单独确认，只用于成片文件名。
- 未经确认，不得永久删除原始素材、最终成片、日志或旧文件。

## 验证要求

修改工作流、数据结构、Skill 或模板后，运行 `npm run check`。修改视觉模板后，还要渲染代表性检查图并实际查看。
