// js/space/arcade/arcade-content.js — Rehablix Space arcade: the learning content and the rules of each game
// (no DOM). Word Lab's clinical words, the knowledge checks used in Clinical Chess, Muscle Match's rounds, scoring
// and XP. Every answer carries a short teaching note: the games are for learning. Checked by tests/arcade-content.test.js.
(function () {
  'use strict';
  const S = (typeof window !== 'undefined' && window.RehablixSpace) || (typeof require === 'function' ? require('../space-core.js') : null);
  const A = {};

  // ------------------------------------------------------------------ helpers
  A.rng = (seed) => { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  A.shuffle = (r, list) => { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ------------------------------------------------------------------ Word Lab (clinical Scrabble)
  // Scrabble letter values.
  A.LETTER_VALUES = { A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10 };
  // [word, category, clue, teaching note]
  A.WORDS = [
    // anatomy
    ['DELTOID', 'Anatomy', 'Abducts the shoulder beyond the first 15°; supplied by the axillary nerve.', 'Its front fibres also flex and medially rotate the shoulder; its back fibres extend and laterally rotate it.'],
    ['PATELLA', 'Anatomy', 'The largest sesamoid bone in the body, inside the quadriceps tendon.', 'It lengthens the lever arm of the quadriceps, so knee extension needs less force.'],
    ['SCAPHOID', 'Anatomy', 'The most often fractured carpal bone; tender in the anatomical snuffbox.', 'Its blood supply enters at the far end, so a fracture near the wrist risks avascular necrosis. Treat snuffbox tenderness as a fracture until proven otherwise.'],
    ['MENISCUS', 'Anatomy', 'C-shaped fibrocartilage between the femur and the tibia.', 'It deepens the joint and spreads load; twisting on a bent, weight-bearing knee is the classic way to tear it.'],
    ['ACROMION', 'Anatomy', 'Bony projection of the scapula that forms the roof of the shoulder.', 'Supraspinatus runs under it, which is why shoulder impingement pain peaks between about 60° and 120° of abduction.'],
    ['SOLEUS', 'Anatomy', 'Calf muscle that plantarflexes the ankle whatever the knee position.', 'Gastrocnemius crosses the knee too, so test soleus length with the knee bent and gastrocnemius with it straight.'],
    ['TALUS', 'Anatomy', 'Ankle bone that sits in the mortise and has no muscle attachments.', 'It carries the body\'s weight from the tibia to the foot; its blood supply is fragile after a neck fracture.'],
    ['RADIUS', 'Anatomy', 'Forearm bone on the thumb side that turns around the ulna.', 'Pronation and supination happen as the radius rotates at the proximal and distal radio-ulnar joints.'],
    ['FEMUR', 'Anatomy', 'The longest and strongest bone in the body.', 'Fractures of its neck in older adults are a major reason for rehab after falls.'],
    ['CLAVICLE', 'Anatomy', 'The collarbone; most often broken in its middle third.', 'It is the only bony link between the arm and the trunk.'],
    ['DIAPHRAGM', 'Anatomy', 'The main muscle of breathing in, supplied by the phrenic nerve.', 'The phrenic nerve comes from C3, C4 and C5: "C3, 4, 5 keeps the diaphragm alive".'],
    ['ACHILLES', 'Anatomy', 'Tendon of gastrocnemius and soleus that inserts on the calcaneus.', 'A positive Thompson (calf-squeeze) test, with no ankle movement, suggests a full rupture.'],
    ['HAMSTRINGS', 'Anatomy', 'Muscle group that bends the knee and extends the hip.', 'Biceps femoris, semitendinosus and semimembranosus; strains are common in sprinting.'],
    ['ROTATOR', 'Anatomy', 'The ____ cuff: supraspinatus, infraspinatus, teres minor and subscapularis.', 'Remember SITS. The cuff keeps the humeral head centred in the glenoid while the arm moves.'],
    ['CEREBELLUM', 'Anatomy', 'Brain area that coordinates movement and balance.', 'Damage gives ataxia, intention tremor and dysdiadochokinesia on the same side as the lesion.'],
    ['SCIATIC', 'Anatomy', 'The largest nerve in the body, from L4 to S3.', 'It divides into the tibial and common fibular nerves, usually just above the knee.'],
    ['MEDIAN', 'Anatomy', 'Nerve squeezed in carpal tunnel syndrome.', 'Look for numbness in the thumb, index, middle and half the ring finger, and weak thumb abduction.'],
    ['ULNAR', 'Anatomy', 'Nerve behind the medial epicondyle; injury gives a claw hand of the ring and little fingers.', 'It supplies most small hand muscles; Froment\'s sign tests adductor pollicis.'],
    ['AXILLARY', 'Anatomy', 'Nerve at risk in a shoulder dislocation or a surgical-neck fracture of the humerus.', 'Check sensation over the "regimental badge" area of the upper arm and deltoid strength.'],
    ['MYOTOME', 'Anatomy', 'Group of muscles supplied by one spinal nerve root.', 'Testing key muscles (e.g. C5 elbow flexors, L3 knee extensors) helps find the level of a root or cord injury.'],
    ['DERMATOME', 'Anatomy', 'Area of skin supplied by one spinal nerve root.', 'Examples: C6 to the thumb, T4 at the nipple, T10 at the umbilicus, L4 to the medial ankle.'],
    // conditions
    ['STROKE', 'Conditions', 'Sudden loss of brain function from a blocked or bleeding blood vessel.', 'Act FAST: Face, Arm, Speech, Time. Early, intensive, task-specific rehab improves recovery.'],
    ['APHASIA', 'Conditions', 'Language disorder after brain damage, usually to the left hemisphere.', 'It affects speaking, understanding, reading and writing; it is not a loss of intelligence.'],
    ['DYSPHAGIA', 'Conditions', 'Difficulty swallowing.', 'It raises the risk of aspiration pneumonia; screen before giving food or drink after a stroke.'],
    ['SPASTICITY', 'Conditions', 'Velocity-dependent increase in muscle tone; an upper motor neuron sign.', 'The faster you move the limb, the more it resists. Grade it with the Modified Ashworth Scale.'],
    ['HEMIPLEGIA', 'Conditions', 'Paralysis of one side of the body.', 'A right-sided brain lesion gives left hemiplegia, because the motor pathways cross.'],
    ['PARAPLEGIA', 'Conditions', 'Paralysis of both legs, for example after a thoracic spinal cord injury.', 'The arms are spared; the level and completeness (ASIA scale) guide the goals of rehab.'],
    ['TETRAPLEGIA', 'Conditions', 'Paralysis of all four limbs after a cervical spinal cord injury.', 'Injuries at or above T6 also risk autonomic dysreflexia, a medical emergency.'],
    ['ATAXIA', 'Conditions', 'Poorly coordinated movement, often from cerebellar damage.', 'Look for a wide-based gait, overshooting (dysmetria) and intention tremor.'],
    ['SCOLIOSIS', 'Conditions', 'Sideways curve of the spine with rotation of the vertebrae.', 'The Adams forward-bend test shows a rib hump on the convex side.'],
    ['KYPHOSIS', 'Conditions', 'Excessive forward rounding of the thoracic spine.', 'Common with osteoporotic wedge fractures; extension exercises and posture work help.'],
    ['OSTEOPOROSIS', 'Conditions', 'Low bone density that raises the risk of fractures.', 'Weight-bearing and resistance exercise help bone; balance training reduces falls.'],
    ['CONTRACTURE', 'Conditions', 'Fixed shortening of soft tissue that limits a joint\'s range.', 'Prevent it with positioning, regular stretching and splinting, for example after burns or stroke.'],
    ['NEUROPATHY', 'Conditions', 'Damage to peripheral nerves, common in diabetes.', 'Loss of protective sensation in the feet makes daily foot checks and good footwear essential.'],
    ['APRAXIA', 'Conditions', 'Cannot carry out learned movements despite normal strength and understanding.', 'For example, being unable to use a toothbrush on request. OTs train it with real, familiar tasks.'],
    ['NEGLECT', 'Conditions', 'Ignoring one side of space, usually the left after a right-hemisphere stroke.', 'Cue attention to the neglected side and place important items there gradually.'],
    ['DYSARTHRIA', 'Conditions', 'Speech disorder from weak or poorly coordinated speech muscles.', 'Language is intact (unlike aphasia); speech is slurred, slow or imprecise.'],
    ['TENDINOPATHY', 'Conditions', 'Painful, degenerative tendon condition from overload.', 'Graded loading, such as eccentric or heavy slow resistance exercise, is the mainstay of treatment.'],
    ['BURSITIS', 'Conditions', 'Inflammation of a fluid-filled sac that cushions tendons near joints.', 'Common at the shoulder (subacromial), hip (trochanteric) and knee (prepatellar).'],
    ['CLONUS', 'Conditions', 'Rhythmic beats of a muscle on a sudden stretch; an upper motor neuron sign.', 'Test at the ankle with a quick dorsiflexion; more than a few beats is abnormal.'],
    ['BRADYKINESIA', 'Conditions', 'Slowness of movement; a core sign of Parkinson\'s disease.', 'With rigidity and rest tremor it forms the classic picture; external cues (rhythm, lines) help gait.'],
    ['AUTISM', 'Conditions', 'Neurodevelopmental condition with differences in social communication and repetitive behaviours.', 'Support is individual: clear routines, visual supports and sensory-aware environments help.'],
    // assessments
    ['BARTHEL', 'Assessments', 'Index that scores independence in 10 activities of daily living.', 'Scored 0 to 100 (or 0 to 20); higher means more independent.'],
    ['BERG', 'Assessments', 'Balance scale with 14 items, scored out of 56.', 'Scores below about 45 are often linked to a higher risk of falls.'],
    ['GLASGOW', 'Assessments', 'The ____ Coma Scale, scored from 3 to 15.', 'Eyes (4), verbal (5) and motor (6). 8 or less suggests severe brain injury.'],
    ['GONIOMETER', 'Assessments', 'Tool for measuring joint range of motion.', 'Line the axis up with the joint, the fixed arm with the still segment and the moving arm with the moving one.'],
    ['LACHMAN', 'Assessments', 'The most sensitive clinical test for an ACL tear.', 'Knee in 20 to 30° of flexion; a soft end-feel with forward glide of the tibia is positive.'],
    ['ROMBERG', 'Assessments', 'Standing with feet together, eyes open then closed.', 'Much worse with eyes closed points to a proprioceptive (sensory) problem rather than a cerebellar one.'],
    ['ASHWORTH', 'Assessments', 'The Modified ____ Scale grades spasticity from 0 to 4.', 'It includes a 1+ grade: a catch followed by minimal resistance through less than half the range.'],
    ['DYNAMOMETER', 'Assessments', 'Device for measuring grip strength.', 'Grip strength is a simple marker of overall strength and frailty in older adults.'],
    ['SPIROMETRY', 'Assessments', 'Breathing test that measures FEV1 and FVC.', 'An FEV1/FVC ratio below 0.7 after a bronchodilator suggests airflow obstruction, as in COPD.'],
    ['TINETTI', 'Assessments', 'Performance-oriented assessment of balance and gait.', 'It scores 28 points in all; lower scores mean a higher risk of falls.'],
    ['BORG', 'Assessments', 'Scale for rating how hard exercise feels.', 'On the 6 to 20 scale, 12 to 14 ("somewhat hard") matches moderate intensity.'],
    ['BABINSKI', 'Assessments', 'Big toe goes up when the sole is stroked: an upper motor neuron sign in adults.', 'It is normal in babies up to about 1 to 2 years old.'],
    // interventions
    ['ORTHOSIS', 'Interventions', 'External device that supports or corrects a body part, such as an AFO.', 'An ankle-foot orthosis (AFO) helps foot drop by holding the foot up during swing.'],
    ['PROSTHESIS', 'Interventions', 'Artificial replacement for a missing limb.', 'Good residual-limb shaping, strength and skin care come before fitting.'],
    ['SPLINT', 'Interventions', 'Device used to rest, protect or position a joint.', 'Resting hand splints after burns keep the hand in the "safe position" to prevent contractures.'],
    ['CRYOTHERAPY', 'Interventions', 'Treatment with cold to ease pain and swelling.', 'Wrap ice to protect the skin; about 10 to 20 minutes at a time.'],
    ['HYDROTHERAPY', 'Interventions', 'Exercise in warm water.', 'Buoyancy offloads the joints and warmth relaxes muscles; check wounds and continence first.'],
    ['ERGONOMICS', 'Interventions', 'Fitting the task and the workplace to the worker.', 'OTs adjust seating, desk height and work routines to prevent injury and help return to work.'],
    ['PLYOMETRICS', 'Interventions', 'Jump training that uses the stretch-shortening cycle.', 'Used late in sports rehab to restore power, once strength and control are good.'],
    ['ISOMETRIC', 'Interventions', 'Muscle contraction with no change in muscle length.', 'Useful early after injury or for pain relief in tendinopathy, as the joint does not move.'],
    ['ECCENTRIC', 'Interventions', 'Contraction in which the muscle lengthens under load.', 'For example, slowly lowering the heel off a step in Achilles tendinopathy rehab.'],
    ['CONCENTRIC', 'Interventions', 'Contraction in which the muscle shortens.', 'For example, the biceps shortening as you lift a cup toward your mouth.'],
    ['MIRROR', 'Interventions', '____ therapy shows a reflection of the healthy limb to treat phantom pain or weakness.', 'Watching the reflection "tricks" the brain, helping phantom limb pain and arm recovery after stroke.'],
    ['PACING', 'Interventions', 'Spreading activity through the day to manage fatigue or pain.', 'Plan, prioritise and rest before exhaustion: a key strategy in chronic fatigue, MS and chronic pain.'],
    ['CANE', 'Interventions', 'Single-point walking aid, held on the side opposite the weak leg.', 'Held on the strong side, it moves with the weak leg and widens the base of support.'],
    ['WHEELCHAIR', 'Interventions', 'Seated mobility device that must be fitted to the user.', 'Seat width, depth and cushion matter for posture and for preventing pressure injuries.'],
    ['TENS', 'Interventions', 'Pain relief by electrical stimulation of nerves through the skin (abbreviation).', 'It works partly through the "gate control" of pain; avoid it over the front of the neck.'],
    ['CIMT', 'Interventions', 'Constraint-induced movement therapy (abbreviation).', 'The stronger arm is restrained so the weaker one is used intensively in daily tasks after stroke.'],
    // speech, OT, cardio-respiratory
    ['STUTTERING', 'Speech & OT', 'Fluency disorder with repetitions, prolongations and blocks.', 'Speech therapists use fluency shaping and stuttering modification techniques.'],
    ['DYSGRAPHIA', 'Speech & OT', 'Difficulty with handwriting.', 'OTs work on grip, posture, fine motor skill and may suggest typing or speech-to-text.'],
    ['SENSORY', 'Speech & OT', '____ integration therapy, often used by OTs with autistic children.', 'It uses planned sensory activities to help children process and respond to sensory input.'],
    ['PRAXIS', 'Speech & OT', 'The ability to plan and carry out skilled movements.', 'Difficulty with it (dyspraxia) is seen in developmental coordination disorder.'],
    ['VOCATIONAL', 'Speech & OT', '____ rehabilitation helps people return to work.', 'It includes job analysis, graded return and workplace adaptations.'],
    ['ATELECTASIS', 'Cardio-resp', 'Collapse of part of the lung.', 'Early mobilising and deep-breathing exercises help prevent it after surgery.'],
    ['SPUTUM', 'Cardio-resp', 'Mucus coughed up from the lungs.', 'Note its colour and amount; airway clearance techniques like ACBT help shift it.'],
    ['METS', 'Cardio-resp', 'Units of an activity\'s energy cost; one is the resting rate (abbreviation).', 'Brisk walking is about 3 to 4 METs; it helps plan cardiac rehab and return to activity.'],
  ].map(([word, cat, clue, note]) => ({ word, cat, clue, note }));

  A.wordScore = (word) => word.split('').reduce((s, ch) => s + (A.LETTER_VALUES[ch] || 0), 0);

  // A game of Word Lab: n words, each with its tiles (the answer's letters plus a few decoys, shuffled) and bonus slots.
  const DECOYS = 'AEIOURSTLNCDMP';
  A.wordLabRound = (seed, n, category) => {
    const r = A.rng(seed);
    const pool = A.WORDS.filter((w) => !category || w.cat === category);
    return A.shuffle(r, pool).slice(0, n || 8).map((w) => {
      const extra = Math.max(2, Math.min(4, 12 - w.word.length));
      const decoys = Array.from({ length: extra }, () => DECOYS[Math.floor(r() * DECOYS.length)]);
      const tiles = A.shuffle(r, w.word.split('').concat(decoys)).map((ch, i) => ({ id: 't' + i, ch, value: A.LETTER_VALUES[ch] }));
      // bonus squares: one double-letter, and a double-word on longer words
      const bonus = {};
      bonus[Math.floor(r() * w.word.length)] = 'DL';
      if (w.word.length >= 7) { let i = Math.floor(r() * w.word.length); if (bonus[i]) i = (i + 1) % w.word.length; bonus[i] = 'DW'; }
      return { ...w, tiles, bonus };
    });
  };
  // Points for a solved word: letters (doubled on DL), x2 on DW, a speed bonus (under 20 s) and a no-hint bonus.
  A.wordLabPoints = (w, seconds, hints) => {
    let letters = 0, mult = 1;
    w.word.split('').forEach((ch, i) => {
      const v = A.LETTER_VALUES[ch] || 0;
      if (w.bonus[i] === 'DL') letters += 2 * v; else letters += v;
      if (w.bonus[i] === 'DW') mult = 2;
    });
    const speed = Math.max(0, Math.round(20 - Math.max(0, seconds)));
    const clean = hints ? 0 : 5;
    return Math.max(1, letters * mult + speed + clean - hints * 3);
  };

  // ------------------------------------------------------------------ knowledge checks (Clinical Chess and quizzes)
  // [question, answer, three wrong answers, teaching note]
  A.MCQ = [
    ['Normal knee flexion range is about:', '135°', ['90°', '180°', '60°'], 'About 0 to 135° actively; you need roughly 90° to climb stairs and 105 to 110° to rise from a chair easily.'],
    ['On the MRC (Oxford) scale, full range against gravity but no added resistance is grade:', '3', ['2', '4', '1'], '0 none, 1 flicker, 2 gravity eliminated, 3 against gravity, 4 some resistance, 5 normal.'],
    ['The Glasgow Coma Scale runs from:', '3 to 15', ['0 to 15', '1 to 10', '0 to 56'], 'Eyes 1 to 4, verbal 1 to 5, motor 1 to 6, so the lowest possible is 3.'],
    ['A Berg Balance Scale score below about 45 out of 56 suggests:', 'A higher risk of falls', ['Normal balance', 'Cognitive impairment', 'A need for a wheelchair'], 'Use it with other findings; the score helps target balance training and falls prevention.'],
    ['Which is an upper motor neuron sign?', 'Up-going big toe (Babinski)', ['Fasciculations', 'Flaccid paralysis with no reflexes', 'Early, marked muscle wasting'], 'UMN lesions give spasticity, brisk reflexes, clonus and a Babinski sign; the others point to LMN damage.'],
    ['Which is a lower motor neuron sign?', 'Fasciculations', ['Clonus', 'Spasticity', 'Brisk reflexes'], 'LMN lesions give weakness with wasting, low tone, reduced reflexes and fasciculations.'],
    ['The biceps reflex mainly tests the nerve root:', 'C5 (C5–C6)', ['C7', 'L4', 'S1'], 'Biceps C5–6, brachioradialis C6, triceps C7, knee L3–4, ankle S1.'],
    ['The knee (patellar) reflex mainly tests:', 'L4 (L3–L4)', ['S1', 'C7', 'L1'], 'Knee jerk L3–4; ankle jerk S1.'],
    ['The ankle reflex mainly tests:', 'S1', ['L4', 'L2', 'C8'], '"S1, 2 buckle my shoe": the ankle jerk is S1.'],
    ['The triceps reflex mainly tests:', 'C7', ['C5', 'T1', 'L5'], '"C7, 8 lay them straight": triceps C7.'],
    ['After an above-knee amputation, which helps prevent a hip flexion contracture?', 'Lying prone regularly', ['A pillow under the residual limb', 'Sitting most of the day', 'Keeping the hip flexed in bed'], 'Avoid pillows under the stump; prone lying stretches the hip flexors.'],
    ['After a posterior-approach hip replacement, which is usually restricted early on?', 'Hip flexion beyond 90°', ['Hip abduction', 'Knee extension', 'Ankle dorsiflexion'], 'Classic precautions: no flexion past 90°, no crossing the midline, no internal rotation (follow your surgeon\'s protocol).'],
    ['Pain from a scaphoid fracture is typically felt in the:', 'Anatomical snuffbox', ['Olecranon', 'Hypothenar eminence', 'Lateral epicondyle'], 'Snuffbox tenderness after a fall on an outstretched hand needs immobilising and review even with a normal first X-ray.'],
    ['Moderate aerobic exercise on the 6–20 Borg scale is about:', '12 to 14', ['6 to 8', '17 to 19', '20'], '"Somewhat hard": breathing harder but still able to talk.'],
    ['Autonomic dysreflexia mainly occurs in spinal cord injury at or above:', 'T6', ['L1', 'S2', 'T12'], 'Sudden high blood pressure with a pounding headache: sit the person up and find the trigger (often the bladder).'],
    ['Phalen\'s test is used for:', 'Carpal tunnel syndrome', ['De Quervain\'s tenosynovitis', 'Tennis elbow', 'ACL tear'], 'Holding the wrists fully flexed for 60 seconds reproduces median-nerve symptoms.'],
    ['A positive Finkelstein test suggests:', 'De Quervain\'s tenosynovitis', ['Carpal tunnel syndrome', 'Scaphoid fracture', 'Golfer\'s elbow'], 'Pain at the radial styloid when the thumb is held in the fist and the wrist moved toward the little finger.'],
    ['Broca\'s (expressive) aphasia comes from damage to the:', 'Left frontal lobe', ['Right parietal lobe', 'Cerebellum', 'Occipital lobe'], 'Speech is slow and effortful but understanding is fairly good.'],
    ['Wernicke\'s aphasia typically shows:', 'Fluent speech with poor understanding', ['Slow speech with good understanding', 'Slurred speech only', 'Loss of voice'], 'Damage to the left temporal lobe; speech flows but makes little sense.'],
    ['Thickened fluids are mainly used to manage:', 'Dysphagia', ['Dysarthria', 'Aphasia', 'Apraxia'], 'Thicker drinks move more slowly, giving more time to protect the airway.'],
    ['A person with left-sided weakness should hold a single-point cane in the:', 'Right hand', ['Left hand', 'Either hand', 'Both hands'], 'Opposite the weak leg: it moves with the weak leg and widens the base of support.'],
    ['Going up stairs with crutches, the person leads with the:', 'Stronger leg', ['Weaker leg', 'Crutches', 'Either leg'], '"Up with the good, down with the bad."'],
    ['Spasticity is best described as:', 'Velocity-dependent resistance to passive stretch', ['Constant resistance through range', 'Loss of all muscle tone', 'Involuntary writhing movements'], 'Rigidity (as in Parkinson\'s) is constant; spasticity increases with faster stretch.'],
    ['A Trendelenburg gait points to weakness of:', 'Gluteus medius', ['Gluteus maximus', 'Quadriceps', 'Tibialis anterior'], 'The pelvis drops on the side of the swinging leg when the stance-side abductors are weak.'],
    ['Foot drop is usually from weakness of:', 'Tibialis anterior', ['Gastrocnemius', 'Tibialis posterior', 'Soleus'], 'Supplied by the deep fibular nerve; injury at the fibular head is a common cause. An AFO helps.'],
    ['Erb\'s palsy involves the brachial plexus roots:', 'C5–C6', ['C8–T1', 'L4–L5', 'C3–C4'], 'The "waiter\'s tip" posture: arm by the side, medially rotated, elbow extended.'],
    ['Klumpke\'s palsy involves the roots:', 'C8–T1', ['C5–C6', 'C7 only', 'L5–S1'], 'It affects the small hand muscles, giving a claw hand.'],
    ['A positive Romberg test (much worse with eyes closed) suggests a problem with:', 'Proprioception', ['Hearing', 'Muscle strength', 'Vision'], 'With eyes closed the person relies on joint position sense; if that is lost, they sway or fall.'],
    ['The WHO recommends adults do moderate aerobic activity of:', '150 to 300 minutes a week', ['30 minutes a week', '60 minutes a week', '1,000 minutes a week'], 'Or 75 to 150 minutes of vigorous activity, plus muscle strengthening on 2 or more days.'],
    ['In PRICE, the "E" stands for:', 'Elevation', ['Exercise', 'Evaluation', 'Electrotherapy'], 'Protection, Rest, Ice, Compression, Elevation.'],
    ['In SMART goals, the "M" stands for:', 'Measurable', ['Meaningful', 'Medical', 'Motivating'], 'Specific, Measurable, Achievable, Relevant, Time-bound.'],
    ['In the ICF model, difficulty walking is classed as:', 'An activity limitation', ['A body structure', 'An environmental factor', 'A personal factor'], 'Impairments are at body level, activity limitations at the level of the task, participation restrictions in life roles.'],
    ['A normal adult resting breathing rate is about:', '12 to 20 breaths a minute', ['4 to 8', '25 to 35', '40 to 60'], 'A raised rate is often an early sign that someone is unwell.'],
    ['A normal adult resting heart rate is:', '60 to 100 beats a minute', ['30 to 50', '100 to 140', '140 to 180'], 'Fit athletes can be lower; check rhythm as well as rate.'],
    ['The usual oxygen saturation target for most adults is:', '94 to 98%', ['80 to 85%', '88 to 92% for everyone', '100% always'], '88 to 92% is used for people at risk of carbon dioxide retention, such as some with COPD.'],
    ['Pressure injuries most often develop over the:', 'Sacrum', ['Forearm', 'Abdomen', 'Chest'], 'Bony points like the sacrum, heels and hips; reposition, check skin and use pressure-relieving surfaces.'],
  ].map(([q, a, wrong, note]) => ({ q, a, wrong, note }));

  // A knowledge check: { question, options (shuffled), answer, note } from the clinical bank, muscles or special tests.
  A.knowledgeCheck = (r) => {
    r = r || Math.random;
    const pickFrom = r();
    if (pickFrom < 0.5 || !S) {
      const m = A.MCQ[Math.floor(r() * A.MCQ.length)];
      return { question: m.q, options: A.shuffle(r, [m.a].concat(m.wrong)), answer: m.a, note: m.note };
    }
    const seed = Math.floor(r() * 1e9);
    // (space-core questions: { prompt, options, answer: index of the right option, id: the muscle or test })
    const q = pickFrom < 0.78 ? S.muscleQuestion(A.rng(seed)) : S.testQuestion(A.rng(seed));
    return { question: q.prompt, options: q.options, answer: q.options[q.answer], note: A.noteFor(q) };
  };
  // A teaching note for a muscle or special-test question (from the banks).
  A.noteFor = (q) => {
    if (!S || !q) return '';
    const m = S.MUSCLES.find((x) => x.id === q.id);
    if (m) return m.name + ': ' + m.nerve + '. Main action: ' + m.action.charAt(0).toLowerCase() + m.action.slice(1) + '.';
    const t = S.SPECIAL_TESTS.find((x) => x.id === q.id);
    if (t) return t.name + ': ' + t.how + ' Positive suggests ' + t.finding.charAt(0).toLowerCase() + t.finding.slice(1) + '.';
    return '';
  };

  // ------------------------------------------------------------------ Muscle Match (drag each muscle to its nerve or movement)
  A.NERVE_LABELS = {
    axillary: 'Axillary nerve', suprascapular: 'Suprascapular nerve', subscapular: 'Subscapular nerves', thoracodorsal: 'Thoracodorsal nerve',
    pectoral: 'Pectoral nerves', longThoracic: 'Long thoracic nerve', accessory: 'Accessory nerve (CN XI)', dorsalScapular: 'Dorsal scapular nerve',
    musculocutaneous: 'Musculocutaneous nerve', radial: 'Radial nerve (incl. posterior interosseous)', median: 'Median nerve', ulnar: 'Ulnar nerve',
    phrenic: 'Phrenic nerve', inferiorGluteal: 'Inferior gluteal nerve', superiorGluteal: 'Superior gluteal nerve', obturator: 'Obturator nerve',
    femoral: 'Femoral nerve', tibial: 'Tibial nerve', deepFibular: 'Deep fibular nerve', superficialFibular: 'Superficial fibular nerve',
  };
  // A muscle's single nerve for this game (muscles with two separate supplies, e.g. FDP, are left out).
  A.matchNerve = (m) => {
    const k = m.nerves.filter((x) => x !== 'commonFibular');   // (deep/superficial fibular are branches of the common fibular)
    return k.length === 1 && A.NERVE_LABELS[k[0]] ? k[0] : null;
  };
  // n rounds; each: 3 bins (nerves with at least 2 muscles here) and their muscles (2 or 3 each), shuffled.
  A.muscleMatchRound = (seed, n) => {
    const r = A.rng(seed);
    const byNerve = {};
    (S ? S.MUSCLES : []).forEach((m) => { const k = A.matchNerve(m); if (k) (byNerve[k] = byNerve[k] || []).push(m); });
    const usable = Object.keys(byNerve).filter((k) => byNerve[k].length >= 2);
    return Array.from({ length: n || 4 }, () => {
      const bins = A.shuffle(r, usable).slice(0, 3);
      const cards = A.shuffle(r, [].concat(...bins.map((k) => A.shuffle(r, byNerve[k]).slice(0, 3).map((m) => ({
        id: m.id, name: m.name, bin: k, note: m.name + ': ' + m.nerve + '. ' + m.action + '.',
      })))));
      return { bins: bins.map((k) => ({ id: k, label: A.NERVE_LABELS[k] })), cards };
    });
  };

  // ------------------------------------------------------------------ XP (league points) for the arcade games
  A.xp = {
    wordlab: (points) => Math.min(60, Math.round(Math.max(0, points) / 6)),
    match: (correct, firstTry) => Math.min(50, Math.max(0, correct) * 2 + Math.max(0, firstTry)),
    chess: (result, level, checks) => {
      const win = { easy: 15, normal: 30, hard: 50 }[level] || 15;
      const base = result === 'win' ? win : result === 'draw' ? Math.round(win / 3) : 5;
      return Math.min(80, base + Math.max(0, checks) * 3);
    },
  };

  if (typeof window !== 'undefined') window.RxArcadeContent = A;
  if (typeof module !== 'undefined' && module.exports) module.exports = A;
})();
