// What the partner says, as a pure function of the mission. Each line fires once, the first
// time its condition holds, so the scene only has to show whatever this returns.
import type { MissionState } from './mission';

export type Mood = 'focused' | 'worried' | 'alarmed' | 'relieved';

export interface PartnerLine {
  readonly id: string;
  readonly mood: Mood;
  readonly text: string;
}

interface Rule extends PartnerLine {
  readonly when: (s: MissionState) => boolean;
}

const hasCache = (s: MissionState) => s.nodes.some((n) => n.kind === 'cache');
const cacheWired = (s: MissionState) =>
  s.nodes
    .filter((n) => n.kind === 'cache')
    .some((c) => s.links.some((l) => l.to === c.id) && s.links.some((l) => l.from === c.id));

// Order matters: when several fire in the same step, the last one is what shows.
const RULES: readonly Rule[] = [
  {
    id: 'intro',
    mood: 'focused',
    text: 'Quiet night on the relay. Keep an eye on the database.',
    when: () => true,
  },
  {
    id: 'spike',
    mood: 'worried',
    text: 'Traffic is spiking. That pirate broadcast just went viral.',
    when: (s) => s.time > 10.5,
  },
  {
    id: 'db-hot',
    mood: 'worried',
    text: 'The database is past capacity. The servers are fine. Everyone wants the same page.',
    when: (s) => s.dbLoad > 1.05,
  },
  {
    id: 'dropping',
    mood: 'alarmed',
    text: "We're dropping requests! The database can't keep up.",
    when: (s) => s.backlog >= 199,
  },
  {
    id: 'cache-placed',
    mood: 'focused',
    text: 'A cache. Wire the servers into it, then the cache into the database.',
    when: (s) => hasCache(s) && !cacheWired(s),
  },
  {
    id: 'cache-live',
    mood: 'focused',
    text: "Cache is live. It's warming up. Give it a few seconds.",
    when: cacheWired,
  },
  {
    id: 'won',
    mood: 'relieved',
    text: 'Database load is down and holding. Repeat reads stopped reaching it. That was you.',
    when: (s) => s.outcome === 'won',
  },
  {
    id: 'lost',
    mood: 'alarmed',
    text: 'We lost the city. The database was the choke point the whole time.',
    when: (s) => s.outcome === 'lost',
  },
];

/** Lines that newly fire for this state, given the ids already said. */
export function newLines(state: MissionState, said: ReadonlySet<string>): PartnerLine[] {
  return RULES.filter((r) => !said.has(r.id) && r.when(state)).map(({ id, mood, text }) => ({
    id,
    mood,
    text,
  }));
}
