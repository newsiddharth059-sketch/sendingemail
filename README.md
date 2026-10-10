# SendingEmail — Job Application Assistant

A Node.js starter app for managing job-application email addresses and multiple resumes, matching resumes to job descriptions, and using a default resume when no strong match is found.

## Features
- Upload and manage multiple PDF resumes.
- Add labels and skills to each resume so matching can be tuned.
- Set one resume as the common/default fallback.
- Score resumes against a job title and job description.
- Choose the highest-scoring resume when it meets the configured threshold; otherwise choose the default resume.
- Add, edit, and delete HR/recruiter email contacts.
- Local JSON metadata and local PDF storage for the starter version.

## Run locally
1. Install Node.js 20 or later.
2. Run `npm install`.
3. Run `npm start`.
4. Open http://localhost:3000.

## Important
This is a local starter app. It does not send email or create Gmail drafts yet. Gmail OAuth and draft creation should be added as a separate integration; never commit OAuth credentials, tokens, passwords, or resume PDFs to GitHub. The app stores uploaded resumes on the machine running the server. Add authentication and private hosting before exposing it to the internet.

## Resume matching
Matching uses the job title/description against the resume label and user-entered skills. This is a transparent keyword score, not a guarantee of suitability. Check the selected resume before creating or sending an application. If no resume reaches the threshold, the configured default resume is selected.
