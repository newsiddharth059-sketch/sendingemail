const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pdfParse = require("pdf-parse");

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

app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message || "Something went wrong." });
});

app.listen(PORT, () => console.log(`SendingEmail running at http://localhost:${PORT}`));
