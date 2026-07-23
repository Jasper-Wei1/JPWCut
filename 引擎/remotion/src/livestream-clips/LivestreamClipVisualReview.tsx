import { AbsoluteFill, Series, useVideoConfig } from "remotion";
import { LivestreamClip916 } from "./LivestreamClip916";
import type { LivestreamClipBatchProps } from "./video-schema";

export const LivestreamClipVisualReview: React.FC<
  LivestreamClipBatchProps
> = ({ data }) => {
  if (!data) {
    throw new Error("LivestreamClipVisualReview requires calculated data");
  }
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: "#101315" }}>
      <Series>
        {data.clips.map((clip) => (
          <Series.Sequence
            key={clip.id}
            durationInFrames={Math.max(
              1,
              Math.round((clip.durationMs / 1000) * fps),
            )}
            premountFor={fps}
          >
            <LivestreamClip916 dataFile="" data={clip} />
          </Series.Sequence>
        ))}
      </Series>
    </AbsoluteFill>
  );
};
