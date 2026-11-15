const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { JSDOM } = createRequire(path.resolve(__dirname, '../frontend/package.json'))('jsdom');

// Every HTML document the frontend serves: the SPA shell behind every app
// route, and the two static pages. A missing icon file is not a 404 in
// production — nginx's SPA fallback answers it with index.html — so the tab
// silently goes blank instead of anything failing loudly.
const FRONTEND = path.resolve(__dirname, '../frontend');
const PUBLIC = path.join(FRONTEND, 'public');
const DOCUMENTS = ['index.html', 'public/landing.html', 'public/tour.html'];

function iconHref(file) {
  const { document } = new JSDOM(fs.readFileSync(path.join(FRONTEND, file), 'utf8')).window;
  const links = [...document.querySelectorAll('link[rel~="icon"]')];
  assert.equal(links.length, 1, `${file} should declare exactly one icon`);
  return links[0].getAttribute('href');
}

for (const file of DOCUMENTS) {
  test(`${file} points at an icon file that exists`, () => {
    const href = iconHref(file);
    // Root-absolute, so it resolves the same from /repos/:id as from /.
    assert.match(href, /^\/[^/]/, `${file} icon href should be root-absolute, got ${href}`);
    const icon = path.join(PUBLIC, href);
    assert.ok(fs.existsSync(icon), `${file} points at ${href}, which is not in frontend/public`);
    assert.match(fs.readFileSync(icon, 'utf8'), /^<svg[\s>]/, `${href} should be an SVG`);
  });
}

test('every document shows the same icon', () => {
  const hrefs = new Set(DOCUMENTS.map(iconHref));
  assert.equal(hrefs.size, 1, `documents disagree: ${[...hrefs].join(', ')}`);
});
