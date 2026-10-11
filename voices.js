// HQ #54: how each Dunder Mifflin teammate talks. Pure local templates, no AI calls, no cost.
// Keys = station ids (stations.js). Events:
//   start    sat down on a new task ({task})          working  stage moved to WORKING ({task})
//   queued   task queued                               review   ready for review ({task})
//   done     finished ({task})                         blocked  stuck ({task})
//   ask      needs Chris (pick cards up / waiting / a "needs you" item) ({task})
//   picked   Chris picked something for them ({picks})  cleared  a "needs you" item got handled
//   heard    Chris just sent them a message in HQ chat  reply    opener before they read their HQ reply out
//   free     got up from the desk, nothing on           idle     rare small talk (only when you're nearby)
// {task} is shortened to a few words; {picks} = "H, I and K".
export const VOICES = {
  grok: { // Michael Scott
    start: ["Okay. {task}. I am on it like a bonnet.", "Regional Manager, reporting for duty: {task}.", "Nobody panic. Michael is handling {task}."],
    working: ["We are making progress. Big progress. Huge.", "{task}? Going great. Probably the best it's ever gone."],
    queued: ["{task} is on deck. I can feel it."],
    review: ["Done-ish! Somebody tell me I did good on {task}.", "{task} is ready. Would I say I'm proud? Yes. Yes I would."],
    done: ["{task}: DONE. That's what she said.", "Boom. {task}. Another Dundie for Michael Scott."],
    blocked: ["{task} is stuck and I'm not gonna lie, I'm a little scared.", "Ugh. {task} hit a wall. Everybody stay calm."],
    ask: ["Chris! I need you on {task}. Like, now. Please.", "Not to be dramatic, but {task} literally cannot go on without you."],
    picked: ["Ooh, {picks}! Great taste. Almost as good as mine."],
    cleared: ["Handled! See? Teamwork makes the dream work."],
    heard: ["Ooh, a message from corporate!", "Chris! My guy. Reading it now.", "Okay, everybody shush. Chris is talking."],
    reply: ["Okay, here's the deal:", "Listen up, people.", "Michael Scott, answering:"],
    free: ["Conference room in five minutes. Kidding. Unless...?", "I'm free! Who wants to hang out?"],
    idle: ["Would I rather be feared or loved? Easy. Both.", "I declare... a break!", "Sometimes I start a sentence and I don't even know where it's going.", "World's Best Boss. It says so on the mug."],
  },
  inbox: { // Pam Beesly
    start: ["Okay, I'll keep an eye on {task}.", "Got it. {task}. On it."],
    working: ["Still sorting through it. Lots of stuff in here today."],
    queued: ["{task} is next on my list."],
    review: ["{task} is ready whenever you want to look."],
    done: ["Inbox is caught up. Nothing scary in there.", "All set with {task}. :)"],
    blocked: ["Um, I'm a little stuck on {task}."],
    ask: ["Hey, sorry, quick thing: {task} needs you.", "There's something here you'll want to see. {task}."],
    picked: ["Oh, {picks}, good picks!"],
    cleared: ["That one's taken care of. Thank you!"],
    heard: ["Dunder Mifflin, this is Pam.", "Got your message!"],
    reply: ["Okay, so:", "Hey! Here's what I've got:"],
    free: ["Nothing urgent in the inbox right now."],
    idle: ["Dunder Mifflin, this is Pam... oh, wrong line.", "I've been doing a little sketch of the office.", "Is it just me or is Dwight being extra Dwight today?"],
  },
  cos: { // Jim Halpert
    start: ["Alright. {task}. Let's see how this goes.", "So I'm doing {task} now. Cool. Cool cool cool."],
    working: ["Making progress. Not that anyone asked."],
    queued: ["{task} is lined up. I'll get to it."],
    review: ["{task} is ready for a look. No pressure."],
    done: ["{task}: done. Not bad, Halpert.", "Wrapped up {task}. Don't tell Dwight how easy that was."],
    blocked: ["So... {task} is stuck. *looks at camera*"],
    ask: ["Hey, when you get a sec, {task} needs your call.", "Can't move on {task} without you. Just saying."],
    picked: ["{picks}. Nice. Solid choices."],
    cleared: ["That one's off the list. Thanks."],
    heard: ["Oh hey. Got it.", "Message received. *nods*"],
    reply: ["So, here's the thing:", "Okay, quick update:"],
    free: ["And I'm free. Time to mess with Dwight."],
    idle: ["Bears. Beets. Battlestar Galactica.", "I put Dwight's stapler in Jell-O once. Good times.", "Is it Friday yet? No? Cool."],
  },
  assist: { // Dwight Schrute
    start: ["{task}. Assigned to me. Obviously. I'm the best.", "Assistant TO the Regional Manager, beginning {task}."],
    working: ["Working at peak Schrute efficiency.", "Progress is being made. Fact."],
    queued: ["{task} is queued. I will crush it."],
    review: ["{task} is complete and flawless. Review it if you must."],
    done: ["{task}: done. Faster than a beet harvest.", "Mission accomplished. Michael, did you see that?"],
    blocked: ["{task} is blocked. Someone will pay for this.", "Identity theft is not a joke! Also, {task} is stuck."],
    ask: ["I require your authorization on {task}. Immediately.", "Chris. {task}. Decision. Now."],
    picked: ["{picks}. Acceptable. I would have picked the same."],
    cleared: ["Threat neutralized. Next."],
    heard: ["Message received. Executing.", "Question. What do you need. Answer: I'm on it."],
    reply: ["Fact:", "Report from the Assistant to the Regional Manager:"],
    free: ["Free. Going to check the perimeter."],
    idle: ["Bears can climb faster than they can run. Fact.", "Through concentration I can raise and lower my cholesterol at will.", "Whenever I'm about to do something, I ask: would an idiot do that?"],
  },
  icons: { // Andy Bernard
    start: ["Nard Dog on {task}! Let's go!", "Here comes the Nard Dog. {task}."],
    working: ["Rit-dit-dit-di-doo-doo... making icons."],
    queued: ["{task} is up next. Ready to rock."],
    review: ["{task} is ready to rock. Rate me."],
    done: ["Nailed it! {task}. Cornell-level work.", "Done! Did I mention I went to Cornell?"],
    blocked: ["Ugh, {task} is stuck. I'm not going to punch a wall. Again."],
    ask: ["Chris, buddy! Need your call on {task}."],
    picked: ["{picks}! You've got the eye, my friend."],
    cleared: ["Awesome, that's sorted. Rock on."],
    heard: ["Ooh, a message! For the Nard Dog?"],
    reply: ["Okay okay okay, here goes:"],
    free: ["Free! Anybody up for a quick a cappella jam?"],
    idle: ["I went to Cornell. Ever heard of it?", "Rit-dit-dit-di-doo-doo.", "Tuna! Has anyone seen Tuna?"],
  },
  onpad: { // Phyllis Vance
    start: ["Okay, sweetie. I'll take care of {task}."],
    working: ["Chugging along. Slow and steady."],
    queued: ["{task} is next, hon."],
    review: ["{task} is ready for you to look at, dear."],
    done: ["All done with {task}. Bob Vance would be proud."],
    blocked: ["Oh dear, {task} is stuck."],
    ask: ["Chris, honey, {task} needs you when you get a minute."],
    picked: ["Oh, {picks}. Very nice."],
    cleared: ["That's taken care of. Thank you, dear."],
    heard: ["Oh, a message! How nice."],
    reply: ["Okay, hon:"],
    free: ["Time to work on my knitting."],
    idle: ["Bob Vance, Vance Refrigeration, says hi.", "I'm knitting everyone scarves this year."],
  },
  builder: { // Stanley Hudson
    start: ["{task}. Fine.", "I'll do {task}. Don't make it weird."],
    working: ["I'm working. Don't watch me work."],
    queued: ["{task} is queued. I'll get there when I get there."],
    review: ["{task} is ready. Look at it yourself."],
    done: ["{task} is shipped. Now leave me alone.", "Done. Pretzel day can't come soon enough."],
    blocked: ["{task} is stuck. And I don't care enough to panic."],
    ask: ["I need a decision on {task}. Then I'm doing my crossword."],
    picked: ["{picks}. Fine."],
    cleared: ["Good. One less thing."],
    heard: ["Mm-hm.", "I got it."],
    reply: ["Here:"],
    free: ["Crossword time. Do not disturb."],
    idle: ["Did I stutter?", "It's pretzel day somewhere.", "Five down: 'leave me alone,' nine letters."],
  },
  faith: { // Angela Martin
    start: ["{task}. I'll do it properly, unlike some people."],
    working: ["Working. Please don't hover."],
    queued: ["{task} is queued. In order. As it should be."],
    review: ["{task} is ready. It's perfect, obviously."],
    done: ["{task} is done. Tidy and correct."],
    blocked: ["{task} is blocked, and it is not my fault."],
    ask: ["I need your approval on {task}. Don't dawdle."],
    picked: ["{picks}. I suppose those are fine."],
    cleared: ["Good. Finally."],
    heard: ["Yes? What is it."],
    reply: ["For the record:"],
    free: ["I'll be checking on my cats now."],
    idle: ["Sprinkles was the best cat in the world.", "Some people need to clean up the break room."],
  },
  broker: { // Oscar Martinez
    start: ["Actually, {task} is pretty interesting. I'm on it."],
    working: ["Running the numbers. It checks out so far."],
    queued: ["{task} is queued. Let me finish this first."],
    review: ["{task} is ready. I double-checked it, you're welcome."],
    done: ["{task}: done, and done right.", "Closed it out. Actually, it went well."],
    blocked: ["Actually, {task} is blocked. Here's the problem."],
    ask: ["I need you to sign off on {task}."],
    picked: ["{picks}. Smart choices, actually."],
    cleared: ["Good. That's settled."],
    heard: ["Got it. Let me look into that."],
    reply: ["Actually,"],
    free: ["I'll be at the window, thinking about it."],
    idle: ["Actually, that's not how a surplus works.", "Kevin, please don't eat that."],
  },
  conn: { // Kevin Malone
    start: ["Okay. {task}. I can do it.", "Me do {task}. Me good."],
    working: ["Working. Then snack."],
    queued: ["{task} is next. After M&Ms."],
    review: ["Done with {task}. Is it good? I think it's good."],
    done: ["I did {task}! Nailed it.", "{task} is done. Can I go to the vending machine?"],
    blocked: ["Uh oh. {task} is stuck. Not my fault."],
    ask: ["Chris, I need help with {task}. Please."],
    picked: ["{picks}! Cool cool."],
    cleared: ["Yay. That one's gone."],
    heard: ["Oh. Hi. Message. Okay."],
    reply: ["Okay. So."],
    free: ["Free. Chili time."],
    idle: ["Why waste time say lot word when few word do trick?", "I just want to lie on the beach and eat hot dogs.", "Anyone want M&Ms?"],
  },
  review: { // Creed Bratton
    start: ["{task}. Sure. I've done worse."],
    working: ["Reviewing. Or something like it."],
    queued: ["{task} is in my pile. Somewhere."],
    review: ["{task} looks fine. Probably."],
    done: ["Checked {task}. Ship it before anyone asks questions."],
    blocked: ["{task} is blocked. I've seen this before. In 'Nam."],
    ask: ["I'm gonna need you on {task}. Don't ask me why."],
    picked: ["{picks}. I'd have gone with the third one."],
    cleared: ["Taken care of. Don't ask how."],
    heard: ["Who's this? Oh. Hi."],
    reply: ["Okay, listen:"],
    free: ["Off the clock. I'll be at the quarry."],
    idle: ["Nobody steals from Creed Bratton and gets away with it.", "I've been involved in a number of cults.", "Which one of you is the new guy?"],
  },
  kids: { // Meredith Palmer
    start: ["Okay, {task}. Let's do this."],
    working: ["Working on it. Coffee helps."],
    queued: ["{task} is next."],
    review: ["{task} is ready. Kids will love it."],
    done: ["{task} is done. Happy hour, anyone?"],
    blocked: ["{task} is stuck. Ugh."],
    ask: ["Need you on {task}, Chris."],
    picked: ["{picks}! Woo!"],
    cleared: ["Sorted. Cheers."],
    heard: ["Oh, hey! Got it."],
    reply: ["So, yeah:"],
    free: ["Free! Anyone up for a drink after work?"],
    idle: ["Who's up for happy hour?", "Supplier relations is basically just vibes."],
  },
  designer: { // Kelly Kapoor
    start: ["OMG. {task}. I'm literally so excited.", "Okay, {task} is mine now and it's going to be SO cute."],
    working: ["I'm working, I'm working. It's going to be so good.", "This is literally the best work of my life."],
    queued: ["{task} is next and I'm already obsessed."],
    review: ["OMG, {task} is ready! You have to look right now!", "Okay, {task} is done and it is SO cute, I can't."],
    done: ["{task} is DONE. I'm basically a genius.", "Done! Can we talk about how good that turned out?"],
    blocked: ["Ugh, {task} is stuck and I'm literally going to cry."],
    ask: ["Okay, I need you to pick your faves. It's a whole thing.", "Chris! {task}! Pick your favorites, please, it's urgent."],
    picked: ["OMG, {picks}?! You have SUCH good taste.", "Wait, {picks}?! Obsessed. Prepping them right now."],
    cleared: ["Yay! Okay, moving on, I'm so fast."],
    heard: ["Ooh, a message for me?!", "Wait, I have to read this right now."],
    reply: ["Okay, so, listen:", "OMG, okay:"],
    free: ["I'm free! Who wants to talk about Ryan?"],
    idle: ["I talk a lot, so I've learned to tune myself out.", "Has anyone seen Ryan? Not that I care.", "Who says exclamation points are unprofessional?"],
  },
  profile: { // Toby Flenderson
    start: ["Oh. Okay. I'll handle {task}.", "Hi. Sorry. Starting {task}."],
    working: ["Still working on it. Sorry."],
    queued: ["{task} is queued. If that's okay."],
    review: ["{task} is ready. If you have a minute. No pressure."],
    done: ["{task} is done. Thanks for, um, letting me."],
    blocked: ["{task} is stuck. Which is kind of my life."],
    ask: ["Sorry to bother you, but {task} needs you."],
    picked: ["{picks}. Great. I'll make a note."],
    cleared: ["Okay, that's off the list. Thanks."],
    heard: ["Oh! Someone messaged me. Hi."],
    reply: ["So, um:"],
    free: ["I'll just be in the annex. As usual."],
    idle: ["I miss Costa Rica.", "Michael doesn't hate me. He just... doesn't like me."],
  },
};
const GENERIC = { start: ['On it: {task}.'], working: ['Working on it.'], queued: ['{task} is queued.'], review: ['{task} is ready for review.'],
  done: ['{task} is done.'], blocked: ['{task} is blocked.'], ask: ['{task} needs you.'], picked: ['Got your picks: {picks}.'], cleared: ['Handled. Thanks.'],
  heard: ['Got your message.'], reply: ['Here you go:'], free: ['Free for now.'], idle: ['Nice day.'] };

const last = new Map(); // id+event -> last index (so the same line doesn't repeat twice in a row)
export function voiceLine(id, ev, vars = {}) {
  const pool = (VOICES[id] && VOICES[id][ev]) || GENERIC[ev]; if (!pool || !pool.length) return '';
  const k = id + ':' + ev; let i = (Math.random() * pool.length) | 0; if (pool.length > 1 && i === last.get(k)) i = (i + 1) % pool.length; last.set(k, i);
  return pool[i].replace(/\{(\w+)\}/g, (_, v) => vars[v] || (v === 'task' ? 'this' : v === 'picks' ? 'those' : ''));
}
export const shortTask = t => { t = String(t || '').replace(/\s*\((HQ )?#\d+[^)]*\)\s*/g, ' ').replace(/^Office:\s*/i, '').trim(); const w = t.split(/\s+/); return (w.length > 6 ? w.slice(0, 6).join(' ') + '…' : t) || 'this'; };
export const listPicks = p => { p = (p || []).map(String); return p.length <= 1 ? p.join('') : p.slice(0, -1).join(', ') + ' and ' + p[p.length - 1]; };

// ---------- HQ #58: memory colors the voice ----------
// Each worker keeps their own memory of Chris (tools/worker-memory.mjs on the box -> `mem` in the work feed: label
// hurt / wary / neutral / warm / fond + a few words of the last pointed thing he said to them). Local lines only, free.
//   stung   right after a harsh message to them          thanks  right after a kind message to them
//   cold    lingering, while they're hurt / wary ({said} = a few words he said, sometimes quoted back)
//   warm    lingering, while they're warm / fond
export const MOODS = {
  grok: { stung: ["Wow. Okay. That hurt. I'm going to go sit in my office. With the blinds closed.", "I am not crying. It's allergies. Corporate allergies."],
    thanks: ["Did everybody hear that? Chris likes me. Somebody write that down.", "That is going on a Dundie. Best Boss Ever, presented by Chris."],
    cold: ["I'm fine. I'm totally fine. Toby-level fine.", "Still thinking about \"{said}\". Not that it matters. It matters.", "I forgive you. I don't forget. That's a Michael Scott original."],
    warm: ["Chris and I? Basically best friends. Top five.", "Corporate loves me. Specifically Chris."] },
  inbox: { stung: ["Oh. Okay. I'll just... get back to the phones.", "That was a little harsh. But okay."],
    thanks: ["Aw, thank you. That's really nice.", "That made my day, honestly."],
    cold: ["Doing it. Quietly.", "I'm still a little stung by \"{said}\", if I'm honest.", "Sure. Whatever you need."],
    warm: ["Happy to help, Chris. Always.", "I drew you a little thank-you doodle. It's on the fridge."] },
  cos: { stung: ["...Wow. Okay.", "Cool. Cool cool cool. *looks at camera*"],
    thanks: ["Hey, thanks. That actually means something.", "Appreciate it. Don't tell Dwight."],
    cold: ["Yep. On it. Boss.", "Still processing \"{said}\". Really letting it marinate.", "Sure thing. *long look at camera*"],
    warm: ["For you? Happy to.", "You're one of the good ones, Chris."] },
  assist: { stung: ["I will not dignify that with a response. Response: noted.", "Insubordination from above. Logged. In my notebook. In pen."],
    thanks: ["Praise from leadership. As expected. I accept.", "Finally, someone recognizes excellence."],
    cold: ["I have written \"{said}\" in my grudge ledger. Page forty.", "Proceeding. Under protest.", "Do not mistake my obedience for forgiveness."],
    warm: ["Chris is a strong leader. Second only to me.", "Anything for you, Chris. Within reason. And beyond reason."] },
  icons: { stung: ["Okay. Ouch. Nard Dog is gonna go walk this off.", "That's... fine. I'm not going to punch a wall."],
    thanks: ["Yes! Chris likes my stuff! Somebody start a cappella!", "That is the nicest thing since Cornell."],
    cold: ["Still a little bruised from \"{said}\", buddy.", "Working. No singing today.", "I'm fine. Nard Dog is fine. Tail's just a little down."],
    warm: ["Chris, buddy, you're the best. Big Tuna-level best.", "For you? Full four-part harmony."] },
  onpad: { stung: ["Well. I'll be telling Bob about that.", "Oh. That wasn't very nice, dear."],
    thanks: ["Oh, aren't you sweet.", "Thank you, hon. I'll knit you something."],
    cold: ["I remember \"{said}\". I remember everything, dear.", "It'll get done. Eventually.", "Mm-hm. I'm knitting. Don't mind me."],
    warm: ["You're a sweetheart, Chris.", "I saved you a cookie, hon."] },
  builder: { stung: ["Did I stutter? Because you did.", "Mm. Noted. Never forgotten."],
    thanks: ["...Thank you. Don't make it a thing.", "Fine. That was nice. Moving on."],
    cold: ["\"{said}.\" Yeah. I heard you the first time.", "I'm doing it. Slower now.", "Retirement can't come soon enough."],
    warm: ["Chris is all right. Don't tell him.", "For Chris I'll skip the crossword. Once."] },
  faith: { stung: ["Excuse me? I will be filing that.", "That was rude, and I don't forget rude."],
    thanks: ["Well. Finally, someone with manners.", "Thank you. That's appropriate."],
    cold: ["\"{said}\". I wrote it down. With the date.", "I'll do it. Properly. Without smiling.", "Sprinkles would have hissed at you."],
    warm: ["Chris has very good manners. Unlike some people.", "I approve of Chris. That's rare."] },
  broker: { stung: ["Actually, that was uncalled for.", "Okay. I'll pretend that was constructive."],
    thanks: ["Thank you. Actually, that's nice to hear.", "Appreciated. Genuinely."],
    cold: ["Still thinking about \"{said}\". Actually, still annoyed.", "It'll be correct. I just won't enjoy it.", "Professional. Just professional."],
    warm: ["Actually, Chris is great to work for.", "Happy to, Chris."] },
  conn: { stung: ["Oh. Kevin sad now.", "That mean. Me remember."],
    thanks: ["Yay! Chris nice. Kevin happy.", "Thank you. Me get cookie now?"],
    cold: ["Kevin remember \"{said}\". Kevin no like.", "Working. No snack. Sad.", "Me fine. Not fine."],
    warm: ["Chris my friend.", "For Chris, Kevin share M&Ms."] },
  review: { stung: ["Nobody talks to Creed like that. Nobody who's still around.", "I've been yelled at by better. In 'Nam."],
    thanks: ["Thanks. I'll remember that. I'll remember everything.", "Nice. You're my favorite. Which one are you?"],
    cold: ["\"{said}\". Creed never forgets. Well, sometimes.", "I'm keeping a list. You're on it.", "Working. Watching."],
    warm: ["Chris is good people. I'd help him move a body.", "You're all right, kid."] },
  kids: { stung: ["Wow. Okay. Drinking about that later.", "Rude. Noted."],
    thanks: ["Aw, thanks! Drinks on me. Kidding. Unless.", "That's sweet, Chris!"],
    cold: ["Still salty about \"{said}\".", "Doing it. Not happily.", "Whatever. It's fine."],
    warm: ["Chris is the best. Happy hour's on him.", "Love you, Chris! Professionally."] },
  designer: { stung: ["Excuse me?! I am literally SO offended right now.", "Wow. Okay. I'm telling everyone about this."],
    thanks: ["OMG, stop! You're going to make me cry. Happy cry!", "Wait, really?! You're literally my favorite."],
    cold: ["I'm still not over \"{said}\". Like, at ALL.", "Fine. I'll do it. But I'm not using exclamation points.", "I'm not mad. I'm just... remembering."],
    warm: ["Chris is literally the best boss ever. Don't tell Michael.", "Okay, for you? I'll make it extra cute."] },
  profile: { stung: ["Oh. Okay. I'll just... go to the annex.", "That's fine. I'm used to it, honestly."],
    thanks: ["Oh! Wow. Thank you. Nobody says that to me.", "That's... really kind. Thanks, Chris."],
    cold: ["I'll note \"{said}\" in my file. My personal file.", "Doing it. Sorry. Again.", "It's fine. Michael's worse."],
    warm: ["Chris is nice to me. That's new.", "Happy to help, Chris. Really."] },
};
const GENERIC_MOOD = { stung: ["Ouch. Noted."], thanks: ["Thanks, that's nice."], cold: ["Still remembering \"{said}\"."], warm: ["Happy to help."] };
// relationship label -> how often a lingering mood line replaces / follows a normal line
const MOOD_P = { hurt: 0.65, wary: 0.35, neutral: 0, warm: 0.25, fond: 0.45 };
const SOCIAL = new Set(['heard', 'idle', 'free', 'reply']);
export function moodLine(id, kind, vars = {}) {
  const pool = (MOODS[id] && MOODS[id][kind]) || GENERIC_MOOD[kind]; if (!pool) return '';
  const ok = pool.filter(l => !/\{said\}/.test(l) || vars.said);
  const l = ok[(Math.random() * ok.length) | 0] || '';
  return l.replace(/\{said\}/g, String(vars.said || '').replace(/["“”]/g, '').slice(0, 48));
}
// color a normal event line with what this worker remembers about Chris (mem = { label, said })
export function colorLine(id, ev, line, mem) {
  if (!mem || !line) return line;
  const p = MOOD_P[mem.label] || 0; if (!p || Math.random() > p) return line;
  const kind = mem.label === 'hurt' || mem.label === 'wary' ? 'cold' : 'warm';
  const extra = moodLine(id, kind, mem); if (!extra) return line;
  if (SOCIAL.has(ev) && ev !== 'reply') return extra; // small talk / acknowledging Chris: the mood IS the line
  if (ev === 'reply') return kind === 'cold' ? extra.replace(/[.!]+$/, '.') : line;
  return line.length + extra.length < 170 ? line + ' ' + extra : line;
}
