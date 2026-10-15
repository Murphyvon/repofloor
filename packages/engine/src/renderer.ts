import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import type { OfficeEvent, OfficeState, ActorState } from "@repofloor/protocol";
import { computeLayout, TILE, type Layout } from "./layout.js";
import { Avatar } from "./avatar.js";
import { PALETTE, hash } from "./palette.js";

export interface OfficeRendererOptions {
  /** Pixel scale (2 = chunky pixel art). */
  scale?: number;
  /** Called when the user clicks an actor. */
  onActorClick?: (actor: ActorState) => void;
  /** Provide tooltip HTML for an actor; return "" to hide. Default renders name/status/detail. */
  tooltip?: (actor: ActorState) => string;
  /** Background color behind the office. */
  background?: number;
}

const ROOM_LABEL = new TextStyle({ fontFamily: "monospace", fontSize: 9, fill: PALETTE.textDim });
const BOARD_STYLE = new TextStyle({ fontFamily: "monospace", fontSize: 8, fill: PALETTE.text });
const TITLE_STYLE = new TextStyle({ fontFamily: "monospace", fontSize: 11, fill: PALETTE.text, fontWeight: "bold" });

/**
 * OfficeRenderer: mount once, then push states. Diffing is done by actor id, so
 * avatars walk between desks/rooms instead of teleporting.
 */
export class OfficeRenderer {
  private app = new Application();
  private world = new Container();
  private floorLayer = new Graphics();
  private propsLayer = new Container();
  private roomLayer = new Container();
  private actorLayer = new Container();
  private fxLayer = new Container();
  private avatars = new Map<string, Avatar>();
  private layout: Layout | null = null;
  private layoutKey = "";
  private state: OfficeState | null = null;
  private lamp = new Graphics();
  private monitors = new Map<string, Graphics>();
  private board = new Text({ text: "", style: BOARD_STYLE });
  private title = new Text({ text: "", style: TITLE_STYLE });
  private confetti: Array<{ g: Graphics; vx: number; vy: number; life: number }> = [];
  private tooltipEl: HTMLDivElement | null = null;
  private host: HTMLElement | null = null;
  private wanderTimer = 0;
  private opts: Required<Pick<OfficeRendererOptions, "scale" | "background">> & OfficeRendererOptions;
  private t = 0;

  constructor(opts: OfficeRendererOptions = {}) {
    this.opts = { scale: 2, background: 0x14161c, ...opts };
  }

  async mount(host: HTMLElement): Promise<void> {
    this.host = host;
    await this.app.init({
      background: this.opts.background,
      resizeTo: host,
      antialias: false,
      roundPixels: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    host.appendChild(this.app.canvas);
    this.world.addChild(this.floorLayer, this.roomLayer, this.propsLayer, this.actorLayer, this.fxLayer);
    this.world.scale.set(this.opts.scale);
    this.app.stage.addChild(this.world);
    this.app.ticker.add((ticker) => this.tick(ticker.deltaMS / 1000));

    this.tooltipEl = document.createElement("div");
    Object.assign(this.tooltipEl.style, {
      position: "absolute",
      pointerEvents: "none",
      background: "rgba(20,22,28,0.95)",
      color: "#e8ebf2",
      border: "1px solid #4a5265",
      borderRadius: "4px",
      padding: "6px 8px",
      font: "11px/1.4 ui-monospace, monospace",
      display: "none",
      zIndex: "10",
      maxWidth: "260px",
    } as CSSStyleDeclaration);
    host.style.position ||= "relative";
    host.appendChild(this.tooltipEl);
    if (this.state) this.setState(this.state);
  }

  destroy() {
    this.app.destroy(true, { children: true });
    this.tooltipEl?.remove();
  }

  /** Replace the whole state; avatars are diffed by id. */
  setState(state: OfficeState) {
    this.state = state;
    if (!this.host) return;
    const key = layoutKey(state);
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      this.layout = computeLayout(state);
      this.drawStatic(state, this.layout);
    }
    const layout = this.layout!;
    const seen = new Set<string>();
    for (const a of state.actors) {
      seen.add(a.actor.id);
      let av = this.avatars.get(a.actor.id);
      const target = this.targetFor(a, layout);
      if (!av) {
        av = new Avatar(a);
        av.on("pointerover", (e) => this.showTooltip(av!, e.global.x, e.global.y));
        av.on("pointermove", (e) => this.showTooltip(av!, e.global.x, e.global.y));
        av.on("pointerout", () => this.hideTooltip());
        av.on("pointertap", () => this.opts.onActorClick?.(av!.state));
        this.avatars.set(a.actor.id, av);
        this.actorLayer.addChild(av);
        // new actors enter through the door
        const door = layout.props.find((p) => p.kind === "door")!;
        av.moveTo(door.tx, door.ty - 1, true);
        av.moveTo(target.tx, target.ty);
      } else {
        av.setState(a);
        av.moveTo(target.tx, target.ty);
      }
      const mon = this.monitors.get(a.actor.id);
      if (mon) this.drawMonitor(mon, a);
    }
    for (const [id, av] of this.avatars) {
      if (!seen.has(id)) {
        this.actorLayer.removeChild(av);
        av.destroy();
        this.avatars.delete(id);
      }
    }
    this.drawLamp(state);
    this.board.text = boardText(state);
    this.title.text = `${state.office.id}`;
    this.fitToHost();
  }

  /** Optional: feed events for one-shot effects (confetti on merge, etc.). State must still be set separately. */
  applyEffect(event: OfficeEvent) {
    if (event.type === "pr.merged") {
      const av = this.avatars.get(event.actorId);
      if (av) this.burstConfetti(av.position.x, av.position.y - 20);
    }
    if (event.type === "ci.status" && event.status === "failure") {
      this.flashLamp();
    }
  }

  // ───────────────────────────────────────────────────────────────────────────

  private targetFor(a: ActorState, layout: Layout): { tx: number; ty: number } {
    if (a.roomId) {
      const box = layout.rooms.find((r) => r.room.id === a.roomId);
      if (box) {
        // seat by index among the room's occupants, so two people never share a chair
        const occupants = (this.state?.actors ?? []).filter((x) => x.roomId === a.roomId).map((x) => x.actor.id).sort();
        const idx = Math.max(0, occupants.indexOf(a.actor.id));
        return box.seats[idx % box.seats.length]!;
      }
    }
    const desk = layout.desks.find((d) => d.actorId === a.actor.id);
    if (desk) {
      if (a.status === "idle" && hash(a.actor.id + Math.floor(this.t / 20)) % 3 === 0) {
        // idle people occasionally hang out in the lounge
        const l = layout.lounge;
        return { tx: l.tx + (hash(a.actor.id) % l.tw), ty: l.ty + 1 };
      }
      return { tx: desk.tx, ty: desk.ty };
    }
    const l = layout.lounge;
    return { tx: l.tx + (hash(a.actor.id) % l.tw), ty: l.ty + 1 };
  }

  private drawStatic(state: OfficeState, layout: Layout) {
    const g = this.floorLayer.clear();
    const W = layout.cols * TILE;
    const H = layout.rows * TILE;
    // floor checker
    for (let y = 0; y < layout.rows; y++) {
      for (let x = 0; x < layout.cols; x++) {
        g.rect(x * TILE, y * TILE, TILE, TILE).fill((x + y) % 2 ? PALETTE.floor : PALETTE.floorAlt);
      }
    }
    // walls
    g.rect(0, 0, W, TILE).fill(PALETTE.wall).rect(0, TILE, W, 3).fill(PALETTE.wallTop);
    g.rect(0, 0, TILE / 2, H).fill(PALETTE.wall).rect(W - TILE / 2, 0, TILE / 2, H).fill(PALETTE.wall).rect(0, H - TILE, W, TILE).fill(PALETTE.wall);

    this.propsLayer.removeChildren();
    this.roomLayer.removeChildren();
    this.monitors.clear();

    // desks
    for (const d of layout.desks) {
      const dg = new Graphics();
      const x = (d.tx - 1) * TILE;
      const y = (d.ty - 1) * TILE;
      dg.rect(x, y + 4, TILE * 3, TILE - 4).fill(PALETTE.deskWood).rect(x, y + TILE - 3, TILE * 3, 3).fill(PALETTE.deskWoodDark);
      // monitor (screen color is refreshed in setState via this.monitors)
      const mon = new Graphics();
      mon.position.set(x + TILE, y);
      this.monitors.set(d.actorId, mon);
      this.drawMonitor(mon, state.actors.find((a) => a.actor.id === d.actorId));
      // chair
      dg.rect(d.tx * TILE + 3, d.ty * TILE + 2, TILE - 6, TILE - 4).fill(PALETTE.chair);
      this.propsLayer.addChild(dg, mon);
    }

    // rooms
    for (const r of layout.rooms) {
      const rg = new Graphics();
      const fill = r.room.kind === "focus" ? PALETTE.roomFocus : r.room.kind === "meeting" ? PALETTE.roomMeeting : PALETTE.roomFill;
      rg.rect(r.tx * TILE, r.ty * TILE, r.tw * TILE, r.th * TILE).fill(fill).stroke({ width: 1, color: PALETTE.roomStroke });
      // table
      rg.roundRect((r.tx + 2.5) * TILE, (r.ty + 2.6) * TILE, 3 * TILE, TILE, 2).fill(PALETTE.deskWood);
      const label = new Text({ text: `${roomIcon(r.room.kind)} ${r.room.name}`, style: ROOM_LABEL });
      label.position.set(r.tx * TILE + 3, r.ty * TILE + 2);
      this.roomLayer.addChild(rg, label);
    }

    // props
    for (const p of layout.props) {
      const pg = new Graphics();
      const x = p.tx * TILE;
      const y = p.ty * TILE;
      if (p.kind === "plant") {
        pg.rect(x + 5, y + 9, 6, 6).fill(PALETTE.pot).circle(x + 8, y + 6, 5).fill(PALETTE.plant).circle(x + 5, y + 8, 3).fill(PALETTE.plantDark);
      } else if (p.kind === "coffee") {
        pg.rect(x + 2, y + 2, 12, 14).fill(0x374151).rect(x + 4, y + 4, 8, 4).fill(0x111318).rect(x + 6, y + 10, 4, 3).fill(0xf5f5f4);
        const steam = new Text({ text: "☕", style: new TextStyle({ fontSize: 8 }) });
        steam.position.set(x + 3, y - 10);
        this.propsLayer.addChild(steam);
      } else if (p.kind === "board") {
        pg.rect(x, y - 2, TILE * 14, TILE + 2).fill(0xf8fafc).stroke({ width: 1, color: 0x94a3b8 });
        this.propsLayer.addChild(pg);
        this.board.position.set(x + 4, y + 1);
        this.board.style.fill = 0x111318;
        this.propsLayer.addChild(this.board);
        // repo title lives on the bottom wall, left of the door
        this.title.position.set(TILE * 3, (layout.rows - 1) * TILE + 1);
        this.propsLayer.addChild(this.title);
        continue;
      } else if (p.kind === "lamp") {
        this.lamp.position.set(x, y);
        this.propsLayer.addChild(this.lamp);
      } else if (p.kind === "door") {
        pg.rect(x - 2, y, TILE + 4, TILE).fill(0x8b5e3c).rect(x, y + 2, TILE, TILE - 2).fill(0x6e4529).rect(x + TILE - 4, y + 8, 2, 2).fill(0xfbbf24);
      }
      this.propsLayer.addChild(pg);
    }
  }

  private drawMonitor(mon: Graphics, actor: ActorState | undefined) {
    const on = actor && actor.status !== "offline" && actor.status !== "idle" && !actor.roomId;
    const screen = on ? (actor?.actor.kind === "agent" ? PALETTE.monitorAgent : PALETTE.monitorOn) : 0x1f232b;
    mon.clear().rect(2, -4, TILE - 4, 10).fill(PALETTE.monitor).rect(3, -3, TILE - 6, 7).fill(screen).rect(6, 6, 4, 2).fill(0x374151);
    if (on) mon.rect(4, -2, 5, 1).fill(0xffffff).rect(4, 0, 7, 1).fill(0xffffff).rect(4, 2, 3, 1).fill(0xffffff);
  }

  private drawLamp(state: OfficeState) {
    const s = state.defaultBranchCi;
    const color = s === "success" ? PALETTE.ok : s === "failure" ? PALETTE.bad : s === "running" || s === "queued" ? PALETTE.warn : PALETTE.textDim;
    this.lamp.clear().rect(2, 2, 12, 14).fill(0x374151).rect(4, 4, 8, 10).fill(color);
    const label = s ? `CI ${s}` : "CI —";
    const existing = this.lamp.children[0] as Text | undefined;
    if (existing) existing.text = label;
    else {
      const t = new Text({ text: label, style: new TextStyle({ fontFamily: "monospace", fontSize: 8, fill: PALETTE.textDim }) });
      t.anchor.set(1, 0);
      t.position.set(-2, 4);
      this.lamp.addChild(t);
    }
  }

  private flashLamp() {
    let n = 0;
    const iv = setInterval(() => {
      this.lamp.alpha = this.lamp.alpha === 1 ? 0.3 : 1;
      if (++n > 8) {
        clearInterval(iv);
        this.lamp.alpha = 1;
      }
    }, 120);
  }

  private burstConfetti(x: number, y: number) {
    for (let i = 0; i < 28; i++) {
      const g = new Graphics().rect(0, 0, 2, 2).fill(PALETTE.confetti[i % PALETTE.confetti.length]!);
      g.position.set(x, y);
      this.fxLayer.addChild(g);
      this.confetti.push({ g, vx: (Math.random() - 0.5) * 90, vy: -60 - Math.random() * 60, life: 1.4 });
    }
  }

  private tick(dt: number) {
    this.t += dt;
    for (const av of this.avatars.values()) av.tick(dt);
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const c = this.confetti[i]!;
      c.life -= dt;
      c.vy += 160 * dt;
      c.g.x += c.vx * dt;
      c.g.y += c.vy * dt;
      c.g.alpha = Math.max(0, c.life);
      if (c.life <= 0) {
        this.fxLayer.removeChild(c.g);
        c.g.destroy();
        this.confetti.splice(i, 1);
      }
    }
    // re-evaluate wander targets every few seconds so idle people drift around
    this.wanderTimer += dt;
    if (this.wanderTimer > 4 && this.state && this.layout) {
      this.wanderTimer = 0;
      for (const a of this.state.actors) {
        const av = this.avatars.get(a.actor.id);
        if (av && !av.walking && a.status !== "offline") {
          const t = this.targetFor(a, this.layout);
          av.moveTo(t.tx, t.ty);
        }
      }
    }
    // lamp blink while running
    if (this.state?.defaultBranchCi === "running") this.lamp.alpha = 0.7 + Math.sin(this.t * 5) * 0.3;
  }

  private fitToHost() {
    if (!this.host || !this.layout) return;
    const W = this.layout.cols * TILE;
    const H = this.layout.rows * TILE;
    const sx = this.host.clientWidth / W;
    const sy = this.host.clientHeight / H;
    // Prefer integer scales (crisp pixels); fall back to half steps when the office doesn't fit.
    const raw = Math.min(sx, sy, this.opts.scale * 2);
    const s = Math.max(0.75, raw >= 2 ? Math.floor(raw) : Math.floor(raw * 4) / 4);
    this.world.scale.set(s);
    this.world.position.set(Math.floor((this.host.clientWidth - W * s) / 2), Math.floor((this.host.clientHeight - H * s) / 2));
  }

  private showTooltip(av: Avatar, x: number, y: number) {
    if (!this.tooltipEl) return;
    const html = this.opts.tooltip ? this.opts.tooltip(av.state) : defaultTooltip(av.state);
    if (!html) return this.hideTooltip();
    this.tooltipEl.innerHTML = html;
    this.tooltipEl.style.display = "block";
    this.tooltipEl.style.left = `${x + 12}px`;
    this.tooltipEl.style.top = `${y + 12}px`;
  }

  private hideTooltip() {
    if (this.tooltipEl) this.tooltipEl.style.display = "none";
  }
}

function layoutKey(s: OfficeState): string {
  return s.actors.map((a) => `${a.actor.id}:${a.status === "offline" ? 0 : 1}`).sort().join("|") + "#" + s.rooms.map((r) => r.id).join("|");
}

function boardText(s: OfficeState): string {
  const online = s.actors.filter((a) => a.status !== "offline").length;
  const agents = s.actors.filter((a) => a.actor.kind === "agent" && a.status !== "offline").length;
  return `${online} online · ${agents} agents · ${s.pullRequests.length} PRs · ${s.issues.length} issues`;
}

function roomIcon(kind: string): string {
  return kind === "focus" ? "🎧" : kind === "meeting" ? "📋" : kind === "team" ? "👥" : "💬";
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function defaultTooltip(a: ActorState): string {
  const name = esc(a.actor.name ?? a.actor.id);
  const kind = a.actor.kind === "agent" ? ` <span style="color:#c084fc">${esc(a.actor.agent?.provider ?? "agent")}</span>` : "";
  const detail = a.detail ? `<div style="color:#9aa3b5">${esc(a.detail)}</div>` : "";
  const trail = a.agentTrail?.length
    ? `<div style="margin-top:4px;color:#9aa3b5">${a.agentTrail.slice(-4).map((c) => `› ${esc(c.tool)} ${esc(c.target ?? "")}`).join("<br>")}</div>`
    : "";
  return `<b>${name}</b>${kind}<div>${esc(a.status)}</div>${detail}${trail}`;
}
