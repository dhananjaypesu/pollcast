import { z } from "zod";
import { LIMITS } from "../../shared/types.js";
import { AppError } from "./errors.js";

const text = (max: number, label: string) =>
  z
    .string({ error: `${label} is required` })
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(1, `${label} is required`)
        .max(max, `${label} must be ${max} characters or fewer`),
    );

const id = z.number().int().positive();

export const schemas = {
  createSession: z.object({ title: text(LIMITS.titleMax, "Title") }),
  join: z.object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/, "Codes are 6 letters or numbers"),
    role: z.enum(["host", "audience", "screen"]),
    participantId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
    hostToken: z.string().max(200).optional(),
  }),
  createPoll: z
    .object({
      question: text(LIMITS.questionMax, "Question"),
      options: z.array(text(LIMITS.optionMax, "Option")),
    })
    .refine((p) => p.options.length >= LIMITS.optionsMin && p.options.length <= LIMITS.optionsMax, {
      message: `Add between ${LIMITS.optionsMin} and ${LIMITS.optionsMax} options`,
      path: ["options"],
    })
    .refine((p) => new Set(p.options.map((o) => o.toLowerCase())).size === p.options.length, {
      message: "Options must be different from each other",
      path: ["options"],
    }),
  pollRef: z.object({ pollId: id }),
  vote: z.object({ pollId: id, optionId: id }),
  ask: z.object({
    text: text(LIMITS.askMax, "Question"),
    author: z
      .string()
      .transform((s) => s.trim())
      .pipe(z.string().max(LIMITS.authorMax, `Name must be ${LIMITS.authorMax} characters or fewer`))
      .optional(),
  }),
  questionRef: z.object({ questionId: id }),
  answer: z.object({ questionId: id, answered: z.boolean() }),
  hide: z.object({ questionId: id, hidden: z.boolean() }),
};

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const details: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "_";
    details[key] ??= issue.message;
  }
  throw new AppError(Object.values(details)[0] ?? "Invalid input", 422, details);
}
