import script from '../docs/SCRIPT.md?raw';
import { LINES } from '../src/strings';

// Every line in docs/SCRIPT.md is in the strings file under its ID, with the same words.
describe('strings file', () => {
  const rows = script
    .split('\n')
    .filter((l) => /^\| (C\d|fill)\.[\w.-]+ \|/.test(l))
    .map((l) =>
      l
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim()),
    );

  it('has every line ID from the script', () => {
    expect(rows.length).toBeGreaterThan(100);
    const ids = rows.map((r) => r[0]);
    expect(Object.keys(LINES).sort()).toEqual([...ids].sort());
  });

  it('keeps each line word for word', () => {
    for (const r of rows) {
      const text = r[r.length - 1].replace(/^"(.*)"$/, '$1');
      expect(LINES[r[0] as keyof typeof LINES].text).toBe(text);
    }
  });
});
