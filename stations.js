// Bot stations. x/z in meters (room spans x -20..20, z -14..14; north = -z = windows).
// ry = rotation (radians). At ry=0 the monitor sits on the north edge of the desk facing south.
export const STATIONS = [
  { id: 'grok',     name: 'Grok Bot',             short: 'GROK', color: '#e8a33d', x: 0,     z: -1,   ry: 0,            hero: true,
    role: 'Main assistant and hub. Routes work to every other bot.' },
  { id: 'cos',      name: 'Chief of Staff',       short: 'CoS',  color: '#5b7cfa', x: -5,    z: -2.2, ry: 0.35,
    role: 'Priorities, follow-ups, scheduled check-ins and handoffs.' },
  // West pod: family wing
  { id: 'inbox',    name: 'Family Inbox',         short: 'FI',   color: '#3fb6a8', x: -14.2, z: -4.6, ry: 0,
    role: 'Watches family email and flags what needs you.' },
  { id: 'assist',   name: 'Family Assistance',    short: 'FA',   color: '#e07a5f', x: -11.2, z: -4.6, ry: 0,
    role: 'Benefits, appointments, paperwork and household help.' },
  { id: 'designer', name: 'Atom Family Designer', short: 'AFD',  color: '#c9a227', x: -14.2, z: -6.2, ry: Math.PI,
    role: 'Designs and model shots for Atom Family Clothing Co.' },
  { id: 'kids',     name: 'Kids Tech',            short: 'KT',   color: '#8bc34a', x: -11.2, z: -6.2, ry: Math.PI,
    role: 'Homeschool tech, devices and kid-safe setups.' },
  // East pod: build wing
  { id: 'builder',  name: 'App Builder',          short: 'AB',   color: '#4f9cf0', x: 11.2,  z: -4.6, ry: 0,
    role: 'Builds and ships app features.' },
  { id: 'review',   name: 'App Review',           short: 'AR',   color: '#9b6bd6', x: 14.2,  z: -4.6, ry: 0,
    role: 'Reviews PRs and QA passes before anything ships.' },
  { id: 'onpad',    name: 'OnPad Chat',           short: 'OPC',  color: '#f06292', x: 11.2,  z: -6.2, ry: Math.PI,
    role: 'OnPad in-app chat and messaging.' },
  { id: 'icons',    name: 'Icon Shop',            short: 'IS',   color: '#ff9f43', x: 14.2,  z: -6.2, ry: Math.PI,
    role: 'Icon sets and visual assets.' },
  // North window bench
  { id: 'faith',    name: 'Faith Lands',          short: 'FL',   color: '#6d9f71', x: -5,    z: -11.6, ry: 0.12,
    role: 'Faith Lands project desk.' },
  { id: 'broker',   name: 'Web Brokerage',        short: 'WB',   color: '#2bb3c0', x: 0,     z: -11.8, ry: 0,
    role: 'Domains, websites and web deals.' },
  { id: 'conn',     name: 'Connectivity',         short: 'NET',  color: '#4dd0e1', x: 5,     z: -11.6, ry: -0.12,
    role: 'Internet, hotspot and home-internet setup.' },
  // West wall, near lounge
  { id: 'profile',  name: 'Profile & Settings',   short: 'P&S',  color: '#90a4ae', x: -17.6, z: 2.5, ry: Math.PI / 2,
    role: 'Your profile, accounts and assistant settings.' },
];
