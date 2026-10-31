'use strict';

const DEFAULT_THRESHOLD = 1;

function normalize(text) {
  return String(text || '').toLowerCase();
}

function scoreCard(input, card) {
  const text = normalize(input);
  const triggers = Array.isArray(card.triggers) ? card.triggers : [];
  return triggers.reduce((score, trigger) => {
    return text.includes(normalize(trigger)) ? score + 1 : score;
  }, 0);
}

function matchReflex(input, memory, options = {}) {
  const threshold = options.threshold || DEFAULT_THRESHOLD;
  const cards = memory && Array.isArray(memory.cards) ? memory.cards : [];
  const matches = cards
    .map((card) => ({ card, score: scoreCard(input, card) }))
    .filter((match) => match.score >= threshold)
    .sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id));
  const selected = matches[0] || null;
  return Object.freeze({
    input: String(input || ''),
    selected: selected ? selected.card : null,
    score: selected ? selected.score : 0,
    matches: Object.freeze(matches.map((match) => Object.freeze({
      id: match.card.id,
      score: match.score,
    }))),
  });
}

function packetFromMatch(match) {
  if (!match || !match.selected) {
    return Object.freeze({
      kind: 'turn0.reflex_packet.v0',
      status: 'hold',
      reason: 'no_reflex_match',
    });
  }
  return Object.freeze({
    kind: 'turn0.reflex_packet.v0',
    status: 'matched',
    reflex_id: match.selected.id,
    operators: Object.freeze([...(match.selected.operators || [])]),
    blocks: Object.freeze([...(match.selected.blocks || [])]),
    route: match.selected.route || '',
    score: match.score,
  });
}

module.exports = {
  matchReflex,
  packetFromMatch,
  scoreCard,
};
