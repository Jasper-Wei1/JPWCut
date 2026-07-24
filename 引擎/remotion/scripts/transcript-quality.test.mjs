import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTranscriptQuality,
  createPreflightRanges,
} from "./lib/transcript-quality.mjs";

test("生成开头、中段和结尾各 30 秒的转录预检范围", () => {
  assert.deepEqual(createPreflightRanges(120000), [
    { label: "开头", fileStem: "start", startMs: 0, durationMs: 30000 },
    { label: "中段", fileStem: "middle", startMs: 45000, durationMs: 30000 },
    { label: "结尾", fileStem: "end", startMs: 90000, durationMs: 30000 },
  ]);
});

test("字幕预检拒绝乱码、无效时间码和超长字幕", () => {
  const valid = {
    text: "正常字幕",
    captions: [{ text: "正常字幕", startMs: 0, endMs: 1000 }],
  };
  assert.deepEqual(assertTranscriptQuality(valid, { sourceDurationMs: 30000 }), {
    captionCount: 1,
  });
  assert.deepEqual(
    assertTranscriptQuality(
      { text: "", captions: [] },
      { sourceDurationMs: 30000, allowEmpty: true },
    ),
    { captionCount: 0 },
  );
  assert.throws(
    () =>
      assertTranscriptQuality(
        { ...valid, text: "错误\uFFFD字幕" },
        { sourceDurationMs: 30000 },
      ),
    /U\+FFFD/u,
  );
  assert.throws(
    () =>
      assertTranscriptQuality(
        { ...valid, captions: [{ text: "错误\uFFFD字幕", startMs: 0, endMs: 1000 }] },
        { sourceDurationMs: 30000 },
      ),
    /U\+FFFD/u,
  );
  assert.throws(
    () =>
      assertTranscriptQuality(
        { ...valid, captions: [{ text: "错误", startMs: 0, endMs: 30060 }] },
        { sourceDurationMs: 30000 },
      ),
    /时间码无效/u,
  );
  assert.throws(
    () =>
      assertTranscriptQuality(
        { ...valid, captions: [{ text: "错误", startMs: 0, endMs: 31000 }] },
        { sourceDurationMs: 60000 },
      ),
    /超过 30 秒/u,
  );
});
