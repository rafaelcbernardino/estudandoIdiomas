// Lesson page controller

const params = new URLSearchParams(location.search);
const COURSE = params.get('course') || 'ingles';
const AULA_PATH = params.get('aulaPath') || '';
const AULA_NAME = AULA_PATH.split('/').pop();

let savedAnswers = {};
let notesTimer;
let recognition;

// ── Init ──────────────────────────────────────────────────────────────────

document.getElementById('aula-title').textContent = AULA_NAME || 'Aula';
document.getElementById('aula-subtitle').textContent =
  AULA_PATH.includes('/') ? AULA_PATH.split('/')[0] : 'Inglês — Junior Silveira';

const backBtn = document.getElementById('back-btn');
backBtn.href = `/${COURSE}.html`;

async function init() {
  await loadHomeworkAnswers();
  await loadAudioFiles();
  renderHomework();
  await loadNotes();
  initNotes();
}

// ── Audio ─────────────────────────────────────────────────────────────────

async function loadAudioFiles() {
  try {
    const res = await fetch(`/api/courses/${COURSE}/structure`);
    const structure = await res.json();

    let aula = null;
    for (const mod of structure) {
      aula = mod.aulas.find(a => a.path === AULA_PATH || a.name === AULA_NAME);
      if (aula) break;
    }

    const audioFiles = aula ? aula.audioFiles : [];
    renderAudioList(audioFiles);
  } catch {
    document.getElementById('audio-list').innerHTML =
      '<p style="color:#f87171">Erro ao carregar áudios.</p>';
  }
}

function renderAudioList(files) {
  const container = document.getElementById('audio-list');
  if (!files.length) {
    container.innerHTML = '<p style="color:var(--color-text-muted);font-size:0.9rem">Nenhum áudio encontrado nesta aula.</p>';
    return;
  }
  container.innerHTML = files.map(f => buildAudioPlayer(f)).join('');
  files.forEach(f => initAudioPlayer(f));
}

function friendlyName(filename) {
  const map = {
    'dialogue_aula1.mp3': '🎭 Diálogo — Aula 1',
    'homework1_ex2.mp3': '📢 Exercício 2 — Áudio',
    'homework1_ex3.mp3': '📢 Exercício 3 — Áudio',
    'homework1_ex4.mp3': '📢 Exercício 4 — Áudio',
  };
  return map[filename] || ('🎵 ' + filename.replace(/\.[^.]+$/, '').replace(/_/g, ' '));
}

function buildAudioPlayer(filename) {
  const id = filename.replace(/[^a-z0-9]/gi, '_');
  return `
    <div class="audio-item" id="player-${id}">
      <div class="audio-item-header">
        <span class="audio-name">${friendlyName(filename)}</span>
      </div>

      <div class="audio-controls">
        <button class="audio-play-btn" id="play-${id}" onclick="togglePlay('${id}')">▶</button>
        <div class="audio-progress-wrap">
          <input type="range" class="audio-progress" id="progress-${id}"
            min="0" max="100" value="0" step="0.1"
            oninput="seekAudio('${id}', this.value)" />
          <span class="audio-time" id="time-${id}">0:00 / 0:00</span>
        </div>
        <select id="speed-${id}" onchange="setSpeed('${id}', this.value)"
          style="background:var(--color-card);border:1px solid var(--color-border);color:var(--color-text);border-radius:6px;padding:4px 8px;font-size:0.78rem;cursor:pointer">
          <option value="0.75">0.75×</option>
          <option value="1" selected>1×</option>
          <option value="1.25">1.25×</option>
          <option value="1.5">1.5×</option>
        </select>
      </div>

      <div class="subtitle-box" id="subtitle-${id}">
        <div style="color:var(--color-text-dim);font-size:0.8rem;font-style:italic">
          ▶ Pressione play para iniciar com legendas sincronizadas
        </div>
      </div>

      <label class="transcription-toggle">
        <input type="checkbox" id="live-toggle-${id}" onchange="toggleLive('${id}', this.checked)" />
        🎤 Transcrição ao vivo pelo microfone (para praticar em voz alta)
      </label>
      <div class="live-transcript-box" id="live-box-${id}"></div>

      <audio id="audio-${id}" src="/api/audio/${COURSE}/${AULA_PATH}/${filename}" preload="metadata"></audio>
    </div>`;
}

const players = {};

async function initAudioPlayer(filename) {
  const id = filename.replace(/[^a-z0-9]/gi, '_');
  const audio = document.getElementById(`audio-${id}`);
  const progressEl = document.getElementById(`progress-${id}`);
  const timeEl = document.getElementById(`time-${id}`);
  const subtitleEl = document.getElementById(`subtitle-${id}`);

  // Load transcript
  let segments = [];
  try {
    const res = await fetch(`/api/transcript/${COURSE}/${AULA_PATH}?file=${filename}`);
    const data = await res.json();
    segments = data.segments || [];
  } catch {}

  players[id] = { audio, segments, rafId: null };

  audio.addEventListener('loadedmetadata', () => {
    progressEl.max = audio.duration;
    timeEl.textContent = `0:00 / ${fmt(audio.duration)}`;
  });

  audio.addEventListener('ended', () => {
    document.getElementById(`play-${id}`).textContent = '▶';
    cancelAnimationFrame(players[id].rafId);
  });

  function tick() {
    if (audio.paused) return;
    const t = audio.currentTime;
    progressEl.value = t;
    progressEl.style.setProperty('--progress', (t / audio.duration * 100) + '%');
    timeEl.textContent = `${fmt(t)} / ${fmt(audio.duration)}`;

    // Sync subtitle
    if (segments.length) {
      const seg = segments.find(s => t >= s.start && t < s.end);
      if (seg) {
        subtitleEl.innerHTML = `
          ${seg.speaker ? `<div class="subtitle-speaker">${seg.speaker}</div>` : ''}
          <div>${seg.text}</div>`;
      }
    }

    players[id].rafId = requestAnimationFrame(tick);
  }

  audio.addEventListener('play', () => {
    document.getElementById(`play-${id}`).textContent = '⏸';
    players[id].rafId = requestAnimationFrame(tick);
    if (segments.length === 0) {
      subtitleEl.innerHTML = '<div style="color:var(--color-text-dim);font-size:0.8rem;font-style:italic">Sem transcrição disponível para este áudio.</div>';
    }
  });

  audio.addEventListener('pause', () => {
    document.getElementById(`play-${id}`).textContent = '▶';
    cancelAnimationFrame(players[id].rafId);
  });

  audio.addEventListener('seeking', () => {
    const t = audio.currentTime;
    progressEl.value = t;
    timeEl.textContent = `${fmt(t)} / ${fmt(audio.duration)}`;
  });
}

function togglePlay(id) {
  const audio = document.getElementById(`audio-${id}`);
  if (audio.paused) audio.play();
  else audio.pause();
}

function seekAudio(id, val) {
  const audio = document.getElementById(`audio-${id}`);
  audio.currentTime = parseFloat(val);
}

function setSpeed(id, val) {
  const audio = document.getElementById(`audio-${id}`);
  audio.playbackRate = parseFloat(val);
}

function fmt(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

// ── Live Transcription ────────────────────────────────────────────────────

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
    for (let i = e.resultIndex; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
    }
    box.textContent = '🎤 ' + text;
  };

  recognition.onerror = e => {
    box.textContent = '❌ Erro: ' + e.error;
  };

  recognition.start();
  box.textContent = '🎤 Ouvindo… (fale em inglês)';
  box.classList.add('active');
}

// ── Homework ──────────────────────────────────────────────────────────────

async function loadHomeworkAnswers() {
  try {
    const res = await fetch(`/api/homework/${COURSE}/${encodeURIComponent(AULA_PATH)}`);
    const rows = await res.json();
    rows.forEach(r => {
      savedAnswers[`${r.exercise_id}__${r.item_id}`] = r.answer;
    });
  } catch {}
}

async function saveAnswer(exerciseId, itemId, answer) {
  try {
    await fetch(`/api/homework/${COURSE}/${encodeURIComponent(AULA_PATH)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exercise_id: exerciseId, item_id: itemId, answer }),
    });
    savedAnswers[`${exerciseId}__${itemId}`] = answer;
  } catch {}
}

function getSaved(exId, itemId) {
  return savedAnswers[`${exId}__${itemId}`] || '';
}

// ── Homework Renderer — Aula 1 (What's Up?) ──────────────────────────────

function renderHomework() {
  const container = document.getElementById('homework-container');

  // Only render full HW for Aula 1 (by name check)
  if (AULA_NAME === 'Aula 1') {
    container.innerHTML = buildHW1();
    applyHW1Answers();
    attachHW1Listeners();
  } else {
    container.innerHTML = `
      <p style="color:var(--color-text-muted);font-size:0.9rem;text-align:center;padding:24px 0">
        📄 O homework desta aula será exibido assim que disponível.<br>
        <span style="font-size:0.8rem;opacity:0.6">O PDF original pode ser consultado na pasta Homeworks da aula.</span>
      </p>`;
  }
}

const MATCH_MIDDLE = ['afternoon', 'morning', 'are you doing?', 'evening', 'night'];
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
  { type: 'text', text: 'Hello' },
  { type: 'text', text: "It's me" },
  { type: 'text', text: 'I was wondering if after all these years' },
  { type: 'text', text: "You'd like to meet" },
  { type: 'text', text: 'To go over everything' },
  { type: 'text', text: "They say that time's supposed to heal ya" },
  { type: 'blank', num: 1, answer: 'I', suffix: " ain't done much healing" },
  { type: 'spacer' },
  { type: 'blank', num: 2, answer: 'Hello', suffix: '' },
  { type: 'text', text: 'Can you hear me?' },
  { type: 'text', text: "I'm in California dreaming about who we used to be" },
  { type: 'text', text: 'When we were younger and free' },
  { type: 'text', text: "I've forgotten how it felt before the world fell at our feet" },
  { type: 'spacer' },
  { type: 'text', text: "There's such a difference between us" },
  { type: 'text', text: 'And a million miles' },
  { type: 'spacer' },
  { type: 'blank', num: 3, answer: 'Hello', suffix: ' from the other side' },
  { type: 'text', text: "I must've called a thousand times" },
  { type: 'text', text: 'To tell' },
  { type: 'blank', num: 4, answer: 'you', suffix: " I'm sorry" },
  { type: 'text', text: "For everything that I've done" },
  { type: 'text', text: 'But when I call you never' },
  { type: 'text', text: 'Seem to be home' },
  { type: 'spacer' },
  { type: 'blank', num: 5, answer: 'Hello', suffix: ' from the outside' },
  { type: 'text', text: "At least I can say that I've tried" },
  { type: 'text', text: "To tell you I'm(6)" },
  { type: 'blank', num: 6, answer: 'sorry', suffix: '' },
  { type: 'text', text: 'For breaking your heart' },
  { type: 'text', text: "But it don't matter, it clearly" },
  { type: 'text', text: "Doesn't tear" },
  { type: 'blank', num: 7, answer: 'you', suffix: ' apart anymore' },
  { type: 'spacer' },
  { type: 'text', text: 'Hello' },
  { type: 'blank', num: 8, answer: 'How are you?', suffix: '' },
  { type: 'text', text: "It's so typical of me to talk about myself" },
  { type: 'text', text: "I'm sorry," },
  { type: 'text', text: "I hope that you're well" },
  { type: 'text', text: 'Did you ever make it out of that town' },
  { type: 'text', text: 'Where nothing ever happened?' },
  { type: 'spacer' },
  { type: 'text', text: "It's no secret that the both of us" },
  { type: 'text', text: 'Are running out of time' },
  { type: 'spacer' },
  { type: 'text', text: 'So' },
  { type: 'blank', num: 9, answer: 'Hello', suffix: ' from the other side' },
  { type: 'text', text: "I must've called a thousand times" },
  { type: 'text', text: "To tell you I'm sorry" },
  { type: 'text', text: "For everything that I've done" },
  { type: 'text', text: 'But when' },
  { type: 'blank', num: 10, answer: 'I', suffix: ' call you never' },
  { type: 'text', text: 'Seem to be home' },
  { type: 'spacer' },
  { type: 'blank', num: 11, answer: 'Hello', suffix: ' from the outside' },
  { type: 'text', text: "At least I can say that I've tried" },
  { type: 'text', text: "To tell you I'm sorry" },
  { type: 'text', text: 'For breaking your heart' },
  { type: 'text', text: "But it don't matter, it clearly" },
  { type: 'text', text: "Doesn't tear you apart anymore" },
  { type: 'spacer' },
  { type: 'blank', num: 12, answer: 'Hello', suffix: ' from the other side' },
  { type: 'text', text: "I must've called a thousand times" },
  { type: 'text', text: "To tell you I'm sorry" },
  { type: 'text', text: "For everything that I've done" },
  { type: 'text', text: 'But when I call you never' },
  { type: 'text', text: 'Seem to be home' },
  { type: 'spacer' },
  { type: 'blank', num: 13, answer: 'Hello', suffix: ' from the outside' },
  { type: 'text', text: "At least I can say that I've tried" },
  { type: 'text', text: "To tell you I'm sorry" },
  { type: 'text', text: 'For breaking your heart' },
  { type: 'text', text: "But it don't matter, it clearly" },
  { type: 'text', text: "Doesn't tear you apart anymore" },
];

function buildHW1() {
  return `
    <div class="hw-obs">
      Obs.: A quantidade de exercícios e o grau de dificuldade aumentarão de acordo com sua evolução no curso.
    </div>

    <h2 style="font-size:1.2rem;font-weight:800;color:var(--color-accent);margin-bottom:28px">
      Aula 1 – What's up?
    </h2>

    <!-- Exercise 1 -->
    <div class="hw-exercise">
      <div class="hw-exercise-title">1. Read, listen, and repeat the dialogue:</div>
      <div class="hw-exercise-subtitle">(Leia, ouça e repita o diálogo)</div>

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
          >${getSaved('ex1','notes')}</textarea>
        </div>
      </div>
    </div>

    <!-- Exercise 2 -->
    <div class="hw-exercise">
      <div class="hw-exercise-title">2. Read, match, and translate:</div>
      <div class="hw-exercise-subtitle">(Leia, relacione e traduza)</div>

      <div style="background:rgba(0,0,0,0.2);border-radius:12px;padding:20px;border:1px solid var(--color-border)">
        <div style="display:grid;grid-template-columns:90px 1fr 1fr;gap:8px 16px;align-items:center;font-size:0.9rem;margin-bottom:8px">
          <div style="font-weight:700;color:var(--color-accent)"></div>
          <div style="font-weight:700;color:var(--color-text-muted);font-size:0.78rem;text-transform:uppercase;letter-spacing:1px">Palavra</div>
          <div style="font-weight:700;color:var(--color-text-muted);font-size:0.78rem;text-transform:uppercase;letter-spacing:1px">Resposta</div>
        </div>
        ${MATCH_MIDDLE.map((word, i) => `
        <div style="display:grid;grid-template-columns:90px 1fr 1fr;gap:8px 16px;align-items:center;margin-bottom:8px">
          <div style="font-weight:700;color:var(--color-accent)">${i < 2 ? (i === 0 ? 'Good' : 'How') : ''}</div>
          <div style="color:var(--color-text-muted);font-size:0.9rem">${word}</div>
          <input type="text" class="hw-match-input" id="ex2-item${String.fromCharCode(97+i)}"
            placeholder="${String.fromCharCode(97+i)})"
            value="${getSaved('ex2','item'+String.fromCharCode(97+i))}"
            oninput="saveAnswer('ex2','item${String.fromCharCode(97+i)}',this.value)" />
        </div>`).join('')}
      </div>

      <div class="hw-actions">
        <button class="btn btn-outline" onclick="checkEx2()" style="font-size:0.82rem;padding:8px 16px">✔ Verificar</button>
        <button class="btn btn-ghost" onclick="toggleAnswerKey('ex2-key')" style="font-size:0.82rem;padding:8px 16px">🔑 Gabarito</button>
      </div>
      <div class="hw-answer-key" id="ex2-key">
        <strong>Gabarito:</strong> a) Good afternoon &nbsp;|&nbsp; b) Good morning &nbsp;|&nbsp;
        c) Good evening &nbsp;|&nbsp; d) Good night &nbsp;|&nbsp; e) How are you doing?
      </div>
    </div>

    <!-- Exercise 3 -->
    <div class="hw-exercise">
      <div class="hw-exercise-title">3. Translate the sentences:</div>
      <div class="hw-exercise-subtitle">(Traduza as frases)</div>

      <div class="hw-translate-list">
        ${TRANSLATE_Q.map((q, i) => `
        <div class="hw-translate-item">
          <div class="hw-translate-question">
            <span>${String.fromCharCode(97+i)})</span> ${q}
          </div>
          <input type="text" class="hw-match-input" id="ex3-item${i}"
            placeholder="Sua tradução…"
            value="${getSaved('ex3','item'+i)}"
            oninput="saveAnswer('ex3','item${i}',this.value)" />
        </div>`).join('')}
      </div>

      <div class="hw-actions">
        <button class="btn btn-outline" onclick="checkEx3()" style="font-size:0.82rem;padding:8px 16px">✔ Verificar</button>
        <button class="btn btn-ghost" onclick="toggleAnswerKey('ex3-key')" style="font-size:0.82rem;padding:8px 16px">🔑 Gabarito</button>
      </div>
      <div class="hw-answer-key" id="ex3-key">
        <strong>Gabarito:</strong><br>
        a) Como você está? &nbsp;|&nbsp; b) Olá, boa tarde. &nbsp;|&nbsp; c) Estou bem. E você? &nbsp;|&nbsp;
        d) Como você está? &nbsp;|&nbsp; e) Obrigado.
      </div>
    </div>

    <!-- Exercise 4 -->
    <div class="hw-exercise">
      <div class="hw-exercise-title">4. Answer the questions from the previous exercise:</div>
      <div class="hw-exercise-subtitle">(Responda as perguntas do exercício anterior)</div>

      <div class="hw-translate-list">
        ${TRANSLATE_Q.map((q, i) => `
        <div class="hw-translate-item">
          <div class="hw-translate-question"><span>${String.fromCharCode(97+i)})</span> ${q}</div>
          <input type="text" class="hw-match-input" id="ex4-item${i}"
            placeholder="Sua resposta em inglês…"
            value="${getSaved('ex4','item'+i)}"
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
      <div class="hw-exercise-title">5. Repeat the sentences from exercises 1 to 4 along with the audio:</div>
      <div class="hw-exercise-subtitle">(Repita as frases dos exercícios 1 a 4 junto com o áudio)</div>
      <p style="font-size:0.88rem;color:var(--color-text-muted);padding:12px 0">
        ☝️ Use os players de áudio no topo da página para reproduzir os exercícios e praticar a pronúncia.
      </p>
    </div>

    <!-- Exercise 6 -->
    <div class="hw-exercise">
      <div class="hw-exercise-title">6. Listen and complete the song:</div>
      <div class="hw-exercise-subtitle">(Ouça e complete a música)</div>

      <div style="margin-bottom:16px">
        <strong style="color:var(--color-accent)">Hello — Adele</strong>
        <span style="font-size:0.78rem;color:var(--color-text-muted);margin-left:8px">(uso educacional)</span>
      </div>

      <div class="hw-song-section">
        ${buildSongLyrics()}
      </div>

      <div class="hw-actions">
        <button class="btn btn-outline" onclick="checkSong()" style="font-size:0.82rem;padding:8px 16px">✔ Verificar letra</button>
        <button class="btn btn-ghost" onclick="toggleAnswerKey('ex6-key')" style="font-size:0.82rem;padding:8px 16px">🔑 Gabarito</button>
      </div>
      <div class="hw-answer-key" id="ex6-key">
        <strong>Gabarito:</strong>
        (1) I &nbsp;|&nbsp; (2) Hello &nbsp;|&nbsp; (3) Hello &nbsp;|&nbsp; (4) you &nbsp;|&nbsp;
        (5) Hello &nbsp;|&nbsp; (6) sorry &nbsp;|&nbsp; (7) you &nbsp;|&nbsp; (8) How are you? &nbsp;|&nbsp;
        (9) Hello &nbsp;|&nbsp; (10) I &nbsp;|&nbsp; (11) Hello &nbsp;|&nbsp; (12) Hello &nbsp;|&nbsp;
        (13) Hello
      </div>
    </div>
  `;
}

function buildSongLyrics() {
  let html = '';
  SONG_SEGMENTS.forEach(seg => {
    if (seg.type === 'spacer') {
      html += '<br>';
    } else if (seg.type === 'text') {
      html += `<div class="hw-song-line">${seg.text}</div>`;
    } else if (seg.type === 'blank') {
      const val = getSaved('ex6', 'blank' + seg.num);
      html += `<div class="hw-song-line">
        <span class="hw-blank-wrap">(<span style="color:var(--color-text-muted)">${seg.num}</span>)<input
          type="text" class="hw-blank" id="ex6-blank${seg.num}"
          value="${escHtml(val)}"
          placeholder="…"
          oninput="saveAnswer('ex6','blank${seg.num}',this.value)"
          style="width:${Math.max(80, (seg.answer.length+2)*10)}px"
        /></span>${seg.suffix ? ' ' + seg.suffix : ''}
      </div>`;
    }
  });
  return html;
}

function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function applyHW1Answers() {}

function attachHW1Listeners() {}

// ── Check functions ───────────────────────────────────────────────────────

function checkEx2() {
  const letters = ['a','b','c','d','e'];
  letters.forEach((l, i) => {
    const input = document.getElementById(`ex2-item${l}`);
    if (!input) return;
    const correct = MATCH_ANSWERS[i].toLowerCase().trim();
    const given = (input.value || '').toLowerCase().trim();
    input.classList.remove('correct','incorrect');
    if (given) input.classList.add(given === correct ? 'correct' : 'incorrect');
  });
}

function checkEx3() {
  TRANSLATE_Q.forEach((_, i) => {
    const input = document.getElementById(`ex3-item${i}`);
    if (!input) return;
    const correct = TRANSLATE_A[i].toLowerCase().trim();
    const given = (input.value || '').toLowerCase().trim();
    input.classList.remove('correct','incorrect');
    if (given) input.classList.add(given === correct ? 'correct' : 'incorrect');
  });
}

function checkSong() {
  SONG_SEGMENTS.filter(s => s.type === 'blank').forEach(seg => {
    const input = document.getElementById(`ex6-blank${seg.num}`);
    if (!input) return;
    const correct = seg.answer.toLowerCase().trim();
    const given = (input.value || '').toLowerCase().trim();
    input.classList.remove('correct','incorrect');
    if (given) input.classList.add(given === correct ? 'correct' : 'incorrect');
  });
}

function toggleAnswerKey(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('revealed');
}

// ── Notes ─────────────────────────────────────────────────────────────────

async function loadNotes() {
  try {
    const res = await fetch(`/api/notes/${COURSE}/${encodeURIComponent(AULA_PATH)}`);
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
  } catch {
    setStatus('error');
  }
}

function updateChars() {
  const area = document.getElementById('notes-area');
  const el = document.getElementById('notes-chars');
  if (el) el.textContent = `${area.value.length} caracteres`;
}

function setStatus(state) {
  const el = document.getElementById('save-status');
  if (!el) return;
  el.className = 'save-status ' + state;
  const map = {
    saved: '✓ Salvo automaticamente',
    saving: '⏳ Salvando…',
    error: '❌ Erro ao salvar',
  };
  el.innerHTML = map[state] || '';
}

// ── Boot ──────────────────────────────────────────────────────────────────
init();
