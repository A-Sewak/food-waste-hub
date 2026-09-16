// matching.js
// ---------------------------------------------------------------------------
// The explainable matching engine. In production this logic runs inside the
// "Explainable Matching Engine" AWS Lambda from the architecture diagram,
// triggered by EventBridge on new donation/demand events, using Amazon
// Location Service for real distance calculation instead of haversine.
// ---------------------------------------------------------------------------

const HIGH_VOLUME_THRESHOLD_KG = 30; // above this, institutional verification is required

function toRad(d) {
  return (d * Math.PI) / 180;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hoursUntil(iso) {
  return (new Date(iso).getTime() - Date.now()) / 3600000;
}

/**
 * Evaluate one donation against one demand request.
 * Returns feasibility (hard guardrails), a score, and human-readable
 * reasons/warnings -- mirroring the "Proposed Match" card in the deck.
 */
function evaluateMatch(donation, demand, donor, recipient) {
  const reasons = [];
  const warnings = [];
  const blockers = [];

  const hrsToExpiry = hoursUntil(donation.expiryAt);
  if (hrsToExpiry <= 0) {
    blockers.push('Donation has expired');
  } else {
    reasons.push(`Expiry window fits — item expires in ${hrsToExpiry.toFixed(1)}h`);
  }

  const distanceKm = haversineKm(donation.lat, donation.lng, recipient.lat, recipient.lng);
  if (distanceKm > recipient.serviceRadiusKm) {
    blockers.push(`Outside recipient's pickup radius (${distanceKm.toFixed(1)}km > ${recipient.serviceRadiusKm}km)`);
  } else {
    reasons.push(`Within pickup radius — ${distanceKm.toFixed(1)}km away`);
  }

  if (!recipient.storageCapability.includes(donation.storageType)) {
    blockers.push(`Storage incompatible — recipient has no "${donation.storageType}" storage capability`);
  } else {
    reasons.push(`Storage compatible — "${donation.storageType}" matches recipient capability`);
  }

  if (donation.storageType !== 'ambient' && donation.tempRange) {
    reasons.push(`Cold-chain range specified: ${donation.tempRange}`);
    if (hrsToExpiry > 0 && hrsToExpiry < 4) {
      warnings.push('Cold-chain transit-time risk — expiry window is tight, confirm pickup quickly');
    }
  }

  const conflictingAllergens = (donation.allergens || []).filter((a) =>
    (recipient.allergensToAvoid || []).includes(a)
  );
  if (conflictingAllergens.length > 0) {
    blockers.push(`Allergen conflict — contains ${conflictingAllergens.join(', ')}`);
  }

  if (donation.quantityKg > HIGH_VOLUME_THRESHOLD_KG && donor.verificationTier !== 'institutional') {
    blockers.push('High-volume donation requires institutional donor verification');
  }
  if (demand.quantityKg > HIGH_VOLUME_THRESHOLD_KG && recipient.verificationTier !== 'institutional') {
    blockers.push('High-volume request requires institutional recipient verification');
  }

  if (hrsToExpiry > 0 && hrsToExpiry < 4) {
    warnings.push(`Pickup window closes in ${hrsToExpiry.toFixed(1)}h — recipient should confirm capacity promptly`);
  }

  if (donor.reliabilityScore < 70) {
    warnings.push(`Donor reliability is ${donor.reliabilityScore}% — below the usual threshold, review recommended`);
  } else {
    reasons.push(`Donor reliability score: ${donor.reliabilityScore}% (${donor.completedHandoffs} completed handoffs)`);
  }

  reasons.push(`Capacity available — recipient can accept up to ${recipient.pickupCapacityKg}kg`);

  const feasible = blockers.length === 0;

  let score = 0;
  if (feasible) {
    score += Math.max(0, 40 - distanceKm * 2); // closer is better, up to 40 pts
    score += Math.min(30, hrsToExpiry); // more time left is better, up to 30 pts
    score += donor.reliabilityScore * 0.2; // up to 20 pts
    score += Math.min(10, (donation.quantityKg / Math.max(demand.quantityKg, 1)) * 10);
  }

  return {
    feasible,
    score: Math.round(score),
    reasons,
    warnings,
    blockers,
    distanceKm,
    hrsToExpiry,
  };
}

module.exports = { haversineKm, evaluateMatch, HIGH_VOLUME_THRESHOLD_KG };
