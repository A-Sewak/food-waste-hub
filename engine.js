import { randomUUID } from 'node:crypto';
import { evaluateMatch } from './matching.js';

export function expireStaleDonations(db) {
  const now = Date.now();
  db.donations.forEach((d) => {
    if (d.status === 'available' && new Date(d.expiryAt).getTime() <= now) {
      d.status = 'expired';
    }
  });
}

export function runMatching(db) {
  expireStaleDonations(db);

  const newMatches = [];
  const openDemands = db.demandRequests.filter(
    (d) => d.status === 'open' || d.status === 'partially_matched'
  );

  for (const demand of openDemands) {
    const recipient = db.recipients.find((r) => r.id === demand.recipientId);
    if (!recipient) continue;

    const candidates = db.donations
      .filter(
        (d) =>
          d.status === 'available' &&
          d.foodType.toLowerCase() === demand.foodType.toLowerCase()
      )
      .map((d) => {
        const donor = db.donors.find((x) => x.id === d.donorId);
        const evalResult = evaluateMatch(d, demand, donor, recipient);
        return { donation: d, donor, evalResult };
      })
      .filter((c) => c.evalResult.feasible)
      .sort(
        (a, b) =>
          a.evalResult.hrsToExpiry - b.evalResult.hrsToExpiry ||
          a.evalResult.distanceKm - b.evalResult.distanceKm
      );

    if (candidates.length === 0) continue;

    let accumulated = 0;
    const chosen = [];
    for (const c of candidates) {
      if (accumulated >= demand.quantityKg) break;
      chosen.push(c);
      accumulated += c.donation.quantityKg;
    }
    if (chosen.length === 0) continue;

    const avgScore = Math.round(
      chosen.reduce((s, c) => s + c.evalResult.score, 0) / chosen.length
    );

    const reasons =
      chosen.length > 1
        ? [
            `Batch-aggregated ${chosen.length} donations to meet the ${demand.quantityKg}kg request (${chosen
              .map((c) => `${c.donation.quantityKg}kg`)
              .join(' + ')} = ${accumulated}kg)`,
            ...new Set(chosen.flatMap((c) => c.evalResult.reasons)),
          ]
        : chosen[0].evalResult.reasons;

    const warnings = [...new Set(chosen.flatMap((c) => c.evalResult.warnings))];
    if (accumulated < demand.quantityKg) {
      warnings.push(`Partial match only — ${accumulated}kg of ${demand.quantityKg}kg requested is covered`);
    }

    const match = {
      id: randomUUID(),
      donationIds: chosen.map((c) => c.donation.id),
      donorIds: [...new Set(chosen.map((c) => c.donor.id))],
      demandRequestId: demand.id,
      recipientId: recipient.id,
      score: avgScore,
      reasons,
      warnings,
      status: 'proposed',
      donorAccepted: false,
      recipientAccepted: false,
      otp: null,
      quantityCoveredKg: accumulated,
      quantityRequestedKg: demand.quantityKg,
      createdAt: new Date().toISOString(),
    };

    chosen.forEach((c) => {
      c.donation.status = 'reserved';
    });
    demand.status = accumulated >= demand.quantityKg ? 'matched_pending' : 'partially_matched';

    db.matches.push(match);
    newMatches.push(match);
    db.custodyLog.push({
      id: randomUUID(),
      matchId: match.id,
      event: 'match_proposed',
      actor: 'system',
      timestamp: new Date().toISOString(),
      details: `Proposed matching ${chosen.length} donation(s) to demand #${demand.id.slice(0, 8)}`,
    });
  }

  return newMatches;
}
