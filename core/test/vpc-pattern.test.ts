/**
 * Tests for the VPC pattern schema, exercising the same topology
 * as the CDK Vpc construct.
 */
import { Category, Functor, Instance, inspectKan } from '../src';

// Replicate the schema from vpc-pattern.ts here for testing
// (avoids cross-project import issues)

const realSchema = new Category({
  objects: [
    'VPC',
    'Subnet',
    'RouteTable',
    'RTAssoc',
    'IGW',
    'IGWAttach',
    'PublicRoute',
    'EIP',
    'NatGateway',
    'SubnetSlot',
    'IgwToggle',
    'NatSlot',
  ],
  morphisms: [
    { name: 'subnet_slot', source: 'Subnet', target: 'SubnetSlot' },
    { name: 'rt_subnet', source: 'RouteTable', target: 'Subnet' },
    { name: 'rta_subnet', source: 'RTAssoc', target: 'Subnet' },
    { name: 'rta_rt', source: 'RTAssoc', target: 'RouteTable' },
    { name: 'igw_toggle', source: 'IGW', target: 'IgwToggle' },
    { name: 'igwatt_igw', source: 'IGWAttach', target: 'IGW' },
    { name: 'pr_igw', source: 'PublicRoute', target: 'IGW' },
    { name: 'pr_subnet', source: 'PublicRoute', target: 'Subnet' },
    { name: 'eip_natslot', source: 'EIP', target: 'NatSlot' },
    { name: 'nat_natslot', source: 'NatGateway', target: 'NatSlot' },
    { name: 'nat_eip', source: 'NatGateway', target: 'EIP' },
    // NOTE: nat_subnet is NOT here. NAT-to-subnet assignment is computational
    // (PrefSet round-robin), not structural. Including it would cause the
    // limit to produce NatSlot × SubnetSlot NAT gateways instead of just NatSlot.
  ],
  equations: [
    { lhs: ['nat_natslot'], rhs: ['nat_eip', 'eip_natslot'] },
    { lhs: ['rta_subnet'], rhs: ['rta_rt', 'rt_subnet'] },
  ],
});

const simplifiedSchema = new Category({
  objects: ['SubnetSlot', 'IgwToggle', 'NatSlot'],
  morphisms: [],
});

const G = new Functor(simplifiedSchema, realSchema, {
  onObjects: {
    SubnetSlot: 'SubnetSlot',
    IgwToggle: 'IgwToggle',
    NatSlot: 'NatSlot',
  },
  onMorphisms: {},
});

describe('VPC Pattern Schema', () => {
  describe('default VPC: 2 subnet configs × 3 AZs, IGW on, 3 NATs', () => {
    const I = new Instance(simplifiedSchema, {
      SubnetSlot: [0, 1, 2, 3, 4, 5], // 2 configs × 3 AZs = 6 subnets
      IgwToggle: ['*'],
      NatSlot: [0, 1, 2], // 3 NATs (one per AZ)
    }, {});

    const result = inspectKan(G, I);

    it('creates 1 VPC (disconnected from all inputs)', () => {
      expect(result.objects['VPC'].elements).toHaveLength(1);
    });

    it('creates 6 subnets (one per slot)', () => {
      expect(result.objects['Subnet'].elements).toHaveLength(6);
    });

    it('creates 6 route tables (one per subnet)', () => {
      expect(result.objects['RouteTable'].elements).toHaveLength(6);
    });

    it('creates 6 route table associations (one per subnet)', () => {
      expect(result.objects['RTAssoc'].elements).toHaveLength(6);
    });

    it('creates 1 IGW', () => {
      expect(result.objects['IGW'].elements).toHaveLength(1);
    });

    it('creates 1 IGW attachment', () => {
      expect(result.objects['IGWAttach'].elements).toHaveLength(1);
    });

    it('creates 6 public routes (one per subnet — caller filters to public only)', () => {
      // The Kan extension creates one route per subnet because
      // PublicRoute sees both SubnetSlot and IgwToggle.
      // The render layer filters to only public subnets.
      expect(result.objects['PublicRoute'].elements).toHaveLength(6);
    });

    it('creates 3 EIPs (one per NAT slot)', () => {
      expect(result.objects['EIP'].elements).toHaveLength(3);
    });

    it('creates 3 NAT gateways', () => {
      expect(result.objects['NatGateway'].elements).toHaveLength(3);
    });

    it('pairs NAT #k with EIP #k (bijection from path equation)', () => {
      for (let i = 0; i < 3; i++) {
        const eipIdx = result.instance.applyMorphism('nat_eip', i);
        const natSlotFromNat = result.instance.applyMorphism('nat_natslot', i);
        const natSlotFromEip = result.instance.applyMorphism('eip_natslot', eipIdx);
        expect(natSlotFromNat).toBe(natSlotFromEip);
      }
    });

    it('pairs RTAssoc with its RT (correct subnet via path equation)', () => {
      for (let i = 0; i < 6; i++) {
        const subnetViaAssoc = result.instance.applyMorphism('rta_subnet', i);
        const rtIdx = result.instance.applyMorphism('rta_rt', i);
        const subnetViaRt = result.instance.applyMorphism('rt_subnet', rtIdx);
        expect(subnetViaAssoc).toBe(subnetViaRt);
      }
    });
  });

  describe('no IGW: IGW toggle off', () => {
    const I = new Instance(simplifiedSchema, {
      SubnetSlot: [0, 1, 2],
      IgwToggle: [], // empty — no IGW
      NatSlot: [],
    }, {});

    const result = inspectKan(G, I);

    it('creates no IGW', () => {
      expect(result.objects['IGW'].elements).toHaveLength(0);
    });

    it('creates no IGW attachment (cascade)', () => {
      expect(result.objects['IGWAttach'].elements).toHaveLength(0);
    });

    it('creates no public routes (cascade through IGW)', () => {
      expect(result.objects['PublicRoute'].elements).toHaveLength(0);
    });

    it('still creates subnets', () => {
      expect(result.objects['Subnet'].elements).toHaveLength(3);
    });

    it('still creates route tables', () => {
      expect(result.objects['RouteTable'].elements).toHaveLength(3);
    });
  });

  describe('no NATs: NatSlot empty', () => {
    const I = new Instance(simplifiedSchema, {
      SubnetSlot: [0, 1, 2],
      IgwToggle: ['*'],
      NatSlot: [], // no NATs
    }, {});

    const result = inspectKan(G, I);

    it('creates no EIPs', () => {
      expect(result.objects['EIP'].elements).toHaveLength(0);
    });

    it('creates no NAT gateways', () => {
      expect(result.objects['NatGateway'].elements).toHaveLength(0);
    });

    it('IGW still exists', () => {
      expect(result.objects['IGW'].elements).toHaveLength(1);
    });
  });

  describe('single NAT: NatSlot has 1 element', () => {
    const I = new Instance(simplifiedSchema, {
      SubnetSlot: [0, 1, 2, 3, 4, 5],
      IgwToggle: ['*'],
      NatSlot: [0], // single NAT
    }, {});

    const result = inspectKan(G, I);

    it('creates 1 EIP', () => {
      expect(result.objects['EIP'].elements).toHaveLength(1);
    });

    it('creates 1 NAT gateway', () => {
      expect(result.objects['NatGateway'].elements).toHaveLength(1);
    });
  });
});
