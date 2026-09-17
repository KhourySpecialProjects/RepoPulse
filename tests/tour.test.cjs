const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { JSDOM } = createRequire(path.resolve(__dirname, '../frontend/package.json'))('jsdom');
const source = fs.readFileSync(path.resolve(__dirname, '../frontend/public/tour.html'), 'utf8');

// The loop hold is the only timer measured in seconds; the walkthrough's beats
// are all well under a second, so this separates them without naming ids.
const LOOP_TIMER_MS = 10000;

function tour({ reducedMotion = false, embed = false } = {}) {
  const frames = new Map();
  const timers = new Map();
  let frameId = 0;
  let timerId = 0;
  const dom = new JSDOM(source, {
    url: `file:///tmp/tour.html${embed ? '?embed=1' : ''}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.matchMedia = () => ({ matches: reducedMotion, addEventListener() {} });
      window.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
      window.cancelAnimationFrame = id => frames.delete(id);
      window.setTimeout = (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; };
      window.clearTimeout = id => timers.delete(id);
    },
  });
  return {
    dom,
    document: dom.window.document,
    step(now) { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(now)); },
    active() { return dom.window.document.querySelector('.scene:not([hidden])')?.id; },
    visibleScenes() { return dom.window.document.querySelectorAll('.scene:not([hidden])').length; },
    // During the finale every panel is on screen for the ring, so "which scene
    // is the tour on" has to come from the chapter rail, not from visibility.
    current() { return [...dom.window.document.querySelectorAll('[data-scene]')].findIndex(button => button.hasAttribute('aria-current')); },
    playing() { return dom.window.document.documentElement.dataset.playing === 'true'; },
    // Pending restarts, and a way to reach the end of the hold on demand.
    loopsPending() { return [...timers.values()].filter(timer => timer.delay >= LOOP_TIMER_MS).length; },
    endHold() {
      for (const [id, timer] of [...timers]) {
        if (timer.delay < LOOP_TIMER_MS) continue;
        timers.delete(id);
        timer.callback();
      }
    },
    close() { dom.window.close(); },
  };
}

// Both sheets are minified with nested blocks inside their media queries, so
// the end of one cannot be found by looking for the next '}'. Count braces.
function atRule(css, prelude) {
  const start = css.indexOf(prelude);
  if (start === -1) return { inside: '', without: css };
  let depth = 0;
  for (let i = start + prelude.length - 1; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}' && (depth -= 1) === 0) {
      return { inside: css.slice(start, i + 1), without: css.slice(0, start) + css.slice(i + 1) };
    }
  }
  throw new Error(`unclosed block: ${prelude}`);
}

test('opens from a local file with readable content and one active scene', () => {
  const app = tour();
  try {
    assert.equal(app.active(), 'scene-0');
    assert.equal(app.document.querySelectorAll('.scene:not([hidden])').length, 1);
    assert.match(app.document.querySelector('h1').textContent, /Every project/);
    assert.ok(app.document.querySelector('#play'));
    assert.equal(app.document.querySelectorAll('script[src], link[rel="stylesheet"], img[src^="http"]').length, 0);
    assert.match(app.document.querySelector('.brand').textContent, /RepoPulse/);
    // The tour presents the product, not a caveat about its data.
    assert.doesNotMatch(app.document.body.textContent, /[Ii]llustrative/);
  } finally { app.close(); }
});

test('scene buttons and previous/next controls move predictably and pause autoplay', () => {
  const app = tour();
  try {
    app.document.querySelector('[data-scene="2"]').click();
    assert.equal(app.active(), 'scene-2');
    assert.equal(app.document.querySelector('[data-scene="2"]').getAttribute('aria-current'), 'step');
    assert.equal(app.document.querySelector('#play').getAttribute('aria-label'), 'Play tour');
    app.document.querySelector('#next').click();
    assert.equal(app.active(), 'scene-3');
    app.document.querySelector('#previous').click();
    assert.equal(app.active(), 'scene-2');
  } finally { app.close(); }
});

test('pauses without losing position, finishes on the final scene, and replays', () => {
  const app = tour();
  try {
    app.step(0); app.step(7000);
    assert.equal(app.active(), 'scene-1');
    app.document.querySelector('#play').click();
    const position = app.document.querySelector('#timeline').value;
    app.step(9000);
    assert.equal(app.document.querySelector('#timeline').value, position);
    app.document.querySelector('#play').click();
    app.step(10000); app.step(50000);
    assert.equal(app.current(), 4);
    // The sign-off gathers every panel into the ring around the wordmark.
    assert.equal(app.visibleScenes(), 5);
    assert.equal(app.document.querySelector('#play').getAttribute('aria-label'), 'Replay tour');
    app.document.querySelector('#play').click();
    assert.equal(app.active(), 'scene-0');
    assert.equal(app.visibleScenes(), 1);
  } finally { app.close(); }
});

test('seeking and keyboard controls work without stealing range-input keys', () => {
  const app = tour();
  try {
    const range = app.document.querySelector('#timeline');
    range.value = '24000';
    range.dispatchEvent(new app.dom.window.Event('input', { bubbles: true }));
    assert.equal(app.active(), 'scene-3');
    range.focus();
    range.dispatchEvent(new app.dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(app.active(), 'scene-3');
    range.blur();
    app.document.body.dispatchEvent(new app.dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    assert.equal(app.active(), 'scene-2');
    app.document.activeElement.dispatchEvent(new app.dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(app.active(), 'scene-3');
  } finally { app.close(); }
});

test('honors reduced motion with a readable paused opening scene', () => {
  const app = tour({ reducedMotion: true });
  try {
    assert.equal(app.document.querySelector('#play').getAttribute('aria-label'), 'Play tour');
    app.step(0); app.step(15000);
    assert.equal(app.active(), 'scene-0');
  } finally { app.close(); }
});

test('time spent in a hidden tab does not skip the tour on return', () => {
  const app = tour();
  try {
    app.step(0); app.step(2000);
    Object.defineProperty(app.document, 'hidden', { configurable: true, value: true });
    app.document.dispatchEvent(new app.dom.window.Event('visibilitychange'));
    app.step(100000);
    Object.defineProperty(app.document, 'hidden', { configurable: true, value: false });
    app.document.dispatchEvent(new app.dom.window.Event('visibilitychange'));
    app.step(101000);
    assert.equal(app.document.querySelector('#timeline').value, '2000');
  } finally { app.close(); }
});

test('chapter navigation brings the new scene into view on a narrow screen', () => {
  const app = tour();
  try {
    Object.defineProperty(app.dom.window, 'innerWidth', { value: 390 });
    let revealed = false;
    app.document.querySelector('#tour').scrollIntoView = () => { revealed = true; };
    app.document.querySelector('[data-scene="3"]').click();
    assert.equal(app.active(), 'scene-3');
    assert.equal(revealed, true);
    assert.equal(app.document.activeElement, app.document.querySelector('[data-scene="3"]'));
    app.document.querySelector('[data-scene="1"]').click();
    assert.equal(app.active(), 'scene-1');
    assert.equal(app.document.activeElement, app.document.querySelector('[data-scene="1"]'));
  } finally { app.close(); }
});

test('the activity plot matches its displayed total and peak', () => {
  const app = tour();
  try {
    const points = app.document.querySelector('#activity-line').getAttribute('points').split(' ').map(point => point.split(',').map(Number));
    const counts = points.map(([, y]) => Math.round((165 - y) / 4.3));
    assert.equal(counts.length, 30);
    assert.equal(counts.reduce((sum, count) => sum + count, 0), 412);
    assert.equal(Math.max(...counts), 31);
    assert.equal(counts.indexOf(31), 22);
  } finally { app.close(); }
});

test('embedded, the landing page supplies the header and the chapters are the only control', () => {
  const app = tour({ embed: true });
  try {
    assert.equal(app.document.documentElement.dataset.embed, 'true');
    // Hidden by CSS, not removed: render() still writes to the transport.
    const styles = [...app.document.querySelectorAll('style')].map(node => node.textContent).join('');
    assert.match(styles, /html\[data-embed="true"\] \.masthead,html\[data-embed="true"\] \.transport\{display:none\}/);
    assert.ok(app.document.querySelector('.masthead'));
    assert.ok(app.document.querySelector('#play'));
    assert.equal(app.document.querySelectorAll('[data-scene]').length, 5);

    // The reserved strip has to be the height of the header that covers it, at
    // every width. The landing page drops --head to 64px at 700px, so a single
    // hardcoded 72px leaves the tour's content 8px low on a phone.
    const landing = fs.readFileSync(path.resolve(__dirname, '../frontend/public/landing.html'), 'utf8');
    const narrow = {
      head: atRule(landing, '@media (max-width:700px){'),
      reserved: atRule(styles, '@media(max-width:700px){'),
    };
    const reserve = /html\[data-embed="true"\] \.shell\{padding-top:(\d+)px\}/;
    for (const [where, head, css] of [
      ['by default', 72, { head: narrow.head.without, reserved: narrow.reserved.without }],
      ['at 700px', 64, { head: narrow.head.inside, reserved: narrow.reserved.inside }],
    ]) {
      assert.equal(Number(/--head:(\d+)px/.exec(css.head)[1]), head,
        `the landing page's --head is not ${head}px ${where}`);
      const found = reserve.exec(css.reserved);
      assert.ok(found, `the tour reserves nothing for the header ${where}`);
      assert.equal(Number(found[1]), head,
        `the tour reserves ${found[1]}px for a ${head}px header ${where}`);
    }
  } finally { app.close(); }
});

test('embedded, the tour stops while the hero is scrolled out of view', () => {
  const app = tour({ embed: true });
  try {
    const offscreen = state => {
      // Only the parent frame may drive this, so the event has to carry a
      // source. jsdom's top-level window is its own parent, which is what the
      // tour compares against.
      app.dom.window.dispatchEvent(new app.dom.window.MessageEvent('message', {
        data: { repopulse: state },
        source: app.dom.window,
      }));
    };

    app.step(0); app.step(3000);
    assert.equal(app.document.querySelector('#timeline').value, '3000');

    // Out of view: the clock stops where it was, and the decorative CSS
    // animations — a 60s orbit, two pulses, the headline sheen — stop with it.
    offscreen('offscreen');
    assert.equal(app.document.documentElement.dataset.offscreen, 'true');
    app.step(90000);
    assert.equal(app.document.querySelector('#timeline').value, '3000',
      'the tour ran on while nobody could see it');
    const css = [...app.document.querySelectorAll('style')].map(node => node.textContent).join('');
    assert.match(css, /html\[data-offscreen="true"\] \*[^{]*\{animation-play-state:paused\}/);

    // Back in view: it picks up where it left off rather than skipping ahead.
    offscreen('onscreen');
    assert.equal(app.document.documentElement.dataset.offscreen, 'false');
    app.step(91000);
    app.step(92000);
    assert.equal(app.document.querySelector('#timeline').value, '4000');

    // A restart falling due off-screen waits, the way one in a hidden tab does.
    app.step(132000);
    assert.equal(app.loopsPending(), 1);
    offscreen('offscreen');
    app.endHold();
    assert.equal(app.loopsPending(), 1, 'the tour restarted out of view');
    assert.equal(app.current(), 4, 'the sign-off was thrown away unseen');

    // Anything else on the message bus is not a control signal.
    app.dom.window.dispatchEvent(new app.dom.window.MessageEvent('message', {
      data: { repopulse: 'onscreen' },
      source: null,
    }));
    assert.equal(app.document.documentElement.dataset.offscreen, 'true',
      'a message from an unknown source moved the tour');
  } finally { app.close(); }
});

test('embedded, nothing can scroll: the orbiting finale is clipped, not scrollable', () => {
  const app = tour({ embed: true });
  try {
    const styles = app.dom.window.getComputedStyle;
    assert.equal(styles(app.document.documentElement).overflow, 'hidden');
    assert.equal(styles(app.document.querySelector('.tour')).overflow, 'hidden');
    // Opened on its own the tour still scrolls normally.
    const alone = tour();
    try {
      assert.notEqual(alone.dom.window.getComputedStyle(alone.document.documentElement).overflow, 'hidden');
    } finally { alone.close(); }
  } finally { app.close(); }
});

test('embedded, a chapter click moves the tour without stranding it paused', () => {
  const app = tour({ embed: true });
  try {
    app.step(0); app.step(3000);
    app.document.querySelector('[data-scene="2"]').click();
    assert.equal(app.active(), 'scene-2');
    assert.equal(app.playing(), true);
    app.step(4000); app.step(6000);
    assert.equal(app.active(), 'scene-2');
    app.step(14000);
    assert.equal(app.active(), 'scene-3');
  } finally { app.close(); }
});

test('embedded, the finished tour holds the sign-off and then starts over', () => {
  const app = tour({ embed: true });
  try {
    app.step(0); app.step(50000);
    assert.equal(app.current(), 4);
    assert.equal(app.document.querySelector('#tour').dataset.finale, 'true');
    assert.equal(app.playing(), false);
    assert.equal(app.loopsPending(), 1);
    app.endHold();
    assert.equal(app.active(), 'scene-0');
    assert.equal(app.playing(), true);
    assert.equal(app.document.querySelector('#tour').dataset.finale, 'false');
    assert.equal(app.loopsPending(), 0);
  } finally { app.close(); }
});

test('embedded, a restart due in a background tab waits rather than running unseen', () => {
  const app = tour({ embed: true });
  try {
    app.step(0); app.step(50000);
    Object.defineProperty(app.document, 'hidden', { configurable: true, value: true });
    app.endHold();
    assert.equal(app.current(), 4);
    assert.equal(app.document.querySelector('#tour').dataset.finale, 'true');
    assert.equal(app.loopsPending(), 1);
    Object.defineProperty(app.document, 'hidden', { configurable: true, value: false });
    app.endHold();
    assert.equal(app.active(), 'scene-0');
  } finally { app.close(); }
});

test('embedded with reduced motion, nothing restarts on its own', () => {
  const app = tour({ reducedMotion: true, embed: true });
  try {
    app.document.querySelector('[data-scene="4"]').click();
    app.step(0); app.step(50000);
    assert.equal(app.loopsPending(), 0);
  } finally { app.close(); }
});

test('opened on its own, the tour keeps its transport and waits to be replayed', () => {
  const app = tour();
  try {
    app.step(0); app.step(50000);
    assert.equal(app.document.querySelector('#play').getAttribute('aria-label'), 'Replay tour');
    assert.equal(app.loopsPending(), 0);
    // And a chapter click still parks on the scene for a closer look.
    app.document.querySelector('[data-scene="1"]').click();
    assert.equal(app.playing(), false);
  } finally { app.close(); }
});

// The finale's ring is geometry no test can eyeball, so the numbers are pinned
// to the budget they were derived from — measured off the rendered tour in a
// 994px-tall window: ring cards keep their demo width of 640px and are capped at
// 520px tall, the wordmark lockup is 368px wide, and the header plus the chapter
// rail take 159px, leaving the ring a 418px half-height to work in. The ring is
// centred on the tour box, and a measured radius of 259px against a predicted
// 258px says the model is good to a few pixels, so the margin is 10.
const RING_BUDGET = { cardWidth: 640, tallestCard: 520, wordmarkHalf: 184, chrome: 159, margin: 10 };

function ringAt(expression, viewportHeight) {
  const [min, vmin, max] = expression;
  return Math.min(Math.max(min, (vmin / 100) * Math.min(1900, viewportHeight)), max);
}

test('the orbiting ring can never reach past the tour or cover the wordmark', () => {
  const app = tour({ embed: true });
  try {
    const css = [...app.document.querySelectorAll('style')].map(node => node.textContent).join('');
    const steps = [...css.matchAll(
      /@media\(min-height:(\d+)px\)\{html\[data-embed="true"\]\{--ring:clamp\((\d+)px,(\d+)vmin,(\d+)px\);--chip:(\.\d+)\}\}/g
    )].map(match => ({
      from: Number(match[1]),
      ring: [Number(match[2]), Number(match[3]), Number(match[4])],
      chip: Number(match[5]),
    }));
    assert.ok(steps.length >= 2, `expected height steps for the ring, found ${steps.length}`);
    // Only the AI card's keyframe is boosted, so read the factor from it.
    const boostMatch = /@keyframes settle-3\{[^}]*\}to\{[^}]*scale\(calc\(var\(--chip\) \* ([\d.]+)\)\)/.exec(css);
    assert.ok(boostMatch, 'the AI card no longer carries its own scale');
    const boost = Number(boostMatch[1]);
    assert.ok(boost > 1, 'the AI card boost is not a boost');
    // The AI card holds a header and one paragraph, so its box is given height
    // in the finale rather than being narrowed — narrowing would reflow it into
    // something other than what the tour just demonstrated.
    const boxMatch = /#scene-3 \.window\{min-height:(\d+)px\}/.exec(css);
    assert.ok(boxMatch, 'the AI card no longer gets its own height in the ring');
    const aiBox = Number(boxMatch[1]);
    const aspect = aiBox / RING_BUDGET.cardWidth;
    assert.ok(
      aspect >= 0.6 && aspect <= 0.85,
      `the AI card's ring aspect is ${aspect.toFixed(2)}, outside the other cards' 0.63-0.80`
    );
    // Each band must grow on the one below it, or it is not worth a
    // breakpoint. Measured as rendered width: the scale alone says nothing
    // without the width it multiplies.
    const base = /:root\{--ring:clamp\((\d+)px,(\d+)vmin,(\d+)px\);--chip:(\.\d+)\}/.exec(css);
    assert.ok(base, 'the base ring pair is gone');
    steps.reduce((previous, step) => {
      assert.ok(step.from > previous.from, 'ring bands are out of order');
      assert.ok(
        step.chip * RING_BUDGET.cardWidth > previous.chip * RING_BUDGET.cardWidth,
        `the band at ${step.from}px renders no wider than the one below it`
      );
      return step;
    }, { from: 0, chip: Number(base[4]) });

    for (const step of steps) {
      // Check each step at the height it starts at: the ring is smallest there
      // relative to the cards, so it is the worst case for both constraints.
      const ring = ringAt(step.ring, step.from);
      const available = (step.from - RING_BUDGET.chrome) / 2 - RING_BUDGET.margin;
      const reach = ring + (RING_BUDGET.tallestCard / 2) * step.chip;
      assert.ok(
        reach <= available,
        `at ${step.from}px tall the ring reaches ${Math.round(reach)}px, past the ${Math.round(available)}px available`
      );
      const clearance = ring - (RING_BUDGET.cardWidth / 2) * step.chip - RING_BUDGET.wordmarkHalf;
      assert.ok(
        clearance >= 0,
        `at ${step.from}px tall a card overlaps the wordmark by ${Math.abs(Math.round(clearance))}px`
      );
      // The AI card carries its own boost, so it is the widest in the ring and
      // the first to reach the wordmark. A graze is tolerated (it passes
      // behind the name); burying the lockup is not.
      const boosted = ring - (RING_BUDGET.cardWidth / 2) * step.chip * boost - RING_BUDGET.wordmarkHalf;
      assert.ok(
        boosted >= -8,
        `at ${step.from}px tall the boosted AI card covers the wordmark by ${Math.abs(Math.round(boosted))}px`
      );
      const boostedReach = ring + (aiBox / 2) * step.chip * boost;
      assert.ok(
        boostedReach <= available,
        `at ${step.from}px tall the boosted AI card reaches ${Math.round(boostedReach)}px, past ${Math.round(available)}px`
      );
    }
  } finally { app.close(); }
});

// Every label on a card has to be a label the app actually renders. Each entry
// is asserted twice: the literal must still exist in the component it came
// from, and it must appear on the card that depicts it. Rename it in the app
// and this fails, naming the card that has gone stale.
const APP = path.resolve(__dirname, '../frontend/src');
const CARD_LABELS = [
  // Collections — CollectionDetailPage header and RepoCard.
  ['scene-0', 'repositor', 'pages/CollectionDetailPage.tsx'],
  ['scene-0', 'contributor', 'components/RepoCard.tsx'],
  ['scene-0', 'reminder', 'components/RepoCard.tsx'],
  ['scene-0', 'GitHub', 'components/RepoCard.tsx'],
  ['scene-0', 'VS Code', 'components/RepoCard.tsx'],
  ['scene-0', 'Sync', 'components/RepoCard.tsx'],
  ['scene-0', 'Remove', 'components/RepoCard.tsx'],
  ['scene-0', 'At Risk', 'components/HealthBadge.tsx'],
  ['scene-0', 'Healthy', 'components/HealthBadge.tsx'],
  // Commits — the table in RepoDetailPage.
  ['scene-1', 'Author', 'pages/RepoDetailPage.tsx'],
  ['scene-1', 'Branch', 'pages/RepoDetailPage.tsx'],
  ['scene-1', 'Score', 'pages/RepoDetailPage.tsx'],
  ['scene-1', 'Classify commits', 'pages/RepoDetailPage.tsx'],
  ['scene-1', 'Commits per page', 'pages/RepoDetailPage.tsx'],
  ['scene-1', 'Previous', 'pages/RepoDetailPage.tsx'],
  ['scene-1', 'Good', 'components/CommitScorePill.tsx'],
  ['scene-1', 'OK', 'components/CommitScorePill.tsx'],
  ['scene-1', 'Bad', 'components/CommitScorePill.tsx'],
  // Signal balance — HealthSignalRadar, including its exact caption.
  ['scene-2', 'Signal balance', 'components/dashboard/HealthSignalRadar.tsx'],
  ['scene-2', 'Each signal scored out of 100, averaged across repos', 'components/dashboard/HealthSignalRadar.tsx'],
  ['scene-2', 'Weakest signal:', 'components/dashboard/HealthSignalRadar.tsx'],
  ['scene-2', 'Frequency', 'lib/dashboardInsights.ts'],
  ['scene-2', 'Msg Quality', 'lib/dashboardInsights.ts'],
  ['scene-2', 'Participation', 'lib/dashboardInsights.ts'],
  // AI card — the button, and the model the meta line cites.
  ['scene-3', 'Generate Summary', 'pages/RepoDetailPage.tsx'],
  ['scene-3', 'Generated ', 'pages/RepoDetailPage.tsx'],
  ['scene-3', 'claude-sonnet-4-6', 'pages/SettingsPage.tsx'],
  // Workspace pulse — the range toggle, the total's label and the footer.
  ['scene-4', 'Workspace pulse', 'components/dashboard/WorkspacePulseChart.tsx'],
  ['scene-4', '14d', 'components/dashboard/WorkspacePulseChart.tsx'],
  ['scene-4', '90d', 'components/dashboard/WorkspacePulseChart.tsx'],
  ['scene-4', 'commits in ', 'components/dashboard/WorkspacePulseChart.tsx'],
  ['scene-4', 'active days /', 'components/dashboard/WorkspacePulseChart.tsx'],
  ['scene-4', 'peak ', 'components/dashboard/WorkspacePulseChart.tsx'],
];

test('every card label is one the app renders, on the card that depicts it', () => {
  const app = new Map();
  const read = file => {
    if (!app.has(file)) app.set(file, fs.readFileSync(path.join(APP, file), 'utf8'));
    return app.get(file);
  };

  const dom = new JSDOM(source);
  try {
    for (const [sceneId, label, file] of CARD_LABELS) {
      assert.ok(
        read(file).includes(label),
        `"${label}" is no longer in ${file} — the app renamed it and ${sceneId} is stale`
      );
      const scene = dom.window.document.getElementById(sceneId);
      assert.ok(scene, `${sceneId} is missing`);
      assert.ok(
        scene.textContent.includes(label),
        `${sceneId} does not show "${label}" from ${file}`
      );
    }
  } finally { dom.window.close(); }
});

test('the cards invent nothing the app does not have', () => {
  const dom = new JSDOM(source);
  try {
    const text = dom.window.document.querySelector('.stage').textContent.replace(/\s+/g, ' ');
    // Each of these was on a card and belonged to no component: a fake shell
    // prompt, a parse counter, the per-signal bars, and metric tiles that live
    // in their own cards on the dashboard rather than inside the pulse chart.
    // Whole phrases, not words: "parsed" now appears in a commit message.
    for (const gone of ['git log --all', '1,284 parsed', 'History parsed locally', 'OF 1,284 SHOWN',
                        'healthy projects', 'need attention', 'repositories connected',
                        'Across 2 collections', 'Updated just now']) {
      assert.ok(!text.includes(gone), `"${gone}" is back on a card and belongs to no component`);
    }
  } finally { dom.window.close(); }
});

test('the ring shows the AI card as generated, not blank', () => {
  const app = tour({ embed: true });
  try {
    // Leaving the AI scene resets the card, so without help the ring would
    // assemble around an empty one.
    app.step(0); app.step(50000);
    assert.equal(app.document.querySelector('#tour').dataset.finale, 'true');

    const summary = app.document.getElementById('summary-text');
    const body = app.document.querySelector('.summary-body');
    assert.ok(summary.textContent.trim().length > 100, 'the summary is empty in the ring');
    assert.match(summary.textContent, /capstone-api/);
    assert.equal(summary.dataset.typing, 'false', 'the caret is still blinking in the ring');
    assert.equal(body.dataset.hasSummary, 'true', 'the meta line is still hidden in the ring');
    assert.match(
      app.document.querySelector('.summary-meta').textContent,
      /Generated Sep 15, 2026, 9:42 AM · claude-sonnet-4-6/
    );

    // And a replay puts it back to empty, ready to be typed again.
    app.document.querySelector('#play').click();
    assert.equal(app.document.getElementById('summary-text').textContent, '');
    assert.equal(app.document.querySelector('.summary-body').dataset.hasSummary, 'false');
  } finally { app.close(); }
});

test('the summary renders as markdown blocks, the way MarkdownContent does', () => {
  const app = tour({ embed: true });
  try {
    app.step(0); app.step(50000);
    const el = app.document.getElementById('summary-text');

    // Three sections, each a bold subheading over a paragraph.
    const headings = [...el.querySelectorAll('h3')].map(h => h.textContent);
    assert.deepEqual(headings, ['Project status', 'Activity patterns', 'Notable developments']);
    assert.equal(el.querySelectorAll('p').length, 3);
    // Blocks alternate heading, paragraph — no heading left without its text.
    assert.deepEqual(
      [...el.children].map(node => node.tagName.toLowerCase()),
      ['h3', 'p', 'h3', 'p', 'h3', 'p']
    );
    // Inline bold is rendered, not left as asterisks.
    assert.equal(el.querySelector('strong').textContent, '34/100');
    assert.ok(!el.textContent.includes('**'), 'bold markers leaked into the text');
    assert.ok(!el.textContent.includes('###'), 'heading markers leaked into the text');

    // The app types the markdown source, so a partial reveal is partial
    // markup: mid-type there are fewer blocks than at the end.
    const full = el.children.length;
    assert.equal(full, 6);
    app.document.querySelector('#play').click();   // replay, which retypes
    assert.equal(app.document.getElementById('summary-text').children.length, 0);
  } finally { app.close(); }
});

test('the background pulses behind the demo without touching the copy', () => {
  const app = tour({ embed: true });
  try {
    const d = app.document;
    const styles = app.dom.window.getComputedStyle;

    // Two rings in the fixed ambient layer, so they stay on the viewport's
    // centre through both the walkthrough and the finale. Parented to .stage
    // they tracked the demo column and then jumped to the tour's centre.
    const rings = [...d.querySelectorAll('.ambient > .pulse')];
    assert.equal(rings.length, 2);
    assert.equal(d.querySelectorAll('.stage .pulse').length, 0, 'a ring is still tied to the stage');
    assert.equal(styles(rings[1]).animationDelay, '3.5s', 'both rings beat in unison');

    for (const ring of rings) {
      assert.equal(styles(ring).left, '50%');
      assert.equal(styles(ring).top, '50%');
      // Inert, and invisible until the animation runs — so reduced motion
      // (which kills animations globally) leaves nothing behind.
      assert.equal(styles(ring).opacity, '0');
      assert.equal(styles(ring).pointerEvents, 'none');
      // A child at -1 would paint behind the ambient's own opaque background.
      assert.notEqual(styles(ring).zIndex, '-1');
    }
    // The whole layer is hidden from assistive tech, so the rings inherit it.
    assert.equal(d.querySelector('.ambient').getAttribute('aria-hidden'), 'true');

    // The halo breathes rather than sitting still.
    const css = [...d.querySelectorAll('style')].map(node => node.textContent).join('');
    assert.match(css, /\.stage:before\{[^}]*animation:halo-breathe/);
    assert.match(css, /@keyframes halo-breathe\{/);
    assert.match(css, /@keyframes pulse-out\{/);

    // Nothing tinted may sit under the intro copy: the layers are all inside
    // .stage or clipped to .ambient, never over the headline column.
    assert.ok(!/\.intro[^{]*\{[^}]*animation/.test(css), 'the copy column was given motion');

    assert.equal(styles(d.querySelector('.ambient')).overflow, 'hidden',
      'the expanding rings could add scrollable overflow');
  } finally { app.close(); }
});

test('the gradient headline moves, and its cycle has no seam or jump', () => {
  const app = tour({ embed: true });
  try {
    const d = app.document;
    const css = [...d.querySelectorAll('style')].map(node => node.textContent).join('');

    const rule = /(?:^|[};])h1 em\{([^}]*)\}/.exec(css);
    assert.ok(rule, 'the gradient headline rule is gone');
    const decl = rule[1];

    // Text painted through background-clip has nothing to animate on its own.
    // The only way it moves is by sliding an image wider than the box across
    // it, so the width of that image is what everything else is measured in.
    const tile = Number((/background-size:(\d+)% 100%/.exec(decl) || [])[1]);
    assert.ok(tile > 100, `background-size is ${tile || 'unset'}: nothing to slide`);
    assert.match(decl, /animation:text-sheen [\d.]+s [^;}]*infinite/);
    // The background shorthand resets size and position, so it has to come
    // first or the two declarations below it are thrown away.
    assert.ok(decl.indexOf('background:') < decl.indexOf('background-size:'),
      'background-size is set before the shorthand that resets it');

    const stops = /linear-gradient\(100deg,([^)]*)\)/.exec(decl)[1]
      .split(',').map(stop => stop.trim().split(/\s+/));
    // Tiled, the image's two ends meet. Different colours there drag a hard
    // edge through the letters once per cycle.
    assert.equal(stops[0][0], stops.at(-1)[0],
      'the gradient ends on a different colour than it starts: the tile seam shows');

    // The sheen sweeps every stop across every glyph, so a stop that is too
    // pale is not a highlight on one word — it is unreadable text, in turn,
    // everywhere. The headline is large text either way (40-65px at 650), so
    // the bar is WCAG AA's 3:1. indigo-300 is 1.91:1 and indigo-400 is 2.85:1;
    // both were in the gradient this replaced.
    const luminance = hex => {
      const channel = value => {
        const part = parseInt(value, 16) / 255;
        return part <= 0.03928 ? part / 12.92 : Math.pow((part + 0.055) / 1.055, 2.4);
      };
      const [r, g, b] = hex.replace('#', '').match(/\w\w/g).map(channel);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const against = (a, b) => {
      const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (light + 0.05) / (dark + 0.05);
    };
    const bg = /--bg:(#[0-9a-f]{6})/.exec(css)[1];
    for (const [colour] of stops) {
      const contrast = against(colour, bg);
      assert.ok(contrast >= 3,
        `the sheen sweeps ${colour} across the headline at ${contrast.toFixed(2)}:1 on ${bg}`);
    }

    // At rest — reduced motion, or the pause at the end of each cycle — the
    // first half of the tile is the gradient on its own: light, deep at 60% of
    // the element, mid at its end. Halved, because the tile is twice as wide.
    assert.deepEqual(stops.map(stop => stop[1]), ['0%', '30%', '50%', '72%', '100%']);
    assert.match(decl, /background-position:0% 50%/, 'the resting frame is not pinned');

    // Forced colours throws away every background-image that is not a url(),
    // which leaves -webkit-text-fill-color:transparent painting nothing at all.
    const forced = /@media ?\(forced-colors: ?active\)\{([^@]*?)\}\s*(?:@|$|\.|h1|html)/.exec(css);
    assert.ok(forced, 'no forced-colors fallback: the headline disappears in that mode');
    assert.match(forced[1], /-webkit-text-fill-color:currentColor/);

    // One whole tile per cycle, so the last frame paints the same pixels as
    // the first and the restart cannot be seen.
    const frames = /@keyframes text-sheen\{((?:[^{}]*\{[^{}]*\})+)\}/.exec(css);
    assert.ok(frames, 'the sheen keyframes are missing');
    const offsets = [...frames[1].matchAll(/background-position:(-?\d+)% 50%/g)]
      .map(match => Number(match[1]));
    assert.ok(offsets.length >= 2, 'a single keyframe cannot move anything');
    assert.equal(Math.abs(offsets[0] - offsets.at(-1)) % tile, 0,
      `the cycle moves ${offsets[0] - offsets.at(-1)}%, not a whole ${tile}% tile`);
    // A falling position slides the image right, so the light band travels the
    // way the line reads.
    assert.ok(offsets[0] > offsets.at(-1), 'the sheen runs against the reading direction');

    // Reduced motion is already covered by the sheet-wide switch, which is why
    // this rule carries no override of its own.
    assert.match(css, /prefers-reduced-motion:reduce\)\{\*,\*:before,\*:after\{animation:none!important/);
  } finally { app.close(); }
});

test('the summary has no leftover spacing around its bold or above its first heading', () => {
  const app = tour({ embed: true });
  try {
    app.step(0); app.step(50000);
    const d = app.document;
    const styles = app.dom.window.getComputedStyle;

    // renderInline gives bold weight and colour only. A chip with padding
    // around it reads as a gap before the punctuation that follows.
    const strong = d.querySelector('.summary strong');
    assert.equal(styles(strong).fontWeight, '600');
    // Unset shorthands come back as '' here, so check the longhands and treat
    // unset as zero rather than papering over it with a default.
    const zero = value => value === '' || value === '0px' || value === '0';
    for (const side of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) {
      assert.ok(zero(styles(strong)[side]), `bold has ${side} ${styles(strong)[side]}`);
    }
    const background = styles(strong).backgroundColor;
    assert.ok(
      background === '' || background === 'transparent' || background === 'rgba(0, 0, 0, 0)',
      `bold still has a background: ${background}`
    );

    // One leading for the block, so a 14px heading does not sit in a 27px
    // line box inherited from an older rule.
    assert.equal(styles(d.querySelector('.summary')).lineHeight, '1.55');
    const css = [...d.querySelectorAll('style')].map(node => node.textContent).join('');
    assert.ok(!/\.summary\{[^}]*line-height:1\.9/.test(css), 'the old 1.9 leading is back');

    // The element is class="window-body summary-body", so every generic
    // .window-body padding rule — six of them, five responsive — would
    // otherwise tie or outrank the summary's own and reinstate a 17-30px gap.
    // jsdom's fixed 1024px viewport cannot see those, so assert on the rules.
    const generic = css.match(/(?<![\w.:)-])\.window-body\{padding/g);
    assert.equal(generic, null, 'a .window-body padding rule can still land on the summary card');
    assert.match(css, /\.window \.summary-body\{padding:/);

    // Nothing stacked above the first heading: the header bar already
    // separates it, as CardHeader's padding does in the app.
    assert.equal(styles(d.querySelector('.summary h3')).marginTop, '0px');
    assert.match(styles(d.querySelector('.summary-body')).paddingTop, /^(0|[1-9]|1[0-4])px$/);
  } finally { app.close(); }
});
