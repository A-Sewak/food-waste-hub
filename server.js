// server.js
// ---------------------------------------------------------------------------
// Zero-dependency Node.js HTTP server.
// Binds to 0.0.0.0 to guarantee automatic port discovery and URL generation
// across Codespaces, AWS Cloud9, Docker, and local environments.
// ---------------------------------------------------------------------------

const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID, randomInt } = require('crypto');

const {
  db,
  id,
  nowIso,
  DONOR_AUTO_PAUSE_RATING_THRESHOLD,
  DONOR_AUTO_PAUSE_RELIABILITY_THRESHOLD,
  CO2E_KG_PER_KG_FOOD_WASTE,
} = require('./db');
const { runMatching, expireStaleDonations } = require('./engine');
const { HIGH_VOLUME_THRESHOLD_KG } = require('./matching');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0'; // Crucial for cloud port forwarding / auto-detection
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 5_000_000) req.destroy();
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function recomputeReliabilityOnCompletion(donor) {
  donor.completedHandoffs += 1;
  donor.reliabilityScore = Math.min(100, donor.reliabilityScore + 1);
}

function recomputeReliabilityOnLateCancellation(donor) {
  donor.lateCancellations += 1;
  donor.reliabilityScore = Math.max(0, donor.reliabilityScore - 10);
}

function avgRating(donor) {
  if (!donor.ratings || donor.ratings.length === 0) return null;
  return donor.ratings.reduce((s, r) => s + r, 0) / donor.ratings.length;
}

function maybeAutoPause(donor) {
  const rating = avgRating(donor);
  const ratingTooLow = rating !== null && rating < DONOR_AUTO_PAUSE_RATING_THRESHOLD;
  const reliabilityTooLow = donor.reliabilityScore < DONOR_AUTO_PAUSE_RELIABILITY_THRESHOLD;
  if ((ratingTooLow || reliabilityTooLow) && donor.status !== 'paused') {
    donor.status = 'paused';
    logCustody(
      null,
      'donor_auto_paused',
      'system',
      `${donor.name} auto-paused: rating ${rating ? rating.toFixed(1) : 'N/A'}, reliability ${donor.reliabilityScore}%`
    );
    return true;
  }
  return false;
}

function logCustody(matchId, event, actor, details) {
  db.custodyLog.push({
    id: randomUUID(),
    matchId,
    event,
    actor,
    timestamp: nowIso(),
    details,
  });
}

function notFound(res, msg = 'Not found') {
  sendJSON(res, 404, { error: msg });
}

function badRequest(res, msg) {
  sendJSON(res, 400, { error: msg });
}

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
};

function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(PUBLIC_DIR, filePath.split('?')[0]);
  if (!filePath.startsWith(PUBLIC_DIR)) return notFound(res);
  fs.readFile(filePath, (err, content) => {
    if (err) return notFound(res, 'File not found');
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(content);
  });
}

// ---------------------------------------------------------------------------
// API Route Handlers
// ---------------------------------------------------------------------------

async function handleApi(req, res, pathname) {
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
    });
    return res.end();
  }

  // ---------- Donors ----------
  if (pathname === '/api/donors' && method === 'GET') {
    return sendJSON(res, 200, db.donors);
  }

  if (pathname === '/api/donors' && method === 'POST') {
    const body = await readBody(req);
    if (!body.name || !body.region || body.lat == null || body.lng == null) {
      return badRequest(res, 'name, region, lat, lng are required');
    }
    const donor = {
      id: id(),
      name: body.name,
      type: body.type || 'Individual',
      region: body.region,
      lat: Number(body.lat),
      lng: Number(body.lng),
      verified: false,
      verificationTier: 'none',
      verificationDoc: null,
      completedHandoffs: 0,
      lateCancellations: 0,
      noShows: 0,
      reliabilityScore: 100,
      status: 'active',
      ratings: [],
      createdAt: nowIso(),
    };
    db.donors.push(donor);
    return sendJSON(res, 201, donor);
  }

  let m;
  if ((m = pathname.match(/^\/api\/donors\/([^/]+)\/verify$/)) && method === 'POST') {
    const donor = db.donors.find((d) => d.id === m[1]);
    if (!donor) return notFound(res, 'Donor not found');
    const body = await readBody(req);
    donor.verificationTier = body.tier === 'institutional' ? 'institutional' : 'basic';
    donor.verified = true;
    donor.verificationDoc = body.documentName
      ? `s3://food-hub-verification-docs/donors/${donor.id}-${body.documentName}`
      : donor.verificationDoc;
    return sendJSON(res, 200, donor);
  }

  if ((m = pathname.match(/^\/api\/donors\/([^/]+)\/reputation$/)) && method === 'GET') {
    const donor = db.donors.find((d) => d.id === m[1]);
    if (!donor) return notFound(res, 'Donor not found');
    const rating = avgRating(donor);
    return sendJSON(res, 200, {
      donorId: donor.id,
      name: donor.name,
      verificationTier: donor.verificationTier,
      completedHandoffs: donor.completedHandoffs,
      averageRecipientRating: rating === null ? null : Math.round(rating * 10) / 10,
      badge:
        donor.completedHandoffs >= 30
          ? 'Community Champion'
          : donor.completedHandoffs >= 10
          ? 'Trusted Donor'
          : 'New Donor',
      memberSince: donor.createdAt,
    });
  }

  if ((m = pathname.match(/^\/api\/donors\/([^/]+)\/esg-report$/)) && method === 'GET') {
    const donor = db.donors.find((d) => d.id === m[1]);
    if (!donor) return notFound(res, 'Donor not found');
    const donatedKg = db.donations
      .filter((d) => d.donorId === donor.id && d.status === 'completed')
      .reduce((sum, d) => sum + d.quantityKg, 0);
    return sendJSON(res, 200, {
      donorId: donor.id,
      name: donor.name,
      totalKgDivertedFromLandfill: donatedKg,
      estimatedCo2eAvoidedKg: Math.round(donatedKg * CO2E_KG_PER_KG_FOOD_WASTE * 10) / 10,
    });
  }

  // ---------- Recipients ----------
  if (pathname === '/api/recipients' && method === 'GET') {
    return sendJSON(res, 200, db.recipients);
  }

  if (pathname === '/api/recipients' && method === 'POST') {
    const body = await readBody(req);
    if (!body.name || !body.region || body.lat == null || body.lng == null) {
      return badRequest(res, 'name, region, lat, lng are required');
    }
    const recipient = {
      id: id(),
      name: body.name,
      region: body.region,
      lat: Number(body.lat),
      lng: Number(body.lng),
      verified: false,
      verificationTier: 'none',
      verificationDoc: null,
      storageCapability: Array.isArray(body.storageCapability) ? body.storageCapability : ['ambient'],
      pickupCapacityKg: Number(body.pickupCapacityKg) || 20,
      serviceRadiusKm: Number(body.serviceRadiusKm) || 5,
      allergensToAvoid: Array.isArray(body.allergensToAvoid) ? body.allergensToAvoid : [],
      waiverAccepted: false,
      waiverAcceptedAt: null,
      createdAt: nowIso(),
    };
    db.recipients.push(recipient);
    return sendJSON(res, 201, recipient);
  }

  if ((m = pathname.match(/^\/api\/recipients\/([^/]+)\/accept-waiver$/)) && method === 'POST') {
    const recipient = db.recipients.find((r) => r.id === m[1]);
    if (!recipient) return notFound(res, 'Recipient not found');
    recipient.waiverAccepted = true;
    recipient.waiverAcceptedAt = nowIso();
    return sendJSON(res, 200, recipient);
  }

  // ---------- Donations & Demand ----------
  if (pathname === '/api/donations' && method === 'GET') {
    expireStaleDonations(db);
    return sendJSON(res, 200, db.donations);
  }

  if (pathname === '/api/donations' && method === 'POST') {
    const body = await readBody(req);
    const donor = db.donors.find((d) => d.id === body.donorId);
    if (!donor) return badRequest(res, 'Unknown donorId');
    if (donor.status === 'paused') {
      return sendJSON(res, 403, { error: 'This donor is currently paused pending safety/reliability review.' });
    }
    const quantityKg = Number(body.quantityKg);
    if (quantityKg > HIGH_VOLUME_THRESHOLD_KG && donor.verificationTier !== 'institutional') {
      return sendJSON(res, 403, { error: `Donations over ${HIGH_VOLUME_THRESHOLD_KG}kg require institutional verification.` });
    }
    const donation = {
      id: id(),
      donorId: donor.id,
      foodType: body.foodType,
      quantityKg,
      expiryAt: new Date(Date.now() + Number(body.expiryInHours) * 3600 * 1000).toISOString(),
      storageType: body.storageType || 'ambient',
      tempRange: body.tempRange || null,
      allergens: Array.isArray(body.allergens) ? body.allergens : [],
      lat: donor.lat,
      lng: donor.lng,
      region: donor.region,
      pickupWindowStart: nowIso(),
      pickupWindowEnd: new Date(Date.now() + (Number(body.pickupWindowHours) || 4) * 3600 * 1000).toISOString(),
      status: 'available',
      createdAt: nowIso(),
    };
    db.donations.push(donation);
    return sendJSON(res, 201, donation);
  }

  if (pathname === '/api/demand' && method === 'GET') {
    return sendJSON(res, 200, db.demandRequests);
  }

  if (pathname === '/api/demand' && method === 'POST') {
    const body = await readBody(req);
    const recipient = db.recipients.find((r) => r.id === body.recipientId);
    if (!recipient) return badRequest(res, 'Unknown recipientId');
    if (!recipient.waiverAccepted) {
      return sendJSON(res, 403, { error: 'Recipient must sign the liability waiver before logging demand.' });
    }
    const demand = {
      id: id(),
      recipientId: recipient.id,
      foodType: body.foodType,
      quantityKg: Number(body.quantityKg),
      neededBy: new Date(Date.now() + Number(body.neededByHours) * 3600 * 1000).toISOString(),
      region: recipient.region,
      status: 'open',
      createdAt: nowIso(),
    };
    db.demandRequests.push(demand);
    return sendJSON(res, 201, demand);
  }

  // ---------- Matching & Cancellation Lifecycle ----------
  if (pathname === '/api/match/run' && method === 'POST') {
    const newMatches = runMatching(db);
    return sendJSON(res, 200, { proposed: newMatches.length, matches: newMatches });
  }

  if (pathname === '/api/matches' && method === 'GET') {
    const enriched = db.matches.map((match) => {
      const demand = db.demandRequests.find((d) => d.id === match.demandRequestId);
      const recipient = db.recipients.find((r) => r.id === match.recipientId);
      const donations = db.donations.filter((d) => match.donationIds.includes(d.id));
      const donors = db.donors.filter((dn) => match.donorIds.includes(dn.id));
      return { ...match, demand, recipient, donations, donors };
    });
    return sendJSON(res, 200, enriched);
  }

  if ((m = pathname.match(/^\/api\/matches\/([^/]+)\/accept$/)) && method === 'POST') {
    const match = db.matches.find((x) => x.id === m[1]);
    if (!match) return notFound(res, 'Match not found');
    const body = await readBody(req);
    if (match.status === 'cancelled' || match.status === 'delivered') {
      return badRequest(res, `Match already ${match.status}`);
    }

    if (body.role === 'donor') match.donorAccepted = true;
    if (body.role === 'recipient') match.recipientAccepted = true;
    logCustody(match.id, `${body.role}_accepted`, body.role, `${body.role} accepted the proposed match`);

    if (match.donorAccepted && match.recipientAccepted && match.status === 'proposed') {
      match.status = 'both_accepted';
      match.otp = String(randomInt(100000, 999999));
      logCustody(match.id, 'otp_issued', 'system', 'Both parties accepted. Handover OTP generated.');
    }
    return sendJSON(res, 200, match);
  }

  if ((m = pathname.match(/^\/api\/matches\/([^/]+)\/dispatch$/)) && method === 'POST') {
    const match = db.matches.find((x) => x.id === m[1]);
    if (!match) return notFound(res, 'Match not found');
    const body = await readBody(req);
    match.delivery = {
      method: body.method,
      carrierName: body.carrierName || 'Unassigned Volunteer',
      costBearer: 'recipient',
      status: 'assigned',
    };
    logCustody(
      match.id,
      'courier_assigned',
      'system',
      `${match.delivery.carrierName} assigned for pickup via ${match.delivery.method}.`
    );
    return sendJSON(res, 200, match);
  }

  // Multi-party cancellation adaptation
  if ((m = pathname.match(/^\/api\/matches\/([^/]+)\/cancel$/)) && method === 'POST') {
    const match = db.matches.find((x) => x.id === m[1]);
    if (!match) return notFound(res, 'Match not found');
    if (match.status === 'delivered') return badRequest(res, 'Cannot cancel a delivered match');
    if (match.status === 'cancelled') return badRequest(res, 'Match has already been cancelled');

    const body = await readBody(req);
    const cancellingDonorId = body.donorId;
    const reason = body.reason || 'Donor cancelled pickup after confirmation';

    match.status = 'cancelled';
    match.cancelledAt = nowIso();
    match.cancellationReason = reason;

    // Safe Stock Release
    const now = Date.now();
    const affectedDonations = db.donations.filter((d) => match.donationIds.includes(d.id));
    affectedDonations.forEach((d) => {
      const isCancellingDonor = !cancellingDonorId || d.donorId === cancellingDonorId;
      if (isCancellingDonor) {
        d.status = 'withdrawn';
      } else {
        d.status = new Date(d.expiryAt).getTime() > now ? 'available' : 'expired';
      }
    });

    const demand = db.demandRequests.find((d) => d.id === match.demandRequestId);
    if (demand) demand.status = 'open';

    const donorRecords = db.donors.filter((d) => match.donorIds.includes(d.id));
    donorRecords.forEach((d) => {
      if (!cancellingDonorId || d.id === cancellingDonorId) {
        recomputeReliabilityOnLateCancellation(d);
        maybeAutoPause(d);
      }
    });

    // Notify affected parties
    const recipient = db.recipients.find((r) => r.id === match.recipientId);
    const carrier = match.delivery ? match.delivery.carrierName : null;

    const notifications = [
      {
        recipient: recipient ? recipient.name : 'Recipient Shelter',
        message: `ALERT: Donor cancelled match #${match.id.slice(0, 8)}. Reason: ${reason}. Seeking replacement...`,
      },
    ];

    if (carrier) {
      notifications.push({
        recipient: carrier,
        message: `STAND DOWN: Scheduled pickup for match #${match.id.slice(0, 8)} cancelled by donor. Do not proceed.`,
      });
      match.delivery.status = 'cancelled_by_donor';
    }

    logCustody(
      match.id,
      'donor_late_cancellation',
      'donor',
      `Match cancelled post-acceptance. Reason: ${reason}. Recipient: ${recipient ? recipient.name : 'N/A'}. Courier: ${carrier || 'None'}.`
    );

    // Replacement Surplus Discovery
    const replacementMatches = runMatching(db);
    const replacementFound = replacementMatches.find((rm) => rm.demandRequestId === match.demandRequestId) || null;

    if (replacementFound) {
      logCustody(
        replacementFound.id,
        'replacement_match_found',
        'engine',
        `Autonomous replacement surplus assigned for demand #${demand.id.slice(0, 8)}.`
      );
    }

    return sendJSON(res, 200, {
      success: true,
      cancelledMatch: match,
      notificationsDispatched: notifications,
      replacementMatch: replacementFound,
    });
  }

  // ---------- Verification & Custody ----------
  if ((m = pathname.match(/^\/api\/matches\/([^/]+)\/verify-otp$/)) && method === 'POST') {
    const match = db.matches.find((x) => x.id === m[1]);
    if (!match) return notFound(res, 'Match not found');
    if (match.status !== 'both_accepted') return badRequest(res, 'Match status is not ready for OTP verification');

    const body = await readBody(req);
    const checklist = body.checklist || {};
    const requiredChecks = ['visualInspectionPassed', 'packagingIntact', 'temperatureConfirmed'];
    const missing = requiredChecks.filter((k) => checklist[k] !== true);
    if (missing.length > 0) {
      return badRequest(res, `Checklist failed. Missing: ${missing.join(', ')}`);
    }

    if (String(body.otp) !== match.otp) return sendJSON(res, 401, { error: 'Incorrect OTP' });

    match.status = 'delivered';
    match.deliveredAt = nowIso();
    db.donations.filter((d) => match.donationIds.includes(d.id)).forEach((d) => (d.status = 'completed'));

    const demand = db.demandRequests.find((d) => d.id === match.demandRequestId);
    if (demand) demand.status = 'fulfilled';

    db.donors.filter((d) => match.donorIds.includes(d.id)).forEach(recomputeReliabilityOnCompletion);
    logCustody(match.id, 'custody_transferred', 'courier', 'OTP verified. Handover confirmed.');
    return sendJSON(res, 200, match);
  }

  if (pathname === '/api/custody-log' && method === 'GET') {
    return sendJSON(res, 200, db.custodyLog.slice().reverse());
  }

  if (pathname === '/api/analytics' && method === 'GET') {
    const totalDeliveredKg = db.donations
      .filter((d) => d.status === 'completed')
      .reduce((sum, d) => sum + d.quantityKg, 0);

    return sendJSON(res, 200, {
      totalDeliveredKg,
      totalMatchesProposed: db.matches.length,
      totalMatchesDelivered: db.matches.filter((m) => m.status === 'delivered').length,
      totalMatchesCancelled: db.matches.filter((m) => m.status === 'cancelled').length,
    });
  }

  return notFound(res, `No route for ${method} ${pathname}`);
}

// ---------------------------------------------------------------------------
// Server Initialization with Explicit 0.0.0.0 Host
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const pathname = req.url.split('?')[0];
  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
    } else {
      serveStatic(req, res);
    }
  } catch (err) {
    sendJSON(res, 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Food Waste Hub operational!`);
  console.log(`- Local URL: http://localhost:${PORT}`);
  console.log(`- Network URL: http://172.16.248.52:${PORT}`);
});