#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
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
import {
  installWhisperCpp,
  toCaptions,
  transcribe,
} from "@remotion/install-whisper-cpp";
import { normalizeWhisperCaptions } from "./lib/local-whisper-result.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(PROJECT_DIR, "../..");
const DEFAULT_OUTPUT_DIR = join(REPO_ROOT, "工作区/数据/草稿");
const WHISPER_DIR = join(REPO_ROOT, "工作区/缓存/whisper.cpp");
const WHISPER_CPP_VERSION = "1.5.5";
const AVAILABLE_MODELS = new Set([
  "tiny",
  "base",
  "small",
  "medium",
  "large-v3-turbo",
]);
const MODEL_SIZES = {
  tiny: 77691713,
  base: 147951465,
  small: 487601967,
  medium: 1533763059,
  "large-v3-turbo": 1624555275,
};

const args = parseArgs(process.argv.slice(2));
if (args.help || (!args.installOnly && !args.input)) {
  printHelp();
  process.exit(args.help ? 0 : 1);
}
if (!AVAILABLE_MODELS.has(args.model)) {
  throw new Error(
    `不支持模型 ${args.model}。可选：${[...AVAILABLE_MODELS].join(", ")}。`,
  );
}

await installLocalWhisper(args.model);
if (args.installOnly) {
  console.log(`本地 Whisper 已就绪，当前模型：${args.model}。`);
  process.exit(0);
}

const inputPath = resolve(process.cwd(), args.input);
await access(inputPath, constants.R_OK);
const name = sanitizeName(args.name || basename(inputPath, extname(inputPath)));
const outputDir = resolve(process.cwd(), args.outputDir || DEFAULT_OUTPUT_DIR);
const rawPath = join(outputDir, `${name}-transcript.whisper.json`);
const normalizedPath = join(outputDir, `${name}-transcript.json`);

if (!args.force) {
  for (const path of [rawPath, normalizedPath]) {
    try {
      await access(path, constants.F_OK);
      throw new Error(`输出文件已存在：${path}。确认允许覆盖后使用 --force。`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

await mkdir(outputDir, { recursive: true });
const workDir = await mkdtemp(join(tmpdir(), "local-whisper-"));

try {
  const wavPath = join(workDir, `${name}.wav`);
  await extractAudio(inputPath, wavPath);
  console.log(`正在使用本地 Whisper.cpp ${args.model} 模型转录……`);
  const whisperCppOutput = await transcribe({
    inputPath: wavPath,
    whisperPath: WHISPER_DIR,
    whisperCppVersion: WHISPER_CPP_VERSION,
    model: args.model,
    language: args.language,
    tokenLevelTimestamps: true,
    splitOnWord: true,
    printOutput: false,
  });
  const { captions } = toCaptions({ whisperCppOutput });
  const normalized = normalizeWhisperCaptions({
    captions,
    model: args.model,
    source: toRepoPath(inputPath),
    whisperCppVersion: WHISPER_CPP_VERSION,
  });

  await writeFile(
    rawPath,
    `${JSON.stringify(whisperCppOutput, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    normalizedPath,
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8",
  );
  console.log(`本地原始结果：${toRepoPath(rawPath)}`);
  console.log(`标准化逐字稿：${toRepoPath(normalizedPath)}`);
  console.log(`时长：${normalized.durationMs} 毫秒`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}

async function installLocalWhisper(model) {
  await mkdir(dirname(WHISPER_DIR), { recursive: true });
  await quarantineIncompleteWhisperInstall();
  await installWhisperCpp({
    version: WHISPER_CPP_VERSION,
    to: WHISPER_DIR,
    printOutput: true,
  });
  await quarantineIncompleteModel(model);
  await downloadModel(model);
}

async function quarantineIncompleteWhisperInstall() {
  try {
    await access(WHISPER_DIR, constants.F_OK);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  try {
    await access(join(WHISPER_DIR, "main"), constants.X_OK);
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "EACCES") throw error;
    const reviewDir = join(REPO_ROOT, "工作区", "待删除");
    await mkdir(reviewDir, { recursive: true });
    const destination = join(
      reviewDir,
      `whisper-install-incomplete-${Date.now()}`,
    );
    await rename(WHISPER_DIR, destination);
    console.warn(
      `不完整的 Whisper.cpp 安装已移到 ${destination}，正在重新安装。`,
    );
  }
}

async function quarantineIncompleteModel(model) {
  const modelPath = join(WHISPER_DIR, `ggml-${model}.bin`);
  try {
    const modelStat = await stat(modelPath);
    if (modelStat.size === MODEL_SIZES[model]) return;
    const quarantinePath = `${modelPath}.incomplete-${Date.now()}`;
    await rename(modelPath, quarantinePath);
    console.warn(`不完整的模型已移到 ${quarantinePath}，正在重新下载。`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function downloadModel(model) {
  const modelPath = join(WHISPER_DIR, `ggml-${model}.bin`);
  try {
    const modelStat = await stat(modelPath);
    if (modelStat.size === MODEL_SIZES[model]) {
      console.log(`模型已存在：${modelPath}`);
      return;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const partialPath = `${modelPath}.part`;
  const configuredBase = process.env.WHISPER_MODEL_BASE_URL?.replace(
    /\/$/u,
    "",
  );
  const bases = [
    configuredBase,
    "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main",
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main",
  ].filter((value, index, values) => value && values.indexOf(value) === index);

  let lastError = null;
  for (const base of bases) {
    const url = `${base}/ggml-${model}.bin`;
    console.log(`正在从 ${url} 下载 Whisper 模型`);
    try {
      await run("curl", [
        "-L",
        "--fail",
        "--retry",
        "3",
        "--connect-timeout",
        "20",
        "--continue-at",
        "-",
        "--output",
        partialPath,
        url,
      ]);
      const downloaded = await stat(partialPath);
      if (downloaded.size !== MODEL_SIZES[model]) {
        throw new Error(
          `模型文件大小为 ${downloaded.size} 字节，预期为 ${MODEL_SIZES[model]} 字节。`,
        );
      }
      await rename(partialPath, modelPath);
      console.log(`模型下载完成：${modelPath}`);
      return;
    } catch (error) {
      lastError = error;
      console.warn(`从 ${base} 下载模型失败：${error.message}`);
    }
  }
  throw lastError ?? new Error("没有可用的 Whisper 模型下载地址。");
}

async function extractAudio(input, output) {
  const remotion = join(PROJECT_DIR, "node_modules/.bin/remotion");
  await run(remotion, [
    "ffmpeg",
    "-y",
    "-v",
    "error",
    "-i",
    input,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    output,
  ]);
}

function run(command, commandArgs) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, commandArgs, {
      stdio: "inherit",
      cwd: PROJECT_DIR,
    });
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} exited with code ${code}`));
    });
  });
}

function parseArgs(argv) {
  const parsed = {
    input: null,
    outputDir: null,
    name: null,
    model: "small",
    language: "zh",
    installOnly: false,
    force: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") parsed.input = argv[++index];
    else if (arg === "--output-dir") parsed.outputDir = argv[++index];
    else if (arg === "--name") parsed.name = argv[++index];
    else if (arg === "--model") parsed.model = argv[++index];
    else if (arg === "--language") parsed.language = argv[++index];
    else if (arg === "--install-only") parsed.installOnly = true;
    else if (arg === "--force") parsed.force = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return parsed;
}

function sanitizeName(value) {
  return value.replace(/[\\/:*?"<>|]/g, "-").trim();
}

function toRepoPath(path) {
  const value = relative(REPO_ROOT, path);
  return value.startsWith("..") ? path : value.split(sep).join("/");
}

function printHelp() {
  console.log(`用法：
  npm run transcribe -- --input <media> [--name <name>] [--model small]
  npm run setup -- --model small

参数：
  --output-dir <dir>  覆盖默认输出目录 工作区/数据/草稿
  --model <name>      tiny、base、small、medium、large-v3-turbo
  --language <code>   Whisper 语言代码，默认 zh
  --force             覆盖已有逐字稿输出
  --install-only      只安装 Whisper.cpp 和所选模型
`);
}
