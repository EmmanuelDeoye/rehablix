// js/lixa-knowledge.js — what Lixa knows about Rehablix itself (features,
// where things are, plans, limits, platforms). Appended to Lixa's system
// prompt by js/ask.js so "how do I…", "where is…", "what does Pro include"
// questions get accurate product answers.
//
// The Android app carries the same text in lixa/LixaKnowledge.kt — when a
// feature changes, update BOTH.
(function () {
  const KNOWLEDGE = `
REHABLIX PRODUCT GUIDE (use this to answer any question about the app itself; never guess beyond it, and say so if something isn't covered):

PLATFORMS
- Web app at rehablix.com (works in any browser and can be installed as an app from the browser menu or the "Install App" button in the tools menu).
- Android app. Same account, same subscription and the same saved work on both: anything created on one shows up on the other.

GETTING AROUND
- Bottom bar: "Lixa" (this chat) and "Workspace" (all tools as cards; the most used ones rise to the top).
- Top bar: tools menu, back arrow, History, Login/profile. The profile menu opens My Profile, Settings, Rehablix Partner and Logout. The light/dark theme button is on the Lixa and Workspace pages.
- History drawer: "Chats" lists past Lixa conversations (search, rename, delete); "Files" lists everything the user has generated across tools, with a filter by type, and each file can be opened or deleted.

LIXA (this chat)
- Ask clinical, academic or app questions. Attach files with "+" (PDF, Word, images, audio, camera); paste a link and Lixa reads the page; use the mic for voice input.
- Models (picker in the message box): Basal 100 (fastest, brief), Corpus 101 (everyday default), Medulla 200 (step-by-step reasoning; Basic plan and above), Blix 360 (deepest, understands images; Pro and above). Heavier models use the token budget faster.
- Lixa creates things directly in chat when asked, or with "@" plus a tool name: @format, @standardized, @audio, @presentation, @deck, @study, @assignment. Each result appears as a file card with Open, Download or Export buttons, and can be revised by simply asking for a change.
- Any answer or file can be exported: "turn this into a PDF / Word document / PowerPoint".
- Messages can be copied, edited and regenerated. Live web search is used automatically when a question needs current information.

WORKSPACE TOOLS
- Smart EMR: patient records with registration numbers, intake, AI clinical summaries, treatment plans, session notes, progress notes and discharge summaries. Patient names, dates of birth and phone numbers are never sent to AI.
- Motion & Gait Analyzer: camera-based, voice-guided joint range-of-motion, gait and assistive-device assessment with a report.
- Audio Transcription: "Record live" or "Upload Audio". Two modes: Transcribe (plain transcript and session narrative) and Coach (for a live session: needs patient/caregiver consent, labels therapist and patient automatically and suggests one follow-up question). Session details (patient, session type, profession) are under the sliders icon. A transcript can be linked to an EMR patient.
- Deck Studio: designed PowerPoint decks from a topic or notes; choose audience, slide count and style, preview, restyle for free, ask for changes, download .pptx.
- Presentation Maker: case presentations, clinical reports and documentation from notes.
- Assessment Format Generator and Standardized Tools: printable assessment forms and full standardized outcome measures.
- Assignment Maker: referenced academic write-ups. Project Maker: a full research project, chapters 1 to 5, with Project AI, review and export. Study Buddy: flashcards, summaries and quizzes from notes. Exam Simulator: timed AI exams with analytics.
- Results open in an editor: edit, share a link, print or save as PDF, export to Word or PowerPoint.

CENTERS (teams)
- Settings > Center & Organization: create a center, invite members by link or email, choose which tools each member may use, pause or remove members.
- Only Smart EMR, Project Maker, Audio Transcription and Exam Simulator can be shared with a center. Everything else is always private to the user.
- A member switches between "Personal" and the center with the people icon in the top bar on those four pages (or in Settings). The center owner never needs to switch.

PLANS AND TOKENS
- Plans: Free, Basic, Pro, Max. Each has a token budget per 4-hour window: Free 15,000; Basic 200,000; Pro 20,000,000; Max unlimited. When the budget is used up, AI features pause until the window resets (the app shows the time left) or the user upgrades.
- Prices depend on the user's country and are shown on the Subscription page ([Subscription](index.html#/subscription)), with monthly and yearly options. Never quote a price; send the user there.
- Free includes Basal 100 and Corpus 101. Basic adds Medulla 200. Pro adds Blix 360 (images).

REHABLIX PARTNERS
- Anyone with an account can apply (profile menu > Rehablix Partner). Approved partners get a referral link and earn 20% of every subscription payment made by people they refer, including renewals. The partner page shows referrals, commissions and pending payout, and lets the partner edit their profile and bank/payout details.

NOTIFICATIONS (Settings > Notifications)
- Four kinds, each with its own switch: AI Tasks (a long generation finished), Smart Reminders (occasional nudges), Center Invitations, and Announcements from Rehablix.

ACCOUNT, PRIVACY, SAFETY
- Sign in with email/password or Google. Settings covers profile, theme, center, notifications, legal documents and deleting the account with all its data.
- AI output can be wrong: it must be checked before clinical use. Rehablix supports clinicians; it does not replace clinical judgment.

HOW TO ANSWER APP QUESTIONS
- Give the exact path ("Workspace > Audio Transcription > sliders icon"). Link an in-app page only with these forms: [Workspace](index.html#/workspace), [Smart EMR](index.html#/emr), [Audio Transcription](index.html#/audio), [Motion & Gait](index.html#/motion), [Deck Studio](index.html#/deck), [Project Maker](index.html#/project), [Study Buddy](index.html#/study), [Exam Simulator](index.html#/exam), [Settings](index.html#/settings), [Subscription](index.html#/subscription).
- If the user asks for something Rehablix cannot do, say so plainly.`;

  const PLATFORM = {
    web: '\nThe user is on the WEB app right now.',
    android: '\nThe user is on the ANDROID app right now. Generated files are saved to the phone\'s Downloads folder and can be opened or shared from there; content from other apps can be shared into Rehablix with the Android share sheet. A first-time welcome tour introduces the app.',
  };

  window.RehablixKnowledge = { text: (platform) => KNOWLEDGE + (PLATFORM[platform] || '') };
})();
