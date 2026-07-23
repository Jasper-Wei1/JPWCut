import { z } from "zod";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const LivestreamClipDataSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    template: z.literal("livestream-clip-916"),
    durationMs: z.number().int().positive(),
    masterVideo: z.object({
      sourcePath: z.string().min(1),
      asset: z.string().min(1),
    }),
    masterTranscript: z.object({
      sourcePath: z.string().min(1),
      asset: z.string().min(1),
    }),
    output: z.object({
      width: z.literal(1080),
      height: z.literal(1920),
      fps: z.literal(30),
      platforms: z.array(z.enum(["douyin", "xiaohongshu"])).min(1),
    }),
    presentation: z
      .object({
        objectFit: z.literal("cover"),
        objectPosition: z.string().default("center center"),
        canvas: color.default("#000000"),
        text: color.default("#ffffff"),
      })
      .strict(),
    captions: z
      .object({
        maxCharsPerPage: z.number().int().min(10).max(24).default(18),
        areaHeight: z.number().int().min(180).max(700).default(520),
        bottomPadding: z.number().int().min(0).max(500).default(320),
      })
      .refine(({ areaHeight, bottomPadding }) => bottomPadding < areaHeight, {
        message: "Caption bottom padding must be smaller than its layout area.",
      }),
    audioPolicy: z.object({
      scope: z.literal("locked-master").default("locked-master"),
      masterAudioOnly: z.literal(true),
      changeMasterDuration: z.literal(false),
      reorderSpeech: z.literal(false),
    }),
    timelinePolicy: z
      .object({
        sourceRangeContinuous: z.literal(true),
      })
      .default({
        sourceRangeContinuous: true,
      }),
    qa: z.object({
      masterTimelineLocked: z.literal(true),
      cropToFill: z.literal(true),
      privacyMaskRequired: z.literal(false),
      assetPathsChecked: z.boolean(),
      stillRendered: z.boolean(),
      previewMethod: z.literal("studio"),
      previewApproved: z.boolean(),
      readyToRender: z.boolean(),
    }),
  })
  .strict()
  .superRefine((data, context) => {
    if (
      data.qa.readyToRender &&
      (!data.qa.assetPathsChecked ||
        !data.qa.stillRendered ||
        !data.qa.previewApproved)
    ) {
      context.addIssue({
        code: "custom",
        path: ["qa", "readyToRender"],
        message:
          "Final render requires checked assets, stills, and Studio approval.",
      });
    }
  });

export const LivestreamClipCompositionPropsSchema = z.object({
  dataFile: z.string().min(1),
  data: LivestreamClipDataSchema.optional(),
});

export const LivestreamClipBatchSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  clips: z.array(LivestreamClipDataSchema).min(1),
});

export const LivestreamClipBatchPropsSchema = z.object({
  dataFile: z.string().min(1),
  data: LivestreamClipBatchSchema.optional(),
});

export type LivestreamClipData = z.infer<typeof LivestreamClipDataSchema>;
export type LivestreamClipCompositionProps = z.infer<
  typeof LivestreamClipCompositionPropsSchema
>;
export type LivestreamClipBatch = z.infer<typeof LivestreamClipBatchSchema>;
export type LivestreamClipBatchProps = z.infer<
  typeof LivestreamClipBatchPropsSchema
>;
