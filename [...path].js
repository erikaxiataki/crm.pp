// proj/server.js
import http from "node:http";
import fs3 from "node:fs";
import path4 from "node:path";
import { fileURLToPath as fileURLToPath2, pathToFileURL as pathToFileURL2 } from "node:url";

// proj/src/store.js
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
var COLS = ["contacts", "deals", "orders", "tasks", "messages", "products", "events"];
var PFX = { contacts: "c", deals: "d", orders: "o", tasks: "t", messages: "m", products: "p" };
var nid = (p) => `${p}_${crypto.randomBytes(5).toString("hex")}`;
var Store = class {
  // file: path for local JSON storage. adapter: optional remote store ({ get(), set(json) }) for serverless hosts.
  constructor(file, adapter = null) {
    this.file = file || null;
    this.adapter = adapter;
    this.dirty = false;
    this.fresh = adapter ? true : !file || !fs.existsSync(file);
    this.data = Object.fromEntries(COLS.map((c) => [c, []]));
    if (!adapter && !this.fresh) {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const c of COLS) this.data[c] = Array.isArray(j[c]) ? j[c] : [];
    }
  }
  /** Remote mode: pull the latest data. Call at the start of every request. */
  async load() {
    if (!this.adapter) return;
    const raw = await this.adapter.get();
    const j = raw ? JSON.parse(raw) : {};
    this.fresh = !raw;
    for (const c of COLS) this.data[c] = Array.isArray(j[c]) ? j[c] : [];
    this.dirty = false;
  }
  /** Remote mode: push changes. Call at the end of every request. */
  async flush() {
    if (this.adapter && this.dirty) {
      await this.adapter.set(JSON.stringify(this.data));
      this.dirty = false;
    }
  }
  save() {
    if (this.adapter) {
      this.dirty = true;
      return;
    }
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
  list(col) {
    return this.data[col];
  }
  get(col, id) {
    return this.data[col].find((x) => x.id === id) || null;
  }
  insert(col, rec) {
    const r = { ...rec, id: nid(PFX[col]), createdAt: (/* @__PURE__ */ new Date()).toISOString() };
    this.data[col].push(r);
    this.save();
    return r;
  }
  update(col, id, patch) {
    const r = this.get(col, id);
    if (!r) return null;
    Object.assign(r, patch, { id: r.id, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
    this.save();
    return r;
  }
  remove(col, id) {
    const i = this.data[col].findIndex((x) => x.id === id);
    if (i < 0) return false;
    this.data[col].splice(i, 1);
    this.save();
    return true;
  }
  replaceAll(data) {
    for (const c of COLS) this.data[c] = Array.isArray(data[c]) ? data[c] : [];
    this.save();
  }
};

// proj/src/core.js
import fs2 from "node:fs";
import path2 from "node:path";
import crypto4 from "node:crypto";

// proj/src/api.js
import crypto3 from "node:crypto";

// proj/src/schema.js
var CONTACT_TYPES = ["lead", "customer", "retail", "partner", "media"];
var DEAL_STAGES = ["lead", "sample_sent", "negotiating", "won", "lost"];
var ORDER_STATUS = ["new", "paid", "packed", "shipped", "delivered", "cancelled"];
var CHANNELS = ["email", "instagram", "facebook", "sms", "call", "note", "in_person"];
var EVENT_TYPES = ["production", "delivery", "market", "post", "meeting", "other"];
var ORDER_CHANNELS = ["online", "market", "wholesale", "other"];
var str = (v) => v == null ? "" : String(v).trim();
var num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
var arr = (v) => Array.isArray(v) ? v.map(str).filter(Boolean) : [];
var obj = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
var oneOf = (list, d2) => (v) => list.includes(v) ? v : d2;
var date = (v) => v ? str(v).slice(0, 10) : "";
var iso = (v) => v ? str(v) : "";
var SCHEMA = {
  contacts: {
    required: ["name"],
    fields: {
      type: oneOf(CONTACT_TYPES, "lead"),
      name: str,
      org: str,
      email: (v) => str(v).toLowerCase(),
      phone: str,
      handles: obj,
      // { instagram: 'name', facebook: 'name' }
      ext: obj,
      // platform ids learned from inbound messages { instagram: 'IGSID', facebook: 'PSID' }
      dog: obj,
      // { name, breed, allergies, notes }
      tags: arr,
      source: str,
      notes: str,
      optIn: (v) => !!v,
      lastContactAt: iso
    }
  },
  deals: {
    required: ["contactId", "title"],
    fields: { contactId: str, title: str, stage: oneOf(DEAL_STAGES, "lead"), value: num, expectedClose: date, notes: str }
  },
  orders: {
    required: ["contactId"],
    fields: {
      contactId: str,
      channel: oneOf(ORDER_CHANNELS, "online"),
      status: oneOf(ORDER_STATUS, "new"),
      items: (v) => Array.isArray(v) ? v.map((i) => ({ productId: str(i.productId), name: str(i.name), qty: num(i.qty) || 1, price: num(i.price) })) : [],
      total: num,
      date,
      notes: str
    }
  },
  tasks: {
    required: ["title"],
    fields: { contactId: str, title: str, due: date, done: (v) => !!v, notes: str }
  },
  messages: {
    required: ["body"],
    fields: {
      contactId: str,
      channel: oneOf(CHANNELS, "note"),
      account: str,
      direction: oneOf(["in", "out"], "out"),
      subject: str,
      body: str,
      at: iso,
      read: (v) => !!v,
      status: str,
      externalId: str,
      error: str
    }
  },
  events: {
    required: ["title", "date"],
    fields: { title: str, type: oneOf(EVENT_TYPES, "other"), date, time: str, contactId: str, notes: str, done: (v) => !!v, sample: (v) => !!v }
  },
  products: {
    required: ["name"],
    fields: { name: str, sku: str, price: num, wholesale: num, stock: num, active: (v) => v !== false, notes: str }
  }
};
function clean(col, body, partial = false) {
  const s = SCHEMA[col];
  if (!body || typeof body !== "object") return { error: "Body must be a JSON object" };
  const out = {};
  for (const [k, fn] of Object.entries(s.fields)) {
    if (partial ? k in body : true) out[k] = fn(body[k]);
    else if (!partial && body[k] === void 0) out[k] = fn(void 0);
  }
  if (!partial) {
    for (const r of s.required) if (!out[r]) return { error: `${r} is required` };
  }
  if (partial) {
    for (const r of s.required) if (r in out && !out[r]) return { error: `${r} cannot be empty` };
  }
  return { value: out };
}

// proj/src/connectors/meta.js
import crypto2 from "node:crypto";
function metaStatus(env) {
  return {
    id: "meta",
    label: "Facebook + Instagram DMs",
    configured: !!(env.META_PAGE_TOKEN && env.META_APP_SECRET && env.META_VERIFY_TOKEN),
    missing: ["META_PAGE_TOKEN", "META_APP_SECRET", "META_VERIFY_TOKEN"].filter((k) => !env[k]),
    webhook: "/api/webhooks/meta"
  };
}
function verifySignature(rawBody, header, appSecret) {
  if (!appSecret || !header || !header.startsWith("sha256=")) return false;
  const expected = crypto2.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const got = header.slice(7);
  if (got.length !== expected.length) return false;
  return crypto2.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
function parseWebhook(body, env) {
  const out = [];
  if (!body || !Array.isArray(body.entry)) return out;
  const channel = body.object === "instagram" ? "instagram" : "facebook";
  const account = channel === "instagram" ? env.META_IG_ACCOUNT_LABEL || "@purelypei" : env.META_FB_ACCOUNT_LABEL || "Purely PEI";
  for (const entry of body.entry) {
    for (const ev of entry.messaging || []) {
      const m = ev.message;
      if (!m || m.is_echo) continue;
      const text = m.text || (m.attachments?.length ? `[${m.attachments[0].type || "attachment"}]` : "");
      if (!text) continue;
      out.push({
        channel,
        account,
        body: text,
        externalId: m.mid,
        at: ev.timestamp ? new Date(ev.timestamp).toISOString() : (/* @__PURE__ */ new Date()).toISOString(),
        from: { id: ev.sender?.id }
      });
    }
  }
  return out;
}
async function sendMeta({ channel, recipientId, text, env, fetchImpl = fetch }) {
  const ver = env.META_GRAPH_VERSION || "v21.0";
  const res = await fetchImpl(`https://graph.facebook.com/${ver}/me/messages?access_token=${encodeURIComponent(env.META_PAGE_TOKEN)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text } })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error?.message || `Meta API ${res.status}`);
  return { externalId: j.message_id };
}

// proj/src/connectors/zoho.js
var stripHtml = (h) => String(h || "").replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\n{3,}/g, "\n\n").trim();
var unquote = (t) => {
  const i = t.search(/\n\s*(On .{5,80} wrote:|Le .{5,80} a écrit\s*:|-{2,}\s*Original Message)/i);
  return (i > 0 ? t.slice(0, i) : t).trim();
};
function zohoStatus(env) {
  const need = ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN"];
  const missing = need.filter((k) => !env[k]);
  return { id: "zoho", label: "Zoho Mail (send + receive)", configured: missing.length === 0, missing, sync: "/api/email/sync" };
}
function createZoho({ env, fetchImpl = fetch }) {
  const domain = env.ZOHO_DOMAIN || "zoho.com";
  const accountsUrl = `https://accounts.${domain}`, mailUrl = `https://mail.${domain}`;
  let access = null, exp = 0, account = env.ZOHO_ACCOUNT_ID ? { id: env.ZOHO_ACCOUNT_ID, email: env.EMAIL_FROM || "" } : null, inboxId = env.ZOHO_INBOX_FOLDER_ID || null;
  async function token() {
    if (access && Date.now() < exp) return access;
    const q = new URLSearchParams({ refresh_token: env.ZOHO_REFRESH_TOKEN, client_id: env.ZOHO_CLIENT_ID, client_secret: env.ZOHO_CLIENT_SECRET, grant_type: "refresh_token" });
    const r = await fetchImpl(`${accountsUrl}/oauth/v2/token?${q}`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error("Zoho login failed: " + (j.error || r.status));
    access = j.access_token;
    exp = Date.now() + ((j.expires_in || 3600) - 120) * 1e3;
    return access;
  }
  async function call(method, path5, body) {
    const r = await fetchImpl(mailUrl + path5, { method, headers: { authorization: `Zoho-oauthtoken ${await token()}`, accept: "application/json", ...body ? { "content-type": "application/json" } : {} }, body: body ? JSON.stringify(body) : void 0 });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.status && j.status.code && j.status.code >= 400) throw new Error("Zoho Mail: " + (j.data?.errorCode || j.status?.description || r.status));
    return j.data;
  }
  async function acct() {
    if (account) return account;
    const d2 = await call("GET", "/api/accounts");
    const a = Array.isArray(d2) ? d2[0] : d2;
    if (!a?.accountId) throw new Error("Zoho Mail: no mail account found for this login");
    account = { id: String(a.accountId), email: a.primaryEmailAddress || a.emailAddress?.[0]?.mailId || env.EMAIL_FROM || "" };
    return account;
  }
  async function send({ to, subject, text }) {
    const a = await acct();
    const d2 = await call("POST", `/api/accounts/${a.id}/messages`, { fromAddress: env.EMAIL_FROM || a.email, toAddress: to, subject: subject || "(no subject)", content: text, mailFormat: "plaintext" });
    return { externalId: d2?.messageId ? "zoho:" + d2.messageId : "" };
  }
  async function inbox({ limit = 25, sinceMs = 0 } = {}) {
    const a = await acct();
    if (!inboxId) {
      const f = await call("GET", `/api/accounts/${a.id}/folders`);
      inboxId = (f || []).find((x) => String(x.folderType).toLowerCase() === "inbox")?.folderId;
      if (!inboxId) throw new Error("Zoho Mail: Inbox folder not found");
    }
    const list = await call("GET", `/api/accounts/${a.id}/messages/view?folderId=${inboxId}&limit=${limit}&sortBy=date&sortorder=false`) || [];
    const out = [];
    for (const m of list) {
      const at = Number(m.receivedTime || m.sentDateInGMT || 0);
      if (sinceMs && at < sinceMs) continue;
      let body = stripHtml(m.summary || "");
      try {
        const c = await call("GET", `/api/accounts/${a.id}/folders/${m.folderId || inboxId}/messages/${m.messageId}/content`);
        if (c?.content) body = unquote(stripHtml(c.content));
      } catch {
      }
      const email = String(m.fromAddress || "").toLowerCase().replace(/^.*<|>.*$/g, "").trim();
      out.push({ id: String(m.messageId), from: { email, name: String(m.sender || "").replace(/&quot;/g, '"').replace(/^"|"$/g, "") || email }, subject: m.subject || "", body: body || "(empty message)", at: new Date(at || Date.now()).toISOString(), self: !!a.email && email === a.email.toLowerCase() });
    }
    return out.reverse();
  }
  async function exchange(code) {
    const q = new URLSearchParams({ code, client_id: env.ZOHO_CLIENT_ID, client_secret: env.ZOHO_CLIENT_SECRET, grant_type: "authorization_code" });
    const r = await fetchImpl(`${accountsUrl}/oauth/v2/token?${q}`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (!j.refresh_token) throw new Error("Zoho said: " + (j.error || r.status) + ". The code works once and expires in 10 minutes. Generate a new one.");
    return j.refresh_token;
  }
  return { send, inbox, exchange };
}

// proj/src/connectors/email.js
function emailStatus(env) {
  if (zohoStatus(env).configured) return { id: "email", label: "Email (send)", configured: true, provider: "zoho", missing: [] };
  const resend = !!env.RESEND_API_KEY;
  const smtp = !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
  return {
    id: "email",
    label: "Email (send)",
    configured: !!env.EMAIL_FROM && (resend || smtp),
    provider: resend ? "resend" : smtp ? "smtp" : null,
    missing: env.EMAIL_FROM && (resend || smtp) ? [] : ["EMAIL_FROM", "RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS"]
  };
}
async function sendEmail({ to, subject, text, env, fetchImpl = fetch }) {
  if (zohoStatus(env).configured) return createZoho({ env, fetchImpl }).send({ to, subject, text });
  if (env.RESEND_API_KEY) {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject: subject || "(no subject)", text })
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.message || `Resend ${res.status}`);
    return { externalId: j.id };
  }
  let nodemailer;
  try {
    nodemailer = (await import("nodemailer")).default;
  } catch {
    throw new Error("SMTP needs nodemailer: run npm install nodemailer");
  }
  const t = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT) || 587,
    secure: Number(env.SMTP_PORT) === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }
  });
  const info = await t.sendMail({ from: env.EMAIL_FROM, to, subject: subject || "(no subject)", text });
  return { externalId: info.messageId };
}

// proj/src/api.js
var DAY = 864e5;
var today = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
var safeEq = (a, b) => {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && crypto3.timingSafeEqual(x, y);
};
var norm = (h) => String(h || "").trim().replace(/^@/, "").toLowerCase();
function createApi({ store, env, fetchImpl = fetch }) {
  function findContact({ channel, from = {} }) {
    const email = String(from.email || "").toLowerCase();
    const handle2 = norm(from.handle);
    return store.list("contacts").find((c) => email && c.email === email || handle2 && norm(c.handles?.[channel]) === handle2 || from.id && c.ext?.[channel] === from.id) || null;
  }
  function ingest(m) {
    if (m.externalId && store.list("messages").some((x) => x.externalId === m.externalId)) return { duplicate: true };
    const from = m.from || {};
    let c = findContact(m);
    let created = false;
    if (!c) {
      const name = from.name || (from.handle ? "@" + norm(from.handle) : "") || from.email || "New contact";
      c = store.insert("contacts", {
        type: "lead",
        name,
        org: "",
        email: String(from.email || "").toLowerCase(),
        phone: "",
        handles: from.handle ? { [m.channel]: norm(from.handle) } : {},
        ext: from.id ? { [m.channel]: from.id } : {},
        dog: {},
        tags: ["inbound"],
        source: m.channel,
        notes: "",
        optIn: false,
        lastContactAt: ""
      });
      created = true;
    } else if (from.id && !c.ext?.[m.channel]) {
      store.update("contacts", c.id, { ext: { ...c.ext || {}, [m.channel]: from.id } });
    }
    const at = m.at || (/* @__PURE__ */ new Date()).toISOString();
    const msg = store.insert("messages", {
      contactId: c.id,
      channel: m.channel,
      account: m.account || "",
      direction: "in",
      subject: m.subject || "",
      body: m.body,
      at,
      read: false,
      status: "received",
      externalId: m.externalId || "",
      error: ""
    });
    store.update("contacts", c.id, { lastContactAt: at });
    return { message: msg, contact: c, created };
  }
  async function send({ contactId, channel, body, subject, account }) {
    const c = store.get("contacts", contactId);
    if (!c) return { status: 404, body: { error: "Contact not found" } };
    if (!body) return { status: 400, body: { error: "body is required" } };
    const base = { contactId, channel, direction: "out", subject: subject || "", body, at: (/* @__PURE__ */ new Date()).toISOString(), read: true, externalId: "", error: "" };
    let configured = false;
    try {
      if (channel === "email") {
        configured = emailStatus(env).configured;
        if (configured) {
          if (!c.email) return { status: 422, body: { error: "Contact has no email address" } };
          const r = await sendEmail({ to: c.email, subject, text: body, env, fetchImpl });
          const msg2 = store.insert("messages", { ...base, account: account || env.EMAIL_ACCOUNT_LABEL || "email", status: "sent", externalId: r.externalId || "" });
          return { status: 201, body: msg2 };
        }
      } else if (channel === "instagram" || channel === "facebook") {
        configured = metaStatus(env).configured;
        if (configured) {
          const rid = c.ext?.[channel];
          if (!rid) return { status: 422, body: { error: `No ${channel} thread yet. They must message you first (Meta only allows replies within 24h of their message).` } };
          const r = await sendMeta({ channel, recipientId: rid, text: body, env, fetchImpl });
          const msg2 = store.insert("messages", { ...base, account: account || (channel === "instagram" ? env.META_IG_ACCOUNT_LABEL : env.META_FB_ACCOUNT_LABEL) || channel, status: "sent", externalId: r.externalId || "" });
          return { status: 201, body: msg2 };
        }
      } else {
        const msg2 = store.insert("messages", { ...base, account: account || "", status: "logged" });
        return { status: 201, body: msg2 };
      }
    } catch (e) {
      const msg2 = store.insert("messages", { ...base, account: account || "", status: "failed", error: String(e.message || e) });
      return { status: 502, body: msg2 };
    }
    const msg = store.insert("messages", { ...base, account: account || "", status: "draft", error: "Connector not configured. Saved as draft, not sent." });
    return { status: 202, body: msg };
  }
  async function syncEmail() {
    if (!zohoStatus(env).configured) return { status: 400, body: { error: "Zoho Mail is not connected. See docs/ZOHO.md." } };
    const days = Number(env.ZOHO_SYNC_DAYS) || 7;
    const last = store.list("messages").filter((m) => m.channel === "email" && m.direction === "in").map((m) => m.at).sort().pop();
    const sinceMs = Math.max(Date.now() - days * DAY, last ? new Date(last).getTime() - 36e5 : 0);
    const label = env.EMAIL_ACCOUNT_LABEL || "Zoho";
    const skip = /(^|[._-])(no-?reply|donotreply|mailer-daemon|postmaster|bounce)|notifications?@/i;
    let added = 0, skipped = 0;
    for (const m of await createZoho({ env, fetchImpl }).inbox({ limit: 25, sinceMs })) {
      if (m.self || !m.from.email || skip.test(m.from.email)) {
        skipped++;
        continue;
      }
      const r = ingest({ channel: "email", account: label, externalId: "zoho:" + m.id, from: m.from, subject: m.subject, body: m.body, at: m.at });
      if (r.duplicate) skipped++;
      else added++;
    }
    return { status: 200, body: { added, skipped } };
  }
  function summary() {
    const t = today();
    const contacts = store.list("contacts"), orders = store.list("orders").filter((o) => o.status !== "cancelled");
    const reorderDays = Number(env.REORDER_DAYS) || 45;
    const lastOrder = {};
    for (const o of orders) if (!lastOrder[o.contactId] || o.date > lastOrder[o.contactId]) lastOrder[o.contactId] = o.date;
    const reorder = Object.entries(lastOrder).map(([id, date2]) => ({ contact: store.get("contacts", id), date: date2, days: Math.floor((Date.now() - new Date(date2).getTime()) / DAY) })).filter((x) => x.contact && x.days >= reorderDays && ["customer", "retail"].includes(x.contact.type) && !x.contact.tags?.includes("walk-in")).sort((a, b) => b.days - a.days);
    const month = t.slice(0, 7);
    const open = store.list("deals").filter((d2) => !["won", "lost"].includes(d2.stage));
    return {
      unread: store.list("messages").filter((m) => m.direction === "in" && !m.read).length,
      tasksDue: store.list("tasks").filter((x) => !x.done && x.due && x.due <= t).length,
      openDeals: open.length,
      openDealsValue: open.reduce((s, d2) => s + d2.value, 0),
      monthRevenue: orders.filter((o) => (o.date || "").startsWith(month)).reduce((s, o) => s + o.total, 0),
      monthOrders: orders.filter((o) => (o.date || "").startsWith(month)).length,
      newLeads: contacts.filter((c) => c.type === "lead").length,
      reorder,
      reorderDays
    };
  }
  const json = (status, body) => ({ status, body });
  const routes = [];
  const route = (method, pattern, fn) => routes.push({ method, re: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), fn });
  route("GET", "/api/health", () => json(200, { ok: true, time: (/* @__PURE__ */ new Date()).toISOString() }));
  route("GET", "/api/summary", () => json(200, summary()));
  route("POST", "/api/email/sync", () => syncEmail());
  route("GET", "/api/email/sync", () => syncEmail());
  route("GET", "/api/zoho/exchange", async ({ query }) => {
    const code = query.get("code");
    if (!code) return json(400, { error: "Add ?code=YOUR_GRANT_CODE" });
    if (!env.ZOHO_CLIENT_ID || !env.ZOHO_CLIENT_SECRET) return json(400, { error: "Set ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET first, then redeploy." });
    try {
      return json(200, { ZOHO_REFRESH_TOKEN: await createZoho({ env, fetchImpl }).exchange(code), next: "Copy this value into Vercel as ZOHO_REFRESH_TOKEN, then redeploy." });
    } catch (e) {
      return json(400, { error: String(e.message) });
    }
  });
  route("GET", "/api/integrations", () => json(200, {
    integrations: [
      metaStatus(env),
      zohoStatus(env),
      emailStatus(env),
      { id: "inbound", label: "Generic inbound webhook (n8n, Make, Zapier, email forwarding)", configured: !!env.INBOUND_SECRET, missing: env.INBOUND_SECRET ? [] : ["INBOUND_SECRET"], webhook: "/api/inbound" }
    ],
    auth: !!env.CRM_PASSWORD
  }));
  route("GET", "/api/export", () => json(200, store.data));
  route("POST", "/api/clear-sample", () => {
    const sampleIds = new Set(store.list("contacts").filter((c) => c.tags?.includes("sample")).map((c) => c.id));
    for (const col of ["deals", "orders", "tasks", "messages"]) store.data[col] = store.data[col].filter((x) => !sampleIds.has(x.contactId));
    store.data.contacts = store.data.contacts.filter((c) => !sampleIds.has(c.id));
    store.data.products = store.data.products.filter((p) => !p.sample);
    store.data.events = store.data.events.filter((e) => !e.sample);
    store.save();
    return json(200, { removedContacts: sampleIds.size });
  });
  route("GET", "/api/contacts/:id/timeline", ({ params }) => {
    const c = store.get("contacts", params.id);
    if (!c) return json(404, { error: "Not found" });
    const by = (col) => store.list(col).filter((x) => x.contactId === c.id);
    return json(200, {
      contact: c,
      messages: by("messages").sort((a, b) => String(a.at).localeCompare(String(b.at))),
      orders: by("orders").sort((a, b) => String(b.date).localeCompare(String(a.date))),
      tasks: by("tasks"),
      deals: by("deals")
    });
  });
  route("POST", "/api/contacts/:id/read", ({ params }) => {
    let n = 0;
    for (const m of store.list("messages")) if (m.contactId === params.id && m.direction === "in" && !m.read) {
      m.read = true;
      n++;
    }
    if (n) store.save();
    return json(200, { marked: n });
  });
  route("POST", "/api/messages/send", async ({ body }) => send(body || {}));
  route("POST", "/api/inbound", ({ body, headers }) => {
    if (!env.INBOUND_SECRET) return json(503, { error: "INBOUND_SECRET is not set" });
    if (!safeEq(headers["x-inbound-secret"], env.INBOUND_SECRET)) return json(401, { error: "Bad secret" });
    if (!body?.body || !body?.channel) return json(400, { error: "channel and body are required" });
    return json(201, ingest(body));
  });
  route("GET", "/api/webhooks/meta", ({ query }) => {
    if (query.get("hub.mode") === "subscribe" && env.META_VERIFY_TOKEN && safeEq(query.get("hub.verify_token"), env.META_VERIFY_TOKEN))
      return { status: 200, raw: query.get("hub.challenge") || "" };
    return json(403, { error: "Verification failed" });
  });
  route("POST", "/api/webhooks/meta", ({ raw, headers }) => {
    if (!verifySignature(raw, headers["x-hub-signature-256"], env.META_APP_SECRET)) return json(401, { error: "Bad signature" });
    let payload;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      return json(400, { error: "Bad JSON" });
    }
    const results = parseWebhook(payload, env).map(ingest);
    return json(200, { received: results.length });
  });
  for (const col of COLS) {
    route("GET", `/api/${col}`, ({ query }) => {
      let rows = store.list(col);
      const q = (query.get("q") || "").toLowerCase();
      if (q) rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
      for (const k of ["contactId", "type", "stage", "status", "channel", "account"]) if (query.get(k)) rows = rows.filter((r) => r[k] === query.get(k));
      return json(200, rows);
    });
    route("POST", `/api/${col}`, ({ body }) => {
      const r = clean(col, body);
      if (r.error) return json(400, { error: r.error });
      if (["deals", "orders"].includes(col) && !store.get("contacts", r.value.contactId)) return json(400, { error: "contactId does not exist" });
      if (col === "orders") {
        for (const i of r.value.items) {
          const p = store.get("products", i.productId);
          if (p) {
            i.name = i.name || p.name;
            if (!i.price) i.price = p.price;
          }
        }
        if (!r.value.total) r.value.total = Math.round(r.value.items.reduce((s, i) => s + i.qty * i.price, 0) * 100) / 100;
        r.value.date = r.value.date || today();
        store.update("contacts", r.value.contactId, {});
      }
      if (col === "messages") {
        r.value.at = r.value.at || (/* @__PURE__ */ new Date()).toISOString();
      }
      return json(201, store.insert(col, r.value));
    });
    route("GET", `/api/${col}/:id`, ({ params }) => {
      const r = store.get(col, params.id);
      return r ? json(200, r) : json(404, { error: "Not found" });
    });
    route("PATCH", `/api/${col}/:id`, ({ params, body }) => {
      const r = clean(col, body, true);
      if (r.error) return json(400, { error: r.error });
      const u = store.update(col, params.id, r.value);
      return u ? json(200, u) : json(404, { error: "Not found" });
    });
    route("DELETE", `/api/${col}/:id`, ({ params }) => {
      if (col === "contacts") for (const c of ["deals", "orders", "tasks", "messages"]) store.data[c] = store.data[c].filter((x) => x.contactId !== params.id);
      return store.remove(col, params.id) ? json(200, { ok: true }) : json(404, { error: "Not found" });
    });
  }
  async function handle(req, url, raw) {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      let body = null;
      if (raw && raw.length && !url.pathname.startsWith("/api/webhooks/")) {
        try {
          body = JSON.parse(raw.toString("utf8"));
        } catch {
          return json(400, { error: "Invalid JSON" });
        }
      }
      return r.fn({ params: m.groups || {}, query: url.searchParams, body, raw, headers: req.headers });
    }
    return null;
  }
  return { handle, ingest, send, summary };
}

// proj/src/mcp.js
var PROTOCOL = "2025-06-18";
var clip = (rows, n = 50) => rows.slice(0, n);
var txt = (v) => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v) }] });
var brief = (c) => ({ id: c.id, name: c.name, org: c.org, type: c.type, email: c.email, phone: c.phone, handles: c.handles, tags: c.tags, source: c.source, dog: c.dog, lastContactAt: c.lastContactAt });
function createMcp({ store, api }) {
  const tools = [
    {
      name: "crm_summary",
      description: "Overview: unread messages, tasks due, open deals and value, this month revenue and orders, and customers due to reorder.",
      inputSchema: { type: "object", properties: {} },
      run: () => api.summary()
    },
    {
      name: "find_contacts",
      description: "Search contacts by any text (name, org, email, handle, tag, notes, dog) and/or type (lead, customer, retail, partner, media).",
      inputSchema: { type: "object", properties: { query: { type: "string" }, type: { type: "string" } } },
      run: ({ query = "", type }) => clip(store.list("contacts").filter((c) => (!type || c.type === type) && (!query || JSON.stringify(c).toLowerCase().includes(String(query).toLowerCase()))), 30).map(brief)
    },
    {
      name: "contact_timeline",
      description: "Everything about one contact: details, messages, orders, tasks, deals. Needs the contact id from find_contacts.",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      run: ({ id }) => {
        const c = store.get("contacts", id);
        if (!c) return { error: "Contact not found" };
        const by = (col) => store.list(col).filter((x) => x.contactId === id);
        return { contact: c, messages: clip(by("messages").sort((a, b) => String(b.at).localeCompare(String(a.at))), 30), orders: by("orders"), tasks: by("tasks"), deals: by("deals") };
      }
    },
    {
      name: "list_orders",
      description: "Orders, newest first. Optional filters: contactId, since (YYYY-MM-DD).",
      inputSchema: { type: "object", properties: { contactId: { type: "string" }, since: { type: "string" } } },
      run: ({ contactId, since }) => clip(store.list("orders").filter((o) => (!contactId || o.contactId === contactId) && (!since || String(o.date) >= since)).sort((a, b) => String(b.date).localeCompare(String(a.date))), 100)
    },
    {
      name: "list_deals",
      description: "Pipeline deals. Optional stage: lead, sample_sent, negotiating, won, lost.",
      inputSchema: { type: "object", properties: { stage: { type: "string" } } },
      run: ({ stage }) => store.list("deals").filter((d2) => !stage || d2.stage === stage)
    },
    {
      name: "list_tasks",
      description: "Tasks. open_only defaults to true.",
      inputSchema: { type: "object", properties: { open_only: { type: "boolean" } } },
      run: ({ open_only = true }) => store.list("tasks").filter((t) => !open_only || !t.done)
    },
    {
      name: "recent_messages",
      description: "Latest messages across all channels. Optional: unread_only, limit (default 20).",
      inputSchema: { type: "object", properties: { unread_only: { type: "boolean" }, limit: { type: "number" } } },
      run: ({ unread_only, limit = 20 }) => clip(store.list("messages").filter((m) => !unread_only || m.direction === "in" && !m.read).sort((a, b) => String(b.at).localeCompare(String(a.at))), Math.min(Number(limit) || 20, 100))
    },
    {
      name: "list_events",
      description: "Calendar events (production days, deliveries, markets, posts, meetings). Optional from/to as YYYY-MM-DD, type.",
      inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, type: { type: "string" } } },
      run: ({ from, to, type }) => store.list("events").filter((e) => (!from || e.date >= from) && (!to || e.date <= to) && (!type || e.type === type)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    },
    { name: "list_products", description: "Product catalog with prices.", inputSchema: { type: "object", properties: {} }, run: () => store.list("products") },
    // Generic names some ChatGPT connector modes expect
    {
      name: "search",
      description: "Search contacts, orders, deals and tasks by text. Returns ids you can pass to fetch.",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      run: ({ query = "" }) => {
        const q = String(query).toLowerCase();
        const results = [];
        for (const [col, label] of [["contacts", (r) => r.name], ["deals", (r) => r.title || r.name || r.id], ["orders", (r) => `Order ${r.date} $${r.total}`], ["tasks", (r) => r.title]])
          for (const r of store.list(col)) if (JSON.stringify(r).toLowerCase().includes(q)) results.push({ id: `${col}:${r.id}`, title: `${col.slice(0, -1)}: ${label(r)}`, url: `/#${col}` });
        return { results: clip(results, 25) };
      }
    },
    {
      name: "fetch",
      description: "Get one record by id from search (format collection:id).",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      run: ({ id = "" }) => {
        const [col, rid] = String(id).split(":");
        const r = store.get(col, rid);
        return r ? { id, title: r.name || r.title || id, text: JSON.stringify(r), url: `/#${col}`, metadata: { collection: col } } : { error: "Not found" };
      }
    }
  ];
  const byName = new Map(tools.map((t) => [t.name, t]));
  async function rpc(m) {
    const id = m.id;
    const ok = (result) => ({ jsonrpc: "2.0", id, result });
    const err = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
    switch (m.method) {
      case "initialize":
        return ok({ protocolVersion: m.params?.protocolVersion || PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "purely-pei-crm", version: "1.0.0" }, instructions: "Read-only access to the Purely PEI CRM (contacts, orders, deals, tasks, messages)." });
      case "ping":
        return ok({});
      case "tools/list":
        return ok({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema, annotations: { readOnlyHint: true } })) });
      case "tools/call": {
        const t = byName.get(m.params?.name);
        if (!t) return err(-32602, "Unknown tool");
        try {
          return ok(txt(await t.run(m.params?.arguments || {})));
        } catch (e) {
          return ok({ ...txt("Error: " + e.message), isError: true });
        }
      }
      default:
        return id === void 0 ? null : err(-32601, "Method not found");
    }
  }
  async function handleBody(body) {
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map(rpc))).filter(Boolean);
      return out.length ? out : null;
    }
    return rpc(body || {});
  }
  return { handleBody, tools };
}

// proj/src/core.js
var MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };
var DAYS30 = 30 * 86400;
function createCore({ store, env, fetchImpl, publicDir, assets }) {
  const api = createApi({ store, env, fetchImpl });
  const mcp = createMcp({ store, api });
  const readKeyOk = (k) => !!env.READ_KEY && String(env.READ_KEY).length >= 16 && eq(k || "", env.READ_KEY);
  const bearer = (h) => (/^Bearer (.+)$/.exec(h.authorization || "") || [])[1];
  const secret = crypto4.createHash("sha256").update("ppcrm:" + (env.CRM_PASSWORD || "")).digest();
  const sign = (exp) => crypto4.createHmac("sha256", secret).update(String(exp)).digest("hex");
  const mkToken = () => {
    const exp = Math.floor(Date.now() / 1e3) + DAYS30;
    return `${exp}.${sign(exp)}`;
  };
  const eq = (a, b) => {
    const x = Buffer.from(String(a)), y = Buffer.from(String(b));
    return x.length === y.length && crypto4.timingSafeEqual(x, y);
  };
  const tokenOk = (t) => {
    const [exp, sig] = String(t || "").split(".");
    return !!sig && Number(exp) > Date.now() / 1e3 && eq(sig, sign(exp));
  };
  const cookie = (h) => /(?:^|;\s*)crm=([^;]+)/.exec(h.cookie || "")?.[1];
  const authed = (h) => {
    if (!env.CRM_PASSWORD) return true;
    if (tokenOk(cookie(h))) return true;
    const a = h.authorization || "";
    if (a.startsWith("Basic ")) return eq(Buffer.from(a.slice(6), "base64").toString().split(":").slice(1).join(":"), env.CRM_PASSWORD);
    return false;
  };
  const isWebhook = (p) => p === "/api/health" || p === "/api/inbound" || p.startsWith("/api/webhooks/");
  const J = (status, body, headers = {}) => ({ status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers }, body: JSON.stringify(body) });
  async function handle({ method, url: rawUrl, headers, raw }) {
    const url = new URL(rawUrl, "http://x");
    const p = url.pathname;
    try {
      if (p === "/api/mcp" || p.startsWith("/api/mcp/")) {
        if (!env.READ_KEY || String(env.READ_KEY).length < 16) return J(503, { error: "READ_KEY is not set (min 16 characters)" });
        const key = decodeURIComponent(p.slice("/api/mcp/".length)) || bearer(headers);
        if (!readKeyOk(key) && !readKeyOk(bearer(headers))) return J(401, { error: "Bad key" });
        if (method !== "POST") return J(405, { error: "Use POST" }, { allow: "POST" });
        let body;
        try {
          body = JSON.parse(raw.toString("utf8"));
        } catch {
          return J(400, { error: "Invalid JSON" });
        }
        await store.load();
        const out = await mcp.handleBody(body);
        return out === null ? { status: 202, headers: {}, body: "" } : J(200, out);
      }
      if (p.startsWith("/api/") && !(assets && p.startsWith("/api/static"))) {
        if (p === "/api/session" && method === "GET") return J(200, { passwordRequired: !!env.CRM_PASSWORD, loggedIn: authed(headers) });
        if (p === "/api/login" && method === "POST") {
          if (!env.CRM_PASSWORD) return J(200, { ok: true });
          let pw = "";
          try {
            pw = JSON.parse(raw.toString("utf8")).password;
          } catch {
          }
          if (!eq(pw ?? "", env.CRM_PASSWORD)) {
            await new Promise((r2) => setTimeout(r2, 500));
            return J(401, { error: "Wrong password" });
          }
          const secure = (headers["x-forwarded-proto"] || "").includes("https") ? "; Secure" : "";
          return J(200, { ok: true }, { "set-cookie": `crm=${mkToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DAYS30}${secure}` });
        }
        if (p === "/api/logout" && method === "POST") return J(200, { ok: true }, { "set-cookie": "crm=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
        const readOnlyKey = method === "GET" && p !== "/api/export" && p !== "/api/email/sync" && p !== "/api/zoho/exchange" && readKeyOk(bearer(headers));
        if (p === "/api/health" && method === "GET") {
          const storage = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL ? "redis" : env.BLOB_READ_WRITE_TOKEN || env.BLOB_STORE_ID ? "blob" : env.VERCEL ? "NOT CONNECTED" : "file";
          return J(200, { ok: true, storage, password: !!env.CRM_PASSWORD, time: (/* @__PURE__ */ new Date()).toISOString() });
        }
        const cronOk = p === "/api/email/sync" && !!env.CRON_SECRET && String(env.CRON_SECRET).length >= 16 && eq(bearer(headers) || "", env.CRON_SECRET);
        if (!isWebhook(p) && !readOnlyKey && !cronOk && !authed(headers)) return J(401, { error: "Login required" }, env.CRM_PASSWORD ? {} : {});
        await store.load();
        const r = await api.handle({ method, headers }, url, raw);
        await store.flush();
        if (!r) return J(404, { error: "Not found" });
        if (r.raw !== void 0) return { status: r.status, headers: { "content-type": "text/plain" }, body: r.raw };
        return J(r.status, r.body);
      }
      if (assets) {
        let ap = p.startsWith("/api/static") ? p.slice("/api/static".length) : p;
        if (!ap || ap === "/") ap = "/index.html";
        const a = assets[ap];
        if (!a) return { status: 404, headers: {}, body: "Not found" };
        return { status: 200, headers: { "content-type": MIME[path2.extname(ap)] || "application/octet-stream", "cache-control": "no-cache" }, body: Buffer.from(a, "base64") };
      }
      if (!publicDir) return { status: 404, headers: {}, body: "Not found" };
      let rel = path2.normalize(decodeURIComponent(p)).replace(/^(\.\.[/\\])+/, "");
      if (rel === "/" || rel === "\\") rel = "/index.html";
      const fp = path2.join(publicDir, rel);
      if (!fp.startsWith(publicDir) || !fs2.existsSync(fp) || fs2.statSync(fp).isDirectory()) return { status: 404, headers: {}, body: "Not found" };
      return { status: 200, headers: { "content-type": MIME[path2.extname(fp)] || "application/octet-stream", "cache-control": "no-cache" }, body: fs2.readFileSync(fp) };
    } catch (e) {
      console.error(e);
      if (String(e.message).startsWith("Database")) return J(503, { error: e.message });
      return J(500, { error: "Server error" });
    }
  }
  return { handle, api };
}

// proj/src/redis.js
function redisFromEnv(env, fetchImpl = fetch) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const key = env.DATA_KEY || "purely-pei-crm";
  const cmd = async (args) => {
    const r = await fetchImpl(url.replace(/\/$/, ""), { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(args) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error("Database error: " + (j.error || r.status));
    return j.result;
  };
  return { get: () => cmd(["GET", key]), set: (json) => cmd(["SET", key, json]) };
}

// proj/src/blob.js
function blobFromEnv(env, sdk) {
  if (!env.BLOB_READ_WRITE_TOKEN && !env.BLOB_STORE_ID) return null;
  const pathname = (env.DATA_KEY || "purely-pei-crm") + ".json";
  let mod = sdk;
  const lib = async () => mod ??= await import("@vercel/blob");
  return {
    async get() {
      const { get } = await lib();
      const r = await get(pathname, { access: "private", useCache: false });
      if (!r || r.statusCode !== 200) return null;
      return await new Response(r.stream).text();
    },
    async set(json) {
      const { put } = await lib();
      await put(pathname, json, { access: "private", allowOverwrite: true, addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 60 });
    }
  };
}

// proj/src/seed.js
import path3 from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
var d = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
var ts = (n) => new Date(Date.now() - n * 864e5).toISOString();
var fwd = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
function seed(store) {
  const P = (name, sku, price, wholesale, stock, notes) => store.insert("products", { name, sku, price, wholesale, stock, active: true, notes, sample: true });
  const lobster = P("Lobster Treats (sample)", "LOB-100", 14, 8.5, 60, "Placeholder product and price");
  const blue = P("Blueberry Bites (sample)", "BLU-100", 12, 7, 80, "Placeholder product and price");
  const mix = P("PEI Sampler Pack (sample)", "MIX-050", 9, 5.5, 40, "Placeholder product and price");
  const E = (title, type, n, time = "", notes = "") => store.insert("events", { title, type, date: fwd(n), time, contactId: "", notes, done: false, sample: true });
  E("Lobster treat batch (sample)", "production", 1, "09:00", "Placeholder: bake and package");
  E("Ship wholesale order (sample)", "delivery", 2, "14:00");
  E("Instagram post: new flavour (sample)", "post", 3);
  E("Farmers' Market (sample)", "market", 4, "08:00", "Placeholder market day");
  E("Call with vet clinic (sample)", "meeting", 6, "11:30");
  E("Blueberry batch (sample)", "production", 8, "09:00");
  const C = (o) => store.insert("contacts", { type: "customer", org: "", email: "", phone: "", handles: {}, ext: {}, dog: {}, tags: ["sample"], source: "", notes: "", optIn: true, lastContactAt: "", ...o, tags: ["sample", ...o.tags || []] });
  const sarah = C({ name: "Sarah (sample)", email: "sarah@example.com", handles: { instagram: "sarah_and_finn" }, dog: { name: "Finn", breed: "Lab mix", allergies: "chicken" }, source: "Farmers Market", lastContactAt: ts(50), notes: "Chicken allergy, loves the lobster treats" });
  const marc = C({ name: "Marc (sample)", email: "marc@example.com", dog: { name: "Bruno", breed: "Boxer" }, source: "online", lastContactAt: ts(12) });
  const pawsh = C({ type: "retail", name: "Paws & Whiskers (sample)", org: "Paws & Whiskers Pet Supply", email: "orders@pawswhiskers.example", phone: "902-555-0101", source: "referral", lastContactAt: ts(30), notes: "Pet store, Charlottetown. Reorders monthly." });
  const vet = C({ type: "lead", name: "Dr. Lee (sample)", org: "Riverside Vet Clinic", email: "lee@riverside.example", source: "Instagram", handles: { instagram: "riversidevet" }, lastContactAt: ts(3), notes: "Interested in allergy-friendly options for clients" });
  const groom = C({ type: "lead", name: "Bark Avenue Grooming (sample)", email: "hello@barkavenue.example", source: "market", lastContactAt: ts(8) });
  C({ type: "partner", name: "Local fisher (sample)", org: "Lobster supplier", source: "supplier", tags: ["supplier"], notes: "Lobster byproduct sourcing" });
  C({ type: "partner", name: "Blueberry grower (sample)", org: "Grower", source: "supplier", tags: ["supplier"] });
  C({ type: "media", name: "Podcast host (sample)", email: "host@example.com", source: "outreach", tags: ["media"] });
  const O = (c, channel, date2, items, status = "delivered") => store.insert("orders", {
    contactId: c.id,
    channel,
    status,
    date: date2,
    notes: "",
    items: items.map(([p, qty]) => ({ productId: p.id, name: p.name, qty, price: channel === "wholesale" ? p.wholesale : p.price })),
    total: items.reduce((s, [p, qty]) => s + qty * (channel === "wholesale" ? p.wholesale : p.price), 0)
  });
  O(sarah, "market", d(50), [[lobster, 2], [blue, 1]]);
  O(marc, "online", d(12), [[mix, 1], [lobster, 1]], "shipped");
  O(pawsh, "wholesale", d(60), [[lobster, 12], [blue, 12]]);
  O(pawsh, "wholesale", d(30), [[lobster, 12], [blue, 12]]);
  store.insert("deals", { contactId: pawsh.id, title: "Monthly wholesale standing order", stage: "won", value: 400, expectedClose: d(30), notes: "" });
  store.insert("deals", { contactId: vet.id, title: "Clinic recommendation + retail shelf", stage: "sample_sent", value: 600, expectedClose: fwd(21), notes: "Sample pack sent" });
  store.insert("deals", { contactId: groom.id, title: "Grooming salon counter display", stage: "lead", value: 250, expectedClose: fwd(30), notes: "" });
  store.insert("tasks", { contactId: vet.id, title: "Follow up on sample pack", due: fwd(0), done: false, notes: "" });
  store.insert("tasks", { contactId: sarah.id, title: "Send restock note for the lobster treats", due: d(1), done: false, notes: "" });
  store.insert("tasks", { contactId: groom.id, title: "Drop off wholesale price list", due: fwd(4), done: false, notes: "" });
  const M = (c, channel, account, direction, body, n, read = true, subject = "") => store.insert("messages", { contactId: c.id, channel, account, direction, subject, body, at: ts(n), read, status: direction === "in" ? "received" : "sent", externalId: "", error: "" });
  M(vet, "instagram", "@purelypei", "in", "Hi! Saw your lobster treats. Do you have anything for dogs with chicken allergies?", 3, false);
  M(groom, "email", "hello@", "in", "Hello, we met at the market. Can you send wholesale pricing?", 1.2, false, "Wholesale pricing");
  M(pawsh, "email", "hello@", "out", "Your order shipped, thanks!", 30, true, "Order shipped");
  M(sarah, "instagram", "@purelypei", "in", "Finn loved them! Will you be at the market Saturday?", 50, true);
  store.save();
}
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const file = process.env.DATA_FILE || path3.join(path3.dirname(fileURLToPath(import.meta.url)), "..", "data", "db.json");
  const s = new Store(process.argv.includes("--reset") ? null : file);
  s.file = file;
  if (process.argv.includes("--reset")) for (const k of Object.keys(s.data)) s.data[k] = [];
  seed(s);
  console.log("Seeded sample data into", file);
}

// proj/server.js
var ROOT = path4.dirname(fileURLToPath2(import.meta.url));
function buildCore({ env = process.env, dataFile, fetchImpl, publicDir, assets } = {}) {
  let adapter = dataFile === void 0 ? redisFromEnv(env, fetchImpl) || blobFromEnv(env) : null;
  if (!adapter && env.VERCEL) {
    const missing = async () => {
      throw new Error("Database not connected. In Vercel open Storage, create a Blob store (Private) or Upstash Redis, connect it to this project, then redeploy.");
    };
    adapter = { get: missing, set: missing };
  }
  const file = adapter ? null : dataFile !== void 0 ? dataFile : env.DATA_FILE ?? path4.join(ROOT, "data", "db.json");
  const store = new Store(file, adapter);
  if (!adapter && store.fresh && env.CRM_SEED !== "0" && file) seed(store);
  return { store, ...createCore({ store, env, fetchImpl, publicDir, assets }) };
}
function createApp(opts = {}) {
  const { store, api, handle } = buildCore({ ...opts, publicDir: path4.join(ROOT, "public") });
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 2e6) {
        res.writeHead(413);
        return res.end();
      }
      chunks.push(c);
    }
    const r = await handle({ method: req.method, url: req.url, headers: req.headers, raw: Buffer.concat(chunks) });
    res.writeHead(r.status, r.headers);
    res.end(r.body);
  });
  return { server, store, api };
}
if (import.meta.url === pathToFileURL2(process.argv[1] || "").href) {
  const envFile = path4.join(ROOT, ".env");
  if (fs3.existsSync(envFile) && process.loadEnvFile) process.loadEnvFile(envFile);
  const { server } = createApp();
  const port = Number(process.env.PORT) || 3e3;
  server.listen(port, () => console.log(`Purely PEI CRM running at http://localhost:${port}${process.env.CRM_PASSWORD ? " (password protected)" : " (no password set)"}`));
}

// assets.js
var assets_default = { "/app.js": "Ly8gVmFuaWxsYSBKUyBmcm9udCBlbmQuIE5vIGJ1aWxkIHN0ZXAuIEFsbCBkYXRhIGNvbWVzIGZyb20gL2FwaS8qLgpjb25zdCAkID0gKHMsIHIgPSBkb2N1bWVudCkgPT4gci5xdWVyeVNlbGVjdG9yKHMpOwpjb25zdCBlc2MgPSAodikgPT4gU3RyaW5nKHYgPz8gJycpLnJlcGxhY2UoL1smPD4iJ10vZywgKGMpID0+ICh7ICcmJzogJyZhbXA7JywgJzwnOiAnJmx0OycsICc+JzogJyZndDsnLCAnIic6ICcmcXVvdDsnLCAiJyI6ICcmIzM5OycgfVtjXSkpOwpjb25zdCBtb25leSA9IChuKSA9PiAnJCcgKyAoTnVtYmVyKG4pIHx8IDApLnRvTG9jYWxlU3RyaW5nKCdlbi1DQScsIHsgbWluaW11bUZyYWN0aW9uRGlnaXRzOiAwLCBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDIgfSk7CmNvbnN0IHRvZGF5ID0gKCkgPT4gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKTsKY29uc3QgYWdvID0gKGlzbykgPT4gewogIGlmICghaXNvKSByZXR1cm4gJyc7CiAgY29uc3QgbSA9IChEYXRlLm5vdygpIC0gbmV3IERhdGUoaXNvKS5nZXRUaW1lKCkpIC8gNjAwMDA7CiAgaWYgKG0gPCAxKSByZXR1cm4gJ25vdyc7IGlmIChtIDwgNjApIHJldHVybiBNYXRoLmZsb29yKG0pICsgJ20nOwogIGlmIChtIDwgMTQ0MCkgcmV0dXJuIE1hdGguZmxvb3IobSAvIDYwKSArICdoJzsgaWYgKG0gPCA0MzIwMCkgcmV0dXJuIE1hdGguZmxvb3IobSAvIDE0NDApICsgJ2QnOwogIHJldHVybiBuZXcgRGF0ZShpc28pLnRvTG9jYWxlRGF0ZVN0cmluZygnZW4tQ0EnLCB7IG1vbnRoOiAnc2hvcnQnLCBkYXk6ICdudW1lcmljJyB9KTsKfTsKYXN5bmMgZnVuY3Rpb24gYXBpKG1ldGhvZCwgcGF0aCwgYm9keSkgewogIGNvbnN0IHIgPSBhd2FpdCBmZXRjaCgnL2FwaScgKyBwYXRoLCB7IG1ldGhvZCwgaGVhZGVyczogYm9keSA/IHsgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9IDoge30sIGJvZHk6IGJvZHkgPyBKU09OLnN0cmluZ2lmeShib2R5KSA6IHVuZGVmaW5lZCB9KTsKICBjb25zdCBqID0gYXdhaXQgci5qc29uKCkuY2F0Y2goKCkgPT4gKHt9KSk7CiAgaWYgKHIuc3RhdHVzID09PSA0MDEgJiYgcGF0aCAhPT0gJy9sb2dpbicpIHsgc2hvd0xvZ2luKCk7IHRocm93IG5ldyBFcnJvcignTG9naW4gcmVxdWlyZWQnKTsgfQogIGlmICghci5vayAmJiByLnN0YXR1cyAhPT0gMjAyICYmIHIuc3RhdHVzICE9PSA1MDIpIHRocm93IG5ldyBFcnJvcihqLmVycm9yIHx8IHIuc3RhdHVzVGV4dCk7CiAgai5fc3RhdHVzID0gci5zdGF0dXM7CiAgcmV0dXJuIGo7Cn0KZnVuY3Rpb24gdG9hc3QobXNnKSB7IGNvbnN0IHQgPSAkKCcjdG9hc3QnKTsgdC50ZXh0Q29udGVudCA9IG1zZzsgdC5oaWRkZW4gPSBmYWxzZTsgY2xlYXJUaW1lb3V0KHRvYXN0LnQpOyB0b2FzdC50ID0gc2V0VGltZW91dCgoKSA9PiAodC5oaWRkZW4gPSB0cnVlKSwgMjYwMCk7IH0KCmNvbnN0IFRZUEVTID0geyBsZWFkOiAnTGVhZCcsIGN1c3RvbWVyOiAnQ3VzdG9tZXInLCByZXRhaWw6ICdSZXRhaWwgcGFydG5lcicsIHBhcnRuZXI6ICdTdXBwbGllciAvIHBhcnRuZXInLCBtZWRpYTogJ01lZGlhJyB9Owpjb25zdCBTVEFHRVMgPSB7IGxlYWQ6ICdOZXcgbGVhZCcsIHNhbXBsZV9zZW50OiAnU2FtcGxlIHNlbnQnLCBuZWdvdGlhdGluZzogJ05lZ290aWF0aW5nJywgd29uOiAnV29uJywgbG9zdDogJ0xvc3QnIH07CmNvbnN0IENIX0lDT04gPSB7IGVtYWlsOiAn4pyJ77iPJywgaW5zdGFncmFtOiAn8J+TuCcsIGZhY2Vib29rOiAn8J+SrCcsIHNtczogJ/Cfk7EnLCBjYWxsOiAn8J+TnicsIG5vdGU6ICfwn5OdJywgaW5fcGVyc29uOiAn8J+knScgfTsKY29uc3QgVklFV1MgPSBbWyd0b2RheScsICfwn4+gJywgJ1RvZGF5J10sIFsnaW5ib3gnLCAn8J+SrCcsICdJbmJveCddLCBbJ2NhbGVuZGFyJywgJ/Cfk4UnLCAnQ2FsZW5kYXInXSwgWydjb250YWN0cycsICfwn5GlJywgJ0NvbnRhY3RzJ10sIFsnb3JkZXJzJywgJ/Cfk6YnLCAnT3JkZXJzJ10sIFsncGlwZWxpbmUnLCAn8J+OrycsICdQaXBlbGluZSddLCBbJ3Byb2R1Y3RzJywgJ/Cfm43vuI8nLCAnUHJvZHVjdHMnXSwgWydzZXR0aW5ncycsICfimpnvuI8nLCAnU2V0dGluZ3MnXV07CmNvbnN0IE1PQklMRSA9IFsndG9kYXknLCAnaW5ib3gnLCAnY2FsZW5kYXInLCAnY29udGFjdHMnLCAnb3JkZXJzJ107Cgpjb25zdCBTID0geyB2aWV3OiAndG9kYXknLCBkOiB7fSwgc3VtOiB7fSwgcTogJycsIHR5cGU6ICcnLCBhY2NvdW50OiAnJyB9Owpjb25zdCBieUlkID0gKGNvbCwgaWQpID0+IChTLmRbY29sXSB8fCBbXSkuZmluZCgoeCkgPT4geC5pZCA9PT0gaWQpOwpjb25zdCBjbmFtZSA9IChpZCkgPT4gYnlJZCgnY29udGFjdHMnLCBpZCk/Lm5hbWUgfHwgJyhkZWxldGVkKSc7Cgphc3luYyBmdW5jdGlvbiBsb2FkKCkgewogIGNvbnN0IENPTFMgPSBbJ2NvbnRhY3RzJywgJ2RlYWxzJywgJ29yZGVycycsICd0YXNrcycsICdtZXNzYWdlcycsICdwcm9kdWN0cycsICdldmVudHMnXTsKICBjb25zdCBbc3VtLCAuLi5jb2xzXSA9IGF3YWl0IFByb21pc2UuYWxsKFthcGkoJ0dFVCcsICcvc3VtbWFyeScpLCAuLi5DT0xTLm1hcCgoYykgPT4gYXBpKCdHRVQnLCAnLycgKyBjKSldKTsKICBTLnN1bSA9IHN1bTsKICBDT0xTLmZvckVhY2goKGMsIGkpID0+IChTLmRbY10gPSBjb2xzW2ldKSk7Cn0KYXN5bmMgZnVuY3Rpb24gc3luY01haWwobWFudWFsKSB7IC8vIHB1bGxzIG5ldyBlbWFpbCBmcm9tIFpvaG8gKHF1aWV0bHkgaWdub3JlZCB3aGVuIFpvaG8gaXMgbm90IGNvbm5lY3RlZCkKICBpZiAoIW1hbnVhbCAmJiBEYXRlLm5vdygpIC0gKHN5bmNNYWlsLnQgfHwgMCkgPCAxMjAwMDApIHJldHVybjsKICBzeW5jTWFpbC50ID0gRGF0ZS5ub3coKTsKICB0cnkgeyBjb25zdCByID0gYXdhaXQgYXBpKCdQT1NUJywgJy9lbWFpbC9zeW5jJyk7IGlmIChyLmFkZGVkKSBhd2FpdCByZWZyZXNoKCk7IGlmIChtYW51YWwpIHRvYXN0KHIuYWRkZWQgPyByLmFkZGVkICsgJyBuZXcgZW1haWwnICsgKHIuYWRkZWQgPiAxID8gJ3MnIDogJycpIDogJ05vIG5ldyBlbWFpbCcpOyB9CiAgY2F0Y2ggKGUpIHsgaWYgKG1hbnVhbCkgdG9hc3QoZS5tZXNzYWdlKTsgfQp9CmFzeW5jIGZ1bmN0aW9uIHJlZnJlc2goKSB7IGF3YWl0IGxvYWQoKTsgcmVuZGVyKCk7IH0KCmZ1bmN0aW9uIG5hdigpIHsKICBjb25zdCBiYWRnZSA9IChpZCkgPT4gKGlkID09PSAnaW5ib3gnICYmIFMuc3VtLnVucmVhZCA/IGA8aSBjbGFzcz0iYmFkZ2UiPiR7Uy5zdW0udW5yZWFkfTwvaT5gIDogJycpOwogICQoJyNuYXYnKS5pbm5lckhUTUwgPSBWSUVXUy5tYXAoKFtpZCwgaWMsIGxdKSA9PiBgPGJ1dHRvbiBkYXRhLWdvPSIke2lkfSIgY2xhc3M9IiR7Uy52aWV3ID09PSBpZCA/ICdvbicgOiAnJ30iPjxzcGFuPiR7aWN9PC9zcGFuPiR7bH0ke2JhZGdlKGlkKX08L2J1dHRvbj5gKS5qb2luKCcnKTsKICAkKCcjdGFicycpLmlubmVySFRNTCA9IFZJRVdTLmZpbHRlcigodikgPT4gTU9CSUxFLmluY2x1ZGVzKHZbMF0pKS5tYXAoKFtpZCwgaWMsIGxdKSA9PiBgPGJ1dHRvbiBkYXRhLWdvPSIke2lkfSIgY2xhc3M9IiR7Uy52aWV3ID09PSBpZCA/ICdvbicgOiAnJ30iPjxzcGFuPiR7aWN9PC9zcGFuPiR7bH0ke2JhZGdlKGlkKX08L2J1dHRvbj5gKS5qb2luKCcnKQogICAgKyBgPGJ1dHRvbiBkYXRhLWdvPSJtb3JlIiBjbGFzcz0iJHtbJ3BpcGVsaW5lJywgJ3Byb2R1Y3RzJywgJ3NldHRpbmdzJ10uaW5jbHVkZXMoUy52aWV3KSA/ICdvbicgOiAnJ30iPjxzcGFuPuKLrzwvc3Bhbj5Nb3JlPC9idXR0b24+YDsKfQoKZnVuY3Rpb24gcmVuZGVyKCkgewogIG5hdigpOwogIGNvbnN0IHYgPSB7IHRvZGF5OiB2aWV3VG9kYXksIGluYm94LCBjYWxlbmRhciwgY29udGFjdHMsIG9yZGVycywgcGlwZWxpbmUsIHByb2R1Y3RzLCBzZXR0aW5ncyB9W1Mudmlld10gfHwgdmlld1RvZGF5OwogICQoJyNtYWluJykuaW5uZXJIVE1MID0gdigpOwp9Cgpjb25zdCBhdmF0YXIgPSAoYykgPT4gYDxkaXYgY2xhc3M9ImF2ICR7ZXNjKGMudHlwZSl9Ij4ke2VzYygoYy5uYW1lIHx8ICc/JykudHJpbSgpWzBdPy50b1VwcGVyQ2FzZSgpKX08L2Rpdj5gOwpjb25zdCBoZWFkID0gKHRpdGxlLCBhY3Rpb24gPSAnJykgPT4gYDxoMT4ke3RpdGxlfSR7YWN0aW9ufTwvaDE+YDsKY29uc3QgcGx1cyA9IChhY3QsIGxhYmVsID0gJysgTmV3JykgPT4gYDxidXR0b24gY2xhc3M9ImJ0biBzbSIgZGF0YS1hY3Q9IiR7YWN0fSI+JHtsYWJlbH08L2J1dHRvbj5gOwoKLy8gLS0tLS0tLS0tLSB2aWV3cyAtLS0tLS0tLS0tCmZ1bmN0aW9uIHZpZXdUb2RheSgpIHsKICBjb25zdCBzID0gUy5zdW0sIHQgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApOwogIGNvbnN0IHRhc2tzID0gUy5kLnRhc2tzLmZpbHRlcigoeCkgPT4gIXguZG9uZSAmJiB4LmR1ZSAmJiB4LmR1ZSA8PSB0KS5zb3J0KChhLCBiKSA9PiBhLmR1ZS5sb2NhbGVDb21wYXJlKGIuZHVlKSk7CiAgY29uc3QgdW5yZWFkID0gUy5kLm1lc3NhZ2VzLmZpbHRlcigobSkgPT4gbS5kaXJlY3Rpb24gPT09ICdpbicgJiYgIW0ucmVhZCkuc29ydCgoYSwgYikgPT4gYi5hdC5sb2NhbGVDb21wYXJlKGEuYXQpKTsKICByZXR1cm4gaGVhZCgnVG9kYXknKSArIGAKICA8ZGl2IGNsYXNzPSJ0aWxlcyI+CiAgICA8YnV0dG9uIGNsYXNzPSJ0aWxlIiBkYXRhLWdvPSJpbmJveCI+PGI+JHtzLnVucmVhZH08L2I+PHNwYW4+VW5yZWFkIG1lc3NhZ2VzPC9zcGFuPjwvYnV0dG9uPgogICAgPGRpdiBjbGFzcz0idGlsZSI+PGI+JHtzLnRhc2tzRHVlfTwvYj48c3Bhbj5UYXNrcyBkdWU8L3NwYW4+PC9kaXY+CiAgICA8YnV0dG9uIGNsYXNzPSJ0aWxlIiBkYXRhLWdvPSJwaXBlbGluZSI+PGI+JHttb25leShzLm9wZW5EZWFsc1ZhbHVlKX08L2I+PHNwYW4+JHtzLm9wZW5EZWFsc30gb3BlbiB3aG9sZXNhbGUgZGVhbHM8L3NwYW4+PC9idXR0b24+CiAgICA8YnV0dG9uIGNsYXNzPSJ0aWxlIiBkYXRhLWdvPSJvcmRlcnMiPjxiPiR7bW9uZXkocy5tb250aFJldmVudWUpfTwvYj48c3Bhbj4ke3MubW9udGhPcmRlcnN9IG9yZGVycyB0aGlzIG1vbnRoPC9zcGFuPjwvYnV0dG9uPgogIDwvZGl2PgogIDxoMj5Db21pbmcgdXA8L2gyPgogICR7KCgpID0+IHsgY29uc3QgdGwgPSB5bWQobmV3IERhdGUoKSksIHVwID0gUy5kLmV2ZW50cy5maWx0ZXIoKGUpID0+IGUuZGF0ZSA+PSB0bCAmJiBlLmRhdGUgPD0gYWRkRGF5cyh0bCwgNykpLnNvcnQoKGEsIGIpID0+IChhLmRhdGUgKyBhLnRpbWUpLmxvY2FsZUNvbXBhcmUoYi5kYXRlICsgYi50aW1lKSkuc2xpY2UoMCwgNik7CiAgICByZXR1cm4gdXAubGVuZ3RoID8gdXAubWFwKChlKSA9PiBgPGJ1dHRvbiBjbGFzcz0iaXRlbSIgZGF0YS1hY3Q9ImV2ZW50IiBkYXRhLWlkPSIke2UuaWR9Ij48c3BhbiBzdHlsZT0iZm9udC1zaXplOjIycHgiPiR7KEVWW2UudHlwZV0gfHwgRVYub3RoZXIpWzBdfTwvc3Bhbj48ZGl2IGNsYXNzPSJncm93Ij48c3BhbiBjbGFzcz0idCI+JHtlc2MoZS50aXRsZSl9PC9zcGFuPjxzcGFuIGNsYXNzPSJzdWIiPiR7ZS5kYXRlID09PSB0bCA/ICdUb2RheScgOiBlc2MoZm10RGF5KGUuZGF0ZSkpfSR7ZS50aW1lID8gJyDCtyAnICsgZXNjKGUudGltZSkgOiAnJ308L3NwYW4+PC9kaXY+PC9idXR0b24+YCkuam9pbignJykgOiAnPGRpdiBjbGFzcz0iZW1wdHkiPk5vdGhpbmcgcGxhbm5lZCB0aGlzIHdlZWsuIDxidXR0b24gY2xhc3M9ImJ0biBzbSIgZGF0YS1hY3Q9Im5ldy1ldmVudCI+KyBFdmVudDwvYnV0dG9uPjwvZGl2Pic7IH0pKCl9CiAgPGgyPlRhc2tzIGR1ZTwvaDI+CiAgJHt0YXNrcy5sZW5ndGggPyB0YXNrcy5tYXAoKHgpID0+IGA8ZGl2IGNsYXNzPSJpdGVtIj48aW5wdXQgdHlwZT0iY2hlY2tib3giIGRhdGEtYWN0PSJkb25lIiBkYXRhLWlkPSIke3guaWR9IiBzdHlsZT0id2lkdGg6MjJweDttYXJnaW46MCI+PGRpdiBjbGFzcz0iZ3JvdyIgZGF0YS1hY3Q9ImNvbnRhY3QiIGRhdGEtaWQ9IiR7ZXNjKHguY29udGFjdElkKX0iPjxzcGFuIGNsYXNzPSJ0Ij4ke2VzYyh4LnRpdGxlKX08L3NwYW4+PHNwYW4gY2xhc3M9InN1YiI+JHtlc2MoY25hbWUoeC5jb250YWN0SWQpKX0gwrcgJHt4LmR1ZSA8IHQgPyAnPHNwYW4gc3R5bGU9ImNvbG9yOnZhcigtLXJlZCkiPm92ZXJkdWUgJyArIGVzYyh4LmR1ZSkgKyAnPC9zcGFuPicgOiAndG9kYXknfTwvc3Bhbj48L2Rpdj48L2Rpdj5gKS5qb2luKCcnKSA6ICc8ZGl2IGNsYXNzPSJlbXB0eSI+Tm90aGluZyBkdWUuIPCfjok8L2Rpdj4nfQogIDxoMj5OZXcgbWVzc2FnZXM8L2gyPgogICR7dW5yZWFkLmxlbmd0aCA/IHVucmVhZC5zbGljZSgwLCA2KS5tYXAobXNnUm93KS5qb2luKCcnKSA6ICc8ZGl2IGNsYXNzPSJlbXB0eSI+SW5ib3ggaXMgY2xlYXIuPC9kaXY+J30KICA8aDI+VGltZSB0byByZW9yZGVyICgke3MucmVvcmRlckRheXN9KyBkYXlzKTwvaDI+CiAgJHtzLnJlb3JkZXIubGVuZ3RoID8gcy5yZW9yZGVyLm1hcCgocikgPT4gYDxidXR0b24gY2xhc3M9Iml0ZW0iIGRhdGEtYWN0PSJjb250YWN0IiBkYXRhLWlkPSIke3IuY29udGFjdC5pZH0iPiR7YXZhdGFyKHIuY29udGFjdCl9PGRpdiBjbGFzcz0iZ3JvdyI+PGI+JHtlc2Moci5jb250YWN0Lm5hbWUpfTwvYj48c3BhbiBjbGFzcz0ic3ViIj5MYXN0IG9yZGVyICR7ci5kYXlzfSBkYXlzIGFnbzwvc3Bhbj48L2Rpdj48c3BhbiBjbGFzcz0icGlsbCBhbWJlciI+UmVhY2ggb3V0PC9zcGFuPjwvYnV0dG9uPmApLmpvaW4oJycpIDogJzxkaXYgY2xhc3M9ImVtcHR5Ij5ObyBvbmUgaXMgZHVlIHlldC48L2Rpdj4nfWA7Cn0KZnVuY3Rpb24gbXNnUm93KG0pIHsKICBjb25zdCBjID0gYnlJZCgnY29udGFjdHMnLCBtLmNvbnRhY3RJZCk7CiAgcmV0dXJuIGA8YnV0dG9uIGNsYXNzPSJpdGVtIiBkYXRhLWFjdD0iY29udGFjdCIgZGF0YS1pZD0iJHtlc2MobS5jb250YWN0SWQpfSI+JHtjID8gYXZhdGFyKGMpIDogJyd9PGRpdiBjbGFzcz0iZ3JvdyI+PGI+JHtlc2MoYz8ubmFtZSB8fCAnPycpfTwvYj48c3BhbiBjbGFzcz0ic3ViIj4ke0NIX0lDT05bbS5jaGFubmVsXSB8fCAnJ30gJHtlc2MobS5hY2NvdW50KX0gwrcgJHtlc2MobS5zdWJqZWN0IHx8IG0uYm9keSl9PC9zcGFuPjwvZGl2PiR7bS5kaXJlY3Rpb24gPT09ICdpbicgJiYgIW0ucmVhZCA/ICc8aSBjbGFzcz0iZG90Ij48L2k+JyA6ICcnfTxzcGFuIGNsYXNzPSJzdWIiPiR7YWdvKG0uYXQpfTwvc3Bhbj48L2J1dHRvbj5gOwp9CgpmdW5jdGlvbiBpbmJveCgpIHsKICBjb25zdCBhY2NvdW50cyA9IFsuLi5uZXcgU2V0KFMuZC5tZXNzYWdlcy5tYXAoKG0pID0+IG0uYWNjb3VudCkuZmlsdGVyKEJvb2xlYW4pKV07CiAgY29uc3QgbGF0ZXN0ID0ge307CiAgZm9yIChjb25zdCBtIG9mIFMuZC5tZXNzYWdlcykgaWYgKCFsYXRlc3RbbS5jb250YWN0SWRdIHx8IG0uYXQgPiBsYXRlc3RbbS5jb250YWN0SWRdLmF0KSBsYXRlc3RbbS5jb250YWN0SWRdID0gbTsKICBsZXQgcm93cyA9IE9iamVjdC52YWx1ZXMobGF0ZXN0KS5maWx0ZXIoKG0pID0+ICFTLmFjY291bnQgfHwgUy5kLm1lc3NhZ2VzLnNvbWUoKHgpID0+IHguY29udGFjdElkID09PSBtLmNvbnRhY3RJZCAmJiB4LmFjY291bnQgPT09IFMuYWNjb3VudCkpLnNvcnQoKGEsIGIpID0+IGIuYXQubG9jYWxlQ29tcGFyZShhLmF0KSk7CiAgcmV0dXJuIGhlYWQoJ0luYm94JywgcGx1cygnc3luYycsICfihrsgU3luYyBlbWFpbCcpKSArIGA8ZGl2IGNsYXNzPSJjaGlwcyI+PGJ1dHRvbiBkYXRhLWFjYz0iIiBjbGFzcz0iJHshUy5hY2NvdW50ID8gJ29uJyA6ICcnfSI+QWxsPC9idXR0b24+JHthY2NvdW50cy5tYXAoKGEpID0+IGA8YnV0dG9uIGRhdGEtYWNjPSIke2VzYyhhKX0iIGNsYXNzPSIke1MuYWNjb3VudCA9PT0gYSA/ICdvbicgOiAnJ30iPiR7ZXNjKGEpfTwvYnV0dG9uPmApLmpvaW4oJycpfTwvZGl2PmAKICAgICsgKHJvd3MubGVuZ3RoID8gcm93cy5tYXAobXNnUm93KS5qb2luKCcnKSA6ICc8ZGl2IGNsYXNzPSJlbXB0eSI+Tm8gbWVzc2FnZXMgeWV0LiBDb25uZWN0IGEgY2hhbm5lbCBpbiBTZXR0aW5ncywgb3IgbG9nIG9uZSBmcm9tIGEgY29udGFjdC48L2Rpdj4nKTsKfQoKZnVuY3Rpb24gY29udGFjdHMoKSB7CiAgY29uc3QgcSA9IFMucS50b0xvd2VyQ2FzZSgpOwogIGNvbnN0IHJvd3MgPSBTLmQuY29udGFjdHMuZmlsdGVyKChjKSA9PiAoIVMudHlwZSB8fCBjLnR5cGUgPT09IFMudHlwZSkgJiYgKCFxIHx8IEpTT04uc3RyaW5naWZ5KGMpLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocSkpKS5zb3J0KChhLCBiKSA9PiBhLm5hbWUubG9jYWxlQ29tcGFyZShiLm5hbWUpKTsKICByZXR1cm4gaGVhZCgnQ29udGFjdHMnLCBwbHVzKCduZXctY29udGFjdCcpKSArIGA8aW5wdXQgY2xhc3M9InNlYXJjaCIgaWQ9InEiIHBsYWNlaG9sZGVyPSJTZWFyY2ggbmFtZSwgZG9nLCBlbWFpbCwgdGFn4oCmIiB2YWx1ZT0iJHtlc2MoUy5xKX0iPmAKICAgICsgYDxkaXYgY2xhc3M9ImNoaXBzIj48YnV0dG9uIGRhdGEtdHlwZT0iIiBjbGFzcz0iJHshUy50eXBlID8gJ29uJyA6ICcnfSI+QWxsPC9idXR0b24+JHtPYmplY3QuZW50cmllcyhUWVBFUykubWFwKChbaywgbF0pID0+IGA8YnV0dG9uIGRhdGEtdHlwZT0iJHtrfSIgY2xhc3M9IiR7Uy50eXBlID09PSBrID8gJ29uJyA6ICcnfSI+JHtsfTwvYnV0dG9uPmApLmpvaW4oJycpfTwvZGl2PmAKICAgICsgKHJvd3MubGVuZ3RoID8gcm93cy5tYXAoKGMpID0+IGA8YnV0dG9uIGNsYXNzPSJpdGVtIiBkYXRhLWFjdD0iY29udGFjdCIgZGF0YS1pZD0iJHtjLmlkfSI+JHthdmF0YXIoYyl9PGRpdiBjbGFzcz0iZ3JvdyI+PGI+JHtlc2MoYy5uYW1lKX08L2I+PHNwYW4gY2xhc3M9InN1YiI+JHtlc2MoYy5kb2c/Lm5hbWUgPyAn8J+QlSAnICsgYy5kb2cubmFtZSArIChjLmRvZy5icmVlZCA/ICcgwrcgJyArIGMuZG9nLmJyZWVkIDogJycpIDogYy5vcmcgfHwgYy5lbWFpbCB8fCBUWVBFU1tjLnR5cGVdKX08L3NwYW4+PC9kaXY+PHNwYW4gY2xhc3M9InBpbGwgJHtjLnR5cGUgPT09ICdyZXRhaWwnID8gJ3JlZCcgOiBjLnR5cGUgPT09ICdsZWFkJyA/ICdhbWJlcicgOiBjLnR5cGUgPT09ICdwYXJ0bmVyJyA/ICdncmVlbicgOiAnJ30iPiR7VFlQRVNbYy50eXBlXX08L3NwYW4+PC9idXR0b24+YCkuam9pbignJykgOiAnPGRpdiBjbGFzcz0iZW1wdHkiPk5vIGNvbnRhY3RzIG1hdGNoLjwvZGl2PicpOwp9CgpmdW5jdGlvbiBvcmRlcnMoKSB7CiAgY29uc3Qgcm93cyA9IFsuLi5TLmQub3JkZXJzXS5zb3J0KChhLCBiKSA9PiAoYi5kYXRlIHx8ICcnKS5sb2NhbGVDb21wYXJlKGEuZGF0ZSB8fCAnJykpOwogIHJldHVybiBoZWFkKCdPcmRlcnMnLCBwbHVzKCduZXctb3JkZXInKSkgKyAocm93cy5sZW5ndGggPyByb3dzLm1hcCgobykgPT4gYDxidXR0b24gY2xhc3M9Iml0ZW0iIGRhdGEtYWN0PSJvcmRlciIgZGF0YS1pZD0iJHtvLmlkfSI+PGRpdiBjbGFzcz0iZ3JvdyI+PGI+JHtlc2MoY25hbWUoby5jb250YWN0SWQpKX08L2I+PHNwYW4gY2xhc3M9InN1YiI+JHtlc2Moby5kYXRlKX0gwrcgJHtlc2Moby5jaGFubmVsKX0gwrcgJHtvLml0ZW1zLm1hcCgoaSkgPT4gaS5xdHkgKyAnw5cgJyArIGVzYyhpLm5hbWUpKS5qb2luKCcsICcpfTwvc3Bhbj48L2Rpdj48ZGl2IHN0eWxlPSJ0ZXh0LWFsaWduOnJpZ2h0Ij48Yj4ke21vbmV5KG8udG90YWwpfTwvYj48c3BhbiBjbGFzcz0icGlsbCAke28uc3RhdHVzID09PSAnY2FuY2VsbGVkJyA/ICdyZWQnIDogby5zdGF0dXMgPT09ICdkZWxpdmVyZWQnID8gJ2dyZWVuJyA6ICcnfSI+JHtlc2Moby5zdGF0dXMpfTwvc3Bhbj48L2Rpdj48L2J1dHRvbj5gKS5qb2luKCcnKSA6ICc8ZGl2IGNsYXNzPSJlbXB0eSI+Tm8gb3JkZXJzIHlldC48L2Rpdj4nKTsKfQoKZnVuY3Rpb24gcGlwZWxpbmUoKSB7CiAgY29uc3QgY29scyA9IE9iamVjdC5lbnRyaWVzKFNUQUdFUykubWFwKChbaywgbF0pID0+IHsKICAgIGNvbnN0IGRzID0gUy5kLmRlYWxzLmZpbHRlcigoZCkgPT4gZC5zdGFnZSA9PT0gayk7CiAgICByZXR1cm4gYDxkaXYgY2xhc3M9ImNvbCI+PGgzPiR7bH0gwrcgJHtkcy5sZW5ndGh9IMK3ICR7bW9uZXkoZHMucmVkdWNlKChzLCBkKSA9PiBzICsgZC52YWx1ZSwgMCkpfTwvaDM+JHtkcy5tYXAoKGQpID0+IGA8YnV0dG9uIGNsYXNzPSJpdGVtIiBkYXRhLWFjdD0iZGVhbCIgZGF0YS1pZD0iJHtkLmlkfSIgc3R5bGU9ImRpc3BsYXk6YmxvY2siPjxiPiR7ZXNjKGQudGl0bGUpfTwvYj48c3BhbiBjbGFzcz0ic3ViIj4ke2VzYyhjbmFtZShkLmNvbnRhY3RJZCkpfSDCtyAke21vbmV5KGQudmFsdWUpfTwvc3Bhbj48L2J1dHRvbj5gKS5qb2luKCcnKX08L2Rpdj5gOwogIH0pLmpvaW4oJycpOwogIHJldHVybiBoZWFkKCdXaG9sZXNhbGUgcGlwZWxpbmUnLCBwbHVzKCduZXctZGVhbCcpKSArIGA8ZGl2IGNsYXNzPSJrYW4iPiR7Y29sc308L2Rpdj5gOwp9CgpmdW5jdGlvbiBwcm9kdWN0cygpIHsKICByZXR1cm4gaGVhZCgnUHJvZHVjdHMnLCBwbHVzKCduZXctcHJvZHVjdCcpKSArIChTLmQucHJvZHVjdHMubGVuZ3RoID8gUy5kLnByb2R1Y3RzLm1hcCgocCkgPT4gYDxidXR0b24gY2xhc3M9Iml0ZW0iIGRhdGEtYWN0PSJwcm9kdWN0IiBkYXRhLWlkPSIke3AuaWR9Ij48ZGl2IGNsYXNzPSJncm93Ij48Yj4ke2VzYyhwLm5hbWUpfTwvYj48c3BhbiBjbGFzcz0ic3ViIj4ke2VzYyhwLnNrdSl9IMK3IHN0b2NrICR7cC5zdG9ja308L3NwYW4+PC9kaXY+PGRpdiBzdHlsZT0idGV4dC1hbGlnbjpyaWdodCI+PGI+JHttb25leShwLnByaWNlKX08L2I+PHNwYW4gY2xhc3M9InN1YiI+d2hvbGVzYWxlICR7bW9uZXkocC53aG9sZXNhbGUpfTwvc3Bhbj48L2Rpdj48L2J1dHRvbj5gKS5qb2luKCcnKSA6ICc8ZGl2IGNsYXNzPSJlbXB0eSI+Tm8gcHJvZHVjdHMgeWV0LjwvZGl2PicpOwp9CgpmdW5jdGlvbiBzZXR0aW5ncygpIHsKICByZXR1cm4gaGVhZCgnU2V0dGluZ3MnKSArIGA8ZGl2IGlkPSJpbnRlZyI+PGRpdiBjbGFzcz0iZW1wdHkiPkxvYWRpbmfigKY8L2Rpdj48L2Rpdj4KICA8aDI+RGF0YTwvaDI+CiAgPGRpdiBjbGFzcz0iYWN0aW9ucyI+PGEgY2xhc3M9ImJ0biBnaG9zdCIgaHJlZj0iL2FwaS9leHBvcnQiIGRvd25sb2FkPSJwdXJlbHktcGVpLWNybS1iYWNrdXAuanNvbiI+RG93bmxvYWQgYmFja3VwIChKU09OKTwvYT48YnV0dG9uIGNsYXNzPSJidG4gZ2hvc3QiIGRhdGEtYWN0PSJjbGVhci1zYW1wbGUiPlJlbW92ZSBzYW1wbGUgZGF0YTwvYnV0dG9uPjxidXR0b24gY2xhc3M9ImJ0biBnaG9zdCIgZGF0YS1hY3Q9ImxvZ291dCI+TG9nIG91dDwvYnV0dG9uPjwvZGl2PgogIDxwIGNsYXNzPSJzdWIiIHN0eWxlPSJ3aGl0ZS1zcGFjZTpub3JtYWwiPllvdXIgZGF0YSBsaXZlcyBpbiBvbmUgZmlsZSBvbiB0aGUgbWFjaGluZSBydW5uaW5nIHRoaXMgYXBwIChkZWZhdWx0IDxjb2RlPmRhdGEvZGIuanNvbjwvY29kZT4pLiBCYWNrIGl0IHVwLjwvcD5gOwp9CmFzeW5jIGZ1bmN0aW9uIGxvYWRJbnRlZ3JhdGlvbnMoKSB7CiAgY29uc3QgeyBpbnRlZ3JhdGlvbnMsIGF1dGggfSA9IGF3YWl0IGFwaSgnR0VUJywgJy9pbnRlZ3JhdGlvbnMnKTsKICBjb25zdCBlbCA9ICQoJyNpbnRlZycpOyBpZiAoIWVsKSByZXR1cm47CiAgZWwuaW5uZXJIVE1MID0gKGF1dGggPyAnJyA6ICc8ZGl2IGNsYXNzPSJ3YXJuIj5ObyBwYXNzd29yZCBpcyBzZXQuIEZpbmUgb24geW91ciBvd24gY29tcHV0ZXIuIFNldCA8Y29kZT5DUk1fUEFTU1dPUkQ8L2NvZGU+IGJlZm9yZSBwdXR0aW5nIHRoaXMgb24gdGhlIGludGVybmV0LjwvZGl2PicpCiAgICArICc8aDI+Q29ubmVjdGlvbnM8L2gyPicgKyBpbnRlZ3JhdGlvbnMubWFwKChpKSA9PiBgPGRpdiBjbGFzcz0iY2FyZCI+PGRpdiBjbGFzcz0icm93Ij48YiBjbGFzcz0iZ3JvdyI+JHtlc2MoaS5sYWJlbCl9PC9iPjxzcGFuIGNsYXNzPSJwaWxsICR7aS5jb25maWd1cmVkID8gJ2dyZWVuJyA6ICdhbWJlcid9Ij4ke2kuY29uZmlndXJlZCA/ICdDb25uZWN0ZWQnIDogJ05vdCBjb25uZWN0ZWQnfTwvc3Bhbj48L2Rpdj4ke2kud2ViaG9vayA/IGA8ZGl2IGNsYXNzPSJzdWIiPldlYmhvb2s6IDxjb2RlPiR7ZXNjKGxvY2F0aW9uLm9yaWdpbiArIGkud2ViaG9vayl9PC9jb2RlPjwvZGl2PmAgOiAnJ30ke2kubWlzc2luZz8ubGVuZ3RoID8gYDxkaXYgY2xhc3M9InN1YiIgc3R5bGU9IndoaXRlLXNwYWNlOm5vcm1hbCI+TWlzc2luZzogJHtpLm1pc3NpbmcubWFwKGVzYykuam9pbignLCAnKX08L2Rpdj5gIDogJyd9PC9kaXY+YCkuam9pbignJykKICAgICsgJzxwIGNsYXNzPSJzdWIiIHN0eWxlPSJ3aGl0ZS1zcGFjZTpub3JtYWwiPkFkZCBrZXlzIHRvIHRoZSA8Y29kZT4uZW52PC9jb2RlPiBmaWxlIGFuZCByZXN0YXJ0LiBTdGVwcyBhcmUgaW4gZG9jcy9JTlRFR1JBVElPTlMubWQuPC9wPic7Cn0KCi8vIC0tLS0tLS0tLS0gc2hlZXRzIC0tLS0tLS0tLS0KZnVuY3Rpb24gc2hlZXQoaHRtbCkgeyBjb25zdCBzID0gJCgnI3NoZWV0Jyk7ICQoJy5wYW5lbCcsIHMpLmlubmVySFRNTCA9IGh0bWw7IHMuaGlkZGVuID0gZmFsc2U7IH0KZnVuY3Rpb24gY2xvc2VTaGVldCgpIHsgJCgnI3NoZWV0JykuaGlkZGVuID0gdHJ1ZTsgfQpjb25zdCBmaWVsZCA9IChrLCBsYWJlbCwgdiA9ICcnLCBvID0ge30pID0+IG8ub3B0aW9ucwogID8gYDxsYWJlbD4ke2xhYmVsfTxzZWxlY3QgbmFtZT0iJHtrfSI+JHtvLm9wdGlvbnMubWFwKChbdmFsLCBsXSkgPT4gYDxvcHRpb24gdmFsdWU9IiR7ZXNjKHZhbCl9IiAke3ZhbCA9PT0gdiA/ICdzZWxlY3RlZCcgOiAnJ30+JHtlc2MobCl9PC9vcHRpb24+YCkuam9pbignJyl9PC9zZWxlY3Q+PC9sYWJlbD5gCiAgOiBvLmFyZWEgPyBgPGxhYmVsPiR7bGFiZWx9PHRleHRhcmVhIG5hbWU9IiR7a30iPiR7ZXNjKHYpfTwvdGV4dGFyZWE+PC9sYWJlbD5gCiAgOiBgPGxhYmVsPiR7bGFiZWx9PGlucHV0IG5hbWU9IiR7a30iIHR5cGU9IiR7by50eXBlIHx8ICd0ZXh0J30iIHZhbHVlPSIke2VzYyh2KX0iICR7by5zdGVwID8gYHN0ZXA9IiR7by5zdGVwfSJgIDogJyd9ICR7by5yZXEgPyAncmVxdWlyZWQnIDogJyd9PjwvbGFiZWw+YDsKY29uc3QgZm9ybURhdGEgPSAoZikgPT4gT2JqZWN0LmZyb21FbnRyaWVzKG5ldyBGb3JtRGF0YShmKS5lbnRyaWVzKCkpOwpjb25zdCBzaGVldEhlYWQgPSAodCkgPT4gYDxoMz4ke3R9PGJ1dHRvbiBjbGFzcz0ieCIgZGF0YS1hY3Q9ImNsb3NlIiBhcmlhLWxhYmVsPSJDbG9zZSI+w5c8L2J1dHRvbj48L2gzPmA7Cgphc3luYyBmdW5jdGlvbiBjb250YWN0U2hlZXQoaWQpIHsKICBjb25zdCB0ID0gYXdhaXQgYXBpKCdHRVQnLCBgL2NvbnRhY3RzLyR7aWR9L3RpbWVsaW5lYCk7CiAgY29uc3QgYyA9IHQuY29udGFjdDsKICBpZiAodC5tZXNzYWdlcy5zb21lKChtKSA9PiBtLmRpcmVjdGlvbiA9PT0gJ2luJyAmJiAhbS5yZWFkKSkgeyBhcGkoJ1BPU1QnLCBgL2NvbnRhY3RzLyR7aWR9L3JlYWRgKS50aGVuKHJlZnJlc2hRdWlldCk7IH0KICBjb25zdCBjaGFucyA9IFsnZW1haWwnLCAnaW5zdGFncmFtJywgJ2ZhY2Vib29rJywgJ25vdGUnLCAnY2FsbCcsICdzbXMnLCAnaW5fcGVyc29uJ107CiAgY29uc3QgaGFzSW5mbyA9IFtjLmVtYWlsICYmIGDinInvuI8gPGEgaHJlZj0ibWFpbHRvOiR7ZXNjKGMuZW1haWwpfSI+JHtlc2MoYy5lbWFpbCl9PC9hPmAsIGMucGhvbmUgJiYgYPCfk54gPGEgaHJlZj0idGVsOiR7ZXNjKGMucGhvbmUpfSI+JHtlc2MoYy5waG9uZSl9PC9hPmAsIGMuaGFuZGxlcz8uaW5zdGFncmFtICYmIGDwn5O4IDxhIGhyZWY9Imh0dHBzOi8vaW5zdGFncmFtLmNvbS8ke2VzYyhjLmhhbmRsZXMuaW5zdGFncmFtKX0iIHRhcmdldD0iX2JsYW5rIiByZWw9Im5vb3BlbmVyIj5AJHtlc2MoYy5oYW5kbGVzLmluc3RhZ3JhbSl9PC9hPmAsIGMuaGFuZGxlcz8uZmFjZWJvb2sgJiYgJ/CfkqwgJyArIGVzYyhjLmhhbmRsZXMuZmFjZWJvb2spXS5maWx0ZXIoQm9vbGVhbik7CiAgc2hlZXQoc2hlZXRIZWFkKGVzYyhjLm5hbWUpKSArIGAKICAgIDxkaXYgY2xhc3M9InN1YiIgc3R5bGU9IndoaXRlLXNwYWNlOm5vcm1hbCI+JHtUWVBFU1tjLnR5cGVdfSR7Yy5vcmcgPyAnIMK3ICcgKyBlc2MoYy5vcmcpIDogJyd9JHtjLnNvdXJjZSA/ICcgwrcgZnJvbSAnICsgZXNjKGMuc291cmNlKSA6ICcnfTwvZGl2PgogICAgJHtoYXNJbmZvLmxlbmd0aCA/IGA8cCBzdHlsZT0ibWFyZ2luOjhweCAwIj4ke2hhc0luZm8uam9pbignPGJyPicpfTwvcD5gIDogJyd9CiAgICAke2MuZG9nPy5uYW1lID8gYDxkaXYgY2xhc3M9ImNhcmQiPvCfkJUgPGI+JHtlc2MoYy5kb2cubmFtZSl9PC9iPiAke2VzYyhjLmRvZy5icmVlZCB8fCAnJyl9JHtjLmRvZy5hbGxlcmdpZXMgPyBgPGJyPjxzcGFuIGNsYXNzPSJzdWIiPkFsbGVyZ2llczogJHtlc2MoYy5kb2cuYWxsZXJnaWVzKX08L3NwYW4+YCA6ICcnfTwvZGl2PmAgOiAnJ30KICAgICR7Yy50YWdzPy5sZW5ndGggPyBgPHA+JHtjLnRhZ3MubWFwKCh4KSA9PiBgPHNwYW4gY2xhc3M9InBpbGwiPiR7ZXNjKHgpfTwvc3Bhbj5gKS5qb2luKCcgJyl9PC9wPmAgOiAnJ30KICAgICR7Yy5ub3RlcyA/IGA8ZGl2IGNsYXNzPSJjYXJkIHN1YiIgc3R5bGU9IndoaXRlLXNwYWNlOnByZS13cmFwIj4ke2VzYyhjLm5vdGVzKX08L2Rpdj5gIDogJyd9CiAgICA8ZGl2IGNsYXNzPSJhY3Rpb25zIj48YnV0dG9uIGNsYXNzPSJidG4gc20gZ2hvc3QiIGRhdGEtYWN0PSJlZGl0LWNvbnRhY3QiIGRhdGEtaWQ9IiR7aWR9Ij5FZGl0PC9idXR0b24+PGJ1dHRvbiBjbGFzcz0iYnRuIHNtIGdob3N0IiBkYXRhLWFjdD0ibmV3LW9yZGVyIiBkYXRhLWNpZD0iJHtpZH0iPisgT3JkZXI8L2J1dHRvbj48YnV0dG9uIGNsYXNzPSJidG4gc20gZ2hvc3QiIGRhdGEtYWN0PSJuZXctZGVhbCIgZGF0YS1jaWQ9IiR7aWR9Ij4rIERlYWw8L2J1dHRvbj48YnV0dG9uIGNsYXNzPSJidG4gc20gZ2hvc3QiIGRhdGEtYWN0PSJuZXctdGFzayIgZGF0YS1jaWQ9IiR7aWR9Ij4rIFRhc2s8L2J1dHRvbj48L2Rpdj4KICAgICR7dC50YXNrcy5maWx0ZXIoKHgpID0+ICF4LmRvbmUpLm1hcCgoeCkgPT4gYDxkaXYgY2xhc3M9Iml0ZW0iPjxpbnB1dCB0eXBlPSJjaGVja2JveCIgZGF0YS1hY3Q9ImRvbmUiIGRhdGEtaWQ9IiR7eC5pZH0iIGRhdGEtcmVvcGVuPSIke2lkfSIgc3R5bGU9IndpZHRoOjIycHg7bWFyZ2luOjAiPjxkaXYgY2xhc3M9Imdyb3ciPjxzcGFuIGNsYXNzPSJ0Ij4ke2VzYyh4LnRpdGxlKX08L3NwYW4+PHNwYW4gY2xhc3M9InN1YiI+JHtlc2MoeC5kdWUgfHwgJ25vIGRhdGUnKX08L3NwYW4+PC9kaXY+PC9kaXY+YCkuam9pbignJyl9CiAgICAke3Qub3JkZXJzLmxlbmd0aCA/ICc8aDI+T3JkZXJzPC9oMj4nICsgdC5vcmRlcnMubWFwKChvKSA9PiBgPGRpdiBjbGFzcz0iY2FyZCByb3ciPjxkaXYgY2xhc3M9Imdyb3ciPjxiPiR7bW9uZXkoby50b3RhbCl9PC9iPiA8c3BhbiBjbGFzcz0ic3ViIj4ke2VzYyhvLmRhdGUpfSDCtyAke28uaXRlbXMubWFwKChpKSA9PiBpLnF0eSArICfDlyAnICsgZXNjKGkubmFtZSkpLmpvaW4oJywgJyl9PC9zcGFuPjwvZGl2PjxzcGFuIGNsYXNzPSJwaWxsIj4ke2VzYyhvLnN0YXR1cyl9PC9zcGFuPjwvZGl2PmApLmpvaW4oJycpIDogJyd9CiAgICA8aDI+Q29udmVyc2F0aW9uPC9oMj4KICAgIDxkaXYgaWQ9ImNvbnYiPiR7dC5tZXNzYWdlcy5sZW5ndGggPyB0Lm1lc3NhZ2VzLm1hcCgobSkgPT4gYDxkaXYgY2xhc3M9ImJ1YmJsZSAke20uZGlyZWN0aW9ufSI+JHttLnN1YmplY3QgPyAnPGI+JyArIGVzYyhtLnN1YmplY3QpICsgJzwvYj48YnI+JyA6ICcnfSR7ZXNjKG0uYm9keSl9PHNtYWxsPiR7Q0hfSUNPTlttLmNoYW5uZWxdIHx8ICcnfSAke2VzYyhtLmFjY291bnQpfSAke2FnbyhtLmF0KX0ke20uc3RhdHVzICYmICFbJ3JlY2VpdmVkJywgJ3NlbnQnLCAnbG9nZ2VkJ10uaW5jbHVkZXMobS5zdGF0dXMpID8gJyDCtyAnICsgZXNjKG0uc3RhdHVzKSA6ICcnfSR7bS5lcnJvciA/ICcgwrcgJyArIGVzYyhtLmVycm9yKSA6ICcnfTwvc21hbGw+PC9kaXY+YCkuam9pbignJykgOiAnPGRpdiBjbGFzcz0iZW1wdHkiPk5vIG1lc3NhZ2VzIHlldC48L2Rpdj4nfTwvZGl2PgogICAgPGZvcm0gaWQ9ImNvbXBvc2VyIiBkYXRhLWlkPSIke2lkfSIgc3R5bGU9Im1hcmdpbi10b3A6MTJweCI+CiAgICAgIDxkaXYgY2xhc3M9InR3byI+JHtmaWVsZCgnY2hhbm5lbCcsICdDaGFubmVsJywgdC5tZXNzYWdlcy5maWx0ZXIoKG0pID0+IG0uZGlyZWN0aW9uID09PSAnaW4nKS5zbGljZSgtMSlbMF0/LmNoYW5uZWwgfHwgKGMuZW1haWwgPyAnZW1haWwnIDogJ25vdGUnKSwgeyBvcHRpb25zOiBjaGFucy5tYXAoKHgpID0+IFt4LCBDSF9JQ09OW3hdICsgJyAnICsgeF0pIH0pfSR7ZmllbGQoJ3N1YmplY3QnLCAnU3ViamVjdCAoZW1haWwpJyl9PC9kaXY+CiAgICAgICR7ZmllbGQoJ2JvZHknLCAnTWVzc2FnZScsICcnLCB7IGFyZWE6IHRydWUgfSl9CiAgICAgIDxidXR0b24gY2xhc3M9ImJ0biI+U2VuZCAvIGxvZzwvYnV0dG9uPgogICAgPC9mb3JtPmApOwogICQoJyNjb252Jyk/LnNjcm9sbFRvKDAsIDFlOSk7Cn0KYXN5bmMgZnVuY3Rpb24gcmVmcmVzaFF1aWV0KCkgeyBhd2FpdCBsb2FkKCk7IG5hdigpOyB9CgpmdW5jdGlvbiBjb250YWN0Rm9ybShpZCkgewogIGNvbnN0IGMgPSBpZCA/IGJ5SWQoJ2NvbnRhY3RzJywgaWQpIDogeyB0eXBlOiAnbGVhZCcsIGRvZzoge30sIGhhbmRsZXM6IHt9LCB0YWdzOiBbXSB9OwogIHNoZWV0KHNoZWV0SGVhZChpZCA/ICdFZGl0IGNvbnRhY3QnIDogJ05ldyBjb250YWN0JykgKyBgPGZvcm0gaWQ9ImYtY29udGFjdCIgZGF0YS1pZD0iJHtpZCB8fCAnJ30iPgogICAgJHtmaWVsZCgnbmFtZScsICdOYW1lJywgYy5uYW1lLCB7IHJlcTogdHJ1ZSB9KX0KICAgIDxkaXYgY2xhc3M9InR3byI+JHtmaWVsZCgndHlwZScsICdUeXBlJywgYy50eXBlLCB7IG9wdGlvbnM6IE9iamVjdC5lbnRyaWVzKFRZUEVTKSB9KX0ke2ZpZWxkKCdvcmcnLCAnQnVzaW5lc3MnLCBjLm9yZyl9PC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJ0d28iPiR7ZmllbGQoJ2VtYWlsJywgJ0VtYWlsJywgYy5lbWFpbCwgeyB0eXBlOiAnZW1haWwnIH0pfSR7ZmllbGQoJ3Bob25lJywgJ1Bob25lJywgYy5waG9uZSl9PC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJ0d28iPiR7ZmllbGQoJ2luc3RhZ3JhbScsICdJbnN0YWdyYW0gaGFuZGxlJywgYy5oYW5kbGVzPy5pbnN0YWdyYW0pfSR7ZmllbGQoJ2ZhY2Vib29rJywgJ0ZhY2Vib29rIG5hbWUnLCBjLmhhbmRsZXM/LmZhY2Vib29rKX08L2Rpdj4KICAgIDxkaXYgY2xhc3M9InR3byI+JHtmaWVsZCgnZG9nTmFtZScsICJEb2cncyBuYW1lIiwgYy5kb2c/Lm5hbWUpfSR7ZmllbGQoJ2RvZ0JyZWVkJywgJ0JyZWVkJywgYy5kb2c/LmJyZWVkKX08L2Rpdj4KICAgICR7ZmllbGQoJ2FsbGVyZ2llcycsICdEb2cgYWxsZXJnaWVzJywgYy5kb2c/LmFsbGVyZ2llcyl9CiAgICA8ZGl2IGNsYXNzPSJ0d28iPiR7ZmllbGQoJ3NvdXJjZScsICdIb3cgdGhleSBmb3VuZCB5b3UnLCBjLnNvdXJjZSl9JHtmaWVsZCgndGFncycsICdUYWdzIChjb21tYSBzZXBhcmF0ZWQpJywgKGMudGFncyB8fCBbXSkuam9pbignLCAnKSl9PC9kaXY+CiAgICAke2ZpZWxkKCdub3RlcycsICdOb3RlcycsIGMubm90ZXMsIHsgYXJlYTogdHJ1ZSB9KX0KICAgIDxkaXYgY2xhc3M9ImFjdGlvbnMiPjxidXR0b24gY2xhc3M9ImJ0biI+U2F2ZTwvYnV0dG9uPiR7aWQgPyBgPGJ1dHRvbiB0eXBlPSJidXR0b24iIGNsYXNzPSJidG4gZGFuZ2VyIiBkYXRhLWFjdD0iZGVsLWNvbnRhY3QiIGRhdGEtaWQ9IiR7aWR9Ij5EZWxldGU8L2J1dHRvbj5gIDogJyd9PC9kaXY+PC9mb3JtPmApOwp9CgpmdW5jdGlvbiBvcmRlckZvcm0oY2lkLCBpZCkgewogIGNvbnN0IG8gPSBpZCA/IGJ5SWQoJ29yZGVycycsIGlkKSA6IHsgaXRlbXM6IFtdLCBjaGFubmVsOiAnb25saW5lJywgc3RhdHVzOiAnbmV3JywgZGF0ZTogdG9kYXkoKSwgY29udGFjdElkOiBjaWQgfHwgJycgfTsKICBjb25zdCBwcm9kcyA9IFMuZC5wcm9kdWN0cy5maWx0ZXIoKHApID0+IHAuYWN0aXZlICE9PSBmYWxzZSk7CiAgc2hlZXQoc2hlZXRIZWFkKGlkID8gJ09yZGVyJyA6ICdOZXcgb3JkZXInKSArIGA8Zm9ybSBpZD0iZi1vcmRlciIgZGF0YS1pZD0iJHtpZCB8fCAnJ30iPgogICAgJHtmaWVsZCgnY29udGFjdElkJywgJ0N1c3RvbWVyJywgby5jb250YWN0SWQsIHsgb3B0aW9uczogW1snJywgJ0Nob29zZeKApiddLCAuLi5TLmQuY29udGFjdHMubWFwKChjKSA9PiBbYy5pZCwgYy5uYW1lXSldIH0pfQogICAgPGRpdiBjbGFzcz0idHdvIj4ke2ZpZWxkKCdjaGFubmVsJywgJ0NoYW5uZWwnLCBvLmNoYW5uZWwsIHsgb3B0aW9uczogW1snb25saW5lJywgJ09ubGluZSddLCBbJ21hcmtldCcsICdGYXJtZXJzIG1hcmtldCddLCBbJ3dob2xlc2FsZScsICdXaG9sZXNhbGUnXSwgWydvdGhlcicsICdPdGhlciddXSB9KX0ke2ZpZWxkKCdzdGF0dXMnLCAnU3RhdHVzJywgby5zdGF0dXMsIHsgb3B0aW9uczogWyduZXcnLCAncGFpZCcsICdwYWNrZWQnLCAnc2hpcHBlZCcsICdkZWxpdmVyZWQnLCAnY2FuY2VsbGVkJ10ubWFwKCh4KSA9PiBbeCwgeF0pIH0pfTwvZGl2PgogICAgJHtmaWVsZCgnZGF0ZScsICdEYXRlJywgby5kYXRlLCB7IHR5cGU6ICdkYXRlJyB9KX0KICAgIDxoMj5JdGVtcyAocXVhbnRpdHkpPC9oMj4KICAgICR7cHJvZHMubWFwKChwKSA9PiBgPGxhYmVsPiR7ZXNjKHAubmFtZSl9IMK3ICR7bW9uZXkocC5wcmljZSl9IDxzbWFsbD4od2hvbGVzYWxlICR7bW9uZXkocC53aG9sZXNhbGUpfSk8L3NtYWxsPjxpbnB1dCB0eXBlPSJudW1iZXIiIG1pbj0iMCIgbmFtZT0icXR5XyR7cC5pZH0iIHZhbHVlPSIke28uaXRlbXMuZmluZCgoaSkgPT4gaS5wcm9kdWN0SWQgPT09IHAuaWQpPy5xdHkgfHwgJyd9Ij48L2xhYmVsPmApLmpvaW4oJycpfQogICAgJHtpZCA/IGZpZWxkKCd0b3RhbCcsICdUb3RhbCAoJCknLCBvLnRvdGFsLCB7IHR5cGU6ICdudW1iZXInLCBzdGVwOiAnMC4wMScgfSkgOiAnPHAgY2xhc3M9InN1YiI+VG90YWwgaXMgY2FsY3VsYXRlZC4gV2hvbGVzYWxlIG9yZGVycyB1c2Ugd2hvbGVzYWxlIHByaWNlcy48L3A+J30KICAgICR7ZmllbGQoJ25vdGVzJywgJ05vdGVzJywgby5ub3RlcywgeyBhcmVhOiB0cnVlIH0pfQogICAgPGRpdiBjbGFzcz0iYWN0aW9ucyI+PGJ1dHRvbiBjbGFzcz0iYnRuIj5TYXZlPC9idXR0b24+JHtpZCA/IGA8YnV0dG9uIHR5cGU9ImJ1dHRvbiIgY2xhc3M9ImJ0biBkYW5nZXIiIGRhdGEtYWN0PSJkZWwtb3JkZXIiIGRhdGEtaWQ9IiR7aWR9Ij5EZWxldGU8L2J1dHRvbj5gIDogJyd9PC9kaXY+PC9mb3JtPmApOwp9CgpmdW5jdGlvbiBkZWFsRm9ybShjaWQsIGlkKSB7CiAgY29uc3QgZCA9IGlkID8gYnlJZCgnZGVhbHMnLCBpZCkgOiB7IHN0YWdlOiAnbGVhZCcsIGNvbnRhY3RJZDogY2lkIHx8ICcnLCB2YWx1ZTogMCB9OwogIGNvbnN0IHJldGFpbCA9IFMuZC5jb250YWN0czsKICBzaGVldChzaGVldEhlYWQoaWQgPyAnRGVhbCcgOiAnTmV3IGRlYWwnKSArIGA8Zm9ybSBpZD0iZi1kZWFsIiBkYXRhLWlkPSIke2lkIHx8ICcnfSI+CiAgICAke2ZpZWxkKCd0aXRsZScsICdUaXRsZScsIGQudGl0bGUsIHsgcmVxOiB0cnVlIH0pfQogICAgJHtmaWVsZCgnY29udGFjdElkJywgJ0NvbnRhY3QnLCBkLmNvbnRhY3RJZCwgeyBvcHRpb25zOiBbWycnLCAnQ2hvb3Nl4oCmJ10sIC4uLnJldGFpbC5tYXAoKGMpID0+IFtjLmlkLCBjLm5hbWVdKV0gfSl9CiAgICA8ZGl2IGNsYXNzPSJ0d28iPiR7ZmllbGQoJ3N0YWdlJywgJ1N0YWdlJywgZC5zdGFnZSwgeyBvcHRpb25zOiBPYmplY3QuZW50cmllcyhTVEFHRVMpIH0pfSR7ZmllbGQoJ3ZhbHVlJywgJ1ZhbHVlICgkKScsIGQudmFsdWUsIHsgdHlwZTogJ251bWJlcicsIHN0ZXA6ICcwLjAxJyB9KX08L2Rpdj4KICAgICR7ZmllbGQoJ2V4cGVjdGVkQ2xvc2UnLCAnRXhwZWN0ZWQgY2xvc2UnLCBkLmV4cGVjdGVkQ2xvc2UsIHsgdHlwZTogJ2RhdGUnIH0pfSR7ZmllbGQoJ25vdGVzJywgJ05vdGVzJywgZC5ub3RlcywgeyBhcmVhOiB0cnVlIH0pfQogICAgPGRpdiBjbGFzcz0iYWN0aW9ucyI+PGJ1dHRvbiBjbGFzcz0iYnRuIj5TYXZlPC9idXR0b24+JHtpZCA/IGA8YnV0dG9uIHR5cGU9ImJ1dHRvbiIgY2xhc3M9ImJ0biBkYW5nZXIiIGRhdGEtYWN0PSJkZWwtZGVhbCIgZGF0YS1pZD0iJHtpZH0iPkRlbGV0ZTwvYnV0dG9uPmAgOiAnJ308L2Rpdj48L2Zvcm0+YCk7Cn0KZnVuY3Rpb24gdGFza0Zvcm0oY2lkLCBkdWUpIHsKICBzaGVldChzaGVldEhlYWQoJ05ldyB0YXNrJykgKyBgPGZvcm0gaWQ9ImYtdGFzayIgZGF0YS1jaWQ9IiR7Y2lkIHx8ICcnfSI+JHtmaWVsZCgndGl0bGUnLCAnV2hhdCBuZWVkcyBkb2luZycsICcnLCB7IHJlcTogdHJ1ZSB9KX0ke2ZpZWxkKCdkdWUnLCAnRHVlJywgZHVlIHx8IHRvZGF5KCksIHsgdHlwZTogJ2RhdGUnIH0pfTxidXR0b24gY2xhc3M9ImJ0biI+QWRkPC9idXR0b24+PC9mb3JtPmApOwp9CmZ1bmN0aW9uIHByb2R1Y3RGb3JtKGlkKSB7CiAgY29uc3QgcCA9IGlkID8gYnlJZCgncHJvZHVjdHMnLCBpZCkgOiB7IHByaWNlOiAwLCB3aG9sZXNhbGU6IDAsIHN0b2NrOiAwIH07CiAgc2hlZXQoc2hlZXRIZWFkKGlkID8gJ1Byb2R1Y3QnIDogJ05ldyBwcm9kdWN0JykgKyBgPGZvcm0gaWQ9ImYtcHJvZHVjdCIgZGF0YS1pZD0iJHtpZCB8fCAnJ30iPgogICAgJHtmaWVsZCgnbmFtZScsICdOYW1lJywgcC5uYW1lLCB7IHJlcTogdHJ1ZSB9KX0ke2ZpZWxkKCdza3UnLCAnU0tVJywgcC5za3UpfQogICAgPGRpdiBjbGFzcz0idHdvIj4ke2ZpZWxkKCdwcmljZScsICdSZXRhaWwgcHJpY2UgKCQpJywgcC5wcmljZSwgeyB0eXBlOiAnbnVtYmVyJywgc3RlcDogJzAuMDEnIH0pfSR7ZmllbGQoJ3dob2xlc2FsZScsICdXaG9sZXNhbGUgcHJpY2UgKCQpJywgcC53aG9sZXNhbGUsIHsgdHlwZTogJ251bWJlcicsIHN0ZXA6ICcwLjAxJyB9KX08L2Rpdj4KICAgICR7ZmllbGQoJ3N0b2NrJywgJ0luIHN0b2NrJywgcC5zdG9jaywgeyB0eXBlOiAnbnVtYmVyJyB9KX0ke2ZpZWxkKCdub3RlcycsICdOb3RlcycsIHAubm90ZXMsIHsgYXJlYTogdHJ1ZSB9KX0KICAgIDxkaXYgY2xhc3M9ImFjdGlvbnMiPjxidXR0b24gY2xhc3M9ImJ0biI+U2F2ZTwvYnV0dG9uPiR7aWQgPyBgPGJ1dHRvbiB0eXBlPSJidXR0b24iIGNsYXNzPSJidG4gZGFuZ2VyIiBkYXRhLWFjdD0iZGVsLXByb2R1Y3QiIGRhdGEtaWQ9IiR7aWR9Ij5EZWxldGU8L2J1dHRvbj5gIDogJyd9PC9kaXY+PC9mb3JtPmApOwp9CgoKLy8gLS0tLS0tLS0tLSBjYWxlbmRhciAtLS0tLS0tLS0tCmNvbnN0IEVWID0geyBwcm9kdWN0aW9uOiBbJ/CfpaMnLCAnUHJvZHVjdGlvbicsICdibHVlJ10sIGRlbGl2ZXJ5OiBbJ/CfmponLCAnRGVsaXZlcnkgLyBzaGlwcGluZycsICdncmVlbiddLCBtYXJrZXQ6IFsn8J+bkicsICdNYXJrZXQgLyBldmVudCcsICdhbWJlciddLCBwb3N0OiBbJ/Cfk7gnLCAnQ29udGVudCAvIHBvc3QnLCAncmVkJ10sIG1lZXRpbmc6IFsn8J+knScsICdNZWV0aW5nIC8gY2FsbCcsICdibHVlJ10sIG90aGVyOiBbJ/Cfk4wnLCAnT3RoZXInLCAnJ10gfTsKY29uc3QgeW1kID0gKGQpID0+IGAke2QuZ2V0RnVsbFllYXIoKX0tJHtTdHJpbmcoZC5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgJzAnKX0tJHtTdHJpbmcoZC5nZXREYXRlKCkpLnBhZFN0YXJ0KDIsICcwJyl9YDsKY29uc3QgcGFyc2VZbWQgPSAocykgPT4geyBjb25zdCBbeSwgbSwgZF0gPSBTdHJpbmcocykuc3BsaXQoJy0nKS5tYXAoTnVtYmVyKTsgcmV0dXJuIG5ldyBEYXRlKHksIG0gLSAxLCBkKTsgfTsKY29uc3QgYWRkRGF5cyA9IChzLCBuKSA9PiB7IGNvbnN0IGQgPSBwYXJzZVltZChzKTsgZC5zZXREYXRlKGQuZ2V0RGF0ZSgpICsgbik7IHJldHVybiB5bWQoZCk7IH07CmNvbnN0IHdlZWtTdGFydCA9IChzKSA9PiB7IGNvbnN0IGQgPSBwYXJzZVltZChzKTsgZC5zZXREYXRlKGQuZ2V0RGF0ZSgpIC0gKChkLmdldERheSgpICsgNikgJSA3KSk7IHJldHVybiB5bWQoZCk7IH07CmNvbnN0IGZtdERheSA9IChzKSA9PiBwYXJzZVltZChzKS50b0xvY2FsZURhdGVTdHJpbmcoJ2VuLUNBJywgeyB3ZWVrZGF5OiAnc2hvcnQnLCBtb250aDogJ3Nob3J0JywgZGF5OiAnbnVtZXJpYycgfSk7CmNvbnN0IGZtdExvbmcgPSAocykgPT4gcGFyc2VZbWQocykudG9Mb2NhbGVEYXRlU3RyaW5nKCdlbi1DQScsIHsgd2Vla2RheTogJ2xvbmcnLCBtb250aDogJ2xvbmcnLCBkYXk6ICdudW1lcmljJyB9KTsKUy5jYWwgPSB7IG1vZGU6ICd3ZWVrJywgcmVmOiB5bWQobmV3IERhdGUoKSkgfTsKCmZ1bmN0aW9uIGRheUl0ZW1zKGRhdGUpIHsKICByZXR1cm4gWwogICAgLi4uUy5kLmV2ZW50cy5maWx0ZXIoKGUpID0+IGUuZGF0ZSA9PT0gZGF0ZSkubWFwKChlKSA9PiAoeyBraW5kOiAnZXZlbnQnLCBpZDogZS5pZCwgdGl0bGU6IGUudGl0bGUsIHRpbWU6IGUudGltZSwgdHlwZTogZS50eXBlIH0pKSwKICAgIC4uLlMuZC50YXNrcy5maWx0ZXIoKHQpID0+ICF0LmRvbmUgJiYgdC5kdWUgPT09IGRhdGUpLm1hcCgodCkgPT4gKHsga2luZDogJ3Rhc2snLCBpZDogdC5pZCwgdGl0bGU6IHQudGl0bGUsIHRpbWU6ICcnLCB0eXBlOiAndGFzaycgfSkpLAogICAgLi4uUy5kLmRlYWxzLmZpbHRlcigoZCkgPT4gZC5leHBlY3RlZENsb3NlID09PSBkYXRlICYmICFbJ3dvbicsICdsb3N0J10uaW5jbHVkZXMoZC5zdGFnZSkpLm1hcCgoZCkgPT4gKHsga2luZDogJ2RlYWwnLCBpZDogZC5pZCwgdGl0bGU6ICdEZWFsIGNsb3NlczogJyArIGQudGl0bGUsIHRpbWU6ICcnLCB0eXBlOiAnZGVhbCcgfSkpLAogIF0uc29ydCgoYSwgYikgPT4gKGEudGltZSB8fCAnOTknKS5sb2NhbGVDb21wYXJlKGIudGltZSB8fCAnOTknKSk7Cn0KZnVuY3Rpb24gaXRlbUxpbmUoaXQsIGRhdGUpIHsKICBpZiAoaXQua2luZCA9PT0gJ3Rhc2snKSByZXR1cm4gYDxkaXYgY2xhc3M9Iml0ZW0gY2FsLWl0Ij48aW5wdXQgdHlwZT0iY2hlY2tib3giIGRhdGEtYWN0PSJkb25lIiBkYXRhLWlkPSIke2l0LmlkfSIgZGF0YS1kYXk9IiR7ZGF0ZX0iIHN0eWxlPSJ3aWR0aDoyMnB4O21hcmdpbjowIiBhcmlhLWxhYmVsPSJEb25lIj48ZGl2IGNsYXNzPSJncm93Ij48c3BhbiBjbGFzcz0idCI+JHtlc2MoaXQudGl0bGUpfTwvc3Bhbj48c3BhbiBjbGFzcz0ic3ViIj5UYXNrPC9zcGFuPjwvZGl2PjwvZGl2PmA7CiAgY29uc3QgaWMgPSBpdC5raW5kID09PSAnZXZlbnQnID8gKEVWW2l0LnR5cGVdIHx8IEVWLm90aGVyKVswXSA6ICfwn46vJzsKICByZXR1cm4gYDxidXR0b24gY2xhc3M9Iml0ZW0gY2FsLWl0IiBkYXRhLWFjdD0iJHtpdC5raW5kID09PSAnZXZlbnQnID8gJ2V2ZW50JyA6ICdkZWFsJ30iIGRhdGEtaWQ9IiR7aXQuaWR9Ij48c3BhbiBjbGFzcz0iaWMiPiR7aWN9PC9zcGFuPjxkaXYgY2xhc3M9Imdyb3ciPjxzcGFuIGNsYXNzPSJ0Ij4ke2VzYyhpdC50aXRsZSl9PC9zcGFuPiR7aXQudGltZSA/IGA8c3BhbiBjbGFzcz0ic3ViIj4ke2VzYyhpdC50aW1lKX08L3NwYW4+YCA6ICcnfTwvZGl2PjwvYnV0dG9uPmA7Cn0KZnVuY3Rpb24gY2FsZW5kYXIoKSB7CiAgY29uc3QgeyBtb2RlLCByZWYgfSA9IFMuY2FsLCB0ID0geW1kKG5ldyBEYXRlKCkpOwogIGNvbnN0IGJhciA9ICh0aXRsZSkgPT4gaGVhZCgnQ2FsZW5kYXInLCBwbHVzKCduZXctZXZlbnQnLCAnKyBFdmVudCcpKQogICAgKyBgPGRpdiBjbGFzcz0iY2FsLWJhciI+PGRpdiBjbGFzcz0ic2VnIj48YnV0dG9uIGRhdGEtYWN0PSJjYWwtbW9kZSIgZGF0YS1pZD0id2VlayIgY2xhc3M9IiR7bW9kZSA9PT0gJ3dlZWsnID8gJ29uJyA6ICcnfSI+V2VlazwvYnV0dG9uPjxidXR0b24gZGF0YS1hY3Q9ImNhbC1tb2RlIiBkYXRhLWlkPSJtb250aCIgY2xhc3M9IiR7bW9kZSA9PT0gJ21vbnRoJyA/ICdvbicgOiAnJ30iPk1vbnRoPC9idXR0b24+PC9kaXY+YAogICAgKyBgPGRpdiBjbGFzcz0iY2FsLW5hdiI+PGJ1dHRvbiBjbGFzcz0iYnRuIGdob3N0IHNtIiBkYXRhLWFjdD0iY2FsLW5hdiIgZGF0YS1kPSItMSIgYXJpYS1sYWJlbD0iUHJldmlvdXMiPuKAuTwvYnV0dG9uPjxidXR0b24gY2xhc3M9ImJ0biBnaG9zdCBzbSIgZGF0YS1hY3Q9ImNhbC1uYXYiIGRhdGEtZD0iMCI+VG9kYXk8L2J1dHRvbj48YnV0dG9uIGNsYXNzPSJidG4gZ2hvc3Qgc20iIGRhdGEtYWN0PSJjYWwtbmF2IiBkYXRhLWQ9IjEiIGFyaWEtbGFiZWw9Ik5leHQiPuKAujwvYnV0dG9uPjwvZGl2PjwvZGl2PjxkaXYgY2xhc3M9ImNhbC10aXRsZSI+JHt0aXRsZX08L2Rpdj5gOwogIGNvbnN0IGxlZ2VuZCA9IGA8ZGl2IGNsYXNzPSJjYWwtbGVnZW5kIj4ke09iamVjdC52YWx1ZXMoRVYpLnNsaWNlKDAsIDUpLm1hcCgodikgPT4gYDxzcGFuPiR7dlswXX0gJHt2WzFdfTwvc3Bhbj5gKS5qb2luKCcnKX08L2Rpdj5gOwogIGlmIChtb2RlID09PSAnd2VlaycpIHsKICAgIGNvbnN0IHN0YXJ0ID0gd2Vla1N0YXJ0KHJlZiksIGRheXMgPSBbLi4uQXJyYXkoNyldLm1hcCgoXywgaSkgPT4gYWRkRGF5cyhzdGFydCwgaSkpOwogICAgcmV0dXJuIGJhcihgJHtmbXREYXkoZGF5c1swXSl9IHRvICR7Zm10RGF5KGRheXNbNl0pfWApICsgZGF5cy5tYXAoKGQpID0+IHsKICAgICAgY29uc3QgaXRzID0gZGF5SXRlbXMoZCksIGR0ID0gcGFyc2VZbWQoZCk7CiAgICAgIHJldHVybiBgPGRpdiBjbGFzcz0id2sgJHtkID09PSB0ID8gJ3RvZGF5JyA6ICcnfSI+PGJ1dHRvbiBjbGFzcz0id2stZCIgZGF0YS1hY3Q9ImNhbC1kYXkiIGRhdGEtaWQ9IiR7ZH0iIGFyaWEtbGFiZWw9IiR7ZXNjKGZtdExvbmcoZCkpfSI+PHNtYWxsPiR7ZHQudG9Mb2NhbGVEYXRlU3RyaW5nKCdlbi1DQScsIHsgd2Vla2RheTogJ3Nob3J0JyB9KX08L3NtYWxsPjxiPiR7ZHQuZ2V0RGF0ZSgpfTwvYj48L2J1dHRvbj48ZGl2IGNsYXNzPSJ3ay1pIj4ke2l0cy5sZW5ndGggPyBpdHMubWFwKChpdCkgPT4gaXRlbUxpbmUoaXQsIGQpKS5qb2luKCcnKSA6IGA8YnV0dG9uIGNsYXNzPSJ3ay1lbXB0eSIgZGF0YS1hY3Q9Im5ldy1ldmVudCIgZGF0YS1pZD0iJHtkfSI+KyBhZGQ8L2J1dHRvbj5gfTwvZGl2PjwvZGl2PmA7CiAgICB9KS5qb2luKCcnKSArIGxlZ2VuZDsKICB9CiAgY29uc3QgZmlyc3QgPSBwYXJzZVltZChyZWYpOyBmaXJzdC5zZXREYXRlKDEpOwogIGNvbnN0IHN0YXJ0ID0gd2Vla1N0YXJ0KHltZChmaXJzdCkpLCBsYXN0ID0gbmV3IERhdGUoZmlyc3QuZ2V0RnVsbFllYXIoKSwgZmlyc3QuZ2V0TW9udGgoKSArIDEsIDApLCB3ZWVrcyA9IE1hdGguY2VpbCgoKHBhcnNlWW1kKHltZChsYXN0KSkgLSBwYXJzZVltZChzdGFydCkpIC8gODY0MDAwMDAgKyAxKSAvIDcpOwogIGNvbnN0IG5hbWVzID0gWy4uLkFycmF5KDcpXS5tYXAoKF8sIGkpID0+IHBhcnNlWW1kKGFkZERheXMod2Vla1N0YXJ0KHQpLCBpKSkudG9Mb2NhbGVEYXRlU3RyaW5nKCdlbi1DQScsIHsgd2Vla2RheTogJ3Nob3J0JyB9KSk7CiAgbGV0IGNlbGxzID0gJyc7CiAgZm9yIChsZXQgaSA9IDA7IGkgPCB3ZWVrcyAqIDc7IGkrKykgewogICAgY29uc3QgZCA9IGFkZERheXMoc3RhcnQsIGkpLCBkdCA9IHBhcnNlWW1kKGQpLCBpdHMgPSBkYXlJdGVtcyhkKSwgb3RoZXIgPSBkdC5nZXRNb250aCgpICE9PSBmaXJzdC5nZXRNb250aCgpOwogICAgY2VsbHMgKz0gYDxidXR0b24gY2xhc3M9Im1jICR7b3RoZXIgPyAnZGltJyA6ICcnfSAke2QgPT09IHQgPyAndG9kYXknIDogJyd9IiBkYXRhLWFjdD0iY2FsLWRheSIgZGF0YS1pZD0iJHtkfSIgYXJpYS1sYWJlbD0iJHtlc2MoZm10TG9uZyhkKSl9LCAke2l0cy5sZW5ndGh9IGl0ZW1zIj48Yj4ke2R0LmdldERhdGUoKX08L2I+YAogICAgICArIGA8c3BhbiBjbGFzcz0iZG90cyI+JHtpdHMuc2xpY2UoMCwgNCkubWFwKChpdCkgPT4gYDxpIGNsYXNzPSJkdCBkdC0ke2l0LnR5cGV9Ij48L2k+YCkuam9pbignJyl9JHtpdHMubGVuZ3RoID4gNCA/ICc8ZW0+KzwvZW0+JyA6ICcnfTwvc3Bhbj5gCiAgICAgICsgYDxzcGFuIGNsYXNzPSJtdCI+JHtpdHMuc2xpY2UoMCwgMikubWFwKChpdCkgPT4gZXNjKGl0LnRpdGxlKSkuam9pbignPGJyPicpfTwvc3Bhbj48L2J1dHRvbj5gOwogIH0KICByZXR1cm4gYmFyKGZpcnN0LnRvTG9jYWxlRGF0ZVN0cmluZygnZW4tQ0EnLCB7IG1vbnRoOiAnbG9uZycsIHllYXI6ICdudW1lcmljJyB9KSkgKyBgPGRpdiBjbGFzcz0ibWdyaWQgbWhlYWQiPiR7bmFtZXMubWFwKChuKSA9PiBgPHNwYW4+JHtufTwvc3Bhbj5gKS5qb2luKCcnKX08L2Rpdj48ZGl2IGNsYXNzPSJtZ3JpZCI+JHtjZWxsc308L2Rpdj5gICsgbGVnZW5kOwp9CmZ1bmN0aW9uIGRheVNoZWV0KGRhdGUpIHsKICBjb25zdCBpdHMgPSBkYXlJdGVtcyhkYXRlKTsKICBzaGVldChzaGVldEhlYWQoZXNjKGZtdExvbmcoZGF0ZSkpKSArIChpdHMubGVuZ3RoID8gaXRzLm1hcCgoaXQpID0+IGl0ZW1MaW5lKGl0LCBkYXRlKSkuam9pbignJykgOiAnPGRpdiBjbGFzcz0iZW1wdHkiPk5vdGhpbmcgcGxhbm5lZC48L2Rpdj4nKQogICAgKyBgPGRpdiBjbGFzcz0iYWN0aW9ucyI+PGJ1dHRvbiBjbGFzcz0iYnRuIiBkYXRhLWFjdD0ibmV3LWV2ZW50IiBkYXRhLWlkPSIke2RhdGV9Ij4rIEV2ZW50PC9idXR0b24+PGJ1dHRvbiBjbGFzcz0iYnRuIGdob3N0IiBkYXRhLWFjdD0ibmV3LXRhc2stZGF5IiBkYXRhLWlkPSIke2RhdGV9Ij4rIFRhc2s8L2J1dHRvbj48L2Rpdj5gKTsKfQpmdW5jdGlvbiBldmVudEZvcm0oaWQsIGRhdGUpIHsKICBjb25zdCBlID0gaWQgPyBieUlkKCdldmVudHMnLCBpZCkgOiB7IGRhdGU6IGRhdGUgfHwgeW1kKG5ldyBEYXRlKCkpLCB0eXBlOiAncHJvZHVjdGlvbicsIHRpbWU6ICcnLCB0aXRsZTogJycsIG5vdGVzOiAnJywgY29udGFjdElkOiAnJyB9OwogIHNoZWV0KHNoZWV0SGVhZChpZCA/ICdFdmVudCcgOiAnTmV3IGV2ZW50JykgKyBgPGZvcm0gaWQ9ImYtZXZlbnQiIGRhdGEtaWQ9IiR7aWQgfHwgJyd9Ij5gCiAgICArIGAke2ZpZWxkKCd0aXRsZScsICdXaGF0JywgZS50aXRsZSwgeyByZXE6IHRydWUgfSl9JHtmaWVsZCgndHlwZScsICdUeXBlJywgZS50eXBlLCB7IG9wdGlvbnM6IE9iamVjdC5lbnRyaWVzKEVWKS5tYXAoKFtrLCB2XSkgPT4gW2ssIHZbMF0gKyAnICcgKyB2WzFdXSkgfSl9YAogICAgKyBgPGRpdiBjbGFzcz0idHdvIj4ke2ZpZWxkKCdkYXRlJywgJ0RhdGUnLCBlLmRhdGUsIHsgdHlwZTogJ2RhdGUnLCByZXE6IHRydWUgfSl9JHtmaWVsZCgndGltZScsICdUaW1lIChvcHRpb25hbCknLCBlLnRpbWUsIHsgdHlwZTogJ3RpbWUnIH0pfTwvZGl2PmAKICAgICsgYCR7ZmllbGQoJ2NvbnRhY3RJZCcsICdDdXN0b21lciAob3B0aW9uYWwpJywgZS5jb250YWN0SWQgfHwgJycsIHsgb3B0aW9uczogW1snJywgJ05vbmUnXSwgLi4uUy5kLmNvbnRhY3RzLm1hcCgoYykgPT4gW2MuaWQsIGMubmFtZV0pXSB9KX0ke2ZpZWxkKCdub3RlcycsICdOb3RlcycsIGUubm90ZXMsIHsgYXJlYTogdHJ1ZSB9KX1gCiAgICArIGA8ZGl2IGNsYXNzPSJhY3Rpb25zIj48YnV0dG9uIGNsYXNzPSJidG4iPlNhdmU8L2J1dHRvbj4ke2lkID8gYDxidXR0b24gdHlwZT0iYnV0dG9uIiBjbGFzcz0iYnRuIGRhbmdlciIgZGF0YS1hY3Q9ImRlbC1ldmVudCIgZGF0YS1pZD0iJHtpZH0iPkRlbGV0ZTwvYnV0dG9uPmAgOiAnJ308L2Rpdj48L2Zvcm0+YCk7Cn0KCi8vIC0tLS0tLS0tLS0gcXVpY2sgYWN0aW9ucyAocGhvbmUgZmlyc3QpIC0tLS0tLS0tLS0KZnVuY3Rpb24gcXVpY2tNZW51KCkgewogIHNoZWV0KHNoZWV0SGVhZCgnUXVpY2sgYWN0aW9ucycpICsgYDxkaXYgY2xhc3M9InR3byI+CiAgICA8YnV0dG9uIGNsYXNzPSJpdGVtIHFhIiBkYXRhLWFjdD0ic2FsZSI+PHNwYW4+8J+bkjwvc3Bhbj48Yj5RdWljayBzYWxlPC9iPjwvYnV0dG9uPgogICAgPGJ1dHRvbiBjbGFzcz0iaXRlbSBxYSIgZGF0YS1hY3Q9InFub3RlIj48c3Bhbj7wn5OdPC9zcGFuPjxiPkxvZyBub3RlIC8gY2FsbDwvYj48L2J1dHRvbj4KICAgIDxidXR0b24gY2xhc3M9Iml0ZW0gcWEiIGRhdGEtYWN0PSJuZXctY29udGFjdCI+PHNwYW4+8J+RpDwvc3Bhbj48Yj5OZXcgY29udGFjdDwvYj48L2J1dHRvbj4KICAgIDxidXR0b24gY2xhc3M9Iml0ZW0gcWEiIGRhdGEtYWN0PSJuZXctdGFzay1hbnkiPjxzcGFuPuKchTwvc3Bhbj48Yj5OZXcgdGFzazwvYj48L2J1dHRvbj4KICAgIDxidXR0b24gY2xhc3M9Iml0ZW0gcWEiIGRhdGEtYWN0PSJuZXctb3JkZXIiPjxzcGFuPvCfk6Y8L3NwYW4+PGI+TmV3IG9yZGVyPC9iPjwvYnV0dG9uPgogICAgPGJ1dHRvbiBjbGFzcz0iaXRlbSBxYSIgZGF0YS1hY3Q9Im5ldy1kZWFsIj48c3Bhbj7wn46vPC9zcGFuPjxiPk5ldyBkZWFsPC9iPjwvYnV0dG9uPgogICAgPGJ1dHRvbiBjbGFzcz0iaXRlbSBxYSIgZGF0YS1hY3Q9Im5ldy1ldmVudCI+PHNwYW4+8J+ThTwvc3Bhbj48Yj5OZXcgZXZlbnQ8L2I+PC9idXR0b24+CiAgICA8YnV0dG9uIGNsYXNzPSJpdGVtIHFhIiBkYXRhLWdvPSJjYWxlbmRhciI+PHNwYW4+8J+Xk++4jzwvc3Bhbj48Yj5PcGVuIGNhbGVuZGFyPC9iPjwvYnV0dG9uPjwvZGl2PmApOwp9CmZ1bmN0aW9uIHNhbGVUb3RhbCgpIHsKICBsZXQgdCA9IDA7IGZvciAoY29uc3QgcCBvZiBTLmQucHJvZHVjdHMpIHQgKz0gKE51bWJlcigkKCcjc2FsZS0nICsgcC5pZCk/LnZhbHVlKSB8fCAwKSAqIHAucHJpY2U7CiAgY29uc3QgZWwgPSAkKCcjc2FsZS10b3RhbCcpOyBpZiAoZWwpIGVsLnRleHRDb250ZW50ID0gbW9uZXkodCk7Cn0KZnVuY3Rpb24gc2FsZVNoZWV0KCkgewogIGNvbnN0IHByb2RzID0gUy5kLnByb2R1Y3RzLmZpbHRlcigocCkgPT4gcC5hY3RpdmUgIT09IGZhbHNlKTsKICBzaGVldChzaGVldEhlYWQoJ1F1aWNrIHNhbGUnKSArIGA8Zm9ybSBpZD0iZi1zYWxlIj4KICAgICR7cHJvZHMubGVuZ3RoID8gcHJvZHMubWFwKChwKSA9PiBgPGRpdiBjbGFzcz0iaXRlbSIgc3R5bGU9ImN1cnNvcjpkZWZhdWx0Ij48ZGl2IGNsYXNzPSJncm93Ij48Yj4ke2VzYyhwLm5hbWUpfTwvYj48c3BhbiBjbGFzcz0ic3ViIj4ke21vbmV5KHAucHJpY2UpfTwvc3Bhbj48L2Rpdj4KICAgICAgPGJ1dHRvbiB0eXBlPSJidXR0b24iIGNsYXNzPSJidG4gZ2hvc3Qgc3RlcCIgZGF0YS1hY3Q9InF0eSIgZGF0YS1pZD0iJHtwLmlkfSIgZGF0YS1kPSItMSI+4oiSPC9idXR0b24+CiAgICAgIDxpbnB1dCBpZD0ic2FsZS0ke3AuaWR9IiBuYW1lPSJxXyR7cC5pZH0iIHR5cGU9Im51bWJlciIgaW5wdXRtb2RlPSJudW1lcmljIiBtaW49IjAiIHZhbHVlPSIwIiBzdHlsZT0id2lkdGg6NTZweDt0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW46MCIgb25pbnB1dD0iIj4KICAgICAgPGJ1dHRvbiB0eXBlPSJidXR0b24iIGNsYXNzPSJidG4gc3RlcCIgZGF0YS1hY3Q9InF0eSIgZGF0YS1pZD0iJHtwLmlkfSIgZGF0YS1kPSIxIj4rPC9idXR0b24+PC9kaXY+YCkuam9pbignJykgOiAnPGRpdiBjbGFzcz0iZW1wdHkiPkFkZCBwcm9kdWN0cyBmaXJzdCAoTW9yZSA+IFByb2R1Y3RzKS48L2Rpdj4nfQogICAgPGRpdiBjbGFzcz0idHdvIj4ke2ZpZWxkKCdjaGFubmVsJywgJ1doZXJlJywgJ21hcmtldCcsIHsgb3B0aW9uczogW1snbWFya2V0JywgJ0Zhcm1lcnMgbWFya2V0J10sIFsnb25saW5lJywgJ09ubGluZSddLCBbJ290aGVyJywgJ090aGVyJ11dIH0pfQogICAgJHtmaWVsZCgnY29udGFjdElkJywgJ0N1c3RvbWVyIChvcHRpb25hbCknLCAnJywgeyBvcHRpb25zOiBbWycnLCAnV2Fsay1pbiddLCAuLi5TLmQuY29udGFjdHMuZmlsdGVyKChjKSA9PiAhYy50YWdzPy5pbmNsdWRlcygnd2Fsay1pbicpKS5tYXAoKGMpID0+IFtjLmlkLCBjLm5hbWVdKV0gfSl9PC9kaXY+CiAgICA8YnV0dG9uIGNsYXNzPSJidG4gYmlnIj5TYXZlIHNhbGUgwrcgPHNwYW4gaWQ9InNhbGUtdG90YWwiPiQwPC9zcGFuPjwvYnV0dG9uPjwvZm9ybT5gKTsKfQpmdW5jdGlvbiBub3RlU2hlZXQoY2lkKSB7CiAgc2hlZXQoc2hlZXRIZWFkKCdMb2cgbm90ZSAvIGNhbGwnKSArIGA8Zm9ybSBpZD0iZi1xbm90ZSI+CiAgICAke2ZpZWxkKCdjb250YWN0SWQnLCAnV2hvJywgY2lkIHx8ICcnLCB7IG9wdGlvbnM6IFtbJycsICdDaG9vc2XigKYnXSwgLi4uWy4uLlMuZC5jb250YWN0c10uc29ydCgoYSwgYikgPT4gYS5uYW1lLmxvY2FsZUNvbXBhcmUoYi5uYW1lKSkubWFwKChjKSA9PiBbYy5pZCwgYy5uYW1lXSldIH0pfQogICAgJHtmaWVsZCgnY2hhbm5lbCcsICdUeXBlJywgJ25vdGUnLCB7IG9wdGlvbnM6IFtbJ25vdGUnLCAn8J+TnSBOb3RlJ10sIFsnY2FsbCcsICfwn5OeIENhbGwnXSwgWydpbl9wZXJzb24nLCAn8J+knSBJbiBwZXJzb24nXSwgWydzbXMnLCAn8J+TsSBUZXh0J11dIH0pfQogICAgJHtmaWVsZCgnYm9keScsICdXaGF0IGhhcHBlbmVkJywgJycsIHsgYXJlYTogdHJ1ZSB9KX08YnV0dG9uIGNsYXNzPSJidG4gYmlnIj5TYXZlPC9idXR0b24+PC9mb3JtPmApOwp9CmZ1bmN0aW9uIHNob3dMb2dpbigpIHsKICBpZiAoJCgnI2xvZ2luJykpIHJldHVybjsKICBkb2N1bWVudC5ib2R5Lmluc2VydEFkamFjZW50SFRNTCgnYmVmb3JlZW5kJywgYDxkaXYgaWQ9ImxvZ2luIj48Zm9ybSBpZD0iZi1sb2dpbiI+PGRpdiBjbGFzcz0icGF3IiBzdHlsZT0iZm9udC1zaXplOjQ0cHgiPvCfkL48L2Rpdj48aDEgc3R5bGU9Imp1c3RpZnktY29udGVudDpjZW50ZXIiPlB1cmVseSBQRUkgQ1JNPC9oMT4KICAgIDxpbnB1dCB0eXBlPSJwYXNzd29yZCIgbmFtZT0icGFzc3dvcmQiIHBsYWNlaG9sZGVyPSJQYXNzd29yZCIgYXV0b2NvbXBsZXRlPSJjdXJyZW50LXBhc3N3b3JkIiBhdXRvZm9jdXMgcmVxdWlyZWQ+PGJ1dHRvbiBjbGFzcz0iYnRuIGJpZyIgc3R5bGU9Im1hcmdpbi10b3A6MTBweCI+TG9nIGluPC9idXR0b24+PHAgY2xhc3M9InN1YiIgaWQ9ImxvZ2luLWVyciIgc3R5bGU9InRleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXJlZCkiPjwvcD48L2Zvcm0+PC9kaXY+YCk7Cn0KZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignc3VibWl0JywgYXN5bmMgKGUpID0+IHsKICBpZiAoZS50YXJnZXQuaWQgIT09ICdmLWxvZ2luJykgcmV0dXJuOwogIGUucHJldmVudERlZmF1bHQoKTsgZS5zdG9wSW1tZWRpYXRlUHJvcGFnYXRpb24oKTsKICB0cnkgeyBhd2FpdCBhcGkoJ1BPU1QnLCAnL2xvZ2luJywgeyBwYXNzd29yZDogZS50YXJnZXQucGFzc3dvcmQudmFsdWUgfSk7IGxvY2F0aW9uLnJlbG9hZCgpOyB9CiAgY2F0Y2ggKGVycikgeyAkKCcjbG9naW4tZXJyJykudGV4dENvbnRlbnQgPSBlcnIubWVzc2FnZTsgfQp9LCB0cnVlKTsKd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoImhhc2hjaGFuZ2UiLCAoKSA9PiBoYW5kbGVIYXNoKCkpOwpmdW5jdGlvbiBoYW5kbGVIYXNoKCkgewogIGNvbnN0IGggPSBsb2NhdGlvbi5oYXNoLnNsaWNlKDEpOyBpZiAoIWgpIHJldHVybjsKICBoaXN0b3J5LnJlcGxhY2VTdGF0ZShudWxsLCAnJywgbG9jYXRpb24ucGF0aG5hbWUpOwogICh7IHNhbGU6IHNhbGVTaGVldCwgbm90ZTogKCkgPT4gbm90ZVNoZWV0KCksIGNvbnRhY3Q6ICgpID0+IGNvbnRhY3RGb3JtKCksIHRhc2s6ICgpID0+IHRhc2tGb3JtKCcnKSwgcXVpY2s6IHF1aWNrTWVudSB9W2hdIHx8ICgoKSA9PiB7fSkpKCk7Cn0KCi8vIC0tLS0tLS0tLS0gZXZlbnRzIC0tLS0tLS0tLS0KZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCBhc3luYyAoZSkgPT4gewogIGNvbnN0IGdvID0gZS50YXJnZXQuY2xvc2VzdCgnW2RhdGEtZ29dJyk7CiAgaWYgKGdvKSB7CiAgICBpZiAoZ28uZGF0YXNldC5nbyA9PT0gJ21vcmUnKSByZXR1cm4gc2hlZXQoc2hlZXRIZWFkKCdNb3JlJykgKyBgPGJ1dHRvbiBjbGFzcz0iaXRlbSIgZGF0YS1nbz0icGlwZWxpbmUiPvCfjq8gPGI+UGlwZWxpbmU8L2I+PC9idXR0b24+PGJ1dHRvbiBjbGFzcz0iaXRlbSIgZGF0YS1nbz0icHJvZHVjdHMiPvCfm43vuI8gPGI+UHJvZHVjdHM8L2I+PC9idXR0b24+PGJ1dHRvbiBjbGFzcz0iaXRlbSIgZGF0YS1nbz0ic2V0dGluZ3MiPuKame+4jyA8Yj5TZXR0aW5ncyBhbmQgY29ubmVjdGlvbnM8L2I+PC9idXR0b24+YCk7CiAgICBTLnZpZXcgPSBnby5kYXRhc2V0LmdvOyBjbG9zZVNoZWV0KCk7IHJlbmRlcigpOyBpZiAoUy52aWV3ID09PSAnc2V0dGluZ3MnKSBsb2FkSW50ZWdyYXRpb25zKCk7IGlmIChTLnZpZXcgPT09ICdpbmJveCcpIHN5bmNNYWlsKGZhbHNlKTsgcmV0dXJuOwogIH0KICBjb25zdCBjaGlwID0gZS50YXJnZXQuY2xvc2VzdCgnW2RhdGEtdHlwZV0sW2RhdGEtYWNjXScpOwogIGlmIChjaGlwKSB7IGlmICgndHlwZScgaW4gY2hpcC5kYXRhc2V0KSBTLnR5cGUgPSBjaGlwLmRhdGFzZXQudHlwZTsgZWxzZSBTLmFjY291bnQgPSBjaGlwLmRhdGFzZXQuYWNjOyByZXR1cm4gcmVuZGVyKCk7IH0KICBpZiAoZS50YXJnZXQuY2xvc2VzdCgnLnNjcmltJykpIHJldHVybiBjbG9zZVNoZWV0KCk7CiAgY29uc3QgYSA9IGUudGFyZ2V0LmNsb3Nlc3QoJ1tkYXRhLWFjdF0nKTsgaWYgKCFhKSByZXR1cm47CiAgY29uc3QgeyBhY3QsIGlkLCBjaWQgfSA9IGEuZGF0YXNldDsKICB0cnkgewogICAgaWYgKGFjdCA9PT0gJ2Nsb3NlJykgY2xvc2VTaGVldCgpOwogICAgZWxzZSBpZiAoYWN0ID09PSAnY29udGFjdCcpIGNvbnRhY3RTaGVldChpZCk7CiAgICBlbHNlIGlmIChhY3QgPT09ICduZXctY29udGFjdCcpIGNvbnRhY3RGb3JtKCk7CiAgICBlbHNlIGlmIChhY3QgPT09ICdlZGl0LWNvbnRhY3QnKSBjb250YWN0Rm9ybShpZCk7CiAgICBlbHNlIGlmIChhY3QgPT09ICduZXctb3JkZXInKSBvcmRlckZvcm0oY2lkKTsKICAgIGVsc2UgaWYgKGFjdCA9PT0gJ29yZGVyJykgb3JkZXJGb3JtKG51bGwsIGlkKTsKICAgIGVsc2UgaWYgKGFjdCA9PT0gJ25ldy1kZWFsJykgZGVhbEZvcm0oY2lkKTsKICAgIGVsc2UgaWYgKGFjdCA9PT0gJ2RlYWwnKSBkZWFsRm9ybShudWxsLCBpZCk7CiAgICBlbHNlIGlmIChhY3QgPT09ICduZXctdGFzaycpIHRhc2tGb3JtKGNpZCk7CiAgICBlbHNlIGlmIChhY3QgPT09ICduZXctcHJvZHVjdCcpIHByb2R1Y3RGb3JtKCk7CiAgICBlbHNlIGlmIChhY3QgPT09ICdxdWljaycpIHF1aWNrTWVudSgpOwogICAgZWxzZSBpZiAoYWN0ID09PSAnY2FsLW1vZGUnKSB7IFMuY2FsLm1vZGUgPSBpZDsgcmVuZGVyKCk7IH0KICAgIGVsc2UgaWYgKGFjdCA9PT0gJ2NhbC1uYXYnKSB7IGNvbnN0IG4gPSBOdW1iZXIoYS5kYXRhc2V0LmQpLCBjID0gUy5jYWw7IGlmICghbikgYy5yZWYgPSB5bWQobmV3IERhdGUoKSk7IGVsc2UgaWYgKGMubW9kZSA9PT0gJ3dlZWsnKSBjLnJlZiA9IGFkZERheXMoYy5yZWYsIDcgKiBuKTsgZWxzZSB7IGNvbnN0IHggPSBwYXJzZVltZChjLnJlZik7IHguc2V0RGF0ZSgxKTsgeC5zZXRNb250aCh4LmdldE1vbnRoKCkgKyBuKTsgYy5yZWYgPSB5bWQoeCk7IH0gcmVuZGVyKCk7IH0KICAgIGVsc2UgaWYgKGFjdCA9PT0gJ2NhbC1kYXknKSBkYXlTaGVldChpZCk7CiAgICBlbHNlIGlmIChhY3QgPT09ICduZXctZXZlbnQnKSBldmVudEZvcm0oJycsIGlkKTsKICAgIGVsc2UgaWYgKGFjdCA9PT0gJ2V2ZW50JykgZXZlbnRGb3JtKGlkKTsKICAgIGVsc2UgaWYgKGFjdCA9PT0gJ25ldy10YXNrLWRheScpIHRhc2tGb3JtKCcnLCBpZCk7CiAgICBlbHNlIGlmIChhY3QgPT09ICdzeW5jJykgeyBhLmRpc2FibGVkID0gdHJ1ZTsgYXdhaXQgc3luY01haWwodHJ1ZSk7IGEuZGlzYWJsZWQgPSBmYWxzZTsgfQogICAgZWxzZSBpZiAoYWN0ID09PSAnc2FsZScpIHNhbGVTaGVldCgpOwogICAgZWxzZSBpZiAoYWN0ID09PSAncW5vdGUnKSBub3RlU2hlZXQoY2lkKTsKICAgIGVsc2UgaWYgKGFjdCA9PT0gJ25ldy10YXNrLWFueScpIHRhc2tGb3JtKCcnKTsKICAgIGVsc2UgaWYgKGFjdCA9PT0gJ3F0eScpIHsgY29uc3QgaSA9ICQoJyNzYWxlLScgKyBpZCk7IGkudmFsdWUgPSBNYXRoLm1heCgwLCAoTnVtYmVyKGkudmFsdWUpIHx8IDApICsgTnVtYmVyKGEuZGF0YXNldC5kKSk7IHNhbGVUb3RhbCgpOyB9CiAgICBlbHNlIGlmIChhY3QgPT09ICdsb2dvdXQnKSB7IGF3YWl0IGFwaSgnUE9TVCcsICcvbG9nb3V0Jyk7IGxvY2F0aW9uLnJlbG9hZCgpOyB9CiAgICBlbHNlIGlmIChhY3QgPT09ICdwcm9kdWN0JykgcHJvZHVjdEZvcm0oaWQpOwogICAgZWxzZSBpZiAoYWN0ID09PSAnZG9uZScpIHsgYXdhaXQgYXBpKCdQQVRDSCcsIGAvdGFza3MvJHtpZH1gLCB7IGRvbmU6IGEuY2hlY2tlZCB9KTsgdG9hc3QoJ0RvbmUg4pyTJyk7IGF3YWl0IHJlZnJlc2goKTsgaWYgKGEuZGF0YXNldC5yZW9wZW4pIGNvbnRhY3RTaGVldChhLmRhdGFzZXQucmVvcGVuKTsgaWYgKGEuZGF0YXNldC5kYXkpIGRheVNoZWV0KGEuZGF0YXNldC5kYXkpOyB9CiAgICBlbHNlIGlmIChhY3Quc3RhcnRzV2l0aCgnZGVsLScpKSB7CiAgICAgIGlmICghY29uZmlybSgnRGVsZXRlIHRoaXM/IFRoaXMgY2Fubm90IGJlIHVuZG9uZS4nKSkgcmV0dXJuOwogICAgICBjb25zdCBjb2wgPSB7ICdkZWwtY29udGFjdCc6ICdjb250YWN0cycsICdkZWwtb3JkZXInOiAnb3JkZXJzJywgJ2RlbC1kZWFsJzogJ2RlYWxzJywgJ2RlbC1wcm9kdWN0JzogJ3Byb2R1Y3RzJywgJ2RlbC1ldmVudCc6ICdldmVudHMnIH1bYWN0XTsKICAgICAgYXdhaXQgYXBpKCdERUxFVEUnLCBgLyR7Y29sfS8ke2lkfWApOyBjbG9zZVNoZWV0KCk7IGF3YWl0IHJlZnJlc2goKTsgdG9hc3QoJ0RlbGV0ZWQnKTsKICAgIH0gZWxzZSBpZiAoYWN0ID09PSAnY2xlYXItc2FtcGxlJykgewogICAgICBpZiAoIWNvbmZpcm0oJ1JlbW92ZSBhbGwgc2FtcGxlIGNvbnRhY3RzLCBvcmRlcnMsIGRlYWxzIGFuZCBtZXNzYWdlcz8nKSkgcmV0dXJuOwogICAgICBjb25zdCByID0gYXdhaXQgYXBpKCdQT1NUJywgJy9jbGVhci1zYW1wbGUnKTsgYXdhaXQgcmVmcmVzaCgpOyB0b2FzdChgUmVtb3ZlZCAke3IucmVtb3ZlZENvbnRhY3RzfSBzYW1wbGUgY29udGFjdHNgKTsKICAgIH0KICB9IGNhdGNoIChlcnIpIHsgdG9hc3QoZXJyLm1lc3NhZ2UpOyB9Cn0pOwoKZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignaW5wdXQnLCAoZSkgPT4geyBpZiAoZS50YXJnZXQuaWQgPT09ICdxJykgeyBTLnEgPSBlLnRhcmdldC52YWx1ZTsgY29uc3QgcG9zID0gZS50YXJnZXQuc2VsZWN0aW9uU3RhcnQ7IHJlbmRlcigpOyBjb25zdCBxID0gJCgnI3EnKTsgcS5mb2N1cygpOyBxLnNldFNlbGVjdGlvblJhbmdlKHBvcywgcG9zKTsgfSB9KTsKCmRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ3N1Ym1pdCcsIGFzeW5jIChlKSA9PiB7CiAgZS5wcmV2ZW50RGVmYXVsdCgpOwogIGNvbnN0IGYgPSBlLnRhcmdldCwgdiA9IGZvcm1EYXRhKGYpLCBpZCA9IGYuZGF0YXNldC5pZDsKICB0cnkgewogICAgaWYgKGYuaWQgPT09ICdmLWNvbnRhY3QnKSB7CiAgICAgIGNvbnN0IGJvZHkgPSB7IG5hbWU6IHYubmFtZSwgdHlwZTogdi50eXBlLCBvcmc6IHYub3JnLCBlbWFpbDogdi5lbWFpbCwgcGhvbmU6IHYucGhvbmUsIHNvdXJjZTogdi5zb3VyY2UsIG5vdGVzOiB2Lm5vdGVzLAogICAgICAgIHRhZ3M6IHYudGFncy5zcGxpdCgnLCcpLm1hcCgoeCkgPT4geC50cmltKCkpLmZpbHRlcihCb29sZWFuKSwgaGFuZGxlczogeyBpbnN0YWdyYW06IHYuaW5zdGFncmFtLnJlcGxhY2UoL15ALywgJycpLCBmYWNlYm9vazogdi5mYWNlYm9vayB9LAogICAgICAgIGRvZzogeyBuYW1lOiB2LmRvZ05hbWUsIGJyZWVkOiB2LmRvZ0JyZWVkLCBhbGxlcmdpZXM6IHYuYWxsZXJnaWVzIH0gfTsKICAgICAgaWYgKGlkKSB7IGNvbnN0IG9sZCA9IGJ5SWQoJ2NvbnRhY3RzJywgaWQpOyBib2R5LmV4dCA9IG9sZC5leHQ7IGF3YWl0IGFwaSgnUEFUQ0gnLCBgL2NvbnRhY3RzLyR7aWR9YCwgYm9keSk7IH0gZWxzZSBhd2FpdCBhcGkoJ1BPU1QnLCAnL2NvbnRhY3RzJywgYm9keSk7CiAgICAgIGNsb3NlU2hlZXQoKTsgYXdhaXQgcmVmcmVzaCgpOyB0b2FzdCgnU2F2ZWQnKTsKICAgIH0gZWxzZSBpZiAoZi5pZCA9PT0gJ2Ytb3JkZXInKSB7CiAgICAgIGNvbnN0IGl0ZW1zID0gUy5kLnByb2R1Y3RzLm1hcCgocCkgPT4gKHsgcHJvZHVjdElkOiBwLmlkLCBuYW1lOiBwLm5hbWUsIHF0eTogTnVtYmVyKHZbJ3F0eV8nICsgcC5pZF0pIHx8IDAsIHByaWNlOiB2LmNoYW5uZWwgPT09ICd3aG9sZXNhbGUnID8gcC53aG9sZXNhbGUgOiBwLnByaWNlIH0pKS5maWx0ZXIoKGkpID0+IGkucXR5ID4gMCk7CiAgICAgIGlmICghdi5jb250YWN0SWQpIHJldHVybiB0b2FzdCgnQ2hvb3NlIGEgY3VzdG9tZXInKTsKICAgICAgY29uc3QgYm9keSA9IHsgY29udGFjdElkOiB2LmNvbnRhY3RJZCwgY2hhbm5lbDogdi5jaGFubmVsLCBzdGF0dXM6IHYuc3RhdHVzLCBkYXRlOiB2LmRhdGUsIG5vdGVzOiB2Lm5vdGVzLCBpdGVtcyB9OwogICAgICBpZiAoaWQpIHsgYm9keS50b3RhbCA9IE51bWJlcih2LnRvdGFsKSB8fCBpdGVtcy5yZWR1Y2UoKHMsIGkpID0+IHMgKyBpLnF0eSAqIGkucHJpY2UsIDApOyBhd2FpdCBhcGkoJ1BBVENIJywgYC9vcmRlcnMvJHtpZH1gLCBib2R5KTsgfSBlbHNlIGF3YWl0IGFwaSgnUE9TVCcsICcvb3JkZXJzJywgYm9keSk7CiAgICAgIGNsb3NlU2hlZXQoKTsgYXdhaXQgcmVmcmVzaCgpOyB0b2FzdCgnT3JkZXIgc2F2ZWQnKTsKICAgIH0gZWxzZSBpZiAoZi5pZCA9PT0gJ2YtZGVhbCcpIHsKICAgICAgaWYgKCF2LmNvbnRhY3RJZCkgcmV0dXJuIHRvYXN0KCdDaG9vc2UgYSBjb250YWN0Jyk7CiAgICAgIGlmIChpZCkgYXdhaXQgYXBpKCdQQVRDSCcsIGAvZGVhbHMvJHtpZH1gLCB2KTsgZWxzZSBhd2FpdCBhcGkoJ1BPU1QnLCAnL2RlYWxzJywgdik7CiAgICAgIGNsb3NlU2hlZXQoKTsgYXdhaXQgcmVmcmVzaCgpOyB0b2FzdCgnRGVhbCBzYXZlZCcpOwogICAgfSBlbHNlIGlmIChmLmlkID09PSAnZi10YXNrJykgewogICAgICBhd2FpdCBhcGkoJ1BPU1QnLCAnL3Rhc2tzJywgeyB0aXRsZTogdi50aXRsZSwgZHVlOiB2LmR1ZSwgY29udGFjdElkOiBmLmRhdGFzZXQuY2lkIH0pOwogICAgICBjbG9zZVNoZWV0KCk7IGF3YWl0IHJlZnJlc2goKTsgdG9hc3QoJ1Rhc2sgYWRkZWQnKTsKICAgIH0gZWxzZSBpZiAoZi5pZCA9PT0gJ2YtZXZlbnQnKSB7CiAgICAgIGNvbnN0IGJvZHkgPSB7IHRpdGxlOiB2LnRpdGxlLCB0eXBlOiB2LnR5cGUsIGRhdGU6IHYuZGF0ZSwgdGltZTogdi50aW1lLCBjb250YWN0SWQ6IHYuY29udGFjdElkLCBub3Rlczogdi5ub3RlcyB9OwogICAgICBpZiAoaWQpIGF3YWl0IGFwaSgnUEFUQ0gnLCBgL2V2ZW50cy8ke2lkfWAsIGJvZHkpOyBlbHNlIGF3YWl0IGFwaSgnUE9TVCcsICcvZXZlbnRzJywgYm9keSk7CiAgICAgIFMuY2FsLnJlZiA9IHYuZGF0ZTsgY2xvc2VTaGVldCgpOyBhd2FpdCByZWZyZXNoKCk7IHRvYXN0KCdTYXZlZCcpOwogICAgfSBlbHNlIGlmIChmLmlkID09PSAnZi1wcm9kdWN0JykgewogICAgICBpZiAoaWQpIGF3YWl0IGFwaSgnUEFUQ0gnLCBgL3Byb2R1Y3RzLyR7aWR9YCwgdik7IGVsc2UgYXdhaXQgYXBpKCdQT1NUJywgJy9wcm9kdWN0cycsIHYpOwogICAgICBjbG9zZVNoZWV0KCk7IGF3YWl0IHJlZnJlc2goKTsgdG9hc3QoJ1NhdmVkJyk7CiAgICB9IGVsc2UgaWYgKGYuaWQgPT09ICdmLXNhbGUnKSB7CiAgICAgIGNvbnN0IGl0ZW1zID0gUy5kLnByb2R1Y3RzLm1hcCgocCkgPT4gKHsgcHJvZHVjdElkOiBwLmlkLCBuYW1lOiBwLm5hbWUsIHF0eTogTnVtYmVyKHZbJ3FfJyArIHAuaWRdKSB8fCAwLCBwcmljZTogcC5wcmljZSB9KSkuZmlsdGVyKChpKSA9PiBpLnF0eSA+IDApOwogICAgICBpZiAoIWl0ZW1zLmxlbmd0aCkgcmV0dXJuIHRvYXN0KCdUYXAgKyBvbiBhIHByb2R1Y3QnKTsKICAgICAgbGV0IGNpZCA9IHYuY29udGFjdElkOwogICAgICBpZiAoIWNpZCkgeyBsZXQgdyA9IFMuZC5jb250YWN0cy5maW5kKChjKSA9PiBjLnRhZ3M/LmluY2x1ZGVzKCd3YWxrLWluJykpOyBpZiAoIXcpIHcgPSBhd2FpdCBhcGkoJ1BPU1QnLCAnL2NvbnRhY3RzJywgeyBuYW1lOiAnV2Fsay1pbiAobWFya2V0KScsIHR5cGU6ICdjdXN0b21lcicsIHRhZ3M6IFsnd2Fsay1pbiddIH0pOyBjaWQgPSB3LmlkOyB9CiAgICAgIGNvbnN0IHRvdGFsID0gaXRlbXMucmVkdWNlKChzLCBpKSA9PiBzICsgaS5xdHkgKiBpLnByaWNlLCAwKTsKICAgICAgYXdhaXQgYXBpKCdQT1NUJywgJy9vcmRlcnMnLCB7IGNvbnRhY3RJZDogY2lkLCBjaGFubmVsOiB2LmNoYW5uZWwsIHN0YXR1czogJ3BhaWQnLCBpdGVtcywgdG90YWwgfSk7CiAgICAgIGNsb3NlU2hlZXQoKTsgYXdhaXQgcmVmcmVzaCgpOyB0b2FzdChgU2FsZSBzYXZlZCAke21vbmV5KHRvdGFsKX0g4pyTYCk7CiAgICB9IGVsc2UgaWYgKGYuaWQgPT09ICdmLXFub3RlJykgewogICAgICBpZiAoIXYuY29udGFjdElkIHx8ICF2LmJvZHkudHJpbSgpKSByZXR1cm4gdG9hc3QoJ1BpY2sgYSBjb250YWN0IGFuZCB3cml0ZSBhIG5vdGUnKTsKICAgICAgYXdhaXQgYXBpKCdQT1NUJywgJy9tZXNzYWdlcy9zZW5kJywgeyBjb250YWN0SWQ6IHYuY29udGFjdElkLCBjaGFubmVsOiB2LmNoYW5uZWwsIGJvZHk6IHYuYm9keSB9KTsKICAgICAgY2xvc2VTaGVldCgpOyBhd2FpdCByZWZyZXNoKCk7IHRvYXN0KCdMb2dnZWQg4pyTJyk7CiAgICB9IGVsc2UgaWYgKGYuaWQgPT09ICdjb21wb3NlcicpIHsKICAgICAgaWYgKCF2LmJvZHkudHJpbSgpKSByZXR1cm47CiAgICAgIGNvbnN0IHIgPSBhd2FpdCBhcGkoJ1BPU1QnLCAnL21lc3NhZ2VzL3NlbmQnLCB7IGNvbnRhY3RJZDogaWQsIGNoYW5uZWw6IHYuY2hhbm5lbCwgc3ViamVjdDogdi5zdWJqZWN0LCBib2R5OiB2LmJvZHkgfSk7CiAgICAgIGF3YWl0IHJlZnJlc2goKTsgY29udGFjdFNoZWV0KGlkKTsKICAgICAgdG9hc3Qoci5zdGF0dXMgPT09ICdkcmFmdCcgPyAnU2F2ZWQgYXMgZHJhZnQgKGNoYW5uZWwgbm90IGNvbm5lY3RlZCknIDogci5zdGF0dXMgPT09ICdmYWlsZWQnID8gJ0ZhaWxlZDogJyArIHIuZXJyb3IgOiByLnN0YXR1cyA9PT0gJ2xvZ2dlZCcgPyAnTG9nZ2VkJyA6ICdTZW50IOKckycpOwogICAgfQogIH0gY2F0Y2ggKGVycikgeyB0b2FzdChlcnIubWVzc2FnZSk7IH0KfSk7Cgpsb2FkKCkudGhlbigoKSA9PiB7IHJlbmRlcigpOyBoYW5kbGVIYXNoKCk7IH0pLmNhdGNoKChlKSA9PiB7IGlmIChlLm1lc3NhZ2UgIT09ICdMb2dpbiByZXF1aXJlZCcpICQoJyNtYWluJykuaW5uZXJIVE1MID0gYDxkaXYgY2xhc3M9Indhcm4iPkNvdWxkIG5vdCBsb2FkIGRhdGE6ICR7ZXNjKGUubWVzc2FnZSl9PC9kaXY+YDsgfSk7CmlmICgnc2VydmljZVdvcmtlcicgaW4gbmF2aWdhdG9yKSBuYXZpZ2F0b3Iuc2VydmljZVdvcmtlci5yZWdpc3RlcignL3N3LmpzJykuY2F0Y2goKCkgPT4ge30pOwpzZXRJbnRlcnZhbCgoKSA9PiB7IGlmICgkKCcjc2hlZXQnKS5oaWRkZW4gJiYgIWRvY3VtZW50LmFjdGl2ZUVsZW1lbnQ/Lm1hdGNoZXMoJ2lucHV0LHRleHRhcmVhLHNlbGVjdCcpKSByZWZyZXNoKCkuY2F0Y2goKCkgPT4ge30pOyB9LCAzMDAwMCk7Cg==", "/apple-touch-icon.png": "iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAIAAACyr5FlAAAWfmNhQlgAABZ+anVtYgAAAB5qdW1kYzJwYQARABCAAACqADibcQNjMnBhAAAAFlhqdW1iAAAAR2p1bWRjMm1hABEAEIAAAKoAOJtxA3VybjpjMnBhOjZlZGE3YWY2LWU2NDYtNDcyMi1hODdlLTA5MTdjMGEzMzQwOQAAAAOTanVtYgAAAClqdW1kYzJhcwARABCAAACqADibcQNjMnBhLmFzc2VydGlvbnMAAAAAuGp1bWIAAABEanVtZGNib3IAEQAQgAAAqgA4m3ETYzJwYS5pbmdyZWRpZW50LnYzAAAAABhjMnNoAWxYFVZaaMiHlk8f2Y0sqAAAAGxjYm9yo2lkYzpmb3JtYXRpaW1hZ2UvcG5namluc3RhbmNlSUR4LHhtcDppaWQ6MjRjODk0MTAtN2M5NS00YTFhLTg4MjktZTYyZjA5MjQxNzllbHJlbGF0aW9uc2hpcGhwYXJlbnRPZgAAAeJqdW1iAAAAQWp1bWRjYm9yABEAEIAAAKoAOJtxE2MycGEuYWN0aW9ucy52MgAAAAAYYzJzaOnrIKKsGO8+gb1CfLW7DzIAAAGZY2JvcqJnYWN0aW9uc4KiZmFjdGlvbmtjMnBhLm9wZW5lZGpwYXJhbWV0ZXJzoWtpbmdyZWRpZW50c4GiY3VybHgtc2VsZiNqdW1iZj1jMnBhLmFzc2VydGlvbnMvYzJwYS5pbmdyZWRpZW50LnYzZGhhc2hYIMAX2U0WLtoEZenUvECuuPeyXga5w/wDFcYon2h6arLnpGZhY3Rpb254HWNvbS5hbnRocm9waWMuY2xhdWRlLnByb3ZpZGVkanBhcmFtZXRlcnOheB9jb20uYW50aHJvcGljLm9yaWdpbi1jb25maWRlbmNlZ3Vua25vd25rZGVzY3JpcHRpb254ZkNsYXVkZSBwcm92aWRlZCB0aGlzIGZpbGUgYXQgdGhlIHJlcXVlc3Qgb2YgYSB1c2VyIGFuZCBtYXkgaGF2ZSBjcmVhdGVkIG9yIG1vZGlmaWVkIHRoZSBmaWxlIGNvbnRlbnRzLm1zb2Z0d2FyZUFnZW50oWRuYW1lZkNsYXVkZXJhbGxBY3Rpb25zSW5jbHVkZWT1AAAAyGp1bWIAAABAanVtZGNib3IAEQAQgAAAqgA4m3ETYzJwYS5oYXNoLmRhdGEAAAAAGGMyc2gXKKUZnIfTwoxh7ZVb/qmTAAAAgGNib3KlY2FsZ2ZzaGEyNTZjcGFkTQAAAAAAAAAAAAAAAABkaGFzaFgggZ03dK0bttxg5zj7CoVI2K5vY4jr6YOBBNeMsW6edopkbmFtZW5qdW1iZiBtYW5pZmVzdGpleGNsdXNpb25zgaJlc3RhcnQYIWZsZW5ndGgZFooAAAI+anVtYgAAACdqdW1kYzJjbAARABCAAACqADibcQNjMnBhLmNsYWltLnYyAAAAAg9jYm9ypWNhbGdmc2hhMjU2aXNpZ25hdHVyZXhNc2VsZiNqdW1iZj0vYzJwYS91cm46YzJwYTo2ZWRhN2FmNi1lNjQ2LTQ3MjItYTg3ZS0wOTE3YzBhMzM0MDkvYzJwYS5zaWduYXR1cmVqaW5zdGFuY2VJRHgseG1wOmlpZDozZjAyZjFiYi1iOTlhLTQwNmQtOGRiNS01MWY4MmIzNTIyM2NyY3JlYXRlZF9hc3NlcnRpb25zg6JjdXJseC1zZWxmI2p1bWJmPWMycGEuYXNzZXJ0aW9ucy9jMnBhLmluZ3JlZGllbnQudjNkaGFzaFggwBfZTRYu2gRl6dS8QK6497JeBrnD/AMVxiifaHpqsueiY3VybHgqc2VsZiNqdW1iZj1jMnBhLmFzc2VydGlvbnMvYzJwYS5hY3Rpb25zLnYyZGhhc2hYIKlu/Cy7thJj2lFgOLHXruQV6p4wj31wHXlgrZAQQmWsomN1cmx4KXNlbGYjanVtYmY9YzJwYS5hc3NlcnRpb25zL2MycGEuaGFzaC5kYXRhZGhhc2hYIAogxReBYctaTCJ1NuqM/jV9+uGU6Yjp8AScpj3wvQBtdGNsYWltX2dlbmVyYXRvcl9pbmZvo2RuYW1lb0FudGhyb3BpYyBGaWxlc2d2ZXJzaW9uZTEuMC4wa3NwZWNWZXJzaW9uZTIuNC4wAAAQOGp1bWIAAAAoanVtZGMyY3MAEQAQgAAAqgA4m3EDYzJwYS5zaWduYXR1cmUAAAAQCGNib3LShFkCEqIBJhghWQIKMIICBjCCAY2gAwIBAgIUQOWgCu7COdC+uIP6BkIFPWdVEwAwCgYIKoZIzj0EAwMwSTEXMBUGA1UEChMOQW50aHJvcGljLCBQQkMxLjAsBgNVBAMTJUFudGhyb3BpYyBDb250ZW50IENyZWRlbnRpYWxzIFJvb3QgQ0EwHhcNMjYwODA3MTg0MzU2WhcNMjgwODA2MTk0MzU2WjBEMRcwFQYDVQQKEw5BbnRocm9waWMsIFBCQzEpMCcGA1UEAxMgQW50aHJvcGljIENsYXVkZSBDb250ZW50IFNpZ25pbmcwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASYegpry1AYBRTVNL1CpTlbROnY3dey+UrsF9C3phYrATN3ZHf93Mo8RQN0KOUuOn19P4oWNFWe5n2/She9N7eTo1gwVjAOBgNVHQ8BAf8EBAMCB4AwFQYDVR0lBA4wDAYKKwYBBAGD6F4CATAMBgNVHRMBAf8EAjAAMB8GA1UdIwQYMBaAFM5R4gSBTmRbI/jjxM+aPpzB11zCMAoGCCqGSM49BAMDA2cAMGQCMDFzHRSeAXrSy1WOzkbhPZ6Km2wGTmZ/2gK18k8BQGXyqz88Rdrz6CTX9flAnYNVxgIwcF9c3fVhqmJKpi+UhasNUMko69cyX6STPfta3Q8EjyzDjzoyrol46FP6VFHhvUcJoWNwYWRZDZ4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2WEBvgzBiHo7eIjnhrypz1t6vefpsQ+JoilN+YEtZ9nmvzFSAkFdL/FKtOj9C86C9WxMM5Kjh78ZVHS1vHsml19Y49q9+4AAABLZJREFUeJzt3cFx2zAURVE6k26y8jZr9+ISXEN6Sg9pKQvOcDS0ngSSHx//QfcskzEBgpeULFnU26/fnwtwz4/RE0BdxAGJOCARByTigEQckIgDEnFAIg5IxAGJOCARByTigEQckIgDEnFAIg5IxAGJOCARByTigEQckIgD0s/RE4j07++fu//+/vFlPdYob3N8qEkdqltRhy1zrLHs42g5VLeuHLbMsSowjuPoobp19LBljlWH6xPSK0fr6I9njlWKZRwhy924kcyxqvGLI3Chn24qc6yCzOIIX+IHG8wcqyazOJDJKY5OZ97dzWaOVZZTHEhmE0fXc2638cyxKrOJA/k84kg427YhMscqziMODEEckIgDksG7si6P0EfVf7eWKwck4oBEHJCIAxJxQCIOSMQBiTggGcSR9mLR+8dX5lg5A11hEAdGIQ5IxAHJI46ER+htiMyxivOIA0PkvWV/9533Q+dQv/fuv08jc6wHri/aFd1v3vJ4lbf/dbnS5iiyaH0fVtrPv4F3RLm72cyxdmIX7YpeV44T815/5JUvIdUWrcuV40rRj382fBUebDBzrKXnop0WH8f1iab18XRTaWP1XrRzguOImmJCH40bSRgrZ9FOcH2d4+IxO/TjmWOVEvk6R3i5sc/t27eZOdaQRWsUFken50SNu2p6H9Kxi/bUJHcwXpcj567CmWONFXPl6PpqzEzLfav+ork+IUUC4oBEHJAC4uj99s+Un7K3WDSuHJCIAxJxQCIOSMQBiTggEQck4oAUEEfvN8amfOPNYtG4ckAiDkjEASkmjn6PoFM+4VjVXzSuHJDC4uhxHkx82VgVX7TgWzAE/plCQhkDP719dBqNYmc7yV+fNzr9SeXN9BezW/E3bwk5D2KPQY8/uyo4w/Bwu9zZ5+KuBu5k77/GqzPVHpe0Xrd9Or2rmZ9LizJ8zp0e7PreE+zQ3g5f4ouGzL/rc6C+r3O0T929jMCh8xdNcbqb4IntD9F7p9J+YzL4dsgWdcpYzfEb7wwvn1crYyk5pRPs4yh7GMpOrJ13HMUPQPHpPWUch8XSW0xScY3DaNGNprpjGYfdcttNeOUXh+lCO07bLw6kMYvD8fzb2E3eLA5kcorD7sz7zmsXnOJAMps4vM65B4x2xCYO5POIw+hsa+GyOx5xYAjigEQckAzicHmEPsRipwziwCjEAYk4IBEHJOKARByQiAMScUAiDkjEAckgjjk+sb5jsVMGcWAU4oBEHJA84rB4hG7nsjsecWAImzhczranjHbEJg7kc4rD6JxTvHbBKQ4kM4vD68zbsZu8WRzI5BeH3fm3cpy2XxyL4ULbTXhlGcditdxGU91xjWMxWXSLSSrGcSzll7749J7yjmMpfADKTqydfRxLycNQcEonzBDHUuxglJrMFZN8U9Nm7K0NpsliNcmVYzPw8ExWxjLflWPj+L2y1Uwbx8roG6kLmjyOVf3vsq/pJeLYXK/kFZrYvFYcOy2tvFQNOy8dBx6b7VdZBCIOSMQBiTggEQck4oBEHJCIAxJxQCIOSMQBiTggEQck4oBEHJCIAxJxQCIOSMQBiTggEQck4oBEHJCIAxJxQCIOSMQB6T9Hc6Ej7iqgDgAAAABJRU5ErkJggg==", "/icon-192.png": "iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAIAAADdvvtQAAAWfmNhQlgAABZ+anVtYgAAAB5qdW1kYzJwYQARABCAAACqADibcQNjMnBhAAAAFlhqdW1iAAAAR2p1bWRjMm1hABEAEIAAAKoAOJtxA3VybjpjMnBhOjE2MjRjN2I5LWU5NDMtNDVhZC1iZGVmLWYwMWRiYzNiODFlZgAAAAOTanVtYgAAAClqdW1kYzJhcwARABCAAACqADibcQNjMnBhLmFzc2VydGlvbnMAAAAAuGp1bWIAAABEanVtZGNib3IAEQAQgAAAqgA4m3ETYzJwYS5pbmdyZWRpZW50LnYzAAAAABhjMnNoho8irsT7CbwCl+Elv/PqowAAAGxjYm9yo2lkYzpmb3JtYXRpaW1hZ2UvcG5namluc3RhbmNlSUR4LHhtcDppaWQ6YWJkMmIyODEtMWViMy00NTU0LTgzNzQtZjhmZTFkYWI5NjIybHJlbGF0aW9uc2hpcGhwYXJlbnRPZgAAAeJqdW1iAAAAQWp1bWRjYm9yABEAEIAAAKoAOJtxE2MycGEuYWN0aW9ucy52MgAAAAAYYzJzaOgJCnaUyYvl19l5y81VE/kAAAGZY2JvcqJnYWN0aW9uc4KiZmFjdGlvbmtjMnBhLm9wZW5lZGpwYXJhbWV0ZXJzoWtpbmdyZWRpZW50c4GiY3VybHgtc2VsZiNqdW1iZj1jMnBhLmFzc2VydGlvbnMvYzJwYS5pbmdyZWRpZW50LnYzZGhhc2hYIF5ut3EoQqpqhD5rThef+w6qs45eQ1a4e+y09miVvZEmpGZhY3Rpb254HWNvbS5hbnRocm9waWMuY2xhdWRlLnByb3ZpZGVkanBhcmFtZXRlcnOheB9jb20uYW50aHJvcGljLm9yaWdpbi1jb25maWRlbmNlZ3Vua25vd25rZGVzY3JpcHRpb254ZkNsYXVkZSBwcm92aWRlZCB0aGlzIGZpbGUgYXQgdGhlIHJlcXVlc3Qgb2YgYSB1c2VyIGFuZCBtYXkgaGF2ZSBjcmVhdGVkIG9yIG1vZGlmaWVkIHRoZSBmaWxlIGNvbnRlbnRzLm1zb2Z0d2FyZUFnZW50oWRuYW1lZkNsYXVkZXJhbGxBY3Rpb25zSW5jbHVkZWT1AAAAyGp1bWIAAABAanVtZGNib3IAEQAQgAAAqgA4m3ETYzJwYS5oYXNoLmRhdGEAAAAAGGMyc2iIb+7LhqOJhvlZguxNJOHZAAAAgGNib3KlY2FsZ2ZzaGEyNTZjcGFkTQAAAAAAAAAAAAAAAABkaGFzaFggRBfOkkqM9z7pWab8RPE0tW35WMUSz3QH1wfC6jrGHOxkbmFtZW5qdW1iZiBtYW5pZmVzdGpleGNsdXNpb25zgaJlc3RhcnQYIWZsZW5ndGgZFooAAAI+anVtYgAAACdqdW1kYzJjbAARABCAAACqADibcQNjMnBhLmNsYWltLnYyAAAAAg9jYm9ypWNhbGdmc2hhMjU2aXNpZ25hdHVyZXhNc2VsZiNqdW1iZj0vYzJwYS91cm46YzJwYToxNjI0YzdiOS1lOTQzLTQ1YWQtYmRlZi1mMDFkYmMzYjgxZWYvYzJwYS5zaWduYXR1cmVqaW5zdGFuY2VJRHgseG1wOmlpZDoyNWEzNjk2Yi1iOTMxLTQyNjQtYjFlMi05MjI5OGQ0ZTVhOTByY3JlYXRlZF9hc3NlcnRpb25zg6JjdXJseC1zZWxmI2p1bWJmPWMycGEuYXNzZXJ0aW9ucy9jMnBhLmluZ3JlZGllbnQudjNkaGFzaFggXm63cShCqmqEPmtOF5/7Dqqzjl5DVrh77LT2aJW9kSaiY3VybHgqc2VsZiNqdW1iZj1jMnBhLmFzc2VydGlvbnMvYzJwYS5hY3Rpb25zLnYyZGhhc2hYINA5TekFEip1I3Zlo8R/atBZqsXNuAA6/+FC4ft2Oy7homN1cmx4KXNlbGYjanVtYmY9YzJwYS5hc3NlcnRpb25zL2MycGEuaGFzaC5kYXRhZGhhc2hYINGmnI1/ofGX02LaHX+VHUqCEK1JeMIzm4OGm4Sg+0czdGNsYWltX2dlbmVyYXRvcl9pbmZvo2RuYW1lb0FudGhyb3BpYyBGaWxlc2d2ZXJzaW9uZTEuMC4wa3NwZWNWZXJzaW9uZTIuNC4wAAAQOGp1bWIAAAAoanVtZGMyY3MAEQAQgAAAqgA4m3EDYzJwYS5zaWduYXR1cmUAAAAQCGNib3LShFkCEqIBJhghWQIKMIICBjCCAY2gAwIBAgIUQOWgCu7COdC+uIP6BkIFPWdVEwAwCgYIKoZIzj0EAwMwSTEXMBUGA1UEChMOQW50aHJvcGljLCBQQkMxLjAsBgNVBAMTJUFudGhyb3BpYyBDb250ZW50IENyZWRlbnRpYWxzIFJvb3QgQ0EwHhcNMjYwODA3MTg0MzU2WhcNMjgwODA2MTk0MzU2WjBEMRcwFQYDVQQKEw5BbnRocm9waWMsIFBCQzEpMCcGA1UEAxMgQW50aHJvcGljIENsYXVkZSBDb250ZW50IFNpZ25pbmcwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASYegpry1AYBRTVNL1CpTlbROnY3dey+UrsF9C3phYrATN3ZHf93Mo8RQN0KOUuOn19P4oWNFWe5n2/She9N7eTo1gwVjAOBgNVHQ8BAf8EBAMCB4AwFQYDVR0lBA4wDAYKKwYBBAGD6F4CATAMBgNVHRMBAf8EAjAAMB8GA1UdIwQYMBaAFM5R4gSBTmRbI/jjxM+aPpzB11zCMAoGCCqGSM49BAMDA2cAMGQCMDFzHRSeAXrSy1WOzkbhPZ6Km2wGTmZ/2gK18k8BQGXyqz88Rdrz6CTX9flAnYNVxgIwcF9c3fVhqmJKpi+UhasNUMko69cyX6STPfta3Q8EjyzDjzoyrol46FP6VFHhvUcJoWNwYWRZDZ4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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", "/icon-512.png": "iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAIAAAB7GkOtAAAWfmNhQlgAABZ+anVtYgAAAB5qdW1kYzJwYQARABCAAACqADibcQNjMnBhAAAAFlhqdW1iAAAAR2p1bWRjMm1hABEAEIAAAKoAOJtxA3VybjpjMnBhOjE0OTUwNjBiLWYyOTgtNDhlNi1iZWFlLWU4ZDQxZjM4ZDBmYQAAAAOTanVtYgAAAClqdW1kYzJhcwARABCAAACqADibcQNjMnBhLmFzc2VydGlvbnMAAAAAuGp1bWIAAABEanVtZGNib3IAEQAQgAAAqgA4m3ETYzJwYS5pbmdyZWRpZW50LnYzAAAAABhjMnNobhRO/wbk+R7GaKwu3SmFNAAAAGxjYm9yo2lkYzpmb3JtYXRpaW1hZ2UvcG5namluc3RhbmNlSUR4LHhtcDppaWQ6Yjk2MGQ3ZWYtMjg3ZS00OTU5LWFiNzQtNzBkZWZjYTA4MWU3bHJlbGF0aW9uc2hpcGhwYXJlbnRPZgAAAeJqdW1iAAAAQWp1bWRjYm9yABEAEIAAAKoAOJtxE2MycGEuYWN0aW9ucy52MgAAAAAYYzJzaNrzqRJ6lLbu0+q/ojDQX8cAAAGZY2JvcqJnYWN0aW9uc4KiZmFjdGlvbmtjMnBhLm9wZW5lZGpwYXJhbWV0ZXJzoWtpbmdyZWRpZW50c4GiY3VybHgtc2VsZiNqdW1iZj1jMnBhLmFzc2VydGlvbnMvYzJwYS5pbmdyZWRpZW50LnYzZGhhc2hYIGPfKF24636iDzzXw7F05OsXGqAqSr8ST9JzyQYDh4aTpGZhY3Rpb254HWNvbS5hbnRocm9waWMuY2xhdWRlLnByb3ZpZGVkanBhcmFtZXRlcnOheB9jb20uYW50aHJvcGljLm9yaWdpbi1jb25maWRlbmNlZ3Vua25vd25rZGVzY3JpcHRpb254ZkNsYXVkZSBwcm92aWRlZCB0aGlzIGZpbGUgYXQgdGhlIHJlcXVlc3Qgb2YgYSB1c2VyIGFuZCBtYXkgaGF2ZSBjcmVhdGVkIG9yIG1vZGlmaWVkIHRoZSBmaWxlIGNvbnRlbnRzLm1zb2Z0d2FyZUFnZW50oWRuYW1lZkNsYXVkZXJhbGxBY3Rpb25zSW5jbHVkZWT1AAAAyGp1bWIAAABAanVtZGNib3IAEQAQgAAAqgA4m3ETYzJwYS5oYXNoLmRhdGEAAAAAGGMyc2h1P63XRTD6J/9TZGaBkUUWAAAAgGNib3KlY2FsZ2ZzaGEyNTZjcGFkTQAAAAAAAAAAAAAAAABkaGFzaFggmzDUzyWGeo13uCv/nfJZ7FssbAuCpOtL+Bs0UX6wSbdkbmFtZW5qdW1iZiBtYW5pZmVzdGpleGNsdXNpb25zgaJlc3RhcnQYIWZsZW5ndGgZFooAAAI+anVtYgAAACdqdW1kYzJjbAARABCAAACqADibcQNjMnBhLmNsYWltLnYyAAAAAg9jYm9ypWNhbGdmc2hhMjU2aXNpZ25hdHVyZXhNc2VsZiNqdW1iZj0vYzJwYS91cm46YzJwYToxNDk1MDYwYi1mMjk4LTQ4ZTYtYmVhZS1lOGQ0MWYzOGQwZmEvYzJwYS5zaWduYXR1cmVqaW5zdGFuY2VJRHgseG1wOmlpZDpmMjA1MDQ3MS0xYjg1LTQ4NDQtOGYxNS03OTI3ZjAxNDFhMzVyY3JlYXRlZF9hc3NlcnRpb25zg6JjdXJseC1zZWxmI2p1bWJmPWMycGEuYXNzZXJ0aW9ucy9jMnBhLmluZ3JlZGllbnQudjNkaGFzaFggY98oXbjrfqIPPNfDsXTk6xcaoCpKvxJP0nPJBgOHhpOiY3VybHgqc2VsZiNqdW1iZj1jMnBhLmFzc2VydGlvbnMvYzJwYS5hY3Rpb25zLnYyZGhhc2hYIHaJ8MiEOb8wTxf58CVj5lz8Z84KZxHWss+u1kjTiImpomN1cmx4KXNlbGYjanVtYmY9YzJwYS5hc3NlcnRpb25zL2MycGEuaGFzaC5kYXRhZGhhc2hYIFYKFtVINmnToV+J7PU7eWcHNXRDPaU7VUq9bT1qgYdXdGNsYWltX2dlbmVyYXRvcl9pbmZvo2RuYW1lb0FudGhyb3BpYyBGaWxlc2d2ZXJzaW9uZTEuMC4wa3NwZWNWZXJzaW9uZTIuNC4wAAAQOGp1bWIAAAAoanVtZGMyY3MAEQAQgAAAqgA4m3EDYzJwYS5zaWduYXR1cmUAAAAQCGNib3LShFkCEqIBJhghWQIKMIICBjCCAY2gAwIBAgIUQOWgCu7COdC+uIP6BkIFPWdVEwAwCgYIKoZIzj0EAwMwSTEXMBUGA1UEChMOQW50aHJvcGljLCBQQkMxLjAsBgNVBAMTJUFudGhyb3BpYyBDb250ZW50IENyZWRlbnRpYWxzIFJvb3QgQ0EwHhcNMjYwODA3MTg0MzU2WhcNMjgwODA2MTk0MzU2WjBEMRcwFQYDVQQKEw5BbnRocm9waWMsIFBCQzEpMCcGA1UEAxMgQW50aHJvcGljIENsYXVkZSBDb250ZW50IFNpZ25pbmcwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASYegpry1AYBRTVNL1CpTlbROnY3dey+UrsF9C3phYrATN3ZHf93Mo8RQN0KOUuOn19P4oWNFWe5n2/She9N7eTo1gwVjAOBgNVHQ8BAf8EBAMCB4AwFQYDVR0lBA4wDAYKKwYBBAGD6F4CATAMBgNVHRMBAf8EAjAAMB8GA1UdIwQYMBaAFM5R4gSBTmRbI/jjxM+aPpzB11zCMAoGCCqGSM49BAMDA2cAMGQCMDFzHRSeAXrSy1WOzkbhPZ6Km2wGTmZ/2gK18k8BQGXyqz88Rdrz6CTX9flAnYNVxgIwcF9c3fVhqmJKpi+UhasNUMko69cyX6STPfta3Q8EjyzDjzoyrol46FP6VFHhvUcJoWNwYWRZDZ4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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", "/index.html": "PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImVuIj4KPGhlYWQ+CjxtZXRhIGNoYXJzZXQ9InV0Zi04Ij4KPG1ldGEgbmFtZT0idmlld3BvcnQiIGNvbnRlbnQ9IndpZHRoPWRldmljZS13aWR0aCxpbml0aWFsLXNjYWxlPTEsdmlld3BvcnQtZml0PWNvdmVyIj4KPHRpdGxlPlB1cmVseSBQRUkgQ1JNPC90aXRsZT4KPG1ldGEgbmFtZT0idGhlbWUtY29sb3IiIGNvbnRlbnQ9IiMyYjNhNjciPgo8bGluayByZWw9Im1hbmlmZXN0IiBocmVmPSIvbWFuaWZlc3Qud2VibWFuaWZlc3QiPgo8bGluayByZWw9Imljb24iIGhyZWY9Ii9pY29uLTE5Mi5wbmciPgo8bGluayByZWw9ImFwcGxlLXRvdWNoLWljb24iIGhyZWY9Ii9hcHBsZS10b3VjaC1pY29uLnBuZyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9Im1vYmlsZS13ZWItYXBwLWNhcGFibGUiIGNvbnRlbnQ9InllcyI+CjxtZXRhIG5hbWU9ImFwcGxlLW1vYmlsZS13ZWItYXBwLXRpdGxlIiBjb250ZW50PSJQdXJlbHkgUEVJIj4KPG1ldGEgbmFtZT0iYXBwbGUtbW9iaWxlLXdlYi1hcHAtc3RhdHVzLWJhci1zdHlsZSIgY29udGVudD0iZGVmYXVsdCI+CjxsaW5rIHJlbD0ic3R5bGVzaGVldCIgaHJlZj0ic3R5bGUuY3NzIj4KPC9oZWFkPgo8Ym9keT4KPGRpdiBpZD0iYXBwIj4KICA8YXNpZGUgaWQ9InNpZGUiPgogICAgPGRpdiBjbGFzcz0iYnJhbmQiPjxzcGFuIGNsYXNzPSJwYXciPvCfkL48L3NwYW4+PGRpdj48Yj5QdXJlbHkgUEVJPC9iPjxzbWFsbD5DUk08L3NtYWxsPjwvZGl2PjwvZGl2PgogICAgPG5hdiBpZD0ibmF2Ij48L25hdj4KICA8L2FzaWRlPgogIDxtYWluIGlkPSJtYWluIj48L21haW4+CjwvZGl2Pgo8bmF2IGlkPSJ0YWJzIj48L25hdj4KPGJ1dHRvbiBpZD0iZmFiIiBkYXRhLWFjdD0icXVpY2siIGFyaWEtbGFiZWw9IlF1aWNrIGFjdGlvbnMiPis8L2J1dHRvbj4KPGRpdiBpZD0ic2hlZXQiIGhpZGRlbj48ZGl2IGNsYXNzPSJzY3JpbSI+PC9kaXY+PGRpdiBjbGFzcz0icGFuZWwiIHJvbGU9ImRpYWxvZyIgYXJpYS1tb2RhbD0idHJ1ZSI+PC9kaXY+PC9kaXY+CjxkaXYgaWQ9InRvYXN0IiBoaWRkZW4+PC9kaXY+CjxzY3JpcHQgc3JjPSJhcHAuanMiIHR5cGU9Im1vZHVsZSI+PC9zY3JpcHQ+CjwvYm9keT4KPC9odG1sPgo=", "/manifest.webmanifest": "ewogICJuYW1lIjogIlB1cmVseSBQRUkgQ1JNIiwKICAic2hvcnRfbmFtZSI6ICJQdXJlbHkgUEVJIiwKICAic3RhcnRfdXJsIjogIi8iLAogICJkaXNwbGF5IjogInN0YW5kYWxvbmUiLAogICJiYWNrZ3JvdW5kX2NvbG9yIjogIiNmYWY2ZjAiLAogICJ0aGVtZV9jb2xvciI6ICIjMmIzYTY3IiwKICAiaWNvbnMiOiBbCiAgICB7ICJzcmMiOiAiL2ljb24tMTkyLnBuZyIsICJzaXplcyI6ICIxOTJ4MTkyIiwgInR5cGUiOiAiaW1hZ2UvcG5nIiB9LAogICAgeyAic3JjIjogIi9pY29uLTUxMi5wbmciLCAic2l6ZXMiOiAiNTEyeDUxMiIsICJ0eXBlIjogImltYWdlL3BuZyIsICJwdXJwb3NlIjogImFueSBtYXNrYWJsZSIgfQogIF0sCiAgInNob3J0Y3V0cyI6IFsKICAgIHsgIm5hbWUiOiAiUXVpY2sgc2FsZSIsICJ1cmwiOiAiLyNzYWxlIiB9LAogICAgeyAibmFtZSI6ICJMb2cgbm90ZSBvciBjYWxsIiwgInVybCI6ICIvI25vdGUiIH0sCiAgICB7ICJuYW1lIjogIk5ldyBjb250YWN0IiwgInVybCI6ICIvI2NvbnRhY3QiIH0sCiAgICB7ICJuYW1lIjogIk5ldyB0YXNrIiwgInVybCI6ICIvI3Rhc2siIH0KICBdCn0K", "/style.css": "OnJvb3R7LS1iZzojZmFmNmYwOy0tY2FyZDojZmZmOy0taW5rOiMxZjI0MzM7LS1tdXRlOiM2YjcxODU7LS1saW5lOiNlOGUxZDY7LS1ibHVlOiMyYjNhNjc7LS1yZWQ6I2I0NTMyYTstLWdyZWVuOiMyZjdkNWI7LS1hbWJlcjojYjk4YTFlOy0tcjoxNHB4fQpAbWVkaWEgKHByZWZlcnMtY29sb3Itc2NoZW1lOmRhcmspezpyb290ey0tYmc6IzE0MTYxZjstLWNhcmQ6IzFkMjAzMDstLWluazojZWNlZWY2Oy0tbXV0ZTojOWFhMWI4Oy0tbGluZTojMmQzMjQ4Oy0tYmx1ZTojOGZhM2U4Oy0tcmVkOiNlMDg1NjA7LS1ncmVlbjojNWZjMjlhOy0tYW1iZXI6I2UwYjg0ZX19Cip7Ym94LXNpemluZzpib3JkZXItYm94fQpodG1sLGJvZHl7bWFyZ2luOjA7YmFja2dyb3VuZDp2YXIoLS1iZyk7Y29sb3I6dmFyKC0taW5rKTtmb250OjE2cHgvMS40IHN5c3RlbS11aSwtYXBwbGUtc3lzdGVtLFNlZ29lIFVJLFJvYm90byxzYW5zLXNlcmlmfQpidXR0b24saW5wdXQsc2VsZWN0LHRleHRhcmVhe2ZvbnQ6aW5oZXJpdDtjb2xvcjppbmhlcml0fQojYXBwe2Rpc3BsYXk6ZmxleDttaW4taGVpZ2h0OjEwMHZofQojc2lkZXtkaXNwbGF5Om5vbmV9CiNtYWlue2ZsZXg6MTttaW4td2lkdGg6MDtwYWRkaW5nOjE2cHggMTZweCA5NnB4O21heC13aWR0aDo5MDBweDttYXJnaW46MCBhdXRvO3dpZHRoOjEwMCV9Cmgxe2ZvbnQtc2l6ZToyNnB4O21hcmdpbjo0cHggMCAxNHB4O2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47Z2FwOjhweH0KaDJ7Zm9udC1zaXplOjEzcHg7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi4wNmVtO2NvbG9yOnZhcigtLW11dGUpO21hcmdpbjoyMnB4IDAgOHB4fQouYnJhbmR7ZGlzcGxheTpmbGV4O2dhcDoxMHB4O2FsaWduLWl0ZW1zOmNlbnRlcjtwYWRkaW5nOjZweCA4cHggMThweH0uYnJhbmQgc21hbGx7ZGlzcGxheTpibG9jaztjb2xvcjp2YXIoLS1tdXRlKTtmb250LXNpemU6MTJweH0ucGF3e2ZvbnQtc2l6ZToyNnB4fQojdGFic3twb3NpdGlvbjpmaXhlZDtsZWZ0OjA7cmlnaHQ6MDtib3R0b206MDtkaXNwbGF5OmZsZXg7YmFja2dyb3VuZDp2YXIoLS1jYXJkKTtib3JkZXItdG9wOjFweCBzb2xpZCB2YXIoLS1saW5lKTtwYWRkaW5nLWJvdHRvbTplbnYoc2FmZS1hcmVhLWluc2V0LWJvdHRvbSk7ei1pbmRleDo1fQojdGFicyBidXR0b257ZmxleDoxO2JvcmRlcjowO2JhY2tncm91bmQ6bm9uZTtwYWRkaW5nOjhweCAycHggN3B4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLW11dGUpO2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoycHg7cG9zaXRpb246cmVsYXRpdmV9CiN0YWJzIGJ1dHRvbiBzcGFue2ZvbnQtc2l6ZToyMHB4fQojdGFicyBidXR0b24ub257Y29sb3I6dmFyKC0tYmx1ZSk7Zm9udC13ZWlnaHQ6NjAwfQouYmFkZ2V7cG9zaXRpb246YWJzb2x1dGU7dG9wOjNweDtsZWZ0OjU1JTtiYWNrZ3JvdW5kOnZhcigtLXJlZCk7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjlweDtmb250LXNpemU6MTBweDtwYWRkaW5nOjAgNXB4O21pbi13aWR0aDoxNnB4O2xpbmUtaGVpZ2h0OjE2cHh9Ci5jYXJke2JhY2tncm91bmQ6dmFyKC0tY2FyZCk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTtib3JkZXItcmFkaXVzOnZhcigtLXIpO3BhZGRpbmc6MTJweCAxNHB4O21hcmdpbi1ib3R0b206OHB4fQoucm93e2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjEwcHh9Lmdyb3d7ZmxleDoxO21pbi13aWR0aDowfQouaXRlbXtkaXNwbGF5OmZsZXg7Z2FwOjEwcHg7YWxpZ24taXRlbXM6Y2VudGVyO3BhZGRpbmc6MTFweCAxNHB4O2JhY2tncm91bmQ6dmFyKC0tY2FyZCk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTtib3JkZXItcmFkaXVzOnZhcigtLXIpO21hcmdpbi1ib3R0b206OHB4O2N1cnNvcjpwb2ludGVyO3RleHQtYWxpZ246bGVmdDt3aWR0aDoxMDAlfQouaXRlbTphY3RpdmV7b3BhY2l0eTouN30KLml0ZW0gYiwuaXRlbSAudHtkaXNwbGF5OmJsb2NrO292ZXJmbG93OmhpZGRlbjt0ZXh0LW92ZXJmbG93OmVsbGlwc2lzO3doaXRlLXNwYWNlOm5vd3JhcH0KLnN1Yntjb2xvcjp2YXIoLS1tdXRlKTtmb250LXNpemU6MTNweDtvdmVyZmxvdzpoaWRkZW47dGV4dC1vdmVyZmxvdzplbGxpcHNpczt3aGl0ZS1zcGFjZTpub3dyYXB9Ci5hdnt3aWR0aDozOHB4O2hlaWdodDozOHB4O2JvcmRlci1yYWRpdXM6NTAlO2JhY2tncm91bmQ6dmFyKC0tYmx1ZSk7Y29sb3I6I2ZmZjtkaXNwbGF5OmdyaWQ7cGxhY2UtaXRlbXM6Y2VudGVyO2ZvbnQtd2VpZ2h0OjYwMDtmbGV4Om5vbmV9Ci5hdi5yZXRhaWx7YmFja2dyb3VuZDp2YXIoLS1yZWQpfS5hdi5sZWFke2JhY2tncm91bmQ6dmFyKC0tYW1iZXIpfS5hdi5wYXJ0bmVye2JhY2tncm91bmQ6dmFyKC0tZ3JlZW4pfQoudGlsZXN7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczoxZnIgMWZyO2dhcDo4cHh9Ci50aWxle2JhY2tncm91bmQ6dmFyKC0tY2FyZCk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTtib3JkZXItcmFkaXVzOnZhcigtLXIpO3BhZGRpbmc6MTJweCAxNHB4O3RleHQtYWxpZ246bGVmdDtjdXJzb3I6cG9pbnRlcn0KLnRpbGUgYntkaXNwbGF5OmJsb2NrO2ZvbnQtc2l6ZToyNnB4fS50aWxlIHNwYW57Y29sb3I6dmFyKC0tbXV0ZSk7Zm9udC1zaXplOjEzcHh9Ci5waWxse2Rpc3BsYXk6aW5saW5lLWJsb2NrO2ZvbnQtc2l6ZToxMXB4O3BhZGRpbmc6MnB4IDhweDtib3JkZXItcmFkaXVzOjk5cHg7YmFja2dyb3VuZDpjb2xvci1taXgoaW4gc3JnYix2YXIoLS1ibHVlKSAxNCUsdHJhbnNwYXJlbnQpO2NvbG9yOnZhcigtLWJsdWUpO3doaXRlLXNwYWNlOm5vd3JhcH0KLnBpbGwucmVke2JhY2tncm91bmQ6Y29sb3ItbWl4KGluIHNyZ2IsdmFyKC0tcmVkKSAxNiUsdHJhbnNwYXJlbnQpO2NvbG9yOnZhcigtLXJlZCl9LnBpbGwuZ3JlZW57YmFja2dyb3VuZDpjb2xvci1taXgoaW4gc3JnYix2YXIoLS1ncmVlbikgMTYlLHRyYW5zcGFyZW50KTtjb2xvcjp2YXIoLS1ncmVlbil9LnBpbGwuYW1iZXJ7YmFja2dyb3VuZDpjb2xvci1taXgoaW4gc3JnYix2YXIoLS1hbWJlcikgMTglLHRyYW5zcGFyZW50KTtjb2xvcjp2YXIoLS1hbWJlcil9Ci5idG57Ym9yZGVyOjA7YmFja2dyb3VuZDp2YXIoLS1ibHVlKTtjb2xvcjojZmZmO3BhZGRpbmc6OXB4IDE2cHg7Ym9yZGVyLXJhZGl1czoxMHB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtd2VpZ2h0OjYwMH0KQG1lZGlhIChwcmVmZXJzLWNvbG9yLXNjaGVtZTpkYXJrKXsuYnRue2NvbG9yOiMxNDE2MWZ9fQouYnRuLmdob3N0e2JhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Y29sb3I6dmFyKC0tYmx1ZSk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKX0uYnRuLmRhbmdlcntiYWNrZ3JvdW5kOnZhcigtLXJlZCk7Y29sb3I6I2ZmZn0uYnRuLnNte3BhZGRpbmc6NXB4IDEwcHg7Zm9udC1zaXplOjEzcHh9CmlucHV0LHNlbGVjdCx0ZXh0YXJlYXt3aWR0aDoxMDAlO3BhZGRpbmc6MTBweCAxMnB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tbGluZSk7Ym9yZGVyLXJhZGl1czoxMHB4O2JhY2tncm91bmQ6dmFyKC0tY2FyZCk7bWFyZ2luLXRvcDo0cHh9CnRleHRhcmVhe21pbi1oZWlnaHQ6ODRweDtyZXNpemU6dmVydGljYWx9CmxhYmVse2Rpc3BsYXk6YmxvY2s7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tbXV0ZSk7bWFyZ2luLWJvdHRvbToxMHB4fQouc2VhcmNoe21hcmdpbjowIDAgMTBweH0KLmNoaXBze2Rpc3BsYXk6ZmxleDtnYXA6NnB4O292ZXJmbG93LXg6YXV0bzttYXJnaW4tYm90dG9tOjEwcHg7cGFkZGluZy1ib3R0b206MnB4fQouY2hpcHMgYnV0dG9ue2JvcmRlcjoxcHggc29saWQgdmFyKC0tbGluZSk7YmFja2dyb3VuZDp2YXIoLS1jYXJkKTtib3JkZXItcmFkaXVzOjk5cHg7cGFkZGluZzo1cHggMTJweDt3aGl0ZS1zcGFjZTpub3dyYXA7Y3Vyc29yOnBvaW50ZXI7Zm9udC1zaXplOjEzcHh9Ci5jaGlwcyBidXR0b24ub257YmFja2dyb3VuZDp2YXIoLS1ibHVlKTtjb2xvcjojZmZmO2JvcmRlci1jb2xvcjp2YXIoLS1ibHVlKX0KQG1lZGlhIChwcmVmZXJzLWNvbG9yLXNjaGVtZTpkYXJrKXsuY2hpcHMgYnV0dG9uLm9ue2NvbG9yOiMxNDE2MWZ9fQouZG90e3dpZHRoOjhweDtoZWlnaHQ6OHB4O2JvcmRlci1yYWRpdXM6NTAlO2JhY2tncm91bmQ6dmFyKC0tcmVkKTtmbGV4Om5vbmV9Ci5rYW57ZGlzcGxheTpmbGV4O2dhcDoxMHB4O292ZXJmbG93LXg6YXV0bztwYWRkaW5nLWJvdHRvbToxMHB4O3Njcm9sbC1zbmFwLXR5cGU6eCBtYW5kYXRvcnl9Ci5jb2x7bWluLXdpZHRoOjI0MHB4O2ZsZXg6MTtzY3JvbGwtc25hcC1hbGlnbjpzdGFydH0uY29sIGgze2ZvbnQtc2l6ZToxM3B4O21hcmdpbjowIDAgOHB4O2NvbG9yOnZhcigtLW11dGUpfQouYnViYmxle21heC13aWR0aDo4NSU7cGFkZGluZzo4cHggMTJweDtib3JkZXItcmFkaXVzOjE0cHg7bWFyZ2luOjZweCAwO3doaXRlLXNwYWNlOnByZS13cmFwO3dvcmQtYnJlYWs6YnJlYWstd29yZH0KLmJ1YmJsZS5pbntiYWNrZ3JvdW5kOnZhcigtLWNhcmQpO2JvcmRlcjoxcHggc29saWQgdmFyKC0tbGluZSl9LmJ1YmJsZS5vdXR7YmFja2dyb3VuZDp2YXIoLS1ibHVlKTtjb2xvcjojZmZmO21hcmdpbi1sZWZ0OmF1dG99CkBtZWRpYSAocHJlZmVycy1jb2xvci1zY2hlbWU6ZGFyayl7LmJ1YmJsZS5vdXR7Y29sb3I6IzE0MTYxZn19Ci5idWJibGUgc21hbGx7ZGlzcGxheTpibG9jaztvcGFjaXR5Oi43O2ZvbnQtc2l6ZToxMXB4O21hcmdpbi10b3A6M3B4fQojc2hlZXR7cG9zaXRpb246Zml4ZWQ7aW5zZXQ6MDt6LWluZGV4OjIwO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpmbGV4LWVuZDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyfQojc2hlZXRbaGlkZGVuXSwjdG9hc3RbaGlkZGVuXXtkaXNwbGF5Om5vbmV9Ci5zY3JpbXtwb3NpdGlvbjphYnNvbHV0ZTtpbnNldDowO2JhY2tncm91bmQ6cmdiYSgxMCwxMiwyMCwuNSl9Ci5wYW5lbHtwb3NpdGlvbjpyZWxhdGl2ZTtiYWNrZ3JvdW5kOnZhcigtLWJnKTt3aWR0aDoxMDAlO21heC13aWR0aDo2NDBweDttYXgtaGVpZ2h0Ojkydmg7b3ZlcmZsb3c6YXV0bztib3JkZXItcmFkaXVzOjIwcHggMjBweCAwIDA7cGFkZGluZzoxOHB4IDE2cHggY2FsYygyNHB4ICsgZW52KHNhZmUtYXJlYS1pbnNldC1ib3R0b20pKX0KLnBhbmVsIGgze21hcmdpbjowIDAgMTJweDtmb250LXNpemU6MjBweDtkaXNwbGF5OmZsZXg7anVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47YWxpZ24taXRlbXM6Y2VudGVyfQoueHtib3JkZXI6MDtiYWNrZ3JvdW5kOm5vbmU7Zm9udC1zaXplOjI0cHg7Y29sb3I6dmFyKC0tbXV0ZSk7Y3Vyc29yOnBvaW50ZXJ9Ci50d297ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczoxZnIgMWZyO2dhcDoxMHB4fQouYWN0aW9uc3tkaXNwbGF5OmZsZXg7Z2FwOjhweDtmbGV4LXdyYXA6d3JhcDttYXJnaW4tdG9wOjhweH0KI3RvYXN0e3Bvc2l0aW9uOmZpeGVkO2xlZnQ6NTAlO2JvdHRvbTo5MHB4O3RyYW5zZm9ybTp0cmFuc2xhdGVYKC01MCUpO2JhY2tncm91bmQ6dmFyKC0taW5rKTtjb2xvcjp2YXIoLS1iZyk7cGFkZGluZzoxMHB4IDE2cHg7Ym9yZGVyLXJhZGl1czo5OXB4O3otaW5kZXg6MzA7Zm9udC1zaXplOjE0cHg7bWF4LXdpZHRoOjkwdnd9Ci5lbXB0eXtjb2xvcjp2YXIoLS1tdXRlKTt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjI2cHggMH0KLndhcm57YmFja2dyb3VuZDpjb2xvci1taXgoaW4gc3JnYix2YXIoLS1hbWJlcikgMTYlLHRyYW5zcGFyZW50KTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWFtYmVyKTtib3JkZXItcmFkaXVzOnZhcigtLXIpO3BhZGRpbmc6MTBweCAxNHB4O21hcmdpbi1ib3R0b206MTBweDtmb250LXNpemU6MTRweH0KQG1lZGlhIChtaW4td2lkdGg6OTAwcHgpewogICNzaWRle2Rpc3BsYXk6YmxvY2s7d2lkdGg6MjMwcHg7cGFkZGluZzoxOHB4IDEycHg7Ym9yZGVyLXJpZ2h0OjFweCBzb2xpZCB2YXIoLS1saW5lKTtwb3NpdGlvbjpzdGlja3k7dG9wOjA7aGVpZ2h0OjEwMHZoO2JhY2tncm91bmQ6dmFyKC0tY2FyZCl9CiAgI25hdiBidXR0b257ZGlzcGxheTpmbGV4O2dhcDoxMHB4O2FsaWduLWl0ZW1zOmNlbnRlcjt3aWR0aDoxMDAlO2JvcmRlcjowO2JhY2tncm91bmQ6bm9uZTtwYWRkaW5nOjEwcHggMTJweDtib3JkZXItcmFkaXVzOjEwcHg7Y3Vyc29yOnBvaW50ZXI7Y29sb3I6dmFyKC0taW5rKTt0ZXh0LWFsaWduOmxlZnQ7cG9zaXRpb246cmVsYXRpdmV9CiAgI25hdiBidXR0b24ub257YmFja2dyb3VuZDpjb2xvci1taXgoaW4gc3JnYix2YXIoLS1ibHVlKSAxNCUsdHJhbnNwYXJlbnQpO2NvbG9yOnZhcigtLWJsdWUpO2ZvbnQtd2VpZ2h0OjYwMH0KICAjbmF2IC5iYWRnZXtwb3NpdGlvbjpzdGF0aWM7bWFyZ2luLWxlZnQ6YXV0b30KICAjdGFic3tkaXNwbGF5Om5vbmV9I21haW57cGFkZGluZy1ib3R0b206NDBweH0KICAjc2hlZXR7YWxpZ24taXRlbXM6Y2VudGVyfS5wYW5lbHtib3JkZXItcmFkaXVzOjIwcHh9CiAgI3RvYXN0e2JvdHRvbTozMHB4fQogIC50aWxlc3tncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KDQsMWZyKX0KfQoKI2ZhYntwb3NpdGlvbjpmaXhlZDtyaWdodDoxNnB4O2JvdHRvbTpjYWxjKDY2cHggKyBlbnYoc2FmZS1hcmVhLWluc2V0LWJvdHRvbSkpO3dpZHRoOjU4cHg7aGVpZ2h0OjU4cHg7Ym9yZGVyLXJhZGl1czo1MCU7Ym9yZGVyOjA7YmFja2dyb3VuZDp2YXIoLS1yZWQpO2NvbG9yOiNmZmY7Zm9udC1zaXplOjMycHg7bGluZS1oZWlnaHQ6MTtib3gtc2hhZG93OjAgNnB4IDE4cHggcmdiYSgwLDAsMCwuMjgpO3otaW5kZXg6NjtjdXJzb3I6cG9pbnRlcn0KLnFhe2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO3BhZGRpbmc6MThweCAxMHB4O3RleHQtYWxpZ246Y2VudGVyO2dhcDo2cHh9LnFhIHNwYW57Zm9udC1zaXplOjMwcHh9Ci5idG4uYmlne3dpZHRoOjEwMCU7cGFkZGluZzoxNXB4O2ZvbnQtc2l6ZToxN3B4O21hcmdpbi10b3A6NnB4fS5zdGVwe3dpZHRoOjQ2cHg7aGVpZ2h0OjQ2cHg7cGFkZGluZzowO2ZvbnQtc2l6ZToyMnB4fQojbG9naW57cG9zaXRpb246Zml4ZWQ7aW5zZXQ6MDtiYWNrZ3JvdW5kOnZhcigtLWJnKTt6LWluZGV4OjUwO2Rpc3BsYXk6Z3JpZDtwbGFjZS1pdGVtczpjZW50ZXI7cGFkZGluZzoyNHB4fSNsb2dpbiBmb3Jte3dpZHRoOjEwMCU7bWF4LXdpZHRoOjM0MHB4O3RleHQtYWxpZ246Y2VudGVyfQphe2NvbG9yOnZhcigtLWJsdWUpfQpAbWVkaWEgKG1pbi13aWR0aDo5MDBweCl7I2ZhYntib3R0b206MjRweH19CkBtZWRpYSAocG9pbnRlcjpjb2Fyc2Upe2J1dHRvbixpbnB1dCxzZWxlY3QsdGV4dGFyZWF7bWluLWhlaWdodDo0NHB4fS5jaGlwcyBidXR0b257bWluLWhlaWdodDozNnB4fX0KLml0ZW0gLnN1YiwuZ3JvdyAuc3Vie2Rpc3BsYXk6YmxvY2t9Cmh0bWwsYm9keXtvdmVyZmxvdy14OmhpZGRlbn0KCi8qIGNhbGVuZGFyICovCi5jYWwtYmFye2Rpc3BsYXk6ZmxleDtnYXA6OHB4O2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO2FsaWduLWl0ZW1zOmNlbnRlcjtmbGV4LXdyYXA6d3JhcDttYXJnaW4tYm90dG9tOjZweH0KLnNlZ3tkaXNwbGF5OmlubGluZS1mbGV4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tbGluZSk7Ym9yZGVyLXJhZGl1czoxMHB4O292ZXJmbG93OmhpZGRlbjtiYWNrZ3JvdW5kOnZhcigtLWNhcmQpfQouc2VnIGJ1dHRvbntib3JkZXI6MDtiYWNrZ3JvdW5kOm5vbmU7cGFkZGluZzo4cHggMTZweDtjdXJzb3I6cG9pbnRlcjtjb2xvcjp2YXIoLS1tdXRlKTtmb250LXdlaWdodDo2MDB9Ci5zZWcgYnV0dG9uLm9ue2JhY2tncm91bmQ6dmFyKC0tYmx1ZSk7Y29sb3I6I2ZmZn0KQG1lZGlhIChwcmVmZXJzLWNvbG9yLXNjaGVtZTpkYXJrKXsuc2VnIGJ1dHRvbi5vbntjb2xvcjojMTQxNjFmfX0KLmNhbC1uYXZ7ZGlzcGxheTpmbGV4O2dhcDo2cHh9Ci5jYWwtdGl0bGV7Zm9udC13ZWlnaHQ6NzAwO21hcmdpbjo2cHggMCAxMHB4O2ZvbnQtc2l6ZToxN3B4fQoud2t7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczo1NHB4IG1pbm1heCgwLDFmcik7Z2FwOjhweDttYXJnaW4tYm90dG9tOjhweH0KLndrLWR7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1saW5lKTtiYWNrZ3JvdW5kOnZhcigtLWNhcmQpO2JvcmRlci1yYWRpdXM6MTJweDtjdXJzb3I6cG9pbnRlcjtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO3BhZGRpbmc6NnB4IDA7bWluLWhlaWdodDo1NnB4fQoud2stZCBzbWFsbHtjb2xvcjp2YXIoLS1tdXRlKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7Zm9udC1zaXplOjExcHh9LndrLWQgYntmb250LXNpemU6MjBweH0KLndrLnRvZGF5IC53ay1ke2JhY2tncm91bmQ6dmFyKC0tYmx1ZSk7Y29sb3I6I2ZmZjtib3JkZXItY29sb3I6dmFyKC0tYmx1ZSl9LndrLnRvZGF5IC53ay1kIHNtYWxse2NvbG9yOmluaGVyaXQ7b3BhY2l0eTouODV9CkBtZWRpYSAocHJlZmVycy1jb2xvci1zY2hlbWU6ZGFyayl7LndrLnRvZGF5IC53ay1ke2NvbG9yOiMxNDE2MWZ9fQoud2staXttaW4td2lkdGg6MH0ud2staSAuaXRlbXttYXJnaW4tYm90dG9tOjZweH0uY2FsLWl0IC5pY3tmb250LXNpemU6MjBweH0KLndrLWVtcHR5e2JvcmRlcjoxcHggZGFzaGVkIHZhcigtLWxpbmUpO2JhY2tncm91bmQ6bm9uZTtjb2xvcjp2YXIoLS1tdXRlKTt3aWR0aDoxMDAlO2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjEycHg7Y3Vyc29yOnBvaW50ZXI7dGV4dC1hbGlnbjpsZWZ0fQoubWdyaWR7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoNywxZnIpO2dhcDo0cHh9Ci5taGVhZCBzcGFue3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLW11dGUpO2ZvbnQtc2l6ZToxMnB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZX0KLm1je2JvcmRlcjoxcHggc29saWQgdmFyKC0tbGluZSk7YmFja2dyb3VuZDp2YXIoLS1jYXJkKTtib3JkZXItcmFkaXVzOjEwcHg7bWluLWhlaWdodDo1OHB4O3BhZGRpbmc6NHB4O2N1cnNvcjpwb2ludGVyO3RleHQtYWxpZ246bGVmdDtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2dhcDozcHg7b3ZlcmZsb3c6aGlkZGVuO21pbi13aWR0aDowfQoubWMgYntmb250LXNpemU6MTRweH0ubWMuZGlte29wYWNpdHk6LjQ1fS5tYy50b2RheXtib3JkZXItY29sb3I6dmFyKC0tYmx1ZSk7Ym94LXNoYWRvdzppbnNldCAwIDAgMCAxcHggdmFyKC0tYmx1ZSl9Lm1jLnRvZGF5IGJ7Y29sb3I6dmFyKC0tYmx1ZSl9Ci5kb3Rze2Rpc3BsYXk6ZmxleDtnYXA6M3B4O2ZsZXgtd3JhcDp3cmFwO2FsaWduLWl0ZW1zOmNlbnRlcn0uZG90cyBlbXtmb250LXN0eWxlOm5vcm1hbDtmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS1tdXRlKX0KLmR0e3dpZHRoOjhweDtoZWlnaHQ6OHB4O2JvcmRlci1yYWRpdXM6NTAlO2JhY2tncm91bmQ6dmFyKC0tbXV0ZSk7ZGlzcGxheTppbmxpbmUtYmxvY2t9Ci5kdC1wcm9kdWN0aW9uLC5kdC1tZWV0aW5ne2JhY2tncm91bmQ6dmFyKC0tYmx1ZSl9LmR0LWRlbGl2ZXJ5e2JhY2tncm91bmQ6dmFyKC0tZ3JlZW4pfS5kdC1tYXJrZXQsLmR0LWRlYWx7YmFja2dyb3VuZDp2YXIoLS1hbWJlcil9LmR0LXBvc3R7YmFja2dyb3VuZDp2YXIoLS1yZWQpfS5kdC10YXNre2JhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Ym9yZGVyOjJweCBzb2xpZCB2YXIoLS1tdXRlKX0KLm10e2Rpc3BsYXk6bm9uZTtmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS1tdXRlKTtsaW5lLWhlaWdodDoxLjI1O292ZXJmbG93OmhpZGRlbjt3aGl0ZS1zcGFjZTpub3dyYXA7dGV4dC1vdmVyZmxvdzplbGxpcHNpc30KQG1lZGlhIChtaW4td2lkdGg6NzAwcHgpey5tY3ttaW4taGVpZ2h0OjkycHh9Lm10e2Rpc3BsYXk6YmxvY2t9fQouY2FsLWxlZ2VuZHtkaXNwbGF5OmZsZXg7Z2FwOjEycHg7ZmxleC13cmFwOndyYXA7Y29sb3I6dmFyKC0tbXV0ZSk7Zm9udC1zaXplOjEycHg7bWFyZ2luLXRvcDoxMnB4fQo=", "/sw.js": "Ly8gQ2FjaGVzIHRoZSBhcHAgc2hlbGwgc28gaXQgb3BlbnMgaW5zdGFudGx5IG9uIGEgcGhvbmUuIE5ldmVyIGNhY2hlcyAvYXBpIChkYXRhIGlzIGFsd2F5cyBsaXZlKS4KY29uc3QgViA9ICdwcGNybS12MScsIFNIRUxMID0gWycvJywgJy9hcHAuanMnLCAnL3N0eWxlLmNzcycsICcvbWFuaWZlc3Qud2VibWFuaWZlc3QnLCAnL2ljb24tMTkyLnBuZyddOwpzZWxmLmFkZEV2ZW50TGlzdGVuZXIoJ2luc3RhbGwnLCAoZSkgPT4geyBlLndhaXRVbnRpbChjYWNoZXMub3BlbihWKS50aGVuKChjKSA9PiBjLmFkZEFsbChTSEVMTCkpLnRoZW4oKCkgPT4gc2VsZi5za2lwV2FpdGluZygpKSk7IH0pOwpzZWxmLmFkZEV2ZW50TGlzdGVuZXIoJ2FjdGl2YXRlJywgKGUpID0+IHsgZS53YWl0VW50aWwoY2FjaGVzLmtleXMoKS50aGVuKChrcykgPT4gUHJvbWlzZS5hbGwoa3MuZmlsdGVyKChrKSA9PiBrICE9PSBWKS5tYXAoKGspID0+IGNhY2hlcy5kZWxldGUoaykpKSkudGhlbigoKSA9PiBzZWxmLmNsaWVudHMuY2xhaW0oKSkpOyB9KTsKc2VsZi5hZGRFdmVudExpc3RlbmVyKCdmZXRjaCcsIChlKSA9PiB7CiAgY29uc3QgdSA9IG5ldyBVUkwoZS5yZXF1ZXN0LnVybCk7CiAgaWYgKGUucmVxdWVzdC5tZXRob2QgIT09ICdHRVQnIHx8IHUub3JpZ2luICE9PSBsb2NhdGlvbi5vcmlnaW4gfHwgdS5wYXRobmFtZS5zdGFydHNXaXRoKCcvYXBpLycpKSByZXR1cm47CiAgLy8gbmV0d29yayBmaXJzdCBzbyB1cGRhdGVzIHNob3cgdXA7IGZhbGwgYmFjayB0byBjYWNoZSB3aGVuIG9mZmxpbmUKICBlLnJlc3BvbmRXaXRoKGZldGNoKGUucmVxdWVzdCkudGhlbigocikgPT4geyBjb25zdCBjID0gci5jbG9uZSgpOyBjYWNoZXMub3BlbihWKS50aGVuKCh4KSA9PiB4LnB1dChlLnJlcXVlc3QsIGMpKTsgcmV0dXJuIHI7IH0pLmNhdGNoKCgpID0+IGNhY2hlcy5tYXRjaChlLnJlcXVlc3QpLnRoZW4oKG0pID0+IG0gfHwgY2FjaGVzLm1hdGNoKCcvJykpKSk7Cn0pOwo=" };

// entry.js
var core;
async function run(request) {
  core ??= buildCore({ env: process.env, assets: assets_default });
  const url = new URL(request.url);
  const raw = Buffer.from(await request.arrayBuffer());
  const headers = Object.fromEntries(request.headers.entries());
  const r = await core.handle({ method: request.method, url: url.pathname + url.search, headers, raw });
  return new Response(r.body, { status: r.status, headers: r.headers });
}
var GET = run;
var POST = run;
var PATCH = run;
var DELETE = run;
var PUT = run;
export {
  DELETE,
  GET,
  PATCH,
  POST,
  PUT
};
