#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  link,
  mkdir,
  readFile,
  rename,
  stat,
} from "node:fs/promises";
import { constants } from "node:fs";
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { remotionCliPath, remotionInvocation } from "./platform.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const REMOTION_DIR = join(REPO_ROOT, "引擎/remotion");
const REMOTION_CLI = remotionCliPath(REMOTION_DIR);
const CURRENT_PUBLIC_PLAN = join(
  REMOTION_DIR,
  "public/workflow/clip-review-current.json",
);

export function buildClipReviewPlan({
  report,
  selectedIds,
  asset,
  media,
  id,
  createdAt = new Date().toISOString(),
}) {
  if (
    ![1, 2].includes(report.schemaVersion) ||
    report.workflow !== "clip-extraction"
  ) {
    throw new Error("候选报告不是可支持的 clip-extraction 数据。");
  }
  const selected = report.candidates.filter((candidate) =>
    selectedIds.includes(candidate.id),
  );
  if (selected.length !== selectedIds.length) {
    const found = new Set(selected.map(({ id: candidateId }) => candidateId));
    const missing = selectedIds.filter(
      (candidateId) => !found.has(candidateId),
    );
    throw new Error(`找不到候选：${missing.join(", ")}`);
  }
  if (selected.length === 0) throw new Error("至少选择一条候选。");

  const plan = {
    schemaVersion: 1,
    workflow: "clip-extraction-review",
    id,
    createdAt,
    sourceVideo: {
      sourcePath: report.sourceVideo.sourcePath,
      asset,
      fingerprint: report.sourceVideo.fingerprint,
    },
    sourceDurationMs: report.sourceVideo.durationMs,
    sourceMedia: media,
    preview: {
      width: 1080,
      height: 1920,
      fps: 30,
      durationMs: 0,
      method: "studio",
      status: "pending",
      approvedAt: null,
    },
    candidates: selected.map((candidate) => ({
      id: candidate.id,
      title: candidate.workingTitle,
      corePoint: candidate.corePoint,
      sourceStartMs: candidate.startMs,
      sourceEndMs: candidate.endMs,
      durationMs: candidate.endMs - candidate.startMs,
      timelineStartMs: 0,
      timelineEndMs: 0,
      totalScore: candidate.totalScore,
      reviewStatus: "pending",
      boundaryNote: null,
    })),
  };
  return refreshTimeline(plan);
}

export function refreshTimeline(plan) {
  let cursor = 0;
  for (const candidate of plan.candidates) {
    validateRange(candidate, plan.sourceDurationMs);
    candidate.durationMs = candidate.sourceEndMs - candidate.sourceStartMs;
    candidate.timelineStartMs = cursor;
    cursor += candidate.durationMs;
    candidate.timelineEndMs = cursor;
  }
  plan.preview.durationMs = cursor;
  return plan;
}

export function reviewClipPlan(plan, options) {
  if (plan.preview.status === "approved") {
    throw new Error("这份 Studio 切点审核已经确认。");
  }
  for (const id of options.approve ?? []) setStatus(plan, id, "approved");
  for (const id of options.reject ?? []) setStatus(plan, id, "rejected");
  for (const adjustment of options.adjustments ?? []) {
    const candidate = findCandidate(plan, adjustment.id);
    candidate.sourceStartMs = adjustment.startMs;
    candidate.sourceEndMs = adjustment.endMs;
    candidate.reviewStatus = "pending";
    candidate.boundaryNote = adjustment.note ?? "调整后待 Studio 复核";
  }
  refreshTimeline(plan);

  if (options.confirmStudio) {
    const pending = plan.candidates.filter(
      ({ reviewStatus }) => reviewStatus === "pending",
    );
    if (pending.length > 0) {
      throw new Error(
        `仍有待确认候选：${pending.map(({ id }) => id).join(", ")}`,
      );
    }
    if (
      !plan.candidates.some(({ reviewStatus }) => reviewStatus === "approved")
    ) {
      throw new Error("至少需要批准一条候选才能确认 Studio。");
    }
    plan.preview.status = "approved";
    plan.preview.approvedAt = new Date().toISOString();
  }
  return plan;
}

export function remapTranscriptToRange(
  transcript,
  { sourceStartMs, sourceEndMs },
  outputSource,
) {
  const segments = [
    {
      type: "body",
      sourceStartMs,
      sourceEndMs,
      timelineStartMs: 0,
    },
  ];

  const mappedSegments = segments.map((segment) =>
    mapTranscriptSegment(transcript, segment),
  );
  const utterances = [];
  const tokens = [];
  const characters = [];
  const captions = [];
  for (const mapped of mappedSegments) {
    const utteranceOffset = utterances.length;
    utterances.push(
      ...mapped.utterances.map((utterance, index) => ({
        ...utterance,
        index: utteranceOffset + index,
      })),
    );
    tokens.push(
      ...mapped.tokens.map((item) => ({
        ...item,
        utteranceIndex: utteranceOffset + item.utteranceIndex,
      })),
    );
    characters.push(
      ...mapped.characters.map((item) => ({
        ...item,
        utteranceIndex: utteranceOffset + item.utteranceIndex,
      })),
    );
    captions.push(...mapped.captions);
  }
  const durationMs = sourceEndMs - sourceStartMs;

  return {
    ...structuredClone(transcript),
    source: outputSource,
    createdAt: new Date().toISOString(),
    durationMs,
    text: utterances.map(({ text }) => text).join(""),
    utterances,
    tokens,
    characters,
    captions,
    clipExtraction: {
      originalSource: transcript.source,
      sourceStartMs,
      sourceEndMs,
      continuousSourceRange: true,
      playbackSegments: segments,
      timestampPolicy: "mapped-from-original-whisper",
    },
    warnings: [
      ...(transcript.warnings ?? []),
      "逐字稿时间戳已映射到用户确认的直播连续区间，没有重新运行 Whisper。",
    ],
  };
}

await main();

async function main() {
  if (resolve(process.argv[1] ?? "") !== fileURLToPath(import.meta.url)) return;
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "prepare") await prepareReview(args);
  else if (args.command === "review") await updateReview(args);
  else if (args.command === "apply") await applyReview(args);
  else
    throw new Error("用法：prepare、review 或 apply。使用 --help 查看参数。");
}

async function prepareReview(args) {
  requireArgs(args, ["report"]);
  await access(REMOTION_CLI, constants.R_OK);
  const reportPath = resolve(process.cwd(), args.report);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const sourcePath = resolve(REPO_ROOT, report.sourceVideo.sourcePath);
  await verifyFingerprint(sourcePath, report.sourceVideo.fingerprint);
  const name = sanitizeName(
    args.name || basename(sourcePath, extname(sourcePath)),
  );
  const selectedIds = parseSelection(args.select, report.candidates);
  const media = await probeMedia(sourcePath);
  const assetDir = join(
    REMOTION_DIR,
    "public/generated/livestream-clips",
    name,
  );
  const assetPath = join(assetDir, `source${extname(sourcePath)}`);
  await mkdir(assetDir, { recursive: true });
  await linkOrCopy(sourcePath, assetPath, args.force);

  const plan = buildClipReviewPlan({
    report,
    selectedIds,
    asset: toPublicPath(assetPath),
    media,
    id: name,
  });
  const outputPath = resolve(
    process.cwd(),
    args.output || `工作区/数据/草稿/${name}-clip-review-plan.json`,
  );
  await ensureWritable(outputPath, args.force);
  await writeJson(outputPath, plan);
  await writeJson(CURRENT_PUBLIC_PLAN, plan);
  console.log(`切点审核计划：${toRepoPath(outputPath)}`);
  console.log("在 Studio 中选择 Workflow > LivestreamClipReview。");
}

async function updateReview(args) {
  requireArgs(args, ["plan"]);
  const planPath = resolve(process.cwd(), args.plan);
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  const allIds = plan.candidates.map(({ id }) => id);
  reviewClipPlan(plan, {
    approve: parseIds(args.approve, allIds),
    reject: parseIds(args.reject, allIds),
    adjustments: args.adjustments,
    hooks: args.hooks,
    skippedHooks: args.skippedHooks,
    confirmStudio: args.confirmStudio,
  });
  await writeJson(planPath, plan);
  await writeJson(CURRENT_PUBLIC_PLAN, plan);
  console.log(`切点审核计划已更新：${toRepoPath(planPath)}`);
  console.log(`Studio 状态：${plan.preview.status}`);
}

async function applyReview(args) {
  requireArgs(args, ["plan", "transcript"]);
  await access(REMOTION_CLI, constants.R_OK);
  const planPath = resolve(process.cwd(), args.plan);
  const transcriptPath = resolve(process.cwd(), args.transcript);
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  if (plan.preview.status !== "approved") {
    throw new Error("Studio 切点预览尚未确认。");
  }
  if (plan.candidates.some(({ reviewStatus }) => reviewStatus === "pending")) {
    throw new Error("生成派生母版前，所有候选都必须明确批准或拒绝。");
  }
  if (plan.timeline?.status === "locked" && !args.force) {
    throw new Error("直播切片时间轴已锁定；确认重建后使用 --force。");
  }
  const approved = plan.candidates.filter(
    ({ reviewStatus }) => reviewStatus === "approved",
  );
  if (approved.length === 0) throw new Error("没有已批准的直播切片。");
  const sourcePath = resolve(REPO_ROOT, plan.sourceVideo.sourcePath);
  await verifyFingerprint(sourcePath, plan.sourceVideo.fingerprint);
  const transcript = JSON.parse(await readFile(transcriptPath, "utf8"));
  const outputRoot = resolve(
    process.cwd(),
    args.outputDir || `工作区/派生媒体/直播切片/${plan.id}`,
  );
  const readyDataDir = join(REPO_ROOT, "工作区/数据/已确认");
  const approvedPlanPath = join(readyDataDir, `${plan.id}-approved-clips.json`);
  await ensureWritable(approvedPlanPath, args.force);
  await mkdir(outputRoot, { recursive: true });
  await mkdir(readyDataDir, { recursive: true });

  for (const candidate of approved) {
    const clipDir = join(outputRoot, candidate.id);
    const masterPath = join(clipDir, "master.mp4");
    const clipTranscriptPath = join(
      readyDataDir,
      `${plan.id}-${candidate.id}-transcript.json`,
    );
    await ensureWritable(masterPath, args.force);
    await ensureWritable(clipTranscriptPath, args.force);
    await mkdir(clipDir, { recursive: true });

    console.log(`正在生成 ${candidate.id} 派生母版……`);
    await renderStandaloneClip(sourcePath, masterPath, candidate);
    const rendered = await probeMedia(masterPath);
    if (Math.abs(rendered.durationMs - candidate.durationMs) > 180) {
      throw new Error(
        `${candidate.id} 渲染时长 ${rendered.durationMs} 与批准源区间时长 ${candidate.durationMs} 不一致。`,
      );
    }
    const remapped = remapTranscriptToRange(
      transcript,
      candidate,
      toRepoPath(masterPath),
    );
    await writeJson(clipTranscriptPath, remapped);

    const publicDir = join(
      REMOTION_DIR,
      "public/generated/livestream-clips",
      plan.id,
      candidate.id,
    );
    const publicMasterPath = join(publicDir, "master.mp4");
    const publicTranscriptPath = join(publicDir, "transcript.json");
    await mkdir(publicDir, { recursive: true });
    await linkOrCopy(masterPath, publicMasterPath, args.force);
    await linkOrCopy(clipTranscriptPath, publicTranscriptPath, args.force);
    candidate.timeline = {
      status: "locked",
      lockedAt: new Date().toISOString(),
      durationMs: candidate.durationMs,
    };
    candidate.outputs = {
      masterVideo: toRepoPath(masterPath),
      transcript: toRepoPath(clipTranscriptPath),
      masterAsset: toPublicPath(publicMasterPath),
      transcriptAsset: toPublicPath(publicTranscriptPath),
    };
  }

  plan.timeline = {
    status: "locked",
    lockedAt: new Date().toISOString(),
    approvedClipCount: approved.length,
  };
  plan.outputs = { approvedPlan: toRepoPath(approvedPlanPath) };
  await writeJson(planPath, plan);
  await writeJson(approvedPlanPath, plan);
  await writeJson(CURRENT_PUBLIC_PLAN, plan);
  console.log(`已批准切片方案：${toRepoPath(approvedPlanPath)}`);
  console.log(`已锁定派生母版：${approved.length} 条`);
}

function parseArgs(argv) {
  const result = {
    command: argv[0] ?? null,
    report: null,
    plan: null,
    transcript: null,
    output: null,
    outputDir: null,
    name: null,
    select: "all",
    approve: null,
    reject: null,
    adjustments: [],
    confirmStudio: false,
    force: false,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--report") result.report = argv[++index];
    else if (arg === "--plan") result.plan = argv[++index];
    else if (arg === "--transcript") result.transcript = argv[++index];
    else if (arg === "--output") result.output = argv[++index];
    else if (arg === "--output-dir") result.outputDir = argv[++index];
    else if (arg === "--name") result.name = argv[++index];
    else if (arg === "--select") result.select = argv[++index];
    else if (arg === "--approve") result.approve = argv[++index];
    else if (arg === "--reject") result.reject = argv[++index];
    else if (arg === "--set-range") {
      const [id, start, end, note] = String(argv[++index]).split(":");
      result.adjustments.push({
        id,
        startMs: Number(start),
        endMs: Number(end),
        note: note || null,
      });
    } else if (arg === "--confirm-studio") result.confirmStudio = true;
    else if (arg === "--force") result.force = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`用法：
  npm run clips:review -- prepare --report <candidates.json> [--select all|id,id] [--name name]
  npm run clips:review -- review --plan <plan.json> [--approve all|id,id] [--reject id,id]
    [--set-range id:startMs:endMs:note]
    [--confirm-studio]
  npm run clips:review -- apply --plan <plan.json> --transcript <transcript.json>
`);
      process.exit(0);
    } else throw new Error(`未知参数：${arg}`);
  }
  return result;
}

function parseSelection(value, candidates) {
  const allIds = candidates.map(({ id }) => id);
  return value === "all" ? allIds : parseIds(value, allIds);
}

function parseIds(value, allIds) {
  if (!value) return [];
  if (value === "all") return [...allIds];
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function setStatus(plan, id, status) {
  findCandidate(plan, id).reviewStatus = status;
}

function findCandidate(plan, id) {
  const candidate = plan.candidates.find((item) => item.id === id);
  if (!candidate) throw new Error(`找不到候选：${id}`);
  return candidate;
}

function validateRange(candidate, sourceDurationMs) {
  if (
    !Number.isInteger(candidate.sourceStartMs) ||
    !Number.isInteger(candidate.sourceEndMs) ||
    candidate.sourceStartMs < 0 ||
    candidate.sourceEndMs <= candidate.sourceStartMs ||
    candidate.sourceEndMs > sourceDurationMs
  ) {
    throw new Error(`${candidate.id} 的原片连续区间无效。`);
  }
  const duration = candidate.sourceEndMs - candidate.sourceStartMs;
  if (duration < 30000 || duration > 90000) {
    throw new Error(`${candidate.id} 时长必须在 30 至 90 秒之间。`);
  }
}

function mapSpanToRange(item, sourceStartMs, sourceEndMs) {
  const startMs = Number(item.startMs);
  const endMs = Number(item.endMs);
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs
  ) {
    return null;
  }
  const overlapStart = Math.max(startMs, sourceStartMs);
  const overlapEnd = Math.min(endMs, sourceEndMs);
  if (overlapEnd <= overlapStart) return null;
  return {
    startMs: overlapStart - sourceStartMs,
    endMs: overlapEnd - sourceStartMs,
  };
}

function mapTranscriptSegment(transcript, segment) {
  const utterances = [];
  const utteranceIndexes = new Map();
  for (const [sourceIndex, utterance] of (
    transcript.utterances ?? []
  ).entries()) {
    const mapped = mapSpanToTimeline(utterance, segment);
    if (!mapped) continue;
    const index = utterances.length;
    utteranceIndexes.set(utterance.index ?? sourceIndex, index);
    utterances.push({
      ...utterance,
      index,
      startMs: mapped.startMs,
      endMs: mapped.endMs,
    });
  }

  const mapAtomic = (items) =>
    (items ?? []).flatMap((item) => {
      const midpoint = (Number(item.startMs) + Number(item.endMs)) / 2;
      if (midpoint < segment.sourceStartMs || midpoint >= segment.sourceEndMs) {
        return [];
      }
      const utteranceIndex = utteranceIndexes.get(item.utteranceIndex);
      if (utteranceIndex === undefined) return [];
      return [
        {
          ...item,
          startMs:
            segment.timelineStartMs +
            Math.max(0, Number(item.startMs) - segment.sourceStartMs),
          endMs:
            segment.timelineStartMs +
            Math.min(
              segment.sourceEndMs - segment.sourceStartMs,
              Number(item.endMs) - segment.sourceStartMs,
            ),
          utteranceIndex,
        },
      ];
    });

  const mapSpans = (items) =>
    (items ?? []).flatMap((item) => {
      const mapped = mapSpanToTimeline(item, segment);
      return mapped ? [{ ...item, ...mapped }] : [];
    });

  return {
    utterances,
    tokens: mapAtomic(transcript.tokens),
    characters: mapAtomic(transcript.characters),
    captions: mapSpans(transcript.captions),
  };
}

function mapSpanToTimeline(item, segment) {
  const mapped = mapSpanToRange(
    item,
    segment.sourceStartMs,
    segment.sourceEndMs,
  );
  if (!mapped) return null;
  return {
    startMs: segment.timelineStartMs + mapped.startMs,
    endMs: segment.timelineStartMs + mapped.endMs,
  };
}

export async function renderStandaloneClip(inputPath, outputPath, candidate) {
  await renderContinuousRange(
    inputPath,
    outputPath,
    candidate.sourceStartMs,
    candidate.durationMs,
  );
}

async function renderContinuousRange(
  inputPath,
  outputPath,
  sourceStartMs,
  durationMs,
) {
  const invocation = remotionInvocation(REMOTION_DIR, [
    "ffmpeg",
    "-y",
    "-hide_banner",
    "-ss",
    seconds(sourceStartMs),
    "-i",
    inputPath,
    "-t",
    seconds(durationMs),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0",
    ...masterEncodingArgs(outputPath),
  ]);
  await runInherited(invocation.command, invocation.args);
}

function masterEncodingArgs(outputPath) {
  return [
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-af",
    "aresample=async=1:first_pts=0",
    "-avoid_negative_ts",
    "make_zero",
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

async function probeMedia(inputPath) {
  const invocation = remotionInvocation(REMOTION_DIR, [
    "ffprobe",
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,width,height,r_frame_rate",
    "-of",
    "json",
    inputPath,
  ]);
  const result = await runCapture(invocation.command, invocation.args);
  const parsed = JSON.parse(result.stdout);
  const video = parsed.streams.find(({ codec_type: type }) => type === "video");
  const audio = parsed.streams.find(({ codec_type: type }) => type === "audio");
  if (!video || !audio) throw new Error("直播原片必须同时包含视频和音频。");
  const [numerator, denominator] = String(video.r_frame_rate)
    .split("/")
    .map(Number);
  return {
    durationMs: Math.round(Number(parsed.format.duration) * 1000),
    width: video.width,
    height: video.height,
    fps: Math.round(numerator / denominator),
    hasAudio: true,
  };
}

async function verifyFingerprint(path, fingerprint) {
  const sourceStat = await stat(path);
  if (
    sourceStat.size !== fingerprint.size ||
    Math.round(sourceStat.mtimeMs) !== fingerprint.mtimeMs
  ) {
    throw new Error("候选报告生成后，直播原片已经发生变化。");
  }
}

async function linkOrCopy(source, destination, force) {
  try {
    await access(destination, constants.F_OK);
    const [sourceStat, destinationStat] = await Promise.all([
      stat(source),
      stat(destination),
    ]);
    if (
      sourceStat.size === destinationStat.size &&
      Math.round(sourceStat.mtimeMs) === Math.round(destinationStat.mtimeMs)
    ) {
      return;
    }
    if (!force) throw new Error(`公共素材已存在：${destination}`);
    await rm(destination, { force: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await link(source, destination);
  } catch (error) {
    if (!["EXDEV", "EPERM", "EACCES", "EINVAL"].includes(error.code)) {
      throw error;
    }
    await copyFile(source, destination);
  }
}

async function ensureWritable(path, force) {
  try {
    await access(path, constants.F_OK);
    if (!force) throw new Error(`输出文件已存在：${path}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${createHash("sha1").update(path).digest("hex").slice(0, 8)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
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
    const child = spawn(command, args, { cwd: REMOTION_DIR, stdio: "inherit" });
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} exited with ${code}`));
    });
  });
}

function requireArgs(args, names) {
  for (const name of names) {
    if (!args[name]) throw new Error(`缺少参数 --${name}`);
  }
}

function sanitizeName(value) {
  return value.replace(/[\\/:*?"<>|]/g, "-").trim();
}

function seconds(value) {
  return (value / 1000).toFixed(3);
}

function toPublicPath(path) {
  return relative(join(REMOTION_DIR, "public"), path).split(sep).join("/");
}

function toRepoPath(path) {
  return relative(REPO_ROOT, path).split(sep).join("/");
}
