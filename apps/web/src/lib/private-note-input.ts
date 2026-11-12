import { z } from "zod";

export const privateNotePrefix = "note:";
export const privateNoteId = z.string().regex(/^note:[0-9a-fA-F-]{36}$/);

export const privateNotePayload = z.object({
  kind: z.literal("private_research_note"),
  title: z.string().trim().min(1).max(160),
  context_kind: z.enum(["incident", "lead"]),
  context_id: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(16000),
}).strict();

export const privateNoteSave = z.object({
  id: privateNoteId,
  expected_revision: z.number().int().nonnegative(),
  payload: privateNotePayload,
}).strict();

export const privateNoteDelete = z.object({
  id: privateNoteId,
  expected_revision: z.number().int().positive(),
}).strict();

export const isPrivateNoteId = (id: unknown) =>
  typeof id === "string" && id.startsWith(privateNotePrefix);

export type PrivateNotePayload = z.infer<typeof privateNotePayload>;
export type PrivateNote = {
  id: string;
  revision: number;
  payload: PrivateNotePayload;
  updated_at: string;
};
