const express = require('express');
const path = require('path');
const fs = require('fs');
const { initDB, getDB } = require('./database/db');

const app = express();
const PORT = 3000;

const COURSES_ROOT = path.join(__dirname, '..');

const COURSES = {
  ingles: 'Inglês - Junior Silveira',
  japones: 'Japonês - Rafael Luiz',
  espanhol: 'Espanhol',
};

initDB();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Helpers ────────────────────────────────────────────────────────────────

function coursePath(courseKey) {
  const name = COURSES[courseKey];
  return name ? path.join(COURSES_ROOT, name) : null;
}

function safeJoin(base, ...parts) {
  const target = path.resolve(path.join(base, ...parts));
  if (!target.startsWith(path.resolve(base))) return null;
  return target;
}

function buildStructure(cPath) {
  if (!fs.existsSync(cPath)) return [];

  const entries = fs.readdirSync(cPath, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const structure = [];

  const modDirs = entries
    .filter(n => /^[Mm][oó]dulo\s*\d+/i.test(n))
    .sort((a, b) => numOf(a) - numOf(b));

  modDirs.forEach(mod => {
    const modPath = path.join(cPath, mod);
    const aulas = fs.readdirSync(modPath, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^Aula\s*\d+/i.test(d.name))
      .map(d => d.name)
      .sort((a, b) => numOf(a) - numOf(b))
      .map(aula => aulaInfo(path.join(modPath, aula), `${mod}/${aula}`));

    structure.push({ name: mod, number: numOf(mod), aulas });
  });

  const rootAulas = entries
    .filter(n => /^Aula\s*\d+/i.test(n))
    .sort((a, b) => numOf(a) - numOf(b));

  if (rootAulas.length > 0) {
    let mod1 = structure.find(m => m.number === 1);
    if (!mod1) {
      mod1 = { name: 'Módulo 1', number: 1, aulas: [] };
      structure.unshift(mod1);
    }
    rootAulas.forEach(aula => {
      if (!mod1.aulas.find(a => a.name === aula)) {
        mod1.aulas.push(aulaInfo(path.join(cPath, aula), aula));
      }
    });
  }

  structure.sort((a, b) => a.number - b.number);
  return structure;
}

function aulaInfo(aulaPath, relPath) {
  const hwPath = path.join(aulaPath, 'Homeworks');
  const files = fs.existsSync(hwPath) ? fs.readdirSync(hwPath) : [];
  return {
    name: path.basename(aulaPath),
    path: relPath,
    audioFiles: files.filter(f => /\.(mp3|wav|ogg|m4a)$/i.test(f)).sort(),
    pdfFiles: files.filter(f => /\.pdf$/i.test(f)).sort(),
  };
}

function numOf(str) {
  const m = str.match(/\d+/);
  return m ? parseInt(m[0]) : 0;
}

// ── API Routes ─────────────────────────────────────────────────────────────

app.get('/api/courses/:course/structure', (req, res) => {
  const cp = coursePath(req.params.course);
  if (!cp) return res.status(404).json({ error: 'Curso não encontrado' });
  try {
    res.json(buildStructure(cp));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve audio files — path after course key is the relative path within Homeworks
app.get('/api/audio/:course/*', (req, res) => {
  const cp = coursePath(req.params.course);
  if (!cp) return res.status(404).json({ error: 'Curso não encontrado' });

  const parts = req.params[0].split('/');
  const filename = parts.pop();

  // Try "Homeworks" sub-folder inside the given path
  const relDir = parts.join('/');
  const candidates = [
    safeJoin(cp, relDir, 'Homeworks', filename),
    safeJoin(cp, relDir, filename),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return res.sendFile(candidate);
    }
  }
  res.status(404).json({ error: 'Arquivo não encontrado' });
});

// Transcripts
app.get('/api/transcript/:course/*', (req, res) => {
  const { course } = req.params;
  const aulaPath = req.params[0];
  const filename = req.query.file;
  if (!filename) return res.status(400).json({ error: 'file query param required' });

  const key = `${course}/${aulaPath}/${filename}`;
  const db = getDB();
  const row = db.prepare('SELECT segments FROM transcripts WHERE audio_path = ?').get(key);

  if (row) {
    return res.json({ segments: JSON.parse(row.segments) });
  }

  // Fall back to JSON file in transcripts/
  const jsonPath = path.join(
    __dirname,
    'transcripts',
    course,
    aulaPath,
    path.basename(filename, path.extname(filename)) + '.json'
  );
  if (fs.existsSync(jsonPath)) {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    return res.json(data);
  }

  res.json({ segments: [] });
});

app.post('/api/transcript/:course/*', (req, res) => {
  const { course } = req.params;
  const aulaPath = req.params[0];
  const filename = req.query.file;
  if (!filename) return res.status(400).json({ error: 'file query param required' });

  const { segments } = req.body;
  const key = `${course}/${aulaPath}/${filename}`;
  const db = getDB();
  db.prepare(`
    INSERT INTO transcripts (audio_path, segments, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(audio_path) DO UPDATE SET segments = excluded.segments, updated_at = datetime('now')
  `).run(key, JSON.stringify(segments || []));

  res.json({ success: true });
});

// Notes
app.get('/api/notes/:course/:aula', (req, res) => {
  const { course, aula } = req.params;
  const db = getDB();
  const row = db.prepare('SELECT content, updated_at FROM notes WHERE course = ? AND aula = ?').get(course, aula);
  res.json(row || { content: '', updated_at: null });
});

app.post('/api/notes/:course/:aula', (req, res) => {
  const { course, aula } = req.params;
  const { content } = req.body;
  const db = getDB();
  db.prepare(`
    INSERT INTO notes (course, aula, content, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(course, aula) DO UPDATE SET content = excluded.content, updated_at = datetime('now')
  `).run(course, aula, content ?? '');
  res.json({ success: true });
});

// Homework answers
app.get('/api/homework/:course/:aula', (req, res) => {
  const { course, aula } = req.params;
  const db = getDB();
  const rows = db.prepare(
    'SELECT exercise_id, item_id, answer, updated_at FROM homework_answers WHERE course = ? AND aula = ?'
  ).all(course, aula);
  res.json(rows);
});

app.post('/api/homework/:course/:aula', (req, res) => {
  const { course, aula } = req.params;
  const { exercise_id, item_id, answer } = req.body;
  if (!exercise_id || !item_id) return res.status(400).json({ error: 'exercise_id and item_id required' });
  const db = getDB();
  db.prepare(`
    INSERT INTO homework_answers (course, aula, exercise_id, item_id, answer, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(course, aula, exercise_id, item_id)
    DO UPDATE SET answer = excluded.answer, updated_at = datetime('now')
  `).run(course, aula, exercise_id, item_id, answer ?? '');
  res.json({ success: true });
});

// Song data (YouTube + timed lyrics)
app.get('/api/song/:course/*', (req, res) => {
  const { course } = req.params;
  const aulaPath   = req.params[0];
  const songFile   = path.join(__dirname, 'songs', course, aulaPath, 'song.json');
  if (fs.existsSync(songFile)) {
    try { return res.json(JSON.parse(fs.readFileSync(songFile, 'utf8'))); }
    catch { return res.status(500).json({ error: 'Erro ao ler song.json' }); }
  }
  res.json(null);
});

// ── SPA fallback ───────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🎓 Estudando Idiomas → http://localhost:${PORT}`);
});
