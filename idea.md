# Functorial CloudFormation Schemas

## Core Idea

Apply the "databases as functors" framework from Fong & Spivak (Chapter 3, *An Invitation to Applied Category Theory*) to CloudFormation template generation.

- A **schema** is a category C (objects = resource types, morphisms = references between them).
- An **instance** (populated template) is a functor I: C -> **Set**.
- A **simplification** is a functor G: D -> C from a simplified schema D into the full pattern schema C.
- The **right Kan extension** Pi_G mechanically expands a user's instance I: D -> **Set** into a full instance (Pi_G I): C -> **Set** — generating resources, wiring references, and creating defaults.

## The Construction

### Pattern Schema C (designed by the abstraction author)

A small category representing "the resources involved in this pattern." Not the full CFN schema — just the relevant subcategory, possibly idealized (e.g., splitting `String` into `VpcBlock` and `SubnetBlock` to distinguish roles).

### Simplified Schema D (user-facing)

A smaller category representing "what the user specifies." Typically just a few objects.

### Functor G: D -> C

Embeds the user-facing types into the pattern. G must land on the "most connected" object — the one with paths to everything the user's inputs need to reach.

### Right Kan Extension (Pi_G)

For each object c in C:

1. Collect all morphisms from c to objects in G's image.
2. Form a diagram of the corresponding I-values with connecting functions.
3. Take the limit of that diagram.

Key behaviors:

- Objects with **no path** to G's image get the limit of the empty diagram = {*} — **a default resource created from nothing**.
- Objects with **paths to a singleton** get a single determined element.
- Objects with **paths to a set of size n** (disconnected from other constraints) get n copies via the product.
- **Path equations** in C collapse products to diagonals, enforcing bijective pairing (e.g., NAT #k uses EIP #k).

## Example: Public Subnet

### Pattern Schema C

```
Objects: VPC, Subnet, IGW, Attach, VpcBlock, SubnetBlock, GatewayToggle

Morphisms:
  vpc_cidr:    VPC    -> VpcBlock
  subnet_vpc:  Subnet -> VPC
  subnet_cidr: Subnet -> SubnetBlock
  attach_vpc:  Attach -> VPC
  attach_igw:  Attach -> IGW
  igw_toggle:  IGW    -> GatewayToggle
```

### Simplified Schema D

```
Objects: Net, VpcBlock, SubnetBlock, GatewayToggle

Morphisms:
  net_vpcblock: Net -> VpcBlock
  net_subblock: Net -> SubnetBlock
  (GatewayToggle isolated)
```

### Functor G

```
G(Net)           = Subnet
G(VpcBlock)      = VpcBlock
G(SubnetBlock)   = SubnetBlock
G(GatewayToggle) = GatewayToggle

G(net_vpcblock) = vpc_cidr . subnet_vpc
G(net_subblock) = subnet_cidr
```

### User Instance

```
I(Net)           = { "my-network" }
I(VpcBlock)      = { "10.0.0.0/16" }
I(SubnetBlock)   = { "10.0.1.0/24" }
I(GatewayToggle) = { * }              -- set to empty-set to disable
```

### Result of Pi_G I

```
VPC    = { "10.0.0.0/16" }   -- one VPC
Subnet = { "my-network" }    -- one Subnet
IGW    = { * }               -- created as default (sees only GatewayToggle)
Attach = { "10.0.0.0/16" }  -- one Attachment

All references wired correctly by the limit computation.
Setting I(GatewayToggle) = empty-set kills both IGW and Attach (cascade).
```

## Example: NAT Gateway Count

### Additional Objects in C

```
EIP, NAT, Route, RT, NatCount

Additional morphisms:
  nat_subnet: NAT   -> Subnet
  nat_eip:    NAT   -> EIP
  nat_count:  NAT   -> NatCount
  eip_count:  EIP   -> NatCount
  route_rt:   Route -> RT
  route_nat:  Route -> NAT

Path equation:
  nat_count = eip_count . nat_eip
```

### User Sets NatCount = {1, 2, 3}

Result:
- 3 EIPs, 3 NATs, 3 Routes
- NAT #k paired with EIP #k (path equation enforces bijection)
- All NATs reference the same Subnet
- All Routes reference the same RT

Setting NatCount = empty-set kills all three resource types.

## Key Mechanisms

| User-facing parameter  | Categorical encoding          | Effect                            |
|------------------------|-------------------------------|-----------------------------------|
| Boolean toggle         | empty-set vs {*}              | Cascade kill vs default creation  |
| Count parameter        | Set of that cardinality       | One copy per element              |
| Pairing constraint     | Path equation in C            | Collapses product to diagonal     |
| Fixed default resource | Object disconnected from G    | Limit of empty diagram = {*}     |

## Design Choices

The abstraction designer must provide:

1. **Pattern schema C** — which resource types are part of the pattern, idealized as needed (splitting String into role-specific types, etc.)
2. **Simplified schema D** — the user-facing interface.
3. **Functor G: D -> C** — where user inputs land in the pattern.
4. **Rendering functions** — how to translate the abstract instance back to actual CFN (filling in computed values, defaults, string manipulations).

## Limitations (vs. General-Purpose Code Like CDK)

The functorial layer is purely structural. It cannot:

- **Compute values**: no string manipulation, CIDR arithmetic, name generation.
- **Branch on values**: can branch on existence (empty-set vs non-empty) but not on content.
- **Derive cardinalities**: can't say "min(natCount, azCount)"; each set is independent.
- **Assign non-uniformly**: can't distribute 2 NATs across 3 AZs; only bijections (equal cardinality + path equation) or broadcast (all to one).
- **Validate globally**: can't check "total subnet space fits in VPC."
- **Perform side effects**: no lookups, no generated secrets.

## Integration with CDK

### Architecture

```
User props
    |
    v
Instance I: D -> Set           (structural: what exists, how many, what's toggled)
    |
    | Pi_G (right Kan extension)
    v
Skeleton: C -> Set             (structural: all resources, all references, correct by construction)
    |
    | Render callbacks          (computational: values, names, tags, conditionals)
    v
CDK Constructs / CFN Template
```

### Separation of Concerns

- **Skeleton** (functorial): existence, multiplicity, wiring — guaranteed correct.
- **Render** (computational): property values, naming, defaults — arbitrary code.

The render layer receives pre-resolved references and cannot alter the structure (which resources exist, what references what). It can only fill in values. This makes the structural invariants machine-checkable while leaving full computational freedom for values.

### Composition

Two patterns can be composed by identifying shared objects (categorical pushout):

```
compose(publicSubnetPattern, natGatewayPattern, {
  identify: { 'nat.Subnet': 'public.Subnet', 'nat.VPC': 'public.VPC' }
})
```

This mechanically produces the combined schema with all constraints from both patterns.

### Value Proposition

- **Consumer experience**: unchanged (same props API).
- **Author experience**: structural invariants declared statically, computed values in render callbacks.
- **Novel capabilities**: pattern diffing, schema migration, compositional assembly, structural regression tests.
- **Primary benefit**: wiring bugs (silent, hard to test) become impossible by construction; value bugs (loud, easy to test) remain in the render layer where they're manageable.

## Open Questions

- Is the structural layer valuable enough to justify the formalism, given that most CDK complexity is computational (value derivation, conditional logic)?
- Can path equations express enough constraints, or do you need the full power of finite limit sketches?
- What's the right surface syntax for pattern authors who don't know category theory?
- Can you automatically derive a "maximal" pattern schema C from the CFN resource provider schemas, or is idealization always manual?
