import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLivestreamFinalOutputPlan,
  updateLivestreamVisualReview,
} from "./livestream-visual-review.mjs";

const fixture = () => ({
  schemaVersion: 1,
  id: "test-live",
  clips: [
    {
      id: "test-live-clip-001",
      qa: {
        stillRendered: false,
        previewApproved: false,
        readyToRender: false,
      },
    },
  ],
});

test("代表性检查图只更新 stillRendered 门禁", () => {
  const updated = updateLivestreamVisualReview(fixture(), "mark-stills");
  assert.equal(updated.clips[0].qa.stillRendered, true);
  assert.equal(updated.clips[0].qa.previewApproved, false);
  assert.equal(updated.clips[0].qa.readyToRender, false);
});

test("未生成检查图时拒绝确认最终视觉", () => {
  assert.throws(
    () => updateLivestreamVisualReview(fixture(), "confirm-studio"),
    /检查图/,
  );
});

test("明确 Studio 确认后才解锁成片渲染", () => {
  const withStills = updateLivestreamVisualReview(fixture(), "mark-stills");
  const updated = updateLivestreamVisualReview(
    withStills,
    "confirm-studio",
    "2026-07-18T00:00:00.000Z",
  );
  assert.equal(updated.clips[0].qa.previewApproved, true);
  assert.equal(updated.clips[0].qa.readyToRender, true);
});

test("已确认内容标题只用于最终文件名", () => {
  const outputs = buildLivestreamFinalOutputPlan(fixture(), {
    schemaVersion: 1,
    workflow: "livestream-content-title-review",
    id: "test-live",
    status: "approved",
    approvedAt: "2026-07-18T00:00:00.000Z",
    titles: [
      {
        clipId: "clip-001",
        contentTitle: "内容没人看的最根本原因",
        formulaSkill: "dbs-xhs-title",
        formulaId: 14,
      },
    ],
  });
  assert.equal(outputs[0].outputFilename, "内容没人看的最根本原因.mp4");
  assert.equal("contentTitle" in outputs[0].clip, false);
});

test("未确认或不完整的最终标题不得用于渲染", () => {
  assert.throws(
    () =>
      buildLivestreamFinalOutputPlan(fixture(), {
        schemaVersion: 1,
        workflow: "livestream-content-title-review",
        id: "test-live",
        status: "pending",
        approvedAt: null,
        titles: [],
      }),
    /尚未明确确认/,
  );
  assert.throws(
    () =>
      buildLivestreamFinalOutputPlan(fixture(), {
        schemaVersion: 1,
        workflow: "livestream-content-title-review",
        id: "test-live",
        status: "approved",
        approvedAt: "2026-07-18T00:00:00.000Z",
        titles: [],
      }),
    /缺少已确认/,
  );
});

test("最终标题拒绝非法文件名字符和重名", () => {
  const batch = {
    ...fixture(),
    clips: [
      fixture().clips[0],
      { ...fixture().clips[0], id: "test-live-clip-002" },
    ],
  };
  const base = {
    schemaVersion: 1,
    workflow: "livestream-content-title-review",
    id: "test-live",
    status: "approved",
    approvedAt: "2026-07-18T00:00:00.000Z",
  };
  assert.throws(
    () =>
      buildLivestreamFinalOutputPlan(batch, {
        ...base,
        titles: [
          {
            clipId: "clip-001",
            contentTitle: "错误/标题",
            formulaSkill: "dbs-xhs-title",
            formulaId: 1,
          },
          {
            clipId: "clip-002",
            contentTitle: "正常标题",
            formulaSkill: "dbs-xhs-title",
            formulaId: 2,
          },
        ],
      }),
    /不可用于文件名/,
  );
  assert.throws(
    () =>
      buildLivestreamFinalOutputPlan(batch, {
        ...base,
        titles: [
          {
            clipId: "clip-001",
            contentTitle: "同一标题",
            formulaSkill: "dbs-xhs-title",
            formulaId: 1,
          },
          {
            clipId: "clip-002",
            contentTitle: "同一标题",
            formulaSkill: "dbs-xhs-title",
            formulaId: 2,
          },
        ],
      }),
    /重名/,
  );
});

test("最终标题必须记录项目标题 Skill 公式", () => {
  assert.throws(
    () =>
      buildLivestreamFinalOutputPlan(fixture(), {
        schemaVersion: 1,
        workflow: "livestream-content-title-review",
        id: "test-live",
        status: "approved",
        approvedAt: "2026-07-18T00:00:00.000Z",
        titles: [
          {
            clipId: "clip-001",
            contentTitle: "一个没有公式的标题",
          },
        ],
      }),
    /dbs-xhs-title/,
  );
});
