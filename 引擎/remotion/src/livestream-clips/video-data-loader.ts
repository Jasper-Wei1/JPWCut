import type { CalculateMetadataFunction } from "remotion";
import { staticFile } from "remotion";
import {
  LivestreamClipBatchSchema,
  LivestreamClipDataSchema,
  type LivestreamClipBatchProps,
  type LivestreamClipCompositionProps,
} from "./video-schema";

export const calculateLivestreamClipMetadata: CalculateMetadataFunction<
  LivestreamClipCompositionProps
> = async ({ props, abortSignal }) => {
  const response = await fetch(staticFile(props.dataFile), {
    signal: abortSignal,
  });
  if (!response.ok) {
    throw new Error(`Could not load ${props.dataFile}: ${response.status}`);
  }
  const data = LivestreamClipDataSchema.parse(await response.json());
  return {
    durationInFrames: Math.max(
      1,
      Math.round((data.durationMs / 1000) * data.output.fps),
    ),
    width: data.output.width,
    height: data.output.height,
    fps: data.output.fps,
    defaultOutName: `${data.id}-9x16`,
    props: { ...props, data },
  };
};

export const calculateLivestreamClipBatchMetadata: CalculateMetadataFunction<
  LivestreamClipBatchProps
> = async ({ props, abortSignal }) => {
  const response = await fetch(staticFile(props.dataFile), {
    signal: abortSignal,
  });
  if (!response.ok) {
    throw new Error(`Could not load ${props.dataFile}: ${response.status}`);
  }
  const data = LivestreamClipBatchSchema.parse(await response.json());
  const durationMs = data.clips.reduce((sum, clip) => sum + clip.durationMs, 0);
  return {
    durationInFrames: Math.max(1, Math.round((durationMs / 1000) * 30)),
    width: 1080,
    height: 1920,
    fps: 30,
    defaultOutName: `${data.id}-visual-review`,
    props: { ...props, data },
  };
};
