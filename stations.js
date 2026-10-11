// Bot stations for the Dunder Mifflin Scranton office (set from The Office). HQ #30 / #36 / #37 / #38 / #42 (set scale, desks touching).
// id = stable bot id (tasks.json, work-live, inbox feeds key on it). name = the Office character shown in the 3D office.
// bot = the real bot behind the desk (HQ chat routes to this, Grok Bot answers as Grok Bot).
// teammate: true = a real Grok Bot teammate agent sits behind this desk (HQ #63 Direct tab forwards to it; agent ids live
// only on the box in ~/.config/grok-bot-hq/teammates.json, never in this public repo).
// x/z in meters (HQ #43: room spans x -11..11, z -7.5..7.5; north = -z = window wall, east = +x = windows, front door = south wall x 0).
// ry = rotation (radians). At ry=0 the monitor sits on the north edge of the desk and the bot sits south of it, facing north.
// ry=PI: bot sits north, faces south. ry=PI/2: bot sits east, faces west. `desk` = whose desk it is in the show.
const PI = Math.PI;
export const STATIONS = [
  // Michael's glass corner office (south-east, parking-lot windows, blinds). Door on its west side, right by Jim + Dwight + Pam.
  { id: 'grok',     name: 'Michael Scott',   bot: 'Grok Bot',             short: 'MICHAEL', color: '#e8a33d', x: 8.2,  z: 4.6,  ry: PI / 2, hero: true, desk: "Regional Manager's office",
    role: 'Main assistant and hub (the Regional Manager). Routes work to every other bot.' },
  // Reception, right inside the front door
  { id: 'inbox',    name: 'Pam Beesly',      bot: 'Family Inbox',         short: 'PAM',     color: '#3fb6a8', x: -0.2, z: 5.0,  ry: PI,     desk: 'reception',
    role: 'Watches family email and flags what needs you.' },
  // Jim + Dwight: face-to-face right outside Michael's office windows, next to reception
  { id: 'cos',      name: 'Jim Halpert',     bot: 'Chief of Staff',       short: 'JIM',     color: '#5b7cfa', x: 4.2,  z: 4.5,  ry: 0,      desk: 'sales',
    role: 'Priorities, follow-ups, scheduled check-ins and handoffs.' },
  { id: 'assist',   name: 'Dwight Schrute',  bot: 'Family Assistance',    short: 'DWIGHT',  color: '#e07a5f', x: 4.2,  z: 3.7,  ry: PI,     desk: 'Asst. (to the) Regional Mgr',
    role: 'Benefits, appointments, paperwork and household help. Assistant (to the) Grok Bot.' },
  // Andy: the desk on the other side of reception
  { id: 'icons',    name: 'Andy Bernard',    bot: 'Icon Shop', teammate: true,            short: 'ANDY',    color: '#ff9f43', x: -4.0, z: 4.9,  ry: 0,      desk: 'sales (Nard Dog)',
    role: 'Icon sets and visual assets.' },
  // Phyllis + Stanley: face-to-face pair behind Jim + Dwight
  { id: 'onpad',    name: 'Phyllis Vance',   bot: 'OnPad Chat',           short: 'PHYLLIS', color: '#f06292', x: 4.2,  z: -0.6, ry: 0,      desk: 'sales',
    role: 'OnPad in-app chat and messaging.' },
  { id: 'builder',  name: 'Stanley Hudson',  bot: 'App Builder',          short: 'STANLEY', color: '#4f9cf0', x: 4.2,  z: -1.4, ry: PI,     desk: 'sales (crossword hour)',
    role: 'Builds and ships app features.' },
  // Accounting: Angela + Oscar side by side, Kevin facing them
  { id: 'faith',    name: 'Angela Martin',   bot: 'Faith Lands',          short: 'ANGELA',  color: '#6d9f71', x: -4.4, z: -1.0, ry: 0,      desk: 'accounting',
    role: 'Faith Lands project desk.' },
  { id: 'broker',   name: 'Oscar Martinez',  bot: 'Web Brokerage',        short: 'OSCAR',   color: '#2bb3c0', x: -2.8, z: -1.0, ry: 0,      desk: 'accounting',
    role: 'Domains, websites and web deals.' },
  { id: 'conn',     name: 'Kevin Malone',    bot: 'Connectivity',         short: 'KEVIN',   color: '#4dd0e1', x: -3.6, z: -1.8, ry: PI,     desk: 'accounting',
    role: 'Internet, hotspot and home-internet setup.' },
  // Back of the bullpen by the windows: Creed + Meredith side by side
  { id: 'review',   name: 'Creed Bratton',   bot: 'App Review',           short: 'CREED',   color: '#9b6bd6', x: -0.4, z: -6.2, ry: 0,      desk: 'quality assurance',
    role: 'Reviews PRs and QA passes before anything ships.' },
  { id: 'kids',     name: 'Meredith Palmer', bot: 'Kids Tech',            short: 'MEREDITH', color: '#8bc34a', x: 1.2, z: -6.2, ry: 0,     desk: 'supplier relations',
    role: 'Homeschool tech, devices and kid-safe setups.' },
  // The Annex (north-east): Kelly + Toby
  { id: 'designer', name: 'Kelly Kapoor',    bot: 'Atom Family Designer', teammate: true, short: 'KELLY',   color: '#c9a227', x: 8.1,  z: -6.1, ry: 0,      desk: 'customer service (annex)',
    role: 'Designs and model shots for Atom Family Clothing Co.' },
  { id: 'profile',  name: 'Toby Flenderson', bot: 'Profile & Settings', teammate: true,   short: 'TOBY',    color: '#90a4ae', x: 10.1, z: -4.5, ry: -PI / 2,      desk: 'HR (annex)',
    role: 'Your profile, accounts and assistant settings.' },
];
