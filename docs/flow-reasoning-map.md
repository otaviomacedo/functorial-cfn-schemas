# The categories & functors, mapped

There are **two worlds** that share one category, `C` (the CloudFormation
schema). Keeping them separate is the whole trick.

- **Legend:**  `[Category]`  `⟨Functor⟩`  `{Instance = functor to Set}`
- `━━▶` = a functor · `┈┈▶` = "evaluate on an instance" · `≤` = lattice order

```
                        SYNTHESIS  (original engine — build a template)
        ────────────────────────────────────────────────────────────────────
                            ⟨G⟩  the abstraction
              [D] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━▶ [C]
          user-facing schema                CloudFormation schema
                 │                                  │
        {I: D→Set}│  user input               {Π_G I: C→Set}│  the template
                 │                                  │        (right Kan extension of I along G)
                 ▼                                  ▼
           e.g. "1 network"              e.g. RestApi+Resource+2 Methods+…


                        REASONING  (new — analyse an existing template)
        ────────────────────────────────────────────────────────────────────

           [C] ━━━⟨localize Σ⁻¹⟩━━━▶ [C[Σ⁻¹]]  ⊇  [Flow]
        references                 invert the      data-flow arrows
        point ref→referenced       monic legs      (wide subcategory:
                                                     reverse a leg, compose)

                    Flow is DOWNSTREAM of C.  There is NO functor C→Flow —
                    the generators point the wrong way (onQueue: ESM→Queue
                    has no image; flow runs Queue→Function).

        TYPE level (schema)                    ELEMENT level (a concrete instance)
        ───────────────────                    ────────────────────────────────────
        [Flow]  over C's OBJECTS               [Flow]  over  [∫I]  (category of elements)
        "can SOME queue reach                  nodes = concrete resources
         SOME bucket?"                         (orders, invoices, processor…)
        reaches(Queue,Bucket)                  elementReaches(orders, invoices)

                                               built by deriveElementFlow(C, I, spec):
                                               forward step  = follow  I(m)
                                               backward step = enumerate I(m)⁻¹  (fan-out!)

                    ⚠ element-level flow is NOT a Kan extension: a reversed leg
                    is a one-to-many RELATION, and Set-valued Kan only migrates
                    functions. It's relation-composition over ∫I instead.


                        CLASSIFICATION  (gadget 2 — the security check)
        ────────────────────────────────────────────────────────────────────

                         ⟨P⟩  a classification = a functor
              [Flow] ━━━━━━━━━━━━━━━━━━━━━━━━━━▶ [E]
           data-flow arrows                 sensitivity lattice
                                            (thin poset: public≤internal≤secret,
                                             one arrow x→y  iff  x≤y)

           P sends each flow edge  A─▶B   to an arrow  P(A)─▶P(B) in E,
           which EXISTS  iff  P(A) ≤ P(B).

              ✓ every edge monotone  ⇒  P is a functor  ⇒  classification sound
                                          (checkClassification MATERIALIZES it)

              ✗ a secret─▶public wire ⇒  no arrow in E to receive it
                                      ⇒  P is NOT a functor
                                      ⇒  that edge is reported as a LEAK
```

## The one-line summary of each piece

| Thing | Kind | What it is | Direction of arrows |
|---|---|---|---|
| `D` | category | user-facing simplified schema | references |
| `C` | category | CloudFormation schema | references (referencer→referenced) |
| `G: D→C` | functor | the abstraction (synthesis) | — |
| `I: D→Set` | instance | user's input | — |
| `Π_G I: C→Set` | instance | the generated template (Kan extension) | — |
| `C[Σ⁻¹]` | category | `C` with monic legs inverted (localization) | both |
| `Flow` | category | data-flow arrows; wide subcat of `C[Σ⁻¹]` | **flow** (reversed from refs) |
| `∫I` | category | category of elements — concrete resources of `I` | function-applications |
| `E` | category | sensitivity lattice (thin poset) | `≤` |
| `P: Flow→E` | functor | a classification; non-functor ⇔ a leak | — |

## Two mantras to keep them straight

1. **Synthesis goes `D → C`; reasoning goes `C → Flow → E`.** `C` is the hinge —
   the *output* of synthesis is the *input* of reasoning.

2. **A functor is a "cannot fail" promise.** Synthesis: `G` being a valid functor
   ⇒ the template's wiring is correct by construction. Classification: `P` being
   a valid functor ⇒ no data ever flows downhill in sensitivity. In both, the
   bug you care about is precisely *"this is not a functor"*.
