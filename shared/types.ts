// Types shared by the server and the browser client.

export type PollStatus = "draft" | "open" | "closed";
export type Role = "host" | "audience" | "screen";

export interface PollOption {
  id: number;
  label: string;
  votes: number;
}

export interface Poll {
  id: number;
  question: string;
  status: PollStatus;
  options: PollOption[];
  totalVotes: number;
  createdAt: string;
}

export interface Question {
  id: number;
  text: string;
  author: string | null;
  upvotes: number;
  answered: boolean;
  hidden: boolean;
  createdAt: string;
}

export interface SessionInfo {
  code: string;
  title: string;
  createdAt: string;
  endedAt: string | null;
}

export interface SessionState {
  session: SessionInfo;
  polls: Poll[];
  activePollId: number | null;
  questions: Question[];
  audienceCount: number;
}

/** What this particular participant has done, so the UI can show "your vote". */
export interface ParticipantState {
  votes: Record<number, number>; // pollId -> optionId
  upvoted: number[]; // questionIds
}

export type Ack<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; details?: Record<string, string> };

export interface JoinPayload {
  code: string;
  role: Role;
  participantId?: string;
  hostToken?: string;
}

export interface JoinResult {
  role: Role;
  state: SessionState;
  me: ParticipantState;
}

export interface ClientToServerEvents {
  join: (payload: JoinPayload, ack: (res: Ack<JoinResult>) => void) => void;
  "poll:create": (p: { question: string; options: string[] }, ack: (res: Ack<{ pollId: number }>) => void) => void;
  "poll:open": (p: { pollId: number }, ack: (res: Ack) => void) => void;
  "poll:close": (p: { pollId: number }, ack: (res: Ack) => void) => void;
  "poll:delete": (p: { pollId: number }, ack: (res: Ack) => void) => void;
  "poll:reset": (p: { pollId: number }, ack: (res: Ack) => void) => void;
  vote: (p: { pollId: number; optionId: number }, ack: (res: Ack<ParticipantState>) => void) => void;
  "question:ask": (p: { text: string; author?: string }, ack: (res: Ack<{ questionId: number }>) => void) => void;
  "question:upvote": (p: { questionId: number }, ack: (res: Ack<ParticipantState>) => void) => void;
  "question:answer": (p: { questionId: number; answered: boolean }, ack: (res: Ack) => void) => void;
  "question:hide": (p: { questionId: number; hidden: boolean }, ack: (res: Ack) => void) => void;
  "session:end": (ack: (res: Ack) => void) => void;
}

export interface ServerToClientEvents {
  state: (state: SessionState) => void;
}

export const LIMITS = {
  titleMax: 80,
  questionMax: 160,
  optionMax: 60,
  optionsMin: 2,
  optionsMax: 6,
  askMax: 240,
  authorMax: 40,
} as const;
