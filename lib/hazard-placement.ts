export const HAZARD_PLACEMENT_MESSAGES: Record<number, string> = {
  0: '',
  1: 'Sabotage hazards are disabled in this match.',
  2: 'Only eliminated players can place hazards.',
  3: 'Hazard is cooling down. Wait for the bar to fill.',
  4: 'Place inside the arena.',
  5: 'Too close to a wall. Aim deeper into the arena.',
  6: 'Arena hazard capacity reached (12 max).',
  7: 'Too close to another hazard. Pick a more open spot.',
  8: 'Hazard placement refused.',
};

export function hazardPlacementMessage(code: number) {
  return HAZARD_PLACEMENT_MESSAGES[code] ?? HAZARD_PLACEMENT_MESSAGES[8];
}
