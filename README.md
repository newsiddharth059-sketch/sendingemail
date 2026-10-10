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
- Local JSON metadata and local PDF storage for the starter version.

## Run locally
1. Install Node.js 20 or later.
2. Run `npm install`.
3. Run `npm start`.
4. Open http://localhost:3000.

## Important
This is a local starter app. It does not send email or create Gmail drafts yet. Gmail OAuth and draft creation should be added as a separate integration; never commit OAuth credentials, tokens, passwords, or resume PDFs to GitHub. The app stores uploaded resumes on the machine running the server. Add authentication and private hosting before exposing it to the internet.

## Resume matching
Matching uses a transparent keyword score across the job title/description, extracted selectable text from the PDF, and user-entered label, skills, and notes. It is a heuristic—not an AI judgement or a guarantee of suitability. Scanned/image-only PDFs may have little or no extractable text, so add skills manually for those files. Check the selected resume before creating or sending an application. If no resume reaches the threshold, the configured default resume is selected.
