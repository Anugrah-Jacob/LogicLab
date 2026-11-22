// Build step (no dependencies):  node scripts/build.mjs [--site=https://your-domain.com]
//  - generates the static learn pages (public/learn/*), sitemap.xml, robots.txt and llms.txt from js/examples.js
//  - sets your site URL in index.html (canonical, social tags, structured data) and in the generated files
//  - stamps asset URLs (?v=...) and the service-worker cache name so deployments are never served stale
// The site URL comes from --site=, the SITE_URL environment variable, or the value already in index.html.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (f) => fs.readFileSync(path.join(pub, f), 'utf8');
const write = (f, t) => {
  fs.mkdirSync(path.dirname(path.join(pub, f)), { recursive: true });
  fs.writeFileSync(path.join(pub, f), t);
};
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---- load the library and config exactly as the browser sees them ---- */
const sandbox = { window: {} };
sandbox.globalThis = sandbox.window;
vm.runInNewContext(read('js/examples.js') + '\n' + read('js/config.js'), sandbox);
const EX = sandbox.window.LOGICLAB_EXAMPLES,
  Net = sandbox.window.LogicLabNet,
  cfg = sandbox.window.LOGICLAB_CONFIG;

/* ---- site URL ---- */
let index = read('index.html');
const current = /<link\s+rel="canonical"\s+href="([^"]+?)\/?"\s*\/?>/.exec(index)[1];
const arg = process.argv.find((a) => a.startsWith('--site='));
const site = (arg ? arg.slice(7) : process.env.SITE_URL || current).replace(/\/+$/, '');
const today = new Date().toISOString().slice(0, 10);
const version = crypto
  .createHash('sha1')
  .update(['js/app.js', 'js/merge.js', 'js/collab.js', 'js/examples.js', 'js/config.js', 'js/ads.js', 'css/app.css'].map(read).join('\n'))
  .digest('hex')
  .slice(0, 8);

/* ---- learn pages ---- */
const pages = EX.filter((e) => e.learn);
function truthTable(e) {
  const net = Net();
  e.build(net);
  const ins = net.parts.filter((p) => p.type === 'IN'),
    outs = net.parts.filter((p) => p.type === 'LED');
  if (!e.check || !ins.length || ins.length > 5) return '';
  let rows = '';
  for (let m = 0; m < 1 << ins.length; m++) {
    const inp = {};
    ins.forEach((p, i) => {
      inp[p.id] = (m >> (ins.length - 1 - i)) & 1;
    });
    const want = e.check(inp);
    rows +=
      '<tr>' +
      ins.map((p) => '<td>' + inp[p.id] + '</td>').join('') +
      outs.map((p) => '<td><b>' + want[p.id] + '</b></td>').join('') +
      '</tr>';
  }
  return (
    '<h2>Truth table</h2><div class="scroll"><table><thead><tr>' +
    ins.map((p) => '<th>' + esc(p.name) + '</th>').join('') +
    outs.map((p) => '<th>' + esc(p.name) + '</th>').join('') +
    '</tr></thead><tbody>' +
    rows +
    '</tbody></table></div>'
  );
}
const shell = (o) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.desc)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${site}${o.path}">
<meta name="theme-color" content="#2563eb">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="article">
<meta property="og:site_name" content="LogicLab">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.desc)}">
<meta property="og:url" content="${site}${o.path}">
<meta property="og:image" content="${site}/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(o.ld)}</script>
<link rel="stylesheet" href="/css/learn.css?v=${version}">
</head>
<body>
<header class="lh"><a class="brand" href="/"><img src="/logo-mark.svg" alt="" width="38" height="33"><b>Logic<span>Lab</span></b></a><nav><a href="/learn/">Learn</a><a class="cta" href="/">Open the simulator</a></nav></header>
<main>${o.body}</main>
<footer>LogicLab: Digital Electronics Suite · free and open source (MIT)${cfg.repoUrl ? ' · <a href="' + esc(cfg.repoUrl) + '">Source code</a>' : ''}</footer>
<script defer src="/js/config.js?v=${version}"></script><script defer src="/js/ads.js?v=${version}"></script>
</body>
</html>
`;
const trim = (s, n) =>
  s.length <= n ? s : s.slice(0, s.lastIndexOf(' ', n - 1)).replace(/[,.;:]$/, '') + '…';
const crumbs = (name) => ({
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'LogicLab', item: site + '/' },
    { '@type': 'ListItem', position: 2, name: 'Learn', item: site + '/learn/' },
    ...(name ? [{ '@type': 'ListItem', position: 3, name }] : [])
  ]
});

for (const e of pages) {
  const sibs = pages.filter((x) => x.cat === e.cat && x.id !== e.id);
  const body = `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">LogicLab</a> › <a href="/learn/">Learn</a> › ${esc(e.title)}</nav>
<article>
<h1>${esc(e.title)}</h1>
<p class="lead">${esc(e.learn.what)}</p>
<img class="thumb" src="/thumbs/${e.id}.jpg" alt="Circuit diagram of the ${esc(e.title)}" width="720" height="450" loading="lazy">
<p><a class="btn" href="/?template=${e.id}">Open this circuit in LogicLab →</a></p>
<aside class="ad-slot" data-ad-slot="learn-top" hidden></aside>
<h2>Boolean expressions</h2>
<ul class="exprs">${e.expr.map((x) => '<li class="expr">' + esc(x) + '</li>').join('')}</ul>
${truthTable(e)}
<h2>How it works</h2>
<p>${esc(e.learn.how)}</p>
<h2>Try it yourself</h2>
<p>${esc(e.desc)} Open the circuit, click the switches to change the inputs, and watch the LEDs and the waveform panel respond. You can edit the circuit, convert it to NAND-only or NOR-only gates, and save or export your version.</p>
${sibs.length ? '<h2>Related circuits</h2><ul class="rel">' + sibs.map((s) => '<li><a href="/learn/' + s.id + '.html">' + esc(s.title) + '</a></li>').join('') + '</ul>' : ''}
<p><small>Reference: <a href="${esc(e.ref)}" rel="noopener">${esc(e.ref.replace('https://', ''))}</a></small></p>
<aside class="ad-slot" data-ad-slot="learn-bottom" hidden></aside>
</article>`;
  write(
    'learn/' + e.id + '.html',
    shell({
      title: trim(e.title + ': Truth Table, Circuit and Simulator', 62),
      desc: trim(e.learn.what + ' ' + e.learn.how, 158),
      path: '/learn/' + e.id + '.html',
      body,
      ld: [
        {
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: e.title,
          description: e.learn.what,
          image: site + '/thumbs/' + e.id + '.jpg',
          datePublished: today,
          dateModified: today,
          author: { '@type': 'Organization', name: 'LogicLab' },
          publisher: {
            '@type': 'Organization',
            name: 'LogicLab',
            logo: { '@type': 'ImageObject', url: site + '/icon-512.png' }
          },
          mainEntityOfPage: site + '/learn/' + e.id + '.html'
        },
        Object.assign({ '@context': 'https://schema.org' }, crumbs(e.title))
      ]
    })
  );
}
const cats = [...new Set(pages.map((e) => e.cat))];
write(
  'learn/index.html',
  shell({
    title: 'Learn Digital Electronics: Circuits and Truth Tables | LogicLab',
    desc: 'Short guides to adders, multiplexers, decoders, latches, flip-flops, counters and shift registers, each with a truth table and a circuit you can open and simulate.',
    path: '/learn/',
    ld: [Object.assign({ '@context': 'https://schema.org' }, crumbs(''))],
    body:
      `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">LogicLab</a> › Learn</nav><h1>Learn digital electronics</h1>
<p class="lead">Each guide explains one classic circuit, shows its truth table and Boolean expressions, and opens a working copy in the LogicLab simulator.</p>
<aside class="ad-slot" data-ad-slot="learn-top" hidden></aside>` +
      cats
        .map(
          (c) =>
            '<h2>' +
            esc(c) +
            '</h2><ul class="grid">' +
            pages
              .filter((e) => e.cat === c)
              .map(
                (e) =>
                  '<li><a href="/learn/' +
                  e.id +
                  '.html">' +
                  esc(e.title) +
                  '<small>' +
                  esc(trim(e.learn.what, 110)) +
                  '</small></a></li>'
              )
              .join('') +
            '</ul>'
        )
        .join('')
  })
);

/* ---- sitemap, robots, llms.txt ---- */
const urls = ['/', '/learn/', ...pages.map((e) => '/learn/' + e.id + '.html')];
write(
  'sitemap.xml',
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${site}${u}</loc><lastmod>${today}</lastmod></url>`).join('\n') +
    '\n</urlset>\n'
);
write(
  'robots.txt',
  `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin/\n\nSitemap: ${site}/sitemap.xml\n`
);
write(
  'llms.txt',
  `# LogicLab\n\n> LogicLab is a free, open-source digital electronics suite that runs in the browser: a logic circuit simulator with truth tables, waveforms, flip-flops, counters, schematic, transistor, breadboard and PCB views. It works offline.\n\n## Guides\n\n` +
    pages.map((e) => `- [${e.title}](${site}/learn/${e.id}.html): ${e.learn.what}`).join('\n') +
    `\n\n## App\n\n- [Open the simulator](${site}/)\n`
);

/* ---- site URL, asset versions, service worker cache name ---- */
index = index
  .split(current)
  .join(site)
  .replace(/\?v=[\w.]+/g, '?v=' + version);
write('index.html', index);
write('sw.js', read('sw.js').replace(/const V = '[^']*'/, "const V = 'll-" + version + "'"));
console.log(`built ${pages.length} learn pages for ${site} (assets v${version})`);
