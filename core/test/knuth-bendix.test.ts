import { completeRewriteSystem, normalize } from '../src/knuth-bendix';
import { Category } from '../src';

describe('Knuth–Bendix completion', () => {
  it('leaves an empty equation set trivially convergent', () => {
    const { rules, converged } = completeRewriteSystem([]);
    expect(converged).toBe(true);
    expect(rules).toEqual([]);
  });

  it('orients a single equation into a length-decreasing rule and normalizes', () => {
    // f * g = h  (a longer path collapses to a shorter generator)
    const { rules, converged } = completeRewriteSystem([
      { lhs: ['f', 'g'], rhs: ['h'] },
    ]);
    expect(converged).toBe(true);
    expect(rules).toEqual([{ lhs: ['f', 'g'], rhs: ['h'] }]);
    expect(normalize(['x', 'f', 'g', 'y'], rules)).toEqual(['x', 'h', 'y']);
  });

  it('completes an overlap by adding the joining consequence (the classic a*a=1 style)', () => {
    // The commuting square that made the apigw diamond: two routes to the same
    // target must be equated, and completion must make the system confluent so
    // both reduce to one normal form.
    //   r * p = s * q      (a diamond: r then p equals s then q)
    const { rules, converged } = completeRewriteSystem([
      { lhs: ['r', 'p'], rhs: ['s', 'q'] },
    ]);
    expect(converged).toBe(true);
    // Both sides of the diamond normalize to the same word.
    expect(normalize(['r', 'p'], rules)).toEqual(normalize(['s', 'q'], rules));
  });

  it('produces a canonical system: confluent completion decides equal vs distinct', () => {
    // Group-like presentation with genuine overlaps to force critical pairs:
    //   a * b = c,   c * a = b
    // These overlap on `c`, generating a * b * a = b that must be resolved.
    const eqs = [
      { lhs: ['a', 'b'], rhs: ['c'] },
      { lhs: ['c', 'a'], rhs: ['b'] },
    ];
    const { rules, converged } = completeRewriteSystem(eqs);
    expect(converged).toBe(true);

    // Derived equality holds: a*b*a  ≡  c*a  ≡  b.
    expect(normalize(['a', 'b', 'a'], rules)).toEqual(normalize(['b'], rules));
    // A genuinely distinct word does not collapse to it.
    expect(normalize(['a'], rules)).not.toEqual(normalize(['b'], rules));
  });

  it('reports non-convergence (rather than looping) when completion blows past the bound', () => {
    // A presentation whose completion diverges: length-preserving swaps that
    // keep generating new critical pairs. With a tiny rule cap we must bail out
    // honestly instead of running forever.
    const eqs = [
      { lhs: ['b', 'a'], rhs: ['a', 'b', 'a'] },
    ];
    const { converged } = completeRewriteSystem(eqs, { maxRules: 5, maxIterations: 10 });
    expect(converged).toBe(false);
  });
});

describe('Category.pathsEqual backed by Knuth–Bendix', () => {
  // A commuting diamond: two paths x → w that C's equation identifies.
  const C = new Category({
    objects: ['x', 'y', 'z', 'w'],
    morphisms: [
      { name: 'f', source: 'x', target: 'y' },
      { name: 'g', source: 'y', target: 'w' },
      { name: 'h', source: 'x', target: 'z' },
      { name: 'k', source: 'z', target: 'w' },
    ],
    equations: [{ lhs: ['f', 'g'], rhs: ['h', 'k'] }],
  });

  it('reports the word problem as decidable (completion converged)', () => {
    expect(C.hasDecidableWordProblem).toBe(true);
  });

  it('decides the diamond equality via normal forms', () => {
    expect(C.pathsEqual(['f', 'g'], ['h', 'k'])).toBe(true);
    expect(C.normalForm(['f', 'g'])).toEqual(C.normalForm(['h', 'k']));
  });

  it('decides genuine inequality (not just fails to find a proof)', () => {
    expect(C.pathsEqual(['f', 'g'], ['f'])).toBe(false);
  });

  it('treats a category with no equations as trivially decidable', () => {
    const free = new Category({
      objects: ['a', 'b'],
      morphisms: [{ name: 'm', source: 'a', target: 'b' }],
    });
    expect(free.hasDecidableWordProblem).toBe(true);
    expect(free.pathsEqual(['m'], ['m'])).toBe(true);
  });
});
