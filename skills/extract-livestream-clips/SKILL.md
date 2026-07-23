---
name: extract-livestream-clips
description: 从一段已保存的本地直播录像中筛选、审核并制作 9:16 精彩切片。用户要求直播高光、直播切片、从长直播里选可发布片段、确认候选切点、生成竖屏字幕版或渲染已批准直播短视频时使用。
---

# 直播精彩切片

从仓库根目录执行。先读取 `AGENTS.md`、`文档/直播切片需求.md`和
`模板/livestream-clip-916/模板说明.json`。

## 输入和默认值

- 只使用 `输入/媒体素材/直播录像/` 中用户指定的一段录像。
- 只用本地 Whisper.cpp，并复用指纹匹配的逐字稿。
- 默认用 90 秒评分窗口、60 秒步长覆盖完整原片时间轴。
- 每个窗口都必须完成六维评分；保留线为总分严格大于 85/100。
- 候选数量不设上限，不得因为已经找到若干条高分候选而提前停止评分。
- 每条只能选择原直播的一个连续区间，并从区间原起点完整播放。
- 输出固定为 1080x1920、30fps，原直播声音是唯一主音频。

## 固定流程

1. 运行 `npm run doctor`，必要时只运行一次本地转录。
2. 运行 `npm run clips:candidates -- prepare ...`，生成
   `工作区/数据/草稿/<name>-scoring-audit.json`。检查 `coveragePercent`
   必须为 100，`gaps` 必须为空。
3. Agent 按逐字稿完成每个区间的主题键、工作标题、核心观点、六维
   分数、证据、风险和淘汰理由，写入
   `工作区/数据/草稿/<name>-scoring-decisions.json`。总分不高于 85 的区间必须写
   具体内容淘汰原因。
4. 运行 `npm run clips:candidates -- score ...`，脚本必须验证每个覆盖区间
   都有且只有一份评分决定，再生成 `<name>-scored-audit.json`。
5. 运行 `npm run clips:candidates -- build ...`。脚本保存所有已评分区间，
   对严格大于 85 分的区间按分数降序排列，再按 `topicKey` 和 50% 时间
   重叠去重。去重淘汰项也必须保留原因和 `duplicateOf`。
6. 向用户交付可直接阅读的候选审核稿，不得只给标题和分数。
   候选数量可为 0 或任意正整数，不得截断为前 5 条。
7. 运行 `npm run clips:review -- prepare ...`，为已选择候选生成连续源区间的
   Studio 审核计划。
8. 在 Studio 打开 `Workflow > LivestreamClipReview`，实际查看每条候选从原起点
   到原终点的连续播放结果。任何切点变化都会重置为待确认；用户明确处理全部
   候选后，才能 `--confirm-studio`。
9. 运行 `npm run clips:review -- apply ...`。每个已批准区间生成独立
   派生母版和重映射逐字稿，并立即锁定时长。
10. 只用窄审校文件修正确定的 Whisper 错字和专有名词。保留原话，
   不确定内容记入 `ambiguities`。
11. 运行 `npm run clips:video-data -- --plan <approved-clips.json>`。在 Studio
   打开 `Workflow > LivestreamClipVisualReview`，检查全部已批准切片的人脸、字幕、
   9:16 居中裁切、人脸和字幕安全区。
12. 实际查看检查图后运行 `npm run clips:visual-review -- mark-stills`。
13. 只有用户明确确认最终视觉后，才运行
   `npm run clips:visual-review -- confirm-studio`。
14. 读取 `skills/dbs-xhs-title/SKILL.md`，根据每条已批准切片的实际
    内容提炼最终内容标题，并交付可直接阅读的标题确认稿。候选审核
    标题只能作为参考，不得直接当作最终标题。确认稿每条列出
    切片 ID、推荐标题、公式编号和一句内容依据。
15. 用户明确确认每条标题后，写入
    `工作区/数据/已确认/<name>-content-titles.json`，然后运行
    `npm run clips:visual-review -- render --titles <approved-content-titles.json>`。

```bash
npm run clips:candidates -- prepare \
  --transcript "工作区/数据/草稿/<name>-transcript.json" \
  --source-video "输入/媒体素材/直播录像/<video>.mp4" \
  --output "工作区/数据/草稿/<name>-scoring-audit.json"

npm run clips:candidates -- score \
  --audit "工作区/数据/草稿/<name>-scoring-audit.json" \
  --decisions "工作区/数据/草稿/<name>-scoring-decisions.json" \
  --output "工作区/数据/草稿/<name>-scored-audit.json"

npm run clips:candidates -- build \
  --audit "工作区/数据/草稿/<name>-scored-audit.json" \
  --output "工作区/数据/草稿/<name>-clip-candidates.json" \
  --review-output "工作区/数据/草稿/<name>-全时间轴评分审核稿.md"

```

## 确认语义

- 确认只对当前已经展示的审核层级生效，不得自动延伸到后续尚未展示的步骤。
- 在候选审核稿上说“全部保留”，表示选中当前全部候选，不代表切点或视觉已确认。
- 在切点 Studio 审核上说“全部切点确认”，只批准当前连续源区间，并解锁
  派生母版生成与时间轴锁定。
- 在最终视觉审核上说“确认通过”，只批准 9:16 裁切、字幕和画面处理。
- 在标题确认稿上说“全部确认”，只批准当前列出的最终内容标题。
- 用户后续缩小或纠正范围时，以最新明确说法为准。

## 成片边界

- 成片不显示候选标题、候选编号、分数、审核状态或原片时间码。
- 最终内容标题不叠加到视频画面，只用于最终 `.mp4` 文件名。
- 最终内容标题默认不超过 20 个字符，必须来自该切片内容，不得虚构
  未出现的结果、数字或承诺。
- 最终文件名为 `<contentTitle>.mp4`；标题重名、含路径字符或与已有成片
  冲突时必须停止，不得覆盖。
- 原画面使用 `cover` 等比填满 9:16 画布，默认居中裁切左右两侧。
- 不遮挡、删除或处理原直播弹幕、联系方式和直播 UI。
- 新字幕直接叠加在画面下方，使用描边和阴影保证可读性。
- 成片模板只读取派生母版、窄审校逐字稿、裁切位置和字幕参数。
- 候选审核数据和最终视频数据必须分离。
- 未经确认不覆盖或删除原片、派生母版、逐字稿、日志和旧成片。
- 成片已渲染后如果用户只修改标题，只做文件系统重命名并核对重命名前后哈希；
  不重渲染、不重置视觉确认、不修改视频内容。

## 验证

修改工作流、数据或模板后运行 `npm run check`。修改视觉后还要运行
`npm run gallery`，并实际查看代表性检查图。
