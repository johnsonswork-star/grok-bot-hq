// Bot stations for the Dunder Mifflin Scranton office (set from The Office). HQ #30 / #36 / #37 / #38 / #42 (set scale, desks touching).
// id = stable bot id (tasks.json, work-live, inbox feeds key on it). name = the Office character shown in the 3D office.
// bot = the real bot behind the desk (HQ chat routes to this, Grok Bot answers as Grok Bot).
// teammate: true = a real Grok Bot teammate agent sits behind this desk (HQ #63 Direct tab forwards to it; agent ids live
// only on the box in ~/.config/grok-bot-hq/teammates.json, never in this public repo).
// HQ #72: every desk is a working bot. bot = the desk's plain job name (simplified roles); aka = the teammate's old name (still
// works in chat); job = short caps label; covered = no own agent, that Grok Bot does the real work as this character.
// x/z in meters (HQ #43: room spans x -11..11, z -7.5..7.5; north = -z = window wall, east = +x = windows, front door = south wall x 0).
// ry = rotation (radians). At ry=0 the monitor sits on the north edge of the desk and the bot sits south of it, facing north.
// ry=PI: bot sits north, faces south. ry=PI/2: bot sits east, faces west. `desk` = whose desk it is in the show.
const PI = Math.PI;
export const STATIONS = [
  // Michael's glass corner office (south-east, parking-lot windows, blinds). Door on its west side, right by Jim + Dwight + Pam.
  { id: 'grok',     name: 'Michael Scott',   bot: 'Grok Bot',             short: 'MICHAEL', color: '#e8a33d', x: 8.2,  z: 4.6,  ry: PI / 2, hero: true, desk: "Regional Manager's office",
    job: 'MANAGER / CHIEF OF STAFF',
    role: 'Michael = the real Grok Bot (Regional Manager + Chief of Staff). Main HQ tab; routes work to every desk and covers Accounting.' },
  // Reception, right inside the front door (HQ #73: scooted 0.8 m back from the door, z 5.0 -> 4.2, roomier entry aisle)
  { id: 'inbox',    name: 'Pam Beesly',      bot: 'Reception', teammate: true, aka: ['Family Inbox'],         short: 'PAM',     color: '#3fb6a8', x: -0.2, z: 4.2,  ry: PI,     desk: 'reception',
    job: 'RECEPTION',
    role: 'Reception: watches the family Gmail, flags what needs you, takes messages.' },
  // Jim + Dwight: face-to-face right outside Michael's office windows, next to reception
  { id: 'cos',      name: 'Jim Halpert',     bot: 'Web & Sales', teammate: true, aka: ['Web Brokerage'],       short: 'JIM',     color: '#5b7cfa', x: 4.2,  z: 4.5,  ry: 0,      desk: 'sales',
    job: 'WEB & SALES',
    role: 'Sales desk: domains, websites, web deals and listings.' },
  { id: 'assist',   name: 'Dwight Schrute',  bot: 'Family Assistant', teammate: true, aka: ['Family Assistance'],    short: 'DWIGHT',  color: '#e07a5f', x: 4.2,  z: 3.7,  ry: PI,     desk: 'Asst. (to the) Regional Mgr',
    job: 'FAMILY ASSISTANT',
    role: 'Family assistant: benefits, appointments, paperwork, job apps and household help.' },
  // Andy: the desk on the other side of reception
  { id: 'icons',    name: 'Andy Bernard',    bot: 'Graphic Design', teammate: true, aka: ['Icon Shop'],            short: 'ANDY',    color: '#ff9f43', x: -4.0, z: 4.9,  ry: 0,      desk: 'sales (Nard Dog)',
    job: 'GRAPHIC DESIGN',
    role: 'Graphic design bot: icons, logos, graphics and visual assets for any project.' },
  // Phyllis + Stanley: face-to-face pair behind Jim + Dwight
  { id: 'onpad',    name: 'Phyllis Vance',   bot: 'Chat & Messaging', teammate: true, aka: ['OnPad Chat'],           short: 'PHYLLIS', color: '#f06292', x: 4.2,  z: -0.6, ry: 0,      desk: 'sales',
    job: 'CHAT & MESSAGING',
    role: 'Chat and messaging: OnPad in-app chat, message flows and support replies.' },
  { id: 'builder',  name: 'Stanley Hudson',  bot: 'App Builder', teammate: true,          short: 'STANLEY', color: '#4f9cf0', x: 4.2,  z: -1.4, ry: PI,     desk: 'sales (crossword hour)',
    job: 'DEVELOPER',
    role: 'Developer: builds and ships app and site features.' },
  // Accounting: Angela + Oscar side by side, Kevin facing them
  { id: 'faith',    name: 'Angela Martin',   bot: 'Faith Lands', teammate: true,          short: 'ANGELA',  color: '#6d9f71', x: -4.4, z: -1.0, ry: 0,      desk: 'accounting',
    job: 'FAITH LANDS',
    role: 'Faith Lands project desk (church and ministry land project).' },
  { id: 'broker',   name: 'Oscar Martinez',  bot: 'Accounting', covered: 'Grok Bot',        short: 'OSCAR',   color: '#2bb3c0', x: -2.8, z: -1.0, ry: 0,      desk: 'accounting',
    job: 'ACCOUNTING',
    role: 'Accounting: bank balances, bills, budgets and spending questions (read-only bank feed). Grok Bot does the real work behind this desk.' },
  { id: 'conn',     name: 'Kevin Malone',    bot: 'IT & Connectivity', teammate: true, aka: ['Connectivity'],         short: 'KEVIN',   color: '#4dd0e1', x: -3.6, z: -1.8, ry: PI,     desk: 'accounting',
    job: 'IT & CONNECTIVITY',
    role: 'IT: internet, hotspot data, home-internet setup, devices on the network.' },
  // Back of the bullpen by the windows: Creed + Meredith side by side
  { id: 'review',   name: 'Creed Bratton',   bot: 'QA Review', teammate: true, aka: ['App Review'],           short: 'CREED',   color: '#9b6bd6', x: -0.4, z: -6.2, ry: 0,      desk: 'quality assurance',
    job: 'QA REVIEW',
    role: 'Quality assurance: reviews PRs, tests builds and QA passes before anything ships.' },
  { id: 'kids',     name: 'Meredith Palmer', bot: 'Kids Tech', teammate: true,            short: 'MEREDITH', color: '#8bc34a', x: 1.2, z: -6.2, ry: 0,     desk: 'supplier relations',
    job: 'KIDS TECH',
    role: 'Kids and homeschool tech: devices, apps and kid-safe setups.' },
  // The Annex (north-east): Kelly + Toby
  { id: 'designer', name: 'Kelly Kapoor',    bot: 'Atom Family Designer', teammate: true, short: 'KELLY',   color: '#c9a227', x: 8.1,  z: -6.1, ry: 0,      desk: 'customer service (annex)',
    job: 'APPAREL DESIGN',
    role: 'Apparel designer: Atom Family Clothing Co designs, badges, mockups and model shots.' },
  { id: 'profile',  name: 'Toby Flenderson', bot: 'HR & Settings', teammate: true, aka: ['Profile & Settings'],   short: 'TOBY',    color: '#90a4ae', x: 10.1, z: -4.5, ry: -PI / 2,      desk: 'HR (annex)',
    job: 'HR & SETTINGS',
    role: 'HR: your profile, accounts, permissions and assistant settings.' },
];
