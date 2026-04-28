// Lesson page controller
const params   = new URLSearchParams(location.search);
const COURSE   = params.get('course') || 'ingles';
const AULA_PATH = params.get('aulaPath') || '';
const AULA_NAME = AULA_PATH.split('/').pop();

// State
let savedAnswers = {};
let notesTimer;
let recognition;
const inlinePlayers = {};  // { exId: { audio, btn, seek, time } }

// ── Page header ───────────────────────────────────────────────────────────
document.getElementById('aula-title').textContent = AULA_NAME || 'Aula';
document.getElementById('aula-subtitle').textContent =
  AULA_PATH.includes('/') ? AULA_PATH.split('/')[0] : 'Inglês — Junior Silveira';
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

  // 2️⃣ Full audio section second
  renderFullAudioList(audioFiles);

  // 3️⃣ Notes
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

// Maps exercise id → audio filename for Aula 1
const AULA1_AUDIO_MAP = {
  ex1: 'dialogue_aula1.mp3',
  ex2: 'homework1_ex2.mp3',
  ex3: 'homework1_ex3.mp3',
  ex4: 'homework1_ex4.mp3',
};

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
  Object.entries(AULA1_AUDIO_MAP).forEach(([exId, filename]) => {
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
  } else {
    container.innerHTML = `
      <p style="color:var(--color-text-muted);font-size:0.9rem;text-align:center;padding:24px 0">
        📄 O homework desta aula será exibido assim que disponível.
      </p>`;
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

// ── HW1 Builder ───────────────────────────────────────────────────────────

function getSaved(exId, itemId) {
  return savedAnswers[`${exId}__${itemId}`] || '';
}

function exHeader(num, title, subtitle, audioFiles, exKey) {
  const hasAudio = exKey && audioFiles.includes(AULA1_AUDIO_MAP[exKey]);
  const playerHtml = hasAudio ? buildInlinePlayerHtml(exKey, AULA1_AUDIO_MAP[exKey]) : '';
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
