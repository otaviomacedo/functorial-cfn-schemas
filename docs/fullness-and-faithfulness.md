# Fullness and faithfulness: the guarantee that the abstraction doesn't leak

## The one-sentence version

The whole framework rests on one promise: *if you write a valid instance of the
simplified schema `D`, the generated CloudFormation faithfully reflects what you
wrote — nothing you said is silently dropped, merged, or duplicated, and nothing
you didn't say is silently imposed on you.*

That promise is **exactly** the statement that the functor `G: D → C` is **fully
faithful**. Not a metaphor for it, not an approximation of it — the same
theorem. This note explains what those two words mean, why compilation is only
trustworthy when they hold, and how the checker (`core/src/faithfulness.ts`)
turns a violated promise into a compile-time warning instead of a runtime
surprise.

## Setup: what the functor has to do

Recall the three pieces (see the README and `idea.md`):

- **`C`** — the CloudFormation category. Many objects (RestApi, Resource, Method,
  Integration, Deployment, Stage, …), one morphism per reference, path equations
  for every wiring invariant.
- **`D`** — the user-facing category. Few objects (Api, Route, Stage, …), the
  references the user actually thinks about.
- **`G: D → C`** — the functor embedding the simple picture into the full one. It
  sends each `D`-object to the `C`-object it stands for and each `D`-reference to
  the `C`-path that implements it.

The user writes an instance `I: D → Set` (a set of Apis, a set of Routes, and
the references between them). The compiler computes the **right Kan extension**
`Π_G(I): C → Set`, which is the full template. The README describes what `Π_G`
does mechanically; here we care about one structural fact about it.

`Π_G` is the **right adjoint** to restriction `Δ_G` (restriction just reads the
`D`-shaped part back off a `C`-instance: given a full template, throw away
everything except the objects and references in `G`'s image). Adjunction gives us
a canonical comparison map for free — the **counit**

```
ε_I : Δ_G Π_G(I)  →  I
```

Read it out loud: *take your instance `I`, expand it to a full template `Π_G(I)`,
then restrict that template back down to the `D`-shape you started from.* You get
another `D`-instance, and `ε_I` compares it to the original `I`. If the round trip
gives you back exactly what you put in, the expansion didn't distort your data.

**The theorem (Fong–Spivak, and standard category theory):**

> `ε_I` is an isomorphism for every `I` **if and only if** `G` is fully faithful.

So "fully faithful" is precisely "the round trip `D → C → D` is lossless." That
is the property the whole design needs, and it factors into two independent
halves.

## Faithful = no two of your references get merged

`G` is **faithful** when, for every pair of `D`-objects `d, d'`, the map on
hom-sets

```
Hom_D(d, d')  →  Hom_C(G d, G d')
```

is **injective**. In plain terms: two *different* references in your schema must
map to two *different* reference-paths in the template. If `G` sends two distinct
`D`-morphisms `h₁ ≠ h₂ : d → d'` to the *same* `C`-path, it has collapsed them.

Why that is a bug: the generated template has only one path where you drew two.
When `Π_G` fills in the template it is forced to make `I(h₁)` and `I(h₂)` agree —
they land on the same slot. Any instance in which you meant them to differ can't
be represented; its data is **silently merged**. You wrote two facts, the
template can record only one, and nobody told you.

The checker reports this as `NOT FAITHFUL: distinct references … map to the same
template reference … so their data would be MERGED`, and — this is the useful
part — it hands you the fix. The two `D`-paths are distinct *only because `D` is
missing an equation that `C` already has*. So the remedy is to add that equation
to `D`:

```
Fix: add the equation "p = q" to D so the two references coincide there too.
```

### The real example

Running the checker on `compiler/examples/apigw.schema` flagged the
**Route/Authorizer diamond**. An authorized method reaches its Api two ways —
through its route, and through its authorizer:

```
AuthMethod.Route * Route.Api      // "my api, via my route"
AuthMethod.Authorizer * Authorizer.Api  // "my api, via my authorizer"
```

In `C` these are provably equal (a genuine wiring invariant — both legs land on
the same RestApi). But `D` never stated it, so in `D` they were two distinct
morphisms `AuthMethod → Api`. `G` mapped both to the same `C`-path ⇒ **not
faithful** ⇒ the two references would be merged. The fix was to add exactly that
equation to `D`. Once stated, they *are* one morphism in `D`, the collapse is no
longer a loss, and `G` became faithful. The generated CloudFormation didn't
change at all — the equation only forbids incoherent instances the Kan extension
was already quietly filtering.

That is the pattern in general: **a faithfulness violation is a consistency
invariant that `C` knows and `D` forgot to say.** Making `G` faithful means
teaching `D` every equation `C` enforces along the paths `G` uses.

## Full = no constraint gets imposed that you never wrote

`G` is **full** when that same hom-set map

```
Hom_D(d, d')  →  Hom_C(G d, G d')
```

is **surjective**: every reference-path that `C` has between two image objects is
the image of some reference you can express in `D`. A **fullness** violation is a
`C`-path between two objects that *are* in `G`'s image, but which no `D`-path maps
onto — a reference the template has and your schema cannot name.

Why *that* is a bug is subtler than the faithful case, and it cuts the opposite
way. `Π_G` computes each object's value as a limit over a comma category, and that
comma category sees *every* `C`-morphism, whether or not `G` hits it. An uncovered
`C`-reference therefore still constrains the extension:

- it can **add an entry** to a comma category and *enlarge* the limit — your
  elements come back **duplicated**, one copy per combination; or
- it can **add a constraint** and *shrink* the limit — some combinations are
  **filtered** out.

Either way the template imposes a structural rule you never wrote in `D`. The
abstraction is leaky in the "surprise behavior" direction: the user asked for one
thing and the generator, honoring a reference invisible from `D`, produced
another. The checker reports `NOT FULL: C has reference … with no counterpart in
the schema … instances may be silently DUPLICATED … or FILTERED — a constraint
the user never stated.`

### Not every fullness gap is a bug — hence `expected fullness`

Here fullness differs from faithfulness in an important way: **some** uncovered
`C`-references are *intended*. The auto-created resources are the whole point of
the Kan extension — the user says "I want a Stage" and the framework mints a
Deployment, a deploy toggle, and wires them, none of which appear in `D`. That
wiring shows up as a fullness gap (`Stage.DeploymentId * Deployment.Toggle`, a
`C`-reference `D` deliberately can't express), but it is the auto-created toggle
cascade working as designed, not a leak.

So a raw fullness violation is not automatically an error — it's a question:
*did you mean for the template to carry a reference the user can't see?* The DSL
answers it explicitly. Inside the `map` block you can declare

```
expected fullness Stage.DeploymentId * Deployment.Toggle because "auto-created deploy toggle"
```

The compiler then partitions fullness violations into **declared-expected**
(reported as a calm `note: expected fullness gap …`) versus **undeclared** (still
a `warning: … not fully faithful … DUPLICATED/FILTERED`). A declaration that
matches nothing is itself flagged as a stale annotation. So the surviving warnings
are exactly the fullness gaps *you have not vouched for* — the ones that are
genuinely suspicious.

## Why "fully faithful," not "isomorphism"

A natural misreading: "if the round trip is lossless, isn't `G` just an
isomorphism — aren't `D` and `C` the same category?" No, and the difference is
the entire value proposition.

Fullness and faithfulness are **local** conditions — they constrain each hom-set
`Hom_D(d,d') → Hom_C(Gd,Gd')` to be a bijection. They say **nothing about
objects.** An isomorphism (or equivalence) of categories would *additionally*
require `G` to be essentially surjective on objects — every `C`-object hit. `G` is
emphatically *not* that: `D` has a handful of objects, `C` has dozens. `G` embeds
`D` as a **full subcategory** of `C`.

That is the point. We *want* `C` to have far more objects than `D` — the extra
objects are the auto-created resources, the toggles, the deployments the user
shouldn't have to think about. Fully-faithful-but-not-surjective is precisely
"the user's vocabulary is a faithful sub-vocabulary of the full one, and the rest
is generated." If `G` were an iso there would be nothing to abstract away.

### Which round trip the guarantee actually covers

Full + faithful buys the counit `Δ_G Π_G(I) ≅ I` — the **`D → C → D`** round trip.
It does **not** buy the other direction:

- **`D → C → D`** (`Δ_G Π_G`): recovers `I` exactly, iff `G` is fully faithful.
  This is the guarantee the checker protects.
- **`C → D → C`** (`Π_G Δ_G`): does *not* recover an arbitrary template, even for
  a fully faithful `G`. `Π_G` *invents* off-image structure (auto-created
  resources, toggles) from defaults, not from stored provenance.

Practical consequence: you **cannot** reverse-engineer a foreign, hand-written
CloudFormation file into "the simplified instance that regenerates it." `Δ_G`
(read a `D`-instance back off a template) is exact on templates *you generated*
and lossy/best-effort on templates you didn't. Don't advertise a general
CloudFormation → simplified importer as an inverse to compilation.

## What the checker actually does, and what it doesn't prove

`checkFullyFaithful(G, maxDepth=10)` in `core/src/faithfulness.ts`:

- **Faithfulness:** for each ordered pair `(d, d')`, enumerate the `D`-paths
  `d → d'` (canonical reps mod `D`-equations), bucket them by their image in `C`
  (mod `C`-equations), and flag any bucket with more than one member — those are
  `D`-morphisms `G` can't tell apart.
- **Fullness:** for each pair of image objects `(X, Y)`, collect the images of all
  `D`-paths between their preimages ("what `G` can express"), then walk every
  `C`-path `X → Y` and flag the ones not covered.

It is wired into `compile()` (`compiler/src/compiler.ts`) as **non-fatal
warnings** via `onDiagnostic` (default `console.warn`), with a
`skipFaithfulnessCheck` escape hatch and threaded through `compileFile`. A leaky
functor still compiles — the check is a diagnostic, not a gate. This matches
Spivak's framing of the problem it solves: a non-fully-faithful `G` is "a leaky
abstraction with no error message," and the checker's job is to supply the error
message.

Two honesty caveats, both surfaced in the report:

1. **Bounded enumeration (`boundedBy`).** `allPaths` truncates at `maxDepth`. A
   clean report means "no violation found within the search bound," not a proof.
2. **The word problem (`decidable`).** Both checks reduce to deciding path
   equality mod equations. That equality is backed by Knuth–Bendix completion; when
   KB *converges* for both categories (as it does for both API Gateway categories)
   every equality test is a genuine decision and `decidable` is true. When it
   doesn't, path equality is a bounded semi-decision, so a *reported* violation is
   a strong signal but not a proof — an apparent distinctness might collapse beyond
   the explored congruence closure. The formatter prepends a `NOTE:` saying so.

### A known blind spot: dangling span apexes

The fullness check ranges only over pairs of objects **in `G`'s image**. The
optional/sum-field desugaring introduces span **apex** objects that are *not* in
the image. If an author forgets to map a concrete variant, its apex dangles: the
apex's `on`-leg lands on an image object, but because the apex itself isn't in the
image, `findFullnessViolations` never considers it and reports FULL. The Kan
extension then mints the apex as an auto-singleton and attaches a bogus target —
exactly the silent bug the framework exists to prevent. Fullness-as-checked does
**not** catch this; a separate **span-coverage check** (`spanCoverageDiagnostics`,
reported in `compile()`) exists precisely to cover the gap, with an `expected`-style
waiver for intentional cases. See `docs`/memory on optional-and-sum spans.

## Why this matters — the framework's entire pitch depends on it

The README's headline claim is that wiring bugs are "structurally impossible by
construction." That claim is *only true when `G` is fully faithful.* Unpack it:

- The Kan extension guarantees the *output* is a valid `C`-instance with all path
  equations satisfied — the references are mutually consistent. That's real, and
  it holds regardless of `G`.
- But "consistent" is not "what the user meant." A non-faithful `G` produces a
  perfectly consistent template that has **merged** two things the user
  distinguished. A non-full `G` produces a perfectly consistent template that has
  **duplicated or dropped** the user's elements according to a rule the user never
  wrote. Both are valid CloudFormation. Both are wrong.

Full faithfulness is the bridge between "the output is internally consistent" and
"the output means what the input said." Without it, the framework would trade one
class of silent structural bug (hand-wired references) for another (abstraction
leakage) — and the second is arguably worse, because it hides inside a tool that
advertises correctness. The checker is what keeps the advertisement honest: it
makes the leak a warning at author time, with a concrete fix for faithfulness
failures and an explicit `expected fullness` acknowledgement for the fullness gaps
that are supposed to be there.

## Summary

|                         | **Faithful**                                      | **Full**                                                    |
|-------------------------|---------------------------------------------------|-------------------------------------------------------------|
| Hom-set map is…         | injective                                         | surjective                                                  |
| Failure means…          | two `D`-references share one `C`-path             | a `C`-reference no `D`-path covers                          |
| User-visible symptom    | data **MERGED** (you said two things, got one)    | data **DUPLICATED / FILTERED** (a rule you never wrote)     |
| Direction of the leak   | you lose a distinction you made                   | you gain a constraint you didn't make                       |
| The fix                 | add the missing equation to `D` (checker suggests it) | cover the reference in `D`, or `expected fullness` to waive it |
| Always a bug?           | yes — a forgotten `C`-invariant                   | no — auto-created wiring is a legitimate, declarable gap    |
| Together they give      | the counit `Δ_G Π_G(I) ≅ I` — a lossless `D→C→D` round trip                                                             |

## See also

- `core/src/faithfulness.ts` — the checker, its report shape, and the diagnostic
  formatter (`formatFullFaithfulReport`, `suggestedEquation`).
- `compiler/src/compiler.ts` — where the check runs as compile-time warnings
  (`onDiagnostic`, `skipFaithfulnessCheck`).
- `docs/localization-vs-fake-arrow.md` — how `invert` keeps opinions out of `C₀`;
  the "honest caveat" there is a faithfulness consequence.
- `compiler/examples/apigw.schema` — the Route/Authorizer diamond fix and the
  `expected fullness` declaration for the deploy-toggle cascade.
- `idea.md` and `kan-extensions-for-cfn.tex` — the Kan extension, the adjunction,
  and the counit in full.