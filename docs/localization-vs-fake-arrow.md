# Localization vs. the fake arrow: what `invert` really does

## The question

To force a 1:1 (or n:1) cardinality relationship in the generated template, the
right Kan extension needs a certain morphism to exist in the CloudFormation
category C. For route tables and subnets, it needs an arrow

```
RouteTable → Subnet
```

so that the fiber of `RouteTable` is re-indexed by subnet (one route table per
subnet) instead of by VPC (one shared route table). See `idea.md` for how the
comma-category fiber count depends on the arrows *out of* an object.

There are two ways to make that arrow exist:

1. **The fake arrow (old approach).** Hand-author a structural generator
   `rt_subnet : RouteTable → Subnet` directly in C, and hand-write equations to
   make it behave.
2. **Localization (`invert`, current approach).** Assert that an *existing*
   C-morphism — the association's `RouteTableId` leg — is invertible. The arrow
   `RouteTable → Subnet` is then *derived* as `inv(assoc_rt) · assoc_subnet`.

Both, in our finitely-presented setting, add a symbol and some equations. So the
fair question is: **if we're adding morphisms either way, what is the actual
difference?**

The short answer: the fake arrow adds a *chosen thing you must constrain*;
`invert` asserts a *property with a unique forced solution*. Same effect on the
generated template, but one is an unverifiable modeling artifact injected into
ground truth, and the other is a checkable, regenerable, composable delta whose
consequences are theorems rather than assertions.

The rest of this note makes that precise. But first we need to say what C₀ is,
because the whole argument turns on keeping it separate from the opinions layered
on top of it.

## What C₀ is (and what it is not)

Throughout this note, **C₀** is the CloudFormation category used as *ground
truth*: one object per resource type, one morphism per reference between resource
types, and the equations that hold of *every* valid CloudFormation stack. It is
meant to be **mechanically generated** from published data sources — the
CloudFormation resource schema and `awscdk-service-spec` — and never hand-edited.

Two things make something part of C₀:

1. **It is a fact about the service APIs, not an opinion.** A morphism belongs in
   C₀ iff CloudFormation itself has that reference: `Subnet.VpcId : Subnet → VPC`
   exists because an `AWS::EC2::Subnet` genuinely has a `VpcId` property pointing
   at a VPC. Nobody *decided* this; the API dictates it.

2. **It survives regeneration.** Because C₀ is generated, anything in it must be
   re-derivable from the source data. If regenerating C₀ from a newer
   CloudFormation spec would wipe out a morphism or equation, that morphism or
   equation was never really part of C₀ — it was a hand-patch masquerading as
   ground truth.

There is a subtlety worth naming: C₀ is *slightly* more than the raw generated
schema. It also carries **universal wiring equations** — facts true of every
valid stack, such as

```
Assoc.RouteTableId.VpcId = Assoc.SubnetId.VpcId
```

("a route-table association's route table and subnet live in the same VPC"). These
are not opinions either — they hold of *all* correct stacks, and they are the kind
of invariant a good generator (or a curated addendum to it) can justify centrally.
The litmus test for "does this belong in C₀?" is therefore:

> **Is it true of every valid CloudFormation stack?**

`Subnet.VpcId` passes. The wiring equation above passes. "Route tables are 1:1
with subnets" **fails** — real stacks legitimately share one route table across
many subnets — so it is an *opinion*, not ground truth, and it must live outside
C₀. That single test is what the fake arrow violated and what `invert` respects.

## The separation of concerns we want to maintain

The framework has three layers, and the entire design goal is to keep opinions
from leaking downward into ground truth:

| Layer            | What it is                                                                                 | Who owns it                                               | Regenerable?                           |
|------------------|--------------------------------------------------------------------------------------------|-----------------------------------------------------------|----------------------------------------|
| **C₀**           | ground-truth CloudFormation category (types, references, universal wiring equations)       | generated from CFN spec + service-spec; centrally curated | yes                                    |
| **Φ** (opinions) | cardinality and wiring *opinions* imposed on C₀ — localizations (`invert`) and quotients   | the abstraction author                                    | no, but expressed as a *delta* over C₀ |
| **D + G**        | the user-facing schema and the functor `G: D → C` mapping it into the (opinion-adjusted) C | the abstraction author                                    | no                                     |

The contract between the layers:

- **An abstraction never edits C₀.** It references C₀'s existing objects and
  morphisms and layers opinions (Φ) and a user-facing schema (D, G) on top. C₀
  stays pristine and shared by every abstraction.

- **Opinions are constraints on C₀, not additions to it.** `invert m` and path
  equations both take an existing C₀ and *refine* it (localize / quotient). They
  do not introduce new primitive data. This is what lets many abstractions share
  one C₀ and be compared, composed, and checked for conflict (the "opinion
  lattice"): they are all deltas over the same fixed base.

- **Genuinely new data goes in D, not C₀.** If the user must *supply* information
  that C₀ does not already relate — e.g. freely choosing which route table a
  subnet belongs to (n:1) — that is a degree of freedom, and degrees of freedom
  belong in the user-facing schema D as first-class objects and references. They
  are not opinions and must not be smuggled into C₀.

The fake arrow broke all three points at once: it *edited* C₀ (added a generator
the CFN spec has no basis for), it added primitive *data* rather than a
constraint (so it could not be shared or regenerated), and it used that data to
encode a modeling decision that — being an opinion, not a universal fact — had no
business in ground truth. `invert` was introduced precisely to express the same
cardinality effect while honoring the separation: it is an opinion (Φ) expressed
as a constraint referencing only what C₀ already contains.

The remainder of this note is the mechanical justification for why `invert`
achieves this and the fake arrow could not.

## The honest starting point

In our presentation, `invert m` genuinely does add a symbol plus relations. For
`invert Assoc.RouteTableId` the compiler emits:

```
generator  inv__Assoc__RouteTableId : RouteTable → Assoc
equations  Assoc.RouteTableId · inv = id ,   inv · Assoc.RouteTableId = id
```

That is the same *shape* as the fake arrow: a new symbol plus some equations. The
difference is not "one adds arrows and the other doesn't." It is **what kind of
equations, and whether the new symbol is determined.**

## Level 1 — a generator is *data*; an inverse is a *property*

The fake arrow `rt_subnet : RouteTable → Subnet` is **free data**. Nothing about
C₀ says what it does. To make it behave you hand-write equations to tie it down,
and *you* choose them. The original `vpc.schema` used two:

```
rt_subnet · subnet_vpc = rt_vpc          // "respects the VPC"
assoc_rt  · rt_subnet  = assoc_subnet    // "pairs the RT with its subnet"
```

Those are a modeling choice. You could write too few (under-constrained: the Kan
extension silently does the wrong thing), or write them backwards. Nothing forces
them to be complete or correct — they are asserted.

`invert m` adds **no free data**. Its two equations are not a modeling choice —
they are the *definition* of a two-sided inverse. They pin `inv` down to a
**unique** morphism: the localization C₀[m⁻¹] is the universal solution,
determined up to unique isomorphism by C₀ and the *name* `m`. There is exactly
one thing `inv` can be, and no equations for you to get wrong. Correctness by
construction rather than by verification.

## Level 2 — the hand-written equations become *theorems*

This is the concrete payoff of Level 1. In the localized category the derived
arrow is *defined* as `rt_subnet := inv(assoc_rt) · assoc_subnet`. The two
equations you previously had to assert now follow:

```
assoc_rt · rt_subnet
  = assoc_rt · inv(assoc_rt) · assoc_subnet
  = id · assoc_subnet
  = assoc_subnet                              ✓  (was hand-written; now a theorem)

rt_subnet · subnet_vpc
  = inv(assoc_rt) · assoc_subnet · subnet_vpc
  = inv(assoc_rt) · assoc_rt · rt_vpc         [using assoc_subnet · subnet_vpc = assoc_rt · rt_vpc]
  = id · rt_vpc
  = rt_vpc                                     ✓  (was hand-written; now a theorem)
```

The second derivation leans on `assoc_subnet · subnet_vpc = assoc_rt · rt_vpc` —
a genuine C₀ wiring fact (both VPC references agree), the kind that survives
regeneration. So the opinion's content collapses to a single assertion (`m` is
iso), and everything else is proved. With the fake arrow those two lines were
three independent things that all had to be right simultaneously.

## Level 3 — a delta over a *fixed* C₀ (composition + regeneration)

`invert m` references **only a morphism that already exists** in the generated
C₀ (`Assoc.RouteTableId` is a real CloudFormation reference property). So the
opinion is expressible as a delta:

> Take the auto-generated C₀. Invert the existing morphism named
> `Assoc.RouteTableId`.

That delta **survives regeneration**: regenerate C₀ from the CloudFormation spec,
re-apply the delta, done. The fake arrow cannot be expressed this way — the spec
has no `RouteTable → Subnet` reference, so a generator will never emit it, and you
would have to hand-patch every regeneration.

In lattice terms (see the opinion-lattice discussion): `invert` keeps C₀'s
*generators* fixed and only adds a determined inverse, so it is a point in the
lattice of theories over a **shared** C₀. Two abstractions that each localize
some morphisms live in the same lattice — you can meet them, join them, and check
them for conflict. Two abstractions that each inject their own fake generators
have signatures you cannot even compare: there is no common C₀ to relate them
over.

## Why this is more than bookkeeping: limited expressiveness is a *feature*

The distinction is principled, not cosmetic, because **localization is strictly
weaker than "add any arrow," and it is weak in exactly the right place.**

`invert` can only ever express "reshuffle / re-index data that C₀ already
relates" — every arrow it produces is a formal composite of existing arrows and
their forced inverses. It **cannot** manufacture a genuinely new reference
between two objects that C₀ did not already connect through a span. The fake-arrow
mechanism *can* (it is free data).

But a genuinely new reference is *new information the user supplies*, and that
belongs in **D**, not as an opinion on C₀ (see the n:1 discussion: free grouping
is a degree of freedom, so the route table becomes a first-class D object with a
plain reference — no constraint machinery involved). Localization's inability to
express "brand new reference" is precisely aligned with the C₀/D boundary. The
fake arrow's *extra* power was the power to smuggle a D-level modeling decision
into C₀ disguised as ground truth. Taking that power away is the whole point.

## The honest caveat

`invert` is not "free" in the sense of harmless. Inverting a non-monic morphism
forces collapses; inverting a leg whose source is in G's image breaks fullness —
which is exactly why `bijection` (invert *both* association legs) misbehaved on
the VPC schema and single-leg `invert PublicRTAssoc.RouteTableId` did not. So
localization does have global consequences.

The difference is that those consequences are **determined and checkable**: the
full/faithfulness checker catches them mechanically. The fake arrow's
consequences depend on which equations you happened to write, and a wrong or
missing equation fails silently.

## Summary

|                                     | Fake arrow                      | `invert` (localization)                       |
|-------------------------------------|---------------------------------|-----------------------------------------------|
| New symbol                          | free data (a generator)         | forced inverse of a *named existing* morphism |
| Equations                           | hand-written modeling choices   | the *definition* of inverse (unique solution) |
| Old wiring equations                | must be asserted                | become theorems                               |
| References only existing C₀ arrows? | no (invents a new one)          | yes                                           |
| Survives C₀ regeneration            | no (hand-patch each time)       | yes (re-apply the delta)                      |
| Composes across abstractions        | no shared signature             | yes (shared C₀ lattice)                       |
| Can add genuinely new references    | yes (its extra, unwanted power) | no (that belongs in D)                        |
| Failure mode                        | silent (bad/missing equation)   | checkable (faithfulness checker)              |

## See also

- `idea.md` — the right Kan extension and how fiber counts depend on arrows out
  of an object.
- The `invert` / `bijection` DSL and its lowering: `compiler/src/schema-dsl.ts`
  (`applyConstraints`, `inverseMorphismName`).
- Referencing a derived inverse inside a functor path: the `~` marker, e.g.
  `~RouteTableAssociation.RouteTableId` in `compiler/examples/strawman-vpc.schema`.
- Tests: `compiler/test/localization-dsl.test.ts`.
