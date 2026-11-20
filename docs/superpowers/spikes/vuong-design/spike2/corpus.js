// Corpus: which files, which elements are "screen roots", and which element to widen for the 2nd measurement.
// widen: 'parent' = widen root.parentElement (Planora: .ph frame around .sc), 'self' = widen the root itself.
const path = require('path');
const FC = 'E:/tools/finance-controller';
const BR = FC + '/.superpowers/brainstorm/3866-1794041777/content';
module.exports = [
  { key: 'pl', file: path.join(__dirname, '../spike/src/ui.html'), rootSel: '.cell .sc', widen: 'parent',
    nameOf: 'cellname' },
  // finance-controller entry mockup: .ph is the whole phone (8px bezel border, flex column, fixed 660 height)
  { key: 'fe', file: FC + '/docs/superpowers/specs/2026-11-05-ui-redesign-entry-mockup.html', rootSel: '.ph', widen: 'self' },
  // calendar-layout.html has no phone frame: each option draws a text-only ".mockup" box (max-width:300px)
  { key: 'c1', file: BR + '/calendar-layout.html', rootSel: '.mockup', widen: 'self' },
  { key: 'c2', file: BR + '/calendar-layout-v2.html', rootSel: '.ph', widen: 'self' },
  { key: 'c3', file: BR + '/calendar-layout-v3.html', rootSel: '.ph', widen: 'self' },
];
