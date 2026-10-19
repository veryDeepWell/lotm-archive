(() => {
  const $ = (selector) => document.querySelector(selector);
  const state = {
    data: null,
    chapter: 134,
    spoilerSafe: true,
    view: 'pathways'
  };

  const pathwayTree = $('#pathwayTree');
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const STAGE_SIZE = 1480;
  const CENTER = STAGE_SIZE / 2;
  const UNKNOWN = '???';
  const SEQUENCE_ZERO_CHAPTER = 268;
  const escapeHtml = (value = '') => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const seqLabel = number => `Последовательность ${number}`;

  async function init() {
    try {
      const response = await fetch('data/archive.json');
      if (!response.ok) throw new Error('Не удалось прочитать data/archive.json');
      state.data = await response.json();

      const limit = state.data.meta?.chapterLimit || 1432;
      const saved = Number(localStorage.getItem('lotm-chapter'));
      state.chapter = Math.min(limit, Math.max(1, Number.isFinite(saved) && saved > 0 ? saved : 134));

      $('#chapterInput').max = limit;
      $('#chapterSlider').max = limit;
      $('#timelineSlider').max = limit;
      $('#timelineTicksLast').textContent = String(limit);

      bindEvents();
      renderAll();
    } catch (error) {
      if (pathwayTree) {
        pathwayTree.innerHTML = `<div class="radial-error"><h3>Не удалось загрузить архив</h3><p>${escapeHtml(error.message)}<br>Открой сайт через локальный веб-сервер.</p></div>`;
      }
    }
  }

  function bindEvents() {
    $('#spoilerToggle').checked = state.spoilerSafe;
    $('#spoilerToggle').addEventListener('change', event => {
      state.spoilerSafe = event.target.checked;
      if (!state.spoilerSafe) toast('Режим без спойлеров выключен.');
      renderAll();
    });

    $('#applyChapter').addEventListener('click', applyChapter);
    $('#chapterInput').addEventListener('keydown', event => {
      if (event.key === 'Enter') applyChapter();
    });
    $('#chapterInput').addEventListener('change', applyChapter);

    $('#chapterSlider').addEventListener('input', event => {
      state.chapter = Number(event.target.value);
      localStorage.setItem('lotm-chapter', String(state.chapter));
      updateChapterUI();
      renderAll();
    });

    $('#timelineSlider').addEventListener('input', event => {
      state.chapter = Number(event.target.value);
      localStorage.setItem('lotm-chapter', String(state.chapter));
      updateChapterUI();
      renderAll();
    });

    $('#closeDetail').addEventListener('click', () => { $('#detailModal').hidden = true; });
    $('#detailModal').addEventListener('click', event => {
      if (event.target === $('#detailModal')) $('#detailModal').hidden = true;
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        $('#detailModal').hidden = true;
      }
    });

    $('#aboutBtn').addEventListener('click', () => toast('Фанатский справочник Lord of Mysteries. Данные хранятся в data/archive.json.'));
    document.querySelectorAll('.nav-item').forEach(button => {
      button.addEventListener('click', () => switchView(button.dataset.view));
    });
  }

  function applyChapter() {
    const limit = state.data?.meta?.chapterLimit || 1432;
    const parsed = Number($('#chapterInput').value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > limit) {
      $('#chapterInput').value = state.chapter;
      toast(`Доступен диапазон 1–${limit}.`);
      return;
    }
    state.chapter = parsed;
    localStorage.setItem('lotm-chapter', String(parsed));
    localStorage.setItem('lotm-onboarded', '1');
    updateChapterUI();
    renderAll();
  }

  function updateChapterUI() {
    $('#chapterValue').textContent = state.chapter;
    $('#chapterInput').value = state.chapter;
    $('#chapterSlider').value = state.chapter;
    $('#timelineSlider').value = state.chapter;
    $('#timelineChapterLabel').textContent = `Глава ${state.chapter}`;
  }

  function isVisible(item) {
    if (!item) return false;
    if (!state.spoilerSafe) return true;
    const chapter = item.revealChapter;
    return chapter != null && Number.isFinite(Number(chapter)) && Number(chapter) <= state.chapter;
  }

  function isPathwayVisible(pathway) {
    if (!pathway) return false;
    if (!state.spoilerSafe) return true;
    const sequenceZero = (pathway.sequences || []).find(sequence => Number(sequence.number) === 0);
    return isVisible(sequenceZero);
  }

  function canShowField(item, key) {
    if (!state.spoilerSafe) return true;
    if (!item) return false;
    // Missing field-specific dates fall back to the item's own reveal date;
    // missing reveal dates never silently unlock information.
    const chapter = item[key] ?? item.revealChapter;
    return chapter != null && Number.isFinite(Number(chapter)) && Number(chapter) <= state.chapter;
  }

  function displayPathwayName(pathway, english = false) {
    if (!pathway) return UNKNOWN;
    if (!state.spoilerSafe) return textOrUnknown(english ? pathway.englishName : pathway.name);
    if (canShowField(pathway, 'displayNameRevealChapter')) {
      return textOrUnknown(english ? pathway.displayEnglishName : pathway.displayName);
    }
    if (isPathwayVisible(pathway)) {
      return textOrUnknown(english ? pathway.englishName : pathway.name);
    }
    return UNKNOWN;
  }

  function potionKnown(sequence) {
    const potion = sequence?.potion;
    if (!potion?.known) return false;
    if (!state.spoilerSafe) return true;
    const chapter = potion.formulaRevealChapter ?? potion.sourceChapter;
    return chapter != null && Number.isFinite(Number(chapter)) && Number(chapter) <= state.chapter;
  }

  function characterSequenceAt(character, chapter) {
    const advancements = (character.advancements || [])
      .filter(advancement => !state.spoilerSafe || advancement.chapter <= chapter)
      .sort((a, b) => b.chapter - a.chapter);
    return advancements[0]?.sequenceId || null;
  }

  function charactersOnSequence(sequenceId) {
    return (state.data.characters || [])
      .filter(character => isVisible(character))
      .filter(character => characterSequenceAt(character, state.chapter) === sequenceId);
  }

  function textOrUnknown(value) {
    const text = (value ?? '').toString().trim();
    return text || UNKNOWN;
  }

  function renderAll() {
    updateChapterUI();
    renderPathways();
    renderTimeline();
  }

  function renderPathways() {
    if (!pathwayTree || !state.data) return;
    const pathways = state.data.pathways || [];
    const nodeCount = state.chapter >= SEQUENCE_ZERO_CHAPTER ? 10 : 9;

    if (!pathways.length) {
      pathwayTree.innerHTML = '';
      $('#emptyState').hidden = false;
      return;
    }
    $('#emptyState').hidden = true;

    const spokes = [];
    const nodeButtons = [];
    const labels = [];

    pathways.forEach((pathway, pathwayIndex) => {
      const angleDegrees = -90 + pathwayIndex * (360 / pathways.length);
      const angle = angleDegrees * Math.PI / 180;
      const color = escapeHtml(pathway.color || '#c8a86b');
      const lineRadius = 680;
      const lineX = CENTER + Math.cos(angle) * lineRadius;
      const lineY = CENTER + Math.sin(angle) * lineRadius;
      spokes.push(`<line x1="${CENTER}" y1="${CENTER}" x2="${lineX.toFixed(2)}" y2="${lineY.toFixed(2)}" style="--path-color:${color}" class="radial-spoke"/>`);

      const labelRadius = 710;
      const labelX = CENTER + Math.cos(angle) * labelRadius;
      const labelY = CENTER + Math.sin(angle) * labelRadius;
      const cosine = Math.cos(angle);
      let labelAlignment = 'label-center';
      if (cosine > 0.28) labelAlignment = 'label-inward-right';
      else if (cosine < -0.28) labelAlignment = 'label-inward-left';
      const pathwayName = displayPathwayName(pathway) || `Путь ${pathwayIndex + 1}`;
      labels.push(`
        <div class="radial-path-label ${labelAlignment}" style="left:${(labelX / STAGE_SIZE * 100).toFixed(3)}%;top:${(labelY / STAGE_SIZE * 100).toFixed(3)}%;--path-color:${color}" title="${escapeHtml(pathwayName)}">
          <span class="radial-path-index">${String(pathwayIndex + 1).padStart(2, '0')}</span>
          <span>${escapeHtml(pathwayName)}</span>
        </div>`);

      const sequenceByNumber = new Map((pathway.sequences || []).map(sequence => [Number(sequence.number), sequence]));
      const innerRadius = 185;
      const outerRadius = 640;

      for (let index = 0; index < nodeCount; index++) {
        const number = 9 - index;
        const sequence = sequenceByNumber.get(number);
        if (!sequence) continue;
        const radius = innerRadius + index * ((outerRadius - innerRadius) / (nodeCount - 1));
        const x = CENTER + Math.cos(angle) * radius;
        const y = CENTER + Math.sin(angle) * radius;
        const visible = isVisible(sequence);
        const highlighted = visible && potionKnown(sequence);
        const visibleSequenceName = visible ? (sequence.name || UNKNOWN) : UNKNOWN;
        const title = `${pathwayName} — ${visibleSequenceName}`;
        const nodeClass = [
          'radial-node',
          `sequence-${number}`,
          visible ? 'is-revealed' : 'is-locked',
          highlighted ? 'has-potion-data' : ''
        ].filter(Boolean).join(' ');
        nodeButtons.push(`
          <button type="button" class="${nodeClass}" data-sequence="${escapeHtml(sequence.id)}"
            style="left:${(x / STAGE_SIZE * 100).toFixed(3)}%;top:${(y / STAGE_SIZE * 100).toFixed(3)}%;--path-color:${color}"
            aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}"><span>${number}</span></button>`);
      }
    });

    pathwayTree.innerHTML = `
      <svg class="radial-lines" viewBox="0 0 ${STAGE_SIZE} ${STAGE_SIZE}" role="presentation" aria-hidden="true">
        <defs>
          <radialGradient id="radialAura"><stop offset="0%" stop-color="#c8a86b" stop-opacity=".16"/><stop offset="100%" stop-color="#c8a86b" stop-opacity="0"/></radialGradient>
        </defs>
        <circle cx="${CENTER}" cy="${CENTER}" r="340" fill="url(#radialAura)"/>
        <circle class="radial-ring" cx="${CENTER}" cy="${CENTER}" r="185"/>
        <circle class="radial-ring" cx="${CENTER}" cy="${CENTER}" r="410"/>
        <circle class="radial-ring radial-ring-outer" cx="${CENTER}" cy="${CENTER}" r="640"/>
        ${spokes.join('')}
      </svg>
      ${nodeButtons.join('')}
      ${labels.join('')}
      <div class="radial-center" aria-hidden="true"><span class="radial-center-mark">✦</span><span class="radial-center-count">22</span><span class="radial-center-caption">ПУТИ</span></div>`;

    pathwayTree.querySelectorAll('[data-sequence]').forEach(button => {
      button.addEventListener('click', () => showSequence(button.dataset.sequence));
    });
  }

  function showSequence(id) {
    let pathway = null;
    let sequence = null;
    for (const candidatePathway of state.data.pathways || []) {
      const found = (candidatePathway.sequences || []).find(item => item.id === id);
      if (found) {
        pathway = candidatePathway;
        sequence = found;
        break;
      }
    }
    if (!pathway || !sequence) return;

    const sequenceVisible = isVisible(sequence);
    const visiblePathwayName = displayPathwayName(pathway);
    const visiblePathwayEnglishName = displayPathwayName(pathway, true);
    const showSummary = sequenceVisible && canShowField(sequence, 'summaryRevealChapter');
    const showAbilities = sequenceVisible && canShowField(sequence, 'abilitiesRevealChapter');
    const showPotion = sequenceVisible && potionKnown(sequence);
    const potion = sequence.potion || {};
    const visibleSequenceName = sequenceVisible ? textOrUnknown(sequence.name) : UNKNOWN;
    const visibleEnglishName = sequenceVisible ? textOrUnknown(sequence.englishName) : UNKNOWN;
    const showNotes = sequenceVisible && canShowField(sequence, 'notesRevealChapter');
    const showActing = sequenceVisible && canShowField(sequence, 'actingPrincipleRevealChapter');
    const showAppearance = showPotion && canShowField(potion, 'appearanceRevealChapter');
    const showPreparation = showPotion && Boolean(potion.preparation) && canShowField(potion, 'preparationRevealChapter');
    const showRitual = sequenceVisible && canShowField(sequence, 'advancementRitualRevealChapter');
    const people = sequenceVisible ? charactersOnSequence(sequence.id) : [];

    const list = (items, unlocked) => {
      if (!unlocked || !items?.length) return `<p class="muted">${UNKNOWN}</p>`;
      return `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
    };

    const peopleBlock = people.length
      ? `<ul class="char-list">${people.map(character => {
          const description = canShowField(character, 'descriptionRevealChapter')
            ? textOrUnknown(character.description)
            : UNKNOWN;
          return `<li><strong>${escapeHtml(character.name)}</strong><span>${escapeHtml(description)}</span></li>`;
        }).join('')}</ul>`
      : `<p class="muted">${UNKNOWN}</p>`;

    const missingDataNote = sequenceVisible && !potion.known
      ? '<p class="detail-hint">Для этой ступени в текущем срезе не внесена проверенная формула.</p>'
      : '';
    const formulaStatus = showPotion && potion.formulaStatus
      ? `<p class="detail-hint">${escapeHtml(potion.formulaStatus)}</p>`
      : '';

    $('#detailContent').innerHTML = `
      <div class="detail-kicker">${escapeHtml(visiblePathwayName)} · ${escapeHtml(seqLabel(sequence.number))}</div>
      <h2 class="detail-title" id="detailTitle">${escapeHtml(visibleSequenceName)}</h2>
      <div class="detail-subtitle">${escapeHtml(visibleEnglishName)} · ${escapeHtml(visiblePathwayEnglishName)}</div>
      <p class="detail-summary">${showSummary ? escapeHtml(textOrUnknown(sequence.summary)) : UNKNOWN}</p>
      ${missingDataNote}

      <div class="detail-columns">
        <div class="detail-block">
          <h4>СПОСОБНОСТИ</h4>
          ${list(sequence.abilities, showAbilities)}
        </div>
        <div class="detail-block">
          <h4>ОСНОВНЫЕ ИНГРЕДИЕНТЫ</h4>
          ${list(potion.mainIngredients, showPotion)}
          <h4 style="margin-top:16px">ДОПОЛНИТЕЛЬНЫЕ ИНГРЕДИЕНТЫ</h4>
          ${list(potion.supplementaryIngredients, showPotion)}
          ${showPotion && potion.alternative ? `<p><b>Альтернатива:</b> ${escapeHtml(potion.alternative)}</p>` : ''}
          ${formulaStatus}
        </div>
      </div>

      <div class="detail-columns detail-extra-columns">
        <div class="detail-block">
          <h4>ПРИНЦИП ДЕЙСТВИЯ</h4>
          <p>${showActing ? escapeHtml(textOrUnknown(sequence.actingPrinciple)) : UNKNOWN}</p>
        </div>
        <div class="detail-block">
          <h4>ВНЕШНИЙ ВИД ЗЕЛЬЯ</h4>
          <p>${showAppearance ? escapeHtml(textOrUnknown(potion.appearance)) : UNKNOWN}</p>
        </div>
      </div>

      ${showPreparation ? `<div class="detail-block detail-spaced"><h4>ПРИГОТОВЛЕНИЕ</h4><p>${escapeHtml(potion.preparation)}</p></div>` : ''}
      ${sequence.advancementRitual ? `<div class="detail-block detail-spaced"><h4>РИТУАЛ ПРОДВИЖЕНИЯ</h4><p>${showRitual ? escapeHtml(textOrUnknown(sequence.advancementRitual)) : UNKNOWN}</p></div>` : ''}

      <div class="detail-block detail-spaced">
        <h4>ПЕРСОНАЖИ НА ЭТОЙ ПОСЛЕДОВАТЕЛЬНОСТИ</h4>
        <p class="detail-hint">На главе ${state.chapter}. Если персонаж продвигается, он переходит в список новой ступени.</p>
        ${peopleBlock}
      </div>

      <div class="detail-note">${escapeHtml(showNotes ? textOrUnknown(sequence.notes) : UNKNOWN)}</div>`;

    $('#detailModal').hidden = false;
  }

  function renderTimeline() {
    const events = (state.data.events || [])
      .filter(event => !state.spoilerSafe || event.chapter <= state.chapter)
      .sort((a, b) => a.chapter - b.chapter);

    $('#timelineEvents').innerHTML = events.length
      ? events.map(event => `
          <article class="event-row">
            <div class="event-chapter">ГЛ. ${event.chapter}</div>
            <div>
              <h3>${escapeHtml(event.title)}</h3>
              <p>${escapeHtml(event.description)}</p>
              ${event.typeLabel ? `<small class="event-type">${escapeHtml(event.typeLabel)}</small>` : ''}
            </div>
          </article>`).join('')
      : '<div class="empty-state"><h3>Пока никаких открытий</h3><p>Для этой главы нет событий.</p></div>';
  }

  function switchView(view) {
    state.view = view;
    document.querySelectorAll('.nav-item').forEach(button => {
      button.classList.toggle('active', button.dataset.view === view);
    });
    $('#pathwaysView').hidden = view !== 'pathways';
    $('#timelineView').hidden = view !== 'timeline';
    $('#breadcrumbCurrent').textContent = view === 'timeline' ? 'СОБЫТИЯ' : '22 ПУТИ';
  }

  let toastTimer;
  function toast(message) {
    const element = $('#toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('show'), 3000);
  }

  init();
})();
