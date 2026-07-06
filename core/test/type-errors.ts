/**
 * This file tests that incorrect usages produce compile-time errors.
 * Run: npx tsc --noEmit --strict
 * Every @ts-expect-error line should produce "Unused directive" if the
 * type system is NOT catching the error (meaning our types are too loose).
 */
import { defineSchema, definePattern } from '../src';

const realSchema = defineSchema({
  objects: ['VPC', 'Subnet'] as const,
  morphisms: [
    { name: 'subnet_vpc', source: 'Subnet', target: 'VPC' },
  ] as const,
});

const simplifiedSchema = defineSchema({
  objects: ['Net', 'VpcId'] as const,
  morphisms: [
    { name: 'net_vpcid', source: 'Net', target: 'VpcId' },
  ] as const,
});

type SE = { Net: string; VpcId: string };
type RE = { VPC: string; Subnet: string };

const pattern = definePattern<typeof simplifiedSchema, typeof realSchema, SE, RE>({
  real: realSchema,
  simplified: simplifiedSchema,
  functor: {
    onObjects: { Net: 'Subnet', VpcId: 'VPC' },
    onMorphisms: { net_vpcid: ['subnet_vpc'] },
  },
});

// GOOD: this should compile fine
pattern.instantiate(
  { Net: ['x'], VpcId: ['y'] },
  { net_vpcid: (_x) => 'y' },
);

// BAD: missing 'Net' key in sets
// @ts-expect-error
pattern.instantiate(
  { VpcId: ['y'] },
  { net_vpcid: (_x: string) => 'y' },
);

// BAD: missing morphism function
// @ts-expect-error
pattern.instantiate(
  { Net: ['x'], VpcId: ['y'] },
  {},
);

// BAD: wrong return type
// @ts-expect-error
pattern.instantiate(
  { Net: ['x'], VpcId: ['y'] },
  { net_vpcid: (_x: string): number => 42 },
);
