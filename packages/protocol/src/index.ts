/**
 * @repofloor/protocol
 *
 * The single contract every Repofloor component speaks.
 *
 *   GitHub webhooks / Actions / agent hooks  ──▶  OfficeEvent  ──▶  reducer  ──▶  OfficeState  ──▶  engine
 *
 * Rules:
 *  - The engine (renderer) only ever consumes OfficeEvent / OfficeState. It never knows
 *    whether events came from a static JSON file (Lite) or a WebSocket (Full).
 *  - Everything here is plain JSON. No classes, no Dates (ISO strings only).
 *  - Breaking changes bump PROTOCOL_VERSION. Consumers must reject unknown major versions.
 */

export const PROTOCOL_VERSION = "1.0.0" as const;

// ─────────────────────────────────────────────────────────────────────────────
// Identity
// ─────────────────────────────────────────────────────────────────────────────

/** GitHub login, e.g. "aliosmanmho". Agents use "agent:<owner>:<name>". */
export type ActorId = string;

export type ActorKind = "human" | "agent" | "bot";

/** Which coding agent produced an event (for avatar skins and tooltips). */
export type AgentProvider =
  | "claude-code"
  | "codex"
  | "gemini-cli"
  | "copilot"
  | "cursor"
  | "aider"
  | "other";

export interface Actor {
  id: ActorId;
  kind: ActorKind;
  /** Display name; falls back to id. */
  name?: string;
  avatarUrl?: string;
  /** User-chosen emoji shown above the avatar (Full mode, persisted). */
  emoji?: string;
  /** For kind === "agent": which provider, and which human owns it. */
  agent?: {
    provider: AgentProvider;
    ownerId: ActorId;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hierarchy: Building (org/user) ▸ Office (repo) ▸ Room
// ─────────────────────────────────────────────────────────────────────────────

export interface Building {
  /** GitHub org or user login. */
  id: string;
  name: string;
  kind: "organization" | "user";
  avatarUrl?: string;
}

export interface Office {
  /** "owner/repo" */
  id: string;
  buildingId: string;
  name: string;
  description?: string;
  defaultBranch?: string;
  private?: boolean;
}

export type RoomKind =
  | "floor"      // the open-plan area; every office has exactly one
  | "team"       // auto-created from a GitHub Team
  | "custom"     // user-created
  | "meeting"    // transient, e.g. a PR review huddle
  | "focus";     // personal do-not-disturb room

export interface Room {
  id: string;
  officeId: string;
  kind: RoomKind;
  name: string;
  /** Approximate capacity hint for layout; engine may ignore. */
  capacity?: number;
  /** For kind === "team": the GitHub team slug. */
  teamSlug?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Presence & activity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What an actor is doing right now, as derived by the reducer.
 * The engine maps each status to an animation.
 */
export type ActivityStatus =
  | "offline"     // not seen recently
  | "idle"        // present but no activity
  | "coding"      // recent commits / agent edits
  | "reviewing"   // reviewing a PR
  | "discussing"  // commenting on issues/PRs
  | "building"    // their CI run is in progress
  | "blocked"     // their CI failed / PR has conflicts
  | "celebrating" // a merge just landed
  | "in_room"     // sitting in a room (chat/meeting)
  | "focus";      // DND

export interface ActorState {
  actor: Actor;
  status: ActivityStatus;
  /** Which room they are in; undefined = main floor. */
  roomId?: string;
  /** ISO timestamp of the last event that touched this actor. */
  lastSeen: string;
  /** Free-form, short, human-readable: "feat/login", "PR #42", "running tests". */
  detail?: string;
  /** Deep link for tooltip (PR, commit, issue). */
  link?: string;
  /** Rolling window of recent agent tool calls, newest last. */
  agentTrail?: AgentToolCall[];
}

export interface AgentToolCall {
  at: string;
  /** e.g. "Read", "Edit", "Bash", "Grep" */
  tool: string;
  /** e.g. "src/engine/scene.ts" or "pnpm test" — truncated by producers to <= 120 chars. */
  target?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Office-level objects that render as props on the floor
// ─────────────────────────────────────────────────────────────────────────────

export type CiStatus = "queued" | "running" | "success" | "failure" | "cancelled";

export interface PullRequestSummary {
  number: number;
  title: string;
  authorId: ActorId;
  url: string;
  draft: boolean;
  reviewerIds: ActorId[];
  ci?: CiStatus;
  updatedAt: string;
}

export interface IssueSummary {
  number: number;
  title: string;
  assigneeIds: ActorId[];
  url: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot: the complete state of one office at one moment
// ─────────────────────────────────────────────────────────────────────────────

export interface OfficeState {
  protocolVersion: typeof PROTOCOL_VERSION;
  generatedAt: string;
  building: Building;
  office: Office;
  rooms: Room[];
  actors: ActorState[];
  pullRequests: PullRequestSummary[];
  issues: IssueSummary[];
  /** Latest CI status on the default branch. */
  defaultBranchCi?: CiStatus;
  /** Mode tells the engine what to expect (e.g. Lite has no live presence). */
  mode: "lite" | "full";
}

// ─────────────────────────────────────────────────────────────────────────────
// Events: the stream that changes state
// ─────────────────────────────────────────────────────────────────────────────

interface BaseEvent {
  /** Unique, idempotent id. Producers derive it from the upstream delivery id. */
  id: string;
  at: string;
  officeId: string;
}

export type OfficeEvent =
  | (BaseEvent & { type: "snapshot"; state: OfficeState })
  | (BaseEvent & { type: "actor.upsert"; actor: Actor })
  | (BaseEvent & { type: "actor.status"; actorId: ActorId; status: ActivityStatus; detail?: string; link?: string })
  | (BaseEvent & { type: "actor.move"; actorId: ActorId; roomId?: string })
  | (BaseEvent & { type: "actor.emoji"; actorId: ActorId; emoji: string })
  | (BaseEvent & { type: "actor.leave"; actorId: ActorId })
  | (BaseEvent & { type: "push"; actorId: ActorId; branch: string; commits: number; url?: string })
  | (BaseEvent & { type: "pr.opened"; pr: PullRequestSummary })
  | (BaseEvent & { type: "pr.updated"; pr: PullRequestSummary })
  | (BaseEvent & { type: "pr.review_requested"; number: number; reviewerId: ActorId })
  | (BaseEvent & { type: "pr.reviewed"; number: number; reviewerId: ActorId; verdict: "approved" | "changes_requested" | "commented" })
  | (BaseEvent & { type: "pr.merged"; number: number; actorId: ActorId })
  | (BaseEvent & { type: "pr.closed"; number: number })
  | (BaseEvent & { type: "issue.opened"; issue: IssueSummary; actorId: ActorId })
  | (BaseEvent & { type: "issue.assigned"; number: number; assigneeId: ActorId })
  | (BaseEvent & { type: "issue.commented"; number: number; actorId: ActorId })
  | (BaseEvent & { type: "issue.closed"; number: number; actorId: ActorId })
  | (BaseEvent & { type: "ci.status"; status: CiStatus; branch: string; actorId?: ActorId; prNumber?: number; url?: string })
  | (BaseEvent & { type: "agent.tool_call"; actorId: ActorId; call: AgentToolCall })
  | (BaseEvent & { type: "agent.session"; actorId: ActorId; phase: "start" | "end" })
  | (BaseEvent & { type: "room.created"; room: Room })
  | (BaseEvent & { type: "room.deleted"; roomId: string })
  | (BaseEvent & { type: "chat.message"; roomId: string; actorId: ActorId; text: string });

export type OfficeEventType = OfficeEvent["type"];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function agentActorId(ownerId: ActorId, provider: AgentProvider, name: string = provider): ActorId {
  return `agent:${ownerId}:${name}`;
}

export function isAgent(actor: Actor): boolean {
  return actor.kind === "agent";
}

export function emptyOfficeState(building: Building, office: Office, mode: OfficeState["mode"]): OfficeState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    generatedAt: new Date().toISOString(),
    building,
    office,
    rooms: [{ id: `${office.id}#floor`, officeId: office.id, kind: "floor", name: "Floor" }],
    actors: [],
    pullRequests: [],
    issues: [],
    mode,
  };
}

/** Minimal structural validation (no dependency on a schema library). */
export function assertOfficeState(value: unknown): asserts value is OfficeState {
  if (typeof value !== "object" || value === null) throw new Error("OfficeState: not an object");
  const v = value as Record<string, unknown>;
  if (typeof v["protocolVersion"] !== "string") throw new Error("OfficeState: missing protocolVersion");
  const major = (v["protocolVersion"] as string).split(".")[0];
  if (major !== PROTOCOL_VERSION.split(".")[0]) {
    throw new Error(`OfficeState: protocol major mismatch (${v["protocolVersion"]} vs ${PROTOCOL_VERSION})`);
  }
  for (const key of ["building", "office", "rooms", "actors", "pullRequests", "issues", "mode"]) {
    if (!(key in v)) throw new Error(`OfficeState: missing ${key}`);
  }
}
