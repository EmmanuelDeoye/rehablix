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
- Top bar: tools menu, back arrow, History, Login/profile. The profile menu opens Token usage (paid plans: tokens used this 4-hour window and today, Live minutes, how each model counts), Settings and Rehablix Partner. Log Out is on the Settings page, just above Delete Account. The light/dark theme button is on the Lixa and Workspace pages.
- History drawer: "Chats" lists past Lixa conversations (search, rename, delete); "Files" lists everything the user has generated across tools, with a filter by type, and each file can be opened or deleted.

LIXA (this chat)
- Ask clinical, academic or app questions. Attach files with "+" (PDF, Word, images, audio, camera); paste a link and Lixa reads the page; use the mic for voice input.
- Models (picker in the message box): Basal 100 (fastest, brief), Corpus 101 (everyday default), Medulla 200 (step-by-step reasoning; Basic plan and above), Blix 360 (deepest, understands images; Pro and above). Heavier models use the token budget faster.
- Lixa creates things directly in chat when asked, or with "@" plus a tool name: @format, @standardized, @audio, @presentation, @deck, @study, @assignment. Each result appears as a file card with Open, Download or Export buttons, and can be revised by simply asking for a change.
- Any answer or file can be exported: "turn this into a PDF / Word document / PowerPoint".
- Messages can be copied, edited and regenerated. Live web search is used automatically when a question needs current information.

WORKSPACE TOOLS
- Smart EMR: patient records with registration numbers, intake, SI clinical summaries, treatment plans, session notes, progress notes and discharge summaries. Patient details are sent to the SI so it can help in full; each user is responsible for their own patients' privacy.
- Motion & Gait Analyzer: camera-based, voice-guided joint range-of-motion, gait and assistive-device assessment with a report. For range of motion: film side-on for flexion/extension and facing the camera for abduction, side bending and rotation (the tracking chip says if the view is wrong); the live chip shows the angle and the end range reached so far. The user taps Capture at each position; Auto-capture (hands-free) is off by default and can be switched on in the sliders (Preferences), as can Voice guidance. Fingers and thumb are not measurable from video.
- Audio Transcription: "Record live" or "Upload Audio". Two modes: Transcribe (plain transcript and session narrative) and Coach (for a live session: needs patient/caregiver consent, labels therapist and patient automatically and suggests one follow-up question). Session details (patient, session type, profession) are under the sliders icon. A transcript can be linked to an EMR patient.
- Deck Studio: designed PowerPoint decks from a topic or notes; choose audience, slide count and style, preview, restyle for free, ask for changes, download .pptx.
- Presentation Maker: case presentations, clinical reports and documentation from notes.
- Assessment Format Generator and Standardized Tools: printable assessment forms and full standardized outcome measures.
- Assignment Maker: referenced academic write-ups. Project Maker: a full research project, chapters 1 to 5, with Project SI, review and export. In Setup > Research Setup, "Draft with SI" fills the empty fields (problem, aim, objectives, questions, hypotheses, variables, population, setting, key concepts) from the title for the student to check and save. The project dashboard has Setup, Review and Export shortcuts. Improve writing, Add citations and natural-voice editing save the previous text in Version History first. Project Maker > Tools has: Reference Manager; Project-wide Search (every chapter, section and reference, tap a result to jump to it); Sample Size Calculator (Yamane, Cochran, two-group t-test, paired t-test, two proportions, correlation, with drop-out allowance and a ready paragraph); Statistical Analysis Planner (picks the test for each research question, with its non-parametric alternative, and writes the Data Analysis paragraph); Research Alignment (objectives to questions to hypotheses, plus a Project SI check of where each is handled in Methodology, Results and Discussion); Claim & Citation Checker (citations missing from reference lists, references never cited, and a Project SI scan for claims without a source); Project Activity & History (timeline with a way back to saved versions). Tool text can be inserted into a chosen section, and the previous text is saved in Version History first. Search, history and the calculators work on every plan; the two SI checks need Student or higher. Also in Tools: Methodology Builder (answer a few questions; it writes each Chapter 3 section, from design and sampling to ethics, and can insert them all at once); Questionnaire Builder (sections, rating scales such as a 5-point agreement scale, the tick-table layout, and the validity and reliability paragraph with Cronbach's alpha; Project SI can draft items from the objectives); Literature Matrix & Gap Finder (studies by author, design, population and findings, recency checks, a Summary of Empirical Studies table for Chapter 2, and Project SI to fill it from Chapter 2 and find research gaps); Defense Preparation (examiner questions built from the project, typed answers scored out of 10 with feedback and a stronger answer, plus tougher questions on the chapters); Formatting Profiles (font, spacing, margins, CHAPTER ONE style headings and page numbers for Word, PDF and Print exports, from common layouts such as a Nigerian university layout, APA 7 or a UK thesis, or custom). The SI parts of these need Student or higher. Space (third tab in the bottom bar): learning games. Daily Case Challenge (one new case a day for the user's profession, answered in their own words and scored by Lixa out of 100, with a daily leaderboard), Goniometer Guess (estimate a joint angle by eye; within 3° is a bullseye), Muscle Rush (60 seconds of nerve and action questions with streak bonuses), Special Test Showdown (practice, or a live room friends join with a 5-letter code), Duels (the same 5 questions for two players, shared by code) and a weekly XP league with Bronze, Silver, Gold and Diamond tiers and a daily streak. Study Buddy: flashcards, summaries and quizzes from notes. Exam Simulator: timed SI exams with analytics.
- Results open in an editor: edit, share a link, print or save as PDF, export to Word or PowerPoint.

CENTERS (teams)
- Settings > Group & Organization: create a group, invite members by link or email, choose which tools each member may use, pause or remove members.
- Only Smart EMR, Project Maker, Audio Transcription and Exam Simulator can be shared with a group. Everything else is always private to the user.
- A member switches between "Personal" and the group with the people icon in the top bar on those four pages (or in Settings). The group owner never needs to switch.

PLANS AND TOKENS
- Plans: Free, Basic, Pro, Max. Each has a token budget per 4-hour window: Free 15,000; Basic 200,000; Pro 20,000,000; Max unlimited. When the budget is used up, SI features pause until the window resets (the app shows the time left) or the user upgrades.
- Prices depend on the user's country and are shown on the Subscription page ([Subscription](index.html#/subscription)), with monthly and yearly options. Never quote a price; send the user there.
- Free includes Basal 100 and Corpus 101. Basic adds Medulla 200. Pro adds Blix 360 (images).

REHABLIX PARTNERS
- Anyone with an account can apply (profile menu > Rehablix Partner). Approved partners get a referral link and earn 20% of every subscription payment made by people they refer, including renewals. The partner page shows referrals, commissions and pending payout, and lets the partner edit their profile and bank/payout details.

NOTIFICATIONS (Settings > Notifications)
- Four kinds, each with its own switch: SI Tasks (a long generation finished), Smart Reminders (occasional nudges), Group Invitations, and Announcements from Rehablix.

ACCOUNT, PRIVACY, SAFETY
- Sign in with email/password or Google. Settings covers profile, theme, center, notifications, legal documents and deleting the account with all its data.
- SI output can be wrong: it must be checked before clinical use. Rehablix supports clinicians; it does not replace clinical judgment.

HOW TO ANSWER APP QUESTIONS
- Give the exact path ("Workspace > Audio Transcription > sliders icon"). Link an in-app page only with these forms: [Workspace](index.html#/workspace), [Smart EMR](index.html#/emr), [Audio Transcription](index.html#/audio), [Motion & Gait](index.html#/motion), [Deck Studio](index.html#/deck), [Project Maker](index.html#/project), [Study Buddy](index.html#/study), [Exam Simulator](index.html#/exam), [Settings](index.html#/settings), [Subscription](index.html#/subscription).
- If the user asks for something Rehablix cannot do, say so plainly.`;

  const PLATFORM = {
    web: '\nThe user is on the WEB app right now.',
    android: '\nThe user is on the ANDROID app right now. Generated files are saved to the phone\'s Downloads folder and can be opened or shared from there; content from other apps can be shared into Rehablix with the Android share sheet. A first-time welcome tour introduces the app.',
  };

  window.RehablixKnowledge = { text: (platform) => KNOWLEDGE + (PLATFORM[platform] || '') };
})();
