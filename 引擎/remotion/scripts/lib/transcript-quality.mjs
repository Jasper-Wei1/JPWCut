export const PREFLIGHT_SAMPLE_DURATION_MS = 30_000;

export function createPreflightRanges(
  sourceDurationMs,
  sampleDurationMs = PREFLIGHT_SAMPLE_DURATION_MS,
) {
  if (!Number.isFinite(sourceDurationMs) || sourceDurationMs <= 0) {
    throw new Error("无法确定原片时长，不能启动转录预检。");
  }
  const durationMs = Math.min(sampleDurationMs, Math.round(sourceDurationMs));
  const endStartMs = Math.max(0, Math.round(sourceDurationMs) - durationMs);
  return [
    { label: "开头", fileStem: "start", startMs: 0, durationMs },
    {
      label: "中段",
      fileStem: "middle",
      startMs: Math.round(endStartMs / 2),
      durationMs,
    },
    { label: "结尾", fileStem: "end", startMs: endStartMs, durationMs },
  ];
}

export function assertTranscriptQuality(
  transcript,
  {
    sourceDurationMs,
    maxCaptionDurationMs = PREFLIGHT_SAMPLE_DURATION_MS,
    allowEmpty = false,
  },
) {
  const captions = Array.isArray(transcript.captions) ? transcript.captions : [];
  const issues = [];
  if (JSON.stringify(transcript).includes("\uFFFD")) {
    issues.push("包含 U+FFFD 乱码替换字符");
  }
  if (captions.length === 0 && !allowEmpty) issues.push("没有可用字幕");

  for (const [index, caption] of captions.entries()) {
    const startMs = Number(caption.startMs);
    const endMs = Number(caption.endMs);
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      startMs < 0 ||
      endMs <= startMs ||
      endMs > sourceDurationMs
    ) {
      issues.push(
        `第 ${index + 1} 条字幕时间码无效（${startMs}-${endMs}，源时长 ${sourceDurationMs}）`,
      );
    }
    if (endMs - startMs > maxCaptionDurationMs) {
      issues.push(`第 ${index + 1} 条字幕超过 30 秒`);
    }
  }
  if (issues.length > 0) {
    throw new Error(`标准化字幕质量检查失败：${issues.join("；")}。`);
  }
  return { captionCount: captions.length };
}
