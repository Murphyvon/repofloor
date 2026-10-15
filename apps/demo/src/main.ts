import { OfficeRenderer } from "@repofloor/engine";
import { reduce, decay } from "@repofloor/reducer";
import { assertOfficeState, type OfficeEvent, type OfficeState } from "@repofloor/protocol";
import { initialState, seedEvents, nextEvent } from "./simulator.js";

const host = document.getElementById("office")!;
const logEl = document.getElementById("log")!;
const controls = document.getElementById("controls")!;
const modeEl = document.getElementById("mode")!;
const clockEl = document.getElementById("clock")!;

const renderer = new OfficeRenderer({
  onActorClick: (a) => {
    if (a.link) window.open(a.link, "_blank");
  },
});

let state: OfficeState;

function apply(ev: OfficeEvent) {
  state = reduce(state, ev);
  renderer.applyEffect(ev);
  renderer.setState(state);
  log(ev);
}

function log(ev: OfficeEvent) {
  const d = document.createElement("div");
  const who = "actorId" in ev ? ev.actorId : "pr" in ev ? ev.pr.authorId : "reviewerId" in ev ? ev.reviewerId : "";
  const what =
    ev.type === "agent.tool_call" ? `${ev.call.tool} ${ev.call.target ?? ""}` :
    ev.type === "push" ? `${ev.commits} commit(s) → ${ev.branch}` :
    ev.type === "pr.opened" ? `PR #${ev.pr.number} ${ev.pr.title}` :
    ev.type === "pr.reviewed" ? `#${ev.number} ${ev.verdict}` :
    ev.type === "pr.merged" ? `#${ev.number} merged 🎉` :
    ev.type === "ci.status" ? `${ev.branch}: ${ev.status}` :
    ev.type === "chat.message" ? `"${ev.text}"` :
    ev.type === "actor.move" ? (ev.roomId ? `→ ${ev.roomId.split("#")[1]}` : "→ floor") : "";
  d.innerHTML = `<b>${ev.type}</b> ${who ? who.replace(/^agent:[^:]+:/, "🤖") : ""} ${what}`;
  logEl.prepend(d);
  while (logEl.childElementCount > 40) logEl.lastElementChild?.remove();
}

async function boot() {
  await renderer.mount(host);

  // Lite mode: if ./office-state.json exists next to the page, use it and stop simulating.
  const lite = await fetch("./office-state.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (lite) {
    assertOfficeState(lite);
    state = decay(lite, new Date().toISOString());
    renderer.setState(state);
    modeEl.textContent = `lite · generated ${new Date(lite.generatedAt).toLocaleString()}`;
    return;
  }

  state = initialState();
  for (const ev of seedEvents()) apply(ev);

  // simulated stream
  let paused = false;
  const tickSim = () => {
    if (!paused) apply(nextEvent(state));
    setTimeout(tickSim, 1200 + Math.random() * 2200);
  };
  setTimeout(tickSim, 1500);
  setInterval(() => {
    state = decay(state, new Date().toISOString());
    renderer.setState(state);
  }, 10_000);

  const btn = (label: string, fn: () => OfficeEvent | null) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = () => {
      const ev = fn();
      if (ev) apply(ev);
    };
    controls.appendChild(b);
  };
  const base = () => ({ id: `ui-${Date.now()}`, at: new Date().toISOString(), officeId: state.office.id });
  btn("🎉 merge a PR", () => (state.pullRequests[0] ? { ...base(), type: "pr.merged", number: state.pullRequests[0].number, actorId: state.pullRequests[0].authorId } : null));
  btn("🔴 CI fails", () => ({ ...base(), type: "ci.status", status: "failure", branch: "main", actorId: "mehmet-k" }));
  btn("🟢 CI green", () => ({ ...base(), type: "ci.status", status: "success", branch: "main" }));
  btn("🤖 agent edit", () => ({ ...base(), type: "agent.tool_call", actorId: "agent:aliosmanmho:claude", call: { at: new Date().toISOString(), tool: "Edit", target: "src/renderer.ts" } }));
  btn("💬 standup", () => ({ ...base(), type: "actor.move", actorId: "aliosmanmho", roomId: `${state.office.id}#standup` }));
  btn("🎧 focus", () => ({ ...base(), type: "actor.move", actorId: "aliosmanmho", roomId: `${state.office.id}#focus` }));
  btn("🚪 back to desk", () => ({ ...base(), type: "actor.move", actorId: "aliosmanmho" }));
  const p = document.createElement("button");
  p.textContent = "⏸ pause sim";
  p.onclick = () => { paused = !paused; p.textContent = paused ? "▶ resume sim" : "⏸ pause sim"; };
  controls.appendChild(p);

  setInterval(() => (clockEl.textContent = new Date().toLocaleTimeString()), 1000);
}

boot().catch((e) => {
  console.error(e);
  host.textContent = String(e);
});
