// HQ #58: tiny local tone check for what Chris says to a teammate. No AI, no network, same code on the box
// (tools/worker-memory.mjs) and in the office (talk.js). score: -1 (harsh) .. +1 (kind). Simple word lists on purpose.
const HARSH = [
  /\b(stupid|idiot\w*|dumb\w*|moron\w*|useless|worthless|pathetic|incompetent|lazy|clueless|brainless)\b/,
  /\b(trash|garbage|crap\w*|junk|sucks?|sucked|terrible|awful|horrible|worst|lame|ugly|hideous|disgusting)\b/,
  /\b(hate|shut up|go away|get lost|screw you|piss\w*|annoying|ridiculous|embarrassing|disappointing|disappointed)\b/,
  /\b(you'?re fired|fire you|replace you|what is wrong with you|wtf|wth|ffs|damn\w*|hell no|bs)\b/,
  /\b(f+u+c+k\w*|sh[i1]t\w*|ass(hole)?|bitch\w*|bastard)\b/,
  /\b(not good enough|do better|try again\W*idiot|can'?t do anything|never works|so slow|too slow|you suck|you failed|failure)\b/,
];
const KIND = [
  /\b(thanks?|thank you|thx|ty|appreciate\w*|grateful)\b/,
  /\b(great|awesome|amazing|perfect|excellent|fantastic|brilliant|wonderful|beautiful|gorgeous|lovely|cute|cool|nice|sweet)\b/,
  /\b(love\w*|good job|great job|nice work|well done|nailed it|proud|impressive|impressed|genius|you rock|legend|best)\b/,
  /\b(please|sorry|my bad|no worries|no rush|take your time|good morning|good night|hello|hi there)\b/,
];
const KIND_EMOJI = /(❤|♥|😍|🥰|😊|🙂|😄|😁|🙏|👍|👏|🎉|💯|⭐|🌟|🔥)/u, HARSH_EMOJI = /(😡|🤬|😠|🖕|👎|💩|🙄|😒)/u;

export function scoreTone(text) {
  const raw = String(text || ''), t = raw.toLowerCase();
  if (!t.trim()) return { score: 0, tone: 'neutral', hits: [] };
  let neg = 0, pos = 0; const hits = [];
  for (const r of HARSH) { const m = t.match(r); if (m) { neg++; hits.push('-' + m[0]); } }
  for (const r of KIND) { const m = t.match(r); if (m) { pos++; hits.push('+' + m[0]); } }
  if (HARSH_EMOJI.test(raw)) { neg++; hits.push('-emoji'); }
  if (KIND_EMOJI.test(raw)) { pos++; hits.push('+emoji'); }
  // shouting: mostly caps words, or a pile of !!! next to a harsh word
  const words = raw.match(/[A-Za-z]{3,}/g) || [], caps = words.filter(w => w === w.toUpperCase()).length;
  if (words.length >= 3 && caps / words.length > 0.6) { neg += 0.5; hits.push('-caps'); }
  if (/!{3,}/.test(raw) && neg) neg += 0.5;
  // "not bad" / "not great" flips
  if (/\bnot (bad|terrible|awful)\b/.test(t)) { neg = Math.max(0, neg - 1); pos += 0.5; }
  if (/\bnot (good|great|nice|cool|perfect)\b/.test(t)) { pos = Math.max(0, pos - 1); neg += 1; }
  // politeness words alone ("please") shouldn't outweigh an insult
  const score = Math.max(-1, Math.min(1, (pos * 0.45) - (neg * 0.6)));
  const tone = score <= -0.3 ? 'harsh' : score >= 0.3 ? 'kind' : 'neutral';
  return { score: Math.round(score * 100) / 100, tone, hits };
}
// relationship label from a running score (-1..1)
export const relLabel = r => r <= -0.45 ? 'hurt' : r <= -0.15 ? 'wary' : r >= 0.45 ? 'fond' : r >= 0.15 ? 'warm' : 'neutral';
