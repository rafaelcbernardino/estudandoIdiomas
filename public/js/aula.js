// Lesson page controller
const params   = new URLSearchParams(location.search);
const COURSE   = params.get('course') || 'ingles';
const AULA_PATH = params.get('aulaPath') || '';
const AULA_NAME = AULA_PATH.split('/').pop();

// State
let savedAnswers = {};
let notesTimer;
let recognition;
const inlinePlayers = {};

// Song / Karaoke state
let songData      = null;
let ytPlayer      = null;
let karaokeTimer  = null;
let lyricOffset   = 0;    // seconds to shift timestamps (user calibration)
let lastActiveIdx = -1;

// ── Page header ───────────────────────────────────────────────────────────
document.getElementById('aula-title').textContent = AULA_NAME || 'Aula';
document.getElementById('aula-subtitle').textContent =
  AULA_PATH.includes('/')
    ? AULA_PATH.split('/')[0]
    : /^Extra\s*Class/i.test(AULA_NAME) ? 'Extra Class — Inglês' : 'Inglês — Junior Silveira';
document.getElementById('back-btn').href = `/${COURSE}.html`;

// ── Init ──────────────────────────────────────────────────────────────────
async function init() {
  let audioFiles = [];

  try {
    const [structure, answersData] = await Promise.all([
      fetch(`/api/courses/${COURSE}/structure`).then(r => r.json()),
      fetch(`/api/homework/${COURSE}/${encodeURIComponent(AULA_PATH)}`).then(r => r.json()),
    ]);

    answersData.forEach(r => {
      savedAnswers[`${r.exercise_id}__${r.item_id}`] = r.answer;
    });

    for (const mod of structure) {
      const found = mod.aulas.find(a => a.path === AULA_PATH || a.name === AULA_NAME);
      if (found) { audioFiles = found.audioFiles || []; break; }
    }
  } catch (err) {
    console.error('Init error:', err);
  }

  // 1️⃣ Homework first (with inline players)
  renderHomework(audioFiles);
  initInlinePlayers(audioFiles);

  // 2️⃣ Song section (if available) — injected between HW and audio
  await loadSongSection();

  // 3️⃣ Full audio section
  renderFullAudioList(audioFiles);

  // 4️⃣ Notes
  await loadNotes();
  initNotes();
}

// ── Fuzzy Answer Checking ─────────────────────────────────────────────────

function normalize(str) {
  return (str || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // strip accents
    .replace(/[.,!?;:'"¿¡\-]/g, '')   // strip punctuation
    .replace(/\s+/g, ' ');
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

// Returns { result: 'correct'|'partial'|'incorrect'|'empty', issues: string[] }
function fuzzyCheck(given, correct) {
  const g = (given  || '').trim();
  const c = (correct || '').trim();
  if (!g) return { result: 'empty', issues: [] };

  // Exact
  if (g === c) return { result: 'correct', issues: [] };

  const gLow = g.toLowerCase();
  const cLow = c.toLowerCase();
  if (gLow === cLow) return { result: 'partial', issues: ['Atenção às letras maiúsculas'] };

  const gNorm = normalize(g);
  const cNorm = normalize(c);

  // Same after stripping accents + punctuation
  if (gNorm === cNorm) {
    const issues = [];
    const gNoAcc = g.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const cNoAcc = c.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const accentsDiffer = gNoAcc.replace(/[.,!?;:'"¿¡\-]/g,'') !== cNoAcc.replace(/[.,!?;:'"¿¡\-]/g,'');
    const punctDiffer   = gLow.replace(/[.,!?;:'"¿¡\-]/g,'')  !== cLow.replace(/[.,!?;:'"¿¡\-]/g,'');
    if (accentsDiffer) issues.push('acentuação');
    if (punctDiffer && !accentsDiffer) issues.push('pontuação');
    if (!accentsDiffer && !punctDiffer) issues.push('espaçamento');
    return { result: 'partial', issues: [`Verifique: ${issues.join(', ')}`] };
  }

  // Levenshtein on normalized strings — allow ~15% error
  const dist = levenshtein(gNorm, cNorm);
  const maxDist = Math.max(1, Math.floor(cNorm.length * 0.15));
  if (dist <= maxDist) {
    return {
      result: 'partial',
      issues: [`Erro de grafia (${dist} caractere${dist > 1 ? 's' : ''} diferente${dist > 1 ? 's' : ''})`],
    };
  }

  return { result: 'incorrect', issues: [] };
}

function applyFeedback(inputEl, feedbackEl, chk) {
  inputEl.classList.remove('correct', 'partial', 'incorrect');
  if (feedbackEl) feedbackEl.innerHTML = '';

  if (chk.result === 'empty') return;

  if (chk.result === 'correct') {
    inputEl.classList.add('correct');
    if (feedbackEl) feedbackEl.innerHTML = '<span class="fb-correct">✓ Correto!</span>';

  } else if (chk.result === 'partial') {
    inputEl.classList.add('partial');
    const detail = chk.issues.join('; ');
    if (feedbackEl)
      feedbackEl.innerHTML =
        `<span class="fb-partial">⚠ Correto com ressalvas → <em>${detail}</em></span>`;

  } else {
    inputEl.classList.add('incorrect');
    if (feedbackEl) feedbackEl.innerHTML = '<span class="fb-incorrect">✗ Incorreto. Tente novamente!</span>';
  }
}

// ── Check functions ───────────────────────────────────────────────────────

function checkEx2() {
  ['a','b','c','d','e'].forEach((l, i) => {
    const inp = document.getElementById(`ex2-item${l}`);
    const fb  = document.getElementById(`fb-ex2-${l}`);
    if (inp) applyFeedback(inp, fb, fuzzyCheck(inp.value, MATCH_ANSWERS[i]));
  });
}

function checkEx3() {
  TRANSLATE_Q.forEach((_, i) => {
    const inp = document.getElementById(`ex3-item${i}`);
    const fb  = document.getElementById(`fb-ex3-${i}`);
    if (inp) applyFeedback(inp, fb, fuzzyCheck(inp.value, TRANSLATE_A[i]));
  });
}

function checkSong() {
  let counts = { correct: 0, partial: 0, incorrect: 0 };
  SONG_SEGMENTS.filter(s => s.type === 'blank').forEach(seg => {
    const inp = document.getElementById(`ex6-blank${seg.num}`);
    if (!inp) return;
    const chk = fuzzyCheck(inp.value, seg.answer);
    inp.classList.remove('correct', 'partial', 'incorrect');
    if      (chk.result === 'correct')   { inp.classList.add('correct');   counts.correct++; }
    else if (chk.result === 'partial')   { inp.classList.add('partial');   counts.partial++; }
    else if (chk.result === 'incorrect') { inp.classList.add('incorrect'); counts.incorrect++; }
  });

  const summary = document.getElementById('ex6-summary');
  if (!summary) return;
  const parts = [];
  if (counts.correct)   parts.push(`<span class="fb-correct">✓ ${counts.correct} correto${counts.correct > 1 ? 's' : ''}</span>`);
  if (counts.partial)   parts.push(`<span class="fb-partial">⚠ ${counts.partial} com ressalvas</span>`);
  if (counts.incorrect) parts.push(`<span class="fb-incorrect">✗ ${counts.incorrect} incorreto${counts.incorrect > 1 ? 's' : ''}</span>`);
  summary.innerHTML = parts.join('&nbsp; | &nbsp;');
}

function toggleAnswerKey(id) {
  document.getElementById(id)?.classList.toggle('revealed');
}

// ── Inline Audio Players (inside exercises) ───────────────────────────────

// Maps exercise id → audio filename per Aula
const AUDIO_MAPS = {
  'Aula 1': { ex1: 'dialogue_aula1.mp3', ex2: 'homework1_ex2.mp3', ex3: 'homework1_ex3.mp3', ex4: 'homework1_ex4.mp3' },
  'Aula 2': { ex1: 'homework2_ex1.mp3', ex2: 'homework2_ex2.mp3', ex3: 'homework2_ex3.mp3', ex4: 'homework2_ex4.mp3', ex5: 'homework2_ex5.mp3' },
  'Aula 3': { ex1: 'dialogue_aula3.mp3', ex2: 'homework3_ex2.mp3', ex3: 'homework3_ex3.mp3', ex4: 'homework3_ex4.mp3', ex5: 'homework3_ex5.mp3' },
};
function getAudioMap() { return AUDIO_MAPS[AULA_NAME] || {}; }

function buildInlinePlayerHtml(exId, filename) {
  return `
    <div class="inline-player" title="Áudio do exercício">
      <button class="inline-play-btn" id="ipb-${exId}">▶</button>
      <input type="range" class="inline-seek" id="ips-${exId}"
        value="0" min="0" max="100" step="0.1" />
      <span class="inline-time" id="ipt-${exId}">0:00</span>
      <audio id="ipa-${exId}"
        src="/api/audio/${COURSE}/${AULA_PATH.split('/').map(encodeURIComponent).join('/')}/${encodeURIComponent(filename)}"
        preload="metadata"></audio>
    </div>`;
}

function initInlinePlayers(audioFiles) {
  Object.entries(getAudioMap()).forEach(([exId, filename]) => {
    if (!audioFiles.includes(filename)) return;

    const audio = document.getElementById(`ipa-${exId}`);
    const btn   = document.getElementById(`ipb-${exId}`);
    const seek  = document.getElementById(`ips-${exId}`);
    const time  = document.getElementById(`ipt-${exId}`);
    if (!audio || !btn) return;

    inlinePlayers[exId] = { audio, btn, seek, time };

    audio.addEventListener('loadedmetadata', () => {
      seek.max = audio.duration;
      time.textContent = fmt(audio.duration);
    });

    audio.addEventListener('timeupdate', () => {
      seek.value = audio.currentTime;
      time.textContent = `${fmt(audio.currentTime)} / ${fmt(audio.duration)}`;
    });

    audio.addEventListener('play',  () => { btn.textContent = '⏸'; });
    audio.addEventListener('pause', () => { btn.textContent = '▶'; });
    audio.addEventListener('ended', () => { btn.textContent = '▶'; seek.value = 0; });

    btn.addEventListener('click', () => {
      audio.paused ? audio.play() : audio.pause();
    });

    seek.addEventListener('input', () => {
      audio.currentTime = parseFloat(seek.value);
    });
  });
}

// ── Homework Renderer ─────────────────────────────────────────────────────

function renderHomework(audioFiles) {
  const container = document.getElementById('homework-container');
  if (AULA_NAME === 'Aula 1') {
    container.innerHTML = buildHW1(audioFiles);
  } else if (AULA_NAME === 'Aula 2') {
    container.innerHTML = buildHW2(audioFiles);
  } else if (AULA_NAME === 'Aula 3') {
    container.innerHTML = buildHW3(audioFiles);
  } else {
    container.innerHTML = buildHWGeneric(audioFiles);
  }
}

// ── Homework data ─────────────────────────────────────────────────────────

const MATCH_MIDDLE  = ['afternoon', 'morning', 'are you doing?', 'evening', 'night'];
const MATCH_ANSWERS = ['Good afternoon', 'Good morning', 'Good evening', 'Good night', 'How are you doing?'];

const TRANSLATE_Q = [
  'How are you?',
  'Hello, good afternoon.',
  "I'm fine. And you?",
  'How are you doing?',
  'Thank you.',
];
const TRANSLATE_A = [
  'Como você está?',
  'Olá, boa tarde.',
  'Estou bem. E você?',
  'Como você está?',
  'Obrigado.',
];

const SONG_SEGMENTS = [
  { type:'text',  text:'Hello' },
  { type:'text',  text:"It's me" },
  { type:'text',  text:'I was wondering if after all these years' },
  { type:'text',  text:"You'd like to meet" },
  { type:'text',  text:'To go over everything' },
  { type:'text',  text:"They say that time's supposed to heal ya" },
  { type:'blank', num:1,  answer:'I',           suffix:" ain't done much healing" },
  { type:'spacer' },
  { type:'blank', num:2,  answer:'Hello',        suffix:'' },
  { type:'text',  text:'Can you hear me?' },
  { type:'text',  text:"I'm in California dreaming about who we used to be" },
  { type:'text',  text:'When we were younger and free' },
  { type:'text',  text:"I've forgotten how it felt before the world fell at our feet" },
  { type:'spacer' },
  { type:'text',  text:"There's such a difference between us" },
  { type:'text',  text:'And a million miles' },
  { type:'spacer' },
  { type:'blank', num:3,  answer:'Hello',        suffix:' from the other side' },
  { type:'text',  text:"I must've called a thousand times" },
  { type:'text',  text:'To tell' },
  { type:'blank', num:4,  answer:'you',          suffix:" I'm sorry" },
  { type:'text',  text:"For everything that I've done" },
  { type:'text',  text:'But when I call you never' },
  { type:'text',  text:'Seem to be home' },
  { type:'spacer' },
  { type:'blank', num:5,  answer:'Hello',        suffix:' from the outside' },
  { type:'text',  text:"At least I can say that I've tried" },
  { type:'text',  text:"To tell you I'm(6)" },
  { type:'blank', num:6,  answer:'sorry',        suffix:'' },
  { type:'text',  text:'For breaking your heart' },
  { type:'text',  text:"But it don't matter, it clearly" },
  { type:'text',  text:"Doesn't tear" },
  { type:'blank', num:7,  answer:'you',          suffix:' apart anymore' },
  { type:'spacer' },
  { type:'text',  text:'Hello' },
  { type:'blank', num:8,  answer:'How are you?', suffix:'' },
  { type:'text',  text:"It's so typical of me to talk about myself" },
  { type:'text',  text:"I'm sorry," },
  { type:'text',  text:"I hope that you're well" },
  { type:'text',  text:'Did you ever make it out of that town' },
  { type:'text',  text:'Where nothing ever happened?' },
  { type:'spacer' },
  { type:'text',  text:"It's no secret that the both of us" },
  { type:'text',  text:'Are running out of time' },
  { type:'spacer' },
  { type:'text',  text:'So' },
  { type:'blank', num:9,  answer:'Hello',        suffix:' from the other side' },
  { type:'text',  text:"I must've called a thousand times" },
  { type:'text',  text:"To tell you I'm sorry" },
  { type:'text',  text:"For everything that I've done" },
  { type:'text',  text:'But when' },
  { type:'blank', num:10, answer:'I',            suffix:' call you never' },
  { type:'text',  text:'Seem to be home' },
  { type:'spacer' },
  { type:'blank', num:11, answer:'Hello',        suffix:' from the outside' },
  { type:'text',  text:"At least I can say that I've tried" },
  { type:'text',  text:"To tell you I'm sorry" },
  { type:'text',  text:'For breaking your heart' },
  { type:'text',  text:"But it don't matter, it clearly" },
  { type:'text',  text:"Doesn't tear you apart anymore" },
  { type:'spacer' },
  { type:'blank', num:12, answer:'Hello',        suffix:' from the other side' },
  { type:'text',  text:"I must've called a thousand times" },
  { type:'text',  text:"To tell you I'm sorry" },
  { type:'text',  text:"For everything that I've done" },
  { type:'text',  text:'But when I call you never' },
  { type:'text',  text:'Seem to be home' },
  { type:'spacer' },
  { type:'blank', num:13, answer:'Hello',        suffix:' from the outside' },
  { type:'text',  text:"At least I can say that I've tried" },
  { type:'text',  text:"To tell you I'm sorry" },
  { type:'text',  text:'For breaking your heart' },
  { type:'text',  text:"But it don't matter, it clearly" },
  { type:'text',  text:"Doesn't tear you apart anymore" },
];

// ── HW2 data ──────────────────────────────────────────────────────────────

const HW2_EX1_Q = [
  'Como você está?', 'Como você está indo?', 'Como estão as coisas?',
  'Eu estou ótimo.', 'Meu nome é Jéssica.', 'Meu nome completo é Sarah Jones.',
  'Prazer em conhecê-lo.', 'Muito obrigado.', 'De nada.', 'Adeus.',
  'Te vejo mais tarde.', 'Tenha um bom dia!', 'Tenha um bom final de semana!',
];
const HW2_EX1_A = [
  'How are you?', 'How are you doing?', 'How are things?',
  "I'm great.", 'My name is Jessica.', 'My full name is Sarah Jones.',
  'Nice to meet you.', 'Thank you.', "You're welcome.", 'Goodbye.',
  'See you later.', 'Have a nice day.', 'Have a nice weekend.',
];

const HW2_EX2_PICS = [
  { emoji: '🌅', scene: 'Criança acordando na cama com sol pela janela', answer: 'Good morning' },
  { emoji: '🌆', scene: 'Casal jantando à luz de velas ao pôr do sol', answer: 'Good evening' },
  { emoji: '🌙', scene: 'Pessoa dormindo sob luz azul da lua', answer: 'Good night' },
  { emoji: '☀️', scene: 'Família almoçando juntos durante o dia', answer: 'Good afternoon' },
];

const HW2_EX3_Q = [
  'Have nice day!', "What's full name?", 'What are you?', 'Tank you.', 'Nice to meat you.',
];
const HW2_EX3_A = [
  'Have a nice day!', "What's your full name?", 'How are you?', 'Thank you.', 'Nice to meet you.',
];

const HW2_EX4_SCRAMBLED = [
  'have / how / been / you?', 'things / are / how?', 'you / to / meet / glad.',
  'afternoon / good.', 'you / soon / to / talk.',
];
const HW2_EX4_A = [
  'How have you been?', 'How are things?', 'Glad to meet you.',
  'Good afternoon.', 'Talk to you soon.',
];

const HW2_EX5_Q = [
  "What's your name?", 'Where are you from?', 'How old are you?',
  'Do you have brothers or sisters?', 'Do you work?',
];

// ── HW3 data ──────────────────────────────────────────────────────────────

const HW3_EX1_LINES = [
  { speaker: 'Jr',    text: "No, I'm from Sao Paulo.",                                        bold: false },
  { speaker: 'Brian', text: 'So, tell me Junior... where are you from?',                       bold: true  },
  { speaker: 'Jr',    text: 'Great! Where are you from in the USA?',                           bold: false },
  { speaker: 'Brian', text: 'Nice! São Paulo is a big city.',                                  bold: true  },
  { speaker: 'Jr',    text: "I'm from Brazil, what about you?",                                bold: false },
  { speaker: 'Brian', text: "I'm from the USA.",                                               bold: true  },
  { speaker: 'Jr',    text: 'Yes, it is.',                                                     bold: false },
  { speaker: 'Brian', text: "I'm from San Francisco. And you? Are you from Rio de Janeiro?",  bold: true  },
];
const HW3_EX1_ANSWERS = ['6', '1', '4', '7', '2', '3', '8', '5'];

const HW3_COUNTRIES     = ['Brazil','The USA','Canada','France','Australia','Colombia','Spain','Germany','England','Jamaica'];
const HW3_NATIONALITIES = ['Brazilian','American','Canadian','French','Australian','Colombian','Spanish','German','English','Jamaican'];

const HW3_EX3_FLAGS = [
  { emoji: '🇨🇴', name: 'Colombia' },
  { emoji: '🇫🇷', name: 'France'   },
  { emoji: '🇧🇷', name: 'Brazil'   },
  { emoji: '🇺🇸', name: 'The USA'  },
];

const HW3_EX4_PEOPLE = [
  { label: 'b)', hint: 'Rainha do Reino Unido (Queen of the United Kingdom)', answer: "She's Queen Elizabeth II. She's from England." },
  { label: 'c)', hint: 'Ator americano, famoso pelo filme Titanic',            answer: "He's Leonardo Di Caprio. He's from the USA."   },
  { label: 'd)', hint: 'Piloto de Fórmula 1, multicampeão alemão',            answer: "He's Michael Schumacher. He's from Germany."   },
];

const HW3_EX5_Q = [
  'De onde você é?', 'Eu sou da Inglaterra.', 'De onde ela é?',
  'Ela é da Espanha.', 'Elas são amigas.',
];
const HW3_EX5_A = [
  'Where are you from?', "I'm from England.", 'Where is she from?',
  "She's from Spain.", 'They are friends.',
];

// ── HW1 Builder ───────────────────────────────────────────────────────────

function getSaved(exId, itemId) {
  return savedAnswers[`${exId}__${itemId}`] || '';
}

function exHeader(num, title, subtitle, audioFiles, exKey) {
  const audioMap = getAudioMap();
  const filename = exKey && audioMap[exKey];
  const hasAudio = filename && audioFiles.includes(filename);
  const playerHtml = hasAudio ? buildInlinePlayerHtml(exKey, filename) : '';
  return `
    <div class="hw-exercise-header">
      <div class="hw-ex-meta">
        <div class="hw-exercise-title">${num}. ${title}</div>
        <div class="hw-exercise-subtitle">${subtitle}</div>
      </div>
      ${playerHtml}
    </div>`;
}

function buildHW1(audioFiles) {
  return `
    <div class="hw-obs">
      Obs.: A quantidade de exercícios e o grau de dificuldade aumentarão de acordo com sua evolução no curso.
    </div>

    <h2 style="font-size:1.2rem;font-weight:800;color:var(--color-accent);margin-bottom:28px">
      Aula 1 – What's up?
    </h2>

    <!-- Exercise 1 -->
    <div class="hw-exercise">
      ${exHeader(1, 'Read, listen, and repeat the dialogue:', '(Leia, ouça e repita o diálogo)', audioFiles, 'ex1')}

      <div style="display:grid;grid-template-columns:1fr auto;gap:16px;align-items:start">
        <div class="hw-dialogue">
          <div class="hw-line"><span class="hw-speaker brian">Brian:</span><span><strong>Hello, good morning!</strong></span></div>
          <div class="hw-line"><span class="hw-speaker jr">JR:</span><span>Hi, good morning!</span></div>
          <div class="hw-line"><span class="hw-speaker brian">Brian:</span><span><strong>How are you?</strong></span></div>
          <div class="hw-line"><span class="hw-speaker jr">JR:</span><span>I'm fine and you?</span></div>
          <div class="hw-line"><span class="hw-speaker brian">Brian:</span><span><strong>I am great, thanks!</strong></span></div>
          <div class="hw-line"><span class="hw-speaker jr">JR:</span><span>You're welcome! What's your name?</span></div>
          <div class="hw-line"><span class="hw-speaker brian">Brian:</span><span><strong>My name is Brian. And what's your name?</strong></span></div>
          <div class="hw-line"><span class="hw-speaker jr">JR:</span><span>I'm Junior Silveira, it's my first time here. Nice to meet you.</span></div>
          <div class="hw-line"><span class="hw-speaker brian">Brian:</span><span><strong>Nice to meet you, too.</strong></span></div>
        </div>
        <div class="hw-notes-col" style="min-width:140px">
          <div class="hw-notes-col-title">YOUR NOTES<br/>(SUAS ANOTAÇÕES):</div>
          <textarea id="ex1-notes"
            style="width:100%;min-height:120px;background:transparent;border:none;border-bottom:1px solid var(--color-border);color:var(--color-text);font-size:0.8rem;resize:vertical;outline:none;font-family:Poppins,sans-serif;padding:4px 0"
            placeholder="Suas anotações…"
            oninput="saveAnswer('ex1','notes',this.value)"
          >${escHtml(getSaved('ex1','notes'))}</textarea>
        </div>
      </div>
    </div>

    <!-- Exercise 2 -->
    <div class="hw-exercise">
      ${exHeader(2, 'Read, match, and translate:', '(Leia, relacione e traduza)', audioFiles, 'ex2')}

      <div style="background:rgba(0,0,0,0.2);border-radius:12px;padding:20px;border:1px solid var(--color-border)">
        <div style="display:grid;grid-template-columns:90px 1fr;gap:4px 0;margin-bottom:6px;font-size:0.72rem;text-transform:uppercase;letter-spacing:1px;color:var(--color-text-muted)">
          <div>Palavra</div><div>Resposta</div>
        </div>

        ${MATCH_MIDDLE.map((word, i) => {
          const letter = String.fromCharCode(97 + i);
          const labelWords = ['Good','How'];
          const label = i < 2 ? labelWords[i] : '';
          return `
            <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:10px">
              <div style="min-width:90px;font-weight:700;color:var(--color-accent);padding-top:9px;font-size:0.9rem">
                ${label}
              </div>
              <div style="flex:1">
                <div style="color:var(--color-text-muted);font-size:0.85rem;margin-bottom:5px">${word}</div>
                <input type="text" class="hw-match-input" id="ex2-item${letter}"
                  placeholder="${letter})"
                  value="${escHtml(getSaved('ex2','item'+letter))}"
                  oninput="saveAnswer('ex2','item${letter}',this.value)" />
                <div class="check-feedback" id="fb-ex2-${letter}"></div>
              </div>
            </div>`;
        }).join('')}
      </div>

      <div class="hw-actions">
        <button class="btn btn-outline" onclick="checkEx2()" style="font-size:0.82rem;padding:8px 16px">✔ Verificar</button>
        <button class="btn btn-ghost"   onclick="toggleAnswerKey('ex2-key')" style="font-size:0.82rem;padding:8px 16px">🔑 Gabarito</button>
      </div>
      <div class="hw-answer-key" id="ex2-key">
        <strong>Gabarito:</strong> a) Good afternoon &nbsp;|&nbsp; b) Good morning &nbsp;|&nbsp;
        c) Good evening &nbsp;|&nbsp; d) Good night &nbsp;|&nbsp; e) How are you doing?
      </div>
    </div>

    <!-- Exercise 3 -->
    <div class="hw-exercise">
      ${exHeader(3, 'Translate the sentences:', '(Traduza as frases)', audioFiles, 'ex3')}

      <div class="hw-translate-list">
        ${TRANSLATE_Q.map((q, i) => `
          <div class="hw-translate-item">
            <div class="hw-translate-question">
              <span style="color:var(--color-accent);font-weight:700">${String.fromCharCode(97+i)})</span> ${q}
            </div>
            <input type="text" class="hw-match-input" id="ex3-item${i}"
              placeholder="Sua tradução…"
              value="${escHtml(getSaved('ex3','item'+i))}"
              oninput="saveAnswer('ex3','item${i}',this.value)" />
            <div class="check-feedback" id="fb-ex3-${i}"></div>
          </div>`).join('')}
      </div>

      <div class="hw-actions">
        <button class="btn btn-outline" onclick="checkEx3()" style="font-size:0.82rem;padding:8px 16px">✔ Verificar</button>
        <button class="btn btn-ghost"   onclick="toggleAnswerKey('ex3-key')" style="font-size:0.82rem;padding:8px 16px">🔑 Gabarito</button>
      </div>
      <div class="hw-answer-key" id="ex3-key">
        <strong>Gabarito:</strong><br>
        a) Como você está? &nbsp;|&nbsp; b) Olá, boa tarde. &nbsp;|&nbsp;
        c) Estou bem. E você? &nbsp;|&nbsp; d) Como você está? &nbsp;|&nbsp; e) Obrigado.
      </div>
    </div>

    <!-- Exercise 4 -->
    <div class="hw-exercise">
      ${exHeader(4, 'Answer the questions from the previous exercise:', '(Responda as perguntas do exercício anterior)', audioFiles, 'ex4')}

      <div class="hw-translate-list">
        ${TRANSLATE_Q.map((q, i) => `
          <div class="hw-translate-item">
            <div class="hw-translate-question">
              <span style="color:var(--color-accent);font-weight:700">${String.fromCharCode(97+i)})</span> ${q}
            </div>
            <input type="text" class="hw-match-input" id="ex4-item${i}"
              placeholder="Sua resposta em inglês…"
              value="${escHtml(getSaved('ex4','item'+i))}"
              oninput="saveAnswer('ex4','item${i}',this.value)" />
          </div>`).join('')}
      </div>

      <div class="hw-actions">
        <button class="btn btn-ghost" onclick="toggleAnswerKey('ex4-key')" style="font-size:0.82rem;padding:8px 16px">🔑 Possíveis respostas</button>
      </div>
      <div class="hw-answer-key" id="ex4-key">
        <strong>Possíveis respostas:</strong><br>
        a) I'm good / Pretty good / I'm ok / Not much &nbsp;|&nbsp;
        b) Good afternoon. &nbsp;|&nbsp;
        c) I'm good / Pretty good / I'm ok / Not much &nbsp;|&nbsp;
        d) I'm good / Pretty good / I'm ok / Not much &nbsp;|&nbsp;
        e) You're welcome.
      </div>
    </div>

    <!-- Exercise 5 -->
    <div class="hw-exercise">
      <div class="hw-exercise-header">
        <div class="hw-ex-meta">
          <div class="hw-exercise-title">5. Repeat the sentences from exercises 1 to 4 along with the audio:</div>
          <div class="hw-exercise-subtitle">(Repita as frases dos exercícios 1 a 4 junto com o áudio)</div>
        </div>
      </div>
      <p style="font-size:0.88rem;color:var(--color-text-muted);padding:4px 0">
        ☝️ Use os mini-players ao lado de cada exercício acima, ou o player completo na seção abaixo.
      </p>
    </div>

    <!-- Exercise 6 -->
    <div class="hw-exercise">
      <div class="hw-exercise-header">
        <div class="hw-ex-meta">
          <div class="hw-exercise-title">6. Listen and complete the song:</div>
          <div class="hw-exercise-subtitle">(Ouça e complete a música)</div>
        </div>
      </div>

      <div style="margin-bottom:16px">
        <strong style="color:var(--color-accent)">Hello — Adele</strong>
        <span style="font-size:0.78rem;color:var(--color-text-muted);margin-left:8px">(uso educacional)</span>
      </div>

      <div class="hw-song-section">
        ${buildSongLyrics()}
      </div>

      <div class="hw-actions">
        <button class="btn btn-outline" onclick="checkSong()" style="font-size:0.82rem;padding:8px 16px">✔ Verificar letra</button>
        <button class="btn btn-ghost"   onclick="toggleAnswerKey('ex6-key')" style="font-size:0.82rem;padding:8px 16px">🔑 Gabarito</button>
      </div>
      <div class="song-check-summary" id="ex6-summary"></div>
      <div class="hw-answer-key" id="ex6-key">
        <strong>Gabarito:</strong>
        (1) I &nbsp;|&nbsp; (2) Hello &nbsp;|&nbsp; (3) Hello &nbsp;|&nbsp; (4) you &nbsp;|&nbsp;
        (5) Hello &nbsp;|&nbsp; (6) sorry &nbsp;|&nbsp; (7) you &nbsp;|&nbsp;
        (8) How are you? &nbsp;|&nbsp; (9) Hello &nbsp;|&nbsp; (10) I &nbsp;|&nbsp;
        (11) Hello &nbsp;|&nbsp; (12) Hello &nbsp;|&nbsp; (13) Hello
      </div>
    </div>
  `;
}

function buildSongLyrics() {
  return SONG_SEGMENTS.map(seg => {
    if (seg.type === 'spacer') return '<br>';
    if (seg.type === 'text')  return `<div class="hw-song-line">${seg.text}</div>`;
    if (seg.type === 'blank') {
      const val = escHtml(getSaved('ex6', 'blank' + seg.num));
      const w   = Math.max(80, (seg.answer.length + 2) * 10);
      return `
        <div class="hw-song-line">
          (<span style="color:var(--color-text-muted)">${seg.num}</span>)<input
            type="text" class="hw-blank" id="ex6-blank${seg.num}"
            value="${val}" placeholder="…"
            style="width:${w}px"
            oninput="saveAnswer('ex6','blank${seg.num}',this.value)"
          />${seg.suffix ? ' ' + seg.suffix : ''}
        </div>`;
    }
    return '';
  }).join('');
}

function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── HW2 check functions ───────────────────────────────────────────────────

function checkHW2Ex1() {
  HW2_EX1_Q.forEach((_, i) => {
    const inp = document.getElementById(`hw2ex1-item${i}`);
    const fb  = document.getElementById(`fb-hw2ex1-${i}`);
    if (inp) applyFeedback(inp, fb, fuzzyCheck(inp.value, HW2_EX1_A[i]));
  });
}

function checkHW2Ex2() {
  HW2_EX2_PICS.forEach((pic, i) => {
    const inp = document.getElementById(`hw2ex2-item${i}`);
    const fb  = document.getElementById(`fb-hw2ex2-${i}`);
    if (inp) applyFeedback(inp, fb, fuzzyCheck(inp.value, pic.answer));
  });
}

function checkHW2Ex3() {
  HW2_EX3_Q.forEach((_, i) => {
    const inp = document.getElementById(`hw2ex3-item${i}`);
    const fb  = document.getElementById(`fb-hw2ex3-${i}`);
    if (inp) applyFeedback(inp, fb, fuzzyCheck(inp.value, HW2_EX3_A[i]));
  });
}

function checkHW2Ex4() {
  HW2_EX4_SCRAMBLED.forEach((_, i) => {
    const inp = document.getElementById(`hw2ex4-item${i}`);
    const fb  = document.getElementById(`fb-hw2ex4-${i}`);
    if (inp) applyFeedback(inp, fb, fuzzyCheck(inp.value, HW2_EX4_A[i]));
  });
}

// ── HW3 check functions ───────────────────────────────────────────────────

function checkHW3Ex1() {
  HW3_EX1_LINES.forEach((_, i) => {
    const inp = document.getElementById(`hw3ex1-item${i}`);
    const fb  = document.getElementById(`fb-hw3ex1-${i}`);
    if (!inp) return;
    const val = inp.value.trim();
    const chk = val === '' ? { result: 'empty', issues: [] }
      : val === HW3_EX1_ANSWERS[i] ? { result: 'correct', issues: [] }
      : { result: 'incorrect', issues: [] };
    applyFeedback(inp, fb, chk);
  });
}

function checkHW3Ex2() {
  HW3_COUNTRIES.forEach((_, i) => {
    const inp = document.getElementById(`hw3ex2-item${i}`);
    const fb  = document.getElementById(`fb-hw3ex2-${i}`);
    if (inp) applyFeedback(inp, fb, fuzzyCheck(inp.value, HW3_NATIONALITIES[i]));
  });
}

function checkHW3Ex3() {
  HW3_EX3_FLAGS.forEach((flag, i) => {
    const inp = document.getElementById(`hw3ex3-item${i}`);
    const fb  = document.getElementById(`fb-hw3ex3-${i}`);
    if (inp) applyFeedback(inp, fb, fuzzyCheck(inp.value, flag.name));
  });
}

function checkHW3Ex4() {
  HW3_EX4_PEOPLE.forEach((person, i) => {
    const inp = document.getElementById(`hw3ex4-item${i}`);
    const fb  = document.getElementById(`fb-hw3ex4-${i}`);
    if (inp) applyFeedback(inp, fb, fuzzyCheck(inp.value, person.answer));
  });
}

function checkHW3Ex5() {
  HW3_EX5_Q.forEach((_, i) => {
    const inp = document.getElementById(`hw3ex5-item${i}`);
    const fb  = document.getElementById(`fb-hw3ex5-${i}`);
    if (inp) applyFeedback(inp, fb, fuzzyCheck(inp.value, HW3_EX5_A[i]));
  });
}

// ── HW2 Builder ───────────────────────────────────────────────────────────

function buildHW2(audioFiles) {
  return `
    <div class="hw-obs">
      Obs.: A quantidade de exercícios e o grau de dificuldade aumentarão de acordo com sua evolução no curso.
    </div>

    <h2 style="font-size:1.2rem;font-weight:800;color:var(--color-accent);margin-bottom:28px">
      Aula 2 – Nice to meet you, too
    </h2>

    <!-- Exercise 1 -->
    <div class="hw-exercise">
      ${exHeader(1, 'Translate the sentences into English:', '(Traduza as frases para o inglês)', audioFiles, 'ex1')}
      <div class="hw-translate-list">
        ${HW2_EX1_Q.map((q, i) => `
          <div class="hw-translate-item">
            <div class="hw-translate-question">
              <span style="color:var(--color-accent);font-weight:700">${String.fromCharCode(97+i)})</span> ${q}
            </div>
            <input type="text" class="hw-match-input" id="hw2ex1-item${i}"
              placeholder="Sua tradução em inglês…"
              value="${escHtml(getSaved('hw2ex1','item'+i))}"
              oninput="saveAnswer('hw2ex1','item${i}',this.value)" />
            <div class="check-feedback" id="fb-hw2ex1-${i}"></div>
          </div>`).join('')}
      </div>
      <div class="hw-actions">
        <button class="btn btn-outline" onclick="checkHW2Ex1()" style="font-size:0.82rem;padding:8px 16px">✔ Verificar</button>
        <button class="btn btn-ghost"   onclick="toggleAnswerKey('hw2ex1-key')" style="font-size:0.82rem;padding:8px 16px">🔑 Gabarito</button>
      </div>
      <div class="hw-answer-key" id="hw2ex1-key">
        <strong>Gabarito:</strong><br>
        ${HW2_EX1_A.map((a, i) => `${String.fromCharCode(97+i)}) ${a}`).join(' &nbsp;|&nbsp; ')}
      </div>
    </div>

    <!-- Exercise 2 -->
    <div class="hw-exercise">
      ${exHeader(2, 'Write the correct expression for each picture:', '(Escreva a expressão correta para cada foto)', audioFiles, 'ex2')}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:8px">
        ${HW2_EX2_PICS.map((pic, i) => `
          <div style="background:rgba(0,0,0,0.2);border-radius:12px;padding:16px;border:1px solid var(--color-border);text-align:center">
            <div style="font-size:2.8rem;margin-bottom:8px">${pic.emoji}</div>
            <div style="font-size:0.78rem;color:var(--color-text-muted);margin-bottom:12px">${pic.scene}</div>
            <div style="font-weight:700;color:var(--color-accent);margin-bottom:8px;text-align:left">${String.fromCharCode(97+i)})</div>
            <input type="text" class="hw-match-input" id="hw2ex2-item${i}"
              placeholder="Expressão em inglês…"
              value="${escHtml(getSaved('hw2ex2','item'+i))}"
              oninput="saveAnswer('hw2ex2','item${i}',this.value)" />
            <div class="check-feedback" id="fb-hw2ex2-${i}"></div>
          </div>`).join('')}
      </div>
      <div class="hw-actions">
        <button class="btn btn-outline" onclick="checkHW2Ex2()" style="font-size:0.82rem;padding:8px 16px">✔ Verificar</button>
        <button class="btn btn-ghost"   onclick="toggleAnswerKey('hw2ex2-key')" style="font-size:0.82rem;padding:8px 16px">🔑 Gabarito</button>
      </div>
      <div class="hw-answer-key" id="hw2ex2-key">
        <strong>Gabarito:</strong>
        a) Good morning &nbsp;|&nbsp; b) Good evening &nbsp;|&nbsp; c) Good night &nbsp;|&nbsp; d) Good afternoon
      </div>
    </div>

    <!-- Exercise 3 -->
    <div class="hw-exercise">
      ${exHeader(3, 'Correct the mistakes:', '(Corrija os erros)', audioFiles, 'ex3')}
      <div class="hw-translate-list">
        ${HW2_EX3_Q.map((q, i) => `
          <div class="hw-translate-item">
            <div class="hw-translate-question">
              <span style="color:var(--color-accent);font-weight:700">${String.fromCharCode(97+i)})</span>
              <span style="color:#ff6b6b;text-decoration:line-through">${q}</span>
            </div>
            <input type="text" class="hw-match-input" id="hw2ex3-item${i}"
              placeholder="Frase corrigida…"
              value="${escHtml(getSaved('hw2ex3','item'+i))}"
              oninput="saveAnswer('hw2ex3','item${i}',this.value)" />
            <div class="check-feedback" id="fb-hw2ex3-${i}"></div>
          </div>`).join('')}
      </div>
      <div class="hw-actions">
        <button class="btn btn-outline" onclick="checkHW2Ex3()" style="font-size:0.82rem;padding:8px 16px">✔ Verificar</button>
        <button class="btn btn-ghost"   onclick="toggleAnswerKey('hw2ex3-key')" style="font-size:0.82rem;padding:8px 16px">🔑 Gabarito</button>
      </div>
      <div class="hw-answer-key" id="hw2ex3-key">
        <strong>Gabarito:</strong><br>
        ${HW2_EX3_A.map((a, i) => `${String.fromCharCode(97+i)}) ${a}`).join(' &nbsp;|&nbsp; ')}
      </div>
    </div>

    <!-- Exercise 4 -->
    <div class="hw-exercise">
      ${exHeader(4, 'Unscramble the sentences:', '(Desembaralhe as frases)', audioFiles, 'ex4')}
      <div class="hw-translate-list">
        ${HW2_EX4_SCRAMBLED.map((q, i) => `
          <div class="hw-translate-item">
            <div class="hw-translate-question">
              <span style="color:var(--color-accent);font-weight:700">${String.fromCharCode(97+i)})</span>
              <span style="color:var(--color-text-muted)">${q}</span>
            </div>
            <input type="text" class="hw-match-input" id="hw2ex4-item${i}"
              placeholder="Frase correta…"
              value="${escHtml(getSaved('hw2ex4','item'+i))}"
              oninput="saveAnswer('hw2ex4','item${i}',this.value)" />
            <div class="check-feedback" id="fb-hw2ex4-${i}"></div>
          </div>`).join('')}
      </div>
      <div class="hw-actions">
        <button class="btn btn-outline" onclick="checkHW2Ex4()" style="font-size:0.82rem;padding:8px 16px">✔ Verificar</button>
        <button class="btn btn-ghost"   onclick="toggleAnswerKey('hw2ex4-key')" style="font-size:0.82rem;padding:8px 16px">🔑 Gabarito</button>
      </div>
      <div class="hw-answer-key" id="hw2ex4-key">
        <strong>Gabarito:</strong><br>
        ${HW2_EX4_A.map((a, i) => `${String.fromCharCode(97+i)}) ${a}`).join(' &nbsp;|&nbsp; ')}
      </div>
    </div>

    <!-- Exercise 5 -->
    <div class="hw-exercise">
      ${exHeader(5, 'Answer these questions about you:', '(Responda essas perguntas sobre você)', audioFiles, 'ex5')}
      <div class="hw-translate-list">
        ${HW2_EX5_Q.map((q, i) => `
          <div class="hw-translate-item">
            <div class="hw-translate-question">
              <span style="color:var(--color-accent);font-weight:700">${String.fromCharCode(97+i)})</span> ${q}
            </div>
            <input type="text" class="hw-match-input" id="hw2ex5-item${i}"
              placeholder="Sua resposta em inglês…"
              value="${escHtml(getSaved('hw2ex5','item'+i))}"
              oninput="saveAnswer('hw2ex5','item${i}',this.value)" />
          </div>`).join('')}
      </div>
      <div class="hw-actions">
        <button class="btn btn-ghost" onclick="toggleAnswerKey('hw2ex5-key')" style="font-size:0.82rem;padding:8px 16px">🔑 Exemplo de respostas</button>
      </div>
      <div class="hw-answer-key" id="hw2ex5-key">
        <strong>Exemplo:</strong> As respostas são pessoais — use seu nome, origem e informações reais.
      </div>
    </div>

    <!-- Exercise 6 -->
    <div class="hw-exercise">
      <div class="hw-exercise-header">
        <div class="hw-ex-meta">
          <div class="hw-exercise-title">6. Repeat the sentences from exercises 1 to 4 along with the audio:</div>
          <div class="hw-exercise-subtitle">(Repita as frases dos exercícios 1 a 4 junto com o áudio)</div>
        </div>
      </div>
      <p style="font-size:0.88rem;color:var(--color-text-muted);padding:4px 0">
        ☝️ Use os mini-players ao lado de cada exercício acima, ou o player completo na seção abaixo.
      </p>
    </div>
  `;
}

// ── HW3 Builder ───────────────────────────────────────────────────────────

function buildHW3(audioFiles) {
  return `
    <div class="hw-obs">
      Obs.: A quantidade de exercícios e o grau de dificuldade aumentarão de acordo com sua evolução no curso.
    </div>

    <h2 style="font-size:1.2rem;font-weight:800;color:var(--color-accent);margin-bottom:28px">
      Aula 3 – Where are you from?
    </h2>

    <!-- Exercise 1: Unscramble the dialogue -->
    <div class="hw-exercise">
      ${exHeader(1, 'Unscramble the dialogue:', '(Desembaralhe o diálogo — escreva o número de ordem ao lado de cada fala)', audioFiles, 'ex1')}

      <div style="display:grid;grid-template-columns:1fr auto;gap:16px;align-items:start">
        <div>
          ${HW3_EX1_LINES.map((line, i) => `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
              <input type="number" min="1" max="8"
                id="hw3ex1-item${i}"
                placeholder="?"
                value="${escHtml(getSaved('hw3ex1','item'+i))}"
                oninput="saveAnswer('hw3ex1','item${i}',this.value)"
                style="width:52px;flex-shrink:0;text-align:center;background:var(--color-card);border:1px solid var(--color-border);color:var(--color-text);border-radius:8px;padding:6px;font-size:0.9rem;font-family:Poppins,sans-serif" />
              <div class="hw-line" style="margin:0;flex:1">
                <span class="hw-speaker ${line.speaker === 'Brian' ? 'brian' : 'jr'}">${line.speaker}:</span>
                <span${line.bold ? ' style="font-weight:700"' : ''}>${line.text}</span>
              </div>
              <div class="check-feedback" id="fb-hw3ex1-${i}" style="min-width:60px;font-size:0.78rem"></div>
            </div>`).join('')}
        </div>
        <div class="hw-notes-col" style="min-width:140px">
          <div class="hw-notes-col-title">YOUR NOTES<br/>(SUAS ANOTAÇÕES):</div>
          <textarea id="hw3ex1-notes"
            style="width:100%;min-height:120px;background:transparent;border:none;border-bottom:1px solid var(--color-border);color:var(--color-text);font-size:0.8rem;resize:vertical;outline:none;font-family:Poppins,sans-serif;padding:4px 0"
            placeholder="Suas anotações…"
            oninput="saveAnswer('hw3ex1','notes',this.value)"
          >${escHtml(getSaved('hw3ex1','notes'))}</textarea>
        </div>
      </div>

      <div class="hw-actions">
        <button class="btn btn-outline" onclick="checkHW3Ex1()" style="font-size:0.82rem;padding:8px 16px">✔ Verificar ordem</button>
        <button class="btn btn-ghost"   onclick="toggleAnswerKey('hw3ex1-key')" style="font-size:0.82rem;padding:8px 16px">🔑 Gabarito</button>
      </div>
      <div class="hw-answer-key" id="hw3ex1-key">
        <strong>Gabarito (ordem correta):</strong><br>
        (1) Brian: So, tell me Junior... where are you from?<br>
        (2) Jr: I'm from Brazil, what about you?<br>
        (3) Brian: I'm from the USA.<br>
        (4) Jr: Great! Where are you from in the USA?<br>
        (5) Brian: I'm from San Francisco. And you? Are you from Rio de Janeiro?<br>
        (6) Jr: No, I'm from Sao Paulo.<br>
        (7) Brian: Nice! São Paulo is a big city.<br>
        (8) Jr: Yes, it is.
      </div>
    </div>

    <!-- Exercise 2: Match countries and nationalities -->
    <div class="hw-exercise">
      ${exHeader(2, 'Match the countries and the nationalities:', '(Relacione os países e as nacionalidades)', audioFiles, 'ex2')}

      <div style="background:rgba(0,0,0,0.2);border-radius:12px;padding:20px;border:1px solid var(--color-border)">
        <div style="display:grid;grid-template-columns:30px 140px 1fr;gap:8px;margin-bottom:10px;font-size:0.72rem;text-transform:uppercase;letter-spacing:1px;color:var(--color-text-muted)">
          <div>#</div><div>País (Country)</div><div>Nacionalidade</div>
        </div>
        ${HW3_COUNTRIES.map((country, i) => `
          <div style="display:grid;grid-template-columns:30px 140px 1fr;gap:8px;align-items:center;margin-bottom:8px">
            <div style="color:var(--color-text-muted);font-size:0.85rem">${i+1}.</div>
            <div style="font-weight:600;color:var(--color-text);font-size:0.9rem">${country}</div>
            <div>
              <input type="text" class="hw-match-input" id="hw3ex2-item${i}"
                placeholder="Nacionalidade…"
                value="${escHtml(getSaved('hw3ex2','item'+i))}"
                oninput="saveAnswer('hw3ex2','item${i}',this.value)" />
              <div class="check-feedback" id="fb-hw3ex2-${i}"></div>
            </div>
          </div>`).join('')}
      </div>

      <div class="hw-actions">
        <button class="btn btn-outline" onclick="checkHW3Ex2()" style="font-size:0.82rem;padding:8px 16px">✔ Verificar</button>
        <button class="btn btn-ghost"   onclick="toggleAnswerKey('hw3ex2-key')" style="font-size:0.82rem;padding:8px 16px">🔑 Gabarito</button>
      </div>
      <div class="hw-answer-key" id="hw3ex2-key">
        <strong>Gabarito:</strong><br>
        ${HW3_COUNTRIES.map((c, i) => `${i+1}. ${c} → ${HW3_NATIONALITIES[i]}`).join(' &nbsp;|&nbsp; ')}
      </div>
    </div>

    <!-- Exercise 3: Flags -->
    <div class="hw-exercise">
      ${exHeader(3, 'Write the names of the country under each flag:', '(Escreva o nome do país em baixo de cada bandeira)', audioFiles, 'ex3')}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        ${HW3_EX3_FLAGS.map((flag, i) => `
          <div style="background:rgba(0,0,0,0.2);border-radius:12px;padding:16px;border:1px solid var(--color-border);text-align:center">
            <div style="font-size:4rem;margin-bottom:8px">${flag.emoji}</div>
            <div style="font-weight:700;color:var(--color-accent);margin-bottom:8px">${String.fromCharCode(97+i)})</div>
            <input type="text" class="hw-match-input" id="hw3ex3-item${i}"
              placeholder="Nome do país…"
              value="${escHtml(getSaved('hw3ex3','item'+i))}"
              oninput="saveAnswer('hw3ex3','item${i}',this.value)" />
            <div class="check-feedback" id="fb-hw3ex3-${i}"></div>
          </div>`).join('')}
      </div>

      <div class="hw-actions">
        <button class="btn btn-outline" onclick="checkHW3Ex3()" style="font-size:0.82rem;padding:8px 16px">✔ Verificar</button>
        <button class="btn btn-ghost"   onclick="toggleAnswerKey('hw3ex3-key')" style="font-size:0.82rem;padding:8px 16px">🔑 Gabarito</button>
      </div>
      <div class="hw-answer-key" id="hw3ex3-key">
        <strong>Gabarito:</strong>
        a) Colombia &nbsp;|&nbsp; b) France &nbsp;|&nbsp; c) Brazil &nbsp;|&nbsp; d) The USA
      </div>
    </div>

    <!-- Exercise 4: Celebrities -->
    <div class="hw-exercise">
      ${exHeader(4, 'What are their names? And where are they from?', '(Quais são os nomes deles? E de onde eles são?)', audioFiles, 'ex4')}

      <div class="hw-translate-list">
        <div class="hw-translate-item" style="opacity:0.65">
          <div class="hw-translate-question">
            <span style="color:var(--color-accent);font-weight:700">a)</span>
            <span style="font-size:0.82rem;color:var(--color-text-muted)">🎤 Cantora brasileira</span>
          </div>
          <div style="font-style:italic;font-size:0.88rem;padding:4px 0;color:var(--color-text-muted)">
            Exemplo dado: She's Ivete Sangalo. She's from Brazil.
          </div>
        </div>
        ${HW3_EX4_PEOPLE.map((p, i) => `
          <div class="hw-translate-item">
            <div class="hw-translate-question">
              <span style="color:var(--color-accent);font-weight:700">${p.label}</span>
              <span style="font-size:0.82rem;color:var(--color-text-muted)">${p.hint}</span>
            </div>
            <input type="text" class="hw-match-input" id="hw3ex4-item${i}"
              placeholder="He's / She's … from …"
              value="${escHtml(getSaved('hw3ex4','item'+i))}"
              oninput="saveAnswer('hw3ex4','item${i}',this.value)" />
            <div class="check-feedback" id="fb-hw3ex4-${i}"></div>
          </div>`).join('')}
      </div>

      <div class="hw-actions">
        <button class="btn btn-outline" onclick="checkHW3Ex4()" style="font-size:0.82rem;padding:8px 16px">✔ Verificar</button>
        <button class="btn btn-ghost"   onclick="toggleAnswerKey('hw3ex4-key')" style="font-size:0.82rem;padding:8px 16px">🔑 Gabarito</button>
      </div>
      <div class="hw-answer-key" id="hw3ex4-key">
        <strong>Gabarito:</strong><br>
        a) She's Ivete Sangalo. She's from Brazil.<br>
        b) She's Queen Elizabeth II. She's from England.<br>
        c) He's Leonardo Di Caprio. He's from the USA.<br>
        d) He's Michael Schumacher. He's from Germany.
      </div>
    </div>

    <!-- Exercise 5: Translate -->
    <div class="hw-exercise">
      ${exHeader(5, 'Translate the sentences from Portuguese into English:', '(Traduza as frases do português para o inglês)', audioFiles, 'ex5')}

      <div class="hw-translate-list">
        ${HW3_EX5_Q.map((q, i) => `
          <div class="hw-translate-item">
            <div class="hw-translate-question">
              <span style="color:var(--color-accent);font-weight:700">${String.fromCharCode(97+i)})</span> ${q}
            </div>
            <input type="text" class="hw-match-input" id="hw3ex5-item${i}"
              placeholder="Tradução em inglês…"
              value="${escHtml(getSaved('hw3ex5','item'+i))}"
              oninput="saveAnswer('hw3ex5','item${i}',this.value)" />
            <div class="check-feedback" id="fb-hw3ex5-${i}"></div>
          </div>`).join('')}
      </div>

      <div class="hw-actions">
        <button class="btn btn-outline" onclick="checkHW3Ex5()" style="font-size:0.82rem;padding:8px 16px">✔ Verificar</button>
        <button class="btn btn-ghost"   onclick="toggleAnswerKey('hw3ex5-key')" style="font-size:0.82rem;padding:8px 16px">🔑 Gabarito</button>
      </div>
      <div class="hw-answer-key" id="hw3ex5-key">
        <strong>Gabarito:</strong><br>
        ${HW3_EX5_A.map((a, i) => `${String.fromCharCode(97+i)}) ${a}`).join(' &nbsp;|&nbsp; ')}
      </div>
    </div>

    <!-- Exercise 6 -->
    <div class="hw-exercise">
      <div class="hw-exercise-header">
        <div class="hw-ex-meta">
          <div class="hw-exercise-title">6. Repeat the sentences from exercises 1 to 5 along with the audio:</div>
          <div class="hw-exercise-subtitle">(Repita as frases dos exercícios 1 a 5 junto com o áudio)</div>
        </div>
      </div>
      <p style="font-size:0.88rem;color:var(--color-text-muted);padding:4px 0">
        ☝️ Use os mini-players ao lado de cada exercício acima, ou o player completo na seção abaixo.
      </p>
    </div>
  `;
}

// ── Generic HW fallback (aulas futuras) ──────────────────────────────────

function buildHWGeneric(audioFiles) {
  if (!audioFiles.length) {
    return `<p style="color:var(--color-text-muted);font-size:0.9rem;text-align:center;padding:24px 0">
      📄 Nenhum arquivo de homework encontrado para esta aula.
    </p>`;
  }
  return `
    <div class="hw-obs">
      Os exercícios desta aula ainda não foram adicionados ao sistema.
      Utilize os áudios disponíveis no player abaixo e o PDF impresso para praticar.
    </div>
    <p style="color:var(--color-text-muted);font-size:0.88rem;padding:8px 0">
      ${audioFiles.length} arquivo(s) de áudio disponível(is) — acesse-os no player completo abaixo.
    </p>`;
}

// ── Homework answer persistence ───────────────────────────────────────────

async function saveAnswer(exerciseId, itemId, answer) {
  savedAnswers[`${exerciseId}__${itemId}`] = answer;
  try {
    await fetch(`/api/homework/${COURSE}/${encodeURIComponent(AULA_PATH)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exercise_id: exerciseId, item_id: itemId, answer }),
    });
  } catch {}
}

// ── Song Section (YouTube + Karaoke) ─────────────────────────────────────

async function loadSongSection() {
  try {
    const res = await fetch(
      `/api/song/${COURSE}/${AULA_PATH.split('/').map(encodeURIComponent).join('/')}`
    );
    const data = await res.json();
    if (data && data.youtubeId) {
      songData = data;
      injectSongSection(data);
    }
  } catch { /* no song, no problem */ }
}

function injectSongSection(data) {
  const audioCard = document.getElementById('audio-list').closest('.section-card');

  const card = document.createElement('div');
  card.className = 'section-card animate-fade-up';
  card.id = 'song-section';
  card.innerHTML = buildSongHTML(data);
  audioCard.parentNode.insertBefore(card, audioCard);

  loadYouTubeAPI().then(() => createYTPlayer(data.youtubeId));
}

function buildSongHTML(data) {
  const linesHTML = data.lines.map((line, i) => buildKLine(line, i)).join('');

  return `
    <div class="section-title">
      <div class="icon">🎤</div>
      ${data.title} — ${data.artist}
      <span class="song-section-badge">🎵 Karaokê</span>
    </div>

    <p class="song-note">${data.note}</p>

    <div class="song-layout">
      <!-- YouTube Player -->
      <div>
        <div class="yt-responsive" id="yt-wrapper">
          <div id="yt-player"></div>
        </div>
      </div>

      <!-- Karaoke Panel -->
      <div class="karaoke-panel" id="karaoke-panel">
        ${linesHTML}
      </div>
    </div>

    <div class="karaoke-controls">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost" style="font-size:0.78rem;padding:6px 14px"
          onclick="ytSeekTo(0)">⏮ Reiniciar</button>
        <button class="btn btn-ghost" style="font-size:0.78rem;padding:6px 14px"
          onclick="ytTogglePlay()">⏯ Play/Pause</button>
      </div>

      <span class="karaoke-time-display" id="karaoke-time">0:00</span>

      <div class="karaoke-offset-wrap">
        <span>Ajuste de tempo:</span>
        <input type="range" class="karaoke-offset" id="karaoke-offset"
          min="-10" max="10" value="0" step="0.5"
          oninput="setLyricOffset(this.value)" />
        <span id="karaoke-offset-val">0s</span>
      </div>
    </div>`;
}

function buildKLine(line, idx) {
  if (!line.text) {
    return `<div class="kline kline-spacer" id="kline-${idx}"></div>`;
  }

  const sectionBadge = line.section
    ? `<span class="kline-section-badge">${line.section}</span>`
    : '';

  const blankMarkers = (line.blanks || [])
    .map(b => `<span class="kblank-marker" title="Lacuna ${b.num} do Ex.6">📝 Ex.6 (${b.num})</span>`)
    .join('');

  // Render words as individual spans for word-level animation
  const wordSpans = line.text.split(' ')
    .map((w, wi) => `<span class="kw" id="kw-${idx}-${wi}">${escHtml(w)}</span>`)
    .join(' ');

  const hasBlanks = line.blanks && line.blanks.length > 0;

  return `
    <div class="kline${line.section ? ' kline-section-start' : ''}"
      id="kline-${idx}"
      data-start="${line.start}"
      data-end="${line.end}"
      data-words="${line.text.split(' ').length}"
      ${hasBlanks ? 'data-has-blank="1"' : ''}>
      ${sectionBadge}
      <span class="kline-words">${wordSpans}</span>
      ${blankMarkers}
    </div>`;
}

// ── YouTube IFrame API ────────────────────────────────────────────────────

function loadYouTubeAPI() {
  return new Promise(resolve => {
    if (window.YT && window.YT.Player) { resolve(); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(); };
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }
  });
}

function createYTPlayer(videoId) {
  ytPlayer = new YT.Player('yt-player', {
    videoId,
    width: '100%',
    height: '100%',
    playerVars: { rel: 0, modestbranding: 1, iv_load_policy: 3 },
    events: {
      onReady: onYTReady,
      onStateChange: onYTStateChange,
      onError: onYTError,
    },
  });
}

function onYTReady(e) {
  // Make iframe fill the responsive container
  const iframe = e.target.getIframe();
  iframe.style.width  = '100%';
  iframe.style.height = '100%';
}

function onYTStateChange(e) {
  if (e.data === YT.PlayerState.PLAYING) {
    startKaraokeSync();
  } else {
    stopKaraokeSync();
    if (e.data === YT.PlayerState.ENDED) resetKaraoke();
  }
}

function onYTError() {
  const wrapper = document.getElementById('yt-wrapper');
  if (wrapper) {
    wrapper.innerHTML = `
      <div class="yt-error">
        <p>⚠️ Não foi possível carregar o vídeo do YouTube.</p>
        <p style="margin-top:8px;font-size:0.8rem">
          <a href="${songData.youtubeUrl}" target="_blank"
            style="color:var(--color-accent)">Abrir no YouTube ↗</a>
        </p>
      </div>`;
  }
}

function ytTogglePlay() {
  if (!ytPlayer) return;
  const state = ytPlayer.getPlayerState();
  state === YT.PlayerState.PLAYING ? ytPlayer.pauseVideo() : ytPlayer.playVideo();
}

function ytSeekTo(seconds) {
  if (ytPlayer) ytPlayer.seekTo(seconds, true);
  resetKaraoke();
}

function setLyricOffset(val) {
  lyricOffset = parseFloat(val);
  document.getElementById('karaoke-offset-val').textContent = val + 's';
}

// ── Karaoke Sync ──────────────────────────────────────────────────────────

function startKaraokeSync() {
  stopKaraokeSync();
  karaokeTimer = setInterval(syncKaraoke, 150);
}

function stopKaraokeSync() {
  clearInterval(karaokeTimer);
  karaokeTimer = null;
}

function resetKaraoke() {
  document.querySelectorAll('.kline').forEach(el => {
    el.classList.remove('kline-active', 'kline-upcoming', 'kline-past');
  });
  lastActiveIdx = -1;
}

function syncKaraoke() {
  if (!ytPlayer || typeof ytPlayer.getCurrentTime !== 'function') return;

  const rawTime    = ytPlayer.getCurrentTime();
  const currentTime = rawTime + lyricOffset;

  // Update time display
  const timeEl = document.getElementById('karaoke-time');
  if (timeEl) timeEl.textContent = fmt(rawTime);

  const lines = songData.lines;
  let activeIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (currentTime >= lines[i].start && currentTime < lines[i].end) {
      activeIdx = i;
      break;
    }
  }

  // Nothing changed — just update word highlight within active line
  if (activeIdx === lastActiveIdx) {
    if (activeIdx >= 0) updateWordHighlight(activeIdx, currentTime);
    return;
  }

  lastActiveIdx = activeIdx;

  // Update all line classes
  document.querySelectorAll('.kline').forEach((el, i) => {
    el.classList.remove('kline-active', 'kline-upcoming', 'kline-past');
    if (i === activeIdx) {
      el.classList.add('kline-active');
    } else if (i > activeIdx && i <= activeIdx + 3) {
      el.classList.add('kline-upcoming');
    } else if (i < activeIdx) {
      el.classList.add('kline-past');
    }
  });

  // Scroll active line into center of panel
  if (activeIdx >= 0) {
    const lineEl = document.getElementById(`kline-${activeIdx}`);
    lineEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    updateWordHighlight(activeIdx, currentTime);
  }
}

function updateWordHighlight(lineIdx, currentTime) {
  const line      = songData.lines[lineIdx];
  if (!line || !line.text) return;

  const words    = line.text.split(' ');
  const duration = line.end - line.start;
  if (duration <= 0) return;

  const elapsed     = currentTime - line.start;
  const wordDuration = duration / words.length;
  const litCount    = Math.min(Math.floor(elapsed / wordDuration) + 1, words.length);

  words.forEach((_, wi) => {
    const wEl = document.getElementById(`kw-${lineIdx}-${wi}`);
    if (!wEl) return;
    wEl.classList.remove('kw-done', 'kw-lit');
    if (wi < litCount - 1)      wEl.classList.add('kw-done');
    else if (wi === litCount - 1) wEl.classList.add('kw-lit');
  });
}

// ── Full Audio Section (below homework) ──────────────────────────────────

async function renderFullAudioList(files) {
  const container = document.getElementById('audio-list');
  if (!files.length) {
    container.innerHTML = '<p style="color:var(--color-text-muted);font-size:0.9rem">Nenhum áudio encontrado nesta aula.</p>';
    return;
  }
  container.innerHTML = files.map(f => buildFullAudioPlayer(f)).join('');
  for (const f of files) await initFullAudioPlayer(f);
}

function friendlyName(filename) {
  const map = {
    'dialogue_aula1.mp3':  '🎭 Diálogo — Aula 1',
    'homework1_ex2.mp3':   '📢 Exercício 2',
    'homework1_ex3.mp3':   '📢 Exercício 3',
    'homework1_ex4.mp3':   '📢 Exercício 4',
    'dialogue_aula2.mp3':  '🎭 Diálogo — Aula 2',
    'homework2_ex1.mp3':   '📢 Exercício 1',
    'homework2_ex2.mp3':   '📢 Exercício 2',
    'homework2_ex3.mp3':   '📢 Exercício 3',
    'homework2_ex4.mp3':   '📢 Exercício 4',
    'homework2_ex5.mp3':   '📢 Exercício 5',
    'dialogue_aula3.mp3':  '🎭 Diálogo — Aula 3',
    'homework3_ex2.mp3':   '📢 Exercício 2',
    'homework3_ex3.mp3':   '📢 Exercício 3',
    'homework3_ex4.mp3':   '📢 Exercício 4',
    'homework3_ex5.mp3':   '📢 Exercício 5',
  };
  return map[filename] || ('🎵 ' + filename.replace(/\.[^.]+$/, '').replace(/_/g, ' '));
}

function buildFullAudioPlayer(filename) {
  const id  = filename.replace(/[^a-z0-9]/gi, '_');
  const url = `/api/audio/${COURSE}/${AULA_PATH.split('/').map(encodeURIComponent).join('/')}/${encodeURIComponent(filename)}`;
  return `
    <div class="audio-item" id="player-${id}">
      <div class="audio-item-header">
        <span class="audio-name">${friendlyName(filename)}</span>
      </div>
      <div class="audio-controls">
        <button class="audio-play-btn" id="play-${id}" onclick="toggleFullPlay('${id}')">▶</button>
        <div class="audio-progress-wrap">
          <input type="range" class="audio-progress" id="progress-${id}"
            min="0" max="100" value="0" step="0.1"
            oninput="seekFullAudio('${id}', this.value)" />
          <span class="audio-time" id="time-${id}">0:00 / 0:00</span>
        </div>
        <select id="speed-${id}" onchange="setFullSpeed('${id}', this.value)"
          style="background:var(--color-card);border:1px solid var(--color-border);color:var(--color-text);border-radius:6px;padding:4px 8px;font-size:0.78rem;cursor:pointer">
          <option value="0.75">0.75×</option>
          <option value="1" selected>1×</option>
          <option value="1.25">1.25×</option>
          <option value="1.5">1.5×</option>
        </select>
      </div>
      <div class="subtitle-box" id="subtitle-${id}">
        <div style="color:var(--color-text-dim);font-size:0.8rem;font-style:italic">▶ Pressione play para iniciar com legendas sincronizadas</div>
      </div>
      <label class="transcription-toggle">
        <input type="checkbox" id="live-toggle-${id}" onchange="toggleLive('${id}', this.checked)" />
        🎤 Transcrição ao vivo pelo microfone
      </label>
      <div class="live-transcript-box" id="live-box-${id}"></div>
      <audio id="audio-${id}" src="${url}" preload="metadata"></audio>
    </div>`;
}

const fullPlayers = {};

async function initFullAudioPlayer(filename) {
  const id      = filename.replace(/[^a-z0-9]/gi, '_');
  const audio   = document.getElementById(`audio-${id}`);
  const progEl  = document.getElementById(`progress-${id}`);
  const timeEl  = document.getElementById(`time-${id}`);
  const subEl   = document.getElementById(`subtitle-${id}`);

  let segments = [];
  try {
    const res = await fetch(`/api/transcript/${COURSE}/${AULA_PATH}?file=${encodeURIComponent(filename)}`);
    segments = (await res.json()).segments || [];
  } catch {}

  fullPlayers[id] = { audio, segments, rafId: null };

  audio.addEventListener('loadedmetadata', () => {
    progEl.max = audio.duration;
    timeEl.textContent = `0:00 / ${fmt(audio.duration)}`;
  });

  audio.addEventListener('ended', () => {
    document.getElementById(`play-${id}`).textContent = '▶';
    cancelAnimationFrame(fullPlayers[id].rafId);
  });

  audio.addEventListener('play', () => {
    document.getElementById(`play-${id}`).textContent = '⏸';
    fullPlayers[id].rafId = requestAnimationFrame(function tick() {
      const t = audio.currentTime;
      progEl.value = t;
      progEl.style.setProperty('--progress', (t / audio.duration * 100) + '%');
      timeEl.textContent = `${fmt(t)} / ${fmt(audio.duration)}`;
      if (segments.length) {
        const seg = segments.find(s => t >= s.start && t < s.end);
        if (seg)
          subEl.innerHTML = `${seg.speaker ? `<div class="subtitle-speaker">${seg.speaker}</div>` : ''}<div>${seg.text}</div>`;
      }
      fullPlayers[id].rafId = requestAnimationFrame(tick);
    });
    if (!segments.length)
      subEl.innerHTML = '<div style="color:var(--color-text-dim);font-size:0.8rem;font-style:italic">Sem transcrição disponível.</div>';
  });

  audio.addEventListener('pause', () => {
    document.getElementById(`play-${id}`).textContent = '▶';
    cancelAnimationFrame(fullPlayers[id].rafId);
  });
}

function toggleFullPlay(id) {
  const a = document.getElementById(`audio-${id}`);
  a.paused ? a.play() : a.pause();
}
function seekFullAudio(id, val) {
  document.getElementById(`audio-${id}`).currentTime = parseFloat(val);
}
function setFullSpeed(id, val) {
  document.getElementById(`audio-${id}`).playbackRate = parseFloat(val);
}

// ── Live transcription ────────────────────────────────────────────────────

function toggleLive(id, on) {
  const box = document.getElementById(`live-box-${id}`);
  if (!on) {
    box.classList.remove('active');
    if (recognition) { try { recognition.stop(); } catch {} recognition = null; }
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    box.textContent = '❌ Seu navegador não suporta reconhecimento de voz. Use Chrome.';
    box.classList.add('active');
    document.getElementById(`live-toggle-${id}`).checked = false;
    return;
  }
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  recognition.onresult = e => {
    let text = '';
    for (let i = e.resultIndex; i < e.results.length; i++) text += e.results[i][0].transcript;
    box.textContent = '🎤 ' + text;
  };
  recognition.onerror = e => { box.textContent = '❌ Erro: ' + e.error; };
  recognition.start();
  box.textContent = '🎤 Ouvindo… (fale em inglês)';
  box.classList.add('active');
}

// ── Notes ─────────────────────────────────────────────────────────────────

async function loadNotes() {
  try {
    const res  = await fetch(`/api/notes/${COURSE}/${encodeURIComponent(AULA_PATH)}`);
    const data = await res.json();
    document.getElementById('notes-area').value = data.content || '';
    updateChars();
  } catch {}
}

function initNotes() {
  const area = document.getElementById('notes-area');
  area.addEventListener('input', () => {
    updateChars();
    setStatus('saving');
    clearTimeout(notesTimer);
    notesTimer = setTimeout(() => saveNotes(area.value), 800);
  });
}

async function saveNotes(content) {
  try {
    await fetch(`/api/notes/${COURSE}/${encodeURIComponent(AULA_PATH)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    setStatus('saved');
  } catch { setStatus('error'); }
}

function updateChars() {
  const el = document.getElementById('notes-chars');
  if (el) el.textContent = `${document.getElementById('notes-area').value.length} caracteres`;
}

function setStatus(state) {
  const el = document.getElementById('save-status');
  if (!el) return;
  el.className = 'save-status ' + state;
  el.innerHTML = { saved: '✓ Salvo automaticamente', saving: '⏳ Salvando…', error: '❌ Erro ao salvar' }[state] || '';
}

// ── Utilities ─────────────────────────────────────────────────────────────

function fmt(s) {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

// ── Boot ──────────────────────────────────────────────────────────────────
init();
