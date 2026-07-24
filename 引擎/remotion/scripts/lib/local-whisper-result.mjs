export function normalizeWhisperCaptions({
  captions,
  model,
  source,
  whisperCppVersion,
  maxEndMs = null,
  maxTimestampOverflowMs = 1_000,
  allowEmpty = false,
  createdAt = new Date().toISOString(),
}) {
  const sourceDurationMs = Number.isFinite(maxEndMs)
    ? Math.round(maxEndMs)
    : null;
  const cleaned = captions
    .filter((caption) => String(caption.text ?? "").trim() !== "[BLANK_AUDIO]")
    .map((caption) => {
      const startMs = Math.max(0, Math.round(Number(caption.startMs)));
      const endMs = Math.max(0, Math.round(Number(caption.endMs)));
      if (
        sourceDurationMs !== null &&
        endMs > sourceDurationMs + maxTimestampOverflowMs
      ) {
        throw new Error("Whisper 字幕时间码超出源音频允许范围。");
      }
      return {
        text: String(caption.text ?? "").trim(),
        startMs: Math.min(startMs, sourceDurationMs ?? startMs),
        endMs: Math.min(endMs, sourceDurationMs ?? endMs),
        timestampMs: Number.isFinite(caption.timestampMs)
          ? Math.round(caption.timestampMs)
          : null,
        confidence: Number.isFinite(caption.confidence)
          ? caption.confidence
          : null,
      };
    })
    .filter(
      (caption) =>
        caption.text &&
        Number.isFinite(caption.startMs) &&
        Number.isFinite(caption.endMs) &&
        caption.endMs > caption.startMs,
    );

  if (cleaned.length === 0 && !allowEmpty) {
    throw new Error("Whisper 没有返回带时间戳的字幕。");
  }

  const utterances = [];
  const tokens = [];
  const characters = [];

  cleaned.forEach((caption, utteranceIndex) => {
    utterances.push({
      index: utteranceIndex,
      text: caption.text,
      startMs: caption.startMs,
      endMs: caption.endMs,
    });

    const pieces = tokenize(caption.text);
    const totalWeight = pieces.reduce(
      (sum, piece) => sum + Math.max(Array.from(piece).length, 1),
      0,
    );
    let consumedWeight = 0;
    pieces.forEach((piece, tokenIndex) => {
      const weight = Math.max(Array.from(piece).length, 1);
      const startMs =
        caption.startMs +
        Math.round(
          ((caption.endMs - caption.startMs) * consumedWeight) / totalWeight,
        );
      consumedWeight += weight;
      const endMs =
        caption.startMs +
        Math.round(
          ((caption.endMs - caption.startMs) * consumedWeight) / totalWeight,
        );
      const token = {
        text: piece,
        startMs,
        endMs,
        utteranceIndex,
        tokenIndex,
        confidence: caption.confidence,
        estimated: true,
      };
      tokens.push(token);

      const graphemes = Array.from(piece).filter((item) => item.trim());
      const duration = endMs - startMs;
      graphemes.forEach((character, characterIndex) => {
        characters.push({
          ...token,
          text: character,
          character,
          startMs:
            startMs +
            Math.round((duration * characterIndex) / graphemes.length),
          endMs:
            startMs +
            Math.round((duration * (characterIndex + 1)) / graphemes.length),
          exact: false,
        });
      });
    });
  });

  const hanCharacters = characters.filter(({ character }) =>
    /\p{Script=Han}/u.test(character),
  );
  const exactHanCharacters = hanCharacters.filter(({ exact }) => exact);

  return {
    schemaVersion: 1,
    provider: "local-whisper-cpp",
    model,
    whisperCppVersion,
    source,
    createdAt,
    durationMs: cleaned.at(-1)?.endMs ?? 0,
    timingGranularity: "character-estimated",
    chineseCharacterTiming:
      hanCharacters.length === 0
        ? "unavailable"
        : exactHanCharacters.length === hanCharacters.length
          ? "exact"
          : "partial",
    timingCoverage: {
      hanCharacters: {
        total: hanCharacters.length,
        exact: exactHanCharacters.length,
        exactPercent: hanCharacters.length
          ? Math.round(
              (exactHanCharacters.length / hanCharacters.length) * 10000,
            ) / 100
          : 0,
      },
    },
    text: utterances.map(({ text }) => text).join(""),
    utterances,
    tokens,
    characters,
    captions: cleaned,
    warnings: [
      "当前工作流使用 Whisper.cpp 的句级时间戳；词语和字符时间按比例估算，并标记为 exact=false。",
    ],
  };
}

function tokenize(text) {
  return (
    text.match(/[A-Za-z0-9]+(?:[-_./][A-Za-z0-9]+)*|\p{Script=Han}|[^\s]/gu) ??
    []
  );
}
