#!/usr/bin/env node
/* global console, process, structuredClone */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.transcript || !args.corrections || !args.output) {
  printHelp();
  process.exit(args.help ? 0 : 1);
}

const transcriptPath = resolve(process.cwd(), args.transcript);
const correctionsPath = resolve(process.cwd(), args.corrections);
const outputPath = resolve(process.cwd(), args.output);
const transcript = JSON.parse(await readFile(transcriptPath, "utf8"));
const correctionSet = JSON.parse(await readFile(correctionsPath, "utf8"));
const reviewed = structuredClone(transcript);
const appliedCorrectionCount =
  correctionSet.replacements.length +
  (correctionSet.insertions?.length ?? 0) +
  (correctionSet.utteranceTextOverrides?.length ?? 0);

for (const correction of correctionSet.replacements) {
  applyCorrection(reviewed, correction);
}

for (const insertion of correctionSet.insertions ?? []) {
  applyInsertion(reviewed, insertion);
}

for (const override of correctionSet.utteranceTextOverrides ?? []) {
  applyUtteranceTextOverride(reviewed, override);
}

recomputeTimingCoverage(reviewed);
reviewed.text = reviewed.utterances.map(({ text }) => text).join("");
reviewed.sourceScript = correctionSet.sourceScript;
reviewed.review = {
  status: correctionSet.reviewStatus,
  correctionPolicy: correctionSet.correctionPolicy,
  correctionFile: args.corrections,
  appliedCorrectionCount,
  appliedReplacementCount: correctionSet.replacements.length,
  appliedInsertionCount: correctionSet.insertions?.length ?? 0,
  appliedUtteranceOverrideCount:
    correctionSet.utteranceTextOverrides?.length ?? 0,
  unresolvedAmbiguityCount: correctionSet.ambiguities.length,
  ambiguities: correctionSet.ambiguities,
  createdAt: new Date().toISOString(),
};

await writeFile(outputPath, `${JSON.stringify(reviewed, null, 2)}\n`, "utf8");
console.log(`已应用修正：${appliedCorrectionCount}`);
console.log(`未解决歧义：${correctionSet.ambiguities.length}`);
console.log(`审校逐字稿：${outputPath}`);

function applyCorrection(data, correction) {
  const tokenPosition = data.tokens.findIndex(
    (item) =>
      item.utteranceIndex === correction.utteranceIndex &&
      item.tokenIndex === correction.tokenIndex,
  );
  const token = data.tokens[tokenPosition];
  if (!token) throw new Error(`找不到修正项 ${correction.id} 对应的词语。`);
  if (token.text !== correction.from) {
    throw new Error(
      `Correction ${correction.id} expected ${JSON.stringify(correction.from)}, got ${JSON.stringify(token.text)}.`,
    );
  }

  const utterance = data.utterances[correction.utteranceIndex];
  if (!utterance?.text.includes(correction.from)) {
    throw new Error(
      `Utterance text does not contain source text for correction ${correction.id}.`,
    );
  }

  const characterItems = data.characters.filter(
    (item) =>
      item.utteranceIndex === correction.utteranceIndex &&
      item.tokenIndex === correction.tokenIndex,
  );
  if (characterItems.length > 0) {
    const replacementCharacters = Array.from(correction.to);
    if (replacementCharacters.length === 0) {
      data.characters = data.characters.filter(
        (item) =>
          item.utteranceIndex !== correction.utteranceIndex ||
          item.tokenIndex !== correction.tokenIndex,
      );
    } else if (
      characterItems.length !== 1 ||
      replacementCharacters.length !== 1
    ) {
      throw new Error(
        `Correction ${correction.id} changes a timed character count.`,
      );
    } else {
      characterItems[0].text = correction.to;
      characterItems[0].character = correction.to;
    }
  }

  utterance.text = utterance.text.replace(correction.from, correction.to);
  if (correction.to === "") data.tokens.splice(tokenPosition, 1);
  else token.text = correction.to;
}

function applyUtteranceTextOverride(data, override) {
  const utterance = data.utterances[override.utteranceIndex];
  if (!utterance) {
    throw new Error(`找不到文本覆盖项 ${override.id} 对应的句子。`);
  }
  utterance.text = override.text;
}

function applyInsertion(data, insertion) {
  const anchorPosition = data.tokens.findIndex(
    (item) =>
      item.utteranceIndex === insertion.utteranceIndex &&
      item.tokenIndex === insertion.beforeTokenIndex,
  );
  const anchor = data.tokens[anchorPosition];
  if (!anchor) {
    throw new Error(`找不到插入项 ${insertion.id} 使用的锚点词语。`);
  }
  if (
    !Number.isFinite(insertion.startMs) ||
    !Number.isFinite(insertion.endMs)
  ) {
    throw new Error(`插入项 ${insertion.id} 必须提供数字时间。`);
  }

  const insertedTokenIndex = insertion.tokenIndex ?? -1;
  data.tokens.splice(anchorPosition, 0, {
    text: insertion.text,
    startMs: insertion.startMs,
    endMs: insertion.endMs,
    utteranceIndex: insertion.utteranceIndex,
    tokenIndex: insertedTokenIndex,
    confidence: null,
    estimated: true,
  });

  const insertedCharacters = Array.from(insertion.text);
  const duration = insertion.endMs - insertion.startMs;
  for (let index = 0; index < insertedCharacters.length; index += 1) {
    const startMs =
      insertion.startMs +
      Math.round((duration * index) / insertedCharacters.length);
    const endMs =
      insertion.startMs +
      Math.round((duration * (index + 1)) / insertedCharacters.length);
    data.characters.push({
      text: insertedCharacters[index],
      character: insertedCharacters[index],
      startMs,
      endMs,
      utteranceIndex: insertion.utteranceIndex,
      tokenIndex: insertedTokenIndex,
      confidence: null,
      exact: false,
    });
  }

  if (Number.isFinite(insertion.adjustAnchorStartMs)) {
    anchor.startMs = insertion.adjustAnchorStartMs;
    for (const character of data.characters) {
      if (
        character.utteranceIndex === insertion.utteranceIndex &&
        character.tokenIndex === insertion.beforeTokenIndex
      ) {
        character.startMs = insertion.adjustAnchorStartMs;
        character.exact = false;
      }
    }
  }

  data.characters.sort(
    (left, right) =>
      left.startMs - right.startMs ||
      left.endMs - right.endMs ||
      left.utteranceIndex - right.utteranceIndex,
  );

  const warning =
    "Human-confirmed inserted characters use estimated timing and are marked exact: false.";
  data.warnings ??= [];
  if (!data.warnings.includes(warning)) data.warnings.push(warning);
}

function recomputeTimingCoverage(data) {
  const total = data.tokens.reduce(
    (count, token) =>
      count +
      Array.from(token.text).filter((character) =>
        /\p{Script=Han}/u.test(character),
      ).length,
    0,
  );
  const exact = data.characters.filter(
    ({ character, exact: isExact }) =>
      isExact && /\p{Script=Han}/u.test(character),
  ).length;
  data.chineseCharacterTiming =
    total === 0 ? "unavailable" : exact === total ? "exact" : "partial";
  data.timingCoverage.hanCharacters = {
    total,
    exact,
    exactPercent: total ? Math.round((exact / total) * 10000) / 100 : 0,
  };
}

function parseArgs(argv) {
  const parsed = {
    transcript: null,
    corrections: null,
    output: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--transcript") parsed.transcript = argv[++index];
    else if (arg === "--corrections") parsed.corrections = argv[++index];
    else if (arg === "--output") parsed.output = argv[++index];
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`用法：
  npm run asr:correct -- --transcript <transcript.json> --corrections <corrections.json> --output <review.json>
`);
}
