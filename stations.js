// Bot stations, laid out like the Dunder Mifflin Scranton office (The Office). HQ #30 / #36.
// x/z in meters (room spans x -20..20, z -14..14; north = -z = window wall, east = +x = windows, door = south wall x 0).
// ry = rotation (radians). At ry=0 the monitor sits on the north edge of the desk and the bot sits south of it, facing north.
// ry=PI: bot sits north, faces south. ry=PI/2: bot sits east, faces west. `desk` = whose desk it is in the show.
const PI = Math.PI;
export const STATIONS = [
  // Michael's glass corner office (south-east, blinds, door on the north side right by Jim + Dwight)
  { id: 'grok',     name: 'Grok Bot',             short: 'GROK', color: '#e8a33d', x: 16.4,  z: 9.2,   ry: PI / 2, hero: true, desk: "Michael's office",
    role: 'Main assistant and hub (the Regional Manager). Routes work to every other bot.' },
  // Reception, right inside the front door
  { id: 'inbox',    name: 'Family Inbox',         short: 'FI',   color: '#3fb6a8', x: 0,     z: 8.4,   ry: PI,     desk: "Pam's reception",
    role: 'Watches family email and flags what needs you.' },
  // Jim + Dwight: face-to-face right outside Michael's door
  { id: 'cos',      name: 'Chief of Staff',       short: 'CoS',  color: '#5b7cfa', x: 14,    z: 1.0,   ry: 0,      desk: "Jim's desk",
    role: 'Priorities, follow-ups, scheduled check-ins and handoffs.' },
  { id: 'assist',   name: 'Family Assistance',    short: 'FA',   color: '#e07a5f', x: 14,    z: 0.2,   ry: PI,     desk: "Dwight's desk",
    role: 'Benefits, appointments, paperwork and household help. Assistant (to the) Grok Bot.' },
  { id: 'icons',    name: 'Icon Shop',            short: 'IS',   color: '#ff9f43', x: 8.6,   z: 1.0,   ry: 0,      desk: "Andy's desk",
    role: 'Icon sets and visual assets.' },
  // Phyllis + Stanley: face-to-face pair in the middle of the bullpen
  { id: 'builder',  name: 'App Builder',          short: 'AB',   color: '#4f9cf0', x: 5,     z: -3.6,  ry: 0,      desk: "Stanley's desk",
    role: 'Builds and ships app features.' },
  { id: 'onpad',    name: 'OnPad Chat',           short: 'OPC',  color: '#f06292', x: 5,     z: -4.4,  ry: PI,     desk: "Phyllis's desk",
    role: 'OnPad in-app chat and messaging.' },
  // Accounting: Angela + Oscar side by side, Kevin facing them
  { id: 'faith',    name: 'Faith Lands',          short: 'FL',   color: '#6d9f71', x: -4.6,  z: -4.0,  ry: 0,      desk: "Angela's desk (accounting)",
    role: 'Faith Lands project desk.' },
  { id: 'broker',   name: 'Web Brokerage',        short: 'WB',   color: '#2bb3c0', x: -2.4,  z: -4.0,  ry: 0,      desk: "Oscar's desk (accounting)",
    role: 'Domains, websites and web deals.' },
  { id: 'conn',     name: 'Connectivity',         short: 'NET',  color: '#4dd0e1', x: -3.5,  z: -6.6,  ry: PI,     desk: "Kevin's desk (accounting)",
    role: 'Internet, hotspot and home-internet setup.' },
  // Back of the bullpen by the windows: Creed + Meredith
  { id: 'review',   name: 'App Review',           short: 'AR',   color: '#9b6bd6', x: 6.5,   z: -9.6,  ry: 0,      desk: "Creed's desk (quality assurance)",
    role: 'Reviews PRs and QA passes before anything ships.' },
  { id: 'kids',     name: 'Kids Tech',            short: 'KT',   color: '#8bc34a', x: 6.5,   z: -10.4, ry: PI,     desk: "Meredith's desk",
    role: 'Homeschool tech, devices and kid-safe setups.' },
  // The Annex (north-east): Kelly + Toby
  { id: 'designer', name: 'Atom Family Designer', short: 'AFD',  color: '#c9a227', x: 14.6,  z: -9.4,  ry: 0,      desk: "Kelly's desk (annex)",
    role: 'Designs and model shots for Atom Family Clothing Co.' },
  { id: 'profile',  name: 'Profile & Settings',   short: 'P&S',  color: '#90a4ae', x: 17.8,  z: -6.6,  ry: 0,      desk: "Toby's desk (annex · HR)",
    role: 'Your profile, accounts and assistant settings.' },
];
