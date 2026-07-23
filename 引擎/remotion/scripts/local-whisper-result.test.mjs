import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWhisperCaptions } from "./lib/local-whisper-result.mjs";

test("把本地 Whisper 字幕标准化为项目逐字稿结构", () => {
  const result = normalizeWhisperCaptions({
    captions: [
      { text: "把直播录像", startMs: 0, endMs: 800, confidence: 0.9 },
      { text: "放进输入目录，", startMs: 820, endMs: 1600, confidence: 0.8 },
      { text: "Agent 会生成时间轴。", startMs: 1700, endMs: 2900 },
    ],
    model: "small",
    source: "example.mp4",
    whisperCppVersion: "1.5.5",
    createdAt: "2026-07-17T00:00:00.000Z",
  });

  assert.equal(result.provider, "local-whisper-cpp");
  assert.equal(result.durationMs, 2900);
  assert.equal(result.utterances.length, 3);
  assert.ok(result.tokens.length > 10);
  assert.equal(result.text, "把直播录像放进输入目录，Agent 会生成时间轴。");
  assert.ok(result.characters.length > result.tokens.length);
});

test("拒绝没有时间戳字幕的 Whisper 空结果", () => {
  assert.throws(
    () =>
      normalizeWhisperCaptions({
        captions: [],
        model: "small",
        source: "empty.wav",
        whisperCppVersion: "1.5.5",
      }),
    /没有返回带时间戳的字幕/u,
  );
});
