import assert from "node:assert/strict";
import test from "node:test";
import { buildLivestreamVideoData } from "./build-livestream-video-data.mjs";

test("最终切片配置不携带候选审核元数据", () => {
  const plan = {
    schemaVersion: 1,
    workflow: "clip-extraction-review",
    id: "test-live",
    preview: { status: "approved" },
    timeline: { status: "locked" },
    candidates: [
      {
        id: "clip-001",
        title: "不应进入成片",
        totalScore: 91,
        reviewStatus: "approved",
        durationMs: 55000,
        timeline: { status: "locked", durationMs: 55000 },
        outputs: {
          masterVideo: "工作区/派生媒体/master.mp4",
          masterAsset: "generated/master.mp4",
        },
      },
    ],
  };
  const [data] = buildLivestreamVideoData({
    plan,
    reviewedTranscripts: {
      "clip-001": {
        sourcePath: "工作区/数据/reviewed.json",
        asset: "generated/reviewed.json",
      },
    },
  });
  const serialized = JSON.stringify(data);
  assert.equal(serialized.includes("不应进入成片"), false);
  assert.equal("title" in data, false);
  assert.equal("reviewStatus" in data, false);
  assert.equal("totalScore" in data, false);
  assert.equal("sourceStartMs" in data, false);
  assert.equal(data.presentation.objectFit, "cover");
  assert.equal(data.qa.cropToFill, true);
  assert.equal(data.qa.privacyMaskRequired, false);
  assert.equal(data.qa.previewApproved, false);
  assert.equal(data.qa.readyToRender, false);
  assert.equal(data.durationMs, 55000);
  assert.equal(data.timelinePolicy.sourceRangeContinuous, true);
});
