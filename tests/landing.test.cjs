/* Structural check for the landing page: parse it, run its script in a stub
   DOM, and cross-reference CSS classes, ids, anchors, contrast and aria
   targets. Layout is the one thing jsdom cannot give us, so everything here is
   structure, cascade or arithmetic — never a measurement. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createRequire } = require('node:module');
const { JSDOM, VirtualConsole } = createRequire(
  path.resolve(__dirname, '../frontend/package.json')
)('jsdom');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'frontend', 'public', 'landing.html');
const html = fs.readFileSync(FILE, 'utf8');

const problems = [];
const notes = [];
function fail(msg) { problems.push(msg); }
function ok(msg) { notes.push(msg); }

/* ── 1. Brace balance in the <style> block ── */
const styleText = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
let depth = 0;
for (const ch of styleText) {
  if (ch === '{') depth++;
  else if (ch === '}') depth--;
  if (depth < 0) break;
}
depth === 0 ? ok('CSS braces balanced') : fail(`CSS braces unbalanced (depth ${depth})`);

/* ── 2. Parse + run the page script ── */
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push(`jsdomError: ${e.message}`));
vc.on('error', (...args) => errors.push(`console.error: ${args.join(' ')}`));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'http://localhost:5173/landing',
  virtualConsole: vc,
  pretendToBeVisual: true,
  // jsdom 25 has no matchMedia; every browser does. Stub it rather than
  // weakening the page for an environment it never runs in.
  beforeParse(window) {
    if (typeof window.matchMedia !== 'function') {
      window.matchMedia = (query) => ({
        media: query,
        matches: false,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        onchange: null,
        dispatchEvent: () => false,
      });
    }
  },
});
const { window } = dom;
const doc = window.document;

errors.length === 0 ? ok('page script ran with no errors') : fail(errors.join(' | '));

/* ── 3. The tour iframe points at the document sitting beside it ── */
const iframes = [...doc.querySelectorAll('iframe')];
if (iframes.length !== 1) fail(`expected 1 iframe, found ${iframes.length}`);
else {
  const src = iframes[0].getAttribute('src');
  const file = src.split('?')[0];
  if (file !== 'tour.html') fail(`iframe points at ${file}`);
  else if (!fs.existsSync(path.join(path.dirname(FILE), file))) fail(`iframe target missing: ${file}`);
  else ok(`iframe -> ${src} (exists, sibling of the landing page)`);
  if (!iframes[0].getAttribute('title')) fail('iframe has no title');
}

/* ── 4. The hero is the tour, edge to edge, one screen tall ── */
const hero = doc.querySelector('.hero');
const frame = doc.querySelector('.tour-frame');
if (!hero || !frame) fail('hero or tour frame missing');
else {
  if (frame.parentElement !== hero) fail('the tour frame is not the hero itself');
  if (!/^tour\.html\?embed=1$/.test(frame.getAttribute('src'))) {
    fail(`tour frame src is ${frame.getAttribute('src')} — embed flag missing`);
  } else ok('hero contains the tour directly, loaded with ?embed=1');
  if (!/\.hero\{position:relative;height:100svh/.test(styleText)) fail('hero is not a full screen tall');
  else ok('hero is height:100svh (min 620px) with the frame at inset:0');
  if (!/\.masthead\{position:fixed/.test(styleText)) fail('header is not overlaid on the tour');
  else ok('header is fixed over the tour, transparent until scrolled');
  if (doc.getElementById('tour-viewport') || doc.getElementById('tour-stage')) {
    fail('the old scaled-frame markup is still present');
  }
  if (/tour-scale|fitTour/.test(html)) fail('the scaling code was left behind');
  else ok('no scaling machinery left');
}

/* ── 4b. Nothing left that frames this as a demo ── */
for (const gone of [/[Ii]llustrative/, /40-second/, /Space<\/kbd>/]) {
  if (gone.test(html)) fail(`landing page still says ${gone}`);
}
ok('no illustrative/demo framing or keyboard hints on the landing page');

/* ── 4c. Anchors land flush under the header ── */
{
  const head = /--head:(\d+)px/.exec(styleText);
  const pad = /scroll-padding-top:calc\(var\(--head\) \+ 1px\)/.test(styleText);
  const inner = /\.masthead-inner\{height:var\(--head\)/.test(styleText);
  const narrow = /:root\{--head:(\d+)px\}/.exec(styleText);
  if (!head || !pad || !inner) {
    fail('the anchor offset is not derived from the header height');
  } else {
    // Header box = inner height + its 1px bottom border; a section scrolled to
    // that offset starts exactly where the header ends.
    const h = Number(head[1]);
    ok(`header ${h}px + 1px border, anchors offset by ${h + 1}px — sections land flush`);
    if (narrow) ok(`narrow screens: header ${narrow[1]}px, offset follows the same variable`);
    else fail('the narrow-screen header height no longer feeds the offset');
  }
  for (const link of doc.querySelectorAll('.masthead-nav a[href^="#"]')) {
    const target = doc.getElementById(link.getAttribute('href').slice(1));
    if (!target) { fail(`nav link ${link.getAttribute('href')} has no section`); continue; }
    if (target.tagName !== 'SECTION') fail(`${link.textContent.trim()} points at a ${target.tagName}, not a section`);
    if (!target.querySelector('.section-head')) fail(`#${target.id} has no heading block to land on`);
  }
  ok('every nav link points at the section it names, and each has a heading block');

  // jsdom has no layout, so feed it the real geometry from the browser: a
  // 1884x984 viewport, the 73px header, and a section's 79px top padding.
  const HEAD = 73;
  const SECTION_PAD = 79;
  const DOC_TOP = { features: 984, 'so-what': 2056 };
  Object.defineProperty(doc.getElementById('masthead'), 'offsetHeight', { value: HEAD, configurable: true });
  let scrollY = 0;
  Object.defineProperty(window, 'scrollY', { get: () => scrollY, configurable: true });
  window.scrollTo = ({ top }) => { scrollY = top; };

  for (const [id, docTop] of Object.entries(DOC_TOP)) {
    const section = doc.getElementById(id);
    section.querySelector('.section-head').getBoundingClientRect = () => ({ top: docTop + SECTION_PAD - scrollY });
    scrollY = 0;
    doc.querySelector(`.masthead-nav a[href="#${id}"]`)
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    const heading = docTop + SECTION_PAD - scrollY;
    const edge = docTop - scrollY;
    if (heading !== HEAD + 28) fail(`#${id} heading lands ${heading - HEAD}px below the header, wanted 28px`);
    else if (edge >= HEAD) fail(`#${id} leaves ${HEAD - edge}px of its own padding showing under the header`);
    else ok(`#${id}: heading 28px under the header, section edge tucked at ${edge}px (scroll ${scrollY})`);
  }
}

/* ── 4d. The brand goes to the very top, not to an anchor ── */
{
  const brands = [...doc.querySelectorAll('[data-top]')];
  if (brands.length !== 2) fail(`expected 2 brand links, found ${brands.length}`);
  let scrolled = null;
  window.scrollTo = options => { scrolled = options; };
  try { window.history.replaceState(null, '', '/landing#features'); } catch {}
  brands[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  if (!scrolled || scrolled.top !== 0) fail(`brand click scrolled to ${JSON.stringify(scrolled)}`);
  else ok('brand click scrolls to 0 (not to #top) and clears the fragment');
  if (window.location.hash) fail(`the fragment survived the brand click: ${window.location.hash}`);
}

/* ── 4e. The build credit ── */
{
  const credit = doc.querySelector('.credit');
  if (!credit) fail('no credit line in the footer');
  else {
    const text = credit.textContent.replace(/\s+/g, ' ').trim();
    for (const name of ['Awad Buisir', 'Jaylen Zeng', 'Brady Cai', 'Spiros Halkias']) {
      if (!text.includes(name)) fail(`the credit is missing ${name}`);
    }
    if (credit.closest('footer') === null) fail('the credit is not in the footer');
    ok(`footer credit: "${text}"`);
  }
}

/* ── 5. Duplicate ids ── */
const ids = [...doc.querySelectorAll('[id]')].map(el => el.id);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
dupes.length ? fail(`duplicate ids: ${[...new Set(dupes)].join(', ')}`) : ok(`${ids.length} unique ids`);

/* ── 6. In-page anchors resolve ── */
for (const a of doc.querySelectorAll('a[href^="#"]')) {
  const target = a.getAttribute('href').slice(1);
  if (target && !doc.getElementById(target)) fail(`dead anchor: #${target}`);
}
ok('every #anchor resolves');

/* ── 7. aria-labelledby targets exist ── */
for (const el of doc.querySelectorAll('[aria-labelledby]')) {
  for (const id of el.getAttribute('aria-labelledby').split(/\s+/)) {
    if (!doc.getElementById(id)) fail(`aria-labelledby points at missing #${id}`);
  }
}
ok('every aria-labelledby target exists');

/* ── 8. Class cross-reference: used in HTML but never styled, and vice versa ── */
const used = new Set();
for (const el of doc.querySelectorAll('[class]')) {
  for (const c of el.classList) used.add(c);
}
const styled = new Set();
// Comments mention paths like index.css, which look like class selectors.
const cssNoComments = styleText.replace(/\/\*[\s\S]*?\*\//g, ' ');
for (const m of cssNoComments.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) styled.add(m[1]);

const unstyled = [...used].filter(c => !styled.has(c));
const unused = [...styled].filter(c => !used.has(c));
unstyled.length ? fail(`classes used but not styled: ${unstyled.join(', ')}`) : ok('every class in the markup is styled');
unused.length ? fail(`styled but unused: ${unused.join(', ')}`) : ok('no dead CSS classes');

/* ── 9. Headings: one h1, sections labelled ── */
const h1s = doc.querySelectorAll('h1');
h1s.length === 1 ? ok(`single h1: "${h1s[0].textContent.trim().replace(/\s+/g, ' ')}"`) : fail(`${h1s.length} h1 elements`);
if (h1s.length === 1 && !h1s[0].classList.contains('sr-only')) {
  fail('the landing h1 is visible and would compete with the tour headline');
}
ok('h2s: ' + [...doc.querySelectorAll('h2')].map(h => `"${h.textContent.trim().replace(/\s+/g, ' ')}"`).join(', '));

/* ── 10. Auth + help affordances in the top right ── */
const nav = doc.querySelector('.masthead-nav');
if (!nav) fail('masthead nav missing');
else {
  const labels = [...nav.children].map(el => el.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean);
  ok('masthead right: ' + labels.join(' | '));
  for (const want of ['Help', 'Log in']) {
    if (!labels.includes(want)) fail(`masthead is missing a "${want}" control`);
  }
  // Removed on request: no sign-up affordance anywhere, and no dev-setup line.
  const body = doc.body.textContent;
  if (/sign\s*up/i.test(body)) fail('a sign-up control or mention survives');
  else ok('no sign-up control or mention anywhere on the page');
  // Setup instructions belong in the README, read by whoever runs the stack.
  // A visitor to a deployed instance is not that person: the stack is already
  // running, they have no .env, and a port on localhost is not where they are.
  const SETUP = [
    /docker\s*compose/i, /localhost:\d+/, /\.env\b/, /ANTHROPIC_API_KEY/,
    /npm (run|install)/i, /pip install/i, /clone (this|the) repo/i, /start the stack/i,
  ];
  const pageText = doc.body.textContent.replace(/\s+/g, ' ');
  const instructions = SETUP.filter(rx => rx.test(pageText)).map(rx => String(rx));
  instructions.length
    ? fail(`the page tells a visitor how to install it: ${instructions.join(', ')}`)
    : ok('nothing on the page, help included, explains how to run the stack');
  const help = doc.getElementById('help-button');
  if (!help || help.tagName !== 'BUTTON') fail('Help is not a button');
  const authHrefs = [...nav.querySelectorAll('a[href]')].map(a => a.getAttribute('href'));
  ok('auth links -> ' + authHrefs.join(', '));
}

/* ── 10b. Served by the app, so every link into it is a path on this origin ── */
{
  const hrefs = [...doc.querySelectorAll('a[href]')].map(a => a.getAttribute('href'));
  // A hardcoded dev-server URL is wrong everywhere the app is not on port 5173,
  // which includes the built bundle and anyone else's machine.
  const absolute = hrefs.filter(href => /^[a-z]+:|^\/\//i.test(href));
  absolute.length
    ? fail(`links leave the app's origin: ${absolute.join(', ')}`)
    : ok(`${hrefs.length} links, all same-origin paths or fragments`);
  const login = hrefs.filter(href => /login/.test(href));
  if (!login.length) fail('nothing on the page leads to the login route');
  else if (login.some(href => href !== '/login')) fail(`login links disagree: ${[...new Set(login)].join(', ')}`);
  else ok(`${login.length} routes into the app, all /login`);
}

/* ── 11. Help dialog opens ── */
const dialog = doc.getElementById('help-dialog');
if (!dialog) fail('help dialog missing');
else {
  doc.getElementById('help-button').click();
  const shown = dialog.open || dialog.hasAttribute('open');
  shown ? ok('Help click opens the dialog') : fail('Help click did not open the dialog');
  const items = dialog.querySelectorAll('.help-item h3').length;
  ok(`help dialog has ${items} sections`);
}

/* ── 12. Reveal-on-scroll wiring (no IntersectionObserver in jsdom -> all visible) ── */
const hidden = [...doc.querySelectorAll('[data-reveal]')].filter(el => el.dataset.visible !== 'true');
hidden.length === 0
  ? ok(`${doc.querySelectorAll('[data-reveal]').length} reveal targets fall back to visible without IntersectionObserver`)
  : fail(`${hidden.length} reveal targets would stay invisible in a browser without IntersectionObserver`);

/* ── 13. SVGs: lucide geometry (24 box, round caps) ── */
const svgs = [...doc.querySelectorAll('svg')];
const badBox = svgs.filter(s => s.getAttribute('viewBox') !== '0 0 24 24');
badBox.length ? fail(`${badBox.length} svg(s) not on a 24x24 box`) : ok(`${svgs.length} svgs, all 0 0 24 24`);
const strokedNoCap = svgs.filter(s => s.getAttribute('stroke') === 'currentColor' && s.getAttribute('stroke-linecap') !== 'round');
strokedNoCap.length ? fail(`${strokedNoCap.length} stroked svg(s) without round caps`) : ok('stroked icons use round caps/joins');

/* ── 14. The gradient headline moves, and the cycle neither seams nor jumps ── */
{
  const rule = /(?:^|[};])\s*h2 em\{([^}]*)\}/.exec(cssNoComments);
  if (!rule) fail('the h2 em gradient rule is gone');
  else {
    const decl = rule[1].replace(/\s*\n\s*/g, '');
    const tile = Number((/background-size:(\d+)% 100%/.exec(decl) || [])[1]);
    // Text painted through background-clip has nothing of its own to animate;
    // it moves only by sliding an image wider than the box across it.
    if (!(tile > 100)) fail(`h2 em background-size is ${tile || 'unset'}: nothing to slide`);
    if (!/animation:text-sheen [\d.]+s [^;}]*infinite/.test(decl)) fail('h2 em has no sheen animation');
    // The shorthand resets size and position, so it has to come first.
    if (decl.indexOf('background:') > decl.indexOf('background-size:')) {
      fail('h2 em sets background-size before the shorthand that resets it');
    }
    const stops = /linear-gradient\(100deg,([^)]*)\)/.exec(decl)[1].split(',').map(s => s.trim().split(/\s+/));
    // Tiled, the image's ends meet: different colours drag a hard edge through
    // the letters once per cycle.
    if (stops[0][0] !== stops[stops.length - 1][0]) fail(`h2 em gradient runs ${stops[0][0]} -> ${stops[stops.length - 1][0]}: the tile seam shows`);
    // Paused, the headline must look as it did before it moved.
    if (!/background-position:0% 50%/.test(decl)) fail('h2 em has no pinned resting frame');
    const reduced = /@media \(prefers-reduced-motion:reduce\)\{([\s\S]*?)\n\}/.exec(cssNoComments);
    if (!reduced || !/h2 em\{animation:none\}/.test(reduced[1].replace(/\s*\n\s*/g, ''))) {
      fail('the sheen keeps running under prefers-reduced-motion');
    }
    const frames = /@keyframes text-sheen\{((?:[^{}]*\{[^{}]*\})+)\}/.exec(cssNoComments);
    if (!frames) fail('the text-sheen keyframes are missing');
    else {
      const offsets = [...frames[1].matchAll(/background-position:(-?\d+)% 50%/g)].map(m => Number(m[1]));
      const travel = offsets[0] - offsets[offsets.length - 1];
      // One whole tile per cycle, so the last frame paints what the first does.
      if (travel % tile !== 0) fail(`the sheen travels ${travel}%, not a whole ${tile}% tile`);
      if (travel <= 0) fail('the sheen runs against the reading direction');
      ok(`gradient headline sheens one ${tile}% tile per cycle, seamless, off under reduced motion`);
    }
  }
}

/* ── 15. Every colour the sheen sweeps is readable, and it survives forced colours ── */
{
  const lin = c => { c /= 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); };
  const L = hex => { const [r, g, b] = hex.replace('#', '').match(/\w\w/g).map(h => lin(parseInt(h, 16)));
    return .2126 * r + .7152 * g + .0722 * b; };
  const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((m, n) => n - m); return (x + .05) / (y + .05); };

  const bg = /--bg:(#[0-9a-f]{6})/.exec(cssNoComments)[1];
  const rule = /h2 em\{([^}]*)\}/.exec(cssNoComments)[1];
  const stops = [...rule.matchAll(/#[0-9a-f]{6}/g)].map(m => m[0]);
  // The animation sweeps every stop across every glyph, so one pale stop is not
  // a highlight on a word — it is the whole heading, in turn. 28-42px at 650 is
  // large text, so the bar is WCAG AA 3:1.
  const weak = stops.filter(hex => ratio(hex, bg) < 3);
  if (weak.length) {
    fail(`the sheen sweeps ${weak.map(h => `${h} at ${ratio(h, bg).toFixed(2)}:1`).join(', ')} across the heading`);
  } else {
    const lowest = Math.min(...stops.map(h => ratio(h, bg)));
    ok(`${stops.length} sheen stops, all >= 3:1 on ${bg} (lowest ${lowest.toFixed(2)}:1)`);
  }

  // Forced colours drops every background-image that is not a url(), which
  // leaves -webkit-text-fill-color:transparent painting nothing at all.
  const forced = /@media *\(forced-colors: *active\)\{([\s\S]*?)\n\}/.exec(cssNoComments);
  if (!forced || !/-webkit-text-fill-color:currentColor/.test(forced[1])) {
    fail('no forced-colors fallback: the gradient heading disappears in that mode');
  } else {
    ok('forced colours: the heading falls back to solid text');
  }
}

/* ── 16. In-page links move focus, not just the scroll position ── */
{
  const skip = doc.querySelector('.skip');
  skip.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const target = doc.getElementById('features');
  if (doc.activeElement !== target && !target.contains(doc.activeElement)) {
    const left = doc.activeElement === doc.body ? '<body>' : `.${doc.activeElement.className}`;
    fail(`the skip link scrolls but leaves focus on ${left}, so the next Tab returns to the header`);
  } else {
    ok('the skip link moves focus into the section it scrolls to');
  }
}

/* ── 17. An accessible name may add to the visible label, not replace it (WCAG 2.5.3) ── */
{
  const offenders = [];
  for (const el of doc.querySelectorAll('a[aria-label],button[aria-label],input[aria-label]')) {
    const visible = el.textContent.replace(/\s+/g, ' ').trim();
    if (!visible) continue;                 // icon-only: no visible label to contain
    const name = el.getAttribute('aria-label');
    if (!name.toLowerCase().includes(visible.toLowerCase())) {
      offenders.push(`"${name}" hides the visible "${visible}"`);
    }
  }
  offenders.length
    ? fail(`speech input cannot reach these: ${offenders.join('; ')}`)
    : ok('every control\'s accessible name contains its visible text');
}

/* ── 18. The tour is told to stop once the hero is off screen ── */
{
  // The page's other observer is checked without one of these on purpose (12),
  // so this needs its own DOM.
  const seen = [];
  const observed = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost:5173/landing',
    virtualConsole: vc,
    pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.IntersectionObserver = class {
        constructor(callback) { this.callback = callback; this.targets = []; seen.push(this); }
        observe(el) { this.targets.push(el); }
        unobserve(el) { this.targets = this.targets.filter(t => t !== el); }
        disconnect() { this.targets = []; }
      };
    },
  });
  const hero = observed.window.document.querySelector('.hero');
  const watcher = seen.find(o => o.targets.includes(hero));
  if (!watcher) {
    fail('nothing watches the hero: the tour keeps animating and restarting while the page is read');
  } else {
    const posted = [];
    const frame = observed.window.document.querySelector('.tour-frame');
    frame.contentWindow.postMessage = (data) => posted.push(data);
    watcher.callback([{ target: hero, isIntersecting: false }], watcher);
    watcher.callback([{ target: hero, isIntersecting: true }], watcher);
    const words = posted.map(p => p && p.repopulse);
    if (words.join() !== 'offscreen,onscreen') {
      fail(`the hero observer posted ${JSON.stringify(posted)}, wanted offscreen then onscreen`);
    } else {
      ok('the hero leaving view pauses the tour, and coming back resumes it');
    }
    // A one-shot observer would pause the tour and never resume it.
    if (!watcher.targets.includes(hero)) fail('the hero observer unobserves itself after the first pause');
  }
  observed.window.close();
}

/* ── 19. No styled attribute selector that nothing in the markup carries ── */
{
  const attrs = new Set();
  for (const m of cssNoComments.matchAll(/\[(data-[\w-]+)/g)) attrs.add(m[1]);
  // The class cross-reference in 8 only reads .class selectors, which is how a
  // dead [data-*] rule and its keyframes sat here unnoticed.
  const dead = [...attrs].filter(name => !doc.querySelector(`[${name}]`));
  dead.length
    ? fail(`styled but never in the markup: ${dead.map(a => `[${a}]`).join(', ')}`)
    : ok(`${attrs.size} data-attribute selectors, all of them reachable`);
}

/* ── 20. The closing section is a heading, and both Help controls behave alike ── */
{
  const cta = doc.querySelector('.cta');
  const labelled = doc.getElementById(cta.getAttribute('aria-labelledby'));
  if (!labelled || !/^H[1-6]$/.test(labelled.tagName)) {
    fail(`the closing section is labelled by a ${labelled ? `<${labelled.tagName.toLowerCase()}>` : 'missing element'}, leaving the outline ending at "So what?"`);
  } else {
    ok(`closing section headed by <${labelled.tagName.toLowerCase()}> "${labelled.textContent.trim()}"`);
  }
  const helps = [...doc.querySelectorAll('#help-button, [data-open-help]')];
  const quiet = helps.filter(el => el.getAttribute('aria-haspopup') !== 'dialog');
  quiet.length
    ? fail(`${quiet.length} of ${helps.length} Help controls do not announce the dialog they open`)
    : ok(`both Help controls announce aria-haspopup="dialog"`);
}

/* ── 21. Section order ── */
ok('sections: ' + [...doc.querySelectorAll('main > section')].map(s => s.id || s.className).join(' -> '));

test(`the landing page passes all ${notes.length + problems.length} structural checks`, () => {
  for (const note of notes) console.log('  ok  ' + note);
  assert.deepEqual(problems, [], `\n  !!  ${problems.join('\n  !!  ')}`);
});
