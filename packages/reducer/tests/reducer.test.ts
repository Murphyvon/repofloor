import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyOfficeState } from "@repofloor/protocol";
import { reduce, replay, decay, githubToEvents } from "../src/index.ts";

const office = () =>
  emptyOfficeState(
    { id: "repofloor", name: "Repofloor", kind: "organization" },
    { id: "repofloor/repofloor", buildingId: "repofloor", name: "repofloor", defaultBranch: "main" },
    "lite",
  );

const T0 = "2026-10-15T09:00:00.000Z";
const later = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();

test("push makes the actor coding", () => {
  const s = reduce(office(), { id: "1", at: T0, officeId: "repofloor/repofloor", type: "push", actorId: "ali", branch: "feat/x", commits: 2 });
  assert.equal(s.actors[0]?.status, "coding");
  assert.equal(s.actors[0]?.detail, "feat/x");
});

test("PR opened + review requested + merge lifecycle", () => {
  let s = office();
  const pr = { number: 7, title: "x", authorId: "ali", url: "u", draft: false, reviewerIds: ["ayse"], updatedAt: T0 };
  s = reduce(s, { id: "1", at: T0, officeId: s.office.id, type: "pr.opened", pr });
  assert.equal(s.pullRequests.length, 1);
  assert.equal(s.actors.find((a) => a.actor.id === "ayse")?.status, "reviewing");
  s = reduce(s, { id: "2", at: later(1), officeId: s.office.id, type: "pr.reviewed", number: 7, reviewerId: "ayse", verdict: "changes_requested" });
  assert.equal(s.actors.find((a) => a.actor.id === "ali")?.status, "blocked");
  s = reduce(s, { id: "3", at: later(2), officeId: s.office.id, type: "pr.merged", number: 7, actorId: "ayse" });
  assert.equal(s.pullRequests.length, 0);
  assert.equal(s.actors.find((a) => a.actor.id === "ali")?.status, "celebrating");
});

test("events for another office are ignored", () => {
  const s = reduce(office(), { id: "1", at: T0, officeId: "other/repo", type: "push", actorId: "x", branch: "m", commits: 1 });
  assert.equal(s.actors.length, 0);
});

test("decay: active → idle → offline", () => {
  let s = reduce(office(), { id: "1", at: T0, officeId: "repofloor/repofloor", type: "push", actorId: "ali", branch: "m", commits: 1 });
  s = decay(s, later(30));
  assert.equal(s.actors[0]?.status, "idle");
  s = decay(s, later(200));
  assert.equal(s.actors[0]?.status, "offline");
});

test("agent tool calls build a trail and infer building", () => {
  let s = office();
  const id = "agent:ali:claude-code";
  s = reduce(s, { id: "1", at: T0, officeId: s.office.id, type: "agent.tool_call", actorId: id, call: { at: T0, tool: "Edit", target: "src/a.ts" } });
  s = reduce(s, { id: "2", at: later(1), officeId: s.office.id, type: "agent.tool_call", actorId: id, call: { at: later(1), tool: "Bash", target: "pnpm test" } });
  const a = s.actors[0]!;
  assert.equal(a.actor.kind, "agent");
  assert.equal(a.agentTrail?.length, 2);
  assert.equal(a.status, "building");
});

test("replay sorts by time", () => {
  const s = replay(office(), [
    { id: "2", at: later(5), officeId: "repofloor/repofloor", type: "actor.status", actorId: "ali", status: "idle" },
    { id: "1", at: T0, officeId: "repofloor/repofloor", type: "actor.status", actorId: "ali", status: "coding" },
  ]);
  assert.equal(s.actors[0]?.status, "idle");
});

test("githubToEvents: push webhook", () => {
  const ev = githubToEvents({
    event: "push",
    deliveryId: "d1",
    payload: { ref: "refs/heads/main", commits: [{}, {}], sender: { login: "ali" }, repository: { full_name: "repofloor/repofloor" }, compare: "c" },
  });
  assert.equal(ev.length, 1);
  assert.equal(ev[0]?.type, "push");
  assert.equal(ev[0]?.id, "d1:push");
});

test("githubToEvents: merged PR", () => {
  const ev = githubToEvents({
    event: "pull_request",
    deliveryId: "d2",
    payload: {
      action: "closed",
      sender: { login: "ayse" },
      repository: { full_name: "repofloor/repofloor" },
      pull_request: { number: 3, title: "t", user: { login: "ali" }, html_url: "u", merged: true, requested_reviewers: [] },
    },
  });
  assert.equal(ev[0]?.type, "pr.merged");
});
