# SendingEmail — Job Application Assistant

A Node.js starter app for managing job-application email addresses and multiple resumes, matching resumes to job descriptions, and using a default resume when no strong match is found.

## Features
- Upload and manage multiple PDF resumes.
- Add labels and skills to each resume so matching can be tuned.
- Set one resume as the common/default fallback.
- Extract selectable text from uploaded PDF resumes and score resumes against a job title and job description.
- Keep extracted resume text private in local storage; it is not returned by the API.
- Choose the highest-scoring resume when it meets the configured threshold; otherwise choose the default resume.
- Add, edit, and delete HR/recruiter email contacts.
- Upload an opportunities-directory PDF, preview extracted email addresses, then select which contacts to import; duplicate addresses are skipped.
- Local JSON metadata and local PDF storage for the starter version.

## Run locally
1. Install Node.js 20 or later.
2. Run `npm install`.
3. Run `npm start`.
4. Open http://localhost:3000.

## Gmail draft setup (local development)
The app can create Gmail drafts with the selected resume attached. It does **not** send emails automatically.

1. Open Google Cloud Console and create/select a project.
2. Enable the **Gmail API** for that project.
3. Configure the OAuth consent screen and add your own Gmail account as a test user if the app is in testing mode.
4. Create an OAuth Client ID with application type **Web application**.
5. Add this exact authorized redirect URI: `http://localhost:3000/oauth2callback`.
6. Copy `.env.example` to a new file named `.env` and fill in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Keep the redirect URI as shown for local development.
7. Run `npm install` and `npm start`, open `http://localhost:3000`, add at least one recruiter contact and one resume, then click **Connect Gmail**.
8. When Google asks you to choose an account, use `newsiddharth059@gmail.com` (the app suggests this account during sign-in). Approve the requested Gmail compose permission. Use the **Create Gmail draft** panel. Open Gmail → Drafts to inspect the email and attached resume before sending.

The OAuth scope is limited to Gmail compose/draft capability; this app has no automatic-send route. The local OAuth token is stored in `data/gmail-token.json`, which is ignored by Git. If you change the redirect URI or credentials, update the local `.env` file accordingly.

## Important
This is a local development app. Never commit OAuth credentials, tokens, passwords, or resume PDFs to GitHub. The app stores uploaded resumes, extracted resume text, contacts, and OAuth tokens on the machine running the server. It does not yet include login/authentication, so do not expose it to the public internet or deploy it as-is. Use only trusted local access until authentication and secure deployment are added.

## Resume matching
The opportunities PDF importer extracts email addresses from selectable PDF text and estimates company names from non-generic email domains. It previews candidates before import; it does not reliably infer job titles or company names from every PDF layout, and it skips masked/truncated addresses. Matching uses a transparent keyword score across the job title/description, extracted selectable text from the resume PDF, and user-entered label, skills, and notes. It is a heuristic—not an AI judgement or a guarantee of suitability. Scanned/image-only PDFs may have little or no extractable text, so add skills manually for those files. Check the selected resume before creating or sending an application. If no resume reaches the threshold, the configured default resume is selected.
