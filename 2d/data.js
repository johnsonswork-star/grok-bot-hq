// 2.5D office: real project + "Needs you" list (Oct 17, 2026). Public repo, so nothing private here:
// no account numbers, no dollar amounts, no contact names. Private items (family inbox, bills) only arrive
// through the encrypted work feed (../hq-link.js fetchWorkFeed -> needs) on Chris's own device.
// status: active | done | waiting | paused | blocked. owners = station ids from ../stations.js
export const UPDATED = 'Oct 17, 2026';
export const PAUSE_NOTE = 'Chris stopped all projects on Oct 17. Nothing restarts until he says go.';

export const PROJECTS = [
  { id: 'office2d', short: '2.5D office', icon: '🏢', title: '2.5D office (this page)', status: 'done', owners: ['grok'],
    note: 'Done and live (Oct 17). The 3D office still works at the old link.' },
  { id: 'etsy', short: 'Etsy shop', icon: '🛍️', title: 'Atom Family Etsy shop', status: 'waiting', label: 'ID submitted, under review (1-3 days)', owners: ['designer', 'cos'],
    note: 'ID submitted, under review (1-3 days). Chris finished the Etsy Persona ID check at about 5:14 PM CT Oct 17. Etsy says the review takes 1 to 3 days.' },
  { id: 'pod', short: 'Printful', icon: '📦', title: 'Printful + Tapstitch onboarding', status: 'paused', owners: ['designer'],
    note: 'Paused. Printful is the main supplier, Tapstitch is being added as a second option.' },
  { id: 'cards', short: 'Design cards', icon: '👕', title: 'Kelly design cards + mockups', status: 'paused', owners: ['designer', 'review'],
    note: 'Paused. Design Trainer deck has 22 cards. 16 have Printful photo mockups, the Tapstitch and all-over-print ones are still drawn.' },
  { id: 'att', short: 'AT&T', icon: '📶', title: 'AT&T RV lot internet', status: 'paused', owners: ['conn'], due: 'Oct 21',
    note: 'Paused. Waiting on AT&T to recognize the RV lot address for home internet. Follow-up deadline Oct 21.' },
  { id: 'onpad', short: 'OnPad', icon: '📱', title: 'OnPad app', status: 'paused', owners: ['builder', 'profile', 'onpad', 'icons'],
    note: 'Paused. App Builder, Toby, Phyllis and Andy are on hold.' },
  { id: 'faith', short: 'Faith Lands', icon: '⛪', title: 'Faith Lands land search', status: 'paused', owners: ['faith'],
    note: 'Paused.' },
  { id: 'kids', short: 'Kids Tech', icon: '💻', title: 'Kids Tech homeschool computers', status: 'paused', owners: ['kids'],
    note: 'Paused.' },
  { id: 'save', short: 'Savings', icon: '🏠', title: 'Household cost savings', status: 'paused', owners: ['assist', 'conn'],
    note: 'Paused. Dwight and Kevin are on hold.' },
  { id: 'jobs', short: 'Job apps', icon: '📄', title: 'Job applications', status: 'paused', owners: ['assist'],
    note: 'Paused.' },
  { id: 'hq105', short: 'HQ #105', icon: '🗺️', title: '3D office: warehouse map screen (HQ #105)', status: 'paused', owners: ['grok', 'builder'],
    note: 'Paused. Holding reply posted on HQ #105, not built yet.' },
];

export const NEEDS = [
  { id: 'restart', short: 'Restart?', title: 'Which projects should restart?', who: 'Michael',
    do: 'Everything is paused. Tell Michael in chat which ones to start again, or leave them off.' },
  { id: 'att', short: 'AT&T go/hold', title: 'AT&T follow-up: go or hold?', who: 'Kevin', due: 'Oct 21',
    do: 'The follow-up deadline is Oct 21. Say go or hold.' },
  { id: 'bridge', short: 'Chat bridge?', title: 'Keep the HQ chat bridge on?', who: 'Michael',
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
  grok:     { hair: '#2b1d14', style: 'slick',   skin: '#f1c7a1', shirt: '#f2f2ee', jacket: '#2b3242', tie: '#8a1f2b' },
  inbox:    { hair: '#a8432a', style: 'pony',    skin: '#f3cdb0', shirt: '#f3e9dc', cardigan: '#c98aa8' },
  cos:      { hair: '#5a3a22', style: 'messy',   skin: '#f0c49c', shirt: '#dfe6f0', tie: '#33476b' },
  assist:   { hair: '#6b4a1e', style: 'part',    skin: '#f1c9a3', shirt: '#d8b23a', tie: '#5a3c1e', glasses: 1 },
  icons:    { hair: '#8a5f30', style: 'short',   skin: '#f2c8a2', shirt: '#f1ece0', vest: '#a8343f', tie: '#2f3f6b' },
  onpad:    { hair: '#b9603f', style: 'curly',   skin: '#f2cdb4', shirt: '#8a62b0' },
  builder:  { hair: '#2a2420', style: 'bald',    skin: '#7a4e32', shirt: '#d6dbe4', tie: '#7a3a1a', stache: 1 },
  faith:    { hair: '#f1d27a', style: 'bun',     skin: '#f6d5bd', shirt: '#f5ece6', cardigan: '#d9a9bd' },
  broker:   { hair: '#1e1714', style: 'short',   skin: '#c9946b', shirt: '#9fb4c7', stubble: 1 },
  conn:     { hair: '#4a3324', style: 'bald',    skin: '#f0c19a', shirt: '#4b6a8a', big: 1 },
  review:   { hair: '#e2ded8', style: 'messy',   skin: '#e9b995', shirt: '#d9d4c8', jacket: '#6b6b5a' },
  kids:     { hair: '#c4462a', style: 'short',   skin: '#f2c7a8', shirt: '#5c8f4a' },
  designer: { hair: '#120d0b', style: 'long',    skin: '#c99272', shirt: '#e05c8a' },
  profile:  { hair: '#6b5a4a', style: 'balding', skin: '#efc7a5', shirt: '#c2ccd4', tie: '#5a6a7a' },
};
