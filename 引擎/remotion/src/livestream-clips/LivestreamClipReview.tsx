import { CheckCircle2, Clock3, Eye, XCircle } from "lucide-react";
import {
  AbsoluteFill,
  OffthreadVideo,
  Series,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type {
  ClipReviewCandidate,
  ClipReviewCompositionProps,
  ClipReviewPlan,
} from "./schema";

const STATUS = {
  pending: { label: "待检查切点", color: "#ffd166", icon: Eye },
  approved: {
    label: "切点已批准",
    color: "#6ee7a8",
    icon: CheckCircle2,
  },
  rejected: { label: "已淘汰", color: "#ff7a7a", icon: XCircle },
} as const;

export const LivestreamClipReview: React.FC<ClipReviewCompositionProps> = ({
  data,
}) => {
  if (!data) throw new Error("LivestreamClipReview requires calculated data");
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        background: "#080a0b",
        color: "#ffffff",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
      }}
    >
      <Series>
        {data.candidates.map((candidate, index) => (
          <Series.Sequence
            key={candidate.id}
            durationInFrames={Math.max(
              1,
              Math.round(
                (candidate.durationMs / 1000) * fps,
              ),
            )}
            premountFor={fps}
          >
            <CandidateSegment candidate={candidate} data={data} index={index} />
          </Series.Sequence>
        ))}
      </Series>
      <GlobalProgress data={data} />
    </AbsoluteFill>
  );
};

const CandidateSegment: React.FC<{
  candidate: ClipReviewCandidate;
  data: ClipReviewPlan;
  index: number;
}> = ({ candidate, data, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const status = STATUS[candidate.reviewStatus];
  const StatusIcon = status.icon;
  const elapsedMs = (frame / fps) * 1000;
  const sourceTimeMs = candidate.sourceStartMs + elapsedMs;
  const remainingMs = candidate.durationMs - elapsedMs;
  const showEntry = frame < fps * 2;
  const showExit = remainingMs <= 2000;

  return (
    <AbsoluteFill>
      <SourceSegment
        asset={data.sourceVideo.asset}
        sourceStartMs={candidate.sourceStartMs}
        sourceEndMs={candidate.sourceEndMs}
      />

      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          minHeight: 74,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 18,
          padding: "10px 22px",
          background: "rgba(8, 10, 11, 0.9)",
          borderBottom: "1px solid rgba(255,255,255,0.22)",
          fontSize: 24,
          fontWeight: 750,
        }}
      >
        <span>
          直播切片切点审核 {index + 1}/{data.candidates.length}
        </span>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: status.color,
            whiteSpace: "nowrap",
          }}
        >
          <StatusIcon size={25} />
          {status.label}
        </span>
      </div>

      <div
        style={{
          position: "absolute",
          top: 96,
          left: 22,
          right: 22,
          padding: "14px 17px",
          background: "rgba(8, 10, 11, 0.8)",
          border: "1px solid rgba(255,255,255,0.25)",
          borderRadius: 6,
        }}
      >
        <div style={{ color: "#ffd166", fontSize: 22, fontWeight: 800 }}>
          {candidate.id} · {candidate.totalScore} 分
        </div>
        <div
          style={{
            marginTop: 5,
            fontSize: 31,
            lineHeight: 1.25,
            fontWeight: 850,
          }}
        >
          {candidate.title}
        </div>
      </div>

      {showEntry ? (
        <BoundaryNotice
          label="检查开头"
          detail={`原片 ${formatTimestamp(candidate.sourceStartMs)}`}
        />
      ) : null}
      {showExit ? (
        <BoundaryNotice
          label="检查结尾"
          detail={`原片 ${formatTimestamp(candidate.sourceEndMs)}`}
        />
      ) : null}

      <div
        style={{
          position: "absolute",
          right: 20,
          bottom: 82,
          padding: "8px 11px",
          borderRadius: 5,
          background: "rgba(0, 0, 0, 0.75)",
          fontSize: 21,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        原片 {formatTimestamp(sourceTimeMs)}
      </div>
    </AbsoluteFill>
  );
};

const SourceSegment: React.FC<{
  asset: string;
  sourceStartMs: number;
  sourceEndMs: number;
}> = ({ asset, sourceStartMs, sourceEndMs }) => {
  const { fps } = useVideoConfig();
  return (
    <OffthreadVideo
      src={staticFile(asset)}
      trimBefore={Math.round((sourceStartMs / 1000) * fps)}
      trimAfter={Math.round((sourceEndMs / 1000) * fps)}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        objectPosition: "center center",
        background: "#000000",
      }}
    />
  );
};

const BoundaryNotice: React.FC<{ label: string; detail: string }> = ({
  label,
  detail,
}) => (
  <div
    style={{
      position: "absolute",
      left: 22,
      bottom: 82,
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "9px 12px",
      borderRadius: 5,
      color: "#111315",
      background: "#ffd166",
      fontSize: 21,
      fontWeight: 850,
    }}
  >
    <Clock3 size={24} />
    <span>{label}</span>
    <span style={{ fontWeight: 650 }}>{detail}</span>
  </div>
);

const GlobalProgress: React.FC<{ data: ClipReviewPlan }> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 62,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 18,
        padding: "0 20px",
        background: "rgba(8, 10, 11, 0.92)",
        borderTop: "1px solid rgba(255,255,255,0.22)",
        fontSize: 20,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span>
        审核时间轴 {formatTimestamp((frame / fps) * 1000)} /{" "}
        {formatTimestamp(data.preview.durationMs)}
      </span>
      <span>每条只播放一个连续原片区间</span>
    </div>
  );
};

const formatTimestamp = (value: number) => {
  const totalSeconds = Math.max(0, value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${seconds
    .toFixed(1)
    .padStart(4, "0")}`;
};
