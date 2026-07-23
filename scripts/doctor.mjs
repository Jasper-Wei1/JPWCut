#!/usr/bin/env node

import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import {
  commandLocator,
  remotionCliPath,
  requiredPlatformTools,
  whisperExecutableName,
} from "./platform.mjs";

const root = resolve(import.meta.dirname, "..");
const checks = [];

const add = (name, ok, detail) => checks.push({ name, ok, detail });
const nodeMajor = Number(process.versions.node.split(".")[0]);

add("Node.js 20+", nodeMajor >= 20, process.version);
add(
  "受支持的平台",
  process.platform !== "win32" || process.arch === "x64",
  process.platform === "win32" ? `Windows ${process.arch}` : process.platform,
);
for (const tool of requiredPlatformTools()) {
  add(
    tool === "powershell.exe" ? "Windows PowerShell" : "Make",
    commandExists(tool),
    tool === "powershell.exe"
      ? "用于安装 Windows Whisper 二进制"
      : "用于编译本地 Whisper.cpp",
  );
}
add(
  "Remotion 工程",
  existsSync(join(root, "引擎/remotion/package.json")),
  "引擎/remotion/package.json",
);
add(
  "项目依赖",
  existsSync(remotionCliPath(join(root, "引擎/remotion"))),
  "缺失时运行 npm run setup",
);
add(
  "本地 Whisper.cpp",
  existsSync(
    join(
      root,
      "工作区/缓存/whisper.cpp",
      whisperExecutableName(),
    ),
  ),
  "由 npm run setup 安装",
);
add(
  "Whisper small 模型",
  fileHasSize(
    join(root, "工作区/缓存/whisper.cpp/ggml-small.bin"),
    487601967,
  ),
  "约 488 MB",
);
add(
  "直播原片输入目录",
  existsSync(join(root, "输入/媒体素材/直播录像")),
  "输入/媒体素材/直播录像/",
);

for (const check of checks) {
  console.log(`${check.ok ? "正常" : "缺失"}  ${check.name} - ${check.detail}`);
}

function fileHasSize(path, expectedSize) {
  return existsSync(path) && statSync(path).size === expectedSize;
}

function commandExists(command) {
  return spawnSync(commandLocator(), [command], { stdio: "ignore" }).status === 0;
}

if (checks.some((check) => !check.ok)) {
  console.error("\n环境尚未就绪。请按照 README.md 运行 npm run setup。");
  process.exitCode = 1;
} else {
  console.log("\n环境检查通过。");
}
