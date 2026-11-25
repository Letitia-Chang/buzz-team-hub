// ---------- Team Hub demo backend ----------
// Runs Team Hub's real rules (server/hub.js, included by the demo build) in memory,
// with sample people, plugins and requests. Nothing leaves Buzz and nothing is saved:
// closing Buzz or pressing "Reset demo" starts over.

function createDemoBackend() {
  const DAY = 86_400_000;
  const key = (n) => n.toString(16).padStart(2, "0").repeat(32);
  const PEOPLE = {
    owner: { pubkey: key(0xa1), name: "Letitia Chang" },
    admin: { pubkey: key(0xb2), name: "James Harris" },
    member: { pubkey: key(0xc3), name: "Anushka Rao" },
    member2: { pubkey: key(0xd4), name: "Mei Lin" },
    member3: { pubkey: key(0xe5), name: "Shingai Thornton" },
    guest: { pubkey: key(0xf6), name: "Omar Haddad" },
    left: { pubkey: key(0x17), name: "Leo Grant" },
  };
  const PERSONA = { Owner: "owner", Admin: "admin", Member: "member", Guest: "guest" };
  const PUBLISHER_NS = key(0x2a);
  const PUBLISHER_LC = key(0x3b);
  let persona = "Owner";
  let lastCode = "";
  let hub;
  let data;

  function seed() {
    const now = Date.now();
    const day = (offset) => new Date(now - offset * DAY).toISOString().slice(0, 10);
    const series = (counts) => Object.fromEntries(counts.map((n, i) => [day(i), n]));
    const people = {};
    for (const p of Object.values(PEOPLE)) people[p.pubkey] = { name: p.name, firstSeen: now - 40 * DAY, lastSeen: now - Math.round(Math.random() * 3) * DAY };
    people[PEOPLE.admin.pubkey].role = "Admin";
    people[PEOPLE.guest.pubkey] = { ...people[PEOPLE.guest.pubkey], role: "Guest", until: now + 7 * DAY, firstSeen: now - 3 * DAY };
    people[PEOPLE.member3.pubkey].firstSeen = now - 2 * DAY;
    people[PEOPLE.left.pubkey].blocked = true;
    data = {
      people,
      permissions: {},
      trustedPublishers: [PUBLISHER_NS, PUBLISHER_LC],
      plugins: {
        "northstar.project-board": { name: "Project Board", repo: "github.com/north-star-ai-labs/project-board", version: "2.3.0", publisher: "North Star AI Labs", signedBy: PUBLISHER_NS, description: "Cards, owners and dates from the office server. Needs Team Hub sign-in.", level: "Members", state: "approved", update: { version: "2.4.0", signedBy: PUBLISHER_NS } },
        "letitia.agent-access": { name: "Agent Access", repo: "github.com/Letitia-Chang/buzz-agent-access", version: "4.4.0", publisher: "Letitia Chang", signedBy: PUBLISHER_LC, description: "Share your own agents with teammates, with limits.", level: "Everyone", state: "approved" },
        "shingai.coordination-measures": { name: "Coordination measures", repo: "github.com/shingai/coordination-measures", version: "0.4.1", publisher: "Shingai Thornton", signedBy: null, description: "Shows how a channel coordinates. Waiting for review.", level: "Members", state: "review", submittedBy: PEOPLE.member3.pubkey },
        "northstar.calendar-sync": { name: "Calendar Sync", repo: "github.com/north-star-ai-labs/calendar-sync", version: "1.1.0", publisher: "North Star AI Labs", signedBy: PUBLISHER_NS, description: "Puts team meetings on the board.", level: "Admins", state: "approved" },
      },
      requests: [
        { id: "a1b2c3d4e5f6", from: PEOPLE.member.pubkey, kind: "plugin", target: "shingai.coordination-measures", note: "Would help our standups.", at: now - 2 * 3600_000, state: "open" },
        { id: "b2c3d4e5f6a1", from: PEOPLE.guest.pubkey, kind: "role", target: "Member", note: "Joining the spring cohort full time.", at: now - 5 * 3600_000, state: "open" },
        { id: "c3d4e5f6a1b2", from: PEOPLE.member2.pubkey, kind: "plugin", target: "northstar.calendar-sync", note: "", at: now - DAY, state: "open" },
      ],
      audit: [
        { at: now - 2 * 3600_000, who: PEOPLE.admin.pubkey, icon: "puzzle", what: "Updated Project Board to 2.3.0" },
        { at: now - 3 * 3600_000, who: PEOPLE.owner.pubkey, icon: "shield", what: "Made Omar Haddad a Guest until next week" },
        { at: now - 20 * 3600_000, who: PEOPLE.owner.pubkey, icon: "circle-check", what: "Approved Agent Access" },
        { at: now - DAY - 3600_000, who: PEOPLE.admin.pubkey, icon: "shield", what: "Made Anushka Rao a Member" },
        { at: now - 2 * DAY, who: "system", icon: "log-out", what: "Signed out Leo Grant (left the access channel)" },
        { at: now - 2 * DAY - 3600_000, who: PEOPLE.member.pubkey, icon: "key-round", what: "Signed in with a Buzz code" },
        { at: now - 3 * DAY, who: PEOPLE.owner.pubkey, icon: "puzzle", what: "Set Calendar Sync to admins and up" },
      ],
      stats: {
        [PEOPLE.owner.pubkey]: { at: now, agents: [{ name: "Coffeehead", answered: series([18, 22, 17, 25, 14, 12, 12]) }, { name: "Stripe", answered: series([14, 15, 13, 16, 12, 14, 12]) }] },
        [PEOPLE.admin.pubkey]: { at: now, agents: [{ name: "Metrics Mate", answered: series([12, 13, 11, 14, 12, 14, 12]) }] },
        [PEOPLE.member.pubkey]: { at: now, agents: [{ name: "Lab Notes", answered: series([9, 8, 10, 7, 9, 9, 9]) }] },
        [PEOPLE.member3.pubkey]: { at: now, agents: [{ name: "Coord bot", answered: series([5, 7, 8, 6, 7, 6, 8]) }] },
      },
    };
    const store = { get: () => data, update: async (fn) => { fn(data); } };
    const inChannel = Object.values(PEOPLE).filter((p) => p !== PEOPLE.left).map((p) => p.pubkey);
    const auth = {
      memberList: async () => ({ pubkeys: inChannel, checkedAt: Date.now() - 60_000 }),
      requireMember: async () => ({ pubkey: current().pubkey }),
    };
    const sessions = { revokePubkey: async () => {}, revokeAll: async () => {} };
    hub = createHub({ auth, sessions, store, ownerPubkeys: [PEOPLE.owner.pubkey], version: "1.0.0 (demo)", startedAt: now - 26 * 3600_000 });
  }
  const current = () => PEOPLE[PERSONA[persona]];

  async function call(path, { method = "GET", body } = {}) {
    await new Promise((r) => setTimeout(r, 120)); // feel like a network
    if (path === "/auth/login") {
      lastCode = String(Math.floor(100000 + Math.random() * 900000));
      return { status: 200, data: { ok: true } };
    }
    if (path === "/auth/verify")
      return body?.code === lastCode
        ? { status: 200, data: { token: "demo", expiresAt: Date.now() + 14 * DAY } }
        : { status: 400, data: { error: "That code isn't right." } };
    if (path === "/auth/logout") return { status: 200, data: { ok: true } };
    const req = { url: path, method, body };
    const res = {};
    const answered = await hub.handle(req, res);
    if (!answered) return { status: 404, data: { error: "Not in the demo." } };
    return { status: res.status, data: res.body };
  }

  seed();
  return {
    call,
    get lastCode() { return lastCode; },
    get persona() { return persona; },
    setPersona(role) { persona = role; },
    reset() { persona = "Owner"; lastCode = ""; seed(); },
    nameFor: (pubkey) => Object.values(PEOPLE).find((p) => p.pubkey === pubkey)?.name,
    viewerName: () => current().name,
  };
}

// Stand-ins for the Node pieces server/hub.js imports.
function readJson(req) { return Promise.resolve(req.body ?? {}); }
function sendJson(res, status, body) { res.status = status; res.body = body; }
function randomBytes(n) {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return { toString: () => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("") };
}
