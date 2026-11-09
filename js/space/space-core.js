// js/space/space-core.js — Rehablix Space: the games' content and rules (no DOM, no Firebase, no AI).
// Question banks (muscles, special tests), question builders, scoring, XP, the weekly league, streaks and the
// Goniometer Guess figures. Pure, so tests/space-core.test.js checks it in Node, and the Android app reads the
// same banks (assets/space/space-data.json, written by tests/export-space-data.js) so both ask the same questions.
(function () {
  'use strict';
  const S = {};

  // ------------------------------------------------------------------ question banks
  // Muscles: name, region, nerve (as taught), nerve keys (for choosing fair wrong answers), main action, movement keys.
  S.MUSCLES = [
    ['deltoid', 'Deltoid', 'Shoulder', 'Axillary nerve', ['axillary'], 'Shoulder abduction (beyond the first 15°)', ['shAbd']],
    ['supraspinatus', 'Supraspinatus', 'Shoulder', 'Suprascapular nerve', ['suprascapular'], 'Starts shoulder abduction (first 15°)', ['shAbd']],
    ['infraspinatus', 'Infraspinatus', 'Shoulder', 'Suprascapular nerve', ['suprascapular'], 'Shoulder lateral rotation', ['shLat']],
    ['teresMinor', 'Teres minor', 'Shoulder', 'Axillary nerve', ['axillary'], 'Shoulder lateral rotation', ['shLat']],
    ['subscapularis', 'Subscapularis', 'Shoulder', 'Upper and lower subscapular nerves', ['subscapular'], 'Shoulder medial rotation', ['shMed']],
    ['teresMajor', 'Teres major', 'Shoulder', 'Lower subscapular nerve', ['subscapular'], 'Shoulder medial rotation and adduction', ['shMed', 'shAdd']],
    ['latissimus', 'Latissimus dorsi', 'Shoulder', 'Thoracodorsal nerve', ['thoracodorsal'], 'Shoulder extension, adduction and medial rotation', ['shExt', 'shAdd', 'shMed']],
    ['pecMajor', 'Pectoralis major', 'Shoulder', 'Medial and lateral pectoral nerves', ['pectoral'], 'Shoulder adduction and medial rotation', ['shAdd', 'shMed']],
    ['pecMinor', 'Pectoralis minor', 'Shoulder girdle', 'Medial pectoral nerve', ['pectoral'], 'Scapular protraction and depression', ['scProt', 'scDep']],
    ['serratusAnterior', 'Serratus anterior', 'Shoulder girdle', 'Long thoracic nerve', ['longThoracic'], 'Scapular protraction and upward rotation', ['scProt', 'scUp']],
    ['trapezius', 'Trapezius', 'Shoulder girdle', 'Accessory nerve (CN XI)', ['accessory'], 'Scapular elevation, retraction and upward rotation', ['scElev', 'scRet', 'scUp']],
    ['rhomboidMajor', 'Rhomboid major', 'Shoulder girdle', 'Dorsal scapular nerve', ['dorsalScapular'], 'Scapular retraction', ['scRet']],
    ['levatorScapulae', 'Levator scapulae', 'Shoulder girdle', 'Dorsal scapular nerve and cervical nerves (C3–C4)', ['dorsalScapular'], 'Scapular elevation', ['scElev']],
    ['coracobrachialis', 'Coracobrachialis', 'Arm', 'Musculocutaneous nerve', ['musculocutaneous'], 'Shoulder flexion and adduction', ['shFlex', 'shAdd']],
    ['biceps', 'Biceps brachii', 'Arm', 'Musculocutaneous nerve', ['musculocutaneous'], 'Elbow flexion and forearm supination', ['elbFlex', 'sup']],
    ['brachialis', 'Brachialis', 'Arm', 'Musculocutaneous nerve', ['musculocutaneous'], 'Elbow flexion (in any forearm position)', ['elbFlex']],
    ['brachioradialis', 'Brachioradialis', 'Forearm', 'Radial nerve', ['radial'], 'Elbow flexion with the forearm mid-prone', ['elbFlex']],
    ['triceps', 'Triceps brachii', 'Arm', 'Radial nerve', ['radial'], 'Elbow extension', ['elbExt']],
    ['pronatorTeres', 'Pronator teres', 'Forearm', 'Median nerve', ['median'], 'Forearm pronation', ['pron']],
    ['supinator', 'Supinator', 'Forearm', 'Posterior interosseous nerve (deep branch of the radial nerve)', ['radial'], 'Forearm supination', ['sup']],
    ['fcr', 'Flexor carpi radialis', 'Forearm', 'Median nerve', ['median'], 'Wrist flexion and radial deviation', ['wrFlex', 'wrRad']],
    ['fcu', 'Flexor carpi ulnaris', 'Forearm', 'Ulnar nerve', ['ulnar'], 'Wrist flexion and ulnar deviation', ['wrFlex', 'wrUln']],
    ['ecrl', 'Extensor carpi radialis longus', 'Forearm', 'Radial nerve', ['radial'], 'Wrist extension and radial deviation', ['wrExt', 'wrRad']],
    ['ecu', 'Extensor carpi ulnaris', 'Forearm', 'Posterior interosseous nerve (deep branch of the radial nerve)', ['radial'], 'Wrist extension and ulnar deviation', ['wrExt', 'wrUln']],
    ['fds', 'Flexor digitorum superficialis', 'Forearm', 'Median nerve', ['median'], 'Flexion of the fingers at the PIP joints', ['fingFlex']],
    ['fdp', 'Flexor digitorum profundus', 'Forearm', 'Median (anterior interosseous) and ulnar nerves', ['median', 'ulnar'], 'Flexion of the fingers at the DIP joints', ['fingFlex']],
    ['extensorDigitorum', 'Extensor digitorum', 'Forearm', 'Posterior interosseous nerve (deep branch of the radial nerve)', ['radial'], 'Extension of the fingers', ['fingExt']],
    ['apb', 'Abductor pollicis brevis', 'Hand', 'Median nerve (recurrent branch)', ['median'], 'Thumb abduction', ['thAbd']],
    ['opponensPollicis', 'Opponens pollicis', 'Hand', 'Median nerve (recurrent branch)', ['median'], 'Thumb opposition', ['thOpp']],
    ['adductorPollicis', 'Adductor pollicis', 'Hand', 'Ulnar nerve (deep branch)', ['ulnar'], 'Thumb adduction', ['thAdd']],
    ['dorsalInterossei', 'Dorsal interossei', 'Hand', 'Ulnar nerve (deep branch)', ['ulnar'], 'Finger abduction (DAB)', ['fingAbd']],
    ['palmarInterossei', 'Palmar interossei', 'Hand', 'Ulnar nerve (deep branch)', ['ulnar'], 'Finger adduction (PAD)', ['fingAdd']],
    ['lumbricals', 'Lumbricals', 'Hand', 'Median (1st and 2nd) and ulnar (3rd and 4th) nerves', ['median', 'ulnar'], 'MCP flexion with IP extension of the fingers', ['lumb']],
    ['diaphragm', 'Diaphragm', 'Trunk', 'Phrenic nerve', ['phrenic'], 'Main muscle of inspiration', ['insp']],
    ['scm', 'Sternocleidomastoid', 'Neck', 'Accessory nerve (CN XI)', ['accessory'], 'Neck flexion and rotation of the head to the opposite side', ['neck']],
    ['iliopsoas', 'Iliopsoas', 'Hip', 'Femoral nerve (iliacus) and lumbar ventral rami (psoas)', ['femoral', 'lumbar'], 'Hip flexion', ['hipFlex']],
    ['gluteusMaximus', 'Gluteus maximus', 'Hip', 'Inferior gluteal nerve', ['inferiorGluteal'], 'Hip extension and lateral rotation', ['hipExt', 'hipLat']],
    ['gluteusMedius', 'Gluteus medius', 'Hip', 'Superior gluteal nerve', ['superiorGluteal'], 'Hip abduction; keeps the pelvis level in single-leg stance', ['hipAbd']],
    ['gluteusMinimus', 'Gluteus minimus', 'Hip', 'Superior gluteal nerve', ['superiorGluteal'], 'Hip abduction and medial rotation', ['hipAbd', 'hipMed']],
    ['tfl', 'Tensor fasciae latae', 'Hip', 'Superior gluteal nerve', ['superiorGluteal'], 'Hip flexion, abduction and medial rotation', ['hipFlex', 'hipAbd', 'hipMed']],
    ['piriformis', 'Piriformis', 'Hip', 'Nerve to piriformis', ['sacralPlexus'], 'Hip lateral rotation', ['hipLat']],
    ['adductorLongus', 'Adductor longus', 'Thigh', 'Obturator nerve', ['obturator'], 'Hip adduction', ['hipAdd']],
    ['sartorius', 'Sartorius', 'Thigh', 'Femoral nerve', ['femoral'], 'Hip flexion, abduction and lateral rotation, and knee flexion', ['hipFlex', 'hipAbd', 'hipLat', 'kneeFlex']],
    ['rectusFemoris', 'Rectus femoris', 'Thigh', 'Femoral nerve', ['femoral'], 'Knee extension and hip flexion', ['kneeExt', 'hipFlex']],
    ['vastusMedialis', 'Vastus medialis', 'Thigh', 'Femoral nerve', ['femoral'], 'Knee extension', ['kneeExt']],
    ['bicepsFemoris', 'Biceps femoris', 'Thigh', 'Sciatic nerve (tibial part, long head; common fibular part, short head)', ['sciatic', 'tibial', 'commonFibular'], 'Knee flexion; hip extension (long head)', ['kneeFlex', 'hipExt']],
    ['semitendinosus', 'Semitendinosus', 'Thigh', 'Sciatic nerve (tibial part)', ['sciatic', 'tibial'], 'Knee flexion and hip extension', ['kneeFlex', 'hipExt']],
    ['popliteus', 'Popliteus', 'Knee', 'Tibial nerve', ['tibial'], 'Unlocks the extended knee', ['kneeUnlock']],
    ['gastrocnemius', 'Gastrocnemius', 'Leg', 'Tibial nerve', ['tibial'], 'Ankle plantarflexion and knee flexion', ['pf', 'kneeFlex']],
    ['soleus', 'Soleus', 'Leg', 'Tibial nerve', ['tibial'], 'Ankle plantarflexion', ['pf']],
    ['tibialisAnterior', 'Tibialis anterior', 'Leg', 'Deep fibular (peroneal) nerve', ['deepFibular', 'commonFibular'], 'Ankle dorsiflexion and foot inversion', ['df', 'inv']],
    ['tibialisPosterior', 'Tibialis posterior', 'Leg', 'Tibial nerve', ['tibial'], 'Ankle plantarflexion and foot inversion', ['pf', 'inv']],
    ['fibularisLongus', 'Fibularis (peroneus) longus', 'Leg', 'Superficial fibular (peroneal) nerve', ['superficialFibular', 'commonFibular'], 'Foot eversion and ankle plantarflexion', ['ev', 'pf']],
    ['ehl', 'Extensor hallucis longus', 'Leg', 'Deep fibular (peroneal) nerve', ['deepFibular', 'commonFibular'], 'Extension of the big toe', ['toeExt']],
  ].map(([id, name, region, nerve, nerves, action, tags]) => ({ id, name, region, nerve, nerves, action, tags }));

  // Special tests: name, region, how it is done, what a positive result suggests, a key for the condition (two tests
  // for the same condition are never each other's wrong answer).
  S.SPECIAL_TESTS = [
    ['lachman', 'Lachman test', 'Knee', 'Patient supine with the knee flexed 20–30°. The examiner stabilises the femur and draws the tibia forward.', 'Anterior cruciate ligament (ACL) tear', 'acl'],
    ['antDrawerKnee', 'Anterior drawer test (knee)', 'Knee', 'Patient supine, knee flexed to 90° and the foot held down. The examiner pulls the proximal tibia forward.', 'Anterior cruciate ligament (ACL) tear', 'acl'],
    ['postDrawer', 'Posterior drawer test', 'Knee', 'Patient supine, knee flexed to 90° and the foot held down. The examiner pushes the proximal tibia backward.', 'Posterior cruciate ligament (PCL) tear', 'pcl'],
    ['mcmurray', 'McMurray test', 'Knee', 'Knee fully flexed; the examiner rotates the tibia and extends the knee, feeling the joint line for a click.', 'Meniscal tear', 'meniscus'],
    ['thessaly', 'Thessaly test', 'Knee', 'Patient stands on one leg with the knee flexed 20° and twists the body side to side.', 'Meniscal tear', 'meniscus'],
    ['valgusKnee', 'Valgus stress test (knee)', 'Knee', 'Patient supine; the examiner pushes the knee inward (valgus) at 0° and at 30° of flexion.', 'Medial collateral ligament (MCL) injury', 'mcl'],
    ['varusKnee', 'Varus stress test (knee)', 'Knee', 'Patient supine; the examiner pushes the knee outward (varus) at 0° and at 30° of flexion.', 'Lateral collateral ligament (LCL) injury', 'lcl'],
    ['patellarApprehension', 'Patellar apprehension test', 'Knee', 'Knee slightly flexed and relaxed; the examiner glides the patella laterally and watches the patient\'s face.', 'Patellar instability (previous dislocation)', 'patella'],
    ['ober', 'Ober\'s test', 'Hip', 'Patient side-lying; the top hip is abducted and extended, then lowered toward the table.', 'Iliotibial band / TFL tightness', 'itb'],
    ['thomas', 'Thomas test', 'Hip', 'Patient supine at the edge of the plinth hugs one knee to the chest; the examiner watches the other thigh.', 'Hip flexor tightness', 'hipFlexors'],
    ['faber', 'FABER (Patrick\'s) test', 'Hip', 'Patient supine with the leg in a figure-of-four; the examiner presses the bent knee toward the table.', 'Hip joint or sacroiliac joint pathology', 'hipSij'],
    ['trendelenburg', 'Trendelenburg test', 'Hip', 'Patient stands on one leg; the examiner watches the level of the pelvis on the lifted side.', 'Weak hip abductors (gluteus medius) on the standing side', 'gmed'],
    ['slr', 'Straight leg raise (Lasègue)', 'Lumbar spine', 'Patient supine; the examiner lifts the straight leg, noting leg pain between about 30° and 70°.', 'Lumbar nerve root irritation (L5/S1)', 'lumbarRoot'],
    ['slump', 'Slump test', 'Lumbar spine', 'Patient sits slumped, flexes the neck, then straightens the knee and dorsiflexes the ankle.', 'Neural tension (sciatic nerve / dura)', 'neuralLower'],
    ['femoralStretch', 'Femoral nerve stretch test', 'Lumbar spine', 'Patient prone; the examiner bends the knee and may extend the hip, noting anterior thigh pain.', 'Upper lumbar (L2–L4) nerve root irritation', 'upperLumbar'],
    ['stork', 'Stork test (one-leg standing lumbar extension)', 'Lumbar spine', 'Patient stands on one leg and leans back into lumbar extension.', 'Pars interarticularis stress (spondylolysis)', 'spondylolysis'],
    ['gaenslen', 'Gaenslen\'s test', 'Pelvis', 'Patient supine at the plinth edge; one hip is held fully flexed while the other leg drops into extension.', 'Sacroiliac joint pain', 'sij'],
    ['spurling', 'Spurling\'s test', 'Cervical spine', 'The examiner extends and side-bends the neck toward the symptoms, then presses down on the head.', 'Cervical radiculopathy (nerve root compression)', 'cervicalRoot'],
    ['ultt1', 'Upper limb tension test 1 (ULTT1)', 'Cervical spine', 'Shoulder depressed and abducted, forearm supinated, wrist and fingers extended, elbow then extended.', 'Median nerve neural tension', 'neuralUpper'],
    ['neer', 'Neer\'s test', 'Shoulder', 'With the scapula held, the examiner lifts the internally rotated, straight arm into full forward flexion.', 'Subacromial impingement', 'impingement'],
    ['hawkins', 'Hawkins–Kennedy test', 'Shoulder', 'Shoulder and elbow flexed to 90°; the examiner forces the shoulder into internal rotation.', 'Subacromial impingement', 'impingement'],
    ['emptyCan', 'Empty can (Jobe\'s) test', 'Shoulder', 'Arms at 90° in the scapular plane with thumbs pointing down; the patient resists downward pressure.', 'Supraspinatus weakness or tear', 'supraspinatus'],
    ['dropArm', 'Drop arm test', 'Shoulder', 'The arm is lifted to 90° of abduction and the patient lowers it slowly.', 'Rotator cuff (supraspinatus) tear', 'cuffTear'],
    ['speed', 'Speed\'s test', 'Shoulder', 'Patient resists shoulder flexion with the elbow straight and the forearm supinated.', 'Biceps (long head) tendinopathy or SLAP lesion', 'bicepsLongHead'],
    ['yergason', 'Yergason\'s test', 'Shoulder', 'Elbow at 90° and forearm pronated; the patient resists supination and lateral rotation.', 'Biceps tendon instability in the bicipital groove', 'bicepsGroove'],
    ['apprehensionShoulder', 'Apprehension test (shoulder)', 'Shoulder', 'Patient supine; the shoulder is abducted to 90° and slowly taken into external rotation.', 'Anterior shoulder instability', 'antInstability'],
    ['sulcus', 'Sulcus sign', 'Shoulder', 'Arm relaxed by the side; the examiner pulls the arm downward and looks below the acromion.', 'Inferior shoulder instability', 'infInstability'],
    ['cozen', 'Cozen\'s test', 'Elbow', 'Fist clenched and forearm pronated; the patient resists wrist extension and radial deviation.', 'Lateral epicondylalgia (tennis elbow)', 'tennisElbow'],
    ['phalen', 'Phalen\'s test', 'Wrist and hand', 'Both wrists are held in full flexion, back to back, for about 60 seconds.', 'Carpal tunnel syndrome', 'carpalTunnel'],
    ['finkelstein', 'Finkelstein\'s test', 'Wrist and hand', 'The thumb is tucked into the fist and the wrist is moved into ulnar deviation.', 'De Quervain\'s tenosynovitis', 'deQuervain'],
    ['froment', 'Froment\'s sign', 'Wrist and hand', 'The patient pinches a sheet of paper between thumb and index finger while the examiner pulls it away.', 'Ulnar nerve palsy (weak adductor pollicis)', 'ulnarPalsy'],
    ['allen', 'Allen\'s test', 'Wrist and hand', 'Both arteries at the wrist are compressed while the patient makes a fist, then one is released.', 'Patency of the radial and ulnar arteries', 'vascularHand'],
    ['thompson', 'Thompson (Simmonds) test', 'Ankle and foot', 'Patient prone with the feet over the edge; the examiner squeezes the calf.', 'Achilles tendon rupture', 'achilles'],
    ['antDrawerAnkle', 'Anterior drawer test (ankle)', 'Ankle and foot', 'The examiner holds the lower tibia and pulls the heel forward.', 'Anterior talofibular ligament (ATFL) injury', 'atfl'],
    ['romberg', 'Romberg test', 'Neurological', 'Patient stands with the feet together, then closes the eyes.', 'Sensory (proprioceptive) ataxia', 'proprioception'],
    ['babinski', 'Babinski sign', 'Neurological', 'The examiner strokes the lateral sole from heel to toes.', 'Upper motor neuron lesion', 'umn'],
    ['hoffmann', 'Hoffmann\'s sign', 'Neurological', 'The examiner flicks the nail of the middle finger and watches the thumb and index finger.', 'Upper motor neuron lesion (e.g. cervical myelopathy)', 'umn'],
  ].map(([id, name, region, how, finding, cond]) => ({ id, name, region, how, finding, cond }));

  // ------------------------------------------------------------------ random numbers
  // mulberry32: small, seedable, the same on every platform.
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  S.rng = rng;
  const pick = (r, list) => list[Math.floor(r() * list.length)];
  function shuffle(r, list) { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  S.shuffle = shuffle;
  const overlap = (a, b) => a.some((x) => b.indexOf(x) >= 0);

  // A question: { kind, id, prompt, options: [text], answer: index of the right option }.
  function finish(r, kind, id, prompt, right, wrongs) {
    const opts = shuffle(r, [right].concat(wrongs.slice(0, 3)));
    return { kind, id, prompt, options: opts, answer: opts.indexOf(right) };
  }
  // three different wrong answers from `pool` (texts), never equal to the right one
  function threeWrong(r, pool, right) {
    const seen = new Set([right]), out = [];
    shuffle(r, pool).forEach((t) => { if (out.length < 3 && !seen.has(t)) { seen.add(t); out.push(t); } });
    return out;
  }

  S.MUSCLE_KINDS = ['nerve', 'action', 'muscleOfNerve', 'muscleOfAction'];
  function muscleQuestion(r, kind, muscleId) {
    const m = muscleId ? S.MUSCLES.find((x) => x.id === muscleId) : pick(r, S.MUSCLES);
    kind = kind || pick(r, S.MUSCLE_KINDS);
    const others = S.MUSCLES.filter((x) => x.id !== m.id);
    if (kind === 'nerve') return finish(r, kind, m.id, 'Which nerve supplies ' + m.name + '?', m.nerve, threeWrong(r, others.filter((x) => !overlap(x.nerves, m.nerves)).map((x) => x.nerve), m.nerve));
    if (kind === 'action') return finish(r, kind, m.id, 'What is the main action of ' + m.name + '?', m.action, threeWrong(r, others.filter((x) => !overlap(x.tags, m.tags)).map((x) => x.action), m.action));
    if (kind === 'muscleOfNerve') return finish(r, kind, m.id, 'Which muscle is supplied by the ' + m.nerve.charAt(0).toLowerCase() + m.nerve.slice(1) + '?', m.name, threeWrong(r, others.filter((x) => !overlap(x.nerves, m.nerves)).map((x) => x.name), m.name));
    return finish(r, 'muscleOfAction', m.id, S.actionPrompt(m.action), m.name, threeWrong(r, others.filter((x) => !overlap(x.tags, m.tags)).map((x) => x.name), m.name));
  }
  // "Which muscle's main action is …?", reworded for the actions written as phrases (Android: SpaceCore.actionPrompt)
  S.actionPrompt = (action) => {
    const a = action.charAt(0).toLowerCase() + action.slice(1);
    if (/^Main muscle/.test(action)) return 'Which muscle is the ' + a + '?';
    if (/^(Starts|Unlocks) /.test(action)) return 'Which muscle ' + a + '?';
    return 'Which muscle\'s main action is ' + a + '?';
  };
  S.muscleQuestion = muscleQuestion;

  S.TEST_KINDS = ['testName', 'testFinding'];
  function testQuestion(r, kind, testId) {
    const t = testId ? S.SPECIAL_TESTS.find((x) => x.id === testId) : pick(r, S.SPECIAL_TESTS);
    kind = kind || pick(r, S.TEST_KINDS);
    const others = S.SPECIAL_TESTS.filter((x) => x.id !== t.id && x.cond !== t.cond);
    if (kind === 'testName') {
      // wrong answers from the same body region first, so the question is about the test, not the region
      const same = others.filter((x) => x.region === t.region).map((x) => x.name);
      const wr = threeWrong(r, same, t.name);
      const rest = wr.length < 3 ? threeWrong(r, others.map((x) => x.name).filter((n) => wr.indexOf(n) < 0), t.name).slice(0, 3 - wr.length) : [];
      return finish(r, kind, t.id, t.how, t.name, wr.concat(rest));
    }
    return finish(r, 'testFinding', t.id, 'A positive ' + t.name + ' suggests:', t.finding, threeWrong(r, others.map((x) => x.finding), t.finding));
  }
  S.testQuestion = testQuestion;

  // A set of n different questions (no item twice) for a game; game: 'muscles' | 'tests'.
  function questionSet(game, n, seed) {
    const r = rng(seed);
    const bank = game === 'tests' ? S.SPECIAL_TESTS : S.MUSCLES;
    return shuffle(r, bank).slice(0, n).map((item) => game === 'tests' ? testQuestion(r, null, item.id) : muscleQuestion(r, null, item.id));
  }
  S.questionSet = questionSet;

  // ------------------------------------------------------------------ scoring and XP
  // Muscle Rush: 10 a correct answer, +2 for every answer in the current streak (up to +10).
  S.rushPoints = (streakBefore) => 10 + Math.min(streakBefore, 5) * 2;
  S.RUSH_SECONDS = 60;
  // Live rooms: 500 for a right answer, up to 500 more for speed.
  S.ROOM_SECONDS = 15;
  S.roomPoints = (correct, msTaken) => correct ? Math.round(500 + 500 * Math.max(0, 1 - msTaken / (S.ROOM_SECONDS * 1000))) : 0;

  S.xp = {
    goniometer: (total) => Math.round(Math.max(0, Math.min(500, total)) / 10),       // up to 50
    rush: (score) => Math.min(60, Math.round(Math.max(0, score) / 10)),
    tests: (correct) => Math.max(0, correct) * 4,
    room: (rank, players) => 10 + Math.max(0, players - rank) * 5,
    duel: (correct, won) => Math.max(0, correct) * 4 + (won ? 15 : 0),
    daily: (score) => Math.round(Math.max(0, Math.min(100, score)) / 2),           // up to 50
  };

  // ------------------------------------------------------------------ days, weeks, streaks, league
  const pad = (n) => (n < 10 ? '0' : '') + n;
  // The shared day for the Daily Case (UTC, so everyone everywhere gets the same case).
  S.dayKey = (d) => { d = d || new Date(); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
  // ISO week (Monday start, UTC): '2026-W45'.
  S.weekKey = (d) => {
    d = d || new Date();
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const wk = Math.ceil(((t - y0) / 86400000 + 1) / 7);
    return t.getUTCFullYear() + '-W' + pad(wk);
  };
  // The streak after playing on `today` (day keys): same day keeps it, the next day adds one, a gap starts again.
  S.nextStreak = (lastDay, streak, today) => {
    if (lastDay === today) return Math.max(1, streak || 1);
    const prev = new Date(Date.parse(today + 'T00:00:00Z') - 86400000);
    return lastDay === S.dayKey(prev) ? (streak || 0) + 1 : 1;
  };
  S.TIERS = [['Bronze', 0], ['Silver', 100], ['Gold', 300], ['Diamond', 700]];
  S.tierOf = (xp) => { let t = S.TIERS[0]; S.TIERS.forEach((x) => { if (xp >= x[1]) t = x; }); const i = S.TIERS.indexOf(t); return { name: t[0], from: t[1], next: S.TIERS[i + 1] ? S.TIERS[i + 1][1] : null }; };

  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  S.roomCode = (r) => { let c = ''; for (let i = 0; i < 5; i++) c += CODE_CHARS[Math.floor(r() * CODE_CHARS.length)]; return c; };
  S.cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

  // ------------------------------------------------------------------ Goniometer Guess
  // Each joint: a side or front view drawn in a 320 × 260 box. The angle is the clinical range of motion: 0 is the
  // anatomical position, where the moving segment points along `zero` (degrees, screen y down: 0 right, 90 down);
  // it turns `sign` × angle from there (−1: toward the top / front of the picture).
  S.JOINTS = {
    elbowFlex: { name: 'Elbow flexion', view: 'Side view, facing right', min: 0, max: 145, pivot: [150, 150], zero: 90, sign: -1, len: 92 },
    kneeFlex: { name: 'Knee flexion (prone)', view: 'Side view, lying face down', min: 0, max: 135, pivot: [170, 188], zero: 0, sign: -1, len: 96 },
    shoulderAbd: { name: 'Shoulder abduction', view: 'Front view', min: 0, max: 180, pivot: [150, 100], zero: 90, sign: -1, len: 88 },
    hipFlex: { name: 'Hip flexion (straight leg, supine)', view: 'Side view, lying on the back', min: 0, max: 90, pivot: [150, 200], zero: 0, sign: -1, len: 112 },
  };
  const rad = (d) => (d * Math.PI) / 180;
  const r1 = (v) => Math.round(v * 10) / 10;
  const toward = (p, deg, len) => [r1(p[0] + len * Math.cos(rad(deg))), r1(p[1] + len * Math.sin(rad(deg)))];
  // The figure for a joint at an angle: limb segments (thick lines), circles (head, hand, foot), and the goniometer:
  // a dashed zero line, the moving arm along the limb, and the arc between them. The same numbers drive the web SVG
  // and the Android Canvas.
  function goniometerFigure(jointId, angle) {
    const j = S.JOINTS[jointId];
    const p = j.pivot;
    const dir = j.zero + j.sign * angle;
    const end = toward(p, dir, j.len);
    const segs = [], circles = [];
    if (jointId === 'elbowFlex') {
      circles.push({ x: 150, y: 28, r: 16, body: true });                         // head
      segs.push({ a: [150, 52], b: [146, 190], w: 34, body: true });              // trunk
      segs.push({ a: [146, 190], b: [150, 250], w: 20, body: true });             // leg
      segs.push({ a: [150, 62], b: p, w: 16 });                                   // upper arm (fixed)
      segs.push({ a: p, b: end, w: 13 });                                         // forearm (moving)
      circles.push({ x: end[0], y: end[1], r: 8 });                               // hand
    } else if (jointId === 'kneeFlex') {
      circles.push({ x: 24, y: 182, r: 14, body: true });                         // head (face down)
      segs.push({ a: [44, 188], b: [60, 188], w: 30, body: true });               // trunk
      segs.push({ a: [60, 188], b: p, w: 22 });                                   // thigh (fixed)
      segs.push({ a: p, b: end, w: 16 });                                         // leg (moving)
      circles.push({ x: end[0], y: end[1], r: 8 });                               // foot
    } else if (jointId === 'shoulderAbd') {
      circles.push({ x: 120, y: 64, r: 17, body: true });                         // head
      segs.push({ a: [120, 90], b: [120, 200], w: 52, body: true });              // trunk
      segs.push({ a: [106, 200], b: [104, 255], w: 18, body: true }, { a: [134, 200], b: [136, 255], w: 18, body: true }); // legs
      segs.push({ a: [92, 100], b: [88, 186], w: 14, body: true });               // the other arm, by the side
      segs.push({ a: p, b: end, w: 14 });                                         // arm (moving)
      circles.push({ x: end[0], y: end[1], r: 8 });                               // hand
    } else {
      circles.push({ x: 24, y: 194, r: 14, body: true });                         // head (lying on the back)
      segs.push({ a: [44, 200], b: p, w: 30, body: true });                       // trunk
      segs.push({ a: p, b: [r1(p[0] + 112), p[1]], w: 20, body: true });          // the other leg, flat
      segs.push({ a: p, b: end, w: 20 });                                         // straight leg (moving)
      circles.push({ x: end[0], y: end[1], r: 8 });                               // foot
    }
    return { joint: jointId, angle, pivot: p, end, segs, circles, zeroArm: toward(p, j.zero, 70), movingArm: toward(p, dir, 70), startDeg: j.zero, sweepDeg: j.sign * angle };
  }
  S.goniometerFigure = goniometerFigure;
  // A round of Goniometer Guess: n targets (joint + a realistic angle, 5° inside the range).
  S.goniometerRound = (seed, n) => {
    const r = rng(seed), ids = Object.keys(S.JOINTS);
    return Array.from({ length: n || 5 }, (_, i) => {
      const id = ids[(Math.floor(r() * ids.length) + i) % ids.length];
      const j = S.JOINTS[id];
      return { joint: id, angle: j.min + 5 + Math.floor(r() * (j.max - j.min - 9)) };
    });
  };
  S.goniometerPoints = (guess, truth) => Math.max(0, Math.round(100 - 4 * Math.abs(Number(guess) - Number(truth))));
  S.goniometerVerdict = (err) => (err <= 3 ? 'Bullseye!' : err <= 6 ? 'Great eye' : err <= 10 ? 'Good' : err <= 20 ? 'Close-ish' : 'Keep practising');

  // ------------------------------------------------------------------ Daily Case
  S.dailyProfession = (specialtyKey) => specialtyKey || 'general';
  // The day's topic: a different area of rehab each day (the same for everyone in a profession), so cases don't repeat.
  S.DAILY_TOPICS = ['stroke', 'spinal cord injury', 'low back pain', 'knee osteoarthritis', 'total hip replacement', 'cerebral palsy', 'autism',
    'Parkinson\'s disease', 'multiple sclerosis', 'rotator cuff injury', 'burns', 'hand and wrist injury', 'COPD', 'cardiac rehabilitation',
    'falls in older adults', 'traumatic brain injury', 'lower-limb amputation', 'dementia', 'returning to work after illness',
    'developmental coordination disorder', 'ankle sprain', 'frozen shoulder', 'chronic pain', 'Guillain–Barré syndrome', 'carpal tunnel syndrome',
    'dysphagia', 'aphasia', 'sports concussion', 'pressure injury prevention', 'diabetes and the foot'];
  S.dailyTopic = (day, prof) => {
    let h = 2166136261;
    const s = String(day) + '|' + String(prof);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return S.DAILY_TOPICS[h % S.DAILY_TOPICS.length];
  };
  // Reads the scorer's JSON reply into a safe result.
  S.cleanDailyScore = (d) => {
    const list = (x) => (Array.isArray(x) ? x : []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, 6);
    const score = Math.max(0, Math.min(100, Math.round(Number(d && d.score))));
    if (!isFinite(score)) return null;
    return { score, strengths: list(d.strengths), missed: list(d.missed), feedback: String((d && d.feedback) || '').trim().slice(0, 600) };
  };
  S.cleanDailyCase = (d) => {
    if (!d || !d.case || !d.question) return null;
    return { title: String(d.title || 'Today\'s case').slice(0, 80), case: String(d.case).slice(0, 1600), question: String(d.question).slice(0, 300),
      keyPoints: (Array.isArray(d.keyPoints) ? d.keyPoints : []).map(String).filter(Boolean).slice(0, 6), modelAnswer: String(d.modelAnswer || '').slice(0, 1500) };
  };

  if (typeof window !== 'undefined') window.RehablixSpace = S;
  if (typeof module !== 'undefined' && module.exports) module.exports = S;
})();
