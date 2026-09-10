export type ThemeId = 'default' | 'ocean' | 'underwater' | 'cozy';

type AssetModule = { default: string } | string;

const backgroundModules = import.meta.glob<AssetModule>(
  '../references/Backgrounds/*.png',
  { eager: true, query: '?url', import: 'default' },
) as Record<string, string>;

const paddleModules = import.meta.glob<AssetModule>(
  '../references/Paddles/**/*.png',
  { eager: true, query: '?url', import: 'default' },
) as Record<string, string>;

function assetByFile(
  modules: Record<string, string>,
  fileName: string,
): string | undefined {
  const wanted = fileName.toLowerCase();
  const entry = Object.entries(modules).find(([path]) =>
    path.replaceAll('\\', '/').toLowerCase().endsWith('/' + wanted),
  );
  return entry?.[1];
}

function paddleSet(...folderNames: string[]): string[] {
  for (const folderName of folderNames) {
    const marker = '/paddles/' + folderName.toLowerCase() + '/';
    const byFrame = new Map<number, string>();
    for (const [path, url] of Object.entries(paddleModules)) {
      const normalized = path.replaceAll('\\', '/').toLowerCase();
      if (!normalized.includes(marker)) continue;
      const frame = Number(normalized.match(/\/(\d+)\.png$/)?.[1] ?? 0);
      if (frame && !byFrame.has(frame)) byFrame.set(frame, url);
    }
    if (byFrame.size)
      return Array.from({ length: 10 }, (_, index) => byFrame.get(index + 1)).filter(
        (url): url is string => !!url,
      );
  }
  return [];
}

export const THEMES: {
  id: ThemeId;
  label: string;
  background?: string;
  table: [string, string];
  line: string;
}[] = [
  {
    id: 'default',
    label: 'Default',
    table: ['#1b2534', '#101721'],
    line: '#394b67',
  },
  {
    id: 'ocean',
    label: 'Ocean View',
    background: assetByFile(backgroundModules, 'Ocean_view_BG.png'),
    table: ['#263c7a', '#17295e'],
    line: '#5674bc',
  },
  {
    id: 'underwater',
    label: 'Underwater',
    background: assetByFile(backgroundModules, 'Underwater_BG.png'),
    table: ['#173d72', '#0b244f'],
    line: '#3c83bd',
  },
  {
    id: 'cozy',
    label: 'Cozy Room',
    background: assetByFile(backgroundModules, 'Cozy_room_BG.png'),
    table: ['#352b6d', '#1d1748'],
    line: '#68568f',
  },
];

export function themeById(id: ThemeId) {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

// Player order follows lib/physics.ts COLORS.
export const PADDLE_FRAMES = [
  paddleSet('green'),
  paddleSet('blue'),
  paddleSet('tru purple'),
  paddleSet('pink'),
  paddleSet('red'),
  paddleSet('yellow'),
  paddleSet('dark green'),
  paddleSet('dark blue'),
];
