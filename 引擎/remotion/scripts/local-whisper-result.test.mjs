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

test("将接近源音频结尾的字幕裁切到有效时长", () => {
  const result = normalizeWhisperCaptions({
    captions: [{ text: "最后一句", startMs: 28880, endMs: 30880 }],
    model: "small",
    source: "sample.wav",
    whisperCppVersion: "1.5.5",
    maxEndMs: 30000,
  });

  assert.equal(result.captions[0].endMs, 30000);
  assert.equal(result.durationMs, 30000);
  assert.throws(
    () =>
      normalizeWhisperCaptions({
        captions: [{ text: "异常", startMs: 28880, endMs: 31001 }],
        model: "small",
        source: "sample.wav",
        whisperCppVersion: "1.5.5",
        maxEndMs: 30000,
      }),
    /超出源音频允许范围/u,
  );
});

test("在校验时间码前忽略 Whisper 的静音占位符", () => {
  const result = normalizeWhisperCaptions({
    captions: [
      { text: "有效字幕", startMs: 0, endMs: 1000 },
      { text: " [BLANK_AUDIO]", startMs: 22400, endMs: 32400 },
    ],
    model: "tiny",
    source: "sample.wav",
    whisperCppVersion: "1.5.5",
    maxEndMs: 30000,
  });

  assert.deepEqual(result.captions, [
    {
      text: "有效字幕",
      startMs: 0,
      endMs: 1000,
      timestampMs: null,
      confidence: null,
    },
  ]);
});

test("预检允许没有真实字幕的静音样本", () => {
  const result = normalizeWhisperCaptions({
    captions: [{ text: "[BLANK_AUDIO]", startMs: 0, endMs: 10000 }],
    model: "tiny",
    source: "sample.wav",
    whisperCppVersion: "1.5.5",
    allowEmpty: true,
  });

  assert.equal(result.durationMs, 0);
  assert.deepEqual(result.captions, []);
});
