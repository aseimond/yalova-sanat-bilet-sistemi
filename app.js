const MAX_TICKETS_PER_ORDER = 5;
const ROWS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"];

function buildSeatLayout() {
  const leftSeats = [];
  const centerSeats = [];
  const rightSeats = [];

  ROWS.forEach((row) => {
    for (let i = 1; i <= 5; i++) {
      leftSeats.push({ id: `${row}${i}`, display: String(i), row, block: "left" });
    }
    for (let i = 6; i <= 27; i++) {
      centerSeats.push({ id: `${row}${i}`, display: String(i), row, block: "center" });
    }
    for (let i = 28; i <= 32; i++) {
      rightSeats.push({ id: `${row}${i}`, display: String(i), row, block: "right" });
    }
  });

  return { leftSeats, centerSeats, rightSeats };
}

const seatLayout = buildSeatLayout();

const state = {
  reservations: [],
  activeReservation: null,
  bookedByDefault: ["A2", "A5", "B4", "C1"],
  blockedSeats: ["A2", "A5", "B4", "C1"],
  maxTicketsPerOrder: MAX_TICKETS_PER_ORDER
};

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
    throw new Error(data.error || "Islem basarisiz oldu.");
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
  if (status === "approved") return "Onaylandi";
  if (status === "rejected") return "Reddedildi";
  if (status === "awaiting_payment") return "Beklemede";
  return "Rezervasyon Alindi";
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

function groupSeatsByRow(seats, rowLabels) {
  return rowLabels.map((row) => ({
    row,
    seats: seats.filter((seat) => seat.row === row)
  }));
}

function renderBlock(blockName, title, seats, rowLabels, selectedSeats, bookedSeats, showLabel = false) {
  const wrapper = document.createElement("section");
  wrapper.className = `seat-layout-block ${blockName}-block`;

  const header = document.createElement("div");
  header.className = `seat-block-header ${blockName}-block`;
  header.textContent = title;
  wrapper.appendChild(header);

  groupSeatsByRow(seats, rowLabels).forEach(({ row, seats: rowSeats }) => {
    const rowElement = document.createElement("div");
    rowElement.className = `seat-row ${blockName}-row`;

    if (showLabel) {
      const label = document.createElement("span");
      label.className = "seat-row-label";
      label.textContent = row;
      rowElement.appendChild(label);
    }

    rowSeats.forEach((seat) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "seat compact-seat";
      button.dataset.seatId = seat.id;
      button.textContent = seat.display;

      if (bookedSeats.has(seat.id)) {
        button.classList.add("booked");
        button.disabled = true;
      }

      if (selectedSeats.includes(seat.id)) {
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
    renderBlock("left", "Sol Blok", seatLayout.leftSeats, ROWS, selectedSeats, bookedSeats, true),
    renderBlock("center", "Orta Blok", seatLayout.centerSeats, ROWS, selectedSeats, bookedSeats, false),
    renderBlock("right", "Sağ Blok", seatLayout.rightSeats, ROWS, selectedSeats, bookedSeats, false)
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
      setText(seatLabel, "Henuz koltuk secilmedi");
      setText(seatList, `Ayni anda en fazla ${state.maxTicketsPerOrder} koltuk secebilirsin.`);
    } else {
      setText(seatLabel, `${count} koltuk secildi`);
      setText(seatList, `Secilen koltuklar: ${selectedSeatsRef.value.join(", ")}`);
    }
  }

  syncSelectionSummary();

  map.addEventListener("click", (event) => {
    const button = event.target.closest(".seat");
    if (!button || button.disabled) {
      return;
    }

    const seatId = button.dataset.seatId;
    const selected = selectedSeatsRef.value;

    if (selected.includes(seatId)) {
      selectedSeatsRef.value = selected.filter((item) => item !== seatId);
    } else {
      if (selected.length >= state.maxTicketsPerOrder) {
        alert(`Bir kisi en fazla ${state.maxTicketsPerOrder} koltuk secebilir.`);
        return;
      }
      selectedSeatsRef.value = [...selected, seatId];
    }

    syncSelectionSummary();
    renderSeatButtons(map, selectedSeatsRef.value);
  });

  bookingForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!selectedSeatsRef.value.length) {
      alert("Lutfen once en az bir koltuk sec.");
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
      holdStatus.textContent = "Rezervasyonun alindi. Koltuklar adina ayrildi.";
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
      <span>Iletisim: ${reservation.phone} / ${reservation.email}</span>
      <span>Kayit Saati: ${reservation.createdAt || "-"}</span>
      <span>Not: ${reservation.note || "-"}</span>
    </div>
  `;

  const currentStatus = document.createElement("div");
  currentStatus.className = statusBoxClass(reservation.status);
  currentStatus.textContent =
    reservation.status === "approved"
      ? "Bu rezervasyon onaylandi ve koltuklar ayrildi."
      : reservation.status === "rejected"
        ? "Bu rezervasyon reddedildi. Gerekirse kisiyle tekrar iletisime gecilebilir."
        : "Rezervasyon olusturuldu ve yonetim panelinde bekliyor.";

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
  remove.textContent = "Kaydi Sil";
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
      list.innerHTML = `<div class="admin-card empty-state">Henuz kayit bulunmuyor.</div>`;
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
      loginStatus.textContent = "Giris basarili.";
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
    const confirmed = window.confirm("Reddedilmis ve suresi dolmus test kayitlarini temizlemek istiyor musun?");
    if (!confirmed) {
      return;
    }

    try {
      const result = await requestJson("/api/admin/reservations/cleanup", {
        method: "POST",
        body: JSON.stringify({})
      });
      alert(`${result.deletedCount} kayit temizlendi.`);
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
  const confirmed = window.confirm("Bu kaydi silmek istiyor musun?");
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
