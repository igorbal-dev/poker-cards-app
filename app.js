'use strict';
(() => {
  const CARD_W = 390, CARD_H = 844;
  const KEY = 'pokerCards.v1';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- состояние (localStorage) ----------
  const defaults = () => ({
    trash: {},        // id -> время: в корзине
    deleted: {},      // id -> время: удалены навсегда (скрыты из приложения, файлы не трогаем)
    filter: 'all',
    current: null,    // id открытой карточки
    train: { unknown: {}, known: {}, session: null },
  });
  let state = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) state = Object.assign(defaults(), saved, { train: Object.assign(defaults().train, saved.train) });
  } catch (e) { /* пустое или недоступное хранилище — работаем с умолчаниями */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };

  // ---------- данные ----------
  let groups = [], cards = [], byId = {};
  const frags = new Map();
  const getFrag = async (c) => {
    if (!frags.has(c.id)) {
      const p = fetch(c.file).then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); });
      frags.set(c.id, p);
      p.catch(() => frags.delete(c.id));
    }
    return frags.get(c.id);
  };

  const isGone = (id) => state.trash[id] || state.deleted[id];
  const inFilter = (c) => state.filter === 'all' || c.group === state.filter;
  const visible = () => cards.filter((c) => !isGone(c.id) && inFilter(c));

  // ---------- общие элементы ----------
  const toast = (msg) => {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 1800);
  };
  const confirmBox = (text, okText = 'Да') => new Promise((resolve) => {
    $('modalText').textContent = text; $('modalOk').textContent = okText; $('modal').hidden = false;
    const done = (v) => { $('modal').hidden = true; $('modalOk').onclick = $('modalCancel').onclick = null; resolve(v); };
    $('modalOk').onclick = () => done(true);
    $('modalCancel').onclick = () => done(false);
  });

  async function renderCard(frame, card, { hideAnswer = false } = {}) {
    let html;
    try { html = await getFrag(card); }
    catch (e) { html = `<div style="width:390px;height:844px;display:flex;align-items:center;justify-content:center;color:#9AA6B5;background:#10141A">Не удалось загрузить карточку ${esc(card.id)}</div>`; }
    frame.innerHTML = `<div class="card-scale">${html}</div>`;
    frame.dataset.id = card.id;
    frame.classList.toggle('hide-answer', hideAnswer);
    fit(frame);
    return frame.querySelector('.card-scale > div');
  }

  function fit(frame) {
    const stage = frame.parentElement;
    if (!stage || !stage.clientWidth) return;
    const cs = getComputedStyle(stage), fsMode = document.body.classList.contains('fs');
    const aw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const ah = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const s = Math.min((aw - (fsMode ? 0 : 12)) / CARD_W, (ah - (fsMode ? 0 : 8)) / CARD_H);
    frame.style.width = CARD_W * s + 'px';
    frame.style.height = CARD_H * s + 'px';
    const inner = frame.querySelector('.card-scale');
    if (inner) inner.style.transform = `scale(${s})`;
  }
  const fitAll = () => document.querySelectorAll('.card-frame').forEach(fit);
  window.addEventListener('resize', fitAll);
  window.addEventListener('orientationchange', () => setTimeout(fitAll, 200));

  // ---------- просмотр ----------
  function currentIndex(list) {
    let i = list.findIndex((c) => c.id === state.current);
    return i < 0 ? 0 : i;
  }

  async function showViewer() {
    const list = visible();
    const frame = $('cardFrame');
    if (!list.length) {
      frame.innerHTML = ''; frame.style.width = frame.style.height = '0';
      $('counter').textContent = '0 / 0';
      $('stage').dataset.empty = '1';
      $('topRight').textContent = '';
      showEmpty($('stage'), 'Нет карточек. Загляните в корзину или смените фильтр в оглавлении.');
      return;
    }
    clearEmpty($('stage'));
    const i = currentIndex(list);
    state.current = list[i].id; save();
    $('counter').textContent = `${i + 1} / ${list.length}`;
    $('fsChip').textContent = `${i + 1} / ${list.length}`;
    $('topRight').textContent = groupName(list[i].group);
    $('prevBtn').disabled = i === 0; $('nextBtn').disabled = i === list.length - 1;
    await renderCard(frame, list[i]);
    // подгружаем соседей заранее
    [list[i - 1], list[i + 1]].forEach((c) => c && getFrag(c));
  }

  function showEmpty(stage, text) {
    let e = stage.querySelector('.empty');
    if (!e) { e = document.createElement('div'); e.className = 'empty'; stage.appendChild(e); }
    e.textContent = text;
  }
  function clearEmpty(stage) { const e = stage.querySelector('.empty'); if (e) e.remove(); }

  let busy = false;
  async function go(delta) {
    const list = visible();
    const i = currentIndex(list), j = i + delta;
    const frame = $('cardFrame');
    if (busy) return;
    if (j < 0 || j >= list.length) { bounce(frame, delta); return; }
    busy = true;
    const w = $('stage').clientWidth;
    frame.classList.add('anim');
    frame.style.transform = `translateX(${-delta * w}px)`; frame.style.opacity = '0';
    await wait(180);
    state.current = list[j].id;
    frame.classList.remove('anim');
    frame.style.transform = `translateX(${delta * w * 0.4}px)`;
    await showViewer();
    frame.getBoundingClientRect();
    frame.classList.add('anim');
    frame.style.transform = ''; frame.style.opacity = '';
    await wait(220);
    frame.classList.remove('anim');
    busy = false;
  }
  function bounce(frame, delta) {
    frame.classList.add('anim'); frame.style.transform = `translateX(${-delta * 24}px)`;
    setTimeout(() => { frame.style.transform = ''; setTimeout(() => frame.classList.remove('anim'), 230); }, 120);
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // полноэкранный режим: карточка на весь экран, только свайпы
  let swiped = false, fsApi = false, fsTimer = null;
  const inFs = () => document.body.classList.contains('fs');
  function fsUi(show) {
    clearTimeout(fsTimer);
    $('fsUi').classList.toggle('dim', !show);
    if (show) fsTimer = setTimeout(() => $('fsUi').classList.add('dim'), 2500);
  }
  function enterFs() {
    document.body.classList.add('fs');
    fsApi = false;
    const el = document.documentElement;
    if (el.requestFullscreen) { el.requestFullscreen({ navigationUI: 'hide' }).then(() => (fsApi = true)).catch(() => {}); }
    fitAll(); fsUi(true);
    setTimeout(fitAll, 150);
  }
  function exitFs() {
    if (!inFs()) return;
    document.body.classList.remove('fs');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    fsApi = false; clearTimeout(fsTimer); $('fsUi').classList.add('dim');
    fitAll(); setTimeout(fitAll, 150);
  }
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && fsApi) exitFs(); else setTimeout(fitAll, 100); });

  // свайп
  function attachSwipe(stage, frame, onSwipe) {
    let x0 = null, y0 = 0, dx = 0, horiz = null, id = null;
    stage.addEventListener('pointerdown', (e) => {
      if (busy || e.button > 0 || e.target.closest('button')) return;
      x0 = e.clientX; y0 = e.clientY; dx = 0; horiz = null; id = e.pointerId;
    });
    stage.addEventListener('pointermove', (e) => {
      if (x0 === null || e.pointerId !== id) return;
      dx = e.clientX - x0; const dy = e.clientY - y0;
      if (horiz === null && Math.abs(dx) + Math.abs(dy) > 8) {
        horiz = Math.abs(dx) > Math.abs(dy);
        if (horiz) { try { stage.setPointerCapture(id); } catch (_) {} }
      }
      if (horiz) { frame.style.transform = `translateX(${dx}px) rotate(${dx / 60}deg)`; e.preventDefault(); }
    });
    const end = (e) => {
      if (x0 === null || e.pointerId !== id) return;
      const was = horiz; x0 = null;
      if (!was) return;
      swiped = true; setTimeout(() => (swiped = false), 60);
      if (Math.abs(dx) > Math.min(70, stage.clientWidth * 0.18)) onSwipe(dx < 0 ? 1 : -1);
      else { frame.classList.add('anim'); frame.style.transform = ''; setTimeout(() => frame.classList.remove('anim'), 230); }
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
  }

  // ---------- оглавление ----------
  const groupName = (gid) => (groups.find((g) => g.id === gid) || { name: gid || '' }).name;
  // «01–05, 13», «6-01–6-03, 6-04b»: подряд идущие номера сворачиваются в диапазон
  const range = (gid) => {
    const ids = cards.filter((c) => c.group === gid).map((c) => c.id);
    const key = (id) => { const m = /^(?:(\d+)-)?(\d+)([a-z]?)$/.exec(id) || []; return { pre: m[1] || '', n: parseInt(m[2], 10), suf: m[3] || '' }; };
    const next = (x, y) => { const a = key(x), b = key(y); return a.pre === b.pre && !a.suf && !b.suf && b.n === a.n + 1; };
    const out = [];
    for (let i = 0; i < ids.length; ) {
      let j = i; while (j + 1 < ids.length && next(ids[j], ids[j + 1])) j++;
      out.push(j > i ? `${ids[i]}–${key(ids[j]).pre ? ids[j].split('-')[1] : ids[j]}` : ids[i]); i = j + 1;
    }
    return out.join(', ');
  };

  function showToc() {
    const chips = [{ id: 'all', name: 'Все' }, ...groups];
    $('filterChips').innerHTML = chips.map((g) =>
      `<button class="chip ${state.filter === g.id ? 'on' : ''}" data-filter="${esc(g.id)}">${esc(g.name)}${g.id !== 'all' ? ` <span style="opacity:.6">${range(g.id)}</span>` : ''}</button>`).join('');
    const list = visible();
    $('topRight').textContent = `${list.length} шт.`;
    if (!list.length) { $('tocList').innerHTML = '<div class="empty">В этой группе карточек нет.</div>'; return; }
    let out = '';
    for (const g of groups) {
      const items = list.filter((c) => c.group === g.id);
      if (!items.length) continue;
      out += `<div class="group-h">${esc(g.name)}</div>`;
      out += items.map(rowHtml).join('');
    }
    const other = list.filter((c) => !groups.some((g) => g.id === c.group));
    if (other.length) out += `<div class="group-h">Другие</div>` + other.map(rowHtml).join('');
    $('tocList').innerHTML = out;
  }
  const rowHtml = (c) => `<div class="row" data-open="${esc(c.id)}">
      <span class="num">${esc(c.id)}</span>
      <div class="row-main"><div class="row-title">${esc(c.title)}</div><div class="row-sub">${esc(c.who)}</div></div>
      ${state.train.unknown[c.id] ? '<span class="mark" title="Не знал">✗</span>' : ''}
      <span class="rel rel-${esc(c.rel)}">${esc(c.rel)}</span></div>`;

  // ---------- тренировка ----------
  function newSession() {
    const ids = visible().map((c) => c.id);
    const unknown = ids.filter((id) => state.train.unknown[id]).sort((a, b) => state.train.unknown[a] - state.train.unknown[b]);
    const rest = ids.filter((id) => !state.train.unknown[id]);
    state.train.session = { queue: [...unknown, ...rest], i: 0, revealed: false, known: 0, unknown: 0, filter: state.filter };
    save();
  }

  async function showTrain() {
    let s = state.train.session;
    if (!s || s.filter !== state.filter) { newSession(); s = state.train.session; }
    // пропускаем карточки, убранные в корзину во время сессии
    while (s.i < s.queue.length && (isGone(s.queue[s.i]) || !byId[s.queue[s.i]])) { s.queue.splice(s.i, 1); }
    save();
    const total = s.queue.length;
    $('trainBar').style.width = total ? (s.i / total) * 100 + '%' : '0';
    $('topRight').innerHTML = `${Math.min(s.i + (s.i < total ? 1 : 0), total)} / ${total} · <span style="color:var(--green)">✓${s.known}</span> <span style="color:var(--red)">✗${s.unknown}</span>`;
    const stage = $('trainStage'), frame = $('trainFrame'), ctr = $('trainControls');
    stage.querySelectorAll('.train-done').forEach((e) => e.remove());

    if (!total || s.i >= total) {
      frame.innerHTML = ''; frame.style.width = frame.style.height = '0';
      const left = Object.keys(state.train.unknown).filter((id) => byId[id] && !isGone(id) && inFilter(byId[id])).length;
      const done = document.createElement('div');
      done.className = 'train-done';
      done.innerHTML = total
        ? `<div class="big">${s.known} / ${total}</div><div>Знал ${s.known}, не знал ${s.unknown}.</div>
           <div class="hint">${left ? `${left} карточ${plural(left, 'ка', 'ки', 'ек')} «не знал» пойдут первыми в следующем круге.` : 'Все карточки отмечены как знакомые.'}</div>`
        : '<div class="hint">Нет карточек для тренировки.</div>';
      stage.appendChild(done);
      ctr.innerHTML = total ? '<button class="btn primary wide" id="restartBtn">Начать заново</button>' : '';
      if (total) $('restartBtn').onclick = () => { newSession(); showTrain(); };
      return;
    }

    const card = byId[s.queue[s.i]];
    // кнопки ставим до рендера, чтобы масштаб считался по итоговой высоте сцены
    ctr.innerHTML = s.revealed
      ? '<button class="btn bad wide" id="unknownBtn">Не знал</button><button class="btn good wide" id="knownBtn">Знал</button>'
      : '<button class="btn primary wide" data-reveal>Показать ответ</button>';
    const root = await renderCard(frame, card, { hideAnswer: !s.revealed });
    if (!s.revealed && root) {
      // закрываем область ответа плашкой внутри масштабируемой карточки
      const lede = root.children[1];
      const top = lede ? lede.offsetTop + lede.offsetHeight + 14 : 200;
      const cover = document.createElement('div');
      cover.className = 'answer-cover';
      cover.style.top = top + 'px';
      cover.innerHTML = '<div class="q">Что делать?</div><div>Вспомни ответ, потом открой таблицу.</div><button class="btn primary" data-reveal>Показать ответ</button>';
      root.style.position = 'relative';
      root.appendChild(cover);
    } else if (root) {
      $('knownBtn').onclick = () => answer(true);
      $('unknownBtn').onclick = () => answer(false);
    }
    const next = byId[s.queue[s.i + 1]]; if (next) getFrag(next);
  }
  function answer(knew) {
    const s = state.train.session, id = s.queue[s.i], now = Date.now();
    if (knew) { state.train.known[id] = now; delete state.train.unknown[id]; s.known++; }
    else { state.train.unknown[id] = now; delete state.train.known[id]; s.unknown++; }
    s.i++; s.revealed = false; save(); showTrain();
  }
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
  };

  // ---------- корзина ----------
  async function trashCurrent() {
    const list = visible(); if (!list.length) return;
    const c = list[currentIndex(list)];
    if (!(await confirmBox(`Убрать карточку ${c.id} «${c.title}» в корзину?`, 'Убрать'))) return;
    const i = currentIndex(list);
    state.trash[c.id] = Date.now();
    const rest = visible();
    state.current = rest.length ? rest[Math.min(i, rest.length - 1)].id : null;
    save(); updateBadge(); showViewer();
    toast(`Карточка ${c.id} в корзине`);
  }

  function showTrash() {
    const ids = Object.keys(state.trash).filter((id) => byId[id]).sort();
    $('topRight').textContent = `${ids.length} шт.`;
    $('trashList').innerHTML = ids.length ? ids.map((id) => {
      const c = byId[id];
      return `<div class="trash-item"><span class="num">${esc(id)}</span>
        <div class="row-main"><div class="row-title">${esc(c.title)}</div><div class="row-sub">${esc(groupName(c.group))}</div></div>
        <div class="btns"><button class="btn small" data-restore="${esc(id)}">Вернуть</button>
        <button class="btn small danger" data-purge="${esc(id)}">Удалить навсегда</button></div></div>`;
    }).join('') : '<div class="empty">Корзина пуста.</div>';
    const del = deletedIds();
    const forever = Object.keys(state.deleted).sort();
    $('copyDeletedBtn').disabled = !del.length;
    $('deletedInfo').textContent = (forever.length ? `Удалены навсегда: ${forever.join(', ')}. ` : '') +
      'Список включает карточки в корзине и удалённые навсегда. Файлы карточек не удаляются — всё хранится только в этом браузере.';
  }
  const deletedIds = () => [...new Set([...Object.keys(state.trash), ...Object.keys(state.deleted)])].sort();

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'; document.body.appendChild(ta); ta.select();
      ta.setSelectionRange(0, text.length);
      let ok = false; try { ok = document.execCommand('copy'); } catch (_) {}
      ta.remove(); return ok;
    }
  }

  function updateBadge() {
    const n = Object.keys(state.trash).filter((id) => byId[id]).length;
    $('trashBadge').hidden = !n; $('trashBadge').textContent = n;
  }

  // ---------- навигация ----------
  const TITLES = { cards: 'Карточки', toc: 'Оглавление', train: 'Тренировка', trash: 'Корзина' };
  function route() {
    const [tab, arg] = (location.hash.slice(1) || 'cards').split('/');
    const name = TITLES[tab] ? tab : 'cards';
    if (name === 'cards' && arg && byId[arg] && !isGone(arg)) {
      if (!inFilter(byId[arg])) state.filter = 'all';
      state.current = arg; save();
    }
    if (name !== 'cards') exitFs();
    $('fsBtn').hidden = name !== 'cards';
    document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== 'view-' + name));
    document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === name));
    $('viewTitle').textContent = TITLES[name];
    ({ cards: showViewer, toc: showToc, train: showTrain, trash: showTrash })[name]();
  }

  // ---------- события ----------
  function bind() {
    $('prevBtn').onclick = () => go(-1);
    $('nextBtn').onclick = () => go(1);
    $('trashBtn').onclick = trashCurrent;
    attachSwipe($('stage'), $('cardFrame'), go);
    $('fsBtn').onclick = enterFs;
    $('fsExit').onclick = exitFs;
    $('stage').addEventListener('click', () => { if (inFs() && !swiped) fsUi($('fsUi').classList.contains('dim')); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') exitFs();
      if (!$('modal').hidden || $('view-cards').hidden) return;
      if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'ArrowRight') go(1);
    });
    $('filterChips').onclick = (e) => {
      const b = e.target.closest('[data-filter]'); if (!b) return;
      state.filter = b.dataset.filter; save(); showToc();
    };
    $('tocList').onclick = (e) => {
      const r = e.target.closest('[data-open]'); if (!r) return;
      location.hash = 'cards/' + r.dataset.open;
    };
    $('view-train').addEventListener('click', (e) => {
      if (!e.target.closest('[data-reveal]')) return;
      state.train.session.revealed = true; save(); showTrain();
    });
    $('trashList').onclick = async (e) => {
      const r = e.target.closest('[data-restore]'), p = e.target.closest('[data-purge]');
      if (r) { delete state.trash[r.dataset.restore]; save(); updateBadge(); showTrash(); toast(`Карточка ${r.dataset.restore} возвращена`); }
      if (p) {
        const id = p.dataset.purge;
        if (!(await confirmBox(`Удалить карточку ${id} навсегда? Вернуть её из приложения будет нельзя (файл карточки останется).`, 'Удалить'))) return;
        delete state.trash[id]; state.deleted[id] = Date.now(); delete state.train.unknown[id];
        save(); updateBadge(); showTrash();
      }
    };
    $('copyDeletedBtn').onclick = async () => {
      const ids = deletedIds();
      if (!ids.length) return;
      toast((await copyText(ids.join(', '))) ? `Скопировано: ${ids.join(', ')}` : 'Не удалось скопировать');
    };
    window.addEventListener('hashchange', route);
  }

  // ---------- старт ----------
  async function init() {
    bind();
    try {
      const data = await fetch('cards.json', { cache: 'no-cache' }).then((r) => r.json());
      groups = data.groups || [];
      // порядок: сначала 01–13, затем серии 6-xx, 7-xx … 10-xx (числовой, не строковый)
      const ck = (id) => { const m = /^(?:(\d+)-)?(\d+)([a-z]?)$/.exec(id) || []; return [m[1] ? +m[1] : 0, +m[2] || 0, m[3] || '']; };
      cards = (data.cards || data).slice().sort((a, b) => { const x = ck(a.id), y = ck(b.id); return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]); });
    } catch (e) {
      $('main').innerHTML = '<div class="empty">Не удалось загрузить cards.json.</div>';
      return;
    }
    byId = Object.fromEntries(cards.map((c) => [c.id, c]));
    if (state.filter !== 'all' && !groups.some((g) => g.id === state.filter)) state.filter = 'all';
    updateBadge();
    route();
    // фоновая загрузка всех карточек — чтобы работали офлайн
    setTimeout(() => cards.forEach((c) => getFrag(c).catch(() => {})), 600);
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }
  if (document.fonts && document.fonts.load) {
    Promise.all([document.fonts.load("800 16px Inter", 'АБ'), document.fonts.load("700 16px 'JetBrains Mono'", '12')]).catch(() => {}).finally(init);
  } else init();

  window.__app = { get state() { return state; } }; // для проверки
})();
