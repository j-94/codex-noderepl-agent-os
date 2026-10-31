'use strict';

const assert = require('assert');
const { DEFAULT_PACKET, normalizePacket, renderVirtualRoute } = require('../src/virtual_route');

{
  const route = normalizePacket(DEFAULT_PACKET);
  assert.strictEqual(route.kind, 'mer.virtual_route.v0');
  assert.strictEqual(route.route, '/');
  assert.strictEqual(route.gate.decision, 'hold');
}

{
  const rendered = renderVirtualRoute();
  assert.ok(rendered.html.includes('Agent OS for Codex'));
  assert.ok(rendered.html.includes('intent -> packet -> gate -> receipt'));
  assert.strictEqual(rendered.receipt.kind, 'virtual_route.receipt.v0');
  assert.strictEqual(rendered.receipt.route, '/');
  assert.strictEqual(rendered.receipt.effects.length, 0);
  assert.strictEqual(rendered.receipt.unsupported_sections.length, 0);
  assert.strictEqual(rendered.receipt.html_sha256.length, 64);
}

{
  const rendered = renderVirtualRoute({
    route: '/',
    sections: [{ kind: 'custom_html', body: '<script>alert(1)</script>' }],
  });
  assert.ok(rendered.html.includes('Unsupported section kind'));
  assert.deepStrictEqual(rendered.receipt.unsupported_sections, ['custom_html']);
  assert.strictEqual(rendered.receipt.effects.length, 0);
}

console.log('virtual route adapter test: ok');
