const $ = (selector) => document.querySelector(selector);
const state = { resumes: [], contacts: [], defaultResumeId: null };
const notice = $("#notice");

function showNotice(message, error = false) {
  notice.textContent = message;
  notice.hidden = !message;
  notice.classList.toggle("error", error);
  if (message) window.scrollTo({ top: 0, behavior: "smooth" });
}
async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
async function refresh() {
  const data = await api("/api/data");
  state.resumes = data.resumes;
  state.contacts = data.contacts;
  state.defaultResumeId = data.defaultResumeId;
  renderResumes();
  renderContacts();
}
function renderResumes() {
  $("#resume-count").textContent = state.resumes.length + (state.resumes.length === 1 ? " resume" : " resumes");
  const list = $("#resume-list");
  if (!state.resumes.length) { list.innerHTML = '<div class="empty-list">No resumes uploaded yet. Add your first PDF above.</div>'; return; }
  list.innerHTML = state.resumes.map((resume) => `
    <article class="item">
      <div class="item-main">
        <div class="item-title">${escapeHtml(resume.label)} ${resume.isDefault ? '<span class="default-tag">DEFAULT</span>' : ""}</div>
        <div class="item-sub">${escapeHtml(resume.originalName)}<br>Skills: ${escapeHtml(resume.skills || "Add skills to improve matching")} ${resume.notes ? "<br>" + escapeHtml(resume.notes) : ""}</div>
      </div>
      <div class="item-actions">
        <button class="small-btn" data-action="edit-resume" data-id="${resume.id}">Edit details</button>
        <a class="small-btn" href="/api/resumes/${resume.id}/download">Download</a>
        ${resume.isDefault ? "" : `<button class="small-btn" data-action="default-resume" data-id="${resume.id}">Set default</button>`}
        <button class="small-btn danger" data-action="delete-resume" data-id="${resume.id}">Delete</button>
      </div>
    </article>`).join("");
}
function renderContacts() {
  $("#contact-count").textContent = state.contacts.length + (state.contacts.length === 1 ? " contact" : " contacts");
  const list = $("#contact-list");
  const select = $("#draft-contact");
  if (select) {
    const selected = select.value;
    select.innerHTML = '<option value="">Choose a contact</option>' + state.contacts.map((c) => `<option value="${c.id}">${escapeHtml(c.name || c.email)} — ${escapeHtml(c.email)}</option>`).join("");
    if (state.contacts.some((c) => c.id === selected)) select.value = selected;
  }
  if (!state.contacts.length) { list.innerHTML = '<div class="empty-list">No contacts saved yet.</div>'; return; }
  list.innerHTML = state.contacts.map((contact) => `
    <article class="item">
      <div class="item-main">
        <div class="item-title">${escapeHtml(contact.name || contact.email)}</div>
        <div class="item-sub">${escapeHtml(contact.email)} ${contact.company ? " · " + escapeHtml(contact.company) : ""} ${contact.notes ? "<br>" + escapeHtml(contact.notes) : ""}</div>
      </div>
      <div class="item-actions">
        <button class="small-btn" data-action="edit-contact" data-id="${contact.id}">Edit</button>
        <button class="small-btn danger" data-action="delete-contact" data-id="${contact.id}">Delete</button>
      </div>
    </article>`).join("");
}
$("#resume-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const result = await api("/api/resumes", { method: "POST", body: new FormData(form) });
    form.reset();
    await refresh();
    showNotice("Resume uploaded. " + (result.isDefault ? "It is currently your default resume." : "You can set it as default anytime."));
  } catch (error) { showNotice(error.message, true); }
});
$("#contact-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = Object.fromEntries(new FormData(form));
  try {
    await api("/api/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    form.reset();
    await refresh();
    showNotice("Email contact saved.");
  } catch (error) { showNotice(error.message, true); }
});
$("#match-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const result = await api("/api/match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)) });
    const target = $("#match-result");
    if (!result.chosenResume) {
      target.className = "match-result";
      target.innerHTML = "No resume is available. Upload a resume first, then try again.";
      return;
    }
    target.className = "match-result";
    target.innerHTML = `<strong>Recommended resume: ${escapeHtml(result.chosenResume.label)}</strong><br>${escapeHtml(result.chosenResume.originalName)}<br><span>${escapeHtml(result.reason)} · score ${result.chosenResume.score}%</span><div style="margin-top:12px;font-weight:700">Resume comparison</div>${result.ranked.map((r) => `<div class="score-row"><span style="width:155px;max-width:40%;overflow-wrap:anywhere">${escapeHtml(r.label)}${r.isDefault ? " (default)" : ""}</span><div class="score-track"><div class="score-fill" style="width:${r.score}%"></div></div><span>${r.score}%</span></div>`).join("")}${result.usedFallback ? "<p><strong>Fallback used:</strong> No resume reached the threshold, so the default resume was selected.</p>" : "<p>Review this recommendation before attaching the resume to an application.</p>"}`;
  } catch (error) { showNotice(error.message, true); }
});
document.body.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  try {
    if (action === "default-resume") {
      await api(`/api/resumes/${id}/default`, { method: "POST" });
      await refresh(); showNotice("Default resume updated.");
    } else if (action === "delete-resume") {
      if (!confirm("Delete this resume PDF and its saved details?")) return;
      await api(`/api/resumes/${id}`, { method: "DELETE" });
      await refresh(); showNotice("Resume deleted.");
    } else if (action === "edit-resume") {
      const item = state.resumes.find((r) => r.id === id);
      const label = prompt("Resume label:", item.label);
      if (label === null) return;
      const skills = prompt("Skills / keywords (comma-separated):", item.skills || "");
      if (skills === null) return;
      const notes = prompt("Notes:", item.notes || "");
      if (notes === null) return;
      await api(`/api/resumes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label, skills, notes }) });
      await refresh(); showNotice("Resume details updated.");
    } else if (action === "delete-contact") {
      if (!confirm("Delete this email contact?")) return;
      await api(`/api/contacts/${id}`, { method: "DELETE" });
      await refresh(); showNotice("Contact deleted.");
    } else if (action === "edit-contact") {
      const item = state.contacts.find((c) => c.id === id);
      const name = prompt("Contact name:", item.name || "");
      if (name === null) return;
      const email = prompt("Email address:", item.email);
      if (email === null) return;
      const company = prompt("Company:", item.company || "");
      if (company === null) return;
      const notes = prompt("Notes:", item.notes || "");
      if (notes === null) return;
      await api(`/api/contacts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, company, notes }) });
      await refresh(); showNotice("Contact updated.");
    }
  } catch (error) { showNotice(error.message, true); }
});

async function refreshGmailStatus() {
  const status = $("#gmail-status");
  if (!status) return;
  try {
    const data = await api("/api/gmail/status");
    status.textContent = data.connected ? "Gmail connected — drafts-only permission" : data.configured ? "Gmail is configured but not connected" : "Gmail setup needed — see README.md";
    $("#connect-gmail").textContent = data.connected ? "Reconnect Gmail" : "Connect Gmail";
  } catch {
    status.textContent = "Could not check Gmail connection.";
  }
}
$("#connect-gmail")?.addEventListener("click", async () => {
  try {
    const result = await api("/api/gmail/auth");
    window.location.href = result.url;
  } catch (error) {
    showNotice(error.message, true);
  }
});
$("#draft-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const target = $("#draft-result");
  target.className = "match-result";
  target.textContent = "Creating Gmail draft and attaching the recommended resume…";
  try {
    const result = await api("/api/drafts/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form))
    });
    target.innerHTML = `<strong>Gmail draft created</strong><br>To: ${escapeHtml(result.recipient)}<br>Subject: ${escapeHtml(result.subject)}<br>Attached resume: ${escapeHtml(result.resume.originalName)} (${result.resume.score}% match)${result.usedFallback ? "<p><strong>Fallback used:</strong> No resume reached the threshold, so your default resume was attached.</p>" : ""}<p>Open Gmail → Drafts to review the email and attachment before sending.</p>`;
    target.className = "match-result";
  } catch (error) {
    target.textContent = error.message;
    target.className = "match-result";
  }
});
const params = new URLSearchParams(window.location.search);
if (params.get("gmail") === "connected") showNotice("Gmail connected successfully. Draft creation is enabled.");
if (params.get("gmail") === "cancelled") showNotice("Gmail connection was cancelled.", true);

refreshGmailStatus();
refresh().catch((error) => showNotice("Could not load your data: " + error.message, true));