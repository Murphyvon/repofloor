/**
 * GitHub webhook payload → OfficeEvent[]
 *
 * Only the handful of fields we need are typed; the rest is `unknown`.
 * Each webhook delivery becomes 0..n events with ids derived from the delivery id,
 * so re-delivered webhooks are idempotent after dedup by id.
 */

import type { OfficeEvent, PullRequestSummary, IssueSummary, CiStatus } from "@repofloor/protocol";

export interface GithubWebhook {
  /** X-GitHub-Event header */
  event: string;
  /** X-GitHub-Delivery header (or any unique id) */
  deliveryId: string;
  payload: Record<string, unknown>;
}

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (typeof v === "object" && v !== null ? (v as Obj) : {});
const s = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const n = (v: unknown, d = 0): number => (typeof v === "number" ? v : d);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const login = (u: unknown): string => s(o(u)["login"]);

function prSummary(pr: Obj): PullRequestSummary {
  return {
    number: n(pr["number"]),
    title: s(pr["title"]),
    authorId: login(pr["user"]),
    url: s(pr["html_url"]),
    draft: pr["draft"] === true,
    reviewerIds: arr(pr["requested_reviewers"]).map(login).filter(Boolean),
    updatedAt: s(pr["updated_at"], new Date().toISOString()),
  };
}

function issueSummary(issue: Obj): IssueSummary {
  return {
    number: n(issue["number"]),
    title: s(issue["title"]),
    assigneeIds: arr(issue["assignees"]).map(login).filter(Boolean),
    url: s(issue["html_url"]),
    updatedAt: s(issue["updated_at"], new Date().toISOString()),
  };
}

function ciStatus(status: string, conclusion: string): CiStatus {
  if (status === "queued" || status === "waiting" || status === "pending") return "queued";
  if (status === "in_progress") return "running";
  if (conclusion === "success") return "success";
  if (conclusion === "cancelled" || conclusion === "skipped") return "cancelled";
  return "failure";
}

export function githubToEvents(hook: GithubWebhook): OfficeEvent[] {
  const p = hook.payload;
  const repo = o(p["repository"]);
  const officeId = s(repo["full_name"]);
  if (!officeId) return [];
  const at = new Date().toISOString();
  const base = (suffix: string) => ({ id: `${hook.deliveryId}:${suffix}`, at, officeId });
  const sender = login(p["sender"]);
  const action = s(p["action"]);
  const out: OfficeEvent[] = [];

  switch (hook.event) {
    case "push": {
      const ref = s(p["ref"]);
      const commits = arr(p["commits"]).length;
      const pusher = login(p["sender"]) || s(o(p["pusher"])["name"]);
      if (commits > 0 && pusher) {
        out.push({ ...base("push"), type: "push", actorId: pusher, branch: ref.replace("refs/heads/", ""), commits, url: s(p["compare"]) });
      }
      break;
    }
    case "pull_request": {
      const pr = prSummary(o(p["pull_request"]));
      if (action === "opened" || action === "reopened" || action === "ready_for_review") {
        out.push({ ...base("pr"), type: "pr.opened", pr });
      } else if (action === "closed") {
        if (o(p["pull_request"])["merged"] === true) out.push({ ...base("pr"), type: "pr.merged", number: pr.number, actorId: sender });
        else out.push({ ...base("pr"), type: "pr.closed", number: pr.number });
      } else if (action === "review_requested") {
        const reviewer = login(p["requested_reviewer"]);
        if (reviewer) out.push({ ...base("pr"), type: "pr.review_requested", number: pr.number, reviewerId: reviewer });
      } else if (action === "synchronize" || action === "edited") {
        out.push({ ...base("pr"), type: "pr.updated", pr });
      }
      break;
    }
    case "pull_request_review": {
      const pr = o(p["pull_request"]);
      const review = o(p["review"]);
      const state = s(review["state"]).toLowerCase();
      const verdict = state === "approved" ? "approved" : state === "changes_requested" ? "changes_requested" : "commented";
      if (action === "submitted") {
        out.push({ ...base("review"), type: "pr.reviewed", number: n(pr["number"]), reviewerId: login(review["user"]), verdict });
      }
      break;
    }
    case "pull_request_review_comment":
    case "issue_comment": {
      const issue = o(p["issue"] ?? p["pull_request"]);
      if (action === "created") {
        out.push({ ...base("comment"), type: "issue.commented", number: n(issue["number"]), actorId: sender });
      }
      break;
    }
    case "issues": {
      const issue = issueSummary(o(p["issue"]));
      if (action === "opened" || action === "reopened") out.push({ ...base("issue"), type: "issue.opened", issue, actorId: sender });
      else if (action === "assigned") out.push({ ...base("issue"), type: "issue.assigned", number: issue.number, assigneeId: login(p["assignee"]) });
      else if (action === "closed") out.push({ ...base("issue"), type: "issue.closed", number: issue.number, actorId: sender });
      break;
    }
    case "workflow_run": {
      const run = o(p["workflow_run"]);
      const status = ciStatus(s(run["status"]), s(run["conclusion"]));
      const prs = arr(run["pull_requests"]);
      const prNumber = prs.length ? n(o(prs[0])["number"]) : undefined;
      const actorId = login(run["actor"]) || login(run["triggering_actor"]) || undefined;
      const ev: OfficeEvent = {
        ...base("ci"),
        type: "ci.status",
        status,
        branch: s(run["head_branch"]),
        url: s(run["html_url"]),
        ...(actorId ? { actorId } : {}),
        ...(prNumber !== undefined ? { prNumber } : {}),
      };
      out.push(ev);
      break;
    }
    case "check_suite": {
      const cs = o(p["check_suite"]);
      const status = ciStatus(s(cs["status"]), s(cs["conclusion"]));
      const prs = arr(cs["pull_requests"]);
      const prNumber = prs.length ? n(o(prs[0])["number"]) : undefined;
      out.push({
        ...base("ci"),
        type: "ci.status",
        status,
        branch: s(cs["head_branch"]),
        ...(prNumber !== undefined ? { prNumber } : {}),
      });
      break;
    }
  }
  return out;
}
