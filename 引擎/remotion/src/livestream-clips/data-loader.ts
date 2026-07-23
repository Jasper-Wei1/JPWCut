import type { CalculateMetadataFunction } from "remotion";
import { staticFile } from "remotion";
import {
  ClipReviewPlanSchema,
  type ClipReviewCompositionProps,
} from "./schema";

export const calculateClipReviewMetadata: CalculateMetadataFunction<
  ClipReviewCompositionProps
> = async ({ props, abortSignal }) => {
  const response = await fetch(staticFile(props.dataFile), {
    signal: abortSignal,
  });
  if (!response.ok) {
    throw new Error(
      `Could not load livestream clip review ${props.dataFile}: ${response.status}`,
    );
  }
  const data = ClipReviewPlanSchema.parse(await response.json());
  return {
    durationInFrames: Math.max(
      1,
      Math.round((data.preview.durationMs / 1000) * data.preview.fps),
    ),
    width: data.preview.width,
    height: data.preview.height,
    fps: data.preview.fps,
    defaultOutName: `${data.id}-clip-boundary-review`,
    props: { ...props, data },
  };
};
