// End-to-end: runs the real server against the fake `buzz` CLI.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "pb-auth-"));
const MEMBER = "a".repeat(64);
const MEMBER2 = "b".repeat(64);
const OUTSIDER = "c".repeat(64);
const files = { members: join(dir, "members.txt"), outbox: join(dir, "outbox.jsonl"), store: join(dir, "store.json") };
writeFileSync(files.members, `${MEMBER}\n${MEMBER2}\n`);
writeFileSync(files.outbox, "");
const port = 18000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
let proc;

before(async () => {
  proc = spawn(process.execPath, [join(here, "..", "server", "server.js")], {
    env: {
      ...process.env,
      PORT: String(port),
      BUZZ_CLI: join(here, "fake-buzz.mjs"),
      FAKE_MEMBERS: files.members,
      FAKE_OUTBOX: files.outbox,
      AUTH_STORE: files.store,
      ACCESS_CHANNEL_ID: "00000000-0000-4000-8000-000000000001",
      AUTH_SECRET: "x".repeat(48),
      OWNER_PUBKEYS: MEMBER,
      HUB_STORE: join(dir, "hub.json"),
      PLUGINS_SEED: join(dir, "none.json"),
      MEMBERSHIP_TTL_MS: "0", // re-check membership on every request in tests
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    proc.stdout.on("data", (d) => String(d).includes("listening") && resolve());
    proc.on("exit", (c) => reject(new Error("server exited " + c)));
  });
});
after(() => proc?.kill());

const post = (path, body, token) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const get = (path, token) => fetch(base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
const sentCodes = () => readFileSync(files.outbox, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const lastCode = () => /(\d{3})-(\d{3})/.exec(sentCodes().at(-1).content).slice(1).join("");

let token;

test("data needs sign-in", async () => {
  assert.equal((await get("/api/board")).status, 401);
});

test("member gets a code by DM and signs in", async () => {
  const r = await post("/auth/login", { pubkey: MEMBER });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).sent, true);
  const dm = sentCodes().at(-1);
  assert.match(dm.channel, /^11111111-/);
  assert.match(dm.content, /sign-in code is \d{3}-\d{3}/);

  const v = await post("/auth/verify", { pubkey: MEMBER, code: lastCode() });
  assert.equal(v.status, 200);
  const body = await v.json();
  assert.ok(body.token.length > 30);
  assert.equal(body.admin, true);
  token = body.token;

  const me = await (await get("/auth/me", token)).json();
  assert.equal(me.pubkey, MEMBER);
  const board = await get("/api/board", token);
  assert.equal(board.status, 200);
  assert.equal((await board.json()).projects.length, 2);
});

test("codes are single use", async () => {
  // the code above was consumed
  const v = await post("/auth/verify", { pubkey: MEMBER, code: "000000" });
  assert.equal(v.status, 401);
});

test("outsiders get the same reply but no DM", async () => {
  const before = sentCodes().length;
  const r = await post("/auth/login", { pubkey: OUTSIDER });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(await r.json()).sort(), ["expiresInSeconds", "sent"]);
  assert.equal(sentCodes().length, before);
});

test("wrong guesses are limited", async () => {
  await post("/auth/login", { pubkey: MEMBER2 });
  const real = lastCode();
  const wrong = real === "123456" ? "654321" : "123456";
  for (let i = 0; i < 5; i++) assert.equal((await post("/auth/verify", { pubkey: MEMBER2, code: wrong })).status, 401);
  // even the right code fails now
  assert.equal((await post("/auth/verify", { pubkey: MEMBER2, code: real })).status, 401);
});

test("login requests are rate limited per person", async () => {
  // MEMBER2 has used 1 of 3; two more allowed, then 429
  assert.equal((await post("/auth/login", { pubkey: MEMBER2 })).status, 200);
  assert.equal((await post("/auth/login", { pubkey: MEMBER2 })).status, 200);
  assert.equal((await post("/auth/login", { pubkey: MEMBER2 })).status, 429);
});

test("bad input is rejected", async () => {
  assert.equal((await post("/auth/login", { pubkey: "npub1xyz" })).status, 400);
  assert.equal((await post("/auth/verify", { pubkey: MEMBER, code: "12" })).status, 400);
  assert.equal((await get("/api/board", "not-a-real-token-at-all-xx")).status, 401);
});

test("store holds only hashes", async () => {
  assert.ok(existsSync(files.store));
  const raw = readFileSync(files.store, "utf8");
  assert.ok(!raw.includes(token), "token must not be stored in plain text");
});

test("removing someone from the channel ends their access", async () => {
  // MEMBER signs in again, then is removed from the channel
  writeFileSync(files.outbox, "");
  await post("/auth/login", { pubkey: MEMBER });
  const v = await (await post("/auth/verify", { pubkey: MEMBER, code: lastCode() })).json();
  assert.equal((await get("/api/board", v.token)).status, 200);
  writeFileSync(files.members, `${MEMBER2}\n`);
  assert.equal((await get("/api/board", v.token)).status, 401);
  writeFileSync(files.members, `${MEMBER}\n${MEMBER2}\n`);
  assert.equal((await get("/api/board", v.token)).status, 200);
});

test("logout ends the session", async () => {
  assert.equal((await post("/auth/logout", {}, token)).status, 200);
  assert.equal((await get("/api/board", token)).status, 401);
});
