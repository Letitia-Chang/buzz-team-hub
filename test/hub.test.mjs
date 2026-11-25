// End-to-end: roles, permissions, plugins, requests, audit and dashboard,
// against the real server and the fake `buzz` CLI.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "team-hub-"));
const OWNER = "a".repeat(64);
const BEN = "b".repeat(64);
const CAT = "c".repeat(64);
const files = { members: join(dir, "members.txt"), outbox: join(dir, "outbox.jsonl"), seed: join(dir, "plugins.json") };
writeFileSync(files.members, `${OWNER}\n${BEN}\n${CAT}\n`);
writeFileSync(files.outbox, "");
writeFileSync(files.seed, JSON.stringify({
  trustedPublishers: ["d".repeat(64)],
  plugins: {
    "northstar.board": { name: "Project Board", repo: "git@x:board.git", version: "2.3.0", signedBy: "d".repeat(64), state: "approved", level: "Members", update: { version: "2.4.0" } },
    "shingai.coord": { name: "Coordination measures", repo: "git@x:coord.git", version: "0.4.1", signedBy: null, state: "review" },
  },
}));
const port = 19000 + Math.floor(Math.random() * 900);
const base = `http://127.0.0.1:${port}`;
let proc;

before(async () => {
  proc = spawn(process.execPath, [join(here, "..", "server", "server.js")], {
    env: {
      ...process.env, PORT: String(port), BUZZ_CLI: join(here, "fake-buzz.mjs"), FAKE_MEMBERS: files.members, FAKE_OUTBOX: files.outbox,
      AUTH_STORE: join(dir, "auth.json"), HUB_STORE: join(dir, "hub.json"), PLUGINS_SEED: files.seed,
      ACCESS_CHANNEL_ID: "00000000-0000-4000-8000-000000000001", AUTH_SECRET: "x".repeat(48), OWNER_PUBKEYS: OWNER, MEMBERSHIP_TTL_MS: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    proc.stdout.on("data", (d) => String(d).includes("listening") && resolve());
    proc.on("exit", (c) => reject(new Error("server exited " + c)));
  });
});
after(() => proc?.kill());

const call = async (method, path, token, body) => {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const codeFor = (pubkey) => {
  const line = readFileSync(files.outbox, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.channel.endsWith(pubkey.slice(0, 12))).at(-1);
  return /(\d{3})-(\d{3})/.exec(line.content).slice(1).join("");
};
async function signIn(pubkey) {
  assert.equal((await call("POST", "/auth/login", null, { pubkey })).status, 200);
  const r = await call("POST", "/auth/verify", null, { pubkey, code: codeFor(pubkey) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token;
}
const t = {};

test("everyone signs in; roles and permissions come back with /api/me", async () => {
  t.owner = await signIn(OWNER);
  t.ben = await signIn(BEN);
  t.cat = await signIn(CAT);
  const me = await call("GET", "/api/me", t.owner);
  assert.equal(me.body.role, "Owner");
  assert.equal(me.body.permissions.servers, true);
  const ben = await call("GET", "/api/me", t.ben);
  assert.equal(ben.body.role, "Member");
  assert.equal(ben.body.permissions.edit, true);
  assert.equal(ben.body.permissions.audit, false);
  await call("POST", "/api/me", t.ben, { name: "Ben Ade" });
});

test("members can't manage roles; owners can, and admins need an owner", async () => {
  assert.equal((await call("POST", `/api/members/${CAT}`, t.ben, { role: "Guest" })).status, 403);
  assert.equal((await call("POST", `/api/members/${OWNER}`, t.owner, { role: "Guest" })).status, 400, "owners are fixed");
  const r = await call("POST", `/api/members/${BEN}`, t.owner, { role: "Admin" });
  assert.equal(r.status, 200);
  assert.equal((await call("GET", "/api/me", t.ben)).body.role, "Admin");
  assert.equal((await call("POST", `/api/members/${CAT}`, t.ben, { role: "Admin" })).status, 403, "only owners make admins");
  assert.equal((await call("POST", `/api/members/${CAT}`, t.ben, { role: "Guest" })).status, 200, "admins can make guests");
  const members = await call("GET", "/api/members", t.cat);
  assert.equal(members.body.members.find((m) => m.pubkey === BEN).name, "Ben Ade");
  assert.ok(members.body.members.find((m) => m.pubkey === CAT).until > Date.now());
});

test("the permission grid is enforced and editable, but Owner and servers are protected", async () => {
  assert.equal((await call("GET", "/api/board", t.cat)).status, 200, "guests can view");
  assert.equal((await call("POST", "/api/board/projects", t.cat, { name: "X" })).status, 403, "guests can't edit");
  assert.equal((await call("PUT", "/api/permissions", t.ben, { permission: "edit", role: "Guest", on: true })).status, 200);
  assert.equal((await call("POST", "/api/board/projects", t.cat, { name: "Guest card" })).status, 201);
  assert.equal((await call("PUT", "/api/permissions", t.ben, { permission: "servers", role: "Admin", on: true })).status, 403);
  assert.equal((await call("PUT", "/api/permissions", t.owner, { permission: "audit", role: "Owner", on: false })).status, 400);
  const grid = await call("GET", "/api/permissions", t.cat);
  assert.equal(grid.body.permissions.find((p) => p.id === "edit").roles.Guest, true);
});

test("plugins: verified flag, levels, approve, reject and roll out", async () => {
  const list = await call("GET", "/api/plugins", t.cat);
  const board = list.body.plugins.find((p) => p.id === "northstar.board");
  assert.equal(board.verified, true);
  assert.equal(board.canUse, false, "guests can't use a members-and-up plugin");
  assert.equal(list.body.plugins.find((p) => p.id === "shingai.coord").verified, false);
  assert.equal((await call("PUT", "/api/plugins/northstar.board", t.ben, { level: "Everyone" })).status, 200);
  assert.equal((await call("GET", "/api/plugins", t.cat)).body.plugins.find((p) => p.id === "northstar.board").canUse, true);
  assert.equal((await call("POST", "/api/plugins/northstar.board/rollout", t.ben)).status, 200);
  assert.equal((await call("GET", "/api/plugins", t.ben)).body.plugins.find((p) => p.id === "northstar.board").version, "2.4.0");
  assert.equal((await call("POST", "/api/plugins/shingai.coord/approve", t.cat)).status, 403);
  assert.equal((await call("POST", "/api/plugins/shingai.coord/reject", t.ben)).status, 200);
  const trust = await call("GET", "/api/plugin-trust", t.ben);
  assert.deepEqual(trust.body.publishers, [{ key: "d".repeat(64) }]);
});

test("requests: anyone can ask, approvers answer", async () => {
  const made = await call("POST", "/api/requests", t.cat, { kind: "role", target: "Member", note: "I need to edit the board" });
  assert.equal(made.status, 201);
  assert.equal((await call("GET", "/api/requests", t.cat)).status, 403);
  const open = await call("GET", "/api/requests", t.ben);
  assert.equal(open.body.requests.length, 1);
  assert.equal((await call("POST", `/api/requests/${made.body.id}/approve`, t.ben)).status, 200);
  assert.equal((await call("GET", "/api/me", t.cat)).body.role, "Member");
  assert.equal((await call("GET", "/api/requests", t.ben)).body.requests.length, 0);
});

test("dashboard counts opt-in agent stats", async () => {
  const today = new Date().toISOString().slice(0, 10);
  await call("POST", "/api/stats", t.owner, { agents: [{ name: "Coffeehead", answered: { [today]: 12 } }, { name: "Stripe", answered: { [today]: 4, "bad-date": 999 } }] });
  const dash = await call("GET", "/api/dashboard?period=week", t.ben);
  assert.equal(dash.status, 200);
  assert.equal(dash.body.members, 3);
  assert.equal(dash.body.answered, 16);
  assert.equal(dash.body.topAgents[0].name, "Coffeehead");
  assert.equal(dash.body.pluginsInUse, 1);
  assert.ok(dash.body.lately.length > 0);
});

test("audit log is for admins, and removing someone signs them out", async () => {
  assert.equal((await call("GET", "/api/audit", t.cat)).status, 403);
  const log = await call("GET", "/api/audit", t.ben);
  assert.ok(log.body.entries.some((e) => /Signed in/.test(e.what)));
  assert.ok(log.body.entries.some((e) => /Rolled out Project Board 2.4.0/.test(e.what)));
  assert.equal((await call("POST", `/api/members/${CAT}/remove`, t.ben)).status, 200);
  assert.equal((await call("GET", "/api/me", t.cat)).status, 401);
  assert.equal((await call("POST", "/auth/login", null, { pubkey: CAT })).status, 200, "same answer as anyone");
  assert.equal((await call("POST", "/api/sessions/revoke-all", t.ben)).status, 403, "only owners manage sessions");
  assert.equal((await call("POST", "/api/sessions/revoke-all", t.owner)).status, 200);
  assert.equal((await call("GET", "/api/me", t.owner)).status, 401);
});
