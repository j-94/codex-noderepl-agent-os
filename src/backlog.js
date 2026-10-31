'use strict';

const crypto = require('crypto');
const fs = require('fs');
const { hash, init, run, snapshot } = require('./core');
const { memfs, gate } = require('./tools');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function rolloutBenchmark({ count = 100, target = 'site/index.html' } = {}) {
  const events = [];
  for (let index = 0; index < count; index += 1) {
    const id = `candidate-${String(index + 1).padStart(3, '0')}`;
    events.push(
      memfs.write(
        `memfs://patches/${id}.json`,
        JSON.stringify({
          kind: 'patch_candidate.v0',
          id,
          target,
          rollback: 'discard memfs candidate cell',
          evidence: ['Agent OS virtual tape'],
          claim_boundary: 'virtual candidate only',
        }),
      ),
    );
  }
  events.push(gate.effect(['fs.write', target]));
  const started = performance.now();
  const machine = run(init(), events);
  return Object.freeze({
    kind: 'rollout_benchmark.v0',
    candidates_requested: count,
    virtual_candidates_stored: machine.mem.length,
    disk_writes: 0,
    gate_halted_on_unadmitted_effect: machine.halted === true && machine.head === count + 1,
    planned_effects: machine.effects.length,
    receipts: machine.receipts.length,
    elapsed_ms: Number((performance.now() - started).toFixed(3)),
    receipt_tail: hash(snapshot(machine)),
    claim_boundary:
      'Represents virtual patch candidates and halts an unadmitted fs.write inside Agent OS; not proof of patch quality or host-level enforcement.',
  });
}

function compressionProbe(path) {
  const bytes = fs.readFileSync(path);
  const artifactHash = sha256(bytes);
  const packet = Object.freeze({
    kind: 'executable_latent_program_ref.v0',
    artifact: path,
    cas: Object.freeze({
      algo: 'sha256',
      hash: artifactHash,
      bytes: bytes.length,
    }),
    op_tape: Object.freeze([
      Object.freeze(['read_cas', artifactHash]),
      Object.freeze(['project', 'static_artifact']),
      Object.freeze(['verify_hash', artifactHash]),
    ]),
    gate: Object.freeze({
      rollback: 'discard projection or restore previous artifact ref',
      evidence: Object.freeze(['sha256 source hash']),
      claim_boundary:
        'Reference/projection packet only; replay depends on exact bytes being present in filesystem or CAS.',
    }),
  });
  const packetBytes = Buffer.byteLength(JSON.stringify(packet));
  return Object.freeze({
    kind: 'compression_probe.v0',
    source_bytes: bytes.length,
    packet_bytes: packetBytes,
    ratio: Number((packetBytes / bytes.length).toFixed(4)),
    reduction_percent: Number(((1 - packetBytes / bytes.length) * 100).toFixed(2)),
    source_sha256: artifactHash,
    packet_sha256: sha256(JSON.stringify(packet)),
    packet,
    claim_boundary: packet.gate.claim_boundary,
  });
}

function platformPacket() {
  return Object.freeze({
    kind: 'platform_packet.v0',
    public_site: Object.freeze({
      target: 'Vercel',
      domain: 'j4cob.com',
      reason: 'static/public web surface with custom domain and preview deployments',
      secrets: 'provider settings only',
    }),
    talk_to_system: Object.freeze({
      target: 'Hugging Face Spaces',
      sdk: 'docker or gradio',
      reason: 'interactive demo/runtime where users can talk to the system',
      persistence: 'Space storage bucket or attached dataset, not repo credentials',
    }),
    gate: Object.freeze({
      decision: 'hold',
      rollback: 'remove deployment/project or point domain back to previous target',
      claim_boundary:
        'Architecture packet only; no deploy occurred and no credentials are stored here.',
    }),
  });
}

function siteLoadingReceipt(statuses = {}) {
  const entries = Object.entries(statuses).map(([path, status]) =>
    Object.freeze({ path, status, ok: Number(status) >= 200 && Number(status) < 400 }),
  );
  return Object.freeze({
    kind: 'site_loading_receipt.v0',
    entries: Object.freeze(entries),
    ok: entries.length > 0 && entries.every((entry) => entry.ok),
    claim_boundary:
      'HTTP status receipt only; visual quality and interaction still require browser verification.',
  });
}

function backlogReport({ artifactPath, statuses } = {}) {
  const report = {
    kind: 'backlog_materialization_report.v0',
    rollout: rolloutBenchmark(),
    platform: platformPacket(),
    site: siteLoadingReceipt(statuses),
    claim_boundary:
      'Local Agent OS materialization artifacts only; no cloud deploy, hosted SWE proof, or external effect proxy.',
  };
  if (artifactPath) report.compression = compressionProbe(artifactPath);
  return Object.freeze(report);
}

module.exports = {
  backlogReport,
  compressionProbe,
  platformPacket,
  rolloutBenchmark,
  siteLoadingReceipt,
};
