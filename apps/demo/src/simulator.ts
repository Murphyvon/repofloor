/**
 * Fake event stream: a small team plus two coding agents working on a repo.
 * Produces OfficeEvents at a human-ish cadence. Used by the demo and by visual tests.
 */
import {
  agentActorId,
  emptyOfficeState,
  type OfficeEvent,
  type OfficeState,
  type PullRequestSummary,
} from "@repofloor/protocol";

const OFFICE_ID = "repofloor/repofloor";

const HUMANS = [
  { id: "aliosmanmho", name: "Ali Osman", emoji: "🚀" },
  { id: "ayse-dev", name: "Ayşe", emoji: "🎨" },
  { id: "mehmet-k", name: "Mehmet", emoji: "🔥" },
  { id: "elif", name: "Elif", emoji: "🧪" },
  { id: "can-ops", name: "Can", emoji: "☕" },
];

const AGENTS = [
  { ownerId: "aliosmanmho", provider: "claude-code" as const, name: "claude" },
  { ownerId: "ayse-dev", provider: "codex" as const, name: "codex" },
];

const TOOLS: Array<[string, string[]]> = [
  ["Read", ["packages/engine/src/renderer.ts", "README.md", "apps/demo/src/main.ts", "packages/reducer/src/index.ts"]],
  ["Edit", ["packages/engine/src/avatar.ts", "packages/protocol/src/index.ts", "apps/lite-action/action.yml"]],
  ["Grep", ["ActivityStatus", "computeLayout", "TODO"]],
  ["Bash", ["pnpm test", "pnpm build", "pnpm lint", "git status"]],
  ["Write", ["docs/ARCHITECTURE.md", "packages/engine/src/fx.ts"]],
];

const BRANCHES = ["feat/rooms", "fix/lamp-blink", "chore/deps", "feat/agent-trail", "docs/contributing"];

export function initialState(): OfficeState {
  const s = emptyOfficeState(
    { id: "repofloor", name: "Repofloor", kind: "organization" },
    { id: OFFICE_ID, buildingId: "repofloor", name: "repofloor", defaultBranch: "main", description: "A living pixel office for every repo" },
    "full",
  );
  s.rooms.push(
    { id: `${OFFICE_ID}#team-core`, officeId: OFFICE_ID, kind: "team", name: "core", teamSlug: "core" },
    { id: `${OFFICE_ID}#standup`, officeId: OFFICE_ID, kind: "meeting", name: "standup" },
    { id: `${OFFICE_ID}#focus`, officeId: OFFICE_ID, kind: "focus", name: "quiet" },
  );
  s.defaultBranchCi = "success";
  return s;
}

let seq = 0;
const now = () => new Date().toISOString();
const base = () => ({ id: `sim-${++seq}`, at: now(), officeId: OFFICE_ID });
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

export function seedEvents(): OfficeEvent[] {
  const out: OfficeEvent[] = [];
  for (const h of HUMANS) out.push({ ...base(), type: "actor.upsert", actor: { id: h.id, kind: "human", name: h.name, emoji: h.emoji } });
  for (const a of AGENTS) {
    out.push({
      ...base(),
      type: "actor.upsert",
      actor: { id: agentActorId(a.ownerId, a.provider, a.name), kind: "agent", name: a.name, agent: { provider: a.provider, ownerId: a.ownerId } },
    });
  }
  out.push({ ...base(), type: "push", actorId: "aliosmanmho", branch: "feat/rooms", commits: 3 });
  out.push({ ...base(), type: "push", actorId: "mehmet-k", branch: "fix/lamp-blink", commits: 1 });
  out.push({ ...base(), type: "actor.status", actorId: "can-ops", status: "idle" });
  out.push({ ...base(), type: "actor.move", actorId: "elif", roomId: `${OFFICE_ID}#focus` });
  out.push({ ...base(), type: "pr.opened", pr: mkPr(12, "feat: team rooms", "aliosmanmho", ["ayse-dev"]) });
  out.push({ ...base(), type: "agent.session", actorId: agentActorId("aliosmanmho", "claude-code", "claude"), phase: "start" });
  return out;
}

let prCounter = 12;
function mkPr(number: number, title: string, authorId: string, reviewerIds: string[]): PullRequestSummary {
  return { number, title, authorId, url: `https://github.com/${OFFICE_ID}/pull/${number}`, draft: false, reviewerIds, updatedAt: now() };
}

/** Returns one plausible next event given the current state. */
export function nextEvent(state: OfficeState): OfficeEvent {
  const humans = state.actors.filter((a) => a.actor.kind === "human");
  const agents = state.actors.filter((a) => a.actor.kind === "agent");
  const r = Math.random();

  if (r < 0.34 && agents.length) {
    const ag = pick(agents);
    const [tool, targets] = pick(TOOLS);
    return { ...base(), type: "agent.tool_call", actorId: ag.actor.id, call: { at: now(), tool, target: pick(targets) } };
  }
  if (r < 0.5) {
    const h = pick(humans);
    return { ...base(), type: "push", actorId: h.actor.id, branch: pick(BRANCHES), commits: 1 + Math.floor(Math.random() * 4) };
  }
  if (r < 0.58 && state.pullRequests.length) {
    const pr = pick(state.pullRequests);
    const reviewer = pick(humans.filter((h) => h.actor.id !== pr.authorId));
    return { ...base(), type: "pr.reviewed", number: pr.number, reviewerId: reviewer.actor.id, verdict: Math.random() < 0.7 ? "approved" : "changes_requested" };
  }
  if (r < 0.64 && state.pullRequests.length) {
    const pr = pick(state.pullRequests);
    return { ...base(), type: "pr.merged", number: pr.number, actorId: pick(humans).actor.id };
  }
  if (r < 0.7) {
    const author = pick(humans);
    const reviewer = pick(humans.filter((h) => h.actor.id !== author.actor.id));
    prCounter++;
    return { ...base(), type: "pr.opened", pr: mkPr(prCounter, pick(["fix: tooltip overflow", "feat: emoji picker", "chore: ci cache", "feat: lite action"]), author.actor.id, [reviewer.actor.id]) };
  }
  if (r < 0.78) {
    const status = pick(["running", "success", "success", "failure"] as const);
    const h = pick(humans);
    return { ...base(), type: "ci.status", status, branch: Math.random() < 0.5 ? "main" : pick(BRANCHES), actorId: h.actor.id };
  }
  if (r < 0.86) {
    const h = pick(humans);
    const room = pick([...state.rooms.filter((x) => x.kind !== "floor").map((x) => x.id), undefined, undefined]);
    return room ? { ...base(), type: "actor.move", actorId: h.actor.id, roomId: room } : { ...base(), type: "actor.move", actorId: h.actor.id };
  }
  if (r < 0.92) {
    const h = pick(humans);
    const room = pick(state.rooms.filter((x) => x.kind === "team" || x.kind === "meeting"));
    return { ...base(), type: "chat.message", roomId: room.id, actorId: h.actor.id, text: pick(["standup?", "merging in 5", "ci is red again 😅", "lgtm", "who owns the lamp blink?"]) };
  }
  if (r < 0.96) {
    const h = pick(humans);
    return { ...base(), type: "issue.commented", number: 3, actorId: h.actor.id };
  }
  const h = pick(humans);
  return { ...base(), type: "actor.status", actorId: h.actor.id, status: "idle" };
}
