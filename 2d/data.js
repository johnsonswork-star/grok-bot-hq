// 2.5D office: real project + "Needs you" list (Oct 17, 2026). Public repo, so nothing private here:
// no account numbers, no dollar amounts, no contact names. Private items (family inbox, bills) only arrive
// through the encrypted work feed (../hq-link.js fetchWorkFeed -> needs) on Chris's own device.
// status: active | paused | blocked. owners = station ids from ../stations.js
export const UPDATED = 'Oct 17, 2026';
export const PAUSE_NOTE = 'Chris stopped all projects on Oct 17. Nothing restarts until he says go.';

export const PROJECTS = [
  { id: 'office2d', title: '2.5D office (this page)', status: 'active', owners: ['grok'],
    note: 'Being built now. The 3D office still works at the old link.' },
  { id: 'etsy', title: 'Atom Family Etsy shop', status: 'blocked', owners: ['designer', 'cos'],
    note: 'Paused. Stuck at Etsy Persona ID verification, which needs you or Alissa with a phone camera.' },
  { id: 'pod', title: 'Printful + Tapstitch onboarding', status: 'paused', owners: ['designer'],
    note: 'Paused. Printful is the main supplier, Tapstitch is being added as a second option.' },
  { id: 'cards', title: 'Kelly design cards + mockups', status: 'paused', owners: ['designer', 'review'],
    note: 'Paused. Design Trainer deck has 22 cards. 16 have Printful photo mockups, the Tapstitch and all-over-print ones are still drawn.' },
  { id: 'att', title: 'AT&T RV lot internet', status: 'paused', owners: ['conn'], due: 'Oct 21',
    note: 'Paused. Waiting on AT&T to recognize the RV lot address for home internet. Follow-up deadline Oct 21.' },
  { id: 'onpad', title: 'OnPad app', status: 'paused', owners: ['builder', 'profile', 'onpad', 'icons'],
    note: 'Paused. App Builder, Toby, Phyllis and Andy are on hold.' },
  { id: 'faith', title: 'Faith Lands land search', status: 'paused', owners: ['faith'],
    note: 'Paused.' },
  { id: 'kids', title: 'Kids Tech homeschool computers', status: 'paused', owners: ['kids'],
    note: 'Paused.' },
  { id: 'save', title: 'Household cost savings', status: 'paused', owners: ['assist', 'conn'],
    note: 'Paused. Dwight and Kevin are on hold.' },
  { id: 'jobs', title: 'Job applications', status: 'paused', owners: ['assist'],
    note: 'Paused.' },
  { id: 'hq105', title: '3D office: warehouse map screen (HQ #105)', status: 'paused', owners: ['grok', 'builder'],
    note: 'Paused. Holding reply posted on HQ #105, not built yet.' },
];

export const NEEDS = [
  { id: 'restart', title: 'Which projects should restart?', who: 'Michael',
    do: 'Everything is paused. Tell Michael in chat which ones to start again, or leave them off.' },
  { id: 'persona', title: 'Etsy Persona ID verification', who: 'Kelly',
    do: 'You or Alissa finish the Persona ID check with a phone camera. The Etsy shop cannot open until then.' },
  { id: 'att', title: 'AT&T follow-up: go or hold?', who: 'Kevin', due: 'Oct 21',
    do: 'The follow-up deadline is Oct 21. Say go or hold.' },
  { id: 'bridge', title: 'Keep the HQ chat bridge on?', who: 'Michael',
    do: 'The bridge on the box is still running. It carries this chat box. Say keep it or shut it down (chat stops if it is off).' },
];

// Desk status lines for workers with no project of their own.
export const DESK_NOTE = {
  inbox: 'Family inbox watch. Paused.',
  broker: 'Accounting. Paused.',
  review: 'QA on design cards. Paused.',
  profile: 'HR and settings, OnPad. Paused.',
};

// Pixel looks. hair styles: short, messy, long, pony, bun, bald, balding, curly, slick
export const LOOKS = {
  grok:     { hair: '#2b1d14', style: 'slick',   skin: '#f1c7a1', shirt: '#2f3a4f', tie: '#7a1f2b' },
  inbox:    { hair: '#a8432a', style: 'pony',    skin: '#f3cdb0', shirt: '#c98aa8' },
  cos:      { hair: '#5a3a22', style: 'messy',   skin: '#f0c49c', shirt: '#d9dde6', tie: '#3b4a6b' },
  assist:   { hair: '#6b4a1e', style: 'short',   skin: '#f1c9a3', shirt: '#d8b23a', tie: '#5a3c1e', glasses: 1 },
  icons:    { hair: '#7a5228', style: 'short',   skin: '#f2c8a2', shirt: '#e9e2d3', tie: '#a3263a' },
  onpad:    { hair: '#b9502f', style: 'curly',   skin: '#f2cdb4', shirt: '#7d5aa6' },
  builder:  { hair: '#2a2420', style: 'bald',    skin: '#7a4e32', shirt: '#cfd8e3', tie: '#5a2a1a', stache: 1 },
  faith:    { hair: '#f1d27a', style: 'bun',     skin: '#f6d5bd', shirt: '#e8c9d3' },
  broker:   { hair: '#1e1714', style: 'short',   skin: '#c9946b', shirt: '#9fb4c7' },
  conn:     { hair: '#4a3324', style: 'bald',    skin: '#f0c19a', shirt: '#4b6a8a', big: 1 },
  review:   { hair: '#d9d6d0', style: 'messy',   skin: '#e9b995', shirt: '#6b6b5a' },
  kids:     { hair: '#c4462a', style: 'short',   skin: '#f2c7a8', shirt: '#5c8f4a' },
  designer: { hair: '#120d0b', style: 'long',    skin: '#c99272', shirt: '#e05c8a' },
  profile:  { hair: '#6b5a4a', style: 'balding', skin: '#efc7a5', shirt: '#9aa7b0' },
};
