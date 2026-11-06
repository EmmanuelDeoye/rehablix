// js/tour/tour-steps.js — the touch-focus tutorials: one short tour per page, shown once (js/tour/tour.js).
// One source for both apps: the Android app reads the same tours from assets/tour/tour-steps.json
// (written by tests/export-tour-steps.js). Each step: key (the Android target key), sel (the web element,
// first visible match), title and text. A tour starts when its page is on screen and `when` (web: a selector
// that must be visible) is met; steps whose element is missing are skipped.
// `on`: where a tour runs. The web shows only the short what's-new highlights ('web'); the app keeps the full page
// tours ('android'); a tour without `on` runs on both. A "Don't show tips again" box turns them all off.
(function () {
  'use strict';
  const T = [
    // ---- what's new (web; the app has the same tips inside its full tours) ----
    { id: 'new.lixa', on: 'web', route: 'lixa', title: 'What\'s new', steps: [
      { key: 'lixa.agent', sel: '#chatMessages .empty-chat-icon', title: 'Meet Lixa Agent', text: 'Tap the logo to talk to Lixa out loud. She answers, and works the app for you: opening tools, filling forms, creating files.' },
      { key: 'nav.space', sel: '[data-route-tab="space"]', title: 'New: Space', text: 'A new clinical case every day, quick games, live quizzes with friends and a weekly league.' },
    ] },
    { id: 'new.projectTools', on: 'web', route: 'project', when: '#sectionEditor', title: 'What\'s new', steps: [
      { key: 'proj.tools', sel: '#toolsDropdownBtn', title: 'New project tools', text: 'The spanner opens 12 research tools: sample size, statistics, questionnaire, literature matrix, defense practice and more.' },
    ] },
    // ---- the full page tours (the app) ----
    { id: 'lixa', on: 'android', route: 'lixa', title: 'Lixa', steps: [
      { key: 'lixa.agent', sel: '#chatMessages .empty-chat-icon', title: 'Meet Lixa Agent', text: 'Tap the logo to talk to Lixa out loud. She answers, and works the app for you: opening tools, filling forms, creating files.' },
      { key: 'lixa.input', sel: '#messageInput', title: 'Ask anything', text: 'Type a clinical, study or app question here. Type @ to pick a tool, like @deck or @emr.' },
      { key: 'lixa.attach', sel: '#attachBtn', title: 'Add files', text: 'Attach PDFs, Word files, photos or audio, or take a picture. Lixa reads them with your question.' },
      { key: 'lixa.model', sel: '#modelPickerBtn', title: 'Choose a model', text: 'Pick the model for this chat. Bigger models think deeper; smaller ones answer faster.' },
      { key: 'lixa.mic', sel: '#micBtn', title: 'Speak instead', text: 'Tap to dictate your message.' },
      { key: 'lixa.send', sel: '#sendBtn', title: 'Send, or talk to Lixa', text: 'Sends your message. With nothing typed, it opens Lixa Agent: talk to her and she works the app for you.' },
      { key: 'nav.history', sel: '#historyNavBtn', title: 'Your history', text: 'Every chat and everything you create is saved here.' },
      { key: 'nav.bottom', sel: '.app-bottom-nav', title: 'Switch tabs', text: 'Lixa, Workspace for the tools, and Space: a daily case, games and a weekly league.' },
    ] },
    { id: 'workspace', on: 'android', route: 'workspace', title: 'Workspace', steps: [
      { key: 'ws.search', sel: '#searchInput', title: 'Find a tool', text: 'Search the tools by name or task. Press enter to ask Lixa instead.' },
      { key: 'ws.tools', sel: '#toolGrid .tool-card', title: 'Your main tools', text: 'Your most-used tools come first. Tap one to open it.' },
      { key: 'ws.more', sel: '#moreToolsToggle', title: 'More tools', text: 'Everything else lives here. All of it is also reachable from Lixa with @.' },
      { key: 'ws.plan', sel: '#planGlassCard', title: 'Your plan', text: 'What your plan includes and when it renews.' },
    ] },
    { id: 'space', route: 'space', when: '.sp-daily', title: 'Space', steps: [   // (new: both)
      { key: 'space.daily', sel: '.sp-daily', title: 'A new case every day', text: 'Answer today\'s case in your own words. Lixa scores it, and you see how you rank.' },
      { key: 'space.games', sel: '.sp-grid', title: 'Quick games', text: 'Goniometer Guess, Muscle Rush, special tests (alone or live with friends) and duels.' },
      { key: 'space.league', sel: '#spLeaguePeek', title: 'The weekly league', text: 'Every game earns XP. Climb from Bronze to Diamond, and keep your streak going.' },
    ] },
    { id: 'format', on: 'android', route: 'format', title: 'Assessment Format', steps: [
      { key: 'format.patient', sel: '#patientName', title: 'Who it is for', text: 'Add the patient\'s details (or leave them blank for a reusable template).' },
      { key: 'format.diagnosis', sel: '#diagnosisCategory', title: 'Diagnosis', text: 'Pick a category and a diagnosis; the format adapts its sections to it.' },
      { key: 'format.type', sel: '#assessmentType', title: 'Kind of assessment', text: 'Initial, re-assessment, discharge and more.' },
      { key: 'format.generate', sel: '#generateBtn', title: 'Generate', text: 'Builds the assessment format. You can edit, print or download it.' },
    ] },
    { id: 'standardized', on: 'android', route: 'standardized', title: 'Standardized Tools', steps: [
      { key: 'std.name', sel: '#toolName', title: 'Name the tool', text: 'Type a standardized assessment, e.g. Berg Balance Scale or Barthel Index.' },
      { key: 'std.generate', sel: '#generateBtn', title: 'Get the full tool', text: 'Generates the tool with its items, scoring and how to use it.' },
    ] },
    { id: 'audio', on: 'android', route: 'audio', title: 'Audio Transcription', steps: [
      { key: 'audio.source', sel: '#sourceModeTabs', title: 'Live or upload', text: 'Record a session live, or upload a recording you already have.' },
      { key: 'audio.start', sel: '#startSetupBtn, #uploadDropzone', title: 'Start here', text: 'Start recording, or drop your audio file here.' },
      { key: 'audio.mode', sel: '#auModeToggleBtn', title: 'What to make', text: 'Choose a transcript, session notes, or a clinical note from what was said.' },
    ] },
    { id: 'presentation', on: 'android', route: 'presentation', title: 'Presentation Studio', steps: [
      { key: 'pres.text', sel: '#textInput', title: 'Your material', text: 'Paste notes or a case, or describe what you need.' },
      { key: 'pres.files', sel: '#multiDropZone', title: 'Add files', text: 'Add reports, photos or PDFs to build from.' },
      { key: 'pres.profession', sel: '#professionSelect', title: 'Your profession', text: 'The content is pitched for this profession.' },
      { key: 'pres.generate', sel: '#generateBtn', title: 'Generate', text: 'Creates your presentation, report or documentation.' },
    ] },
    { id: 'study', on: 'android', route: 'study', when: '#viewDashboard', title: 'Study Buddy', steps: [
      { key: 'study.new', sel: '#newSubjectBtn', title: 'Add a subject', text: 'Paste notes or attach a file; Study Buddy makes flashcards, a quiz and a summary.' },
      { key: 'study.due', sel: '#dueBanner', title: 'Due today', text: 'Cards come back just before you would forget them. Review the due ones daily.' },
      { key: 'study.subjects', sel: '#subjectsGrid', title: 'Your subjects', text: 'Open a subject to study, quiz yourself or see what you have mastered.' },
    ] },
    { id: 'assignment', on: 'android', route: 'assignment', title: 'Assignment Maker', steps: [
      { key: 'asg.topic', sel: '#topicInput', title: 'The topic', text: 'Type the question or topic exactly as it was given.' },
      { key: 'asg.attach', sel: '#assignAttachBtn', title: 'Add material', text: 'Attach lecture notes or a photo of the question.' },
      { key: 'asg.type', sel: '#assignmentType', title: 'Type and length', text: 'Essay, report, case study…, and how long it should be.' },
      { key: 'asg.generate', sel: '#generateBtn', title: 'Write it', text: 'Writes a referenced draft you can edit and download.' },
    ] },
    { id: 'exam', on: 'android', route: 'exam', when: '#viewSetup', title: 'Exam Simulator', steps: [
      { key: 'exam.subject', sel: '#subjectInput', title: 'Subject', text: 'What the exam covers. Add notes below to base it on your own material.' },
      { key: 'exam.settings', sel: '#questionCount', title: 'Questions and time', text: 'Choose how many questions and how long you have.' },
      { key: 'exam.difficulty', sel: '#difficultySelect', title: 'Difficulty', text: 'From revision to hard exam level.' },
      { key: 'exam.start', sel: '#startExamBtn', title: 'Start', text: 'A timed exam with instant marking and a breakdown by topic.' },
    ] },
    { id: 'motion', on: 'android', route: 'motion', title: 'Motion & Gait', steps: [
      { key: 'motion.record', sel: '#motionRecordBtn', title: 'Record', text: 'Set up a range-of-motion or gait scan, then film the patient.' },
      { key: 'motion.prefs', sel: '#motionPrefsBtn', title: 'Scan settings', text: 'Choose the movement, side, voice guidance and auto-capture.' },
      { key: 'motion.camera', sel: '#motionCameraSettingsBtn', title: 'Camera', text: 'Adjust brightness and contrast for a clearer picture.' },
    ] },
    { id: 'deck', on: 'android', route: 'deck', when: '#deckForm', title: 'Deck Studio', steps: [
      { key: 'deck.topic', sel: '#deckTopic', title: 'Your topic', text: 'Describe the talk: topic, audience and what they should take away.' },
      { key: 'deck.style', sel: '#deckStyles', title: 'Pick a style', text: 'Each style is a full designed look for your slides.' },
      { key: 'deck.generate', sel: '#deckGenerateBtn', title: 'Design my deck', text: 'Builds the slides; download them as PowerPoint.' },
    ] },
    { id: 'whiteboard', on: 'android', route: 'whiteboard', when: '#wbpTopic', title: 'Whiteboard', steps: [
      { key: 'wb.topic', sel: '#wbpTopic', title: 'What to explain', text: 'Any rehab topic. Lixa draws it step by step while she explains.' },
      { key: 'wb.length', sel: '#wbpLength', title: 'How long', text: 'A quick sketch or a fuller lesson.' },
      { key: 'wb.draw', sel: '#wbpDraw', title: 'Draw it', text: 'Starts the lesson. You can pause, replay and save it.' },
    ] },
    { id: 'emr', on: 'android', route: 'emr', when: '#screen-dashboard', title: 'Smart EMR', steps: [
      { key: 'emr.intake', sel: '#dashNewIntakeBtn', title: 'New patient', text: 'Admit a patient in a minute; add more later.' },
      { key: 'emr.session', sel: '#dashStartSessionBtn', title: 'Start a session', text: 'Pick a patient and document a session; SI drafts the note.' },
      { key: 'emr.stats', sel: '#dashStats', title: 'At a glance', text: 'Your caseload and the notes still waiting.' },
      { key: 'emr.search', sel: '#emrSearchToggle', title: 'Find a patient', text: 'Search by name, diagnosis or number.' },
    ] },
    { id: 'project.list', on: 'android', route: 'project', when: '#projScreenProjects #projectsNewBtn', title: 'Project Maker', steps: [
      { key: 'proj.new', sel: '#projectsNewBtn', title: 'Start a project', text: 'Give it a title; Project SI helps you set up and write each chapter.' },
      { key: 'proj.search', sel: '#projectsSearchInput', title: 'Your projects', text: 'Find any project you started, on the web or the app.' },
    ] },
    { id: 'project.dashboard', on: 'android', route: 'project', when: '#projScreenDashboard #dashRealContent', title: 'Project dashboard', steps: [
      { key: 'proj.continue', sel: '#dashContinueBtn', title: 'Continue writing', text: 'Opens the next section to work on.' },
      { key: 'proj.shortcuts', sel: '.dash-shortcuts', title: 'Setup, Review, Export', text: 'Set up your research, review a chapter with SI, or export to Word and PDF.' },
      { key: 'proj.chapters', sel: '#dashChapterRail', title: 'Chapter progress', text: 'Where each chapter stands.' },
    ] },
    { id: 'project.editor', on: 'android', route: 'project', when: '#sectionEditor', title: 'Chapter editor', steps: [
      { key: 'proj.toc', sel: '#toggleChaptersBtn', title: 'Chapters', text: 'Jump to any chapter and section.' },
      { key: 'proj.editor', sel: '#sectionEditor', title: 'Write here', text: 'Your section. It saves as you type.' },
      { key: 'proj.generate', sel: '#genDropdownWrap', title: 'Write with SI', text: 'Generate this section, or continue, improve or add citations.' },
      { key: 'proj.tools', sel: '#toolsDropdownBtn', title: 'Tools', text: 'Sample size, statistics, questionnaire, defense practice and more.' },
      { key: 'proj.versions', sel: '#versionHistoryIconBtn', title: 'Versions', text: 'Every change can be undone from here.' },
    ] },
    { id: 'result', on: 'android', route: 'result', when: '#editorContent', title: 'Editor', steps: [
      { key: 'ed.content', sel: '#editorContent', title: 'Edit freely', text: 'Tap anywhere in the document to change it. It saves automatically.' },
      { key: 'ed.font', sel: '#fontFamilySelect', title: 'Font and size', text: 'Change how the document looks.' },
      { key: 'ed.download', sel: '#downloadBtn, #pdfBtn', title: 'Download', text: 'Save it as Word or PDF, or print it.' },
      { key: 'ed.share', sel: '#shareBtn', title: 'Share', text: 'Send a link by WhatsApp, email and more.' },
    ] },
    { id: 'docresult', on: 'android', route: 'docresult', when: '#editorContent', title: 'Document editor', steps: [
      { key: 'ed.content', sel: '#editorContent', title: 'Edit freely', text: 'Tap anywhere in the document to change it. It saves automatically.' },
      { key: 'doc.regenerate', sel: '#regenerateInstructions', title: 'Ask for changes', text: 'Tell SI what to change and regenerate the document.' },
      { key: 'ed.download', sel: '#downloadBtn, #pdfBtn', title: 'Download', text: 'Save it as Word or PDF, or print it.' },
    ] },
    { id: 'formatview', on: 'android', route: 'formatview', when: '#formatViewEditBtn', title: 'Assessment Format', steps: [
      { key: 'fv.edit', sel: '#formatViewEditBtn', title: 'Edit', text: 'Change any part of the format.' },
      { key: 'fv.download', sel: '#formatViewDownloadBtn', title: 'Download', text: 'Save it as a file, or print it.' },
      { key: 'fv.share', sel: '#formatViewShareBtn', title: 'Share', text: 'Send it to a colleague.' },
    ] },
    { id: 'audioview', on: 'android', route: 'audioview', when: '#audioViewEditBtn', title: 'Transcript', steps: [
      { key: 'av.edit', sel: '#audioViewEditBtn', title: 'Edit', text: 'Correct the transcript or note.' },
      { key: 'av.download', sel: '#audioViewDownloadBtn', title: 'Download', text: 'Save it as a file, or print it.' },
      { key: 'av.share', sel: '#audioViewShareBtn', title: 'Share', text: 'Send it to a colleague.' },
    ] },
  ];
  if (typeof window !== 'undefined') window.RehablixTourSteps = T;
  if (typeof module !== 'undefined' && module.exports) module.exports = T;
})();
