// db.js
// ---------------------------------------------------------------------------
// In-memory data layer standing in for Amazon DynamoDB tables.
// In production (see AWS_MAPPING.md) each top-level array below becomes a
// DynamoDB table: Donors, Recipients, Donations, DemandRequests, Matches,
// CustodyLog. The shape of each record is written to map 1:1 onto a
// DynamoDB item so swapping this file for a DynamoDB client is mechanical.
// ---------------------------------------------------------------------------

const { randomUUID } = require('crypto');

const db = {
  donors: [],
  recipients: [],
  donations: [],
  demandRequests: [],
  matches: [],
  custodyLog: [], // full audit trail: proposals, acceptances, OTP issuance, handoffs, cancellations
};

function id() {
  return randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function hoursFromNow(h) {
  return new Date(Date.now() + h * 3600 * 1000).toISOString();
}

function seed() {
  // ---- Donors (S3 "verificationDoc" field stands in for an S3 object key) ----
  const donor1 = {
    id: id(),
    name: 'Riverside Bakery Co.',
    type: 'Bakery',
    region: 'North Zone',
    lat: 12.975, lng: 79.155,
    verified: true,
    verificationTier: 'institutional', // 'none' | 'basic' | 'institutional'
    verificationDoc: 's3://food-hub-verification-docs/donors/riverside-bakery-fssai.pdf',
    completedHandoffs: 41,
    lateCancellations: 2,
    noShows: 1,
    reliabilityScore: 92,
    createdAt: nowIso(),
  };
  const donor2 = {
    id: id(),
    name: 'GreenLeaf Caterers',
    type: 'Caterer',
    region: 'South Zone',
    lat: 12.965, lng: 79.145,
    verified: true,
    verificationTier: 'institutional',
    verificationDoc: 's3://food-hub-verification-docs/donors/greenleaf-80g.pdf',
    completedHandoffs: 12,
    lateCancellations: 0,
    noShows: 0,
    reliabilityScore: 98,
    createdAt: nowIso(),
  };
  const donor3 = {
    id: id(),
    name: 'Corner Grocer Mart',
    type: 'Grocer',
    region: 'North Zone',
    lat: 12.980, lng: 79.160,
    verified: true,
    verificationTier: 'basic',
    verificationDoc: null,
    completedHandoffs: 5,
    lateCancellations: 1,
    noShows: 0,
    reliabilityScore: 78,
    createdAt: nowIso(),
  };
  db.donors.push(donor1, donor2, donor3);

  // ---- Recipients ----
  const rec1 = {
    id: id(),
    name: 'Riverside Community Kitchen',
    region: 'North Zone',
    lat: 12.978, lng: 79.150,
    verified: true,
    verificationTier: 'institutional',
    verificationDoc: 's3://food-hub-verification-docs/recipients/riverside-kitchen-ngo-reg.pdf',
    storageCapability: ['ambient', 'chilled'],
    pickupCapacityKg: 200,
    serviceRadiusKm: 10,
    allergensToAvoid: [],
    waiverAccepted: true,
    waiverAcceptedAt: nowIso(),
    createdAt: nowIso(),
  };
  const rec2 = {
    id: id(),
    name: 'Hope Shelter Trust',
    region: 'South Zone',
    lat: 12.960, lng: 79.140,
    verified: false,
    verificationTier: 'none',
    verificationDoc: null,
    storageCapability: ['ambient'], // note: cannot take frozen -> used to demo the cold-chain guardrail
    pickupCapacityKg: 50,
    serviceRadiusKm: 8,
    allergensToAvoid: ['nuts'],
    waiverAccepted: false,
    waiverAcceptedAt: null,
    createdAt: nowIso(),
  };
  const rec3 = {
    id: id(),
    name: 'East End Food Pantry',
    region: 'East Zone',
    lat: 12.990, lng: 79.170,
    verified: true,
    verificationTier: 'institutional',
    verificationDoc: 's3://food-hub-verification-docs/recipients/east-end-reg.pdf',
    storageCapability: ['ambient', 'chilled', 'frozen'],
    pickupCapacityKg: 100,
    serviceRadiusKm: 15,
    allergensToAvoid: [],
    waiverAccepted: true,
    waiverAcceptedAt: nowIso(),
    createdAt: nowIso(),
  };
  db.recipients.push(rec1, rec2, rec3);

  // ---- Donations ----
  db.donations.push(
    {
      id: id(), donorId: donor1.id, foodType: 'Bread loaves', quantityKg: 40,
      expiryAt: hoursFromNow(18), storageType: 'ambient', tempRange: null,
      allergens: ['gluten'], lat: donor1.lat, lng: donor1.lng, region: donor1.region,
      pickupWindowStart: nowIso(), pickupWindowEnd: hoursFromNow(4),
      status: 'available', createdAt: nowIso(),
    },
    {
      id: id(), donorId: donor2.id, foodType: 'Cooked rice & curry', quantityKg: 60,
      expiryAt: hoursFromNow(6), storageType: 'chilled', tempRange: '2C to 5C',
      allergens: [], lat: donor2.lat, lng: donor2.lng, region: donor2.region,
      pickupWindowStart: nowIso(), pickupWindowEnd: hoursFromNow(3),
      status: 'available', createdAt: nowIso(),
    },
    {
      id: id(), donorId: donor3.id, foodType: 'Frozen vegetables', quantityKg: 25,
      expiryAt: hoursFromNow(72), storageType: 'frozen', tempRange: '-18C to -15C',
      allergens: [], lat: donor3.lat, lng: donor3.lng, region: donor3.region,
      pickupWindowStart: nowIso(), pickupWindowEnd: hoursFromNow(12),
      status: 'available', createdAt: nowIso(),
    },
    {
      id: id(), donorId: donor2.id, foodType: 'Bread loaves', quantityKg: 50,
      expiryAt: hoursFromNow(20), storageType: 'ambient', tempRange: null,
      allergens: ['gluten'], lat: donor2.lat, lng: donor2.lng, region: donor2.region,
      pickupWindowStart: nowIso(), pickupWindowEnd: hoursFromNow(6),
      status: 'available', createdAt: nowIso(),
    },
  );

  // ---- Demand requests ----
  db.demandRequests.push(
    {
      id: id(), recipientId: rec1.id, foodType: 'Bread loaves', quantityKg: 40,
      neededBy: hoursFromNow(4), region: rec1.region, status: 'open', createdAt: nowIso(),
    },
    {
      // Intentionally asks for frozen veg while the recipient can only store ambient
      // -> demonstrates the "blocks unsafe matches" cold-chain guardrail on the board.
      id: id(), recipientId: rec2.id, foodType: 'Frozen vegetables', quantityKg: 25,
      neededBy: hoursFromNow(10), region: rec2.region, status: 'open', createdAt: nowIso(),
    },
    {
      // No compatible donor exists yet for this exact food type -> stays visible
      // on the board as unmet demand instead of disappearing (per deck: "Unmet
      // demand, visible").
      id: id(), recipientId: rec3.id, foodType: 'Canned goods', quantityKg: 30,
      neededBy: hoursFromNow(24), region: rec3.region, status: 'open', createdAt: nowIso(),
    },
  );
}

seed();

module.exports = { db, id, nowIso };
