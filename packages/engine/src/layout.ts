/**
 * Deterministic layout: given an OfficeState, decide where desks, rooms and props go.
 * Pure function so the same state always produces the same office (stable positions
 * between frames and between page loads).
 */

import type { OfficeState, Room } from "@repofloor/protocol";
import { hash } from "./palette.js";

export const TILE = 16;

export interface DeskSlot {
  actorId: string;
  /** tile coordinates of the chair (the actor stands/sits here) */
  tx: number;
  ty: number;
  /** desk occupies [tx-1 .. tx+1] on row ty-1 */
  facing: "up";
}

export interface RoomBox {
  room: Room;
  tx: number;
  ty: number;
  tw: number;
  th: number;
  /** seat tiles inside the room */
  seats: Array<{ tx: number; ty: number }>;
}

export interface Layout {
  /** total size in tiles */
  cols: number;
  rows: number;
  desks: DeskSlot[];
  rooms: RoomBox[];
  props: Array<{ kind: "plant" | "coffee" | "board" | "lamp" | "door"; tx: number; ty: number }>;
  /** where unassigned / visiting actors wander */
  lounge: { tx: number; ty: number; tw: number; th: number };
}

export function computeLayout(state: OfficeState): Layout {
  // Actors that deserve a desk: everyone except offline bots. Offline humans keep a desk (empty chair).
  const deskActors = state.actors
    .filter((a) => !(a.actor.kind === "bot" && a.status === "offline"))
    .map((a) => a.actor.id)
    .sort((x, y) => hash(x) - hash(y)); // stable but not alphabetical

  const perRow = Math.max(3, Math.min(6, Math.ceil(Math.sqrt(Math.max(deskActors.length, 1)))));
  const deskRows = Math.max(1, Math.ceil(deskActors.length / perRow));

  const deskAreaCols = perRow * 4 + 2; // each desk is 3 wide + 1 gap
  const deskAreaRows = deskRows * 4 + 3; // each desk row is 3 tall + 1 gap, plus headroom for bubbles

  const rooms = state.rooms.filter((r) => r.kind !== "floor");
  const roomW = 8;
  const roomH = 6;
  const roomColWidth = rooms.length ? roomW + 2 : 0;
  // one column of rooms up to 3; beyond that, two columns (rows grow as needed)
  const roomCols = rooms.length === 0 ? 0 : rooms.length <= 3 ? 1 : 2;
  const roomsPerCol = roomCols ? Math.ceil(rooms.length / roomCols) : 1;

  const cols = 1 + deskAreaCols + roomCols * roomColWidth + 1;
  const rows = Math.max(2 + deskAreaRows + 4, rooms.length ? 2 + roomsPerCol * (roomH + 1) + 1 : 0);

  const desks: DeskSlot[] = deskActors.map((actorId, i) => {
    const r = Math.floor(i / perRow);
    const c = i % perRow;
    return { actorId, tx: 2 + c * 4 + 1, ty: 4 + r * 4 + 1, facing: "up" };
  });

  const roomBoxes: RoomBox[] = rooms.map((room, i) => {
    const col = Math.floor(i / roomsPerCol);
    const rowI = i % roomsPerCol;
    const tx = 1 + deskAreaCols + col * roomColWidth + 1;
    const ty = 2 + rowI * (roomH + 1);
    const seats = [
      { tx: tx + 2, ty: ty + 2 },
      { tx: tx + 5, ty: ty + 2 },
      { tx: tx + 2, ty: ty + 4 },
      { tx: tx + 5, ty: ty + 4 },
      { tx: tx + 3, ty: ty + 4 },
      { tx: tx + 4, ty: ty + 2 },
    ];
    return { room, tx, ty, tw: roomW, th: roomH, seats };
  });

  const lounge = { tx: 2, ty: rows - 4, tw: deskAreaCols - 2, th: 3 };

  const props: Layout["props"] = [
    { kind: "lamp", tx: cols - 3, ty: 1 },
    { kind: "board", tx: 2, ty: 1 },
    { kind: "coffee", tx: lounge.tx + lounge.tw - 1, ty: lounge.ty + 1 },
    { kind: "plant", tx: 1, ty: rows - 2 },
    { kind: "plant", tx: deskAreaCols, ty: 2 },
    { kind: "door", tx: Math.floor(cols / 2), ty: rows - 1 },
  ];

  return { cols, rows, desks, rooms: roomBoxes, props, lounge };
}
