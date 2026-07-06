# Diagrams

Three Mermaid diagrams showing the functor G: D → C from different angles.
Each addresses the visual complexity problem differently.

## 1. `functor-overview.mmd` — Bird's-eye view

Shows only resource objects (not value types), D on left, C on right,
functor arrows in the middle. Groups objects by structural role. Good for
"what maps where" at a glance but doesn't show internal C morphisms.

## 2. `fiber-view.mmd` — Fiber stacks (recommended)

The most informative view. Each D-object is shown as a column header,
with the C-objects it "generates" stacked below it. Internal C morphisms
(the reference arrows) are shown within each fiber. Cross-fiber arrows
(Subnet→VPC, PublicRoute→IGW, NatGateway→PublicSubnet) connect fibers.

This makes the expansion story visual: one PublicTier spawns 4 CFN resources,
one NatSlot spawns 2, one toggle spawns 0 or 2.

## 3. `cardinality-table.mmd` — Dimension → Count dependency

The most compact. D-dimensions at the top with their cardinalities,
C-resources at the bottom with formulas showing how their count derives
from D-dimensions. Edges show which dimensions feed into which counts.
Good for the "46 resources from 16 declarations" story.

## The visual complexity problem

A complete graph of C (30 objects, 41 morphisms) is unreadable. Techniques:

1. **Fiber decomposition**: Group C-objects by which D-object's fiber they
   live in. Each fiber is small (2-5 nodes). Cross-fiber arrows are few.

2. **Omit value objects**: CidrBlock, AZ, etc. map identically (D→C is
   identity on values). They add 10 nodes and 20 arrows with no information.

3. **Collapse isomorphic fibers**: PublicRT, PrivateRT, IsolatedRT are
   structurally identical (same shape, different types). Show one as
   representative with a "×3 variants" annotation.

4. **Cardinality-only view**: Replace the categorical diagram entirely
   with a dependency graph showing which inputs determine which output
   counts. Loses the morphism structure but communicates the main point.

## Rendering

```bash
# With mermaid-cli (npm install -g @mermaid-js/mermaid-cli)
mmdc -i fiber-view.mmd -o fiber-view.svg

# Or paste into https://mermaid.live
```

## Compact ASCII summary

```
D (user writes)          G            C (compiler generates)
─────────────────────    →    ─────────────────────────────────────────
Network ─────────────────┐──→ VPC
                         │
PublicTier ──────────────┼──→ PublicSubnet ──┬── PublicRT ── PublicRTAssoc
                         │                  └── PublicRoute ──→ IGW
                         │
PrivateTier ─────────────┼──→ PrivateSubnet ─┬── PrivateRT ── PrivateRTAssoc
                         │                   └── PrivateRoute ──→ NatGateway
                         │
IsolatedTier ────────────┼──→ IsolatedSubnet ── IsolatedRT ── IsolatedRTAssoc
                         │
IgwToggle ───────────────┼──→ IGW ── IGWAttach
                         │         ╰── (feeds PublicRoute)
                         │
NatSlot ─────────────────┼──→ NatGateway ── EIP
                         │         ╰── (feeds PrivateRoute)
                         │
VpnToggle ───────────────┼──→ VPNGateway ── VPNGWAttach ── VPNRouteProp
                         │
Endpoint ────────────────┴──→ GatewayEndpoint

Cross-fiber references (all point → VPC):
  PublicSubnet, PrivateSubnet, IsolatedSubnet,
  IGWAttach, VPNGWAttach, GatewayEndpoint
```