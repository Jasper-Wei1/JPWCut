import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClipReviewPlan,
  remapTranscriptToRange,
  reviewClipPlan,
} from "./livestream-clip-review.mjs";

const candidate = (id, startMs, endMs) => ({
  id,
  workingTitle: `候选 ${id}`,
  corePoint: `核心 ${id}`,
  startMs,
  endMs,
  totalScore: 90,
});

const report = {
  schemaVersion: 2,
  workflow: "clip-extraction",
  sourceVideo: {
    sourcePath: "输入/直播.mp4",
    durationMs: 180000,
    fingerprint: { size: 10, mtimeMs: 20 },
  },
  candidates: [
    candidate("clip-001", 10000, 50000),
    candidate("clip-002", 80000, 120000),
  ],
};

const createPlan = () =>
  buildClipReviewPlan({
    report,
    selectedIds: ["clip-001", "clip-002"],
    asset: "generated/livestream-clips/test/source.mp4",
    media: { width: 1080, height: 1920, fps: 60, hasAudio: true },
    id: "test",
    createdAt: "2026-07-18T00:00:00.000Z",
  });

test("把多个独立连续源区间排成 Studio 审核时间轴", () => {
  const plan = createPlan();
  assert.equal(plan.candidates[0].timelineStartMs, 0);
  assert.equal(plan.candidates[0].timelineEndMs, 40000);
  assert.equal(plan.candidates[1].timelineStartMs, 40000);
  assert.equal(plan.candidates[1].timelineEndMs, 80000);
  assert.equal(plan.preview.durationMs, 80000);
  assert.equal(plan.preview.status, "pending");
});

test("Studio 确认前拒绝留下待审核候选", () => {
  const plan = createPlan();
  assert.throws(
    () => reviewClipPlan(plan, { approve: ["clip-001"], confirmStudio: true }),
    /clip-002/,
  );
});

test("调整边界后重置为待审核并重建时间轴", () => {
  const plan = createPlan();
  reviewClipPlan(plan, {
    approve: ["clip-001"],
    adjustments: [
      { id: "clip-001", startMs: 12000, endMs: 52000, note: "改起点" },
    ],
  });
  assert.equal(plan.candidates[0].reviewStatus, "pending");
  assert.equal(plan.candidates[0].sourceStartMs, 12000);
  assert.equal(plan.candidates[0].boundaryNote, "改起点");
});

test("全部候选明确处理后才能通过 Studio 门禁", () => {
  const plan = createPlan();
  reviewClipPlan(plan, {
    approve: ["clip-001"],
    reject: ["clip-002"],
    confirmStudio: true,
  });
  assert.equal(plan.preview.status, "approved");
  assert.ok(plan.preview.approvedAt);
});

test("从原始 Whisper 时间轴映射单个连续切片逐字稿", () => {
  const transcript = {
    source: "输入/直播.mp4",
    durationMs: 120000,
    utterances: [
      { index: 0, text: "区间外", startMs: 0, endMs: 9000 },
      { index: 1, text: "候选内容", startMs: 10000, endMs: 30000 },
    ],
    tokens: [
      {
        text: "候选",
        startMs: 10000,
        endMs: 20000,
        utteranceIndex: 1,
        tokenIndex: 0,
      },
    ],
    characters: [],
    captions: [{ text: "候选内容", startMs: 10000, endMs: 30000 }],
    warnings: [],
  };
  const mapped = remapTranscriptToRange(
    transcript,
    { sourceStartMs: 10000, sourceEndMs: 50000 },
    "工作区/派生媒体/master.mp4",
  );
  assert.equal(mapped.durationMs, 40000);
  assert.equal(mapped.utterances.length, 1);
  assert.equal(mapped.utterances[0].startMs, 0);
  assert.equal(mapped.tokens[0].utteranceIndex, 0);
  assert.equal(mapped.clipExtraction.continuousSourceRange, true);
  assert.deepEqual(mapped.clipExtraction.playbackSegments, [
    {
      type: "body",
      sourceStartMs: 10000,
      sourceEndMs: 50000,
      timelineStartMs: 0,
    },
  ]);
});
