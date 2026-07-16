import {
  Category,
  Functor,
  Instance,
  inspectKan,
  checkFullyFaithful,
  formatFullFaithfulReport,
  suggestedEquation,
} from '../src';

describe('checkFullyFaithful', () => {
  describe('the minimal non-full functor (discrete D over an arrow in C)', () => {
    // D:  a    b        (discrete — no non-identity morphisms)
    // C:  x --f--> y
    // G:  a↦x, b↦y      valid, faithful, but NOT full: f has no preimage.
    const D = new Category({ objects: ['a', 'b'], morphisms: [] });
    const C = new Category({
      objects: ['x', 'y'],
      morphisms: [{ name: 'f', source: 'x', target: 'y' }],
    });
    const G = new Functor(D, C, {
      onObjects: { a: 'x', b: 'y' },
      onMorphisms: {},
    });

    it('flags the missing preimage of f as a fullness violation', () => {
      const report = checkFullyFaithful(G);
      expect(report.faithful).toBe(true);
      expect(report.full).toBe(false);
      expect(report.fullnessViolations).toHaveLength(1);
      expect(report.fullnessViolations[0]).toMatchObject({
        cSource: 'x',
        cTarget: 'y',
        cPath: ['f'],
      });
    });

    it('demonstrates the leak: 1 a + 2 b duplicates x into 2 elements', () => {
      // Π_G(I)(x) = limit over (x↓G) = I(a) × I(b), since D has no constraint.
      const I = new Instance(
        D,
        { a: ['a1'], b: ['b1', 'b2'] },
        {},
      );
      const kan = inspectKan(G, I);
      // The user declared ONE a; the template mints one x per b.
      expect(kan.objects['x'].elements.length).toBe(2);
      // And the leak is exactly what the checker predicts statically.
      expect(checkFullyFaithful(G).full).toBe(false);
    });
  });

  describe('a non-faithful functor (two D-arrows collapsed in C)', () => {
    // D:  a ==g,h==> b     two distinct parallel morphisms
    // C:  x ---k---> y
    // G:  a↦x, b↦y, g↦k, h↦k   collapses g and h.
    const D = new Category({
      objects: ['a', 'b'],
      morphisms: [
        { name: 'g', source: 'a', target: 'b' },
        { name: 'h', source: 'a', target: 'b' },
      ],
    });
    const C = new Category({
      objects: ['x', 'y'],
      morphisms: [{ name: 'k', source: 'x', target: 'y' }],
    });
    const G = new Functor(D, C, {
      onObjects: { a: 'x', b: 'y' },
      onMorphisms: { g: ['k'], h: ['k'] },
    });

    it('flags g and h as indistinguishable in the template', () => {
      const report = checkFullyFaithful(G);
      expect(report.faithful).toBe(false);
      const v = report.faithfulnessViolations.find(x => x.d === 'a' && x.dPrime === 'b');
      expect(v).toBeDefined();
      expect(v!.dPaths).toEqual(expect.arrayContaining([['g'], ['h']]));
      expect(v!.image).toEqual(['k']);
    });

    it('suggests the repairing D-equation and reports a MERGE', () => {
      const report = checkFullyFaithful(G);
      const v = report.faithfulnessViolations[0];
      expect(suggestedEquation(v)).toBe('g = h');
      const lines = formatFullFaithfulReport(report);
      expect(lines.join('\n')).toMatch(/MERGED/);
      expect(lines.join('\n')).toContain('add the equation "g = h" to D');
    });
  });

  describe('a fully faithful functor (D embeds as a full subcategory)', () => {
    // D:  a --g--> b
    // C:  x --k--> y --m--> z   (z, m live outside the image — fine)
    // G:  a↦x, b↦y, g↦k.   Full & faithful: Hom_C(x,y) = {k} = image of {g}.
    const D = new Category({
      objects: ['a', 'b'],
      morphisms: [{ name: 'g', source: 'a', target: 'b' }],
    });
    const C = new Category({
      objects: ['x', 'y', 'z'],
      morphisms: [
        { name: 'k', source: 'x', target: 'y' },
        { name: 'm', source: 'y', target: 'z' },
      ],
    });
    const G = new Functor(D, C, {
      onObjects: { a: 'x', b: 'y' },
      onMorphisms: { g: ['k'] },
    });

    it('reports full and faithful (extra object z does not break fullness)', () => {
      const report = checkFullyFaithful(G);
      expect(report.faithful).toBe(true);
      expect(report.full).toBe(true);
    });
  });
});