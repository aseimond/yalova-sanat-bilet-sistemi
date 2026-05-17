const TICKET_PRICE = 500;
const HOLD_MINUTES = 10;
const seatLabels = Array.from({ length: 24 }, (_, index) => {
  const row = String.fromCharCode(65 + Math.floor(index / 6));
  const number = (index % 6) + 1;
  return `${row}${number}`;
});

const state = {
  reservations: [],
  activeReservation: null,
  bookedByDefault: ["A2", "A5", "B4", "C1"],
  blockedSeats: ["A2", "A5", "B4", "C1"],
  holdMinutes: HOLD_MINUTES,
  holdTimerId: null
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
  state.holdMinutes = config.holdMinutes || HOLD_MINUTES;
  state.blockedSeats = availability.blockedSeats || [...state.bookedByDefault];
}

function getBookedSeats() {
  return new Set(state.blockedSeats);
}

function formatStatus(status) {
  if (status === "approved") return "Onaylandı";
  if (status === "rejected") return "Reddedildi";
  if (status === "awaiting_payment") return "Ödeme Bekleniyor";
  return "İncelemede";
}

function statusBoxClass(status) {
  if (status === "approved") return "status-box success";
  if (status === "rejected") return "status-box rejected";
  return "status-box pending";
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Dekont okunamadı."));
    reader.readAsDataURL(file);
  });
}

function setText(element, text) {
  if (element) {
    element.textContent = text;
  }
}

function formatRemainingTime(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) {
    return "00:00";
  }

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function stopHoldTimer() {
  if (state.holdTimerId) {
    clearInterval(state.holdTimerId);
    state.holdTimerId = null;
  }
}

function startHoldTimer(statusBox, map, selectedSeatRef) {
  stopHoldTimer();

  if (!state.activeReservation?.expiresAt || state.activeReservation.status !== "awaiting_payment") {
    return;
  }

  const tick = async () => {
    const remaining = formatRemainingTime(state.activeReservation.expiresAt);
    statusBox.className = "status-box pending";
    statusBox.textContent = `Bu koltuk senin icin ${remaining} boyunca tutuluyor. Bu surede odemeyi tamamlamalisin.`;
    statusBox.classList.remove("hidden");

    if (remaining === "00:00") {
      stopHoldTimer();
      state.activeReservation = null;
      await loadSharedState();
      renderSeatButtons(map, selectedSeatRef.value);
      statusBox.className = "status-box rejected";
      statusBox.textContent = "Koltuk tutma suresi doldu. Bu koltuk tekrar satışa açıldı.";
    }
  };

  tick();
  state.holdTimerId = setInterval(tick, 1000);
}

function renderSeatButtons(map, selectedSeat) {
  const bookedSeats = getBookedSeats();
  map.innerHTML = "";

  seatLabels.forEach((label) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "seat";
    button.textContent = label;

    if (bookedSeats.has(label)) {
      button.classList.add("booked");
      button.disabled = true;
    }

    if (selectedSeat === label) {
      button.classList.add("selected");
    }

    map.appendChild(button);
  });
}

async function renderSeatsPage() {
  const map = document.querySelector("#seat-map");
  const bookingForm = document.querySelector("#booking-form");
  const paymentSection = document.querySelector("#payment-section");
  const paymentRef = document.querySelector("#payment-ref");
  const seatLabel = document.querySelector("#selected-seat-label");
  const receiptForm = document.querySelector("#receipt-form");
  const receiptStatus = document.querySelector("#receipt-status");
  const holdStatus = document.querySelector("#hold-status");

  if (!map || !bookingForm || !paymentSection || !receiptForm) {
    return;
  }

  await loadSharedState();

  const selectedSeatRef = { value: null };
  renderSeatButtons(map, selectedSeatRef.value);

  map.addEventListener("click", (event) => {
    const button = event.target.closest(".seat");
    if (!button || button.disabled) {
      return;
    }

    selectedSeatRef.value = button.textContent.trim();
    setText(seatLabel, `${selectedSeatRef.value} koltuğu seçildi`);
    renderSeatButtons(map, selectedSeatRef.value);
  });

  bookingForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!selectedSeatRef.value) {
      alert("Lütfen önce bir koltuk seçin.");
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
          seat: selectedSeatRef.value
        })
      });

      await loadSharedState();
      renderSeatButtons(map, selectedSeatRef.value);

      paymentSection.classList.remove("hidden");
      setText(paymentRef, state.activeReservation.reference);
      startHoldTimer(holdStatus, map, selectedSeatRef);
      paymentSection.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      alert(error.message);
    }
  });

  receiptForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!state.activeReservation) {
      alert("Önce rezervasyon oluşturmanız gerekiyor.");
      return;
    }

    const formData = new FormData(receiptForm);
    const receiptFile = formData.get("receipt");

    if (!(receiptFile instanceof File) || !receiptFile.name) {
      alert("Lütfen dekont dosyası seçin.");
      return;
    }

    try {
      const receiptContent = await fileToDataUrl(receiptFile);
      const reservation = await requestJson(`/api/reservations/${state.activeReservation.id}/receipt`, {
        method: "POST",
        body: JSON.stringify({
          receiptName: receiptFile.name,
          receiptContent,
          note: formData.get("note")
        })
      });

      state.activeReservation = reservation;
      stopHoldTimer();
      await loadSharedState();
      renderSeatButtons(map, selectedSeatRef.value);

      receiptStatus.className = "status-box pending";
      receiptStatus.innerHTML = `
        Dekont yüklendi. Referans kodunuz <strong>${reservation.reference}</strong> olarak kaydedildi.
        Rezervasyonunuz şimdi inceleme bekliyor.
      `;
      receiptStatus.classList.remove("hidden");
      holdStatus.classList.add("hidden");
      receiptForm.reset();
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
      <span>Koltuk: <strong>${reservation.seat}</strong></span>
      <span>Referans: <strong>${reservation.reference}</strong></span>
      <span>İletişim: ${reservation.phone} / ${reservation.email}</span>
      <span>Dekont: ${reservation.receiptName || "Yok"}</span>
      <span>Yükleme Saati: ${reservation.receiptUploadedAt || "Yok"}</span>
      <span>Not: ${reservation.note || "-"}</span>
      ${reservation.receiptUrl ? `<a href="${reservation.receiptUrl}" target="_blank" rel="noreferrer">Dekontu Aç</a>` : ""}
    </div>
  `;

  const currentStatus = document.createElement("div");
  currentStatus.className = statusBoxClass(reservation.status);
  currentStatus.textContent =
    reservation.status === "approved"
      ? "Bu rezervasyon onaylandı. Koltuk satılmış olarak korunur."
      : reservation.status === "rejected"
        ? "Bu kayıt reddedildi. Gerekirse kullanıcıdan yeni dekont istenebilir."
        : reservation.status === "awaiting_payment"
          ? "Rezervasyon oluşturuldu. Kullanıcının dekont yüklemesi bekleniyor."
          : "Dekont yüklendi, şimdi banka hareketi ile karşılaştırılıp onay verilmesi bekleniyor.";

  const actions = document.createElement("div");
  actions.className = "admin-actions";

  const approve = document.createElement("button");
  approve.className = "action-btn";
  approve.textContent = "Ödemeyi Onayla";
  approve.addEventListener("click", async () => {
    await updateReservationStatus(reservation.id, "approved");
  });

  const reject = document.createElement("button");
  reject.className = "action-btn alt";
  reject.textContent = "Reddet / Düzeltme İste";
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
      list.innerHTML = `<div class="admin-card empty-state">Henüz yüklenmiş bir kayıt bulunmuyor.</div>`;
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
