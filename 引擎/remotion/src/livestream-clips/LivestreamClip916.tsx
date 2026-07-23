import { fitText } from "@remotion/layout-utils";
import { useCallback, useEffect, useState } from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  staticFile,
  useDelayRender,
  useVideoConfig,
} from "remotion";
import type {
  LivestreamClipCompositionProps,
  LivestreamClipData,
} from "./video-schema";

type Transcript = {
  utterances: Array<{ text: string; startMs: number; endMs: number }>;
};

type CaptionCue = {
  text: string;
  startMs: number;
  endMs: number;
};

export const LivestreamClip916: React.FC<
  LivestreamClipCompositionProps
> = ({ data }) => {
  if (!data) throw new Error("LivestreamClip916 requires calculated data");
  return (
    <AbsoluteFill style={{ background: data.presentation.canvas }}>
      <OffthreadVideo
        src={staticFile(data.masterVideo.asset)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: data.presentation.objectFit,
          objectPosition: data.presentation.objectPosition,
        }}
      />

      <LivestreamCaptions data={data} />
    </AbsoluteFill>
  );
};

const LivestreamCaptions: React.FC<{ data: LivestreamClipData }> = ({
  data,
}) => {
  const [captions, setCaptions] = useState<CaptionCue[] | null>(null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender("Loading livestream captions"));

  const load = useCallback(async () => {
    try {
      const response = await fetch(staticFile(data.masterTranscript.asset));
      if (!response.ok) {
        throw new Error(
          `Could not load transcript ${data.masterTranscript.asset}: ${response.status}`,
        );
      }
      const transcript = (await response.json()) as Transcript;
      setCaptions(
        transcript.utterances.flatMap((utterance) =>
          splitUtterance(utterance, data.captions.maxCharsPerPage),
        ),
      );
      continueRender(handle);
    } catch (error) {
      cancelRender(error instanceof Error ? error : new Error(String(error)));
    }
  }, [cancelRender, continueRender, data, handle]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!captions) return null;
  return <CaptionTimeline captions={captions} data={data} />;
};

const CaptionTimeline: React.FC<{
  captions: CaptionCue[];
  data: LivestreamClipData;
}> = ({ captions, data }) => {
  const { fps } = useVideoConfig();
  return (
    <>
      {captions.map((caption, index) => (
        <Sequence
          key={`${caption.startMs}-${index}`}
          from={Math.round((caption.startMs / 1000) * fps)}
          durationInFrames={Math.max(
            1,
            Math.round(((caption.endMs - caption.startMs) / 1000) * fps),
          )}
          premountFor={fps}
        >
          <CaptionText caption={caption} data={data} />
        </Sequence>
      ))}
    </>
  );
};

const CaptionText: React.FC<{
  caption: CaptionCue;
  data: LivestreamClipData;
}> = ({ caption, data }) => {
  const fontFamily =
    '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
  const fitted = fitText({
    text: caption.text,
    withinWidth: 940,
    fontFamily,
    fontWeight: 850,
    letterSpacing: "0px",
    validateFontIsLoaded: false,
  }).fontSize;
  const fontSize = Math.max(42, Math.min(54, fitted));
  return (
    <div
      style={{
        position: "absolute",
        left: 60,
        right: 60,
        bottom: data.captions.bottomPadding,
        height: data.captions.areaHeight - data.captions.bottomPadding,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: data.presentation.text,
        fontFamily,
        fontSize,
        fontWeight: 850,
        lineHeight: 1.28,
        letterSpacing: 0,
        textAlign: "center",
        overflowWrap: "anywhere",
        WebkitTextStroke: "2px rgba(0, 0, 0, 0.82)",
        textShadow:
          "0 3px 8px rgba(0, 0, 0, 0.95), 0 0 18px rgba(0, 0, 0, 0.72)",
      }}
    >
      {caption.text}
    </div>
  );
};

const splitUtterance = (
  utterance: { text: string; startMs: number; endMs: number },
  maxChars: number,
): CaptionCue[] => {
  const characters = Array.from(utterance.text.trim());
  const chunks: string[] = [];
  for (let index = 0; index < characters.length; index += maxChars) {
    chunks.push(characters.slice(index, index + maxChars).join(""));
  }
  return chunks.map((text, index) => ({
    text,
    startMs:
      utterance.startMs +
      Math.round(
        ((utterance.endMs - utterance.startMs) * index) / chunks.length,
      ),
    endMs:
      utterance.startMs +
      Math.round(
        ((utterance.endMs - utterance.startMs) * (index + 1)) / chunks.length,
      ),
  }));
};
