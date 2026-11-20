// Проверка приложения в эмуляции iPhone 14 (390×844).
// Запуск: сначала `npx serve -l 3000 .`, затем `node check/check.mjs` (BASE=http://localhost:3000 по умолчанию).
import { chromium, devices } from 'playwright';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const N = 30; // число карточек в cards.json
const BASE = process.env.BASE ?? 'http://localhost:3000/';
const OUT = path.dirname(fileURLToPath(import.meta.url));
const results = [];
const ok = (name, cond, info = '') => { results.push(`${cond ? 'OK  ' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); console.log(results.at(-1)); };
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
const context = await browser.newContext({
  ...devices['iPhone 14'],
  viewport: { width: 390, height: 844 },   // как в standalone-режиме на весь экран
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const go = async (hash) => { await page.evaluate((h) => (location.hash = h), hash); await page.waitForTimeout(450); };
const counter = () => page.textContent('#counter');

await page.goto(BASE);
await page.waitForSelector('#cardFrame .card-scale');
const total = await page.evaluate(() => fetch('cards.json').then((r) => r.json()).then((d) => d.cards.length));
ok('cards.json загружен', total === N, `${total} карточек`);
ok('шрифты локальные загружены', await page.evaluate(() => document.fonts.check("800 16px Inter") && document.fonts.check("700 16px 'JetBrains Mono'")));

// Оглавление
await go('toc');
ok(`оглавление: ${N} строк`, (await page.$$('#tocList .row')).length === N);
await shot(page, '01_toc.png');
await page.click('[data-filter="overfold"]');
ok('фильтр «Перефолды»: 10 строк (06–12, 15, 19, 28)', (await page.$$('#tocList .row')).length === 10);
await page.click('[data-filter="raises"]');
ok('фильтр «Рейзы»: 2 строки (14, 26)', (await page.$$('#tocList .row')).length === 2);
await page.click('[data-filter="multi"]');
ok('фильтр «Мультипоты»: 2 строки (16–17)', (await page.$$('#tocList .row')).length === 2);
await page.click('[data-filter="river"]');
ok('фильтр «Блефы ривера»: 8 строк (01–05, 13, 23, 24)', (await page.$$('#tocList .row')).length === 8);
await page.click('[data-filter="fourbet"]');
ok('фильтр «4-бет поты»: 2 строки (18, 25)', (await page.$$('#tocList .row')).length === 2);
await page.click('[data-filter="runout"]');
ok('фильтр «Карта тёрна/ривера»: 3 строки (20–22)', (await page.$$('#tocList .row')).length === 3);
await page.click('[data-filter="fish"]');
ok('фильтр «Фиши»: 1 строка (27)', (await page.$$('#tocList .row')).length === 1);
await page.click('[data-filter="texture"]');
ok('фильтр «Текстуры»: 2 строки (29–30)', (await page.$$('#tocList .row')).length === 2);
await page.click('[data-filter="all"]');

// Все карточки — без обрезки
for (let n = 1; n <= N; n++) {
  const id = String(n).padStart(2, '0');
  await go('cards/' + id);
  const r = await page.evaluate(() => {
    const frame = document.querySelector('#cardFrame');
    const root = frame.querySelector('.card-scale > div');
    const fr = frame.getBoundingClientRect(), st = document.querySelector('#stage').getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    let maxBottom = 0, maxRight = 0;
    root.querySelectorAll('*').forEach((el) => { const b = el.getBoundingClientRect(); maxBottom = Math.max(maxBottom, b.bottom); maxRight = Math.max(maxRight, b.right); });
    return {
      inStage: fr.top >= st.top - 0.5 && fr.bottom <= st.bottom + 0.5 && fr.left >= -0.5 && fr.right <= innerWidth + 0.5,
      contentFits: root.scrollHeight <= 844 && root.scrollWidth <= 390 && maxBottom <= rr.bottom + 0.5 && maxRight <= rr.right + 0.5,
      scale: (fr.width / 390).toFixed(3), sh: root.scrollHeight, counter: document.querySelector('#counter').textContent,
    };
  });
  ok(`карточка ${id} целиком на экране`, r.inStage && r.contentFits, `масштаб ${r.scale}, высота контента ${r.sh}/844, счётчик ${r.counter}`);
  if (id === '01') await shot(page, '02_card01.png');
  if (id === '06') await shot(page, '03_card06.png');
}

// Свайп (настоящие touch-события через CDP)
const cdp = await context.newCDPSession(page);
const swipe = async (x1, x2, y = 420) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + ((x2 - x1) * i) / 8, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(600);
};
await go('cards/01');
await swipe(320, 60);
ok('свайп влево → следующая', (await counter()) === `2 / ${N}`, await counter());
await swipe(60, 320);
ok('свайп вправо → предыдущая', (await counter()) === `1 / ${N}`, await counter());
await page.click('#nextBtn'); await page.waitForTimeout(600);
ok('кнопка › работает', (await counter()) === `2 / ${N}`);
await page.click('#prevBtn'); await page.waitForTimeout(600);
ok('кнопка ‹ работает', (await counter()) === `1 / ${N}`);

// Полноэкранный режим
await go('cards/06');
await page.click('#fsBtn'); await page.waitForTimeout(500);
const fsInfo = await page.evaluate(() => {
  const fr = document.querySelector('#cardFrame').getBoundingClientRect();
  const hiddenUi = ['.topbar', '.controls', '.tabbar'].every((s) => getComputedStyle(document.querySelector(s)).display === 'none');
  return { hiddenUi, w: fr.width, h: fr.height, top: fr.top, bottom: fr.bottom, vw: innerWidth, vh: innerHeight };
});
ok('полный экран: меню и кнопки скрыты, карточка во всю ширину', fsInfo.hiddenUi && fsInfo.w >= fsInfo.vw - 1 - 0.5 * 0 && fsInfo.top >= -0.5 && fsInfo.bottom <= fsInfo.vh + 0.5, JSON.stringify(fsInfo));
await shot(page, '07_fullscreen.png');
await swipe(320, 60);
ok('полный экран: свайп влево → 07', (await page.textContent('#fsChip')) === `7 / ${N}`, await page.textContent('#fsChip'));
await swipe(60, 320);
ok('полный экран: свайп вправо → 06', (await page.textContent('#fsChip')) === `6 / ${N}`);
await page.click('#fsExit', { force: true }).catch(() => {});
await page.waitForTimeout(300);
if (await page.evaluate(() => document.body.classList.contains('fs'))) { await page.evaluate(() => document.querySelector('#fsExit').click()); await page.waitForTimeout(300); }
ok('выход из полного экрана', await page.evaluate(() => !document.body.classList.contains('fs') && getComputedStyle(document.querySelector('.tabbar')).display !== 'none'));

// Тренировка
await go('train');
const hidden = await page.evaluate(() => {
  const root = document.querySelector('#trainFrame .card-scale > div');
  const vis = [...root.children].map((c) => getComputedStyle(c).visibility);
  return { title: vis[0] === 'visible' && vis[1] === 'visible', answerHidden: vis.slice(2, 6).every((v) => v === 'hidden') };
});
ok('тренировка: title/who/lede видны, ответ скрыт', hidden.title && hidden.answerHidden);
const trainFits = () => page.evaluate(() => {
  const fr = document.querySelector('#trainFrame').getBoundingClientRect(), st = document.querySelector('#trainStage').getBoundingClientRect();
  return fr.top >= st.top - 0.5 && fr.bottom <= st.bottom + 0.5 && fr.height > 300;
});
ok('тренировка: карточка без обрезки (до ответа)', await trainFits());
await shot(page, '04_train_before.png');
await page.click('#trainControls [data-reveal]'); await page.waitForTimeout(400);
ok('после «Показать ответ» видна таблица', await page.evaluate(() => getComputedStyle(document.querySelector('#trainFrame .card-scale > div').children[3]).visibility === 'visible'));
ok('тренировка: карточка без обрезки (после ответа)', await trainFits());
ok('кнопки «Знал»/«Не знал»',!!(await page.$('#knownBtn')) && !!(await page.$('#unknownBtn')));
await shot(page, '05_train_after.png');
await page.click('#knownBtn'); await page.waitForTimeout(400);                 // 01 — знал
await page.click('#trainControls [data-reveal]'); await page.waitForTimeout(300);
await page.click('#unknownBtn'); await page.waitForTimeout(400);               // 02 — не знал
ok('счётчик прогресса', (await page.textContent('#topRight')).startsWith(`3 / ${N}`), await page.textContent('#topRight'));
await page.reload(); await page.waitForTimeout(800);
ok('прогресс тренировки сохранился после перезагрузки', (await page.textContent('#topRight')).startsWith(`3 / ${N}`));
// новый круг: «не знал» идут первыми
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pokerCards.v1')); s.train.session = null; localStorage.setItem('pokerCards.v1', JSON.stringify(s)); });
await page.reload(); await page.waitForTimeout(800);
ok('в новом круге «не знал» (02) идёт первой', (await page.getAttribute('#trainFrame', 'data-id')) === '02');

// Корзина
const trash = async (id) => {
  await go('cards/' + id);
  await page.click('#trashBtn');
  ok(`подтверждение перед «Убрать» ${id}`, await page.isVisible('#modal'));
  await page.click('#modalOk'); await page.waitForTimeout(400);
};
await trash('03');
ok('после «Убрать» N-1 карточек', (await counter()).endsWith(`/ ${N - 1}`), await counter());
await trash('07');
ok('после второго «Убрать» N-2 карточек', (await counter()).endsWith(`/ ${N - 2}`));
await page.reload(); await page.waitForTimeout(800);
ok('корзина сохранилась после перезагрузки', (await counter()).endsWith(`/ ${N - 2}`));
await go('trash');
ok('в корзине 2 карточки', (await page.$$('.trash-item')).length === 2);
await shot(page, '06_trash.png');
await page.click('[data-restore="07"]'); await page.waitForTimeout(300);
ok('«Вернуть» работает', (await page.$$('.trash-item')).length === 1);
await page.click('[data-purge="03"]');
await page.click('#modalOk'); await page.waitForTimeout(300);
ok('«Удалить навсегда» работает', (await page.$$('.trash-item')).length === 0);
await page.click('#copyDeletedBtn'); await page.waitForTimeout(300);
const clip = await page.evaluate(() => navigator.clipboard.readText());
ok('«Скопировать список удалённых» кладёт номера в буфер', clip === '03', JSON.stringify(clip));
await page.reload(); await page.waitForTimeout(800);
await go('toc');
ok('после перезагрузки: N-1 карточек, 03 нет', (await page.$$('#tocList .row')).length === N - 1 && !(await page.$('[data-open="03"]')));

// Офлайн (service worker)
await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForTimeout(1000);
await context.setOffline(true);
await page.reload(); await page.waitForTimeout(1200);
await go('cards/13');
ok('офлайн: приложение и карточка 13 открываются', (await page.$('#cardFrame .card-scale > div')) !== null && (await counter()) === `12 / ${N - 1}`, await counter());
await context.setOffline(false);

ok('нет ошибок JS в консоли', errors.length === 0, errors.join(' | '));
await browser.close();
writeFileSync(path.join(OUT, 'report.txt'), results.join('\n') + '\n');
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(failed ? `\n${failed} проверок не прошло` : '\nВсе проверки пройдены');
process.exit(failed ? 1 : 0);
