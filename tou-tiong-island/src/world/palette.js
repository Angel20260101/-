/** 《透中島》色票。粉彩、低飽和、暖調；所有 3D 物件只從這裡取色。 */
export const PALETTE = {
  sky:        '#A9DCE2',
  water:      '#9BD3DA',
  waterDeep:  '#86C4CE',
  foam:       '#C9E8EC',

  sandTop:    '#F2E8D0',
  sandSide:   '#E3D5B4',
  grassTop:   '#79B465',
  grassSide:  '#E3D5B4',
  grassLight: '#9CCA67',
  grassDark:  '#4E8C50',
  rockTop:    '#A3B0B6',
  rockSide:   '#8C999F',

  trunk:      '#B4794A',
  trunkDark:  '#8E5C36',
  leafPine:   '#3F7D4B',
  leafRound:  '#6FB45E',
  leafLime:   '#A9CE6A',
  leafTeal:   '#86C4B4',
  leafPink:   '#EFA8B8',
  leafPinkHi: '#F6C3CE',
  leafCoral:  '#EF8E86',
  palmLeaf:   '#E99AA8',
  palmTrunk:  '#D8C9A8',

  wood:       '#C68B4E',
  woodDark:   '#A06C38',
  rope:       '#E8D7B4',
  stone:      '#B9C2C7',

  towerRed:   '#D9553F',
  towerWhite: '#F6F1E4',
  towerGlass: '#F7E6A8',
  towerRoof:  '#C44A36',

  lampPost:   '#8E8275',
  lampGlow:   '#F7DFA0',
  flowerA:    '#F2A6B6',
  flowerB:    '#F6D08A',
  hutWall:    '#F0E3C8',
  hutRoof:    '#CE7A5E',
};

/** 讓低多邊形在純環境光下仍有層次：側面一律比頂面暗一階。 */
export const SURFACE_COLORS = {
  sand:        { top: PALETTE.sandTop,   side: PALETTE.sandSide },
  grass:       { top: PALETTE.grassTop,  side: PALETTE.sandSide },
  grass_light: { top: PALETTE.grassLight,side: PALETTE.sandSide },
  grass_dark:  { top: PALETTE.grassDark, side: PALETTE.sandSide },
  rock:        { top: PALETTE.rockTop,   side: PALETTE.rockSide },
};
