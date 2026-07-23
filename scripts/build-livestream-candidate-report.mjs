#!/usr/bin/env node

import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

export const SCORE_DIMENSIONS = {
  standaloneCompleteness: 30,
  informationValue: 20,
  openingStrength: 20,
  expressionStrength: 10,
  editability: 10,
  platformFit: 10,
};

export const SCORE_THRESHOLD_EXCLUSIVE = 85;
export const DEFAULT_WINDOW_MS = 90000;
export const DEFAULT_STRIDE_MS = 60000;

export function createCoverageRanges(
  durationMs,
  windowMs = DEFAULT_WINDOW_MS,
  strideMs = DEFAULT_STRIDE_MS,
) {
  if (!Number.isInteger(durationMs) || durationMs <= 0) {
    throw new Error("源视频时长必须是正整数毫秒。");
  }
  if (
    !Number.isInteger(windowMs) ||
    !Number.isInteger(strideMs) ||
    windowMs <= 0 ||
    strideMs <= 0 ||
    strideMs > windowMs
  ) {
    throw new Error("评分窗口和步长必须为正整数，且步长不得大于窗口。");
  }

  const ranges = [];
  for (let startMs = 0; startMs < durationMs; startMs += strideMs) {
    const endMs = Math.min(durationMs, startMs + windowMs);
    ranges.push({ startMs, endMs });
    if (endMs === durationMs) break;
  }
  return ranges;
}

export function prepareScoringAudit({
  transcript,
  sourceVideo,
  sourceTranscript,
  fingerprint,
  output = {
    width: 1080,
    height: 1920,
    fps: 30,
    platforms: ["douyin", "xiaohongshu"],
  },
  windowMs = DEFAULT_WINDOW_MS,
  strideMs = DEFAULT_STRIDE_MS,
}) {
  if (transcript.schemaVersion !== 1 || !Array.isArray(transcript.utterances)) {
    throw new Error("逐字稿必须使用 schemaVersion 1 并包含 utterances。");
  }
  const ranges = createCoverageRanges(transcript.durationMs, windowMs, strideMs);
  const intervals = ranges.map(({ startMs, endMs }, index) => {
    const utterances = transcript.utterances.filter(
      (utterance) =>
        utterance.endMs > startMs && utterance.startMs < endMs,
    );
    return {
      id: `interval-${String(index + 1).padStart(3, "0")}`,
      startMs,
      endMs,
      durationMs: endMs - startMs,
      utteranceIndexes: utterances.map(({ index: utteranceIndex }, fallback) =>
        Number.isInteger(utteranceIndex) ? utteranceIndex : fallback,
      ),
      utterances,
      transcriptText: utterances.map(({ text }) => text).join(""),
      topicKey: null,
      workingTitle: null,
      corePoint: null,
      scores: null,
      evidence: [],
      rejectionReasons: [],
      warnings: [],
    };
  });

  return {
    schemaVersion: 1,
    workflow: "clip-extraction-scoring-audit",
    status: "pending-scoring",
    sourceVideo: {
      sourcePath: sourceVideo,
      fingerprint,
      durationMs: transcript.durationMs,
    },
    sourceTranscript,
    output,
    scoringPolicy: {
      dimensions: SCORE_DIMENSIONS,
      threshold: SCORE_THRESHOLD_EXCLUSIVE,
      thresholdOperator: ">",
      windowMs,
      strideMs,
      fullTimelineCoverageRequired: true,
      preserveAllScoredIntervals: true,
      candidateLimit: null,
      overlapDedupeRatio: 0.5,
      semanticDedupeField: "topicKey",
    },
    coverage: calculateCoverage(intervals, transcript.durationMs),
    intervals,
  };
}

export function buildCandidateReport({ audit }) {
  if (
    audit.schemaVersion !== 1 ||
    audit.workflow !== "clip-extraction-scoring-audit"
  ) {
    throw new Error("评分审计数据格式不正确。");
  }
  if (audit.status !== "scored") {
    throw new Error("全时间轴评分尚未完成。");
  }
  if (!Array.isArray(audit.intervals) || audit.intervals.length === 0) {
    throw new Error("评分审计中没有任何时间区间。");
  }

  const sourceDurationMs = audit.sourceVideo?.durationMs;
  const coverage = calculateCoverage(audit.intervals, sourceDurationMs);
  if (coverage.coveragePercent !== 100 || coverage.gaps.length > 0) {
    throw new Error("评分区间没有覆盖完整原片时间轴。");
  }

  const ids = new Set();
  const evaluated = audit.intervals.map((interval) => {
    if (!interval.id || ids.has(interval.id)) {
      throw new Error("每个评分区间必须有唯一 ID。");
    }
    ids.add(interval.id);
    validateScoredInterval(interval, sourceDurationMs);
    const totalScore = Object.keys(SCORE_DIMENSIONS).reduce(
      (sum, key) => sum + interval.scores[key],
      0,
    );
    const rejectionReasons = [];
    const durationMs = interval.endMs - interval.startMs;
    if (totalScore <= SCORE_THRESHOLD_EXCLUSIVE) {
      if (interval.rejectionReasons.length === 0) {
        throw new Error(
          `${interval.id} 未达到保留线，但没有填写具体淘汰原因。`,
        );
      }
      rejectionReasons.push(...interval.rejectionReasons);
      rejectionReasons.push(
        `总分 ${totalScore} 未严格高于 ${SCORE_THRESHOLD_EXCLUSIVE}`,
      );
    }
    if (durationMs < 30000 || durationMs > 90000) {
      rejectionReasons.push("区间时长不在 30 至 90 秒可发布范围内");
    }
    return {
      ...interval,
      durationMs,
      totalScore,
      selectionStatus:
        rejectionReasons.length === 0 ? "eligible" : "rejected",
      rejectionReasons: uniqueStrings(rejectionReasons),
      duplicateOf: null,
      rank: null,
    };
  });

  const rankedPool = evaluated
    .filter(({ selectionStatus }) => selectionStatus === "eligible")
    .sort(compareCandidates);
  const selected = [];
  for (const interval of rankedPool) {
    const sameTopic = selected.find(
      (kept) => normalizeTopicKey(kept.topicKey) === normalizeTopicKey(interval.topicKey),
    );
    if (sameTopic) {
      rejectDuplicate(interval, sameTopic, "与更高分区间主题重复");
      continue;
    }
    const overlapping = selected.find(
      (kept) => overlapRatio(kept, interval) >= 0.5,
    );
    if (overlapping) {
      rejectDuplicate(interval, overlapping, "与更高分区间重叠达到 50%");
      continue;
    }
    selected.push(interval);
  }

  selected.forEach((interval, index) => {
    interval.selectionStatus = "selected";
    interval.rank = index + 1;
  });

  const candidates = selected.map((interval, index) => ({
    id: `clip-${String(index + 1).padStart(3, "0")}`,
    auditIntervalId: interval.id,
    startMs: interval.startMs,
    endMs: interval.endMs,
    durationMs: interval.durationMs,
    workingTitle: interval.workingTitle,
    corePoint: interval.corePoint,
    topicKey: interval.topicKey,
    scores: interval.scores,
    totalScore: interval.totalScore,
    rank: interval.rank,
    evidence: interval.evidence,
    warnings: interval.warnings,
    reviewStatus: "pending",
    sourceRange: {
      startMs: interval.startMs,
      endMs: interval.endMs,
      continuous: true,
    },
    verbatimTranscript: interval.transcriptText,
    utterances: interval.utterances ?? [],
    nearbyContext: { before: "", after: "" },
    overlapWith: [],
  }));

  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const ratio = overlapRatio(candidates[left], candidates[right]);
      if (ratio > 0) {
        candidates[left].overlapWith.push({ id: candidates[right].id, ratio });
        candidates[right].overlapWith.push({ id: candidates[left].id, ratio });
      }
    }
  }

  return {
    schemaVersion: 2,
    workflow: "clip-extraction",
    status: "pending-selection",
    sourceVideo: audit.sourceVideo,
    sourceTranscript: audit.sourceTranscript,
    output: audit.output,
    policy: {
      continuousSourceRangeOnly: true,
      masterAudioOnly: true,
      cloudAsrAllowed: false,
      approvalRequiredBeforeApply: true,
      fullTimelineCoverageRequired: true,
      preserveAllScoredIntervals: true,
      scoreThresholdExclusive: SCORE_THRESHOLD_EXCLUSIVE,
      candidateLimit: null,
      dedupeBeforeReview: true,
    },
    coverage,
    summary: {
      totalScoredIntervals: evaluated.length,
      aboveThreshold: evaluated.filter(
        ({ totalScore }) => totalScore > SCORE_THRESHOLD_EXCLUSIVE,
      ).length,
      selectedAfterDedupe: candidates.length,
      rejectedIntervals: evaluated.filter(
        ({ selectionStatus }) => selectionStatus === "rejected",
      ).length,
    },
    scoredIntervals: evaluated.sort((left, right) => left.startMs - right.startMs),
    candidates,
  };
}

export function applyScoringDecisions(audit, decisions, scoredAt = new Date().toISOString()) {
  if (
    audit.schemaVersion !== 1 ||
    audit.workflow !== "clip-extraction-scoring-audit" ||
    audit.status !== "pending-scoring"
  ) {
    throw new Error("只能为待评分的全时间轴审计应用评分决定。");
  }
  if (
    decisions?.schemaVersion !== 1 ||
    decisions?.workflow !== "clip-extraction-scoring-decisions" ||
    !Array.isArray(decisions.intervals)
  ) {
    throw new Error("评分决定数据格式不正确。");
  }
  const decisionsById = new Map();
  for (const decision of decisions.intervals) {
    if (!decision.id || decisionsById.has(decision.id)) {
      throw new Error("评分决定中的区间 ID 必须唯一。");
    }
    decisionsById.set(decision.id, decision);
  }

  const next = structuredClone(audit);
  next.intervals = next.intervals.map((interval) => {
    const decision = decisionsById.get(interval.id);
    if (!decision) throw new Error(`${interval.id} 缺少评分决定。`);
    decisionsById.delete(interval.id);
    return {
      ...interval,
      topicKey: decision.topicKey,
      workingTitle: decision.workingTitle,
      corePoint: decision.corePoint,
      scores: decision.scores,
      evidence: decision.evidence,
      rejectionReasons: decision.rejectionReasons ?? [],
      warnings: decision.warnings ?? [],
    };
  });
  if (decisionsById.size > 0) {
    throw new Error(
      `评分决定包含未知区间：${[...decisionsById.keys()].join(", ")}`,
    );
  }
  for (const interval of next.intervals) {
    validateScoredInterval(interval, next.sourceVideo.durationMs);
  }
  next.status = "scored";
  next.scoredAt = scoredAt;
  next.scoringDecisionSource = decisions.sourcePath ?? null;
  return next;
}

export function buildScoringAuditMarkdown(report) {
  const lines = [
    `# ${report.sourceVideo.sourcePath.split("/").at(-1)} 全时间轴评分审计`,
    "",
    "## 审计结果",
    "",
    `- 原片时长：${formatTime(report.coverage.sourceDurationMs)}`,
    `- 时间轴覆盖率：${report.coverage.coveragePercent}%`,
    `- 已评分区间：${report.summary.totalScoredIntervals}`,
    `- 严格大于 85 分：${report.summary.aboveThreshold}`,
    `- 排序去重后候选：${report.summary.selectedAfterDedupe}`,
    `- 淘汰区间：${report.summary.rejectedIntervals}`,
    "",
    "## 排序去重后候选",
    "",
    "| 排名 | 候选 | 评分区间 | 原片时间 | 总分 | 主题 |",
    "| ---: | --- | --- | --- | ---: | --- |",
  ];
  for (const candidate of report.candidates) {
    lines.push(
      `| ${candidate.rank} | ${candidate.id} | ${candidate.auditIntervalId} | ${formatRange(candidate)} | ${candidate.totalScore} | ${escapeMarkdown(candidate.workingTitle)} |`,
    );
  }
  if (report.candidates.length === 0) {
    lines.push("| - | - | - | - | - | 没有严格大于 85 且去重后保留的候选 | ");
  }

  lines.push(
    "",
    "## 全部已评分区间",
    "",
    "| 区间 | 原片时间 | 总分 | 去向 | 工作标题 | 淘汰原因 |",
    "| --- | --- | ---: | --- | --- | --- |",
  );
  for (const interval of report.scoredIntervals) {
    const outcome =
      interval.selectionStatus === "selected"
        ? `入选（第 ${interval.rank} 名）`
        : interval.duplicateOf
          ? `去重淘汰（保留 ${interval.duplicateOf}）`
          : "评分淘汰";
    lines.push(
      `| ${interval.id} | ${formatRange(interval)} | ${interval.totalScore} | ${outcome} | ${escapeMarkdown(interval.workingTitle)} | ${escapeMarkdown(interval.rejectionReasons.join("；") || "-")} |`,
    );
  }
  lines.push(
    "",
    "> 完整原话、六维分数、证据、风险和 duplicateOf 保存在同名 JSON 候选报告中。",
    "",
  );
  return lines.join("\n");
}

export function overlapRatio(left, right) {
  const overlap = Math.max(
    0,
    Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs),
  );
  const shorter = Math.min(
    left.endMs - left.startMs,
    right.endMs - right.startMs,
  );
  return shorter > 0 ? Math.round((overlap / shorter) * 1000) / 1000 : 0;
}

export function calculateCoverage(intervals, sourceDurationMs) {
  if (!Number.isInteger(sourceDurationMs) || sourceDurationMs <= 0) {
    throw new Error("评分审计缺少有效原片时长。");
  }
  const ranges = [...intervals]
    .map(({ startMs, endMs }) => ({ startMs, endMs }))
    .sort((left, right) => left.startMs - right.startMs);
  const gaps = [];
  let cursor = 0;
  let coveredMs = 0;
  for (const range of ranges) {
    if (
      !Number.isInteger(range.startMs) ||
      !Number.isInteger(range.endMs) ||
      range.startMs < 0 ||
      range.endMs <= range.startMs ||
      range.endMs > sourceDurationMs
    ) {
      throw new Error("评分审计包含无效时间区间。");
    }
    if (range.startMs > cursor) {
      gaps.push({ startMs: cursor, endMs: range.startMs });
    }
    if (range.endMs > cursor) {
      coveredMs += range.endMs - Math.max(cursor, range.startMs);
      cursor = range.endMs;
    }
  }
  if (cursor < sourceDurationMs) gaps.push({ startMs: cursor, endMs: sourceDurationMs });
  return {
    sourceDurationMs,
    coveredMs,
    coveragePercent: Math.round((coveredMs / sourceDurationMs) * 10000) / 100,
    gaps,
    intervalCount: intervals.length,
  };
}

function validateScoredInterval(interval, sourceDurationMs) {
  if (
    !Number.isInteger(interval.startMs) ||
    !Number.isInteger(interval.endMs) ||
    interval.startMs < 0 ||
    interval.endMs <= interval.startMs ||
    interval.endMs > sourceDurationMs
  ) {
    throw new Error(`${interval.id} 的评分区间无效。`);
  }
  if (!interval.topicKey || !interval.workingTitle || !interval.corePoint) {
    throw new Error(`${interval.id} 缺少主题键、工作标题或核心观点。`);
  }
  if (!Array.isArray(interval.evidence) || interval.evidence.length === 0) {
    throw new Error(`${interval.id} 缺少评分证据。`);
  }
  if (!Array.isArray(interval.rejectionReasons) || !Array.isArray(interval.warnings)) {
    throw new Error(`${interval.id} 的淘汰理由或风险字段无效。`);
  }
  for (const [key, maximum] of Object.entries(SCORE_DIMENSIONS)) {
    const score = interval.scores?.[key];
    if (!Number.isInteger(score) || score < 0 || score > maximum) {
      throw new Error(`${interval.id} 缺少有效评分 ${key}。`);
    }
  }
}

function compareCandidates(left, right) {
  return (
    right.totalScore - left.totalScore ||
    right.scores.openingStrength - left.scores.openingStrength ||
    left.startMs - right.startMs
  );
}

function rejectDuplicate(interval, kept, reason) {
  interval.selectionStatus = "rejected";
  interval.duplicateOf = kept.id;
  interval.rejectionReasons = uniqueStrings([
    ...interval.rejectionReasons,
    `${reason}，保留 ${kept.id}`,
  ]);
}

function normalizeTopicKey(value) {
  return String(value).normalize("NFC").trim().toLocaleLowerCase("zh-CN");
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

async function main() {
  const action = process.argv[2];
  const args = parseArgs(process.argv.slice(3));
  if (action === "prepare") {
    const transcriptPath = resolve(process.cwd(), args.transcript);
    const sourceVideoPath = resolve(process.cwd(), args.sourceVideo);
    const [transcript, sourceStat] = await Promise.all([
      readFile(transcriptPath, "utf8").then(JSON.parse),
      stat(sourceVideoPath),
    ]);
    const audit = prepareScoringAudit({
      transcript,
      sourceVideo: toRepoPath(sourceVideoPath),
      sourceTranscript: toRepoPath(transcriptPath),
      fingerprint: {
        size: sourceStat.size,
        mtimeMs: Math.round(sourceStat.mtimeMs),
      },
      windowMs: args.windowMs,
      strideMs: args.strideMs,
    });
    await writeJson(resolve(process.cwd(), args.output), audit);
    console.log(`全时间轴评分审计：${args.output}`);
    console.log(`待评分区间：${audit.intervals.length}`);
    console.log(`覆盖率：${audit.coverage.coveragePercent}%`);
    return;
  }
  if (action === "build") {
    const audit = JSON.parse(
      await readFile(resolve(process.cwd(), args.audit), "utf8"),
    );
    const report = buildCandidateReport({ audit });
    await writeJson(resolve(process.cwd(), args.output), report);
    if (args.reviewOutput) {
      await writeFile(
        resolve(process.cwd(), args.reviewOutput),
        buildScoringAuditMarkdown(report),
        "utf8",
      );
    }
    console.log(`候选报告：${args.output}`);
    console.log(`已评分区间：${report.summary.totalScoredIntervals}`);
    console.log(`严格高于 85 分：${report.summary.aboveThreshold}`);
    console.log(`排序去重后候选：${report.candidates.length}`);
    if (args.reviewOutput) console.log(`可读审计稿：${args.reviewOutput}`);
    return;
  }
  if (action === "score") {
    const [audit, decisions] = await Promise.all([
      readFile(resolve(process.cwd(), args.audit), "utf8").then(JSON.parse),
      readFile(resolve(process.cwd(), args.decisions), "utf8").then(JSON.parse),
    ]);
    decisions.sourcePath = toRepoPath(resolve(process.cwd(), args.decisions));
    const scored = applyScoringDecisions(audit, decisions);
    await writeJson(resolve(process.cwd(), args.output), scored);
    console.log(`已评分全时间轴审计：${args.output}`);
    console.log(`已评分区间：${scored.intervals.length}`);
    return;
  }
  throw new Error("用法：prepare、score 或 build。");
}

function parseArgs(argv) {
  const result = {
    transcript: null,
    sourceVideo: null,
    audit: null,
    decisions: null,
    output: null,
    reviewOutput: null,
    windowMs: DEFAULT_WINDOW_MS,
    strideMs: DEFAULT_STRIDE_MS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--transcript") result.transcript = argv[++index];
    else if (arg === "--source-video") result.sourceVideo = argv[++index];
    else if (arg === "--audit") result.audit = argv[++index];
    else if (arg === "--decisions") result.decisions = argv[++index];
    else if (arg === "--output") result.output = argv[++index];
    else if (arg === "--review-output") result.reviewOutput = argv[++index];
    else if (arg === "--window-ms") result.windowMs = Number(argv[++index]);
    else if (arg === "--stride-ms") result.strideMs = Number(argv[++index]);
    else throw new Error(`未知参数：${arg}`);
  }
  const action = process.argv[2];
  if (action === "prepare" && (!result.transcript || !result.sourceVideo || !result.output)) {
    throw new Error(
      "用法：prepare --transcript <transcript.json> --source-video <video> --output <audit.json>",
    );
  }
  if (action === "build" && (!result.audit || !result.output)) {
    throw new Error("用法：build --audit <scored-audit.json> --output <report.json>");
  }
  if (action === "score" && (!result.audit || !result.decisions || !result.output)) {
    throw new Error(
      "用法：score --audit <pending-audit.json> --decisions <decisions.json> --output <scored-audit.json>",
    );
  }
  return result;
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function toRepoPath(path) {
  return relative(REPO_ROOT, path).split(sep).join("/");
}

function formatRange({ startMs, endMs }) {
  return `${formatTime(startMs)}-${formatTime(endMs)}`;
}

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function escapeMarkdown(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await main();
}
