#!/usr/bin/env node

import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const REMOTION_DIR = join(REPO_ROOT, "引擎/remotion");

export function buildLivestreamVideoData({ plan, reviewedTranscripts }) {
  if (plan.schemaVersion !== 1 || plan.workflow !== "clip-extraction-review") {
    throw new Error("已批准方案不是 clip-extraction-review schemaVersion 1。");
  }
  if (
    plan.preview?.status !== "approved" ||
    plan.timeline?.status !== "locked"
  ) {
    throw new Error("只能为已确认切点且已锁定的直播切片生成视频数据。");
  }

  const approved = plan.candidates.filter(
    ({ reviewStatus }) => reviewStatus === "approved",
  );
  if (approved.length === 0) throw new Error("没有已批准的直播切片。");

  return approved.map((candidate) => {
    if (candidate.timeline?.status !== "locked" || !candidate.outputs) {
      throw new Error(`${candidate.id} 还没有锁定派生母版。`);
    }
    const reviewed = reviewedTranscripts[candidate.id];
    if (!reviewed) throw new Error(`${candidate.id} 缺少窄审校逐字稿。`);
    const durationMs = candidate.timeline.durationMs;
    return {
      schemaVersion: 1,
      id: `${plan.id}-${candidate.id}`,
      template: "livestream-clip-916",
      durationMs,
      masterVideo: {
        sourcePath: candidate.outputs.masterVideo,
        asset: candidate.outputs.masterAsset,
      },
      masterTranscript: {
        sourcePath: reviewed.sourcePath,
        asset: reviewed.asset,
      },
      output: {
        width: 1080,
        height: 1920,
        fps: 30,
        platforms: ["douyin", "xiaohongshu"],
      },
      presentation: {
        objectFit: "cover",
        objectPosition: "center center",
        canvas: "#000000",
        text: "#ffffff",
      },
      captions: {
        maxCharsPerPage: 16,
        areaHeight: 520,
        bottomPadding: 320,
      },
      audioPolicy: {
        scope: "locked-master",
        masterAudioOnly: true,
        changeMasterDuration: false,
        reorderSpeech: false,
      },
      timelinePolicy: {
        sourceRangeContinuous: true,
      },
      qa: {
        masterTimelineLocked: true,
        cropToFill: true,
        privacyMaskRequired: false,
        assetPathsChecked: true,
        stillRendered: false,
        previewMethod: "studio",
        previewApproved: false,
        readyToRender: false,
      },
    };
  });
}

await main();

async function main() {
  if (resolve(process.argv[1] ?? "") !== fileURLToPath(import.meta.url)) return;
  const args = parseArgs(process.argv.slice(2));
  if (!args.plan) throw new Error("缺少 --plan。");
  const planPath = resolve(process.cwd(), args.plan);
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  const approved = plan.candidates.filter(
    ({ reviewStatus }) => reviewStatus === "approved",
  );
  const reviewedTranscripts = {};

  for (const candidate of approved) {
    const sourcePath = join(
      REPO_ROOT,
      `工作区/数据/已确认/${plan.id}-${candidate.id}-reviewed-transcript.json`,
    );
    const publicPath = join(
      REMOTION_DIR,
      `public/generated/livestream-clips/${plan.id}/${candidate.id}/reviewed-transcript.json`,
    );
    await access(
      resolve(REPO_ROOT, candidate.outputs.masterVideo),
      constants.R_OK,
    );
    await access(sourcePath, constants.R_OK);
    await mkdir(dirname(publicPath), { recursive: true });
    await copyFile(sourcePath, publicPath);
    reviewedTranscripts[candidate.id] = {
      sourcePath: toRepoPath(sourcePath),
      asset: toPublicPath(publicPath),
    };
  }

  const clips = buildLivestreamVideoData({ plan, reviewedTranscripts });
  for (const clip of clips) {
    const clipId = clip.id.slice(plan.id.length + 1);
    await writeJson(
      join(REPO_ROOT, `工作区/数据/草稿/${plan.id}-${clipId}-video.json`),
      clip,
      args.force,
    );
    await writeJson(
      join(REMOTION_DIR, `public/video-data/${plan.id}-${clipId}.json`),
      clip,
      args.force,
    );
  }

  const batch = { schemaVersion: 1, id: plan.id, clips };
  await writeJson(
    join(REMOTION_DIR, "public/workflow/livestream-visual-review-current.json"),
    batch,
    args.force,
  );
  await writeJson(
    join(REMOTION_DIR, "public/video-data/livestream-clip-demo.json"),
    clips[0],
    args.force,
  );
  console.log(`已生成 ${clips.length} 条 9:16 视频配置。`);
  console.log("在 Studio 中选择 Workflow > LivestreamClipVisualReview。");
}

function parseArgs(argv) {
  const result = { plan: null, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--plan") result.plan = argv[++index];
    else if (arg === "--force") result.force = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`用法：
  npm run clips:video-data -- --plan <approved-clips.json> [--force]
`);
      process.exit(0);
    } else throw new Error(`未知参数：${arg}`);
  }
  return result;
}

async function writeJson(path, value, force) {
  try {
    await access(path, constants.F_OK);
    if (!force) throw new Error(`输出文件已存在：${toRepoPath(path)}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function toPublicPath(path) {
  return relative(join(REMOTION_DIR, "public"), path).split(sep).join("/");
}

function toRepoPath(path) {
  return relative(REPO_ROOT, path).split(sep).join("/");
}
