require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pdfParse = require("pdf-parse");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");

for (const dir of [DATA_DIR, UPLOAD_DIR]) fs.mkdirSync(dir, { recursive: true });
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ resumes: [], contacts: [], defaultResumeId: null }, null, 2));
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function readDb() {
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}
function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
function cleanString(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "you", "your", "our", "are", "will", "can", "all",
  "have", "has", "had", "this", "that", "from", "into", "their", "they", "them",
  "who", "what", "when", "where", "how", "why", "not", "but", "job", "role",
  "work", "working", "team", "years", "year", "good", "strong", "ability", "skills",
  "experience", "required", "requirements", "responsibilities", "preferred", "plus",
  "using", "use", "used", "build", "building", "develop", "developing", "including",
  "such", "must", "should", "would", "about", "more", "other", "both", "each", "etc"
]);
function tokens(value) {
  return [...new Set(String(value || "").toLowerCase().match(/[a-z0-9+#.]+/g) || [])]
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}
function scoreResume(resume, jobText) {
  const jobTokens = tokens(jobText);
  if (!jobTokens.length) return 0;
  const resumeText = [resume.label, resume.skills, resume.notes, resume.extractedText].join(" ").toLowerCase();
  const resumeTokens = new Set(tokens(resumeText));
  const matched = jobTokens.filter((word) => resumeTokens.has(word));
  const tokenCoverage = matched.length / jobTokens.length;
  const keywordCoverage = Math.min(1, matched.length / Math.min(8, jobTokens.length));
  return Math.min(100, Math.round((tokenCoverage * 75 + keywordCoverage * 25) * 100) / 100);
}
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, crypto.randomUUID() + ".pdf")
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isPdf = file.mimetype === "application/pdf" || path.extname(file.originalname).toLowerCase() === ".pdf";
    cb(isPdf ? null : new Error("Please upload a PDF file."), isPdf);
  }
});
const directoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isPdf = file.mimetype === "application/pdf" || path.extname(file.originalname).toLowerCase() === ".pdf";
    cb(isPdf ? null : new Error("Please upload a PDF directory."), isPdf);
  }
});

app.get("/api/data", (_req, res) => {
  const db = readDb();
  res.json({
    resumes: db.resumes.map(({ id, filename, originalName, label, skills, notes, createdAt }) =>
      ({ id, filename, originalName, label, skills, notes, createdAt, isDefault: id === db.defaultResumeId })),
    contacts: db.contacts,
    defaultResumeId: db.defaultResumeId
  });
});

app.post("/api/resumes", upload.single("resume"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a PDF resume first." });
  let extractedText = "";
  try {
    const parsed = await pdfParse(fs.readFileSync(req.file.path));
    extractedText = cleanString(parsed.text, 30000);
  } catch (error) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ error: "We could not read this PDF. Please try another PDF file." });
  }
  const db = readDb();
  const resume = {
    id: crypto.randomUUID(),
    filename: req.file.filename,
    originalName: path.basename(req.file.originalname),
    label: cleanString(req.body.label, 80) || path.basename(req.file.originalname, ".pdf"),
    skills: cleanString(req.body.skills, 1000),
    notes: cleanString(req.body.notes, 1000),
    extractedText,
    createdAt: new Date().toISOString()
  };
  db.resumes.push(resume);
  if (!db.defaultResumeId) db.defaultResumeId = resume.id;
  writeDb(db);
  const { extractedText: _privateText, ...publicResume } = resume;
  res.status(201).json({ ...publicResume, isDefault: db.defaultResumeId === resume.id });
});

app.patch("/api/resumes/:id", (req, res) => {
  const db = readDb();
  const resume = db.resumes.find((item) => item.id === req.params.id);
  if (!resume) return res.status(404).json({ error: "Resume not found." });
  if (req.body.label !== undefined) resume.label = cleanString(req.body.label, 80);
  if (req.body.skills !== undefined) resume.skills = cleanString(req.body.skills, 1000);
  if (req.body.notes !== undefined) resume.notes = cleanString(req.body.notes, 1000);
  writeDb(db);
  res.json(resume);
});

app.post("/api/resumes/:id/default", (req, res) => {
  const db = readDb();
  if (!db.resumes.some((item) => item.id === req.params.id)) return res.status(404).json({ error: "Resume not found." });
  db.defaultResumeId = req.params.id;
  writeDb(db);
  res.json({ success: true, defaultResumeId: db.defaultResumeId });
});

app.delete("/api/resumes/:id", (req, res) => {
  const db = readDb();
  const index = db.resumes.findIndex((item) => item.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Resume not found." });
  const [resume] = db.resumes.splice(index, 1);
  try { fs.unlinkSync(path.join(UPLOAD_DIR, resume.filename)); } catch {}
  if (db.defaultResumeId === resume.id) db.defaultResumeId = db.resumes[0]?.id || null;
  writeDb(db);
  res.json({ success: true, defaultResumeId: db.defaultResumeId });
});

app.post("/api/match", (req, res) => {
  const db = readDb();
  const jobText = [cleanString(req.body.jobTitle, 200), cleanString(req.body.jobDescription, 12000)].join(" ");
  if (!jobText.trim()) return res.status(400).json({ error: "Enter a job title or job description." });
  const ranked = db.resumes.map((resume) => ({ ...resume, score: scoreResume(resume, jobText) }))
    .sort((a, b) => b.score - a.score);
  const threshold = Math.max(1, Math.min(100, Number(req.body.threshold) || 25));
  const best = ranked[0];
  const hasGoodMatch = best && best.score >= threshold;
  const chosen = hasGoodMatch ? best : db.resumes.find((r) => r.id === db.defaultResumeId);
  res.json({
    chosenResume: chosen ? { id: chosen.id, label: chosen.label, originalName: chosen.originalName, score: scoreResume(chosen, jobText) } : null,
    reason: hasGoodMatch ? "Best keyword match" : "No strong match; using your default resume",
    usedFallback: !hasGoodMatch,
    threshold,
    ranked: ranked.map((r) => ({ id: r.id, label: r.label, originalName: r.originalName, score: r.score, isDefault: r.id === db.defaultResumeId }))
  });
});

app.get("/api/resumes/:id/download", (req, res) => {
  const db = readDb();
  const resume = db.resumes.find((item) => item.id === req.params.id);
  if (!resume) return res.status(404).json({ error: "Resume not found." });
  const filePath = path.join(UPLOAD_DIR, resume.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Resume file is missing from local storage." });
  res.download(filePath, resume.originalName);
});

app.post("/api/import/pdf-preview", directoryUpload.single("directory"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose the opportunities directory PDF first." });
  try {
    const parsed = await pdfParse(req.file.buffer);
    const text = String(parsed.text || "");
    const emails = [...new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi) || [])]
      .map((email) => email.toLowerCase());
    const genericDomains = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "rediffmail.com", "icloud.com"]);
    const candidates = emails.map((email) => {
      const domain = email.split("@")[1];
      const domainName = domain.split(".")[0].replace(/[-_]/g, " ");
      const company = genericDomains.has(domain) ? "" : domainName.replace(/\\b\\w/g, (letter) => letter.toUpperCase());
      const index = text.toLowerCase().indexOf(email);
      const context = text.slice(Math.max(0, index - 100), Math.min(text.length, index + email.length + 100)).replace(/\\s+/g, " ").trim();
      return { email, company, context };
    });
    res.json({ filename: path.basename(req.file.originalname), count: candidates.length, candidates });
  } catch {
    res.status(400).json({ error: "Could not read this PDF. Try a text-based PDF or enter contacts manually." });
  }
});

app.post("/api/contacts/bulk", (req, res) => {
  if (!Array.isArray(req.body.contacts)) return res.status(400).json({ error: "Provide a list of contacts to import." });
  const db = readDb();
  const existing = new Set(db.contacts.map((contact) => contact.email.toLowerCase()));
  const added = [];
  for (const item of req.body.contacts.slice(0, 500)) {
    const email = cleanString(item.email, 254).toLowerCase();
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || existing.has(email)) continue;
    const contact = {
      id: crypto.randomUUID(),
      name: cleanString(item.name, 120),
      email,
      company: cleanString(item.company, 120),
      notes: cleanString(item.notes, 500) || "Imported from opportunities PDF"
    };
    db.contacts.push(contact);
    added.push(contact);
    existing.add(email);
  }
  writeDb(db);
  res.status(201).json({ addedCount: added.length, skippedCount: req.body.contacts.length - added.length, contacts: added });
});

app.post("/api/contacts", (req, res) => {
  const email = cleanString(req.body.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  const db = readDb();
  if (db.contacts.some((c) => c.email === email)) return res.status(409).json({ error: "That email is already saved." });
  const contact = { id: crypto.randomUUID(), name: cleanString(req.body.name, 120), email, company: cleanString(req.body.company, 120), notes: cleanString(req.body.notes, 500) };
  db.contacts.push(contact);
  writeDb(db);
  res.status(201).json(contact);
});

app.patch("/api/contacts/:id", (req, res) => {
  const db = readDb();
  const contact = db.contacts.find((item) => item.id === req.params.id);
  if (!contact) return res.status(404).json({ error: "Contact not found." });
  if (req.body.name !== undefined) contact.name = cleanString(req.body.name, 120);
  if (req.body.company !== undefined) contact.company = cleanString(req.body.company, 120);
  if (req.body.notes !== undefined) contact.notes = cleanString(req.body.notes, 500);
  if (req.body.email !== undefined) {
    const email = cleanString(req.body.email, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
    if (db.contacts.some((c) => c.email === email && c.id !== contact.id)) return res.status(409).json({ error: "That email is already saved." });
    contact.email = email;
  }
  writeDb(db);
  res.json(contact);
});

app.delete("/api/contacts/:id", (req, res) => {
  const db = readDb();
  const before = db.contacts.length;
  db.contacts = db.contacts.filter((item) => item.id !== req.params.id);
  if (before === db.contacts.length) return res.status(404).json({ error: "Contact not found." });
  writeDb(db);
  res.json({ success: true });
});


const GMAIL_TOKEN_FILE = path.join(DATA_DIR, "gmail-token.json");
const oauthStates = new Set();

function gmailOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/oauth2callback`;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}
function gmailAuthorizedClient() {
  const oauth = gmailOAuthClient();
  if (!oauth || !fs.existsSync(GMAIL_TOKEN_FILE)) return null;
  try {
    oauth.setCredentials(JSON.parse(fs.readFileSync(GMAIL_TOKEN_FILE, "utf8")));
    return oauth;
  } catch {
    return null;
  }
}
function base64Lines(value) {
  return Buffer.from(value).toString("base64").match(/.{1,76}/g)?.join("\r\n") || "";
}
function makeRawEmail({ to, subject, body, filename, pdfBuffer }) {
  const boundary = `sendingemail_${crypto.randomUUID().replace(/-/g, "")}`;
  const safeFilename = path.basename(filename).replace(/["\r\n]/g, "_");
  const message = [
    `To: ${to}`,
    `Subject: ${subject.replace(/[\r\n]/g, " ").slice(0, 250)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(body),
    `--${boundary}`,
    `Content-Type: application/pdf; name="${safeFilename}"`,
    `Content-Disposition: attachment; filename="${safeFilename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    pdfBuffer.toString("base64").match(/.{1,76}/g)?.join("\r\n") || "",
    `--${boundary}--`,
    ""
  ].join("\r\n");
  return Buffer.from(message).toString("base64url");
}

app.get("/api/gmail/status", (_req, res) => {
  const configured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const connected = Boolean(gmailAuthorizedClient());
  res.json({ configured, connected, mode: "drafts-only" });
});

app.get("/api/gmail/auth", (req, res) => {
  const oauth = gmailOAuthClient();
  if (!oauth) return res.status(400).json({ error: "Gmail is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your local .env file first." });
  const state = crypto.randomBytes(24).toString("hex");
  oauthStates.add(state);
  const url = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/gmail.compose"],
    state
  });
  res.json({ url });
});

app.get("/oauth2callback", async (req, res) => {
  const oauth = gmailOAuthClient();
  if (!oauth) return res.status(400).send("Gmail is not configured. Add your local OAuth credentials and restart the app.");
  if (!req.query.state || !oauthStates.has(String(req.query.state))) return res.status(400).send("OAuth state check failed. Return to the app and try connecting Gmail again.");
  oauthStates.delete(String(req.query.state));
  if (req.query.error) return res.redirect("/?gmail=cancelled");
  try {
    const { tokens } = await oauth.getToken(String(req.query.code || ""));
    oauth.setCredentials(tokens);
    fs.writeFileSync(GMAIL_TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
    res.redirect("/?gmail=connected");
  } catch (error) {
    res.status(400).send("Could not connect Gmail. Return to the app and try again.");
  }
});

app.post("/api/drafts/create", async (req, res) => {
  const oauth = gmailAuthorizedClient();
  if (!oauth) return res.status(400).json({ error: "Connect Gmail first. If it is not configured, follow the Gmail setup instructions in README.md." });
  const db = readDb();
  const contact = db.contacts.find((item) => item.id === req.body.contactId);
  if (!contact) return res.status(400).json({ error: "Choose a saved HR/recruiter contact first." });
  const jobTitle = cleanString(req.body.jobTitle, 200);
  const jobDescription = cleanString(req.body.jobDescription, 12000);
  if (!jobTitle && !jobDescription) return res.status(400).json({ error: "Enter a job title or description." });
  const jobText = [jobTitle, jobDescription].join(" ");
  const ranked = db.resumes.map((resume) => ({ resume, score: scoreResume(resume, jobText) })).sort((a, b) => b.score - a.score);
  const threshold = Math.max(1, Math.min(100, Number(req.body.threshold) || 25));
  const best = ranked[0];
  const hasGoodMatch = best && best.score >= threshold;
  const chosen = hasGoodMatch ? best.resume : db.resumes.find((item) => item.id === db.defaultResumeId);
  if (!chosen) return res.status(400).json({ error: "Upload at least one resume before creating a draft." });
  const resumePath = path.join(UPLOAD_DIR, chosen.filename);
  if (!fs.existsSync(resumePath)) return res.status(404).json({ error: "The selected resume file is missing from local storage." });
  const company = cleanString(contact.company, 120);
  const role = jobTitle || "the suitable opportunity";
  const skills = cleanString(chosen.skills, 500);
  const greeting = cleanString(contact.name, 120) ? `Dear ${cleanString(contact.name, 120)},` : "Dear Hiring Team,";
  const defaultSubject = `Application for ${role}${company ? ` — ${company}` : ""}`;
  const defaultBody = [
    greeting,
    "",
    `I am writing to apply for the ${role}${company ? ` position at ${company}` : " position"}.`,
    skills ? `My relevant skills include ${skills}.` : "My background includes web development, JavaScript, React.js, Node.js, databases, and application support.",
    "I have attached my resume for your consideration. I would appreciate the opportunity to discuss how my background fits your requirements.",
    "",
    "Regards,",
    "Siddharth Dubey",
    "siddharthd067@gmail.com"
  ].join("\n");
  const subject = cleanString(req.body.subject, 250) || defaultSubject;
  const body = cleanString(req.body.body, 8000) || defaultBody;
  try {
    const gmail = google.gmail({ version: "v1", auth: oauth });
    const raw = makeRawEmail({ to: contact.email, subject, body, filename: chosen.originalName, pdfBuffer: fs.readFileSync(resumePath) });
    const result = await gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw } } });
    res.status(201).json({
      success: true,
      draftId: result.data.id,
      recipient: contact.email,
      subject,
      resume: { id: chosen.id, label: chosen.label, originalName: chosen.originalName, score: scoreResume(chosen, jobText) },
      usedFallback: !hasGoodMatch,
      message: "Gmail draft created. Review the message and attachment in Gmail before sending."
    });
  } catch (error) {
    res.status(502).json({ error: "Gmail could not create the draft. Check the connected account and OAuth permissions, then try again." });
  }
});

app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message || "Something went wrong." });
});

app.listen(PORT, () => console.log(`SendingEmail running at http://localhost:${PORT}`));
