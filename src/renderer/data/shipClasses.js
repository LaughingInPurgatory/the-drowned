import { mulberry32 } from '../procgen/prng.js'
import {
  generateShipClassRoster,
  computeMiningCapacity,
  balancePurchasableShipsByRole
} from '../procgen/shipRoster.js'

const HAND_CRAFTED_SHIP_CLASSES = [
  {
    id: 'bravia_mk2',
    name: 'Bravia',
    role: 'trader',
    price: 12000,
    stats: { hull: 100, shields: 50, armor: 20, cargoCapacity: 40, speed: 120, turnRate: 1.8, accel: 30 },
    // Forward hardpoint on the industrial prow.
    hardpoints: [{ id: 'fwd1', position: [0, 0.25, 8.2], type: 'laser' }],
    accessorySlots: 1,
    hull: {
      // Compact industrial frigate: angular prow, rugged plating,
      // twin aft drives — utilitarian rather than sleek.
      length: 18,
      // 12 stations aft→nose: broad engine bus → tall mid → sharp wedge prow.
      stationWidths: [0.7, 0.9, 1.1, 1.3, 1.5, 1.55, 1.5, 1.35, 1.1, 0.8, 0.5, 0.28],
      stationHeights: [0.82, 1.0, 1.2, 1.4, 1.52, 1.55, 1.4, 1.2, 0.9, 0.6, 0.4, 0.24],
      crossSectionSides: 14,
      superellipseExponent: 3.1,
      // Angular plate fins + ventral keel wing (industrial slabs).
      wings: [
        {
          atStation: 4,
          span: 3.2,
          sweep: 0.55,
          thickness: 0.34,
          side: 'both',
          tipOffsetY: -0.35,
          chordScale: 1.05
        },
        {
          atStation: 7,
          span: 1.6,
          sweep: -0.2,
          thickness: 0.2,
          side: 'both',
          tipOffsetY: 0.08,
          chordScale: 0.9
        },
        // Underside keel wing — tip carries a forward aerial (see shipMesh).
        {
          atStation: 5,
          span: 2.4,
          sweep: 0.35,
          thickness: 0.28,
          side: 'bottom',
          tipOffsetX: 0,
          chordScale: 1.0,
          tipAerial: true
        }
      ],
      stationOffsetsX: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      stationOffsetsY: [0.04, 0.06, 0.09, 0.12, 0.1, 0.08, 0.05, 0.02, 0, -0.02, -0.02, 0],
      // Matte bronze-steel hull.
      color: '#8a7a68',
      style: {
        asymmetric: false,
        bridgeSide: 0,
        engineLayout: 'twin',
        hasRadiator: true,
        hasCargoPods: false,
        hasSensorMast: true,
        hasDockingRing: false,
        detailDensity: 2.2
      }
    }
  },
  {
    id: 'hold_runner',
    name: 'Hold Runner',
    role: 'trader',
    price: 20000,
    stats: { hull: 150, shields: 30, armor: 40, cargoCapacity: 120, speed: 70, turnRate: 0.9, accel: 15 },
    hardpoints: [{ id: 'fwd1', position: [0, 0.5, 12], type: 'laser' }],
    accessorySlots: 2,
    hull: {
      length: 32,
      // Boxy bulk freighter — fat cargo block, blunt nose, truncated tail.
      stationWidths: [1.2, 2.2, 3.2, 3.7, 3.85, 3.85, 3.8, 3.6, 3.2, 2.4, 1.6, 1.1],
      stationHeights: [1.0, 1.8, 2.5, 2.75, 2.85, 2.85, 2.8, 2.6, 2.3, 1.7, 1.15, 0.85],
      crossSectionSides: 12,
      superellipseExponent: 3.2,
      wings: [
        // Port cargo fin.
        { atStation: 5, span: 2.4, sweep: -0.25, thickness: 0.42, side: 'left', chordScale: 1.05 },
        // Aft dorsal stabilizer over the drive bus.
        { atStation: 2, span: 1.8, sweep: -0.35, thickness: 0.32, side: 'top', chordScale: 0.95 },
        // Ventral cargo keel.
        { atStation: 6, span: 1.6, sweep: 0.15, thickness: 0.3, side: 'bottom', chordScale: 0.9 }
      ],
      stationOffsetsX: [0, -0.08, -0.16, -0.22, -0.25, -0.22, -0.18, -0.12, -0.06, 0, 0, 0],
      stationOffsetsY: [0, 0.02, 0.05, 0.08, 0.1, 0.1, 0.08, 0.05, 0.02, 0, 0, 0],
      color: '#a89870',
      style: {
        asymmetric: true,
        bridgeSide: -1,
        engineLayout: 'quad',
        hasRadiator: true,
        hasCargoPods: true,
        hasSensorMast: true,
        // Underside freighter bridge + side cargo radars.
        cockpitMount: 'bottom',
        radarDishes: ['top', 'side', 'bottom'],
        hasDockingRing: true,
        detailDensity: 2.1
      }
    }
  },
  {
    id: 'needle_dart',
    name: 'Needle Dart',
    role: 'fighter',
    price: 35000,
    stats: { hull: 70, shields: 80, armor: 10, cargoCapacity: 10, speed: 220, turnRate: 2.8, accel: 55 },
    hardpoints: [
      { id: 'fwd1', position: [-1.2, 0, 9], type: 'laser' },
      { id: 'fwd2', position: [1.2, 0, 9], type: 'laser' }
    ],
    accessorySlots: 1,
    hull: {
      length: 20,
      // Needle fighter — pinched mid, broad rear engines, sharp prow.
      stationWidths: [0.1, 0.28, 0.55, 0.85, 1.05, 0.95, 0.9, 1.1, 1.15, 0.7, 0.35, 0.14],
      stationHeights: [0.08, 0.2, 0.35, 0.48, 0.52, 0.48, 0.45, 0.52, 0.55, 0.35, 0.18, 0.1],
      crossSectionSides: 14,
      superellipseExponent: 2.1,
      wings: [
        // Main swept combat wings mid-body.
        { atStation: 6, span: 6.8, sweep: 1.25, thickness: 0.2, side: 'both', tipOffsetY: -0.15, chordScale: 1.05 },
        // Canard-ish forward stubs.
        { atStation: 9, span: 1.6, sweep: 0.35, thickness: 0.12, side: 'both', chordScale: 0.75 },
        // Tall rear tail fin.
        { atStation: 2, span: 2.1, sweep: -0.4, thickness: 0.16, side: 'top', chordScale: 0.85 }
      ],
      color: '#c8cdd4',
      style: {
        asymmetric: false,
        bridgeSide: 0,
        engineLayout: 'twin',
        hasRadiator: false,
        hasCargoPods: false,
        hasSensorMast: true,
        cockpitMount: 'top',
        radarDishes: ['top', 'side'],
        hasDockingRing: false,
        detailDensity: 2.0
      }
    }
  },
  {
    id: 'gun_barge',
    name: 'Gun Barge',
    role: 'fighter',
    price: 45000,
    stats: { hull: 130, shields: 100, armor: 50, cargoCapacity: 25, speed: 140, turnRate: 2.0, accel: 35 },
    hardpoints: [
      { id: 'wing1', position: [-3, 0, 6], type: 'laser' },
      { id: 'wing2', position: [3, 0, 6], type: 'missile' }
    ],
    accessorySlots: 2,
    hull: {
      length: 26,
      // Heavy gunship — broad mid, armored prow, asymmetric weapon plane.
      stationWidths: [0.35, 0.75, 1.3, 1.75, 2.05, 2.1, 2.0, 1.85, 1.55, 1.1, 0.65, 0.35],
      stationHeights: [0.25, 0.55, 0.95, 1.25, 1.4, 1.42, 1.35, 1.2, 1.0, 0.7, 0.4, 0.22],
      crossSectionSides: 12,
      superellipseExponent: 2.8,
      wings: [
        // Heavier port weapons wing.
        { atStation: 5, span: 8.8, sweep: 0.45, thickness: 0.42, side: 'left', chordScale: 1.1 },
        // Shorter starboard plane with anhedral.
        { atStation: 5, span: 6.0, sweep: 0.55, thickness: 0.28, side: 'right', tipOffsetY: 0.35, chordScale: 0.95 },
        // Rear dorsal stabilizer.
        { atStation: 2, span: 2.4, sweep: -0.3, thickness: 0.28, side: 'top', chordScale: 0.9 },
        // Ventral keel for belly mass.
        { atStation: 6, span: 1.9, sweep: 0.25, thickness: 0.26, side: 'bottom', chordScale: 0.85 }
      ],
      stationOffsetsY: [0, 0.02, 0.05, 0.1, 0.14, 0.15, 0.12, 0.08, 0.04, 0.02, 0, 0],
      color: '#6a7680',
      style: {
        asymmetric: true,
        bridgeSide: 1,
        engineLayout: 'triple',
        hasRadiator: true,
        hasCargoPods: false,
        hasSensorMast: true,
        // Gunship belly cockpit.
        cockpitMount: 'bottom',
        radarDishes: ['top', 'right', 'bottom'],
        hasDockingRing: false,
        detailDensity: 2.3
      }
    }
  },
  {
    id: 'light_runner',
    name: 'Light Runner',
    role: 'explorer',
    price: 8500,
    stats: { hull: 50, shields: 40, armor: 5, cargoCapacity: 15, speed: 180, turnRate: 2.5, accel: 45 },
    hardpoints: [{ id: 'fwd1', position: [0, 0.1, 7], type: 'laser' }],
    accessorySlots: 1,
    hull: {
      length: 15,
      // Compact survey boat — slender spine, modest mid flare.
      stationWidths: [0.12, 0.28, 0.5, 0.72, 0.9, 0.95, 0.88, 0.75, 0.55, 0.38, 0.22, 0.12],
      stationHeights: [0.1, 0.22, 0.4, 0.55, 0.68, 0.72, 0.66, 0.55, 0.4, 0.28, 0.16, 0.1],
      crossSectionSides: 14,
      superellipseExponent: 2.2,
      wings: [
        { atStation: 6, span: 2.8, sweep: 0.45, thickness: 0.14, side: 'both', chordScale: 0.95 },
        // Small survey tail fin.
        { atStation: 2, span: 1.3, sweep: -0.25, thickness: 0.12, side: 'top', chordScale: 0.8 }
      ],
      color: '#7a9a88',
      style: {
        asymmetric: false,
        bridgeSide: 0,
        engineLayout: 'single',
        hasRadiator: false,
        hasCargoPods: false,
        hasSensorMast: true,
        cockpitMount: 'top',
        // Sensor suite: top + bottom dishes.
        radarDishes: ['top', 'bottom', 'side'],
        hasDockingRing: false,
        detailDensity: 1.9
      }
    }
  },
  {
    id: 'raider_mk1',
    name: 'Raider',
    role: 'fighter',
    price: 28000,
    npcOnly: true,
    stats: { hull: 90, shields: 60, armor: 25, cargoCapacity: 20, speed: 160, turnRate: 2.2, accel: 40 },
    hardpoints: [
      { id: 'fwd1', position: [-1, 0, 8], type: 'laser' },
      { id: 'fwd2', position: [1, 0, 8], type: 'missile' }
    ],
    accessorySlots: 1,
    hull: {
      length: 19,
      // Rough scavenged silhouette — deliberately ugly / asymmetric.
      stationWidths: [0.12, 0.4, 0.75, 1.15, 1.35, 1.2, 1.05, 1.45, 1.5, 0.95, 0.45, 0.18],
      stationHeights: [0.08, 0.28, 0.45, 0.6, 0.68, 0.62, 0.55, 0.78, 0.82, 0.5, 0.25, 0.12],
      crossSectionSides: 10,
      superellipseExponent: 2.4,
      wings: [
        { atStation: 7, span: 5.2, sweep: -0.45, thickness: 0.26, side: 'right', tipOffsetY: -0.28, chordScale: 1.0 },
        // Crooked tail stub.
        { atStation: 1, span: 1.5, sweep: 0.2, thickness: 0.18, side: 'top', tipOffsetX: 0.2, chordScale: 0.75 },
        // Scrap ventral plate.
        { atStation: 5, span: 1.2, sweep: 0.1, thickness: 0.2, side: 'bottom', tipOffsetX: -0.15 }
      ],
      stationOffsetsX: [0, 0.05, 0.12, 0.2, 0.22, 0.18, 0.1, -0.08, -0.15, -0.08, 0, 0],
      stationOffsetsY: [0, 0, 0.02, 0.05, 0.08, 0.06, 0.03, 0.1, 0.12, 0.05, 0, 0],
      color: '#8a4540',
      style: {
        asymmetric: true,
        bridgeSide: -1,
        engineLayout: 'twin',
        hasRadiator: true,
        hasCargoPods: true,
        hasSensorMast: true,
        cockpitMount: 'bottom',
        radarDishes: ['top', 'left', 'bottom'],
        hasDockingRing: false,
        detailDensity: 2.2
      }
    }
  },
  {
    // Authority response fighter — white/black livery, top guns + missiles.
    id: 'system_patrol',
    name: 'System Patrol',
    role: 'fighter',
    price: 0,
    npcOnly: true,
    faction: 'police',
    stats: { hull: 110, shields: 120, armor: 40, cargoCapacity: 15, speed: 190, turnRate: 2.6, accel: 48 },
    hardpoints: [
      { id: 'turret1', position: [0, 1.2, 2], type: 'laser' },
      { id: 'turret2', position: [0, 1.1, -1], type: 'laser' },
      { id: 'fwd1', position: [-1.1, 0.1, 9], type: 'missile' },
      { id: 'fwd2', position: [1.1, 0.1, 9], type: 'missile' }
    ],
    accessorySlots: 0,
    hull: {
      // Broader patrol gunship vs Pathfinder/Surveyor explorers.
      length: 26,
      stationWidths: [0.25, 0.55, 0.9, 1.25, 1.55, 1.6, 1.5, 1.35, 1.1, 0.75, 0.4, 0.18],
      stationHeights: [0.18, 0.38, 0.58, 0.78, 0.92, 0.95, 0.88, 0.75, 0.58, 0.4, 0.22, 0.12],
      crossSectionSides: 10,
      superellipseExponent: 2.8,
      wings: [
        { atStation: 5, span: 7.2, sweep: 0.55, thickness: 0.28, side: 'both', tipOffsetY: -0.2, chordScale: 1.15 },
        { atStation: 3, span: 2.4, sweep: 0.1, thickness: 0.18, side: 'both', chordScale: 0.85 },
        { atStation: 1, span: 2.6, sweep: -0.35, thickness: 0.2, side: 'top', chordScale: 0.9 },
        { atStation: 6, span: 1.8, sweep: 0.25, thickness: 0.16, side: 'bottom', chordScale: 0.8 }
      ],
      // Bright white hull; black panels + light bar applied in shipMesh police livery.
      color: '#f4f7fb',
      style: {
        asymmetric: false,
        bridgeSide: 0,
        engineLayout: 'twin',
        hasRadiator: true,
        hasCargoPods: false,
        hasSensorMast: true,
        cockpitMount: 'top',
        radarDishes: ['top', 'side'],
        hasDockingRing: false,
        detailDensity: 2.1,
        policeLivery: true
      }
    }
  },
  {
    id: 'swift_keel',
    name: 'Swift Keel',
    role: 'explorer',
    price: 18000,
    stats: { hull: 80, shields: 50, armor: 15, cargoCapacity: 60, speed: 150, turnRate: 1.6, accel: 28 },
    hardpoints: [{ id: 'fwd1', position: [0, 0.3, 13], type: 'laser' }],
    accessorySlots: 2,
    hull: {
      length: 28,
      // Long-range explorer — elegant spine, broad mid wings, proud tail.
      stationWidths: [0.18, 0.45, 0.85, 1.2, 1.5, 1.55, 1.48, 1.3, 1.0, 0.65, 0.35, 0.16],
      stationHeights: [0.12, 0.32, 0.58, 0.82, 0.95, 0.98, 0.92, 0.8, 0.58, 0.38, 0.2, 0.1],
      crossSectionSides: 14,
      superellipseExponent: 2.3,
      wings: [
        // Primary mid-body sails.
        { atStation: 5, span: 8.2, sweep: 0.85, thickness: 0.2, side: 'both', tipOffsetY: 0.12, chordScale: 1.05 },
        // Rear dorsal tail wing.
        { atStation: 2, span: 2.6, sweep: -0.45, thickness: 0.18, side: 'top', chordScale: 0.9 },
        // Slim forward canards.
        { atStation: 9, span: 1.8, sweep: 0.3, thickness: 0.12, side: 'both', chordScale: 0.7 }
      ],
      color: '#6a8fa0',
      style: {
        asymmetric: false,
        bridgeSide: 0,
        engineLayout: 'twin',
        hasRadiator: true,
        hasCargoPods: false,
        hasSensorMast: true,
        cockpitMount: 'top',
        radarDishes: ['top', 'bottom', 'side'],
        hasDockingRing: true,
        detailDensity: 2.0
      }
    }
  },
  // --- Drone-bay hulls (bays only — buy drones in Shipyard Armoury) ---
  {
    id: 'pathfinder',
    name: 'Pathfinder',
    role: 'explorer',
    price: 22000,
    droneBays: 1,
    stats: { hull: 75, shields: 55, armor: 12, cargoCapacity: 35, speed: 165, turnRate: 2.0, accel: 38 },
    hardpoints: [{ id: 'fwd1', position: [0, 0.2, 10], type: 'laser' }],
    accessorySlots: 2,
    hull: {
      length: 22,
      stationWidths: [0.15, 0.4, 0.7, 1.0, 1.2, 1.25, 1.15, 0.95, 0.7, 0.45, 0.25, 0.12],
      stationHeights: [0.12, 0.3, 0.5, 0.7, 0.82, 0.85, 0.78, 0.62, 0.45, 0.3, 0.16, 0.1],
      crossSectionSides: 14,
      superellipseExponent: 2.2,
      wings: [
        { atStation: 6, span: 4.2, sweep: 0.5, thickness: 0.16, side: 'both', chordScale: 1.0 },
        { atStation: 2, span: 1.5, sweep: -0.2, thickness: 0.12, side: 'top', chordScale: 0.8 }
      ],
      color: '#6a9a88',
      style: {
        asymmetric: false, bridgeSide: 0, engineLayout: 'twin', hasRadiator: false,
        hasCargoPods: false, hasSensorMast: true, cockpitMount: 'top',
        radarDishes: ['top', 'bottom'], hasDockingRing: false, detailDensity: 2.0
      }
    }
  },
  {
    id: 'surveyor',
    name: 'Surveyor',
    role: 'explorer',
    price: 26000,
    droneBays: 1,
    stats: { hull: 85, shields: 60, armor: 18, cargoCapacity: 50, speed: 155, turnRate: 1.7, accel: 32 },
    hardpoints: [
      { id: 'fwd1', position: [0, 0.25, 11], type: 'laser' },
      { id: 'fwd2', position: [0, -0.1, 10], type: 'missile' }
    ],
    accessorySlots: 2,
    hull: {
      // Probe-saucer explorer — wider mid disk, stub wings vs Pathfinder slim spine.
      length: 20,
      stationWidths: [0.35, 0.7, 1.15, 1.55, 1.75, 1.7, 1.4, 1.0, 0.65, 0.4, 0.25, 0.14],
      stationHeights: [0.22, 0.4, 0.55, 0.65, 0.7, 0.68, 0.55, 0.4, 0.28, 0.18, 0.12, 0.08],
      crossSectionSides: 16,
      superellipseExponent: 2.0,
      wings: [
        { atStation: 4, span: 3.2, sweep: 0.15, thickness: 0.2, side: 'both', chordScale: 1.1 },
        { atStation: 6, span: 2.0, sweep: 0.55, thickness: 0.12, side: 'both', chordScale: 0.7 },
        { atStation: 2, span: 2.2, sweep: -0.1, thickness: 0.16, side: 'top', chordScale: 0.9 },
        { atStation: 5, span: 1.5, sweep: 0.2, thickness: 0.14, side: 'bottom', tipAerial: true, chordScale: 0.85 }
      ],
      color: '#4a7a6a',
      style: {
        asymmetric: false, bridgeSide: 0, engineLayout: 'single', hasRadiator: true,
        hasCargoPods: false, hasSensorMast: true, cockpitMount: 'top',
        radarDishes: ['top', 'side', 'bottom'], hasDockingRing: true, detailDensity: 2.3
      }
    }
  },
  {
    id: 'wayfarer',
    name: 'Wayfarer',
    role: 'explorer',
    price: 38000,
    droneBays: 2,
    stats: { hull: 100, shields: 70, armor: 22, cargoCapacity: 70, speed: 145, turnRate: 1.55, accel: 30 },
    hardpoints: [
      { id: 'fwd1', position: [-0.8, 0.2, 12], type: 'laser' },
      { id: 'fwd2', position: [0.8, 0.2, 12], type: 'laser' }
    ],
    accessorySlots: 3,
    hull: {
      length: 30,
      stationWidths: [0.22, 0.55, 0.95, 1.35, 1.6, 1.65, 1.55, 1.35, 1.05, 0.7, 0.4, 0.18],
      stationHeights: [0.15, 0.38, 0.65, 0.9, 1.05, 1.08, 1.0, 0.85, 0.62, 0.4, 0.22, 0.12],
      crossSectionSides: 14,
      superellipseExponent: 2.25,
      wings: [
        { atStation: 6, span: 6.5, sweep: 0.55, thickness: 0.2, side: 'both', tipOffsetY: -0.1, chordScale: 1.05 },
        { atStation: 2, span: 2.2, sweep: -0.3, thickness: 0.16, side: 'top', chordScale: 0.9 }
      ],
      color: '#4a7a90',
      style: {
        asymmetric: false, bridgeSide: 0, engineLayout: 'triple', hasRadiator: true,
        hasCargoPods: true, hasSensorMast: true, cockpitMount: 'top',
        radarDishes: ['top', 'side'], hasDockingRing: true, detailDensity: 2.2
      }
    }
  },
  {
    id: 'far_reach',
    name: 'Far Reach',
    role: 'explorer',
    price: 52000,
    droneBays: 2,
    stats: { hull: 120, shields: 85, armor: 30, cargoCapacity: 90, speed: 135, turnRate: 1.4, accel: 26 },
    hardpoints: [
      { id: 'fwd1', position: [0, 0.3, 14], type: 'laser' },
      { id: 'fwd2', position: [0, -0.15, 12], type: 'missile' }
    ],
    accessorySlots: 3,
    hull: {
      length: 34,
      stationWidths: [0.25, 0.6, 1.05, 1.5, 1.8, 1.85, 1.75, 1.5, 1.15, 0.75, 0.42, 0.2],
      stationHeights: [0.16, 0.42, 0.72, 1.0, 1.15, 1.18, 1.1, 0.92, 0.68, 0.45, 0.24, 0.12],
      crossSectionSides: 14,
      superellipseExponent: 2.35,
      wings: [
        { atStation: 5, span: 7.2, sweep: 0.48, thickness: 0.24, side: 'both', chordScale: 1.1 },
        { atStation: 8, span: 2.0, sweep: 0.3, thickness: 0.14, side: 'both', chordScale: 0.75 },
        { atStation: 2, span: 2.5, sweep: -0.35, thickness: 0.18, side: 'top', chordScale: 0.9 }
      ],
      color: '#3d6a7a',
      style: {
        asymmetric: false, bridgeSide: 0, engineLayout: 'triple', hasRadiator: true,
        hasCargoPods: true, hasSensorMast: true, cockpitMount: 'top',
        radarDishes: ['top', 'bottom', 'side'], hasDockingRing: true, detailDensity: 2.3
      }
    }
  },
  {
    id: 'wasp',
    name: 'Wasp',
    role: 'fighter',
    price: 30000,
    droneBays: 1,
    stats: { hull: 65, shields: 75, armor: 12, cargoCapacity: 12, speed: 210, turnRate: 2.9, accel: 58 },
    hardpoints: [
      { id: 'fwd1', position: [-0.9, 0, 8.5], type: 'laser' },
      { id: 'fwd2', position: [0.9, 0, 8.5], type: 'laser' }
    ],
    accessorySlots: 1,
    hull: {
      length: 18,
      stationWidths: [0.1, 0.3, 0.55, 0.8, 0.95, 0.9, 0.85, 1.0, 1.05, 0.65, 0.3, 0.12],
      stationHeights: [0.08, 0.22, 0.38, 0.5, 0.55, 0.5, 0.48, 0.55, 0.58, 0.38, 0.18, 0.1],
      crossSectionSides: 12,
      superellipseExponent: 2.0,
      wings: [
        { atStation: 6, span: 5.5, sweep: 1.1, thickness: 0.16, side: 'both', tipOffsetY: -0.12, chordScale: 1.0 },
        { atStation: 2, span: 1.6, sweep: -0.35, thickness: 0.12, side: 'top', chordScale: 0.8 }
      ],
      color: '#d4c878',
      style: {
        asymmetric: false, bridgeSide: 0, engineLayout: 'twin', hasRadiator: false,
        hasCargoPods: false, hasSensorMast: true, cockpitMount: 'top',
        radarDishes: ['top'], hasDockingRing: false, detailDensity: 1.9
      }
    }
  },
  {
    id: 'fang_mk3',
    name: 'Fang',
    role: 'fighter',
    price: 40000,
    droneBays: 1,
    stats: { hull: 80, shields: 90, armor: 20, cargoCapacity: 15, speed: 195, turnRate: 2.5, accel: 48 },
    hardpoints: [
      { id: 'fwd1', position: [-1.1, 0, 9], type: 'laser' },
      { id: 'fwd2', position: [1.1, 0, 9], type: 'missile' }
    ],
    accessorySlots: 1,
    hull: {
      // Longer arrow-fighter vs Needle Dart's needle — distinct mid swell + triple engines.
      length: 24,
      stationWidths: [0.18, 0.42, 0.72, 1.05, 1.35, 1.45, 1.25, 1.0, 0.75, 0.5, 0.28, 0.12],
      stationHeights: [0.14, 0.3, 0.48, 0.62, 0.72, 0.75, 0.65, 0.52, 0.4, 0.28, 0.16, 0.08],
      crossSectionSides: 10,
      superellipseExponent: 2.55,
      wings: [
        { atStation: 5, span: 7.4, sweep: 1.15, thickness: 0.22, side: 'both', tipOffsetY: 0.2, chordScale: 1.15 },
        { atStation: 3, span: 2.8, sweep: 0.2, thickness: 0.14, side: 'both', chordScale: 0.8 },
        { atStation: 1, span: 2.4, sweep: -0.45, thickness: 0.18, side: 'top', chordScale: 0.9 },
        { atStation: 7, span: 1.8, sweep: 0.5, thickness: 0.12, side: 'bottom', chordScale: 0.75 }
      ],
      color: '#8896a8',
      style: {
        asymmetric: false, bridgeSide: 0, engineLayout: 'triple', hasRadiator: true,
        hasCargoPods: false, hasSensorMast: true, cockpitMount: 'bottom',
        radarDishes: ['top', 'side'], hasDockingRing: false, detailDensity: 2.0
      }
    }
  },
  {
    id: 'skyhook',
    name: 'Skyhook',
    role: 'fighter',
    price: 48000,
    droneBays: 1,
    stats: { hull: 95, shields: 95, armor: 28, cargoCapacity: 18, speed: 175, turnRate: 2.3, accel: 42 },
    hardpoints: [
      { id: 'fwd1', position: [-1.3, 0.1, 9.5], type: 'laser' },
      { id: 'fwd2', position: [1.3, 0.1, 9.5], type: 'laser' },
      { id: 'fwd3', position: [0, -0.2, 8], type: 'missile' }
    ],
    accessorySlots: 2,
    hull: {
      length: 23,
      stationWidths: [0.15, 0.4, 0.75, 1.1, 1.3, 1.25, 1.2, 1.35, 1.25, 0.85, 0.45, 0.18],
      stationHeights: [0.1, 0.28, 0.48, 0.62, 0.7, 0.68, 0.65, 0.7, 0.65, 0.45, 0.24, 0.12],
      crossSectionSides: 12,
      superellipseExponent: 2.2,
      wings: [
        { atStation: 5, span: 7.0, sweep: 0.7, thickness: 0.22, side: 'both', tipOffsetY: -0.15, chordScale: 1.08 },
        { atStation: 2, span: 2.0, sweep: -0.25, thickness: 0.16, side: 'top', chordScale: 0.85 }
      ],
      color: '#708090',
      style: {
        asymmetric: false, bridgeSide: 0, engineLayout: 'triple', hasRadiator: true,
        hasCargoPods: false, hasSensorMast: true, cockpitMount: 'top',
        radarDishes: ['top', 'side'], hasDockingRing: false, detailDensity: 2.15
      }
    }
  },
  {
    id: 'bulk_tender',
    name: 'Bulk Tender',
    role: 'trader',
    price: 28000,
    droneBays: 1,
    stats: { hull: 140, shields: 40, armor: 45, cargoCapacity: 160, speed: 75, turnRate: 0.95, accel: 16 },
    hardpoints: [{ id: 'fwd1', position: [0, 0.4, 11], type: 'laser' }],
    accessorySlots: 2,
    hull: {
      length: 32,
      stationWidths: [0.5, 0.9, 1.4, 1.8, 2.0, 2.05, 2.0, 1.85, 1.5, 1.0, 0.55, 0.3],
      stationHeights: [0.4, 0.7, 1.0, 1.2, 1.3, 1.32, 1.28, 1.15, 0.95, 0.65, 0.35, 0.2],
      crossSectionSides: 10,
      superellipseExponent: 3.0,
      wings: [
        { atStation: 4, span: 3.5, sweep: 0.2, thickness: 0.3, side: 'both', chordScale: 0.9 }
      ],
      color: '#8a7860',
      style: {
        asymmetric: false, bridgeSide: 0, engineLayout: 'twin', hasRadiator: true,
        hasCargoPods: true, hasSensorMast: false, cockpitMount: 'top',
        radarDishes: ['top'], hasDockingRing: true, detailDensity: 1.8
      }
    }
  },
  {
    id: 'vault_barge',
    name: 'Vault Barge',
    role: 'trader',
    price: 36000,
    droneBays: 1,
    stats: { hull: 170, shields: 35, armor: 55, cargoCapacity: 220, speed: 65, turnRate: 0.8, accel: 12 },
    hardpoints: [
      { id: 'fwd1', position: [0, 0.5, 13], type: 'laser' },
      { id: 'fwd2', position: [0, -0.2, 10], type: 'missile' }
    ],
    accessorySlots: 2,
    hull: {
      length: 38,
      stationWidths: [0.6, 1.1, 1.6, 2.1, 2.35, 2.4, 2.35, 2.15, 1.75, 1.2, 0.7, 0.35],
      stationHeights: [0.45, 0.8, 1.15, 1.4, 1.5, 1.52, 1.48, 1.35, 1.1, 0.75, 0.4, 0.22],
      crossSectionSides: 10,
      superellipseExponent: 3.2,
      wings: [
        { atStation: 5, span: 4.0, sweep: 0.15, thickness: 0.35, side: 'both', chordScale: 0.95 }
      ],
      color: '#7a6a52',
      style: {
        asymmetric: false, bridgeSide: 0, engineLayout: 'twin', hasRadiator: true,
        hasCargoPods: true, hasSensorMast: true, cockpitMount: 'top',
        radarDishes: ['top'], hasDockingRing: true, detailDensity: 1.7
      }
    }
  },
  {
    id: 'merchant_prince',
    name: 'Merchant Prince',
    role: 'trader',
    price: 48000,
    droneBays: 2,
    stats: { hull: 160, shields: 55, armor: 50, cargoCapacity: 200, speed: 85, turnRate: 1.05, accel: 18 },
    hardpoints: [
      { id: 'fwd1', position: [-1.2, 0.3, 12], type: 'laser' },
      { id: 'fwd2', position: [1.2, 0.3, 12], type: 'laser' }
    ],
    accessorySlots: 3,
    hull: {
      length: 36,
      stationWidths: [0.45, 0.95, 1.45, 1.9, 2.15, 2.2, 2.1, 1.9, 1.55, 1.05, 0.6, 0.3],
      stationHeights: [0.35, 0.7, 1.05, 1.3, 1.4, 1.42, 1.35, 1.2, 0.95, 0.65, 0.35, 0.18],
      crossSectionSides: 12,
      superellipseExponent: 2.9,
      wings: [
        { atStation: 5, span: 4.5, sweep: 0.3, thickness: 0.28, side: 'both', chordScale: 1.0 },
        { atStation: 2, span: 1.8, sweep: -0.2, thickness: 0.2, side: 'top', chordScale: 0.8 }
      ],
      color: '#9a8a6a',
      style: {
        asymmetric: false, bridgeSide: 0, engineLayout: 'triple', hasRadiator: true,
        hasCargoPods: true, hasSensorMast: true, cockpitMount: 'top',
        radarDishes: ['top', 'side'], hasDockingRing: true, detailDensity: 2.0
      }
    }
  },
  {
    id: 'caravan_king',
    name: 'Caravan King',
    role: 'trader',
    price: 62000,
    droneBays: 2,
    stats: { hull: 190, shields: 60, armor: 65, cargoCapacity: 280, speed: 70, turnRate: 0.85, accel: 14 },
    hardpoints: [
      { id: 'fwd1', position: [0, 0.45, 14], type: 'laser' },
      { id: 'fwd2', position: [0, -0.25, 11], type: 'missile' }
    ],
    accessorySlots: 3,
    hull: {
      length: 42,
      stationWidths: [0.55, 1.15, 1.7, 2.25, 2.55, 2.6, 2.5, 2.25, 1.85, 1.25, 0.75, 0.38],
      stationHeights: [0.4, 0.85, 1.2, 1.5, 1.6, 1.62, 1.55, 1.4, 1.15, 0.8, 0.45, 0.24],
      crossSectionSides: 10,
      superellipseExponent: 3.1,
      wings: [
        { atStation: 4, span: 5.0, sweep: 0.2, thickness: 0.38, side: 'both', chordScale: 1.0 },
        { atStation: 7, span: 2.5, sweep: 0.35, thickness: 0.22, side: 'both', chordScale: 0.85 }
      ],
      color: '#6a5a48',
      style: {
        asymmetric: false, bridgeSide: 0, engineLayout: 'triple', hasRadiator: true,
        hasCargoPods: true, hasSensorMast: true, cockpitMount: 'top',
        radarDishes: ['top', 'bottom'], hasDockingRing: true, detailDensity: 1.85
      }
    }
  },

  // --- Mining hulls (role: miner) — huge ore holds, tiny cargo, weak combat ---
  // miningCapacity set explicitly (200 → 2000). cargoCapacity is final (no scale
  // pass); max 40. Small hulls: 0 accessory slots; larger: 1. Slow and fragile.
  // Prices scale super-linearly with hold size — big rigs are late-game buys.
  {
    id: 'ore_skiff',
    name: 'Ore Skiff',
    role: 'miner',
    price: 14000,
    droneBays: 0,
    stats: {
      hull: 48, shields: 16, armor: 8, cargoCapacity: 12, miningCapacity: 200,
      speed: 58, turnRate: 0.72, accel: 12
    },
    hardpoints: [{ id: 'fwd1', position: [0, 0.2, 7.5], type: 'laser' }],
    accessorySlots: 0,
    hull: {
      // Compact tug-skiff: fat rear drive, skinny scoop nose.
      length: 15,
      stationWidths: [1.15, 1.4, 1.55, 1.35, 1.1, 0.95, 0.85, 0.75, 0.65, 0.55, 0.4, 0.28],
      stationHeights: [0.95, 1.15, 1.25, 1.1, 0.9, 0.78, 0.7, 0.62, 0.55, 0.45, 0.32, 0.22],
      crossSectionSides: 6,
      superellipseExponent: 2.4,
      wings: [
        { atStation: 2, span: 1.9, sweep: -0.25, thickness: 0.32, side: 'both', chordScale: 0.85 },
        { atStation: 6, span: 1.1, sweep: 0.35, thickness: 0.18, side: 'bottom', chordScale: 0.75 }
      ],
      color: '#b89858',
      style: {
        asymmetric: false, bridgeSide: 0, engineLayout: 'single', hasRadiator: false,
        hasCargoPods: false, hasSensorMast: false, cockpitMount: 'top',
        radarDishes: ['top'], hasDockingRing: false, detailDensity: 1.6,
        miningRig: true, visualKit: 2, platingStyle: 'sparse', archetype: 'skiff'
      }
    }
  },
  {
    id: 'lode_seeker',
    name: 'Lode Seeker',
    role: 'miner',
    price: 28000,
    droneBays: 0,
    stats: {
      hull: 58, shields: 18, armor: 10, cargoCapacity: 16, miningCapacity: 450,
      speed: 52, turnRate: 0.65, accel: 11
    },
    hardpoints: [{ id: 'fwd1', position: [0, 0.25, 8.5], type: 'laser' }],
    accessorySlots: 0,
    hull: {
      // Needle-prospector: long thin survey profile with side vanes.
      length: 22,
      stationWidths: [0.55, 0.75, 0.95, 1.15, 1.35, 1.45, 1.4, 1.2, 0.95, 0.7, 0.45, 0.25],
      stationHeights: [0.5, 0.65, 0.8, 0.95, 1.1, 1.2, 1.15, 1.0, 0.8, 0.55, 0.35, 0.2],
      crossSectionSides: 10,
      superellipseExponent: 1.9,
      wings: [
        { atStation: 5, span: 2.6, sweep: 0.55, thickness: 0.22, side: 'both', chordScale: 1.1 },
        { atStation: 3, span: 1.4, sweep: -0.3, thickness: 0.18, side: 'top', chordScale: 0.8 },
        { atStation: 8, span: 1.0, sweep: 0.2, thickness: 0.15, side: 'both', chordScale: 0.7 }
      ],
      color: '#6a8a78',
      style: {
        asymmetric: false, bridgeSide: 0, engineLayout: 'twin', hasRadiator: true,
        hasCargoPods: false, hasSensorMast: true, cockpitMount: 'top',
        radarDishes: ['top', 'bottom'], hasDockingRing: false, detailDensity: 2.0,
        miningRig: true, visualKit: 9, platingStyle: 'ribs', archetype: 'prospector'
      }
    }
  },
  {
    id: 'claim_jumper',
    name: 'Claim Jumper',
    role: 'miner',
    price: 48000,
    droneBays: 0,
    stats: {
      hull: 68, shields: 20, armor: 12, cargoCapacity: 20, miningCapacity: 700,
      speed: 48, turnRate: 0.58, accel: 10
    },
    hardpoints: [{ id: 'fwd1', position: [0, 0.3, 9.5], type: 'laser' }],
    accessorySlots: 0,
    hull: {
      // Asymmetric claim-runner: offset bridge, chunky mid hopper.
      length: 23,
      stationWidths: [0.9, 1.3, 1.8, 2.2, 2.55, 2.5, 2.1, 1.7, 1.3, 0.95, 0.65, 0.4],
      stationHeights: [0.7, 1.0, 1.35, 1.7, 2.0, 1.95, 1.6, 1.25, 0.95, 0.7, 0.48, 0.3],
      crossSectionSides: 8,
      superellipseExponent: 3.4,
      stationOffsetsX: [0, 0.05, 0.12, 0.18, 0.22, 0.2, 0.14, 0.08, 0.04, 0, 0, 0],
      wings: [
        { atStation: 4, span: 2.8, sweep: 0.2, thickness: 0.4, side: 'left', chordScale: 1.05 },
        { atStation: 5, span: 1.6, sweep: -0.1, thickness: 0.28, side: 'right', chordScale: 0.9 },
        { atStation: 2, span: 1.5, sweep: -0.35, thickness: 0.25, side: 'top', chordScale: 0.85 }
      ],
      color: '#8a5a48',
      style: {
        asymmetric: true, bridgeSide: 1, engineLayout: 'triple', hasRadiator: true,
        hasCargoPods: false, hasSensorMast: true, cockpitMount: 'bottom',
        radarDishes: ['top', 'side'], hasDockingRing: false, detailDensity: 2.4,
        miningRig: true, visualKit: 14, platingStyle: 'sponsons', archetype: 'claim'
      }
    }
  },
  {
    id: 'rockhound',
    name: 'Rockhound',
    role: 'miner',
    price: 75000,
    droneBays: 0,
    stats: {
      hull: 78, shields: 22, armor: 14, cargoCapacity: 24, miningCapacity: 950,
      speed: 45, turnRate: 0.52, accel: 9
    },
    hardpoints: [{ id: 'fwd1', position: [0, 0.3, 10.5], type: 'laser' }],
    accessorySlots: 0,
    hull: {
      // Boxy ore-dog: squared cargo block, stub wings.
      length: 26,
      stationWidths: [1.4, 1.9, 2.4, 2.7, 2.85, 2.85, 2.7, 2.4, 1.9, 1.35, 0.85, 0.45],
      stationHeights: [1.2, 1.55, 1.9, 2.15, 2.25, 2.25, 2.1, 1.85, 1.45, 1.0, 0.6, 0.35],
      crossSectionSides: 4,
      superellipseExponent: 4.5,
      wings: [
        { atStation: 3, span: 1.8, sweep: 0.05, thickness: 0.45, side: 'both', chordScale: 1.15 },
        { atStation: 6, span: 2.2, sweep: 0.0, thickness: 0.5, side: 'bottom', chordScale: 1.2 },
        { atStation: 1, span: 1.2, sweep: -0.4, thickness: 0.3, side: 'top', chordScale: 0.9 }
      ],
      color: '#5a6870',
      style: {
        asymmetric: false, bridgeSide: 0, engineLayout: 'quad', hasRadiator: true,
        hasCargoPods: false, hasSensorMast: true, cockpitMount: 'top',
        radarDishes: ['top'], hasDockingRing: true, detailDensity: 2.6,
        miningRig: true, visualKit: 18, platingStyle: 'clamshell', archetype: 'boxer'
      }
    }
  },
  {
    id: 'strip_miner',
    name: 'Strip Miner',
    role: 'miner',
    price: 120000,
    droneBays: 0,
    stats: {
      hull: 90, shields: 24, armor: 16, cargoCapacity: 28, miningCapacity: 1200,
      speed: 42, turnRate: 0.48, accel: 8
    },
    hardpoints: [{ id: 'fwd1', position: [0, 0.35, 11.5], type: 'laser' }],
    accessorySlots: 1,
    hull: {
      // Wide flat strip-barge: low height, broad mid, wing platforms.
      length: 34,
      stationWidths: [1.1, 1.7, 2.5, 3.2, 3.6, 3.7, 3.5, 3.0, 2.3, 1.6, 1.0, 0.55],
      stationHeights: [0.7, 0.95, 1.2, 1.35, 1.4, 1.38, 1.3, 1.15, 0.95, 0.7, 0.45, 0.28],
      crossSectionSides: 12,
      superellipseExponent: 3.0,
      wings: [
        { atStation: 5, span: 4.2, sweep: 0.0, thickness: 0.35, side: 'both', chordScale: 1.25 },
        { atStation: 4, span: 3.0, sweep: 0.15, thickness: 0.3, side: 'both', chordScale: 1.0 },
        { atStation: 7, span: 2.0, sweep: 0.25, thickness: 0.25, side: 'bottom', chordScale: 0.9 }
      ],
      color: '#c4a060',
      style: {
        asymmetric: false, bridgeSide: 0, engineLayout: 'twin', hasRadiator: true,
        hasCargoPods: false, hasSensorMast: true, cockpitMount: 'top',
        radarDishes: ['top', 'bottom'], hasDockingRing: true, detailDensity: 2.1,
        miningRig: true, visualKit: 22, platingStyle: 'belts', archetype: 'strip'
      }
    }
  },
  {
    id: 'deep_vein',
    name: 'Deep Vein',
    role: 'miner',
    price: 185000,
    droneBays: 0,
    stats: {
      hull: 100, shields: 26, armor: 18, cargoCapacity: 32, miningCapacity: 1500,
      speed: 40, turnRate: 0.45, accel: 8
    },
    hardpoints: [{ id: 'fwd1', position: [0, 0.4, 12.5], type: 'laser' }],
    accessorySlots: 1,
    hull: {
      // Tall vertical ore silo hull — height-dominant silhouette.
      length: 33,
      stationWidths: [1.0, 1.4, 1.9, 2.3, 2.55, 2.6, 2.45, 2.1, 1.65, 1.15, 0.75, 0.4],
      stationHeights: [1.4, 1.9, 2.5, 3.0, 3.3, 3.35, 3.1, 2.6, 2.0, 1.4, 0.9, 0.5],
      crossSectionSides: 8,
      superellipseExponent: 2.6,
      wings: [
        { atStation: 4, span: 2.2, sweep: 0.4, thickness: 0.55, side: 'both', tipOffsetY: -0.4, chordScale: 0.95 },
        { atStation: 6, span: 1.8, sweep: -0.2, thickness: 0.4, side: 'top', chordScale: 0.85 },
        { atStation: 2, span: 2.5, sweep: -0.1, thickness: 0.45, side: 'bottom', chordScale: 1.05 }
      ],
      color: '#4a5a6a',
      style: {
        asymmetric: false, bridgeSide: 0, engineLayout: 'triple', hasRadiator: true,
        hasCargoPods: false, hasSensorMast: true, cockpitMount: 'top',
        radarDishes: ['top', 'side'], hasDockingRing: false, detailDensity: 2.8,
        miningRig: true, visualKit: 25, platingStyle: 'spine', archetype: 'silo'
      }
    }
  },
  {
    id: 'extraction_rig',
    name: 'Extraction Rig',
    role: 'miner',
    price: 280000,
    droneBays: 1,
    stats: {
      hull: 115, shields: 28, armor: 20, cargoCapacity: 36, miningCapacity: 1750,
      speed: 37, turnRate: 0.42, accel: 7
    },
    hardpoints: [{ id: 'fwd1', position: [0, 0.4, 13.5], type: 'laser' }],
    accessorySlots: 1,
    hull: {
      // Modular stack: pinched waist between ore modules, offset boom.
      length: 42,
      stationWidths: [1.6, 2.4, 2.9, 2.2, 3.2, 3.6, 2.5, 3.4, 2.8, 1.8, 1.1, 0.6],
      stationHeights: [1.2, 1.7, 2.1, 1.6, 2.3, 2.6, 1.8, 2.4, 2.0, 1.3, 0.8, 0.4],
      crossSectionSides: 10,
      superellipseExponent: 3.6,
      stationOffsetsX: [0, -0.1, -0.15, 0.05, 0.2, 0.18, -0.1, -0.15, 0.05, 0.1, 0, 0],
      wings: [
        { atStation: 5, span: 3.8, sweep: 0.1, thickness: 0.5, side: 'left', chordScale: 1.1 },
        { atStation: 7, span: 3.2, sweep: 0.25, thickness: 0.42, side: 'right', chordScale: 1.0 },
        { atStation: 3, span: 2.0, sweep: -0.3, thickness: 0.35, side: 'top', chordScale: 0.9 },
        { atStation: 6, span: 2.6, sweep: 0.05, thickness: 0.4, side: 'bottom', chordScale: 1.05 }
      ],
      color: '#7a4838',
      style: {
        asymmetric: true, bridgeSide: -1, engineLayout: 'quad', hasRadiator: true,
        hasCargoPods: false, hasSensorMast: true, cockpitMount: 'bottom',
        radarDishes: ['top', 'bottom', 'side'], hasDockingRing: true, detailDensity: 2.9,
        miningRig: true, visualKit: 28, platingStyle: 'lattice', archetype: 'rig'
      }
    }
  },
  {
    id: 'motherlode',
    name: 'Motherlode',
    role: 'miner',
    price: 420000,
    droneBays: 1,
    stats: {
      hull: 130, shields: 30, armor: 22, cargoCapacity: 40, miningCapacity: 2000,
      speed: 34, turnRate: 0.38, accel: 6
    },
    hardpoints: [{ id: 'fwd1', position: [0, 0.45, 14.5], type: 'laser' }],
    accessorySlots: 1,
    hull: {
      // Mega barge: blunt cylinder with massive mid belly and aft thruster block.
      length: 48,
      stationWidths: [2.2, 2.8, 3.4, 3.9, 4.2, 4.25, 4.1, 3.7, 3.0, 2.1, 1.3, 0.7],
      stationHeights: [1.6, 2.1, 2.6, 3.0, 3.25, 3.3, 3.15, 2.8, 2.2, 1.5, 0.95, 0.5],
      crossSectionSides: 14,
      superellipseExponent: 3.8,
      wings: [
        { atStation: 4, span: 5.0, sweep: -0.05, thickness: 0.6, side: 'both', chordScale: 1.3 },
        { atStation: 6, span: 3.5, sweep: 0.1, thickness: 0.5, side: 'both', chordScale: 1.1 },
        { atStation: 2, span: 2.8, sweep: -0.2, thickness: 0.45, side: 'top', chordScale: 0.95 },
        { atStation: 7, span: 3.2, sweep: 0.15, thickness: 0.48, side: 'bottom', chordScale: 1.15 },
        { atStation: 9, span: 1.8, sweep: 0.3, thickness: 0.3, side: 'both', chordScale: 0.8 }
      ],
      color: '#3a2e28',
      style: {
        asymmetric: false, bridgeSide: 0, engineLayout: 'quad', hasRadiator: true,
        hasCargoPods: false, hasSensorMast: true, cockpitMount: 'top',
        radarDishes: ['top', 'bottom', 'side'], hasDockingRing: true, detailDensity: 3.0,
        miningRig: true, visualKit: 31, platingStyle: 'scales', archetype: 'mothership'
      }
    }
  }
]

export const STARTER_SHIP_CLASS_ID = 'light_runner'
// 3× prior (was 15) with the mining-hold triple pass — still below
// computeMiningCapacity's floor so the starter stays the smallest hold.
const STARTER_MINING_CAPACITY = 45

for (let i = 0; i < HAND_CRAFTED_SHIP_CLASSES.length; i++) {
  const c = HAND_CRAFTED_SHIP_CLASSES[i]
  c.droneBays ??= 0
  // Explicit miningCapacity (miners, starter) is kept as authored.
  if (c.stats.miningCapacity == null) {
    c.stats.miningCapacity =
      c.id === STARTER_SHIP_CLASS_ID
        ? STARTER_MINING_CAPACITY
        : computeMiningCapacity(c.price, c.role)
  }
  // Stable per-class visual kit so hand-crafted meshes don't share one detail layout.
  c.hull.style ??= {}
  if (c.hull.style.visualKit == null) {
    // Spread across 0–31; role offset keeps same-role hulls from clustering kits.
    const roleOff =
      c.role === 'fighter' ? 3 : c.role === 'trader' ? 7 : c.role === 'explorer' ? 11 : c.role === 'miner' ? 17 : 0
    c.hull.style.visualKit = (i * 5 + roleOff) % 32
  }
  if (c.hull.style.platingStyle == null) {
    const platings = ['belts', 'sparse', 'spine', 'sponsons', 'scales', 'ribs', 'clamshell', 'lattice']
    c.hull.style.platingStyle = platings[(i * 3 + (c.role?.length ?? 0)) % platings.length]
  }
}

// Hand-crafted archetypes + drone-bay hulls; remainder generated to fill the roster.
// Seed bump re-rolls gen silhouettes when uniqueness / archetype system changes.
const SHIP_ROSTER_SEED = 918273731
const GENERATED_SHIP_CLASSES = generateShipClassRoster(mulberry32(SHIP_ROSTER_SEED), 82, {
  priorHulls: HAND_CRAFTED_SHIP_CLASSES.map((c) => c.hull),
  // Keep generated display names unique against hand-crafted models.
  priorNames: HAND_CRAFTED_SHIP_CLASSES.map((c) => c.name)
})

/**
 * Alien hulls — organic / non-human silhouettes. Never sold in shipyards
 * (npcOnly + alien). Craft only from extremely rare alien wreck blueprints.
 * Stats are competitive with mid–high human hulls; look is the main differentiator.
 */
export const ALIEN_SHIP_CLASSES = [
  {
    id: 'void_cyst',
    name: 'Void Cyst',
    role: 'fighter',
    price: 48000,
    alien: true,
    npcOnly: true,
    faction: 'alien',
    droneBays: 0,
    stats: { hull: 85, shields: 95, armor: 15, cargoCapacity: 12, speed: 200, turnRate: 2.6, accel: 50 },
    hardpoints: [
      { id: 'fwd1', position: [-0.8, 0.4, 7.5], type: 'laser' },
      { id: 'fwd2', position: [0.8, 0.4, 7.5], type: 'laser' }
    ],
    accessorySlots: 1,
    hull: {
      length: 16,
      // Bulbous cyst: fat mid, pinched "mouth", stub tail.
      stationWidths: [0.45, 0.9, 1.6, 2.1, 2.35, 2.2, 1.8, 1.3, 0.9, 0.55, 0.4, 0.55],
      stationHeights: [0.5, 1.0, 1.7, 2.2, 2.4, 2.15, 1.7, 1.2, 0.85, 0.55, 0.4, 0.5],
      crossSectionSides: 11,
      superellipseExponent: 1.55,
      wings: [
        { atStation: 5, span: 2.8, sweep: 0.7, thickness: 0.55, side: 'both', tipOffsetY: 0.6, chordScale: 1.2 },
        { atStation: 3, span: 1.4, sweep: -0.4, thickness: 0.4, side: 'top', tipOffsetX: 0.3, chordScale: 0.7 },
        { atStation: 7, span: 1.9, sweep: 0.5, thickness: 0.45, side: 'bottom', chordScale: 0.85 }
      ],
      stationOffsetsX: [0, 0.05, 0.12, 0.08, 0, -0.1, -0.18, -0.12, 0, 0.06, 0.1, 0],
      stationOffsetsY: [0.1, 0.15, 0.2, 0.12, 0, -0.08, -0.12, -0.05, 0.05, 0.12, 0.18, 0.1],
      color: '#3a6b4a',
      style: {
        alien: true,
        asymmetric: true,
        bridgeSide: 1,
        engineLayout: 'organic',
        hasRadiator: false,
        hasCargoPods: false,
        hasSensorMast: false,
        detailDensity: 2.4
      }
    }
  },
  {
    id: 'spine_skimmer',
    name: 'Spine Skimmer',
    role: 'fighter',
    price: 62000,
    alien: true,
    npcOnly: true,
    faction: 'alien',
    droneBays: 0,
    stats: { hull: 65, shields: 70, armor: 8, cargoCapacity: 8, speed: 260, turnRate: 3.1, accel: 62 },
    hardpoints: [
      { id: 'fwd1', position: [0, 0.2, 11], type: 'laser' },
      { id: 'fwd2', position: [0, -0.3, 10.5], type: 'missile' }
    ],
    accessorySlots: 1,
    hull: {
      length: 28,
      // Needle-spine: long thin body with staggered "vertebrae" offsets.
      stationWidths: [0.25, 0.35, 0.45, 0.55, 0.7, 0.85, 0.75, 0.55, 0.4, 0.3, 0.22, 0.18],
      stationHeights: [0.3, 0.45, 0.55, 0.7, 0.9, 1.1, 0.95, 0.7, 0.5, 0.35, 0.25, 0.2],
      crossSectionSides: 7,
      superellipseExponent: 1.3,
      wings: [
        { atStation: 4, span: 3.5, sweep: 1.1, thickness: 0.22, side: 'both', tipOffsetY: -0.8, chordScale: 0.55 },
        { atStation: 6, span: 2.6, sweep: 0.9, thickness: 0.2, side: 'both', tipOffsetY: 0.9, chordScale: 0.5 },
        { atStation: 2, span: 1.8, sweep: -0.6, thickness: 0.25, side: 'top', chordScale: 0.6 },
        { atStation: 8, span: 1.2, sweep: 0.4, thickness: 0.18, side: 'bottom', chordScale: 0.45 }
      ],
      stationOffsetsX: [0, 0.15, -0.2, 0.25, -0.15, 0.1, -0.22, 0.18, -0.1, 0.08, 0, 0],
      stationOffsetsY: [0.2, 0.1, 0, -0.1, 0.05, 0.15, 0.05, -0.1, -0.15, -0.05, 0.1, 0.2],
      color: '#5a3a78',
      style: {
        alien: true,
        asymmetric: true,
        bridgeSide: -1,
        engineLayout: 'organic',
        hasRadiator: false,
        hasCargoPods: false,
        hasSensorMast: false,
        detailDensity: 2.6
      }
    }
  },
  {
    id: 'chor_lathe',
    name: 'Chor Lathe',
    role: 'explorer',
    price: 88000,
    alien: true,
    npcOnly: true,
    faction: 'alien',
    droneBays: 1,
    stats: { hull: 140, shields: 100, armor: 35, cargoCapacity: 35, speed: 140, turnRate: 1.6, accel: 32 },
    hardpoints: [
      { id: 'fwd1', position: [-1.5, 0.5, 8], type: 'laser' },
      { id: 'fwd2', position: [1.5, 0.5, 8], type: 'laser' },
      { id: 'fwd3', position: [0, -0.4, 7.5], type: 'missile' }
    ],
    accessorySlots: 2,
    hull: {
      length: 22,
      // Disc midsection (lathe) with flared rim and recessed core.
      stationWidths: [0.6, 1.0, 1.8, 2.8, 3.4, 3.6, 3.3, 2.6, 1.6, 0.9, 0.5, 0.35],
      stationHeights: [0.5, 0.7, 0.9, 1.1, 1.2, 1.15, 1.0, 0.85, 0.7, 0.55, 0.4, 0.3],
      crossSectionSides: 16,
      superellipseExponent: 2.6,
      wings: [
        { atStation: 5, span: 4.2, sweep: 0.15, thickness: 0.5, side: 'both', tipOffsetY: 0.2, chordScale: 1.4 },
        { atStation: 5, span: 3.0, sweep: 0.1, thickness: 0.35, side: 'top', chordScale: 1.1 },
        { atStation: 5, span: 2.5, sweep: 0.1, thickness: 0.35, side: 'bottom', chordScale: 1.0 },
        { atStation: 2, span: 1.5, sweep: -0.5, thickness: 0.3, side: 'both', chordScale: 0.7 }
      ],
      stationOffsetsX: [0, 0, 0.05, 0.1, 0, -0.05, 0, 0.08, 0, 0, 0, 0],
      stationOffsetsY: [0, 0.05, 0.08, 0.05, 0, -0.05, 0, 0.05, 0.08, 0.05, 0, 0],
      color: '#2a5a5e',
      style: {
        alien: true,
        asymmetric: false,
        bridgeSide: 0,
        engineLayout: 'organic',
        hasRadiator: false,
        hasCargoPods: false,
        hasSensorMast: false,
        detailDensity: 2.2
      }
    }
  },
  {
    id: 'zealot_carapace',
    name: 'Zealot Carapace',
    role: 'fighter',
    price: 125000,
    alien: true,
    npcOnly: true,
    faction: 'alien',
    droneBays: 1,
    stats: { hull: 220, shields: 120, armor: 70, cargoCapacity: 28, speed: 100, turnRate: 1.2, accel: 24 },
    hardpoints: [
      { id: 'fwd1', position: [-1.8, 0.6, 9], type: 'laser' },
      { id: 'fwd2', position: [1.8, 0.6, 9], type: 'laser' },
      { id: 'fwd3', position: [0, 1.0, 8], type: 'missile' },
      { id: 'fwd4', position: [0, -0.5, 8.5], type: 'missile' }
    ],
    accessorySlots: 2,
    hull: {
      length: 26,
      // Heavy beetle shell: tall dorsal hump, armored plates, blunt snout.
      stationWidths: [1.0, 1.6, 2.4, 3.0, 3.3, 3.4, 3.2, 2.8, 2.2, 1.5, 1.0, 0.7],
      stationHeights: [1.2, 1.8, 2.4, 2.9, 3.2, 3.3, 3.0, 2.5, 1.9, 1.3, 0.9, 0.6],
      crossSectionSides: 9,
      superellipseExponent: 1.8,
      wings: [
        { atStation: 4, span: 2.2, sweep: 0.3, thickness: 0.7, side: 'both', tipOffsetY: -0.4, chordScale: 1.3 },
        { atStation: 6, span: 1.8, sweep: 0.2, thickness: 0.6, side: 'both', tipOffsetY: 0.3, chordScale: 1.1 },
        { atStation: 3, span: 2.0, sweep: -0.2, thickness: 0.55, side: 'top', chordScale: 1.2 },
        { atStation: 7, span: 1.4, sweep: 0.4, thickness: 0.5, side: 'bottom', chordScale: 0.9 }
      ],
      stationOffsetsX: [0, 0.08, 0.12, 0.05, 0, -0.08, -0.12, -0.05, 0.05, 0.1, 0.05, 0],
      stationOffsetsY: [0.15, 0.2, 0.25, 0.2, 0.1, 0, -0.05, 0, 0.1, 0.15, 0.1, 0.05],
      color: '#6b2a3a',
      style: {
        alien: true,
        asymmetric: true,
        bridgeSide: 1,
        engineLayout: 'organic',
        hasRadiator: false,
        hasCargoPods: false,
        hasSensorMast: false,
        detailDensity: 2.5
      }
    }
  }
]

for (const c of ALIEN_SHIP_CLASSES) {
  c.droneBays ??= 0
  if (c.stats.miningCapacity == null) {
    c.stats.miningCapacity = computeMiningCapacity(c.price, c.role)
  }
}

/**
 * Scale cargo holds so large freighters gain the most (old 280 → ~700) while
 * light fighters only step up modestly. Applied once after the roster is built.
 * Curve: mult = 1.4 + (old/280)×1.1  →  1.4× … 2.5×.
 * Mining hulls skip this — their tiny cargo (max 40) is authored as final.
 */
export function scaleCargoCapacity(old) {
  const c = Math.max(0, Math.floor(Number(old) || 0))
  if (c <= 0) return c
  const t = Math.min(1, c / 280)
  const mult = 1.4 + t * 1.1
  return Math.max(1, Math.round(c * mult))
}

export const SHIP_CLASSES = [
  ...HAND_CRAFTED_SHIP_CLASSES,
  ...GENERATED_SHIP_CLASSES,
  ...ALIEN_SHIP_CLASSES
]

// One-shot cargo pass — hand-crafted, generated, and alien hulls (not miners).
for (const c of SHIP_CLASSES) {
  if (!c?.stats || c.role === 'miner') continue
  c.stats.cargoCapacity = scaleCargoCapacity(c.stats.cargoCapacity)
}

// Within each role, expensive hulls must outclass cheaper ones (power score).
// Runs after cargo scale so final shop stats are ordered by price.
// A few passes clear residual inversions after scaling cascades.
for (let pass = 0; pass < 4; pass++) {
  balancePurchasableShipsByRole(SHIP_CLASSES)
}

// Re-sync mining holds for non-miners after any cargo/stat balance (price-based).
for (const c of SHIP_CLASSES) {
  if (!c?.stats || c.role === 'miner') continue
  if (c.id === STARTER_SHIP_CLASS_ID) continue
  // Starter hold is authored; other non-miners stay price-linked.
  c.stats.miningCapacity = computeMiningCapacity(c.price, c.role)
}

/**
 * Old display-name renames (legacy scrub + freighter/hauler).
 * Saves / blueprints / missions may still store the previous ids.
 */
export const SHIP_CLASS_ID_ALIASES = {
  hauler: 'hold_runner',
  interceptor: 'needle_dart',
  corvette: 'gun_barge',
  scout: 'light_runner',
  clipper: 'swift_keel',
  odyssey: 'far_reach',
  viper_mk3: 'fang_mk3',
  raptor: 'skyhook',
  freighter_mk1: 'bulk_tender',
  bulk_hauler: 'vault_barge',
  argosy: 'caravan_king',
  prospector: 'lode_seeker'
}

/** Map a legacy or current class id to the live roster id. */
export function resolveShipClassId(id) {
  if (id == null || id === '') return id
  return SHIP_CLASS_ID_ALIASES[id] ?? id
}

/** Fallback when a save references a generated hull from an older roster seed. */
function fallbackShipClass(id) {
  // Prefer a mid-tier trader so orphaned gen hulls remain usable.
  return (
    SHIP_CLASSES.find((c) => c.id === 'hold_runner') ||
    SHIP_CLASSES.find((c) => c.role === 'trader' && !c.npcOnly && !c.alien) ||
    SHIP_CLASSES.find((c) => !c.npcOnly && !c.alien) ||
    SHIP_CLASSES[0]
  )
}

export function getShipClass(id) {
  const resolved = resolveShipClassId(id)
  let cls = SHIP_CLASSES.find((c) => c.id === resolved)
  if (!cls && typeof id === 'string' && id.startsWith('gen_')) {
    cls = fallbackShipClass(id)
  }
  if (!cls) throw new Error(`Unknown ship class: ${id}`)
  return cls
}

/** Largest cargoCapacity among all ship classes (trade mission haul caps). */
export function maxShipCargoCapacity() {
  let max = 80
  for (const c of SHIP_CLASSES) {
    const n = Math.floor(Number(c?.stats?.cargoCapacity) || 0)
    if (n > max) max = n
  }
  return max
}

export function isAlienShipClass(shipClassOrId) {
  if (!shipClassOrId) return false
  if (typeof shipClassOrId === 'string') {
    try {
      return !!getShipClass(shipClassOrId).alien
    } catch {
      return false
    }
  }
  return !!shipClassOrId.alien
}

/** Human/police market ships only — never alien tech. Sorted cheapest → dearest. */
export function purchasableShipClasses() {
  return SHIP_CLASSES
    .filter((c) => !c.npcOnly && !c.alien)
    .slice()
    .sort((a, b) => (a.price - b.price) || a.name.localeCompare(b.name))
}

export function alienShipClasses() {
  return ALIEN_SHIP_CLASSES
}
