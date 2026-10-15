import { test } from "node:test";
import assert from "node:assert/strict";
import { assertOfficeState, emptyOfficeState, agentActorId } from "../src/index.ts";

test("emptyOfficeState validates", () => {
  const s = emptyOfficeState(
    { id: "repofloor", name: "Repofloor", kind: "organization" },
    { id: "repofloor/repofloor", buildingId: "repofloor", name: "repofloor" },
    "lite",
  );
  assert.doesNotThrow(() => assertOfficeState(s));
  assert.equal(s.rooms[0]?.kind, "floor");
});

test("rejects wrong protocol major", () => {
  assert.throws(() => assertOfficeState({ protocolVersion: "9.0.0" }), /major mismatch/);
});

test("agentActorId format", () => {
  assert.equal(agentActorId("ali", "claude-code"), "agent:ali:claude-code");
});
