'use strict';

const http = require('http');
const { hash } = require('./core');

const DEFAULT_ROUTE_KEY = 'memfs://j4cob/mer.virtual_route.intent';

const DEFAULT_PACKET = Object.freeze({
  kind: 'mer.virtual_route.v0',
  route: '/',
  meta: Object.freeze({
    title: 'Agent OS for Codex',
    description:
      'A control runtime that gives coding agents packets, gates, rollback, receipts, replay, and working memory.',
  }),
  sections: Object.freeze([
    Object.freeze({
      kind: 'hero',
      eyebrow: 'the missing control plane for coding agents',
      title: 'Agent OS for Codex.',
      body:
        'Codex is already a strong coding agent. Agent OS is the harness around it: a runtime that turns intent into packets, gates effects, records receipts, and carries working memory into the next run.',
      actions: Object.freeze([
        Object.freeze({
          label: 'View runtime',
          href: 'https://github.com/j-94/codex-noderepl-agent-os',
        }),
        Object.freeze({ label: 'Inspect proof cards', href: '#proof' }),
      ]),
    }),
    Object.freeze({
      kind: 'packet_flow',
      items: Object.freeze([
        Object.freeze(['User intent', 'A request becomes an explicit run packet instead of freeform tool use.']),
        Object.freeze(['PatchCard', 'The model compiles route, target files, tests, rollback, risk, and claim boundary.']),
        Object.freeze(['Gate', 'Effects hold until evidence, rollback, scope, and admission are present.']),
        Object.freeze(['Receipt', 'Every admitted run leaves a replayable trace for later review and reuse.']),
      ]),
    }),
    Object.freeze({
      kind: 'proof_cards',
      id: 'proof',
      title: 'Proof Cards',
      cards: Object.freeze([
        Object.freeze(['Patch throughput', '10,000 unified patch artifacts in roughly 0.22-0.24s.']),
        Object.freeze(['Fast planning', 'No-model answer-card p50 about 0.0037s; patch-card p50 about 0.0027s.']),
        Object.freeze(['Routing evidence', 'Scoped tensor bakeoff: learned transition tensor 12/12.']),
        Object.freeze(['Public wedge', 'Codex supplies the coding agent. Agent OS supplies gates, receipts, and replay.']),
      ]),
    }),
    Object.freeze({
      kind: 'runtime_objects',
      id: 'runtime',
      title: 'Runtime',
      rows: Object.freeze([
        Object.freeze(['RunPacket', 'Intent, route, state refs, candidates, gate state, and claim boundary.']),
        Object.freeze(['PatchCard', 'Target files, tests, rollback, risk flags, evidence handles, and next action.']),
        Object.freeze(['VMAdmission', 'Short-lived permission over allowed paths, allowed ops, rollback, and receipts.']),
        Object.freeze(['Receipt', 'Packet hash, state hashes, effects, tests, result, rollback ref, and boundary.']),
      ]),
    }),
    Object.freeze({
      kind: 'claim_boundary',
      id: 'boundary',
      title: 'Claim Boundary',
      body:
        'This proves the Agent OS can render a bounded virtual route from an in-memory packet. It does not prove production deploy, model superiority, SWE correctness, or host-level mechanical enforcement.',
    }),
  ]),
  gate: Object.freeze({
    decision: 'hold',
    rollback: `drop ${DEFAULT_ROUTE_KEY}`,
    claim_boundary: 'in-memory route proof only',
  }),
});

const ALLOWED_SECTIONS = Object.freeze([
  'hero',
  'packet_flow',
  'proof_cards',
  'runtime_objects',
  'claim_boundary',
  'receipt_panel',
]);

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function normalizePacket(packet = DEFAULT_PACKET) {
  if (!packet || typeof packet !== 'object') throw new Error('route packet must be an object');
  if (!packet.route || typeof packet.route !== 'string') throw new Error('route packet requires route');
  const meta = packet.meta && typeof packet.meta === 'object' ? packet.meta : {};
  const sections = Array.isArray(packet.sections) ? packet.sections : [];
  return Object.freeze({
    kind: packet.kind || 'mer.virtual_route.v0',
    route: packet.route,
    meta: Object.freeze({
      title: meta.title || 'Agent OS for Codex',
      description: meta.description || 'In-memory virtual route rendered by Agent OS.',
    }),
    sections: Object.freeze(sections.map((section) => Object.freeze({ ...section }))),
    gate: Object.freeze({
      decision: packet.gate?.decision || 'hold',
      rollback: packet.gate?.rollback || 'drop in-memory packet',
      claim_boundary: packet.gate?.claim_boundary || 'in-memory route proof only',
    }),
  });
}

function sectionAllowed(section) {
  return Boolean(section && ALLOWED_SECTIONS.includes(section.kind));
}

function renderSection(section) {
  if (!sectionAllowed(section)) {
    return `<section class="section"><h2>Held Section</h2><p>Unsupported section kind: ${escapeHtml(section?.kind || 'missing')}</p></section>`;
  }
  if (section.kind === 'hero') {
    const actions = (section.actions || [])
      .map((action) => `<a class="button" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>`)
      .join('');
    return [
      '<section class="hero">',
      '<div class="copy">',
      `<div class="eyebrow">${escapeHtml(section.eyebrow || '')}</div>`,
      `<h1>${escapeHtml(section.title || '')}</h1>`,
      `<p class="lead">${escapeHtml(section.body || '')}</p>`,
      `<nav class="actions">${actions}</nav>`,
      '</div>',
      '</section>',
    ].join('');
  }
  if (section.kind === 'packet_flow') {
    const items = (section.items || [])
      .map(([label, body]) => `<div class="node"><b>${escapeHtml(label)}</b><span>${escapeHtml(body)}</span></div>`)
      .join('');
    return `<section class="viewer"><div class="viewer-head"><span>intent -> packet -> gate -> receipt</span><span>virtual</span></div><div class="flow">${items}</div></section>`;
  }
  if (section.kind === 'proof_cards') {
    const cards = (section.cards || [])
      .map(([label, body]) => `<div class="card"><b>${escapeHtml(label)}</b><span>${escapeHtml(body)}</span></div>`)
      .join('');
    return `<section class="section" id="${escapeHtml(section.id || '')}"><h2>${escapeHtml(section.title || '')}</h2><div class="cards">${cards}</div></section>`;
  }
  if (section.kind === 'runtime_objects') {
    const rows = (section.rows || [])
      .map(([label, body]) => `<div class="row"><b>${escapeHtml(label)}</b><span>${escapeHtml(body)}</span></div>`)
      .join('');
    return `<section class="section" id="${escapeHtml(section.id || '')}"><h2>${escapeHtml(section.title || '')}</h2><div class="rows">${rows}</div></section>`;
  }
  if (section.kind === 'claim_boundary') {
    return `<section class="section" id="${escapeHtml(section.id || '')}"><h2>${escapeHtml(section.title || 'Claim Boundary')}</h2><p>${escapeHtml(section.body || '')}</p></section>`;
  }
  return '';
}

function stylesheet() {
  return [
    ':root{color-scheme:dark;--bg:#07080a;--ink:#f5f7f2;--muted:#9aa39d;--line:#25302b;--green:#4cffac;--amber:#ffd36e;--soft:#dce5dd}',
    '*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);color:var(--ink);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}a{color:inherit;text-decoration:none}',
    '.topbar{min-height:58px;display:flex;align-items:center;justify-content:space-between;padding:0 clamp(18px,4vw,54px);border-bottom:1px solid var(--line);position:sticky;top:0;background:rgba(7,8,10,.92)}.brand,.eyebrow,h2,.node b,.card b{color:var(--green)}',
    '.nav,.lead,p,.node span,.card span,.row span,footer{color:var(--muted)}.nav{display:flex;gap:14px;font-size:12px}.hero{min-height:calc(78svh - 58px);display:grid;align-content:center;border-bottom:1px solid var(--line)}',
    '.copy,.section{padding:clamp(26px,5vw,72px)}.copy{display:grid;gap:22px}.actions{display:flex;flex-wrap:wrap;gap:10px}.button{border:1px solid var(--green);padding:13px 15px;background:rgba(76,255,172,.06)}',
    'h1{margin:0;font-size:clamp(44px,8.2vw,104px);line-height:.88;letter-spacing:0}.lead{max-width:850px;font-size:clamp(15px,1.7vw,20px);line-height:1.55}.viewer,.section{border-bottom:1px solid var(--line)}',
    '.viewer-head{padding:12px 14px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;color:var(--muted);font-size:12px}.flow,.cards,.rows{display:grid;gap:10px;padding:clamp(18px,3vw,34px)}',
    '.node,.card,.row{border:1px solid var(--line);background:rgba(255,255,255,.025);padding:14px}.node,.row{display:grid;grid-template-columns:170px 1fr;gap:14px}.cards{grid-template-columns:repeat(4,minmax(0,1fr))}',
    'h2{margin:0 0 20px;font-size:clamp(22px,3.5vw,42px)}p,.node span,.card span,.row span{line-height:1.6;font-size:13px}footer{padding:18px clamp(24px,5vw,72px);font-size:12px}',
    '@media(max-width:980px){.cards{grid-template-columns:1fr}.node,.row{grid-template-columns:1fr}.nav{display:none}}',
  ].join('');
}

function renderVirtualRoute(packet = DEFAULT_PACKET, { source = DEFAULT_ROUTE_KEY } = {}) {
  const route = normalizePacket(packet);
  const body = route.sections.map(renderSection).join('');
  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(route.meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(route.meta.description)}">`,
    `<style>${stylesheet()}</style>`,
    '</head>',
    '<body>',
    '<header class="topbar"><div class="brand">j4cob / Agent OS</div><nav class="nav"><a href="#proof">proof</a><a href="#runtime">runtime</a><a href="#boundary">boundary</a></nav></header>',
    '<main>',
    body,
    '</main>',
    '<footer>Rendered from an in-memory mer.virtual_route.v0 packet. Files are export targets, not source of truth.</footer>',
    '</body>',
    '</html>',
  ].join('');
  const receipt = Object.freeze({
    kind: 'virtual_route.receipt.v0',
    route: route.route,
    source,
    renderer: 'bounded_section_renderer.v0',
    allowed_sections: ALLOWED_SECTIONS,
    rendered_sections: route.sections.length,
    unsupported_sections: route.sections.filter((section) => !sectionAllowed(section)).map((section) => section.kind),
    html_sha256: hash(html),
    packet_sha256: hash(route),
    effects: Object.freeze([]),
    gate: route.gate,
    claim_boundary:
      'In-memory virtual route render only; no filesystem write, merjs binary build, HTTP deploy, or host-level effect proxy proof.',
  });
  return Object.freeze({ html, receipt, packet: route });
}

function startVirtualRouteServer({ packet = DEFAULT_PACKET, port = 4321, host = '127.0.0.1' } = {}) {
  const rendered = renderVirtualRoute(packet);
  const server = http.createServer((req, res) => {
    if (req.url === '/__receipt.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(`${JSON.stringify(rendered.receipt, null, 2)}\n`);
      return;
    }
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(rendered.html);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found\n');
  });
  server.listen(port, host);
  return Object.freeze({
    server,
    receipt: rendered.receipt,
    url: `http://${host}:${port}/`,
    receipt_url: `http://${host}:${port}/__receipt.json`,
  });
}

module.exports = {
  ALLOWED_SECTIONS,
  DEFAULT_PACKET,
  DEFAULT_ROUTE_KEY,
  normalizePacket,
  renderVirtualRoute,
  startVirtualRouteServer,
};
