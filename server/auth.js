// "Sign in with Buzz" for a plugin's own server.
//
//   POST /auth/login   { pubkey }          -> DMs that person a one-time code
//   POST /auth/verify  { pubkey, code }    -> { token, expiresAt } if the code matches
//   GET  /auth/me      (Bearer token)      -> { pubkey, admin }
//   POST /auth/logout  (Bearer token)      -> ends this session
//
// Who is allowed = members of one private Buzz channel (ACCESS_CHANNEL_ID).
// The relay enforces that membership and signs the member list (kind:39002), so
// admins manage access in Buzz itself. Membership is re-checked every few
// minutes, so removing someone from the channel ends their access quickly.
//
// Only hashes of codes and tokens are stored. Codes are short-lived, single-use
// and limited to a few guesses; requests are rate limited per person and per IP.

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

const HEX64 = /^[0-9a-f]{64}$/;
const MINUTE = 60_000;

export function createAuth({
  cli,                                   // from createBuzzCli()
  store,                                 // from createStore()
  accessChannelId,                       // private channel whose members may sign in
  adminPubkeys = [],                     // optional: pubkeys treated as admins
  secret,                                // server secret for code hashing (32+ random bytes, hex)
  appName = "Team Hub",
  isBlocked = async () => false,          // optional: removed by an admin, even if still in the channel
  onSignIn = async () => {},              // optional: audit hook
  codeTtlMs = 10 * MINUTE,
  sessionTtlMs = 14 * 24 * 60 * MINUTE,
  membershipTtlMs = 5 * MINUTE,
  maxGuesses = 5,
  now = () => Date.now(),
  log = (line) => console.log(`[auth] ${line}`),
}) {
  if (!secret || secret.length < 32) throw new Error("auth: a secret of at least 32 characters is required");
  if (!accessChannelId) throw new Error("auth: accessChannelId is required");
  const admins = new Set(adminPubkeys.map((k) => k.toLowerCase()));

  // ---- membership (cached) ----
  let members = { at: 0, set: new Set() };
  async function isMember(pubkey) {
    if (now() - members.at > membershipTtlMs) {
      const list = await cli.channelMembers(accessChannelId);
      members = { at: now(), set: new Set(list) };
    }
    return members.set.has(pubkey) && !(await isBlocked(pubkey));
  }
  /** Everyone in the access channel (cached like the checks above). */
  async function memberList() {
    if (now() - members.at > membershipTtlMs) {
      const list = await cli.channelMembers(accessChannelId);
      members = { at: now(), set: new Set(list) };
    }
    return { pubkeys: [...members.set], checkedAt: members.at };
  }

  // ---- rate limits (in memory) ----
  const buckets = new Map();
  function allow(key, limit, windowMs) {
    const t = now();
    const hits = (buckets.get(key) || []).filter((x) => t - x < windowMs);
    if (hits.length >= limit) {
      buckets.set(key, hits);
      return false;
    }
    hits.push(t);
    buckets.set(key, hits);
    return true;
  }

  const hashCode = (pubkey, code) => createHmac("sha256", secret).update(`${pubkey}:${code}`).digest("hex");
  const hashToken = (token) => createHash("sha256").update(token).digest("hex");
  const sameHex = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));

  // ---- handlers ----
  async function login(body, ip) {
    const pubkey = String(body?.pubkey || "").toLowerCase();
    if (!HEX64.test(pubkey)) return [400, { error: "pubkey must be a 64-character hex key" }];
    if (!allow(`ip:${ip}`, 20, 15 * MINUTE) || !allow(`login:${pubkey}`, 3, 15 * MINUTE))
      return [429, { error: "Too many sign-in attempts. Try again in 15 minutes." }];

    // Same answer whether or not they're a member, so the endpoint can't be used
    // to find out who is in the private channel.
    const reply = [200, { sent: true, expiresInSeconds: Math.round(codeTtlMs / 1000) }];
    let member = false;
    try {
      member = await isMember(pubkey);
    } catch (error) {
      log(`membership check failed: ${error.message}`);
      return [503, { error: "Can't reach Buzz right now. Try again shortly." }];
    }
    if (!member) {
      log(`login for non-member ${pubkey.slice(0, 8)}…: no code sent`);
      return reply;
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await store.saveCode(pubkey, { hash: hashCode(pubkey, code), expiresAt: now() + codeTtlMs, guesses: 0 });
    try {
      const dm = await cli.openDm(pubkey);
      await cli.sendMessage(
        dm,
        `Your ${appName} sign-in code is ${code.slice(0, 3)}-${code.slice(3)}. ` +
          `It works once and expires in ${Math.round(codeTtlMs / MINUTE)} minutes. ` +
          `If you didn't ask to sign in, ignore this message.`,
      );
    } catch (error) {
      await store.deleteCode(pubkey);
      log(`could not DM ${pubkey.slice(0, 8)}…: ${error.message}`);
      return [503, { error: "Couldn't send your code through Buzz. Try again shortly." }];
    }
    log(`code sent to ${pubkey.slice(0, 8)}…`);
    return reply;
  }

  async function verify(body, ip) {
    const pubkey = String(body?.pubkey || "").toLowerCase();
    const code = String(body?.code || "").replace(/\D/g, "");
    if (!HEX64.test(pubkey) || code.length !== 6) return [400, { error: "Enter the 6-digit code from your Buzz DM." }];
    if (!allow(`verify-ip:${ip}`, 30, 15 * MINUTE)) return [429, { error: "Too many attempts. Try again later." }];

    const saved = await store.getCode(pubkey);
    if (!saved || saved.expiresAt < now()) {
      await store.deleteCode(pubkey);
      return [401, { error: "That code has expired. Request a new one." }];
    }
    if (saved.guesses >= maxGuesses) {
      await store.deleteCode(pubkey);
      return [401, { error: "Too many wrong codes. Request a new one." }];
    }
    if (!sameHex(saved.hash, hashCode(pubkey, code))) {
      await store.saveCode(pubkey, { ...saved, guesses: saved.guesses + 1 });
      return [401, { error: "That code isn't right." }];
    }
    await store.deleteCode(pubkey); // single use

    if (!(await isMember(pubkey))) return [403, { error: "You don't have access." }];
    const token = randomBytes(32).toString("base64url");
    const expiresAt = now() + sessionTtlMs;
    await store.saveSession(hashToken(token), { pubkey, expiresAt, createdAt: now() });
    log(`signed in ${pubkey.slice(0, 8)}…`);
    await onSignIn(pubkey);
    return [200, { token, expiresAt, admin: admins.has(pubkey) }];
  }

  /** Resolves the signed-in member for a request, or undefined. */
  async function authenticate(req) {
    const header = String(req.headers?.authorization || "");
    const match = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(header);
    if (!match) return undefined;
    const key = hashToken(match[1]);
    const session = await store.getSession(key);
    if (!session) return undefined;
    if (session.expiresAt < now()) {
      await store.deleteSession(key);
      return undefined;
    }
    // Removed from the channel? Access ends at the next membership refresh.
    if (!(await isMember(session.pubkey))) return undefined;
    return { pubkey: session.pubkey, admin: admins.has(session.pubkey), sessionKey: key };
  }

  /** Express/Node-style guard for your data routes. */
  async function requireMember(req, res) {
    let who;
    try {
      who = await authenticate(req);
    } catch (error) {
      log(`auth check failed: ${error.message}`);
      sendJson(res, 503, { error: "Can't check your access right now." });
      return undefined;
    }
    if (!who) {
      sendJson(res, 401, { error: "Sign in with Buzz to see this." });
      return undefined;
    }
    return who;
  }

  /** Handles /auth/* routes. Returns true when it answered the request. */
  async function handle(req, res) {
    const url = new URL(req.url, "http://local");
    if (!url.pathname.startsWith("/auth/")) return false;
    const ip = String(req.headers["cf-connecting-ip"] || req.socket?.remoteAddress || "unknown");
    try {
      if (req.method === "POST" && url.pathname === "/auth/login") {
        const [status, body] = await login(await readJson(req), ip);
        sendJson(res, status, body);
      } else if (req.method === "POST" && url.pathname === "/auth/verify") {
        const [status, body] = await verify(await readJson(req), ip);
        sendJson(res, status, body);
      } else if (req.method === "GET" && url.pathname === "/auth/me") {
        const who = await requireMember(req, res);
        if (who) sendJson(res, 200, { pubkey: who.pubkey, admin: who.admin });
      } else if (req.method === "POST" && url.pathname === "/auth/logout") {
        const who = await authenticate(req).catch(() => undefined);
        if (who) await store.deleteSession(who.sessionKey);
        sendJson(res, 200, { ok: true });
      } else {
        sendJson(res, 404, { error: "Not found" });
      }
    } catch (error) {
      log(`error on ${url.pathname}: ${error.message}`);
      sendJson(res, error.status || 500, { error: error.status ? error.message : "Something went wrong." });
    }
    return true;
  }

  return { handle, requireMember, authenticate, memberList, isMember, forgetMembership: () => { members = { at: 0, set: new Set() }; } };
}

// ---- small HTTP helpers ----

export function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

export function readJson(req, limit = 16384) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const error = new Error("Request too large");
        error.status = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        const error = new Error("Invalid JSON");
        error.status = 400;
        reject(error);
      }
    });
    req.on("error", reject);
  });
}
