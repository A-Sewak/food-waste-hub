const api = (path, opts) => fetch('/api' + path, opts).then(async (r) => {
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
});

// ---------------- Tabs ----------------
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    refreshAll();
  });
});

function fmtHours(iso) {
  const h = (new Date(iso).getTime() - Date.now()) / 3600000;
  if (h < 0) return 'expired';
  return h.toFixed(1) + 'h';
}

// ---------------- Board ----------------
async function loadBoard() {
  const [donations, demand, matches] = await Promise.all([
    api('/donations'), api('/demand'), api('/matches'),
  ]);

  const donationsList = document.getElementById('donationsList');
  donationsList.innerHTML = donations.map((d) => `
    <div class="card card-donation">
      <div class="card-title">${d.foodType} — ${d.quantityKg}kg <span class="badge badge-${d.status}">${d.status}</span></div>
      <div class="card-meta">Region: ${d.region} · Storage: ${d.storageType}${d.tempRange ? ' (' + d.tempRange + ')' : ''} · Expires in ${fmtHours(d.expiryAt)}</div>
    </div>
  `).join('') || '<p class="hint">No donations logged yet.</p>';

  const demandList = document.getElementById('demandList');
  demandList.innerHTML = demand.map((d) => `
    <div class="card card-demand">
      <div class="card-title">${d.foodType} — ${d.quantityKg}kg needed <span class="badge badge-${d.status}">${d.status}</span></div>
      <div class="card-meta">Region: ${d.region} · Needed within ${fmtHours(d.neededBy)}</div>
    </div>
  `).join('') || '<p class="hint">No demand requests logged yet.</p>';

  const matchesList = document.getElementById('matchesList');
  matchesList.innerHTML = matches.length ? matches.map(renderMatchCard).join('') : '<p class="hint">No proposed matches yet — click "Run Matching Engine".</p>';

  matches.forEach((m) => {
    const acceptDonorBtn = document.getElementById('accept-donor-' + m.id);
    const acceptRecBtn = document.getElementById('accept-recipient-' + m.id);
    const cancelBtn = document.getElementById('cancel-' + m.id);
    const otpBtn = document.getElementById('otp-btn-' + m.id);
    if (acceptDonorBtn) acceptDonorBtn.onclick = () => accept(m.id, 'donor');
    if (acceptRecBtn) acceptRecBtn.onclick = () => accept(m.id, 'recipient');
    if (cancelBtn) cancelBtn.onclick = () => cancelMatch(m.id);
    if (otpBtn) otpBtn.onclick = () => verifyOtp(m.id);
  });
}

function renderMatchCard(m) {
  const donorNames = m.donors.map((d) => d.name).join(', ');
  const donationSummary = m.donations.map((d) => `${d.quantityKg}kg ${d.foodType}`).join(' + ');
  const reasonsHtml = m.reasons.map((r) => `<li>${r}</li>`).join('');
  const warningsHtml = m.warnings.length
    ? `<div class="warnings">⚠ ${m.warnings.join('<br>⚠ ')}</div>` : '';

  let actions = '';
  if (m.status === 'proposed') {
    actions = `
      <button class="btn-small btn-accept" id="accept-donor-${m.id}" ${m.donorAccepted ? 'disabled' : ''}>${m.donorAccepted ? '✓ Donor accepted' : 'Accept (Donor)'}</button>
      <button class="btn-small btn-accept" id="accept-recipient-${m.id}" ${m.recipientAccepted ? 'disabled' : ''}>${m.recipientAccepted ? '✓ Recipient accepted' : 'Accept (Recipient)'}</button>
      <button class="btn-small btn-cancel" id="cancel-${m.id}">Cancel</button>
    `;
  } else if (m.status === 'both_accepted') {
    actions = `
      <div class="otp-box">
        <span>OTP issued: <b>${m.otp}</b></span>
        <input type="text" id="otp-input-${m.id}" placeholder="Enter OTP" />
        <button class="btn-small btn-otp" id="otp-btn-${m.id}">Confirm Handover</button>
      </div>
      <button class="btn-small btn-cancel" id="cancel-${m.id}" style="margin-top:6px;">Cancel</button>
    `;
  } else if (m.status === 'delivered') {
    actions = `<p class="hint">✅ Delivered ${new Date(m.deliveredAt).toLocaleString()}</p>`;
  } else if (m.status === 'cancelled') {
    actions = `<p class="hint">✖ Cancelled</p>`;
  }

  return `
    <div class="card card-match">
      <div class="card-title">${donationSummary} → ${m.recipient ? m.recipient.name : '—'} <span class="badge badge-${m.status}">${m.status}</span></div>
      <div class="card-meta">Donor(s): ${donorNames} · Score: ${m.score} · Covers ${m.quantityCoveredKg}kg of ${m.quantityRequestedKg}kg requested</div>
      <ul class="reasons">${reasonsHtml}</ul>
      ${warningsHtml}
      <div style="margin-top:10px;">${actions}</div>
    </div>
  `;
}

async function accept(matchId, role) {
  try {
    await api(`/matches/${matchId}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) });
    loadBoard();
  } catch (e) { alert(e.message); }
}

async function cancelMatch(matchId) {
  const role = prompt('Cancel as donor or recipient? (type "donor" or "recipient")', 'donor');
  if (!role) return;
  try {
    await api(`/matches/${matchId}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, reason: 'Cancelled via board' }) });
    loadBoard();
  } catch (e) { alert(e.message); }
}

async function verifyOtp(matchId) {
  const input = document.getElementById('otp-input-' + matchId);
  const otp = input ? input.value : '';
  try {
    await api(`/matches/${matchId}/verify-otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp, gpsPin: '12.9750,79.1550', signature: 'recipient-signed' }),
    });
    loadBoard();
    refreshAnalytics();
  } catch (e) { alert(e.message); }
}

document.getElementById('runMatchingBtn').addEventListener('click', async () => {
  const result = await api('/match/run', { method: 'POST' });
  document.getElementById('matchRunResult').textContent = `Proposed ${result.proposed} new match(es).`;
  loadBoard();
});

// ---------------- Register forms ----------------
document.getElementById('donorForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const donor = await api('/donors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(fd)) });
    document.getElementById('donorResult').textContent = 'Registered: ' + donor.name + ' (id ' + donor.id.slice(0,8) + ')';
    e.target.reset();
    populateSelects();
  } catch (err) { document.getElementById('donorResult').textContent = 'Error: ' + err.message; }
});

document.getElementById('recipientForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  fd.storageCapability = fd.storageCapability ? fd.storageCapability.split(',').map((s) => s.trim()).filter(Boolean) : ['ambient'];
  fd.allergensToAvoid = fd.allergensToAvoid ? fd.allergensToAvoid.split(',').map((s) => s.trim()).filter(Boolean) : [];
  try {
    const recipient = await api('/recipients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fd) });
    document.getElementById('recipientResult').textContent = 'Registered: ' + recipient.name + ' (id ' + recipient.id.slice(0,8) + ')';
    e.target.reset();
    populateSelects();
  } catch (err) { document.getElementById('recipientResult').textContent = 'Error: ' + err.message; }
});

document.getElementById('donationForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  fd.allergens = fd.allergens ? fd.allergens.split(',').map((s) => s.trim()).filter(Boolean) : [];
  try {
    const donation = await api('/donations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fd) });
    document.getElementById('donationResult').textContent = 'Logged: ' + donation.quantityKg + 'kg ' + donation.foodType;
    e.target.reset();
    loadBoard();
  } catch (err) { document.getElementById('donationResult').textContent = 'Error: ' + err.message; }
});

document.getElementById('demandForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  try {
    const demand = await api('/demand', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fd) });
    document.getElementById('demandResult').textContent = 'Logged: ' + demand.quantityKg + 'kg ' + demand.foodType + ' requested';
    e.target.reset();
    loadBoard();
  } catch (err) { document.getElementById('demandResult').textContent = 'Error: ' + err.message; }
});

document.getElementById('verifyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const path = fd.entityType === 'donor' ? `/donors/${fd.entityId}/verify` : `/recipients/${fd.entityId}/verify`;
  try {
    const result = await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tier: fd.tier, documentName: fd.documentName }) });
    document.getElementById('verifyResult').textContent = 'Verified: ' + result.name + ' -> tier "' + result.verificationTier + '"';
    populateSelects();
  } catch (err) { document.getElementById('verifyResult').textContent = 'Error: ' + err.message; }
});

async function populateSelects() {
  const [donors, recipients] = await Promise.all([api('/donors'), api('/recipients')]);

  const donorSelect = document.getElementById('donorSelect');
  donorSelect.innerHTML = donors.map((d) => `<option value="${d.id}">${d.name} (${d.verificationTier})</option>`).join('');

  const recipientSelect = document.getElementById('recipientSelect');
  recipientSelect.innerHTML = recipients.map((r) => `<option value="${r.id}">${r.name} (${r.verificationTier})</option>`).join('');

  const entityTypeSelect = document.querySelector('#verifyForm select[name="entityType"]');
  const verifyEntitySelect = document.getElementById('verifyEntitySelect');
  function refreshVerifyEntities() {
    const list = entityTypeSelect.value === 'donor' ? donors : recipients;
    verifyEntitySelect.innerHTML = list.map((x) => `<option value="${x.id}">${x.name}</option>`).join('');
  }
  entityTypeSelect.onchange = refreshVerifyEntities;
  refreshVerifyEntities();

  const reliabilitySelect = document.getElementById('reliabilitySelect');
  reliabilitySelect.innerHTML = donors.map((d) => `<option value="${d.id}">${d.name}</option>`).join('');
  reliabilitySelect.onchange = () => loadReliability(reliabilitySelect.value);
  if (donors.length) loadReliability(donors[0].id);
}

// ---------------- Analytics ----------------
async function refreshAnalytics() {
  const a = await api('/analytics');
  const maxVal = Math.max(1, ...a.byRegion.map((r) => r.matched + r.unmet));
  document.getElementById('chartWrap').innerHTML = a.byRegion.map((r) => `
    <div class="chart-row">
      <div class="chart-label">${r.region}</div>
      <div class="chart-bar-track">
        <div class="chart-bar-matched" style="width:${(r.matched / maxVal) * 100}%">${r.matched || ''}</div>
        <div class="chart-bar-unmet" style="width:${(r.unmet / maxVal) * 100}%">${r.unmet || ''}</div>
      </div>
    </div>
  `).join('') + `<div class="hint">🟩 Matched &nbsp; 🟧 Unmet</div>`;

  document.getElementById('statGrid').innerHTML = `
    <div class="stat-card"><div class="stat-num">${a.totalDeliveredKg}kg</div><div class="stat-label">Diverted from landfill (ESG)</div></div>
    <div class="stat-card"><div class="stat-num">${a.totalMatchesDelivered}</div><div class="stat-label">Completed deliveries</div></div>
    <div class="stat-card"><div class="stat-num">${a.totalMatchesProposed}</div><div class="stat-label">Total matches proposed</div></div>
    <div class="stat-card"><div class="stat-num">${a.totalDemandRequests}</div><div class="stat-label">Demand requests logged</div></div>
  `;
}

// ---------------- Reliability ----------------
async function loadReliability(donorId) {
  if (!donorId) return;
  const r = await api(`/donors/${donorId}/reliability`);
  document.getElementById('reliabilityCard').innerHTML = `
    <div style="font-size:12px;color:#cfe3d7;">DONOR RELIABILITY</div>
    <h3 style="margin:4px 0 12px;">${r.name}</h3>
    <div class="score">${r.reliabilityScore}%</div>
    <div class="label">${r.label}</div>
    <div class="row"><span>Completed handoffs</span><b>${r.completedHandoffs}</b></div>
    <div class="row"><span>Late cancellations</span><b>${r.lateCancellations}</b></div>
    <div class="row"><span>No-shows</span><b>${r.noShows}</b></div>
  `;
}

// ---------------- Custody log ----------------
async function refreshCustody() {
  const log = await api('/custody-log');
  document.getElementById('custodyList').innerHTML = log.length ? log.map((c) => `
    <div class="custody-entry">
      <div><b>${c.event}</b> — ${c.details}</div>
      <div class="ts">${new Date(c.timestamp).toLocaleString()} · actor: ${c.actor} · match ${c.matchId.slice(0,8)}</div>
    </div>
  `).join('') : '<p class="hint">No custody events yet.</p>';
}

async function refreshAll() {
  await Promise.all([loadBoard(), refreshAnalytics(), refreshCustody()]);
}

populateSelects();
refreshAll();
