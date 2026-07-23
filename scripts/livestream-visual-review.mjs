#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { remotionCliPath, remotionInvocation } from "./platform.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const REMOTION_DIR = join(REPO_ROOT, "引擎/remotion");
const REMOTION_CLI = remotionCliPath(REMOTION_DIR);
const DEFAULT_BATCH = join(
  REMOTION_DIR,
  "public/workflow/livestream-visual-review-current.json",
);

export function updateLivestreamVisualReview(batch, action, approvedAt) {
  const next = structuredClone(batch);
  if (!Array.isArray(next.clips) || next.clips.length === 0) {
    throw new Error("最终视觉审核批次没有切片。");
  }
  if (action === "mark-stills") {
    for (const clip of next.clips) clip.qa.stillRendered = true;
    return next;
  }
  if (action === "confirm-studio") {
    const missing = next.clips.filter(({ qa }) => !qa.stillRendered);
    if (missing.length > 0) {
      throw new Error("代表性检查图尚未全部生成和检查。");
    }
    for (const clip of next.clips) {
      clip.qa.previewApproved = true;
      clip.qa.readyToRender = true;
      clip.qa.previewApprovedAt = approvedAt;
    }
    return next;
  }
  throw new Error(`未知视觉审核动作：${action}`);
}

export function buildLivestreamFinalOutputPlan(batch, titleReview) {
  if (
    titleReview?.schemaVersion !== 1 ||
    titleReview?.workflow !== "livestream-content-title-review"
  ) {
    throw new Error("最终标题数据格式不正确。");
  }
  if (
    titleReview.id !== batch.id ||
    titleReview.status !== "approved" ||
    !titleReview.approvedAt
  ) {
    throw new Error("最终内容标题尚未明确确认。");
  }
  if (!Array.isArray(titleReview.titles)) {
    throw new Error("最终标题数据缺少 titles。");
  }

  const titlesByClipId = new Map();
  for (const item of titleReview.titles) {
    if (!item?.clipId || titlesByClipId.has(item.clipId)) {
      throw new Error("每条切片必须且只能有一个最终标题。");
    }
    if (
      item.formulaSkill !== "dbs-xhs-title" ||
      !Number.isInteger(item.formulaId) ||
      item.formulaId < 1 ||
      item.formulaId > 75
    ) {
      throw new Error("每条最终标题必须记录 dbs-xhs-title 的公式编号。");
    }
    titlesByClipId.set(item.clipId, normalizeContentTitle(item.contentTitle));
  }

  const outputNames = new Set();
  const outputs = batch.clips.map((clip) => {
    if (!clip.id.startsWith(`${batch.id}-`)) {
      throw new Error(`切片 ID 与当前批次不匹配：${clip.id}`);
    }
    const clipId = clip.id.slice(batch.id.length + 1);
    const contentTitle = titlesByClipId.get(clipId);
    if (!contentTitle) throw new Error(`${clipId} 缺少已确认的最终标题。`);
    const outputFilename = `${contentTitle}.mp4`;
    const comparisonKey = outputFilename.toLocaleLowerCase("zh-CN");
    if (outputNames.has(comparisonKey)) {
      throw new Error("最终标题重名，不得覆盖已有成片。");
    }
    outputNames.add(comparisonKey);
    titlesByClipId.delete(clipId);
    return { clip, clipId, contentTitle, outputFilename };
  });

  if (titlesByClipId.size > 0) {
    throw new Error(
      `最终标题数据包含未知切片：${[...titlesByClipId.keys()].join(", ")}`,
    );
  }
  return outputs;
}

await main();

async function main() {
  if (resolve(process.argv[1] ?? "") !== fileURLToPath(import.meta.url)) return;
  const args = parseArgs(process.argv.slice(2));
  const batchPath = resolve(process.cwd(), args.batch || DEFAULT_BATCH);
  const batch = JSON.parse(await readFile(batchPath, "utf8"));

  if (args.action === "mark-stills") {
    const stillDir = resolve(
      process.cwd(),
      args.stillDir || "输出/检查图/直播切片最终视觉审核",
    );
    for (const clip of batch.clips) {
      const clipId = clip.id.slice(batch.id.length + 1);
      const stillPath = join(stillDir, `${clipId}.png`);
      const info = await stat(stillPath);
      if (info.size === 0) throw new Error(`检查图为空：${stillPath}`);
    }
    const updated = updateLivestreamVisualReview(batch, args.action);
    await persistBatch(batchPath, updated, false);
    console.log(`已记录 ${updated.clips.length} 条代表性检查图。`);
    return;
  }

  if (args.action === "confirm-studio") {
    const updated = updateLivestreamVisualReview(
      batch,
      args.action,
      new Date().toISOString(),
    );
    await persistBatch(batchPath, updated, true);
    console.log("已记录用户对最终视觉的 Studio 确认。");
    return;
  }

  if (args.action === "render") {
    if (batch.clips.some(({ qa }) => !qa.readyToRender)) {
      throw new Error("最终视觉尚未确认，不得渲染成片。");
    }
    if (!args.titles) throw new Error("缺少 --titles 已确认最终标题数据。");
    const titleReview = JSON.parse(
      await readFile(resolve(process.cwd(), args.titles), "utf8"),
    );
    const outputs = buildLivestreamFinalOutputPlan(batch, titleReview);
    await renderFinalClips(outputs);
    return;
  }
  throw new Error("用法：mark-stills、confirm-studio 或 render。");
}

async function persistBatch(batchPath, batch, copyConfirmed) {
  await writeJson(batchPath, batch);
  for (const clip of batch.clips) {
    const clipId = clip.id.slice(batch.id.length + 1);
    const publicDataPath = join(
      REMOTION_DIR,
      `public/video-data/${batch.id}-${clipId}.json`,
    );
    const draftDataPath = join(
      REPO_ROOT,
      `工作区/数据/草稿/${batch.id}-${clipId}-video.json`,
    );
    await writeJson(publicDataPath, clip);
    await writeJson(draftDataPath, clip);
    if (copyConfirmed) {
      await writeJson(
        join(
          REPO_ROOT,
          `工作区/数据/已确认/${batch.id}-${clipId}-video.json`,
        ),
        clip,
      );
    }
  }
  await writeJson(
    join(REMOTION_DIR, "public/video-data/livestream-clip-demo.json"),
    batch.clips[0],
  );
}

async function renderFinalClips(outputs) {
  await access(REMOTION_CLI, constants.R_OK);
  const outputDir = join(REPO_ROOT, "输出/最终成片");
  await mkdir(outputDir, { recursive: true });
  for (const { outputFilename } of outputs) {
    const outputPath = join(outputDir, outputFilename);
    try {
      await access(outputPath, constants.F_OK);
      throw new Error(`最终成片已存在，不得覆盖：${toRepoPath(outputPath)}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  for (const { clip, outputFilename } of outputs) {
    const dataFile = `video-data/${clip.id}.json`;
    const outputPath = join(outputDir, outputFilename);
    const invocation = remotionInvocation(REMOTION_DIR, [
      "render",
      "LivestreamClip916",
      outputPath,
      "--props",
      JSON.stringify({ dataFile }),
      "--codec",
      "h264",
      "--overwrite",
    ]);
    await runInherited(invocation.command, invocation.args);
    await verifyFinalMedia(outputPath, clip.durationMs);
    console.log(`成片已验证：${toRepoPath(outputPath)}`);
  }
}

async function verifyFinalMedia(path, durationMs) {
  const invocation = remotionInvocation(REMOTION_DIR, [
    "ffprobe",
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,width,height,r_frame_rate",
    "-of",
    "json",
    path,
  ]);
  const result = await runCapture(invocation.command, invocation.args);
  const media = JSON.parse(result.stdout);
  const video = media.streams.find(({ codec_type: type }) => type === "video");
  const audio = media.streams.find(({ codec_type: type }) => type === "audio");
  if (!video || !audio || video.width !== 1080 || video.height !== 1920) {
    throw new Error("成片必须包含 1080x1920 视频流和原声音频流。");
  }
  const renderedDurationMs = Math.round(Number(media.format.duration) * 1000);
  if (Math.abs(renderedDurationMs - durationMs) > 180) {
    throw new Error("成片时长与锁定派生母版不一致。");
  }
}

function parseArgs(argv) {
  const result = {
    action: argv[0] ?? null,
    batch: null,
    stillDir: null,
    titles: null,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--batch") result.batch = argv[++index];
    else if (arg === "--still-dir") result.stillDir = argv[++index];
    else if (arg === "--titles") result.titles = argv[++index];
    else if (arg === "--help" || arg === "-h") {
      console.log(`用法：
  npm run clips:visual-review -- mark-stills [--still-dir <dir>]
  npm run clips:visual-review -- confirm-studio
  npm run clips:visual-review -- render --titles <approved-content-titles.json>
`);
      process.exit(0);
    } else throw new Error(`未知参数：${arg}`);
  }
  return result;
}

function normalizeContentTitle(value) {
  if (typeof value !== "string") throw new Error("最终内容标题必须是文字。");
  const title = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!title || [...title].length > 20) {
    throw new Error("最终内容标题必须为 1 至 20 个字符。");
  }
  if (/[<>:"/\\|?*\u0000-\u001f]/u.test(title) || /[. ]$/u.test(title)) {
    throw new Error("最终内容标题包含不可用于文件名的字符。");
  }
  return title;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runCapture(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: REMOTION_DIR });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) resolveRun({ stdout, stderr });
      else rejectRun(new Error(`${command} exited with ${code}\n${stderr}`));
    });
  });
}

function runInherited(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: REMOTION_DIR,
      stdio: "inherit",
    });
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} exited with ${code}`));
    });
  });
}

function toRepoPath(path) {
  return relative(REPO_ROOT, path).split(sep).join("/");
}
