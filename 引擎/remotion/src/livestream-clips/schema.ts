import { z } from "zod";

export const ClipReviewCandidateSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(60),
  corePoint: z.string().min(1).max(120),
  sourceStartMs: z.number().int().nonnegative(),
  sourceEndMs: z.number().int().positive(),
  durationMs: z.number().int().positive(),
  timelineStartMs: z.number().int().nonnegative(),
  timelineEndMs: z.number().int().positive(),
  totalScore: z.number().int().min(0).max(100),
  reviewStatus: z.enum(["pending", "approved", "rejected"]),
  boundaryNote: z.string().nullable(),
});

export const ClipReviewPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    workflow: z.literal("clip-extraction-review"),
    id: z.string().min(1),
    createdAt: z.string().min(1),
    sourceVideo: z.object({
      sourcePath: z.string().min(1),
      asset: z.string().min(1),
      fingerprint: z.object({
        size: z.number().nonnegative(),
        mtimeMs: z.number().nonnegative(),
      }),
    }),
    sourceDurationMs: z.number().int().positive(),
    sourceMedia: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      fps: z.number().int().positive(),
      hasAudio: z.literal(true),
    }),
    preview: z.object({
      width: z.literal(1080),
      height: z.literal(1920),
      fps: z.literal(30),
      durationMs: z.number().int().positive(),
      method: z.literal("studio"),
      status: z.enum(["pending", "approved"]),
      approvedAt: z.string().nullable(),
    }),
    candidates: z.array(ClipReviewCandidateSchema).min(1),
  })
  .superRefine((data, context) => {
    let cursor = 0;
    const ids = new Set<string>();
    data.candidates.forEach((candidate, index) => {
      if (ids.has(candidate.id)) {
        context.addIssue({
          code: "custom",
          path: ["candidates", index, "id"],
          message: "candidate ids must be unique",
        });
      }
      ids.add(candidate.id);
      const sourceDuration = candidate.sourceEndMs - candidate.sourceStartMs;
      if (
        sourceDuration !== candidate.durationMs ||
        sourceDuration < 30000 ||
        sourceDuration > 90000
      ) {
        context.addIssue({
          code: "custom",
          path: ["candidates", index, "durationMs"],
          message:
            "candidate duration must match one 30-90 second source range",
        });
      }
      if (candidate.sourceEndMs > data.sourceDurationMs) {
        context.addIssue({
          code: "custom",
          path: ["candidates", index, "sourceEndMs"],
          message: "candidate exceeds source duration",
        });
      }
      if (
        candidate.timelineStartMs !== cursor ||
        candidate.timelineEndMs !== cursor + sourceDuration
      ) {
        context.addIssue({
          code: "custom",
          path: ["candidates", index, "timelineStartMs"],
          message: "review timeline must be contiguous",
        });
      }
      cursor += sourceDuration;
    });
    if (cursor !== data.preview.durationMs) {
      context.addIssue({
        code: "custom",
        path: ["preview", "durationMs"],
        message: "preview duration must equal the candidate review timeline",
      });
    }
    if (
      data.preview.status === "approved" &&
      data.candidates.some(({ reviewStatus }) => reviewStatus === "pending")
    ) {
      context.addIssue({
        code: "custom",
        path: ["preview", "status"],
        message: "approved preview cannot contain pending candidates",
      });
    }
  });

export const ClipReviewCompositionPropsSchema = z.object({
  dataFile: z.string().min(1),
  data: ClipReviewPlanSchema.optional(),
});

export type ClipReviewPlan = z.infer<typeof ClipReviewPlanSchema>;
export type ClipReviewCandidate = z.infer<typeof ClipReviewCandidateSchema>;
export type ClipReviewCompositionProps = z.infer<
  typeof ClipReviewCompositionPropsSchema
>;
