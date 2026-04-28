// English course page — loads module/lesson structure from API

async function loadStructure() {
  try {
    const res = await fetch('/api/courses/ingles/structure');
    const structure = await res.json();
    renderModules(structure);
  } catch {
    document.getElementById('modules-container').innerHTML =
      '<p style="text-align:center;color:#f87171;padding:40px">Erro ao carregar estrutura do curso. O servidor está rodando?</p>';
  }
}

function renderModules(structure) {
  const container = document.getElementById('modules-container');

  if (!structure || structure.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:60px 0;color:var(--color-text-muted)">
        <div style="font-size:3rem;margin-bottom:16px">📂</div>
        <p>Nenhum módulo encontrado ainda.</p>
        <p style="font-size:0.8rem;margin-top:8px">Adicione pastas <strong>Módulo X / Aula X</strong> em<br>
        <code style="background:rgba(255,255,255,0.05);padding:2px 6px;border-radius:4px">C:\\Cursos\\Inglês - Junior Silveira</code></p>
      </div>`;
    return;
  }

  // Ensure we show placeholders for Modules 1–3 even if some are empty
  const existing = new Map(structure.map(m => [m.number, m]));
  const modules = [1, 2, 3].map(n => existing.get(n) || { name: `Módulo ${n}`, number: n, aulas: [] });

  container.innerHTML = modules.map((mod, i) => renderModule(mod, i)).join('');

  // Expand first module with content automatically
  const firstOpen = container.querySelector('.module-block');
  if (firstOpen) toggleModule(firstOpen);

  container.querySelectorAll('.module-header').forEach(header => {
    header.addEventListener('click', () => toggleModule(header.closest('.module-block')));
  });
}

function renderModule(mod, idx) {
  const aulaCount = mod.aulas.length;
  const delay = idx * 0.08;

  const lessonsHtml = aulaCount === 0
    ? `<div class="empty-module">Nenhuma aula encontrada neste módulo ainda. 🕐</div>`
    : mod.aulas.map(aula => renderLesson(aula)).join('');

  return `
    <div class="module-block animate-fade-up" style="animation-delay:${delay}s">
      <div class="module-header">
        <div class="module-header-left">
          <div class="module-number">${mod.number}</div>
          <div>
            <div class="module-title">${mod.name}</div>
            <div class="module-meta">${aulaCount} aula${aulaCount !== 1 ? 's' : ''} disponível${aulaCount !== 1 ? 'eis' : ''}</div>
          </div>
        </div>
        <svg class="module-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      <div class="module-lessons">
        <div class="module-lessons-inner">${lessonsHtml}</div>
      </div>
    </div>`;
}

function renderLesson(aula) {
  const audioCount = aula.audioFiles.length;
  const pdfCount = aula.pdfFiles.length;
  const params = new URLSearchParams({ course: 'ingles', aulaPath: aula.path });

  return `
    <div class="lesson-item">
      <div style="display:flex;align-items:center">
        <span class="lesson-icon">📖</span>
        <div>
          <div class="lesson-name">${aula.name}</div>
          <div class="lesson-meta">
            ${audioCount > 0 ? `🎵 ${audioCount} áudio${audioCount > 1 ? 's' : ''}` : ''}
            ${pdfCount > 0 ? `📄 ${pdfCount} homework${pdfCount > 1 ? 's' : ''}` : ''}
            ${audioCount === 0 && pdfCount === 0 ? 'Sem conteúdo ainda' : ''}
          </div>
        </div>
      </div>
      <div class="lesson-actions">
        <a href="/aula.html?${params}" class="btn btn-primary" style="padding:8px 16px;font-size:0.82rem">
          Ver Aula
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </a>
      </div>
    </div>`;
}

function toggleModule(block) {
  block.classList.toggle('open');
}

loadStructure();
