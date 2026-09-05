/**
 * THE MEGHALAYA CADRE TACTICAL WAR ROOM — CLIENT MASTER ENGINE
 * Compliant with frontend-design & anti-ui-slop standards
 * Supports MPSC LDA (State Cadre) & DSC West Khasi Hills (District Cadre)
 */

(function () {
  'use strict';

  // ==========================================================================
  // 1. STATE MANAGEMENT & CADRE CONFIGURATION
  // ==========================================================================
  const CADRE_RANKS = [
    { level: 1, title: 'Recruit Typist', minXp: 0, icon: '📜' },
    { level: 2, title: 'Junior Secretariat Assistant', minXp: 1000, icon: '🎖️' },
    { level: 3, title: 'Senior Assistant', minXp: 3000, icon: '⭐' },
    { level: 4, title: 'Cadre Section Officer', minXp: 6000, icon: '🏛️' },
    { level: 5, title: 'Superintendent', minXp: 10000, icon: '👑' },
    { level: 6, title: 'Assistant Secretary', minXp: 16000, icon: '⚔️' },
    { level: 7, title: 'Under Secretary (Chief of Cadre)', minXp: 25000, icon: '⚜️' }
  ];

  const BADGES_SPEC = [
    { id: 'first_blood', name: 'First Order of Merit', icon: '🎯', desc: 'Completed your first official cadre mission drill.' },
    { id: 'speed_demon', name: 'Rapid Typist Citation', icon: '⚡', desc: 'Completed a 60s Speed Blitz test with >75% accuracy.' },
    { id: 'combo_fire', name: 'Hyperdrive Multiplier', icon: '🔥', desc: 'Achieved a 2.0x or higher score combo in a single exam.' },
    { id: 'perfect_omr', name: 'Flawless OMR Sheet', icon: '💎', desc: 'Scored 100% accuracy on a 10-question cadre drill.' },
    { id: 'secretariat_vet', name: '7-Day Discipline Veteran', icon: '📅', desc: 'Maintained an unbroken 7-day study streak.' },
    { id: 'shield_bearer', name: 'Aegis Sentinel', icon: '🛡️', desc: 'Accumulated 3 or more streak protection shields.' },
    { id: 'wkh_pioneer', name: 'Order of West Khasi Hills', icon: '🌲', desc: 'Completed 50+ questions in the DSC District Cadre.' },
    { id: 'mpsc_elite', name: 'State Secretariat Cross', icon: '🏛️', desc: 'Earned promotion to Senior Assistant or higher rank.' }
  ];

  // Syllabus definitions for MPSC LDA vs DSC West Khasi Hills
  const CURRICULUM = {
    mpsc: {
      id: 'mpsc',
      title: 'MPSC Lower Division Assistant',
      subtitle: 'July 2025 Secretariat Standard · Advanced English, Office IT & Puzzles',
      subjects: [
        {
          id: 'English',
          name: 'General English',
          icon: '✍️',
          topics: ['Sentence Rearrangement (P-Q-R-S)', 'Direct & Indirect Speech', 'Idioms & Phrases', 'Active / Passive Voice', 'Precision Vocabulary & Antonyms'],
          desc: 'High-level editorial grammar, vocabulary, sentence correction, and comprehension.'
        },
        {
          id: 'GK',
          name: 'General Knowledge & Current Affairs',
          icon: '🌏',
          topics: ['Meghalaya Statehood & Autonomous District Councils', 'Meghalaya State Budget & Schemes', 'North East Freedom Movement', 'Indian Constitution & Polity', 'National / International Affairs'],
          desc: 'State governance, regional history, Indian polity, and national current affairs.'
        },
        {
          id: 'Math',
          name: 'Elementary Mathematics',
          icon: '📐',
          topics: ['Commercial Arithmetic (Profit, Loss & Discount)', 'Simple & Compound Interest', 'Ratio, Proportion & Work', 'Algebraic Expressions', 'Mensuration & Geometry Basics'],
          desc: 'Quantitative aptitude, percentage computations, commercial math, and data analysis.'
        },
        {
          id: 'Reasoning',
          name: 'General Intelligence & Reasoning',
          icon: '🧩',
          topics: ['Complex Seating Arrangement Puzzles', 'Syllogisms & Deductive Logic', 'Blood Relations & Direction Sense', 'Number & Alphabet Series', 'Statement & Assumptions'],
          desc: 'Analytical puzzle solving, logical reasoning, and spatial deductions.'
        },
        {
          id: 'Computer',
          name: 'Computer & Office IT Knowledge',
          icon: '💻',
          topics: ['MS Word & Excel Official Shortcut Keys', 'File Extensions & Windows OS Commands', 'Secretariat Typing Speed & Clerical Ergonomics', 'Internet Protocols & Email Security', 'Database & Office Suite Basics'],
          desc: 'Secretariat office automation, clerical shortcuts, operating systems, and IT essentials.'
        }
      ]
    },
    dsc: {
      id: 'dsc',
      title: 'DSC West Khasi Hills (Clerical-cum-Typist)',
      subtitle: 'SSLC Class 10 Foundation · Nongstoin / Mawkyrwat Regional Focus',
      subjects: [
        {
          id: 'English',
          name: 'General English',
          icon: '✍️',
          topics: ['SSLC Grammar & Common Errors', 'Prepositions & Articles', 'Spelling Correction & Word Forms', 'Singular / Plural & Gender', 'Synonyms & Antonyms (Class 10 Level)'],
          desc: 'Foundational English, basic grammar rules, and spelling accuracy.'
        },
        {
          id: 'GK',
          name: 'General Knowledge & West Khasi Hills',
          icon: '🌲',
          topics: ['West Khasi Hills Geography (Nongstoin & Mawkyrwat)', 'Khasi Freedom Fighters (U Tirot Sing)', 'Rivers, Hills & Minerals of Meghalaya', 'Traditional Institutions (Syiemships & Dorbar)', 'Important State Days & Symbols'],
          desc: 'District geography, Khasi heritage, freedom fighters, and Meghalaya fundamentals.'
        },
        {
          id: 'Math',
          name: 'Elementary Mathematics',
          icon: '📐',
          topics: ['Class 10 Fractions & Decimals', 'Simple Interest & Average Calculation', 'Unitary Method & Work-Time', 'Percentage & Profit / Loss Basics', 'Basic Mensuration (Area & Perimeter)'],
          desc: 'Class 10 school arithmetic, basic calculations, and commercial problems.'
        },
        {
          id: 'Reasoning',
          name: 'Basic Intelligence & Reasoning',
          icon: '🧩',
          topics: ['Number Series & Next Term', 'Alphabetical Order & Coding-Decoding', 'Odd One Out & Analogies', 'Simple Direction Sense', 'Family Tree & Relationship Tests'],
          desc: 'Standard pattern recognition, sequence completion, and elementary logic.'
        },
        {
          id: 'Computer',
          name: 'Computer & Typing Readiness',
          icon: '💻',
          topics: ['QWERTY Keyboard Layout & Home Keys', 'Typing Speed Standards (30 WPM)', 'Basic Computer Components (CPU, RAM, ROM)', 'Starting & Shutting Down Windows', 'Word Processing Basics (Bold, Italic, Save)'],
          desc: 'Typing readiness, computer fundamentals, and basic clerical office operations.'
        }
      ]
    }
  };

  const state = {
    currentTrack: 'mpsc',
    currentView: 'mission',
    calendarDate: new Date(),
    selectedDayIndex: 1,
    soundEnabled: true,
    profile: {
      authenticated: false,
      username: 'Cadet_Candidate',
      token: localStorage.getItem('wkh_auth_token') || '',
      xp: 0,
      level: 1,
      rankTitle: 'Recruit Typist',
      streakCount: 1,
      streakShields: 1,
      highestCombo: 1.0,
      badges: [],
      stats: { totalQuestions: 0, correctAnswers: 0 }
    },
    activeExam: null,
    comboMultiplier: 1.0,
    currentComboStreak: 0
  };

  // ==========================================================================
  // 2. PROCEDURAL WEB AUDIO SYNTHESIZER
  // ==========================================================================
  let audioCtx = null;
  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) audioCtx = new AudioContextClass();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playTone(freq, type, duration, gainVal = 0.08) {
    if (!state.soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(gainVal, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {}
  }

  const soundFX = {
    click: () => playTone(600, 'sine', 0.05, 0.06),
    select: () => playTone(880, 'triangle', 0.08, 0.09),
    correct: () => {
      if (!state.soundEnabled) return;
      // Joyous arpeggio C5 -> E5 -> G5 -> C6
      const ctx = getAudioContext();
      if (!ctx) return;
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        setTimeout(() => playTone(freq, 'sine', 0.16, 0.1), i * 65);
      });
    },
    wrong: () => {
      playTone(180, 'sawtooth', 0.22, 0.12);
    },
    combo: () => {
      if (!state.soundEnabled) return;
      // High-energy flame chord
      [440, 554.37, 659.25, 880].forEach((f, i) => {
        setTimeout(() => playTone(f, 'triangle', 0.2, 0.12), i * 45);
      });
    },
    fanfare: () => {
      if (!state.soundEnabled) return;
      // Victory brass cadence
      const notes = [392.00, 523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        setTimeout(() => playTone(f, 'sine', 0.28, 0.14), i * 110);
      });
    }
  };

  // ==========================================================================
  // 3. CELEBRATORY CANVAS CONFETTI PARTICLE ENGINE
  // ==========================================================================
  function launchConfetti(duration = 2400) {
    const canvas = document.getElementById('confettiCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ['#D4AF37', '#F3CD65', '#10B981', '#06B6D4', '#F59E0B', '#FFF'];
    const particles = [];

    for (let i = 0; i < 90; i++) {
      particles.push({
        x: canvas.width * 0.5 + (Math.random() - 0.5) * 200,
        y: canvas.height * 0.45,
        vx: (Math.random() - 0.5) * 14,
        vy: (Math.random() - 1.2) * 14,
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 8,
        opacity: 1
      });
    }

    const start = performance.now();
    function render(now) {
      const elapsed = now - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.35; // gravity
        p.rotation += p.rotSpeed;
        p.opacity = Math.max(0, 1 - elapsed / duration);

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.opacity;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      });

      if (elapsed < duration) {
        requestAnimationFrame(render);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    requestAnimationFrame(render);
  }

  // ==========================================================================
  // 4. TOAST NOTIFICATIONS & HUD CONTROLLER
  // ==========================================================================
  function showToast(msg, type = 'gold') {
    const el = document.getElementById('arenaToast');
    if (!el) return;
    el.textContent = msg;
    el.style.borderColor = type === 'emerald' ? 'var(--radar-emerald)' : type === 'cyan' ? 'var(--cyber-cyan)' : 'var(--gold-500)';
    el.classList.add('active');
    setTimeout(() => el.classList.remove('active'), 3200);
  }

  function getRankForXp(xp) {
    let current = CADRE_RANKS[0];
    for (let r of CADRE_RANKS) {
      if (xp >= r.minXp) current = r;
    }
    return current;
  }

  function getNextRank(current) {
    const idx = CADRE_RANKS.findIndex(r => r.level === current.level);
    if (idx >= 0 && idx < CADRE_RANKS.length - 1) {
      return CADRE_RANKS[idx + 1];
    }
    return current;
  }

  function renderHUD() {
    const p = state.profile;
    const curRank = getRankForXp(p.xp);
    const nextRank = getNextRank(curRank);

    // Calc XP progress %
    let progress = 100;
    if (nextRank.level !== curRank.level) {
      const range = nextRank.minXp - curRank.minXp;
      const surplus = p.xp - curRank.minXp;
      progress = Math.min(100, Math.max(0, Math.round((surplus / range) * 100)));
    }

    document.getElementById('hudUsername').textContent = p.username;
    document.getElementById('hudRankTitle').textContent = curRank.title;
    document.getElementById('hudAvatarLetter').textContent = p.username.charAt(0).toUpperCase();

    document.getElementById('hudXpValue').textContent = p.xp.toLocaleString();
    document.getElementById('hudNextXp').textContent = `/ ${nextRank.minXp.toLocaleString()} XP`;
    document.getElementById('hudXpFill').style.width = `${progress}%`;

    document.getElementById('hudStreakVal').textContent = `${p.streakCount} Day${p.streakCount !== 1 ? 's' : ''}`;
    document.getElementById('hudShieldCount').textContent = `🛡️ ${p.streakShields} Shield${p.streakShields !== 1 ? 's' : ''}`;

    const comboEl = document.getElementById('hudComboVal');
    comboEl.textContent = `${state.comboMultiplier.toFixed(1)}x`;
    if (state.comboMultiplier >= 1.5) {
      comboEl.classList.add('fire');
    } else {
      comboEl.classList.remove('fire');
    }

    const soundBtn = document.getElementById('soundToggleBtn');
    if (soundBtn) {
      soundBtn.textContent = state.soundEnabled ? '🔊 Sound: ON' : '🔇 Sound: OFF';
    }

    const track = CURRICULUM[state.currentTrack];
    document.getElementById('trackTitleDisplay').textContent = track.title;
    document.getElementById('trackDescDisplay').textContent = track.subtitle;
  }

  // ==========================================================================
  // 5. 30-DAY SPACED REPETITION MISSION MATRIX
  // ==========================================================================
  const SPACED_INTERVALS = [1, 3, 7, 14, 30];

  function renderCalendarMatrix() {
    const grid = document.getElementById('calGridDays');
    if (!grid) return;
    grid.innerHTML = '';

    const d = state.calendarDate;
    const year = d.getFullYear();
    const month = d.getMonth();

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();

    document.getElementById('calMonthLabel').textContent = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      year: 'numeric'
    }).format(d);

    // Leading empty cells
    for (let i = 0; i < firstDay; i++) {
      const empty = document.createElement('div');
      empty.className = 'matrix-cell empty';
      grid.appendChild(empty);
    }

    // Days 1..daysInMonth
    for (let day = 1; day <= daysInMonth; day++) {
      const cell = document.createElement('div');
      cell.className = 'matrix-cell';
      cell.dataset.day = day;

      const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
      if (isToday) cell.classList.add('today');
      if (day === state.selectedDayIndex) cell.classList.add('selected');

      const isSpaced = SPACED_INTERVALS.includes(day);
      if (isSpaced) cell.classList.add('spaced');

      const track = CURRICULUM[state.currentTrack];
      const subject = track.subjects[(day - 1) % track.subjects.length];

      cell.innerHTML = `
        <div class="cell-header-row">
          <span class="cell-day-num">${day}</span>
          ${isSpaced ? `<span class="cell-spaced-badge">Day ${day}</span>` : ''}
        </div>
        <div class="cell-mission-badge" title="${subject.name}">${subject.icon} ${subject.name}</div>
      `;

      cell.addEventListener('click', () => {
        soundFX.click();
        state.selectedDayIndex = day;
        document.querySelectorAll('.matrix-cell').forEach(c => c.classList.remove('selected'));
        cell.classList.add('selected');
        renderDayDossier(day);
      });

      grid.appendChild(cell);
    }

    renderDayDossier(state.selectedDayIndex);
  }

  function renderDayDossier(dayIdx) {
    const track = CURRICULUM[state.currentTrack];
    const subject = track.subjects[(dayIdx - 1) % track.subjects.length];
    const isSpaced = SPACED_INTERVALS.includes(dayIdx);

    const d = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth(), dayIdx);
    const dateFormatted = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(d);

    document.getElementById('dossierDateTitle').textContent = dateFormatted;
    document.getElementById('dossierDaySub').textContent = `Exam Mission Day #${dayIdx} · Spaced Interval: ${isSpaced ? `${dayIdx} Days Retention Target` : 'Foundational Syllabus Drill'}`;

    const container = document.getElementById('dossierTopicsGrid');
    container.innerHTML = '';

    subject.topics.forEach((top, i) => {
      const item = document.createElement('div');
      item.className = 'topic-dispatch-item';
      item.innerHTML = `
        <span class="topic-dispatch-name">${i + 1}. ${top}</span>
        <span class="topic-dispatch-subject">${subject.name}</span>
      `;
      container.appendChild(item);
    });

    const startBtn = document.getElementById('startDayMissionBtn');
    startBtn.onclick = () => {
      soundFX.click();
      window.startMissionDrill(subject.name, subject.topics);
    };
  }

  // ==========================================================================
  // 6. VIEW 2: SUBJECT DRILL VAULT
  // ==========================================================================
  function renderSubjectVault() {
    const container = document.getElementById('subjectDrillsGrid');
    if (!container) return;
    container.innerHTML = '';

    const track = CURRICULUM[state.currentTrack];
    track.subjects.forEach(subj => {
      const card = document.createElement('div');
      card.className = 'vault-card';
      card.innerHTML = `
        <div>
          <div class="vault-card-top">
            <div class="vault-icon-frame">${subj.icon}</div>
            <div class="vault-card-body">
              <h3>${subj.name}</h3>
              <p>${subj.desc}</p>
            </div>
          </div>
          <div style="margin-top: 14px;">
            <div style="font-family: var(--font-mono); font-size: 10px; color: var(--gold-400); text-transform: uppercase; margin-bottom: 6px;">CORE SYLLABUS TOPICS</div>
            <div style="display: flex; flex-wrap: wrap; gap: 6px;">
              ${subj.topics.map(t => `<span style="font-size: 11px; background: rgba(255,255,255,0.05); padding: 2px 8px; border-radius: 4px; color: var(--text-secondary);">${t}</span>`).join('')}
            </div>
          </div>
        </div>
        <div>
          <div class="vault-meta-row">
            <span>Standard: ${track.id.toUpperCase()} Cadre</span>
            <span>Target: 10 Qs Rapid</span>
          </div>
          <button class="cta-tactical-btn w-full" style="margin-top: 14px;" onclick="window.startMissionDrill('${subj.name}', ${JSON.stringify(subj.topics).replace(/"/g, '&quot;')})">
            <span>Commence Drill</span> ➔
          </button>
        </div>
      `;
      container.appendChild(card);
    });
  }

  // ==========================================================================
  // 7. VIEW 4: CADRE HONORS & MEDALS WALL
  // ==========================================================================
  function renderHonorsWall() {
    const container = document.getElementById('badgesShowcaseGrid');
    if (!container) return;
    container.innerHTML = '';

    const unlocked = state.profile.badges || [];
    BADGES_SPEC.forEach(b => {
      const isEarned = unlocked.includes(b.id);
      const card = document.createElement('div');
      card.className = `medal-card ${isEarned ? 'unlocked' : 'locked'}`;
      card.innerHTML = `
        <div class="medal-disc">${b.icon}</div>
        <div class="medal-title">${b.name}</div>
        <div class="medal-desc">${b.desc}</div>
        <div class="medal-tag ${isEarned ? 'unlocked-status' : 'locked-status'}">
          ${isEarned ? '✓ AWARDED BY COMMISSION' : '🔒 CADRE MERIT LOCKED'}
        </div>
      `;
      container.appendChild(card);
    });
  }

  function checkAndUnlockBadge(badgeId) {
    if (!state.profile.badges.includes(badgeId)) {
      state.profile.badges.push(badgeId);
      const spec = BADGES_SPEC.find(b => b.id === badgeId);
      if (spec) {
        soundFX.fanfare();
        showToast(`🏆 Medal Awarded: ${spec.name}!`, 'gold');
        launchConfetti(2800);
      }
      saveGamificationProfile();
      renderHonorsWall();
    }
  }

  // ==========================================================================
  // 8. GEMINI 3.6 FLASH AI DRILL GENERATOR & EXAM CONTROLLER
  // ==========================================================================
  function showGenLoading(headline, detail) {
    const modal = document.getElementById('genLoadingModal');
    document.getElementById('genHeadline').textContent = headline;
    document.getElementById('genDetail').textContent = detail;
    modal.classList.add('active');
  }

  function hideGenLoading() {
    document.getElementById('genLoadingModal').classList.remove('active');
  }

  window.startMissionDrill = async function (subjectName, topicList) {
    soundFX.click();
    showGenLoading(
      `Consulting Meghalaya Secretariat Archives...`,
      `Generating 10 authentic questions on ${subjectName} (${state.currentTrack.toUpperCase()} spec)...`
    );

    try {
      const token = state.profile.token || localStorage.getItem('wkh_auth_token') || '';
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          track: state.currentTrack,
          subjectName: subjectName,
          topics: topicList || [],
          count: 10
        })
      });

      const data = await res.json();
      hideGenLoading();

      if (!res.ok || !data.questions || data.questions.length === 0) {
        showToast(data.error || 'Question generation failed. Check server log.');
        return;
      }

      initExamStage({
        title: `${state.currentTrack.toUpperCase()} · ${subjectName} Mission Drill`,
        subject: subjectName,
        questions: data.questions,
        durationSeconds: 15 * 60
      });
    } catch (err) {
      hideGenLoading();
      showToast('Network error while consulting Gemini AI.');
    }
  };

  window.startSpeedBlitz = async function () {
    soundFX.click();
    showGenLoading(
      'Initializing 60-Second Speed Typist Blitz...',
      'Synthesizing rapid-fire mixed clerical items across English, GK, and Computers...'
    );

    try {
      const token = state.profile.token || localStorage.getItem('wkh_auth_token') || '';
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          track: state.currentTrack,
          subjectName: 'Mixed Blitz',
          topics: ['Mixed English Vocabulary', 'Meghalaya GK', 'Office Typing & Shortcut Keys'],
          count: 10
        })
      });

      const data = await res.json();
      hideGenLoading();

      if (!res.ok || !data.questions || data.questions.length === 0) {
        showToast(data.error || 'Speed Blitz generation failed.');
        return;
      }

      initExamStage({
        title: '60s Rapid Typist Blitz',
        subject: 'Mixed Rapid Response',
        questions: data.questions,
        durationSeconds: 60,
        isBlitz: true
      });
    } catch (e) {
      hideGenLoading();
      showToast('Network error launching Speed Blitz.');
    }
  };

  // ==========================================================================
  // 9. ACTIVE EXAM STAGE & OMR EVALUATION ENGINE
  // ==========================================================================
  let examTimerInterval = null;

  function initExamStage(examData) {
    state.activeExam = {
      title: examData.title,
      subject: examData.subject,
      questions: examData.questions,
      currentIndex: 0,
      userAnswers: new Array(examData.questions.length).fill(null),
      submitted: false,
      isBlitz: !!examData.isBlitz,
      secondsLeft: examData.durationSeconds || 15 * 60
    };

    // Reset combo for this test
    state.comboMultiplier = 1.0;
    state.currentComboStreak = 0;
    renderHUD();

    document.getElementById('arenaModesContainer').style.display = 'none';
    document.getElementById('examStageContainer').classList.add('active');
    document.getElementById('examTitleBadge').textContent = examData.title;

    renderExamNavStrip();
    renderCurrentExamQuestion();
    startExamTimer();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function startExamTimer() {
    clearInterval(examTimerInterval);
    const chip = document.getElementById('examTimerChip');

    function update() {
      if (!state.activeExam) return;
      const s = state.activeExam.secondsLeft;
      const m = Math.floor(s / 60);
      const rem = s % 60;
      chip.textContent = `⏱️ ${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;

      if (s <= 0) {
        clearInterval(examTimerInterval);
        showToast('Time expired! Auto-submitting OMR sheet...');
        window.submitCurrentExam();
      } else {
        state.activeExam.secondsLeft--;
      }
    }
    update();
    examTimerInterval = setInterval(update, 1000);
  }

  function renderExamNavStrip() {
    const strip = document.getElementById('examNavStrip');
    if (!strip || !state.activeExam) return;
    strip.innerHTML = '';

    const exam = state.activeExam;
    exam.questions.forEach((_, idx) => {
      const btn = document.createElement('button');
      btn.className = 'q-dot-btn';
      btn.textContent = idx + 1;

      if (idx === exam.currentIndex) btn.classList.add('current');
      if (exam.userAnswers[idx] !== null) btn.classList.add('answered');

      btn.addEventListener('click', () => {
        soundFX.click();
        exam.currentIndex = idx;
        renderExamNavStrip();
        renderCurrentExamQuestion();
      });

      strip.appendChild(btn);
    });
  }

  function renderCurrentExamQuestion() {
    const exam = state.activeExam;
    if (!exam) return;
    const idx = exam.currentIndex;
    const q = exam.questions[idx];

    document.getElementById('qNumberPill').textContent = `Question ${idx + 1} of ${exam.questions.length}`;
    document.getElementById('qSubjectTag').textContent = q.subject || exam.subject || 'General';
    document.getElementById('qPromptText').textContent = q.q;

    const stack = document.getElementById('optionsStack');
    stack.innerHTML = '';

    const letters = ['A', 'B', 'C', 'D'];
    q.options.forEach((optText, optIdx) => {
      const row = document.createElement('button');
      row.className = 'omr-option-row';
      row.type = 'button';

      const isSelected = exam.userAnswers[idx] === optIdx;
      if (isSelected) row.classList.add('selected');

      // Post submission reveals
      if (exam.submitted) {
        row.disabled = true;
        if (optIdx === q.answer) {
          row.classList.add('correct-reveal');
        } else if (isSelected && optIdx !== q.answer) {
          row.classList.add('wrong-reveal');
        }
      }

      row.innerHTML = `
        <span class="omr-bubble-marker">${letters[optIdx]}</span>
        <span class="omr-text-content">${optText}</span>
      `;

      row.addEventListener('click', () => {
        if (exam.submitted) return;
        soundFX.select();
        exam.userAnswers[idx] = optIdx;
        renderExamNavStrip();
        renderCurrentExamQuestion();
      });

      stack.appendChild(row);
    });

    // Syllabic Explanation Tip Box
    const tipBox = document.getElementById('qTipBox');
    if (exam.submitted && q.tip) {
      tipBox.querySelector('.tip-explanation-text').textContent = q.tip;
      tipBox.classList.add('active');
    } else {
      tipBox.classList.remove('active');
    }

    // Prev / Next button states
    document.getElementById('btnPrevQ').disabled = idx === 0;
    document.getElementById('btnNextQ').style.display = idx === exam.questions.length - 1 ? 'none' : 'inline-flex';
    document.getElementById('btnSubmitExam').style.display = exam.submitted ? 'none' : 'inline-flex';
  }

  window.navigateExamQ = function (direction) {
    soundFX.click();
    if (!state.activeExam) return;
    const newIdx = state.activeExam.currentIndex + direction;
    if (newIdx >= 0 && newIdx < state.activeExam.questions.length) {
      state.activeExam.currentIndex = newIdx;
      renderExamNavStrip();
      renderCurrentExamQuestion();
    }
  };

  window.submitCurrentExam = function () {
    const exam = state.activeExam;
    if (!exam || exam.submitted) return;

    clearInterval(examTimerInterval);
    exam.submitted = true;

    // Evaluate answers & compute combo multiplier
    let score = 0;
    let earnedXp = 0;
    let currentStreak = 0;
    let maxCombo = 1.0;

    exam.questions.forEach((q, i) => {
      const userAns = exam.userAnswers[i];
      if (userAns === q.answer) {
        score++;
        currentStreak++;
        let mult = 1.0;
        if (currentStreak >= 5) mult = 2.5;
        else if (currentStreak >= 3) mult = 2.0;
        else if (currentStreak >= 2) mult = 1.5;

        if (mult > maxCombo) maxCombo = mult;
        earnedXp += Math.round(25 * mult);
      } else {
        currentStreak = 0;
      }
    });

    state.comboMultiplier = maxCombo;
    renderHUD();

    const total = exam.questions.length;
    const accuracy = Math.round((score / total) * 100);

    // Update candidate profile stats
    state.profile.xp += earnedXp;
    state.profile.stats.totalQuestions = (state.profile.stats.totalQuestions || 0) + total;
    state.profile.stats.correctAnswers = (state.profile.stats.correctAnswers || 0) + score;

    // Check Badges
    checkAndUnlockBadge('first_blood');
    if (accuracy === 100) checkAndUnlockBadge('perfect_omr');
    if (maxCombo >= 2.0) checkAndUnlockBadge('combo_fire');
    if (exam.isBlitz && accuracy >= 75) checkAndUnlockBadge('speed_demon');
    if (state.currentTrack === 'dsc') checkAndUnlockBadge('wkh_pioneer');

    const curRank = getRankForXp(state.profile.xp);
    if (curRank.level >= 3) checkAndUnlockBadge('mpsc_elite');

    // Sounds & celebratory effects
    if (accuracy >= 80) {
      soundFX.fanfare();
      launchConfetti(3000);
    } else if (accuracy >= 50) {
      soundFX.correct();
    } else {
      soundFX.wrong();
    }

    saveGamificationProfile();
    renderHUD();
    renderExamNavStrip();
    renderCurrentExamQuestion();

    // Open scorecard modal
    const modal = document.getElementById('examResultsModal');
    document.getElementById('resScoreFraction').textContent = `${score} / ${total}`;
    document.getElementById('resAccuracyPct').textContent = `${accuracy}%`;
    document.getElementById('resXpEarned').textContent = `+${earnedXp} XP`;
    document.getElementById('resRankBadge').textContent = `${curRank.icon} ${curRank.title}`;
    modal.classList.add('active');
  };

  window.reviewOMRAnswers = function () {
    soundFX.click();
    document.getElementById('examResultsModal').classList.remove('active');
    renderCurrentExamQuestion();
  };

  window.closeResultsModal = function () {
    soundFX.click();
    document.getElementById('examResultsModal').classList.remove('active');
    document.getElementById('examStageContainer').classList.remove('active');
    document.getElementById('arenaModesContainer').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Keyboard Shortcuts during exam
  window.addEventListener('keydown', (e) => {
    if (!state.activeExam || state.activeExam.submitted) return;
    const key = e.key.toLowerCase();
    if (['1', '2', '3', '4'].includes(key)) {
      const optIdx = parseInt(key, 10) - 1;
      state.activeExam.userAnswers[state.activeExam.currentIndex] = optIdx;
      soundFX.select();
      renderExamNavStrip();
      renderCurrentExamQuestion();
    } else if (['a', 'b', 'c', 'd'].includes(key)) {
      const map = { a: 0, b: 1, c: 2, d: 3 };
      state.activeExam.userAnswers[state.activeExam.currentIndex] = map[key];
      soundFX.select();
      renderExamNavStrip();
      renderCurrentExamQuestion();
    } else if (key === 'arrowright') {
      window.navigateExamQ(1);
    } else if (key === 'arrowleft') {
      window.navigateExamQ(-1);
    }
  });

  // ==========================================================================
  // 10. AUTHENTICATION & CLOUD SQLITE PROFILE SYNC
  // ==========================================================================
  async function loadGamificationProfile() {
    try {
      const token = state.profile.token || localStorage.getItem('wkh_auth_token');
      const res = await fetch('/api/gamification/profile', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (res.ok && data.profile) {
        state.profile.authenticated = !!data.authenticated;
        state.profile.xp = data.profile.xp || 0;
        state.profile.streakCount = data.profile.streakCount || 1;
        state.profile.streakShields = data.profile.streakShields || 1;
        state.profile.badges = data.profile.badges || [];
        state.profile.stats = data.profile.stats || {};
        if (data.profile.username) state.profile.username = data.profile.username;
      }
    } catch (e) {}
    renderHUD();
  }

  async function saveGamificationProfile() {
    try {
      const token = state.profile.token || localStorage.getItem('wkh_auth_token');
      await fetch('/api/gamification/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          xp: state.profile.xp,
          level: getRankForXp(state.profile.xp).level,
          rankTitle: getRankForXp(state.profile.xp).title,
          streakCount: state.profile.streakCount,
          streakShields: state.profile.streakShields,
          highestCombo: state.comboMultiplier,
          badges: state.profile.badges,
          stats: state.profile.stats
        })
      });
    } catch (e) {}
  }

  window.openAuthModal = function () {
    soundFX.click();
    document.getElementById('authModalOverlay').classList.add('active');
  };

  window.closeAuthModal = function () {
    document.getElementById('authModalOverlay').classList.remove('active');
  };

  window.switchAuthTab = function (mode) {
    soundFX.click();
    document.getElementById('authTabLogin').classList.toggle('active', mode === 'login');
    document.getElementById('authTabRegister').classList.toggle('active', mode === 'register');
    document.getElementById('authActionBtn').textContent = mode === 'login' ? 'Secure Log In' : 'Register Candidate Profile';
    document.getElementById('authActionBtn').dataset.mode = mode;
  };

  window.submitAuthForm = async function () {
    soundFX.click();
    const username = document.getElementById('authUsernameInput').value.trim();
    const password = document.getElementById('authPasswordInput').value.trim();
    const mode = document.getElementById('authActionBtn').dataset.mode || 'login';
    const errEl = document.getElementById('authErrorText');
    errEl.textContent = '';

    if (!username || !password) {
      errEl.textContent = 'Please enter both username and password.';
      return;
    }

    try {
      const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        errEl.textContent = data.error || 'Authentication error';
        return;
      }

      state.profile.authenticated = true;
      state.profile.username = data.user.username;
      state.profile.token = data.token;
      localStorage.setItem('wkh_auth_token', data.token);

      await loadGamificationProfile();
      window.closeAuthModal();
      showToast(`Welcome, Candidate ${state.profile.username}!`, 'gold');
    } catch (e) {
      errEl.textContent = 'Network or server error.';
    }
  };

  window.logoutCandidate = function () {
    soundFX.click();
    state.profile.authenticated = false;
    state.profile.username = 'Cadet_Candidate';
    state.profile.token = '';
    localStorage.removeItem('wkh_auth_token');
    renderHUD();
    showToast('Logged out successfully.');
  };

  // ==========================================================================
  // 11. INITIALIZATION & EVENT LISTENERS
  // ==========================================================================
  document.addEventListener('DOMContentLoaded', () => {
    // Sound Toggle
    const soundBtn = document.getElementById('soundToggleBtn');
    if (soundBtn) {
      soundBtn.addEventListener('click', () => {
        state.soundEnabled = !state.soundEnabled;
        if (state.soundEnabled) soundFX.click();
        renderHUD();
      });
    }

    // Track Switcher Buttons
    document.querySelectorAll('.track-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        soundFX.click();
        state.currentTrack = btn.dataset.track;
        document.querySelectorAll('.track-pill-btn').forEach(b => b.classList.toggle('active', b === btn));
        renderHUD();
        renderCalendarMatrix();
        renderSubjectVault();
      });
    });

    // Arena Tab Switcher
    document.querySelectorAll('.nav-tab-item').forEach(btn => {
      btn.addEventListener('click', () => {
        soundFX.click();
        const mode = btn.dataset.view;
        state.currentView = mode;
        document.querySelectorAll('.nav-tab-item').forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.arena-view').forEach(v => {
          v.classList.toggle('active', v.id === `view_${mode}`);
        });

        if (mode === 'vault') renderSubjectVault();
        else if (mode === 'honors') renderHonorsWall();
      });
    });

    // Calendar Month Navigation
    document.getElementById('calPrevMonthBtn')?.addEventListener('click', () => {
      soundFX.click();
      state.calendarDate.setMonth(state.calendarDate.getMonth() - 1);
      renderCalendarMatrix();
    });
    document.getElementById('calNextMonthBtn')?.addEventListener('click', () => {
      soundFX.click();
      state.calendarDate.setMonth(state.calendarDate.getMonth() + 1);
      renderCalendarMatrix();
    });
    document.getElementById('calTodayShortcutBtn')?.addEventListener('click', () => {
      soundFX.click();
      state.calendarDate = new Date();
      renderCalendarMatrix();
    });

    // Initial Render Sequence
    loadGamificationProfile();
    renderHUD();
    renderCalendarMatrix();
    renderSubjectVault();
    renderHonorsWall();
  });

})();
