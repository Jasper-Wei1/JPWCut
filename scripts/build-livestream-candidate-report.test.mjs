import assert from "node:assert/strict";
import test from "node:test";
import {
  applyScoringDecisions,
  buildCandidateReport,
  buildScoringAuditMarkdown,
  createCoverageRanges,
  overlapRatio,
  prepareScoringAudit,
} from "./build-livestream-candidate-report.mjs";

const transcript = {
  schemaVersion: 1,
  durationMs: 210000,
  utterances: [
    { index: 0, startMs: 0, endMs: 70000, text: "第一段" },
    { index: 1, startMs: 70000, endMs: 140000, text: "第二段" },
    { index: 2, startMs: 140000, endMs: 210000, text: "第三段" },
  ],
};

const scores = (total) => ({
  standaloneCompleteness: Math.min(30, total),
  informationValue: Math.min(20, Math.max(0, total - 30)),
  openingStrength: Math.min(20, Math.max(0, total - 50)),
  expressionStrength: Math.min(10, Math.max(0, total - 70)),
  editability: Math.min(10, Math.max(0, total - 80)),
  platformFit: Math.min(10, Math.max(0, total - 90)),
});

const scoredInterval = ({
  id,
  startMs,
  endMs,
  total,
  topicKey,
  rejectionReasons = [],
}) => ({
  id,
  startMs,
  endMs,
  durationMs: endMs - startMs,
  utteranceIndexes: [],
  transcriptText: `${id}原话`,
  topicKey,
  workingTitle: `${id}标题`,
  corePoint: `${id}核心观点`,
  scores: scores(total),
  evidence: [`${id}评分证据`],
  rejectionReasons,
  warnings: [],
});

const auditFixture = (intervals, durationMs = 210000) => ({
  schemaVersion: 1,
  workflow: "clip-extraction-scoring-audit",
  status: "scored",
  sourceVideo: {
    sourcePath: "输入/直播.mp4",
    fingerprint: { size: 10, mtimeMs: 20 },
    durationMs,
  },
  sourceTranscript: "工作区/逐字稿.json",
  output: { width: 1080, height: 1920, fps: 30, platforms: ["douyin"] },
  scoringPolicy: {},
  intervals,
});

test("生成覆盖完整时间轴的重叠评分窗口", () => {
  assert.deepEqual(createCoverageRanges(210000, 90000, 60000), [
    { startMs: 0, endMs: 90000 },
    { startMs: 60000, endMs: 150000 },
    { startMs: 120000, endMs: 210000 },
  ]);
  const audit = prepareScoringAudit({
    transcript,
    sourceVideo: "输入/直播.mp4",
    sourceTranscript: "工作区/逐字稿.json",
    fingerprint: { size: 10, mtimeMs: 20 },
  });
  assert.equal(audit.coverage.coveragePercent, 100);
  assert.equal(audit.intervals.length, 3);
  assert.equal(audit.status, "pending-scoring");
});

test("评分决定必须与全部覆盖区间一一对应", () => {
  const pending = prepareScoringAudit({
    transcript,
    sourceVideo: "输入/直播.mp4",
    sourceTranscript: "工作区/逐字稿.json",
    fingerprint: { size: 10, mtimeMs: 20 },
  });
  const decisions = {
    schemaVersion: 1,
    workflow: "clip-extraction-scoring-decisions",
    intervals: pending.intervals.map((interval, index) => ({
      ...scoredInterval({
        id: interval.id,
        startMs: interval.startMs,
        endMs: interval.endMs,
        total: 80,
        topicKey: `topic-${index}`,
        rejectionReasons: ["内容不够完整"],
      }),
    })),
  };
  const scored = applyScoringDecisions(
    pending,
    decisions,
    "2026-07-18T00:00:00.000Z",
  );
  assert.equal(scored.status, "scored");
  assert.equal(scored.intervals.length, pending.intervals.length);
  assert.throws(
    () =>
      applyScoringDecisions(pending, {
        ...decisions,
        intervals: decisions.intervals.slice(1),
      }),
    /缺少评分决定/,
  );
});

test("保存所有评分区间并严格保留大于 85 分的候选", () => {
  const report = buildCandidateReport({
    audit: auditFixture([
      scoredInterval({
        id: "interval-001",
        startMs: 0,
        endMs: 70000,
        total: 85,
        topicKey: "topic-a",
        rejectionReasons: ["开头较弱"],
      }),
      scoredInterval({
        id: "interval-002",
        startMs: 70000,
        endMs: 140000,
        total: 86,
        topicKey: "topic-b",
      }),
      scoredInterval({
        id: "interval-003",
        startMs: 140000,
        endMs: 210000,
        total: 92,
        topicKey: "topic-c",
      }),
    ]),
  });
  assert.equal(report.coverage.coveragePercent, 100);
  assert.equal(report.scoredIntervals.length, 3);
  assert.equal(report.candidates.length, 2);
  assert.deepEqual(
    report.candidates.map(({ totalScore }) => totalScore),
    [92, 86],
  );
  assert.match(report.scoredIntervals[0].rejectionReasons.join(" "), /未严格高于 85/);
  assert.equal(report.policy.candidateLimit, null);
  const markdown = buildScoringAuditMarkdown(report);
  assert.match(markdown, /排序去重后候选/);
  assert.match(markdown, /总分 85 未严格高于 85/);
});

test("按分数排序后去除重复主题和高重叠区间", () => {
  const report = buildCandidateReport({
    audit: auditFixture([
      scoredInterval({
        id: "interval-001",
        startMs: 0,
        endMs: 90000,
        total: 96,
        topicKey: "same-topic",
      }),
      scoredInterval({
        id: "interval-002",
        startMs: 60000,
        endMs: 150000,
        total: 92,
        topicKey: "same-topic",
      }),
      scoredInterval({
        id: "interval-003",
        startMs: 120000,
        endMs: 210000,
        total: 90,
        topicKey: "other-topic",
      }),
    ]),
  });
  assert.deepEqual(
    report.candidates.map(({ auditIntervalId }) => auditIntervalId),
    ["interval-001", "interval-003"],
  );
  const duplicate = report.scoredIntervals.find(({ id }) => id === "interval-002");
  assert.equal(duplicate.selectionStatus, "rejected");
  assert.equal(duplicate.duplicateOf, "interval-001");
  assert.match(duplicate.rejectionReasons.join(" "), /主题重复/);
});

test("拒绝时间轴有空档或尚未全部评分的审计", () => {
  const missingCoverage = auditFixture([
    scoredInterval({
      id: "interval-001",
      startMs: 0,
      endMs: 90000,
      total: 90,
      topicKey: "topic-a",
    }),
    scoredInterval({
      id: "interval-002",
      startMs: 120000,
      endMs: 210000,
      total: 90,
      topicKey: "topic-b",
    }),
  ]);
  assert.throws(
    () => buildCandidateReport({ audit: missingCoverage }),
    /没有覆盖完整/,
  );
  assert.throws(
    () =>
      buildCandidateReport({
        audit: { ...missingCoverage, status: "pending-scoring" },
      }),
    /尚未完成/,
  );
});

test("计算两个候选占较短区间的重叠比例", () => {
  assert.equal(
    overlapRatio(
      { startMs: 0, endMs: 60000 },
      { startMs: 30000, endMs: 70000 },
    ),
    0.75,
  );
});
