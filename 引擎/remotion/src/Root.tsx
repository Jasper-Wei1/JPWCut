import "./index.css";
import { Composition, Folder } from "remotion";
import { LivestreamClipReview } from "./livestream-clips/LivestreamClipReview";
import { LivestreamClip916 } from "./livestream-clips/LivestreamClip916";
import { LivestreamClipVisualReview } from "./livestream-clips/LivestreamClipVisualReview";
import { calculateClipReviewMetadata } from "./livestream-clips/data-loader";
import { ClipReviewCompositionPropsSchema } from "./livestream-clips/schema";
import {
  calculateLivestreamClipBatchMetadata,
  calculateLivestreamClipMetadata,
} from "./livestream-clips/video-data-loader";
import {
  LivestreamClipBatchPropsSchema,
  LivestreamClipCompositionPropsSchema,
} from "./livestream-clips/video-schema";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Folder name="Workflow">
        <Composition
          id="LivestreamClipVisualReview"
          component={LivestreamClipVisualReview}
          durationInFrames={10440}
          fps={30}
          width={1080}
          height={1920}
          schema={LivestreamClipBatchPropsSchema}
          defaultProps={{
            dataFile: "workflow/livestream-visual-review-demo.json",
          }}
          calculateMetadata={calculateLivestreamClipBatchMetadata}
        />
        <Composition
          id="LivestreamClipReview"
          component={LivestreamClipReview}
          durationInFrames={10440}
          fps={30}
          width={1080}
          height={1920}
          schema={ClipReviewCompositionPropsSchema}
          defaultProps={{ dataFile: "workflow/clip-review-hook-demo.json" }}
          calculateMetadata={calculateClipReviewMetadata}
        />
      </Folder>
      <Folder name="Templates">
        <Composition
          id="LivestreamClip916"
          component={LivestreamClip916}
          durationInFrames={960}
          fps={30}
          width={1080}
          height={1920}
          schema={LivestreamClipCompositionPropsSchema}
          defaultProps={{ dataFile: "video-data/livestream-clip-demo.json" }}
          calculateMetadata={calculateLivestreamClipMetadata}
        />
      </Folder>
    </>
  );
};
