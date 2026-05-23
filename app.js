const MAX_TICKETS_PER_ORDER = 5;

const LEFT_BLOCK_ROWS = [
  { row: "A", start: 1, end: 5 },
  { row: "B", start: 1, end: 5 },
  { row: "C", start: 1, end: 4 },
  { row: "D", start: 1, end: 5 },
  { row: "E", start: 1, end: 5 },
  { row: "F", start: 1, end: 5 },
  { row: "G", start: 1, end: 5 },
  { row: "H", start: 1, end: 5 },
  { row: "I", start: 1, end: 5 },
  { row: "İ", start: 1, end: 4 },
  { row: "J", start: 1, end: 5 },
  { row: "K", start: 1, end: 5 },
  { row: "L", start: 1, end: 5 },
  { row: "M", start: 1, end: 5 },
  { row: "N", start: 1, end: 5 },
  { row: "O", start: 1, end: 5 },
  { row: "Ö", start: 1, end: 5 },
  { row: "P", start: 1, end: 4 }
];

const CENTER_BLOCK_ROWS = [
  { row: "A", start: 6, end: 27 },
  { row: "B", start: 6, end: 28 },
  { row: "C", start: 5, end: 26 },
  { row: "D", start: 6, end: 28 },
  { row: "E", start: 6, end: 27 },
  { row: "F", start: 6, end: 28 },
  { row: "G", start: 6, end: 27 },
  { row: "H", start: 6, end: 28 },
  { row: "I", start: 6, end: 27 },
  { row: "İ", start: 5, end: 27 },
  { row: "J", start: 6, end: 27 },
  { row: "K", start: 6, end: 28 },
  { row: "L", start: 6, end: 27 },
  { row: "M", start: 5, end: 28 },
  { row: "N", start: 6, end: 27 },
  { row: "O", start: 6, end: 28 },
  { row: "Ö", start: 6, end: 27 }
];

const RIGHT_BLOCK_ROWS = [
  { row: "A", start: 28, end: 32 },
  { row: "B", start: 29, end: 33 },
  { row: "C", start: 27, end: 30 },
  { row: "D", start: 29, end: 33 },
  { row: "E", start: 28, end: 32 },
  { row: "F", start: 29, end: 33 },
  { row: "G", start: 28, end: 32 },
  { row: "H", start: 29, end: 33 },
  { row: "I", start: 28, end: 32 },
  { row: "İ", start: 28, end: 31 },
  { row: "J", start: 28, end: 32 },
  { row: "K", start: 29, end: 33 },
  { row: "L", start: 28, end: 32 },
  { row: "M", start: 29, end: 33 },
  { row: "N", start: 28, end: 32 },
  { row: "O", start: 29, end: 33 },
  { row: "Ö", start: 28, end: 32 },
  { row: "P", start: 6, end: 9 }
];

function buildBlockSeats(blockKey, blockLabel, rows) {
  return rows.flatMap(({ row, start, end }) => {
    const seats = [];
    for (let number = start; number <= end; number += 1) {
      seats.push({
        id: `${blockKey}-${row}-${number}`,
        value: `${blockLabel} ${row}-${number}`,
        display: String(number),
        row,
        block: blockKey
      });
    }
    return seats;
  });
}

const seatLayout = {
  leftSeats: buildBlockSeats("left", "Sol", LEFT_BLOCK_ROWS),
  centerSeats: buildBlockSeats("center", "Orta", CENTER_BLOCK_ROWS),
  rightSeats: buildBlockSeats("right", "Sağ", RIGHT_BLOCK_ROWS)
};

const state = {
  reservations: [],
  activeReservation: null,
  bookedByDefault: [],
  blockedSeats: [],
  maxTicketsPerOrder: MAX_TICKETS_PER_ORDER
};

function seatRowsForBlock(blockName) {
  if (blockName === "left") return LEFT_BLOCK_ROWS;
  if (blockName === "center") return CENTER_BLOCK_ROWS;
  return RIGHT_BLOCK_ROWS;
}

async function requestJson(url, options = {}) {
  const headers = {
    ...options.headers
  };

  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    credentials: "same-origin",
    headers,
    ...options
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "İşlem başarısız oldu.");
  }

  return data;
}

async function loadSharedState() {
  const [config, availability] = await Promise.all([
    requestJson("/api/config"),
    requestJson("/api/availability")
  ]);

  state.bookedByDefault = config.bookedByDefault || [];
  state.maxTicketsPerOrder = config.maxTicketsPerOrder || MAX_TICKETS_PER_ORDER;
  state.blockedSeats = availability.blockedSeats || [...state.bookedByDefault];
}

function getBookedSeats() {
  return new Set(state.blockedSeats);
}

function formatStatus(status) {
  if (status === "approved") return "Onaylandı";
  if (status === "rejected") return "Reddedildi";
  if (status === "awaiting_payment") return "Beklemede";
  return "Rezervasyon Alındı";
}

function statusBoxClass(status) {
  if (status === "approved") return "status-box success";
  if (status === "rejected") return "status-box rejected";
  return "status-box pending";
}

function setText(element, text) {
  if (element) {
    element.textContent = text;
  }
}

function groupSeatsByRow(seats, rows) {
  return rows.map((rowConfig) => ({
    ...rowConfig,
    seats: seats.filter((seat) => seat.row === rowConfig.row)
  }));
}

function renderBlock(blockName, title, seats, selectedSeats, bookedSeats) {
  const wrapper = document.createElement("section");
  wrapper.className = `seat-layout-block ${blockName}-block`;

  const header = document.createElement("div");
  header.className = `seat-block-header ${blockName}-block`;
  header.textContent = title;
  wrapper.appendChild(header);

  groupSeatsByRow(seats, seatRowsForBlock(blockName)).forEach(({ row, seats: rowSeats }) => {
    const rowElement = document.createElement("div");
    rowElement.className = `seat-row ${blockName}-row`;
    rowElement.style.gridTemplateColumns = `24px repeat(${rowSeats.length}, 38px)`;

    const label = document.createElement("span");
    label.className = "seat-row-label";
    label.textContent = row;
    rowElement.appendChild(label);

    rowSeats.forEach((seat) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "seat compact-seat";
      button.dataset.seatValue = seat.value;
      button.title = seat.value;
      button.textContent = seat.display;

      if (bookedSeats.has(seat.value)) {
        button.classList.add("booked");
        button.disabled = true;
      }

      if (selectedSeats.includes(seat.value)) {
        button.classList.add("selected");
      }

      rowElement.appendChild(button);
    });

    wrapper.appendChild(rowElement);
  });

  return wrapper;
}

function renderSeatButtons(map, selectedSeats) {
  const bookedSeats = getBookedSeats();
  map.innerHTML = "";
  map.append(
    renderBlock("left", "Sol Blok", seatLayout.leftSeats, selectedSeats, bookedSeats),
    renderBlock("center", "Orta Blok", seatLayout.centerSeats, selectedSeats, bookedSeats),
    renderBlock("right", "Sağ Blok", seatLayout.rightSeats, selectedSeats, bookedSeats)
  );
}

async function renderSeatsPage() {
  const map = document.querySelector("#seat-map");
  const bookingForm = document.querySelector("#booking-form");
  const resultSection = document.querySelector("#reservation-result");
  const resultRef = document.querySelector("#reservation-ref");
  const resultSeats = document.querySelector("#reservation-seats");
  const seatLabel = document.querySelector("#selected-seat-label");
  const seatList = document.querySelector("#selected-seat-list");
  const holdStatus = document.querySelector("#hold-status");

  if (!map || !bookingForm || !resultSection) {
    return;
  }

  await loadSharedState();

  const selectedSeatsRef = { value: [] };
  renderSeatButtons(map, selectedSeatsRef.value);

  function syncSelectionSummary() {
    const count = selectedSeatsRef.value.length;
    if (!count) {
      setText(seatLabel, "Henüz koltuk seçilmedi");
      setText(seatList, `Aynı anda en fazla ${state.maxTicketsPerOrder} koltuk seçebilirsin.`);
    } else {
      setText(seatLabel, `${count} koltuk seçildi`);
      setText(seatList, `Seçilen koltuklar: ${selectedSeatsRef.value.join(", ")}`);
    }
  }

  syncSelectionSummary();

  map.addEventListener("click", (event) => {
    const button = event.target.closest(".seat");
    if (!button || button.disabled) {
      return;
    }

    const seatValue = button.dataset.seatValue;
    const selected = selectedSeatsRef.value;

    if (selected.includes(seatValue)) {
      selectedSeatsRef.value = selected.filter((item) => item !== seatValue);
    } else {
      if (selected.length >= state.maxTicketsPerOrder) {
        alert(`Bir kişi en fazla ${state.maxTicketsPerOrder} koltuk seçebilir.`);
        return;
      }
      selectedSeatsRef.value = [...selected, seatValue];
    }

    syncSelectionSummary();
    renderSeatButtons(map, selectedSeatsRef.value);
  });

  bookingForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!selectedSeatsRef.value.length) {
      alert("Lütfen önce en az bir koltuk seç.");
      return;
    }

    const formData = new FormData(bookingForm);

    try {
      state.activeReservation = await requestJson("/api/reservations", {
        method: "POST",
        body: JSON.stringify({
          name: formData.get("name"),
          phone: formData.get("phone"),
          email: formData.get("email"),
          seats: selectedSeatsRef.value
        })
      });

      await loadSharedState();
      renderSeatButtons(map, selectedSeatsRef.value);
      syncSelectionSummary();

      resultSection.classList.remove("hidden");
      setText(resultRef, state.activeReservation.reference);
      setText(resultSeats, selectedSeatsRef.value.join(", "));
      holdStatus.className = "status-box success";
      holdStatus.textContent = "Rezervasyonun alındı. Koltukların adına ayrıldı.";
      holdStatus.classList.remove("hidden");
      bookingForm.reset();
      resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      alert(error.message);
    }
  });
}

function buildAdminCard(reservation) {
  const card = document.createElement("article");
  card.className = "admin-card";

  card.innerHTML = `
    <p class="panel-label">${formatStatus(reservation.status)}</p>
    <h2>${reservation.name}</h2>
    <div class="admin-meta">
      <span>Koltuklar: <strong>${(reservation.seats || [reservation.seat]).join(", ")}</strong></span>
      <span>Referans: <strong>${reservation.reference}</strong></span>
      <span>İletişim: ${reservation.phone} / ${reservation.email}</span>
      <span>Kayıt Saati: ${reservation.createdAt || "-"}</span>
      <span>Not: ${reservation.note || "-"}</span>
    </div>
  `;

  const currentStatus = document.createElement("div");
  currentStatus.className = statusBoxClass(reservation.status);
  currentStatus.textContent =
    reservation.status === "approved"
      ? "Bu rezervasyon onaylandı ve koltuklar ayrıldı."
      : reservation.status === "rejected"
        ? "Bu rezervasyon reddedildi. Gerekirse kişiyle tekrar iletişime geçilebilir."
        : "Rezervasyon oluşturuldu ve yönetim panelinde bekliyor.";

  const actions = document.createElement("div");
  actions.className = "admin-actions";

  const approve = document.createElement("button");
  approve.className = "action-btn";
  approve.textContent = "Rezervasyonu Onayla";
  approve.addEventListener("click", async () => {
    await updateReservationStatus(reservation.id, "approved");
  });

  const reject = document.createElement("button");
  reject.className = "action-btn alt";
  reject.textContent = "Rezervasyonu Reddet";
  reject.addEventListener("click", async () => {
    await updateReservationStatus(reservation.id, "rejected");
  });

  const remove = document.createElement("button");
  remove.className = "action-btn alt";
  remove.textContent = "Kaydı Sil";
  remove.addEventListener("click", async () => {
    await deleteReservation(reservation.id);
  });

  actions.append(approve, reject, remove);
  card.append(currentStatus, actions);
  return card;
}

async function renderAdminPage() {
  const list = document.querySelector("#admin-list");
  const loginSection = document.querySelector("#admin-login-section");
  const panelSection = document.querySelector("#admin-panel-section");
  const loginForm = document.querySelector("#admin-login-form");
  const loginStatus = document.querySelector("#admin-login-status");
  const logoutButton = document.querySelector("#admin-logout");
  const cleanupButton = document.querySelector("#cleanup-test-records");

  if (!list) {
    return;
  }

  async function loadAdminReservations() {
    state.reservations = await requestJson("/api/admin/reservations");
    list.innerHTML = "";

    if (!state.reservations.length) {
      list.innerHTML = `<div class="admin-card empty-state">Henüz kayıt bulunmuyor.</div>`;
      return;
    }

    state.reservations.forEach((reservation) => {
      list.appendChild(buildAdminCard(reservation));
    });
  }

  function showAdminPanel() {
    loginSection.classList.add("hidden");
    panelSection.classList.remove("hidden");
    logoutButton?.classList.remove("hidden");
  }

  function showLogin() {
    panelSection.classList.add("hidden");
    loginSection.classList.remove("hidden");
    logoutButton?.classList.add("hidden");
  }

  async function checkSession() {
    try {
      const session = await requestJson("/api/admin/session");
      if (session.authenticated) {
        showAdminPanel();
        await loadAdminReservations();
      } else {
        showLogin();
      }
    } catch {
      showLogin();
    }
  }

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(loginForm);

    try {
      await requestJson("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({
          username: formData.get("username"),
          password: formData.get("password")
        })
      });

      loginStatus.className = "status-box success";
      loginStatus.textContent = "Giriş başarılı.";
      loginStatus.classList.remove("hidden");
      loginForm.reset();
      showAdminPanel();
      await loadAdminReservations();
    } catch (error) {
      loginStatus.className = "status-box rejected";
      loginStatus.textContent = error.message;
      loginStatus.classList.remove("hidden");
    }
  });

  logoutButton?.addEventListener("click", async () => {
    await requestJson("/api/admin/logout", {
      method: "POST",
      body: JSON.stringify({})
    });
    showLogin();
    list.innerHTML = "";
  });

  cleanupButton?.addEventListener("click", async () => {
    const confirmed = window.confirm("Reddedilmiş ve süresi dolmuş test kayıtlarını temizlemek istiyor musun?");
    if (!confirmed) {
      return;
    }

    try {
      const result = await requestJson("/api/admin/reservations/cleanup", {
        method: "POST",
        body: JSON.stringify({})
      });
      alert(`${result.deletedCount} kayıt temizlendi.`);
      await renderAdminPage();
    } catch (error) {
      alert(error.message);
    }
  });

  await checkSession();
}

async function updateReservationStatus(id, status) {
  try {
    const result = await requestJson(`/api/admin/reservations/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    if (result.notification?.reason) {
      alert(result.notification.reason);
    }
    await renderAdminPage();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteReservation(id) {
  const confirmed = window.confirm("Bu kaydı silmek istiyor musun?");
  if (!confirmed) {
    return;
  }

  try {
    await requestJson(`/api/admin/reservations/${id}`, {
      method: "DELETE"
    });
    await renderAdminPage();
  } catch (error) {
    alert(error.message);
  }
}

async function init() {
  const page = document.body.dataset.page;

  if (page === "seats") {
    await renderSeatsPage();
  }

  if (page === "admin") {
    await renderAdminPage();
  }
}

init();
