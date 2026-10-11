// HQ #59: one office chat. Shared triage rules: the iPad (chat.js) and the box (tools/office-chat.mjs, called by the bridge)
// both import this file, so they always agree on what a message is. Plain ES module, no DOM, no network.
//
// triage(text, { to, near }) -> {
//   route: 'office' | 'grok',   office = free/cheap office bot answers (no Slack wake, no AI allowance);
//                               grok   = real order: filed as an HQ issue + Slack #hq-chat wake, the real Grok Bot (Michael) handles it
//   kind: 'cmd' | 'casual' | 'order',
//   cmds: [{ bot, act }],       safe in-game commands (always run on the iPad, even when the rest of the message is an order)
//   speaker: botId,             who answers in the office chat (for office route)
//   why: short reason }
// Safe in-game acts only (nothing outside the 3D office): move, cooler, desk, come, face, stop, wander, hush.
import { STATIONS } from './stations.js';

export const ACTS = {
  move:   { label: 'step out of the way', re: /\b(get out of (the|my) way|out of (the|my) way|move( it| over| aside| away)?|scoot( over)?|step aside|back (off|up)|give me (some )?(room|space)|beat it|shoo|make (some )?room|clear the way)\b/ },
  cooler: { label: 'go to the water cooler', re: /\b(water ?cooler|(get|grab|have) (some |a )?(water|drink)|go (get |grab )?(a )?drink|hydrate|water break)\b/ },
  desk:   { label: 'go to their desk', re: /\b((go|get|head) (back )?to (your|ur|their|his|her) desks?|back to (your )?desks?|back to work|get to work|sit down|take a seat|go sit( down)?|go work)\b/ },
  come:   { label: 'come over to you', re: /\b(come (here|over|to me|see me|with me)|over here|follow me|get over here)\b/ },
  face:   { label: 'turn and face you', re: /\b((look|turn|face) (at |to |towards? )?me|turn around|eyes on me)\b/ },
  hush:   { label: 'stop talking', re: /\b(stop talking|quiet( down)?|be quiet|shut up|shh+|hush|zip it|pipe down|no more (chatter|talking))\b/ },
  stop:   { label: 'stop and stay put', re: /\b(stop( moving| walking| there)?|freeze|stay( put| there| here)?|hold (it|still|up)|don'?t move|wait (there|here)|stand still)\b/ },
  wander: { label: 'go back to wandering', re: /\b(wander( around)?|walk around|roam|free roam|carry on|as you were|at ease|go (have fun|play|hang out)|you'?re free|dismissed)\b/ },
};
const ACT_ORDER = ['hush', 'move', 'cooler', 'desk', 'come', 'face', 'wander', 'stop']; // first match wins ("stop talking" = hush, not stop)

// Anything with these goes to the real Grok Bot (order / decision / real data / real work), even if it also has a command.
const ORDER = /\b(build|make|create|add|fix|change|update|remove|delete|deploy|ship|publish|send|e-?mail|text|call|buy|order|purchase|pay|book|schedule|remind|research|look ?up|find|check|review|write|draft|design|set ?up|install|connect|refresh|pull|show me|upload|download|post|reply|answer|cancel|approve|sign|file|fill|invoice|quote|price|budget|bank|money|account|password|login|log in|app|website|site|code|bug|feature|screen|board|widget|monitor|layout|model|logo|badge|mockup|shirt|tee|hat|order|task|project|plan|todo|to-do|asap|urgent|deadline|tomorrow|today|tonight|next week|status|progress|update|report|summary|how (do|does|much|many|long)|what('?s| is| are) (my|our|the|next)|when|where is|can you|could you|would you|will you|please|i need|i want|we need|let'?s|go ahead|do it|yes|no|confirm|picks?|choose)\b/i;

// Small talk the office bot can take (no order words left after commands/names are stripped).
const CASUAL = /^(hi|hello|hey|heya|yo|sup|howdy|hiya|gm|gn|good (morning|afternoon|evening|night)|morning|night|thanks?( you)?|thx|ty|appreciate (it|you)|lol|lmao|rofl|haha+|hehe+|ha|nice|cool|awesome|great|sweet|love it|love you( all| guys)?|good (job|work|stuff)|great (job|work)|well done|nailed it|you rock|you guys rock|bravo|cheers|ok(ay)?|k|sure|bye|later|see (ya|you)|good ?bye|night all|what'?s up|wh?at up|how( are|'re| r) (you|u|y'?all|ya|everyone|everybody)( doing)?|how'?s (it going|everyone|everybody|life|your day)|how( is|'s) (the )?(office|everyone)|who'?s hungry|tell (me |us )?a joke|joke|that'?s what she said|bears,? beets,? battlestar galactica|it'?s pretzel day|dance|sing( a song| something)?|party|happy (friday|monday|birthday)|what'?s good|how( was|'s) (your )?(weekend|lunch)|i'?m (back|here|bored|tired|hungry)|miss (you|me)|hello (everyone|everybody|all|team|office)|hey (everyone|everybody|all|team|guys|y'?all))\b/i;

const FORCE_GROK = /^\s*(@?grok\b[:,]?|\/grok\b|!grok\b|michael[:,]\s*(i need|please|can you))/i;
const FORCE_OFFICE = /^\s*(\/office|\/casual|!office)\b\s*/i;
const ALL = /\b(every(one|body)|all of you|y'?all|you all|team|guys|the office|whole office|people)\b/i;

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NAMES = STATIONS.map(s => ({ id: s.id, words: [s.name, s.name.split(' ')[0], s.short, s.bot].filter(Boolean).map(w => w.toLowerCase()) }));
const nameRe = new RegExp('\\b(' + [...new Set(NAMES.flatMap(n => n.words))].sort((a, b) => b.length - a.length).map(esc).join('|') + ')\\b', 'gi');
const idOfWord = w => NAMES.find(n => n.words.includes(w.toLowerCase()))?.id || null;
export const station = id => STATIONS.find(s => s.id === id);
export const idOf = who => { if (!who) return null; const w = String(who).toLowerCase().split(' · ')[0].trim(); if (STATIONS.some(s => s.id === w)) return w; return idOfWord(w) || NAMES.find(n => n.words.some(x => w.startsWith(x)))?.id || null; };
export const OFFICE_TO = 'Office'; // chat target meaning "the whole office" (no single bot)

export function triage(raw, { to = OFFICE_TO, near = null } = {}) {
  let text = String(raw || '').trim();
  if (FORCE_GROK.test(text)) return { route: 'grok', kind: 'order', cmds: [], speaker: 'grok', why: 'asked for Grok Bot by name' };
  const forceOffice = FORCE_OFFICE.test(text); if (forceOffice) text = text.replace(FORCE_OFFICE, '');
  const low = text.toLowerCase();
  const named = [...new Set([...low.matchAll(nameRe)].map(m => idOfWord(m[1])).filter(Boolean))];
  const toId = to && to !== OFFICE_TO ? idOf(to) : null;
  // commands: split on "and"/","/";" so "Phyllis move and Kevin go to your desk" gives two targets
  const cmds = [];
  for (const part of low.split(/\s*(?:[,;.!]|\band then\b|\bthen\b|\band\b)\s*/)) {
    const act = ACT_ORDER.find(a => ACTS[a].re.test(part)); if (!act) continue;
    let who = [...part.matchAll(nameRe)].map(m => idOfWord(m[1])).filter(Boolean);
    if (!who.length && ALL.test(part)) who = STATIONS.map(s => s.id);
    if (!who.length && named.length === 1) who = named;
    if (!who.length && toId && !station(toId)?.hero) who = [toId];
    if (!who.length) who = near ? [near] : [];
    for (const bot of who) if (!cmds.some(c => c.bot === bot && c.act === act)) cmds.push({ bot, act });
  }
  // what's left after removing names, command phrases and filler
  let rest = low.replace(nameRe, ' ');
  for (const a of Object.values(ACTS)) rest = rest.replace(new RegExp(a.re.source, 'gi'), ' ');
  rest = rest.replace(/\b(please|pls|plz|now|right now|ok(ay)?|hey|yo|tell|ask|have|get|go|can you|you|guys|everyone|everybody|all|and|then|the|a|to|him|her|them|out|of|way|my)\b/g, ' ')
    .replace(/[^a-z0-9'?]+/g, ' ').trim();
  const order = ORDER.test(rest) || /\d{3,}|https?:|@\w+\.\w/.test(text);
  const speaker = cmds[0]?.bot || named.find(id => !station(id)?.hero) || (toId && !station(toId)?.hero ? toId : null) || (near && !station(near)?.hero ? near : 'inbox');
  if (cmds.length && (!order || forceOffice)) return { route: 'office', kind: 'cmd', cmds, speaker, why: `in-game command (${cmds.map(c => c.act).join(', ')})` };
  if (cmds.length) return { route: 'grok', kind: 'order', cmds, speaker: 'grok', why: 'command + a real order' };
  const words = rest.split(/\s+/).filter(Boolean).length;
  const casual = forceOffice || (!order && (CASUAL.test(text.replace(nameRe, '').replace(/^[\s,!.]+/, '')) || CASUAL.test(text) || (words <= 5 && !text.includes('?'))));
  if (casual) return { route: 'office', kind: 'casual', cmds: [], speaker, why: forceOffice ? '/office prefix' : 'small talk' };
  return { route: 'grok', kind: 'order', cmds: [], speaker: 'grok', why: order ? 'real order / question' : 'not clearly small talk' };
}

// ---------- built-in in-character lines (free, offline). The box may swap casual replies for a free-model line. ----------
const ACK = {
  grok: ['You got it! That\'s what she said.', 'Michael Scott, on the move.', 'Consider it done. By me. The boss.'],
  inbox: ['Sure thing!', 'Oh! Okay.', 'On it.'], cos: ['Yep.', 'Sure, why not.', 'On it, boss.'],
  assist: ['Affirmative.', 'Executing. Flawlessly.', 'Done. Faster than you could have.'], icons: ['Nard Dog on it!', 'You got it, buddy!', 'Rit-dit-dit-doo, moving!'],
  onpad: ['Oh! Sorry, dear.', 'Okay, okay.', 'Of course, honey.'], builder: ['Fine.', 'Mm-hmm.', 'Whatever.'],
  faith: ['Fine. But I\'m not happy about it.', 'If I must.', 'Noted.'], broker: ['Sure. Reasonable request.', 'Okay.', 'Actually, fair.'],
  conn: ['Okay.', 'Kevin go.', 'Sure thing.'], review: ['Creed out.', 'Never saw me.', 'Done. Don\'t tell anyone.'],
  kids: ['Whatever you say.', 'Sure, babe.', 'Fine by me.'], designer: ['OMG, fine!', 'Okay, okay, going!', 'Literally on it.'],
  profile: ['Oh. Sorry. Moving.', 'Of course. Sorry.', 'Okay. Sorry.'],
};
const ACT_LINE = {
  move: ['Getting out of your way.', 'Moving over.', 'Scooting.'], cooler: ['Water cooler it is.', 'Going to grab some water.'],
  desk: ['Back to my desk.', 'Heading to my desk.'], come: ['Coming over.', 'Be right there.'], face: ['All eyes on you.', 'Yes?'],
  stop: ['Staying put.', 'Freezing right here.'], wander: ['Back to roaming.', 'Going for a walk around.'], hush: ['Zipping it.', 'Quiet. Got it.'],
};
const SPECIAL = { // a few hand-written ones
  'onpad:move': 'Oh! Sorry, dear. I was just telling Stanley about Bob. Moving.', 'builder:move': 'I was here first. ...Fine.',
  'assist:move': 'I am moving because I CHOOSE to move.', 'conn:cooler': 'Water? Is there a snack cooler?', 'cos:face': 'You rang?',
  'builder:hush': 'Gladly.', 'grok:hush': 'Fine. But I will be thinking very loud thoughts.', 'review:come': 'Who are you again? Coming.',
  'designer:hush': 'Ugh, fine, but I have SO much to say later.', 'kids:cooler': 'Water. Sure. "Water."',
};
const pick = (a, seed) => a[Math.abs(seed | 0) % a.length];
const seedOf = s => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return h; };
export function cmdLine(bot, act, seed = Date.now()) {
  return SPECIAL[bot + ':' + act] || `${pick(ACK[bot] || ACK.inbox, seed)} ${pick(ACT_LINE[act] || ['Okay.'], seed >> 3)}`;
}
const JOKES = ['Why did the scarecrow get promoted? He was outstanding in his field. Like me in paper.', 'I knew exactly what to do. But in a much more real sense, I had no idea what to do.',
  'Would I rather be feared or loved? Easy. Both.', 'I\'m not superstitious, but I am a little stitious.', 'Why don\'t copiers ever win arguments? They just repeat themselves.'];
const CASUAL_BY = {
  hi: { grok: 'Hey hey! The Scranton Strangler of fun is in the building!', inbox: 'Dunder Mifflin, this is Pam. Oh, hi!', cos: 'Hey. *looks at camera*', assist: 'Greetings. State your business.', icons: 'Heyyy! Nard Dog says hi!', onpad: 'Hi, sweetie!', builder: 'Mm.', faith: 'Hello.', broker: 'Hey, what\'s up?', conn: 'Hi. Snack?', review: 'Hi. Have we met?', kids: 'Heyyy!', designer: 'OMG hi!!', profile: 'Oh, hi. Sorry. Hi.' },
  thanks: { inbox: 'Aw, you\'re welcome!', cos: 'Anytime.', assist: 'Gratitude accepted.', icons: 'Anytime, big tuna!', onpad: 'You\'re so sweet.', builder: 'Mm-hmm.', faith: 'Obviously.', broker: 'No problem.', conn: 'Cool cool.', review: 'Don\'t mention it. Seriously.', kids: 'Sure thing.', designer: 'Aww, stop. Don\'t stop.', profile: 'Oh, thanks for thanking me.', grok: 'No, thank YOU. Hug it out?' },
  praise: { inbox: 'Thanks! Team effort.', cos: 'We try.', assist: 'Correct. I am excellent.', icons: 'Boom! Nard Dog delivers!', onpad: 'Oh, Bob would be proud.', builder: 'Don\'t make it a thing.', faith: 'Finally, some recognition.', broker: 'Appreciated, actually.', conn: 'Nice.', review: 'I\'ll take credit.', kids: 'Drinks on you then.', designer: 'I KNOW, right?!', profile: 'Wow. Nobody says that to me.', grok: 'World\'s best boss, confirmed.' },
  how: { inbox: 'Pretty good! Phones are quiet.', cos: 'Living the dream.', assist: 'Operating at peak efficiency.', icons: 'Fantastic! Like a Cornell reunion!', onpad: 'Oh, can\'t complain, dear.', builder: 'Counting down to five.', faith: 'Fine. Kevin is chewing loudly.', broker: 'Good, actually. Quiet day.', conn: 'Hungry.', review: 'Better than my parole officer.', kids: 'Hungover. Great!', designer: 'Literally amazing. Ask me why.', profile: 'Oh. Nobody asks. Okay, thanks.', grok: 'Fantastic. Best day ever. Every day.' },
  bye: { inbox: 'Bye! Have a good one.', cos: 'Later.', assist: 'Farewell. Stay vigilant.', icons: 'Peace out!', onpad: 'Bye, sweetie!', builder: 'Finally.', faith: 'Goodbye.', broker: 'See you.', conn: 'Bye.', review: 'You never saw me.', kids: 'Byeee.', designer: 'Bye! Text me!', profile: 'Bye. Sorry.', grok: 'Don\'t go! Okay, go.' },
};
export function casualLine(bot, text, seed = Date.now()) {
  const t = String(text || '').toLowerCase();
  const k = /joke|she said/.test(t) ? 'joke' : /\b(thanks?|thx|ty|appreciate)\b/.test(t) ? 'thanks' : /\b(bye|later|good ?night|night|see (ya|you)|gn)\b/.test(t) ? 'bye'
    : /\b(good (job|work|stuff)|great|nice|awesome|well done|nailed|rock|love|bravo)\b/.test(t) ? 'praise' : /\bhow\b|what'?s (up|good)|wh?at up/.test(t) ? 'how'
    : /\b(hi|hello|hey|heya|yo|sup|howdy|morning|gm)\b/.test(t) ? 'hi' : /pretzel/.test(t) ? 'pretzel' : /bears|beets/.test(t) ? 'beets' : 'other';
  if (k === 'joke') return pick(JOKES, seed);
  if (k === 'pretzel') return bot === 'builder' ? 'Pretzel day? Did I hear pretzel day?' : 'Stanley\'s going to lose it.';
  if (k === 'beets') return bot === 'assist' ? 'Bears. Beets. Battlestar Galactica. Correct.' : 'Identity theft is not a joke, Jim!';
  if (CASUAL_BY[k]) return CASUAL_BY[k][bot] || CASUAL_BY[k].inbox;
  return pick(['Ha. Totally.', 'Noted!', 'Ha, okay.', 'Love that.', 'Mm-hmm.'], seed);
}
