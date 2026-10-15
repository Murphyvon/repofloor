/**
 * @repofloor/reducer
 *
 * Pure, deterministic: (OfficeState, OfficeEvent) => OfficeState.
 * Runs identically inside a GitHub Action (Lite), on the server (Full) and in the
 * browser (replay). Keep it free of I/O and of anything non-deterministic except the
 * timestamps carried by the events themselves.
 */

import type {
  Actor,
  ActorState,
  ActivityStatus,
  OfficeEvent,
  OfficeState,
} from "@repofloor/protocol";

export { githubToEvents } from "./github.js";
export type { GithubWebhook } from "./github.js";

/** How long an activity keeps an actor "busy" before decaying to idle / offline. */
export const DECAY = {
  /** coding/reviewing/discussing → idle */
  activeToIdleMs: 20 * 60 * 1000,
  /** idle → offline */
  idleToOfflineMs: 2 * 60 * 60 * 1000,
  /** celebrating → previous status */
  celebrateMs: 30 * 1000,
  /** how many agent tool calls to keep per agent */
  agentTrailLength: 12,
} as const;

const PRIORITY: Record<ActivityStatus, number> = {
  offline: 0,
  idle: 1,
  in_room: 2,
  discussing: 3,
  reviewing: 4,
  coding: 5,
  building: 6,
  blocked: 7,
  focus: 8,
  celebrating: 9,
};

function clone<T>(v: T): T {
  return structuredClone(v);
}

function findActor(state: OfficeState, id: string): ActorState | undefined {
  return state.actors.find((a) => a.actor.id === id);
}

function ensureActor(state: OfficeState, id: string, at: string, seed?: Partial<Actor>): ActorState {
  let a = findActor(state, id);
  if (!a) {
    const kind: Actor["kind"] = id.startsWith("agent:") ? "agent" : id.endsWith("[bot]") ? "bot" : "human";
    a = { actor: { id, kind, ...seed }, status: "idle", lastSeen: at };
    state.actors.push(a);
  }
  return a;
}

function setStatus(a: ActorState, status: ActivityStatus, at: string, detail?: string, link?: string) {
  a.status = status;
  a.lastSeen = at;
  if (detail !== undefined) a.detail = detail;
  if (link !== undefined) a.link = link;
}

/**
 * Bump status only if the new one is "more interesting" than the current one,
 * unless the current one is stale. Keeps webhook noise from flickering avatars.
 */
function bumpStatus(a: ActorState, status: ActivityStatus, at: string, detail?: string, link?: string) {
  const stale = Date.parse(at) - Date.parse(a.lastSeen) > DECAY.activeToIdleMs;
  if (stale || PRIORITY[status] >= PRIORITY[a.status] || a.status === "celebrating") {
    setStatus(a, status, at, detail, link);
  } else {
    a.lastSeen = at;
  }
}

export function reduce(prev: OfficeState, event: OfficeEvent): OfficeState {
  if (event.type === "snapshot") return clone(event.state);
  if (event.officeId !== prev.office.id) return prev;

  const state = clone(prev);
  const at = event.at;

  switch (event.type) {
    case "actor.upsert": {
      const a = ensureActor(state, event.actor.id, at, event.actor);
      a.actor = { ...a.actor, ...event.actor };
      break;
    }
    case "actor.status": {
      const a = ensureActor(state, event.actorId, at);
      setStatus(a, event.status, at, event.detail, event.link);
      break;
    }
    case "actor.move": {
      const a = ensureActor(state, event.actorId, at);
      if (event.roomId === undefined) {
        delete a.roomId;
        if (a.status === "in_room") a.status = "idle";
      } else {
        a.roomId = event.roomId;
        const room = state.rooms.find((r) => r.id === event.roomId);
        if (room?.kind === "focus") setStatus(a, "focus", at);
        else if (PRIORITY[a.status] < PRIORITY.in_room) setStatus(a, "in_room", at);
      }
      a.lastSeen = at;
      break;
    }
    case "actor.emoji": {
      const a = ensureActor(state, event.actorId, at);
      a.actor.emoji = event.emoji;
      break;
    }
    case "actor.leave": {
      const a = findActor(state, event.actorId);
      if (a) setStatus(a, "offline", at);
      break;
    }
    case "push": {
      const a = ensureActor(state, event.actorId, at);
      bumpStatus(a, "coding", at, event.branch, event.url);
      break;
    }
    case "pr.opened":
    case "pr.updated": {
      const idx = state.pullRequests.findIndex((p) => p.number === event.pr.number);
      if (idx >= 0) state.pullRequests[idx] = event.pr;
      else state.pullRequests.push(event.pr);
      const a = ensureActor(state, event.pr.authorId, at);
      bumpStatus(a, "coding", at, `PR #${event.pr.number}`, event.pr.url);
      for (const r of event.pr.reviewerIds) {
        const rv = ensureActor(state, r, at);
        bumpStatus(rv, "reviewing", at, `PR #${event.pr.number}`, event.pr.url);
      }
      break;
    }
    case "pr.review_requested": {
      const pr = state.pullRequests.find((p) => p.number === event.number);
      if (pr && !pr.reviewerIds.includes(event.reviewerId)) pr.reviewerIds.push(event.reviewerId);
      const a = ensureActor(state, event.reviewerId, at);
      bumpStatus(a, "reviewing", at, `PR #${event.number}`, pr?.url);
      break;
    }
    case "pr.reviewed": {
      const pr = state.pullRequests.find((p) => p.number === event.number);
      const a = ensureActor(state, event.reviewerId, at);
      bumpStatus(a, "reviewing", at, `PR #${event.number} · ${event.verdict.replace("_", " ")}`, pr?.url);
      if (pr && event.verdict === "changes_requested") {
        const author = ensureActor(state, pr.authorId, at);
        bumpStatus(author, "blocked", at, `PR #${pr.number} needs changes`, pr.url);
      }
      break;
    }
    case "pr.merged": {
      const pr = state.pullRequests.find((p) => p.number === event.number);
      state.pullRequests = state.pullRequests.filter((p) => p.number !== event.number);
      const a = ensureActor(state, event.actorId, at);
      setStatus(a, "celebrating", at, `merged #${event.number}`, pr?.url);
      if (pr && pr.authorId !== event.actorId) {
        setStatus(ensureActor(state, pr.authorId, at), "celebrating", at, `#${pr.number} merged!`, pr.url);
      }
      break;
    }
    case "pr.closed": {
      state.pullRequests = state.pullRequests.filter((p) => p.number !== event.number);
      break;
    }
    case "issue.opened": {
      if (!state.issues.some((i) => i.number === event.issue.number)) state.issues.push(event.issue);
      bumpStatus(ensureActor(state, event.actorId, at), "discussing", at, `#${event.issue.number}`, event.issue.url);
      break;
    }
    case "issue.assigned": {
      const issue = state.issues.find((i) => i.number === event.number);
      if (issue && !issue.assigneeIds.includes(event.assigneeId)) issue.assigneeIds.push(event.assigneeId);
      ensureActor(state, event.assigneeId, at);
      break;
    }
    case "issue.commented": {
      const issue = state.issues.find((i) => i.number === event.number);
      bumpStatus(ensureActor(state, event.actorId, at), "discussing", at, `#${event.number}`, issue?.url);
      break;
    }
    case "issue.closed": {
      state.issues = state.issues.filter((i) => i.number !== event.number);
      break;
    }
    case "ci.status": {
      if (event.prNumber !== undefined) {
        const pr = state.pullRequests.find((p) => p.number === event.prNumber);
        if (pr) pr.ci = event.status;
      }
      if (event.branch === (state.office.defaultBranch ?? "main")) state.defaultBranchCi = event.status;
      if (event.actorId) {
        const a = ensureActor(state, event.actorId, at);
        if (event.status === "running" || event.status === "queued") bumpStatus(a, "building", at, "CI running", event.url);
        else if (event.status === "failure") setStatus(a, "blocked", at, "CI failed", event.url);
        else if (event.status === "success") {
          if (a.status === "building" || a.status === "blocked") setStatus(a, "coding", at, "CI green", event.url);
          else a.lastSeen = at;
        }
      }
      break;
    }
    case "agent.session": {
      const a = ensureActor(state, event.actorId, at);
      if (event.phase === "start") setStatus(a, "coding", at, "session started");
      else setStatus(a, "idle", at, "session ended");
      break;
    }
    case "agent.tool_call": {
      const a = ensureActor(state, event.actorId, at);
      a.agentTrail = [...(a.agentTrail ?? []), event.call].slice(-DECAY.agentTrailLength);
      const t = event.call.tool.toLowerCase();
      const status: ActivityStatus = t === "bash" && /test|build|lint/.test(event.call.target ?? "") ? "building" : "coding";
      setStatus(a, status, at, `${event.call.tool} ${event.call.target ?? ""}`.trim());
      break;
    }
    case "room.created": {
      if (!state.rooms.some((r) => r.id === event.room.id)) state.rooms.push(event.room);
      break;
    }
    case "room.deleted": {
      state.rooms = state.rooms.filter((r) => r.id !== event.roomId);
      for (const a of state.actors) if (a.roomId === event.roomId) delete a.roomId;
      break;
    }
    case "chat.message": {
      const a = ensureActor(state, event.actorId, at);
      a.roomId = event.roomId;
      if (PRIORITY[a.status] < PRIORITY.in_room) setStatus(a, "in_room", at);
      a.lastSeen = at;
      break;
    }
  }

  state.generatedAt = at;
  return state;
}

/** Apply time decay without an event (call on a timer, or once after replay). */
export function decay(prev: OfficeState, nowIso: string): OfficeState {
  const now = Date.parse(nowIso);
  const state = clone(prev);
  for (const a of state.actors) {
    const age = now - Date.parse(a.lastSeen);
    if (a.status === "celebrating" && age > DECAY.celebrateMs) a.status = "coding";
    if (a.status === "focus" || a.status === "in_room") continue;
    if (age > DECAY.idleToOfflineMs) a.status = "offline";
    else if (age > DECAY.activeToIdleMs && a.status !== "blocked") a.status = "idle";
  }
  state.generatedAt = nowIso;
  return state;
}

export function replay(initial: OfficeState, events: OfficeEvent[], nowIso?: string): OfficeState {
  const sorted = [...events].sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
  const out = sorted.reduce(reduce, initial);
  return nowIso ? decay(out, nowIso) : out;
}
