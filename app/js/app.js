// ============================================
// RIDESHARE LT — MAIN APP
// ============================================

const CITIES = [
  'Vilnius', 'Kaunas', 'Klaipėda', 'Šiauliai', 'Panevėžys',
  'Alytus', 'Marijampolė', 'Mažeikiai', 'Jonava', 'Utena',
  'Kėdainiai', 'Telšiai', 'Visaginas', 'Tauragė', 'Ukmergė',
  'Plungė', 'Kretinga', 'Palanga', 'Radviliškis', 'Druskininkai'
];

// ---- STATE ----
let currentUser   = null;
let currentView   = null;
let previousView  = 'browse';
let currentRideId = null;

// ---- FIREBASE ----
if (!FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey === 'YOUR_API_KEY') {
  document.addEventListener('DOMContentLoaded', () => {
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:system-ui;padding:24px;text-align:center">
        <div>
          <div style="font-size:3rem;margin-bottom:16px">⚙️</div>
          <h2 style="font-weight:800;margin-bottom:8px">Firebase not configured</h2>
          <p style="color:#6b7280;max-width:360px">
            Open <code>assets/js/carpool-config.js</code> and paste your Firebase project credentials.
            See the comments in that file for step-by-step instructions.
          </p>
        </div>
      </div>`;
  });
  throw new Error('Firebase not configured — see assets/js/carpool-config.js');
}

firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db   = firebase.firestore();

// ---- AUTH ----
auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUser = user;
    const snap = await db.collection('users').doc(user.uid).get();

    if (!snap.exists || !snap.data().phone_number) {
      setNav(false);
      showView('setup');
    } else {
      setNav(true);
      renderNavUser();
      if (!currentView || currentView === 'login' || currentView === 'setup') {
        showView('browse');
        loadRides();
      }
    }
  } else {
    currentUser = null;
    setNav(false);
    showView('login');
  }
});

// ---- ROUTER ----
function showView(name, param) {
  if (currentView && currentView !== name) previousView = currentView;

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById('view-' + name);
  if (el) el.classList.add('active');

  document.querySelectorAll('.bottom-nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === name);
  });

  currentView = name;
  window.scrollTo(0, 0);

  if (name === 'ride' && param) {
    currentRideId = param;
    loadRideDetail(param);
  } else if (name === 'dashboard') {
    loadDashboard();
  }
}

// ---- NAV ----
function setNav(loggedIn) {
  document.getElementById('bottom-nav').classList.toggle('hidden', !loggedIn);
  const fab = document.getElementById('fab');
  if (fab) fab.style.display = loggedIn ? 'flex' : 'none';
}

function renderNavUser() {
  if (!currentUser) return;
  document.getElementById('nav-user').innerHTML = `
    <img src="${esc(currentUser.photoURL || '')}" class="user-avatar"
         onerror="this.style.display='none'"
         alt="${esc(currentUser.displayName)}"
         onclick="showView('dashboard')" title="My account">
  `;
}

// ---- TOAST ----
function toast(msg, type = '') {
  const wrap = document.getElementById('toasts');
  const el   = document.createElement('div');
  el.className = 'toast-msg ' + type;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
}

// ---- UTILS ----
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('lt-LT', { weekday:'short', month:'short', day:'numeric' });
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString('lt-LT', { hour:'2-digit', minute:'2-digit' });
}

function populateCities(ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const isSearch = id.startsWith('search-');
    const placeholder = isSearch
      ? (id === 'search-from' ? 'From...' : 'To...')
      : 'Select city';
    el.innerHTML = `<option value="">${placeholder}</option>` +
      CITIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  });
}

// ---- RIDE CARD HTML ----
function rideCardHTML(ride) {
  const price = ride.price_per_seat != null ? `${ride.price_per_seat} EUR` : 'Free';
  return `
    <div class="ride-card" data-id="${esc(ride.id)}">
      <div class="ride-route">
        <span class="ride-city">${esc(ride.departure_city)}</span>
        <i class="bi bi-arrow-right ride-arrow"></i>
        <span class="ride-city">${esc(ride.arrival_city)}</span>
      </div>
      <div class="ride-meta">
        <span class="ride-meta-item"><i class="bi bi-calendar3"></i> ${fmtDate(ride.departure_time)}</span>
        <span class="ride-meta-item"><i class="bi bi-clock"></i> ${fmtTime(ride.departure_time)}</span>
        <span class="ride-meta-item"><i class="bi bi-people"></i> ${ride.available_seats} seat${ride.available_seats !== 1 ? 's' : ''}</span>
      </div>
      <div class="ride-footer">
        <img src="${esc(ride.driver_avatar || '')}" class="driver-thumb"
             onerror="this.style.display='none'" alt="">
        <span class="driver-name">${esc(ride.driver_name || 'Driver')}</span>
        <span class="ride-price">${esc(price)}</span>
      </div>
    </div>`;
}

function bindRideCards(container) {
  container.querySelectorAll('.ride-card').forEach(card => {
    card.addEventListener('click', () => showView('ride', card.dataset.id));
  });
}

// ---- BROWSE ----
async function loadRides(from = '', to = '') {
  const list  = document.getElementById('ride-list');
  const empty = document.getElementById('no-rides');
  const title = document.getElementById('browse-title');
  const count = document.getElementById('ride-count');

  list.innerHTML = '<div class="cp-spinner"><div class="spinner-border text-primary"></div></div>';
  empty.classList.add('d-none');

  try {
    const now  = firebase.firestore.Timestamp.now();
    const snap = await db.collection('rides')
      .where('departure_time', '>=', now)
      .orderBy('departure_time', 'asc')
      .get();

    let rides = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (from) rides = rides.filter(r => r.departure_city === from);
    if (to)   rides = rides.filter(r => r.arrival_city   === to);

    title.textContent = (from || to)
      ? (from && to ? `${from} → ${to}` : from ? `From ${from}` : `To ${to}`)
      : 'All upcoming rides';

    count.textContent = `${rides.length} ride${rides.length !== 1 ? 's' : ''}`;

    if (rides.length === 0) {
      list.innerHTML = '';
      empty.classList.remove('d-none');
      return;
    }

    list.innerHTML = rides.map(rideCardHTML).join('');
    bindRideCards(list);
  } catch (err) {
    console.error(err);
    list.innerHTML = '<p class="text-center text-muted py-5">Could not load rides. Check your connection.</p>';
  }
}

// ---- RIDE DETAIL ----
async function loadRideDetail(rideId) {
  const wrap = document.getElementById('ride-detail-content');
  wrap.innerHTML = '<div class="cp-spinner"><div class="spinner-border text-primary"></div></div>';

  try {
    const doc = await db.collection('rides').doc(rideId).get();
    if (!doc.exists) {
      wrap.innerHTML = '<p class="text-center text-muted py-5">Ride not found.</p>';
      return;
    }

    const ride     = { id: doc.id, ...doc.data() };
    const isDriver = currentUser && currentUser.uid === ride.driver_id;
    const fromDetail = ride.departure_detail ? `, ${ride.departure_detail}` : '';
    const toDetail   = ride.arrival_detail   ? `, ${ride.arrival_detail}`   : '';
    const price      = ride.price_per_seat != null
      ? `${ride.price_per_seat} EUR per seat`
      : 'Free — good vibes only 🙂';

    wrap.innerHTML = `
      <div class="detail-card">
        <div class="detail-header">
          <div class="detail-route">
            <span>${esc(ride.departure_city)}</span>
            <i class="bi bi-arrow-right"></i>
            <span>${esc(ride.arrival_city)}</span>
          </div>
          <div style="opacity:.85;font-size:.9rem">${fmtDate(ride.departure_time)} · ${fmtTime(ride.departure_time)}</div>
        </div>
        <div class="detail-body">
          <div class="detail-row">
            <i class="bi bi-geo-alt-fill"></i>
            <div><strong>Pickup</strong>${esc(ride.departure_city + fromDetail)}</div>
          </div>
          <div class="detail-row">
            <i class="bi bi-flag-fill"></i>
            <div><strong>Dropoff</strong>${esc(ride.arrival_city + toDetail)}</div>
          </div>
          <div class="detail-row">
            <i class="bi bi-people-fill"></i>
            <div><strong>Seats available</strong>${ride.available_seats}</div>
          </div>
          <div class="detail-row">
            <i class="bi bi-cash"></i>
            <div><strong>Price</strong>${esc(price)} · pay in cash or Revolut</div>
          </div>
          ${ride.trip_notes ? `
          <div class="detail-row">
            <i class="bi bi-chat-text"></i>
            <div><strong>Driver note</strong>${esc(ride.trip_notes)}</div>
          </div>` : ''}
        </div>
      </div>

      <div class="detail-card">
        <div class="driver-row">
          <img src="${esc(ride.driver_avatar || '')}" onerror="this.style.display='none'" alt="">
          <div>
            <div style="font-weight:700">${esc(ride.driver_name || 'Driver')}</div>
            <div style="font-size:.83rem;color:var(--text-muted)">Driver</div>
          </div>
          ${isDriver ? '<span class="badge bg-light text-dark ms-auto" style="font-size:.78rem">You</span>' : ''}
        </div>
      </div>

      <div id="action-area"></div>
    `;

    const actionArea = document.getElementById('action-area');
    if (isDriver) {
      await renderDriverBookings(rideId, actionArea);
    } else if (currentUser) {
      await renderPassengerAction(rideId, ride, actionArea);
    }

  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p class="text-center text-muted py-5">Failed to load ride details.</p>';
  }
}

// ---- DRIVER: show booking requests ----
async function renderDriverBookings(rideId, container) {
  // Must filter by driver_id too — Firestore security rules reject a
  // bookings query that isn't scoped to the current user.
  const snap = await db.collection('bookings')
    .where('ride_id', '==', rideId)
    .where('driver_id', '==', currentUser.uid)
    .get();

  if (snap.empty) {
    container.innerHTML = `
      <div class="form-card">
        <div class="text-center text-muted py-4">
          <i class="bi bi-inbox" style="font-size:2rem;display:block;margin-bottom:8px"></i>
          No booking requests yet
        </div>
      </div>`;
    return;
  }

  const bookings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  container.innerHTML = `
    <p style="font-weight:700;font-size:.9rem;margin-bottom:10px">Booking requests (${bookings.length})</p>
    ${bookings.map(b => bookingCardHTML(b, true)).join('')}
  `;

  bindBookingActions(container, rideId);
}

function bookingCardHTML(b, isDriver) {
  const statusCls   = 'badge-' + b.status.toLowerCase();
  const statusLabel = b.status.charAt(0).toUpperCase() + b.status.slice(1).toLowerCase();

  const phoneHtml = (b.status === 'approved' && b.passenger_phone) ? `
    <div style="font-size:.78rem;color:var(--primary);font-weight:600;margin-top:3px">
      <i class="bi bi-telephone"></i> ${esc(b.passenger_phone)}
    </div>` : '';

  const actionsHtml = (isDriver && b.status === 'pending') ? `
    <div class="booking-actions">
      <button class="btn-accept"  data-booking="${esc(b.id)}" data-action="approved">Accept</button>
      <button class="btn-decline" data-booking="${esc(b.id)}" data-action="rejected">Decline</button>
    </div>` : '';

  return `
    <div class="booking-card" id="bk-${esc(b.id)}">
      <img src="${esc(b.passenger_avatar || '')}" onerror="this.style.display='none'" alt="">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:.9rem">${esc(b.passenger_name || 'Passenger')}</div>
        <span class="${statusCls}" style="font-size:.72rem;border-radius:6px;padding:2px 8px;font-weight:600;display:inline-block;margin-top:2px">
          ${esc(statusLabel)}
        </span>
        ${phoneHtml}
      </div>
      ${actionsHtml}
    </div>`;
}

function bindBookingActions(container, rideId) {
  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () =>
      updateBooking(btn.dataset.booking, btn.dataset.action, rideId)
    );
  });
}

async function updateBooking(bookingId, newStatus, rideId) {
  try {
    const ref      = db.collection('bookings').doc(bookingId);
    const bookSnap = await ref.get();

    if (newStatus === 'approved') {
      const pSnap = await db.collection('users').doc(bookSnap.data().passenger_id).get();
      const phone = pSnap.exists ? pSnap.data().phone_number : null;
      await ref.update({ status: 'approved', passenger_phone: phone });
    } else {
      await ref.update({ status: newStatus });
    }

    toast(newStatus === 'approved' ? 'Booking accepted!' : 'Booking declined',
          newStatus === 'approved' ? 'success' : '');

    // Refresh the single card
    const updated = (await ref.get()).data();
    const el = document.getElementById('bk-' + bookingId);
    if (el) {
      const tmp = document.createElement('div');
      tmp.innerHTML = bookingCardHTML({ id: bookingId, ...updated }, true);
      el.replaceWith(tmp.firstElementChild);
      // Re-bind in case more pending bookings remain
      const area = document.getElementById('action-area');
      if (area) bindBookingActions(area, rideId);
    }
  } catch (err) {
    console.error(err);
    toast('Something went wrong', 'error');
  }
}

// ---- PASSENGER: show join button or booking status ----
async function renderPassengerAction(rideId, ride, container) {
  const snap = await db.collection('bookings')
    .where('ride_id', '==', rideId)
    .where('passenger_id', '==', currentUser.uid)
    .get();

  if (!snap.empty) {
    const booking = { id: snap.docs[0].id, ...snap.docs[0].data() };

    let html = '';
    if (booking.status === 'pending') {
      html = `<div class="form-card text-center" style="color:#92400e;background:#fef3c7;font-weight:600">
        <i class="bi bi-hourglass-split me-2"></i>Request sent — waiting for driver approval
      </div>`;
    } else if (booking.status === 'approved') {
      const dSnap  = await db.collection('users').doc(ride.driver_id).get();
      const dPhone = dSnap.exists ? dSnap.data().phone_number : null;
      html = `
        <div class="form-card">
          <div style="font-weight:700;color:var(--primary);margin-bottom:10px">
            <i class="bi bi-check-circle-fill me-1"></i> Booking confirmed!
          </div>
          ${dPhone ? `
          <div class="contact-box">
            <div class="label"><i class="bi bi-telephone-fill me-1"></i> Driver's contact</div>
            <div class="number">${esc(dPhone)}</div>
            <div class="hint">Call or SMS to confirm pickup time & spot</div>
          </div>` : '<p class="text-muted small">Contact your driver to confirm details.</p>'}
        </div>`;
    } else {
      html = `<div class="form-card text-center" style="color:#991b1b;background:#fee2e2;font-weight:600">
        <i class="bi bi-x-circle me-1"></i> Booking was not accepted
      </div>`;
    }
    container.innerHTML = html;
    return;
  }

  // Own ride — don't show join button
  if (ride.driver_id === currentUser.uid) return;

  container.innerHTML = `
    <button class="btn btn-primary w-100 btn-lg" id="btn-join">
      <i class="bi bi-check-circle me-2"></i>Request to join
    </button>`;

  document.getElementById('btn-join').addEventListener('click', () => joinRide(rideId, ride));
}

async function joinRide(rideId, ride) {
  const btn = document.getElementById('btn-join');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Sending…';

  try {
    const uSnap = await db.collection('users').doc(currentUser.uid).get();
    await db.collection('bookings').add({
      ride_id:         rideId,
      driver_id:       ride.driver_id,
      passenger_id:    currentUser.uid,
      passenger_name:  currentUser.displayName,
      passenger_avatar:currentUser.photoURL,
      passenger_phone: uSnap.exists ? (uSnap.data().phone_number || null) : null,
      status:          'pending',
      created_at:      firebase.firestore.FieldValue.serverTimestamp()
    });

    toast('Request sent!', 'success');
    const area = document.getElementById('action-area');
    if (area) await renderPassengerAction(rideId, ride, area);
  } catch (err) {
    console.error(err);
    toast('Failed to send request', 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check-circle me-2"></i>Request to join';
  }
}

// ---- POST RIDE ----
async function postRide() {
  const btn = document.getElementById('btn-post-submit');

  const from       = document.getElementById('post-from').value;
  const to         = document.getElementById('post-to').value;
  const fromDetail = document.getElementById('post-from-detail').value.trim();
  const toDetail   = document.getElementById('post-to-detail').value.trim();
  const date       = document.getElementById('post-date').value;
  const time       = document.getElementById('post-time').value;
  const seats      = parseInt(document.getElementById('post-seats').value, 10);
  const priceRaw   = document.getElementById('post-price').value.trim().replace(',', '.');
  const priceNum   = parseFloat(priceRaw);
  const notes      = document.getElementById('post-notes').value.trim();

  if (!from || !to || !date || !time) {
    toast('Please fill in From, To, Date and Time', 'error'); return;
  }
  if (from === to) {
    toast('Departure and arrival must be different cities', 'error'); return;
  }

  const depTime = new Date(`${date}T${time}`);
  if (isNaN(depTime.getTime()) || depTime <= new Date()) {
    toast('Departure time must be in the future', 'error'); return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Posting…';

  try {
    await db.collection('rides').add({
      driver_id:        currentUser.uid,
      driver_name:      currentUser.displayName,
      driver_avatar:    currentUser.photoURL,
      departure_city:   from,
      departure_detail: fromDetail || null,
      arrival_city:     to,
      arrival_detail:   toDetail  || null,
      departure_time:   firebase.firestore.Timestamp.fromDate(depTime),
      available_seats:  seats,
      price_per_seat:   (priceRaw !== '' && !isNaN(priceNum)) ? priceNum : null,
      trip_notes:       notes || null,
      created_at:       firebase.firestore.FieldValue.serverTimestamp()
    });

    toast('Ride posted!', 'success');
    ['post-from','post-to','post-from-detail','post-to-detail',
     'post-date','post-time','post-price','post-notes'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('post-seats').value = '2';
    showView('browse');
    loadRides();
  } catch (err) {
    console.error(err);
    toast('Failed to post ride', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Post Ride';
  }
}

// ---- DASHBOARD ----
async function loadDashboard() {
  if (!currentUser) return;
  const uSnap = await db.collection('users').doc(currentUser.uid).get();
  const uData = uSnap.exists ? uSnap.data() : {};

  document.getElementById('profile-card').innerHTML = `
    <img src="${esc(currentUser.photoURL || '')}" onerror="this.style.display='none'" alt="">
    <div class="profile-info" style="flex:1">
      <div class="name">${esc(currentUser.displayName)}</div>
      <div class="phone"><i class="bi bi-telephone me-1"></i>${esc(uData.phone_number || '—')}</div>
      <div class="email">${esc(currentUser.email)}</div>
    </div>
    <button class="btn btn-sm btn-outline-secondary" id="btn-signout">Sign out</button>
  `;

  document.getElementById('btn-signout').addEventListener('click', () => {
    auth.signOut().then(() => toast('Signed out'));
  });

  loadMyRides();
  loadMyBookings();
}

async function loadMyRides() {
  const list  = document.getElementById('my-rides-list');
  const empty = document.getElementById('my-rides-empty');
  list.innerHTML = '<div class="cp-spinner"><div class="spinner-border text-primary"></div></div>';

  try {
    // Single equality filter — no composite index needed. Sort client-side.
    const snap = await db.collection('rides')
      .where('driver_id', '==', currentUser.uid)
      .get();

    if (snap.empty) {
      list.innerHTML = '';
      empty.classList.remove('d-none');
      return;
    }
    empty.classList.add('d-none');
    const rides = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rides.sort((a, b) => (b.departure_time?.seconds || 0) - (a.departure_time?.seconds || 0));
    list.innerHTML = rides.map(rideCardHTML).join('');
    bindRideCards(list);
  } catch (err) {
    console.error(err);
    list.innerHTML = '<p class="text-center text-muted">Failed to load. Check console for index link.</p>';
  }
}

async function loadMyBookings() {
  const list  = document.getElementById('my-bookings-list');
  const empty = document.getElementById('my-bookings-empty');
  list.innerHTML = '<div class="cp-spinner"><div class="spinner-border text-primary"></div></div>';

  try {
    // Single equality filter — no composite index needed. Sort client-side.
    const snap = await db.collection('bookings')
      .where('passenger_id', '==', currentUser.uid)
      .get();

    if (snap.empty) {
      list.innerHTML = '';
      empty.classList.remove('d-none');
      return;
    }
    empty.classList.add('d-none');

    const bookings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    bookings.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0));
    const rideIds  = [...new Set(bookings.map(b => b.ride_id))];
    const rideDocs = await Promise.all(rideIds.map(id => db.collection('rides').doc(id).get()));
    const ridesMap = {};
    rideDocs.forEach(d => { if (d.exists) ridesMap[d.id] = { id: d.id, ...d.data() }; });

    list.innerHTML = bookings.map(b => {
      const ride = ridesMap[b.ride_id];
      if (!ride) return '';
      const statusCls   = 'badge-' + b.status.toLowerCase();
      const statusLabel = b.status.charAt(0).toUpperCase() + b.status.slice(1).toLowerCase();
      const extraHtml   = b.status === 'approved'
        ? `<div style="font-size:.8rem;color:var(--primary);font-weight:600;margin-top:6px">
             <i class="bi bi-telephone me-1"></i>Contact driver to confirm pickup
           </div>`
        : '';
      return `
        <div class="ride-card" data-id="${esc(ride.id)}">
          <div class="ride-route">
            <span class="ride-city">${esc(ride.departure_city)}</span>
            <i class="bi bi-arrow-right ride-arrow"></i>
            <span class="ride-city">${esc(ride.arrival_city)}</span>
            <span class="${statusCls} ms-auto"
                  style="font-size:.72rem;border-radius:6px;padding:2px 8px;font-weight:600">
              ${esc(statusLabel)}
            </span>
          </div>
          <div class="ride-meta">
            <span class="ride-meta-item"><i class="bi bi-calendar3"></i> ${fmtDate(ride.departure_time)}</span>
            <span class="ride-meta-item"><i class="bi bi-clock"></i> ${fmtTime(ride.departure_time)}</span>
          </div>
          ${extraHtml}
        </div>`;
    }).join('');

    bindRideCards(list);
  } catch (err) {
    console.error(err);
    list.innerHTML = '<p class="text-center text-muted">Failed to load. Check console for index link.</p>';
  }
}

// ---- PHONE SETUP ----
async function savePhone() {
  const raw   = document.getElementById('phone-input').value.replace(/\s/g, '');
  const phone = '+370' + raw;

  if (!raw || raw.length < 8 || !/^\d+$/.test(raw)) {
    toast('Enter a valid Lithuanian number (8 digits after +370)', 'error');
    return;
  }

  const btn = document.getElementById('btn-save-phone');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    await db.collection('users').doc(currentUser.uid).set({
      user_id:      currentUser.uid,
      display_name: currentUser.displayName,
      avatar_url:   currentUser.photoURL,
      email:        currentUser.email,
      phone_number: phone,
      created_at:   firebase.firestore.FieldValue.serverTimestamp()
    });

    setNav(true);
    renderNavUser();
    showView('browse');
    loadRides();
    toast('Profile saved!', 'success');
  } catch (err) {
    console.error(err);
    toast('Save failed. Try again.', 'error');
    btn.disabled = false;
    btn.textContent = 'Save & Continue';
  }
}

// ---- INIT ----
document.addEventListener('DOMContentLoaded', () => {
  populateCities(['search-from', 'search-to', 'post-from', 'post-to']);

  // Min date = today
  const dateEl = document.getElementById('post-date');
  if (dateEl) dateEl.min = new Date().toISOString().split('T')[0];

  // Google sign-in
  document.getElementById('btn-google-login').addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(err => {
      if (err.code !== 'auth/popup-closed-by-user') toast('Sign-in failed. Try again.', 'error');
    });
  });

  // Phone setup
  document.getElementById('btn-save-phone').addEventListener('click', savePhone);
  document.getElementById('phone-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') savePhone();
  });

  // Search
  document.getElementById('btn-search').addEventListener('click', () => {
    loadRides(
      document.getElementById('search-from').value,
      document.getElementById('search-to').value
    );
  });

  // Reset search on city clear
  ['search-from', 'search-to'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      const from = document.getElementById('search-from').value;
      const to   = document.getElementById('search-to').value;
      if (!from && !to) loadRides();
    });
  });

  // FAB → post ride
  document.getElementById('fab').addEventListener('click', () => showView('post'));

  // Back buttons
  document.getElementById('btn-back-post').addEventListener('click',
    () => showView(previousView || 'browse'));
  document.getElementById('btn-back-ride').addEventListener('click',
    () => showView(previousView || 'browse'));

  // Post ride submit
  document.getElementById('btn-post-submit').addEventListener('click', postRide);

  // Bottom nav
  document.querySelectorAll('.bottom-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showView(btn.dataset.view);
      if (btn.dataset.view === 'browse') loadRides();
    });
  });

  // Dashboard tabs
  document.querySelectorAll('.cp-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.cp-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const isRides = tab.dataset.tab === 'my-rides';
      document.getElementById('panel-my-rides').classList.toggle('d-none', !isRides);
      document.getElementById('panel-my-bookings').classList.toggle('d-none', isRides);
    });
  });

  // Dashboard shortcut buttons
  document.getElementById('btn-post-from-dash').addEventListener('click', () => showView('post'));
  document.getElementById('btn-browse-from-dash').addEventListener('click', () => {
    showView('browse'); loadRides();
  });

  // Navbar brand
  document.getElementById('nav-brand').addEventListener('click', () => {
    if (currentUser) { showView('browse'); loadRides(); }
  });
});
