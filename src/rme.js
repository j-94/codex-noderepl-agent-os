'use strict';

const { hash, freeze } = require('./core');

const POLICY = { version: 1, selection: 'whole-token-overlap', closure: 'all-support-or-skip', promotion: 'external-verifier-pass' };
const text = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${name}`);
  return value;
};
const tokens = (value) => new Set(value.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || []);
const node = (type, data) => ({ id: hash({ type, data }), type, data });
const seal = (body) => freeze({ ...body, hash: hash(body) });
const evidenceData = (value) => {
  if (!value || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('Invalid evidence sha256');
  return { path: text(value.path, 'evidence path'), sha256: value.sha256 };
};
const evidenceList = (values) => {
  if (!Array.isArray(values) || !values.length) throw new Error('Missing evidence');
  return values.map(evidenceData);
};

function dependencies(n) {
  const d = n.data;
  switch (n.type) {
    case 'observation': return [[d.task, 'observed_task'], ...d.evidence.map(id => [id, 'source'])];
    case 'verification': return [[d.observation, 'verifies'], ...d.evidence.map(id => [id, 'source'])];
    case 'lesson': return [[d.observation, 'learned_from'], [d.verification, 'verified_by'], [d.policy, 'selected_by']];
    case 'counterexample': return [[d.lesson, 'invalidates'], ...d.evidence.map(id => [id, 'source'])];
    default: return [];
  }
}

function edgesFor(nodes) {
  return nodes.flatMap(n => dependencies(n).map(([to, type]) => ({ from: n.id, to, type })));
}

function createRuliad({ purpose }) {
  const policy = node('policy', POLICY);
  return seal({ kind: 'agent_os.ruliad.v0', purpose: text(purpose, 'purpose'), policyId: policy.id, nodes: [policy], edges: [] });
}

function validateRuliad(graph) {
  if (!graph || graph.kind !== 'agent_os.ruliad.v0' || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('Invalid Ruliad');
  const { hash: digest, ...body } = graph;
  if (digest !== hash(body)) throw new Error('Ruliad integrity failure');
  text(graph.purpose, 'purpose');
  const index = new Map();
  for (const n of graph.nodes) {
    if (!n || n.id !== hash({ type: n.type, data: n.data }) || index.has(n.id)) throw new Error('Node integrity failure');
    index.set(n.id, n);
  }
  const requireType = (id, type) => {
    if (index.get(id)?.type !== type) throw new Error(`Missing or invalid ${type} support`);
    return index.get(id).data;
  };
  if (hash(requireType(graph.policyId, 'policy')) !== hash(POLICY)) throw new Error('Unsupported selection policy');
  for (const n of graph.nodes) {
    const d = n.data;
    if (!d || typeof d !== 'object') throw new Error('Invalid node data');
    switch (n.type) {
      case 'policy':
        if (n.id !== graph.policyId) throw new Error('Unsupported policy');
        break;
      case 'task': text(d.id, 'task id'); text(d.intent, 'task intent'); break;
      case 'evidence': evidenceData(d); break;
      case 'observation':
        text(d.summary, 'observation'); requireType(d.task, 'task');
        if (!Array.isArray(d.evidence) || !d.evidence.length) throw new Error('Missing observation evidence');
        d.evidence.forEach(id => requireType(id, 'evidence'));
        break;
      case 'verification':
        requireType(d.observation, 'observation');
        if (typeof d.passed !== 'boolean') throw new Error('Invalid verification result');
        text(d.verifier, 'verifier'); text(d.command, 'verification command');
        if (!Array.isArray(d.evidence) || !d.evidence.length) throw new Error('Missing verification evidence');
        d.evidence.forEach(id => requireType(id, 'evidence'));
        break;
      case 'lesson': {
        text(d.summary, 'lesson summary'); text(d.action, 'lesson action');
        if (!Array.isArray(d.terms) || !d.terms.length) throw new Error('Missing lesson terms');
        d.terms.forEach(term => { if (!tokens(text(term, 'term')).size) throw new Error('Empty term'); });
        requireType(d.observation, 'observation');
        const verification = requireType(d.verification, 'verification');
        if (!verification.passed || verification.observation !== d.observation || d.policy !== graph.policyId) throw new Error('Invalid lesson support');
        break;
      }
      case 'counterexample':
        requireType(d.lesson, 'lesson'); text(d.reason, 'counterexample reason');
        if (!Array.isArray(d.evidence) || !d.evidence.length) throw new Error('Missing counterexample evidence');
        d.evidence.forEach(id => requireType(id, 'evidence'));
        break;
      default: throw new Error('Unknown node type');
    }
  }
  if (hash(graph.edges) !== hash(edgesFor(graph.nodes))) throw new Error('Invalid dependency edges');
  return true;
}

function extend(graph, additions) {
  const nodes = [...graph.nodes];
  const ids = new Set(nodes.map(n => n.id));
  for (const n of additions) if (!ids.has(n.id)) { nodes.push(n); ids.add(n.id); }
  const { hash: ignored, ...body } = graph;
  const result = seal({ ...body, nodes, edges: edgesFor(nodes) });
  validateRuliad(result);
  return result;
}

// Verifier identity and evidence bytes must be checked by the native adapter.
// Content hashes provide integrity, not authenticity or independent judgment.
function recordExperience(graph, experience) {
  validateRuliad(graph);
  const { task, observation, verification, lesson } = experience;
  const t = node('task', { id: text(task.id, 'task id'), intent: text(task.intent, 'task intent') });
  const sources = evidenceList(experience.evidence).map(e => node('evidence', e));
  const o = node('observation', { task: t.id, summary: text(observation.summary, 'observation'), evidence: sources.map(e => e.id) });
  const checks = evidenceList(verification.evidence).map(e => node('evidence', e));
  const v = node('verification', { observation: o.id, passed: verification.passed, verifier: verification.verifier, command: verification.command, evidence: checks.map(e => e.id) });
  const additions = [t, ...sources, o, ...checks, v];
  if (verification.passed === true && lesson) additions.push(node('lesson', {
    summary: lesson.summary, action: lesson.action, terms: [...lesson.terms], observation: o.id, verification: v.id, policy: graph.policyId,
  }));
  return extend(graph, additions);
}

function invalidateLesson(graph, { lessonId, reason, evidence }) {
  validateRuliad(graph);
  const sources = evidenceList(evidence).map(e => node('evidence', e));
  return extend(graph, [...sources, node('counterexample', { lesson: lessonId, reason, evidence: sources.map(e => e.id) })]);
}

function selectRmeCut(graph, { intent, maxNodes = 32, excludeLessonIds = [] }) {
  validateRuliad(graph);
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || !Array.isArray(excludeLessonIds)) throw new Error('Invalid cut options');
  const query = tokens(text(intent, 'intent'));
  const excluded = new Set([...excludeLessonIds, ...graph.nodes.filter(n => n.type === 'counterexample').map(n => n.data.lesson)]);
  const index = new Map(graph.nodes.map(n => [n.id, n]));
  const selected = new Set([graph.policyId]);
  const lessonIds = [];
  const ranked = graph.nodes.filter(n => n.type === 'lesson' && !excluded.has(n.id)).map(n => ({
    n, score: [...tokens(n.data.terms.join(' '))].filter(term => query.has(term)).length,
  })).filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.n.id.localeCompare(b.n.id));
  for (const { n } of ranked) {
    const closure = new Set();
    const visit = id => {
      if (closure.has(id)) return;
      closure.add(id);
      dependencies(index.get(id)).forEach(([dependency]) => visit(dependency));
    };
    visit(n.id);
    if (new Set([...selected, ...closure]).size > maxNodes) continue;
    closure.forEach(id => selected.add(id));
    lessonIds.push(n.id);
  }
  const nodes = graph.nodes.filter(n => selected.has(n.id));
  return seal({ kind: 'agent_os.rme_cut.v0', graphHash: graph.hash, policyId: graph.policyId, intent, maxNodes, nodes, edges: edgesFor(nodes), lessonIds });
}

function renderRmeContext(cut) {
  const { hash: digest, ...body } = cut;
  if (digest !== hash(body) || cut.kind !== 'agent_os.rme_cut.v0') throw new Error('Cut integrity failure');
  validateRuliad(seal({ kind: 'agent_os.ruliad.v0', purpose: 'Validate closed cut', policyId: cut.policyId, nodes: cut.nodes, edges: cut.edges }));
  const index = new Map(cut.nodes.map(n => [n.id, n]));
  const lines = ['RME retained lessons (external evidence; current instructions take precedence):'];
  for (const id of cut.lessonIds) {
    const n = index.get(id);
    if (n?.type !== 'lesson') throw new Error('Invalid cut lesson');
    lines.push(`- ${n.data.summary}\n  Action: ${n.data.action}\n  Lesson: ${id}`);
  }
  if (!cut.lessonIds.length) lines.push('- No eligible retained lesson matched this query. Capability and history discovery have not been searched by this selector.');
  for (const n of cut.nodes.filter(n => n.type === 'evidence')) lines.push(`Evidence: ${n.data.path} sha256:${n.data.sha256}`);
  return lines.join('\n');
}

module.exports = { createRuliad, validateRuliad, recordExperience, selectRmeCut, renderRmeContext, invalidateLesson };
