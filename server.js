const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { randomUUID, pbkdf2Sync, timingSafeEqual } = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const nodemailer = require("nodemailer");

const HOST = "0.0.0.0";
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const STORAGE_ROOT = process.env.STORAGE_ROOT || ROOT;
const DATA_DIR = path.join(STORAGE_ROOT, "data");
const UPLOADS_DIR = path.join(STORAGE_ROOT, "uploads");
const DB_FILE = path.join(DATA_DIR, "app.sqlite");
const LEGACY_RESERVATIONS_FILE = path.join(ROOT, "data", "reservations.json");
const LOCAL_CONFIG_FILE = path.join(ROOT, "config.local.json");
const BOOKED_BY_DEFAULT = ["A2", "A5", "B4", "C1"];
const TICKET_PRICE = 500;
const HOLD_MINUTES = 10;
const MAX_TICKETS_PER_ORDER = 5;
const ALLOWED_RECEIPT_MIME = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png"
};
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png"
};
const localConfig = fs.existsSync(LOCAL_CONFIG_FILE)
  ? JSON.parse(fs.readFileSync(LOCAL_CONFIG_FILE, "utf8"))
  : {};
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || localConfig.adminUsername || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || localConfig.adminPassword || "YalovaSanat2026!";
const ADMIN_PASSWORD_SALT = process.env.ADMIN_PASSWORD_SALT || localConfig.adminPasswordSalt || "yalova-sanat-salt";
const SMTP_HOST = process.env.SMTP_HOST || localConfig.smtpHost || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || localConfig.smtpPort || 587);
const SMTP_USER = process.env.SMTP_USER || localConfig.smtpUser || "";
const SMTP_PASS = process.env.SMTP_PASS || localConfig.smtpPass || "";
const SMTP_FROM = process.env.SMTP_FROM || localConfig.smtpFrom || SMTP_USER || "";
const SMTP_SECURE = String(process.env.SMTP_SECURE || localConfig.smtpSecure || "false").toLowerCase() === "true";
const adminPasswordHash = pbkdf2Sync(ADMIN_PASSWORD, ADMIN_PASSWORD_SALT, 120000, 32, "sha256");
const sessions = new Map();

let db;
let mailTransporter = null;

function createPasswordHash(password) {
  return pbkdf2Sync(password, ADMIN_PASSWORD_SALT, 120000, 32, "sha256");
}

function createMailTransporter() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
    return null;
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });
}

function parseCookies(request) {
  const raw = request.headers.cookie || "";
  return raw.split(";").reduce((acc, part) => {
    const [key, ...rest] = part.trim().split("=");
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

function createSession() {
  const token = randomUUID();
  sessions.set(token, {
    username: ADMIN_USERNAME,
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  return token;
}

function getSession(request) {
  const cookies = parseCookies(request);
  const token = cookies.admin_session;
  if (!token || !sessions.has(token)) {
    return null;
  }

  const session = sessions.get(token);
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }

  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return { token, ...session };
}

function requireAdmin(request, response) {
  const session = getSession(request);
  if (!session) {
    sendJson(response, 401, { error: "Admin oturumu gerekli." });
    return null;
  }
  return session;
}

async function ensureStorage() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(UPLOADS_DIR, { recursive: true });

  db = new DatabaseSync(DB_FILE);
  db.exec(`
    CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      seat TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      reference TEXT NOT NULL UNIQUE,
      amount INTEGER NOT NULL,
      seats_text TEXT NOT NULL DEFAULT '',
      seat_count INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL DEFAULT '',
      receipt_name TEXT NOT NULL DEFAULT '',
      receipt_uploaded_at TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      receipt_path TEXT NOT NULL DEFAULT ''
    ) STRICT;

    CREATE INDEX IF NOT EXISTS reservations_seat_idx ON reservations (seat);
    CREATE INDEX IF NOT EXISTS reservations_status_idx ON reservations (status);
  `);

  await migrateLegacyReservations();
  ensureReservationColumns();
}

function ensureReservationColumns() {
  const columns = db.prepare("PRAGMA table_info(reservations)").all().map((item) => item.name);

  if (!columns.includes("expires_at")) {
    db.exec("ALTER TABLE reservations ADD COLUMN expires_at TEXT NOT NULL DEFAULT ''");
  }

  if (!columns.includes("seats_text")) {
    db.exec("ALTER TABLE reservations ADD COLUMN seats_text TEXT NOT NULL DEFAULT ''");
  }

  if (!columns.includes("seat_count")) {
    db.exec("ALTER TABLE reservations ADD COLUMN seat_count INTEGER NOT NULL DEFAULT 1");
  }

  db.exec(`
    UPDATE reservations
    SET seats_text = seat
    WHERE seats_text = '' OR seats_text IS NULL
  `);

  db.exec(`
    UPDATE reservations
    SET seat_count = CASE
      WHEN seats_text = '' THEN 1
      ELSE LENGTH(seats_text) - LENGTH(REPLACE(seats_text, ',', '')) + 1
    END
    WHERE seat_count IS NULL OR seat_count < 1
  `);
}

async function migrateLegacyReservations() {
  try {
    await fsp.access(LEGACY_RESERVATIONS_FILE);
  } catch {
    return;
  }

  const hasRows = db.prepare("SELECT COUNT(*) AS count FROM reservations").get().count;
  if (hasRows > 0) {
    return;
  }

  const raw = await fsp.readFile(LEGACY_RESERVATIONS_FILE, "utf8");
  const reservations = JSON.parse(raw);
  const insert = db.prepare(`
    INSERT INTO reservations (
      id, seat, name, phone, email, reference, amount, status, created_at,
      seats_text, seat_count, expires_at, receipt_name, receipt_uploaded_at, note, receipt_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction((items) => {
    for (const item of items) {
      insert.run(
        item.id || randomUUID(),
        item.seat,
        item.name,
        item.phone,
        item.email,
        item.reference,
        item.amount || 950,
        item.seatsText || item.seat || "",
        item.seatCount || 1,
        item.status || "pending",
        item.createdAt || new Date().toLocaleString("tr-TR"),
        item.expiresAt || "",
        item.receiptName || "",
        item.receiptUploadedAt || "",
        item.note || "",
        item.receiptPath || ""
      );
    }
  });

  transaction(reservations);
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function getStoredReceiptFileName(receiptPath) {
  return path.basename(receiptPath || "");
}

async function removeReceiptFile(receiptPath) {
  const fileName = getStoredReceiptFileName(receiptPath);
  if (!fileName) {
    return;
  }

  const filePath = path.join(UPLOADS_DIR, fileName);
  try {
    await fsp.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

function createReferenceCode(seatLabel) {
  const base = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `BALO-${seatLabel}-${base}`;
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8"
  });
  response.end(message);
}

function publicReservationShape(item) {
  const seats = parseSeatsText(item.seats_text || item.seat || "");
  return {
    id: item.id,
    seat: item.seat,
    seats,
    seatCount: item.seat_count || seats.length || 1,
    name: item.name,
    phone: item.phone,
    email: item.email,
    reference: item.reference,
    amount: item.amount,
    status: item.status,
    createdAt: item.created_at,
    expiresAt: item.expires_at || "",
    receiptName: item.receipt_name,
    receiptUploadedAt: item.receipt_uploaded_at,
    note: item.note
  };
}

function adminReservationShape(item) {
  return {
    ...publicReservationShape(item),
    receiptUrl: item.receipt_path ? `/api/admin/receipts/${item.id}` : ""
  };
}

function buildNotificationContent(reservation, status) {
  if (status === "approved") {
    return {
      subject: "Bilet odemeniz onaylandi",
      text:
        `Merhaba ${reservation.name},\n\n` +
        `Yalova Sanat yil sonu gosterisi icin yaptiginiz odeme onaylandi.\n` +
        `Koltuk: ${reservation.seat}\n` +
        `Referans: ${reservation.reference}\n\n` +
        `Etkinlik gununde bu bilgileri saklamanizi rica ederiz.\n\n` +
        `Yalova Sanat Bale & Dans Kursu`,
      html:
        `<p>Merhaba ${reservation.name},</p>` +
        `<p>Yalova Sanat yil sonu gosterisi icin yaptiginiz odeme onaylandi.</p>` +
        `<p><strong>Koltuk:</strong> ${reservation.seat}<br /><strong>Referans:</strong> ${reservation.reference}</p>` +
        `<p>Etkinlik gununde bu bilgileri saklamanizi rica ederiz.</p>` +
        `<p>Yalova Sanat Bale & Dans Kursu</p>`
    };
  }

  return {
    subject: "Dekontunuz icin guncelleme gerekli",
    text:
      `Merhaba ${reservation.name},\n\n` +
      `Yalova Sanat yil sonu gosterisi icin gonderdiginiz dekont tekrar kontrol edilmelidir.\n` +
      `Referans: ${reservation.reference}\n` +
      `Lutfen okul ile iletisime gecerek odeme kaydinizi guncelleyin.\n\n` +
      `Yalova Sanat Bale & Dans Kursu`,
    html:
      `<p>Merhaba ${reservation.name},</p>` +
      `<p>Yalova Sanat yil sonu gosterisi icin gonderdiginiz dekont tekrar kontrol edilmelidir.</p>` +
      `<p><strong>Referans:</strong> ${reservation.reference}</p>` +
      `<p>Lutfen okul ile iletisime gecerek odeme kaydinizi guncelleyin.</p>` +
      `<p>Yalova Sanat Bale & Dans Kursu</p>`
  };
}

async function sendStatusNotification(reservation, status) {
  if (!mailTransporter) {
    return {
      delivered: false,
      reason: "SMTP ayarlari tanimli degil."
    };
  }

  if (!reservation.email) {
    return {
      delivered: false,
      reason: "Kullanici e-postasi bulunamadi."
    };
  }

  const content = buildNotificationContent(reservation, status);
  await mailTransporter.sendMail({
    from: SMTP_FROM,
    to: reservation.email,
    subject: content.subject,
    text: content.text,
    html: content.html
  });

  return {
    delivered: true,
    reason: `${reservation.email} adresine bildirim gonderildi.`
  };
}

function getAllReservations() {
  releaseExpiredReservations();
  return db.prepare("SELECT * FROM reservations ORDER BY rowid DESC").all();
}

function getReservationById(id) {
  releaseExpiredReservations();
  return db.prepare("SELECT * FROM reservations WHERE id = ?").get(id);
}

function parseSeatsText(text) {
  return String(text || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isSeatBlocked(seats) {
  releaseExpiredReservations();
  for (const seat of seats) {
    if (BOOKED_BY_DEFAULT.includes(seat)) {
      return true;
    }
  }

  const reservations = db.prepare(`
    SELECT seats_text, seat
    FROM reservations
    WHERE status IN ('awaiting_payment', 'pending', 'approved')
  `).all();

  return reservations.some((reservation) => {
    const reservedSeats = parseSeatsText(reservation.seats_text || reservation.seat);
    return seats.some((seat) => reservedSeats.includes(seat));
  });
}

function releaseExpiredReservations() {
  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE reservations
    SET status = 'expired'
    WHERE status = 'awaiting_payment'
      AND expires_at != ''
      AND expires_at < ?
  `).run(nowIso);
}

async function parseJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function validateReceiptPayload(receiptName, receiptContent) {
  const matches = receiptContent.match(/^data:(.+);base64,(.+)$/);
  if (!matches) {
    throw new Error("Dekont verisi hatalı.");
  }

  const mime = matches[1];
  if (!ALLOWED_RECEIPT_MIME[mime]) {
    throw new Error("Sadece JPG, PNG veya PDF dekont yüklenebilir.");
  }

  const buffer = Buffer.from(matches[2], "base64");
  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error("Dekont dosyası 5 MB sınırını aşıyor.");
  }

  const extension = path.extname(receiptName).toLowerCase() || ALLOWED_RECEIPT_MIME[mime];
  return {
    buffer,
    extension: sanitizeFileName(extension),
    mime
  };
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/config") {
    return sendJson(response, 200, {
      ticketPrice: TICKET_PRICE,
      bookedByDefault: BOOKED_BY_DEFAULT,
      holdMinutes: HOLD_MINUTES,
      maxTicketsPerOrder: MAX_TICKETS_PER_ORDER
    });
  }

  if (request.method === "GET" && url.pathname === "/api/availability") {
    const reservations = getAllReservations();
    const blockedSeats = reservations
      .filter((item) => ["awaiting_payment", "pending", "approved"].includes(item.status))
      .flatMap((item) => parseSeatsText(item.seats_text || item.seat));

    return sendJson(response, 200, {
      blockedSeats: [...new Set([...BOOKED_BY_DEFAULT, ...blockedSeats])]
    });
  }

  if (request.method === "POST" && url.pathname === "/api/reservations") {
    const body = await parseJsonBody(request);
    const { name, phone, email } = body;
    const seats = Array.isArray(body.seats) ? body.seats.map((item) => String(item).trim()).filter(Boolean) : [];

    if (!name || !phone || !email || !seats.length) {
      return sendJson(response, 400, { error: "Eksik rezervasyon bilgisi." });
    }

    if (seats.length > MAX_TICKETS_PER_ORDER) {
      return sendJson(response, 400, { error: `Bir sipariste en fazla ${MAX_TICKETS_PER_ORDER} bilet alinabilir.` });
    }

    if (isSeatBlocked(seats)) {
      return sendJson(response, 409, { error: "Seçtiğin koltuklardan biri dolu veya incelemede." });
    }

    const reservation = {
      id: randomUUID(),
      seat: seats[0],
      seats,
      name,
      phone,
      email,
      reference: createReferenceCode(seats[0]),
      amount: TICKET_PRICE * seats.length,
      status: "awaiting_payment",
      createdAt: new Date().toLocaleString("tr-TR"),
      expiresAt: new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString()
    };

    db.prepare(`
      INSERT INTO reservations (
        id, seat, name, phone, email, reference, amount, seats_text, seat_count, status, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reservation.id,
      reservation.seat,
      reservation.name,
      reservation.phone,
      reservation.email,
      reservation.reference,
      reservation.amount,
      reservation.seats.join(","),
      reservation.seats.length,
      reservation.status,
      reservation.createdAt,
      reservation.expiresAt
    );

    return sendJson(response, 201, reservation);
  }

  if (request.method === "POST" && /^\/api\/reservations\/[^/]+\/receipt$/.test(url.pathname)) {
    const reservationId = url.pathname.split("/")[3];
    const body = await parseJsonBody(request);
    const { receiptName, receiptContent, note } = body;

    if (!receiptName || !receiptContent) {
      return sendJson(response, 400, { error: "Dekont dosyası gerekli." });
    }

    const reservation = getReservationById(reservationId);
    if (!reservation) {
      return sendJson(response, 404, { error: "Rezervasyon bulunamadı." });
    }

    if (reservation.status === "approved") {
      return sendJson(response, 400, { error: "Bu rezervasyon zaten onaylanmış." });
    }

    try {
      const parsedReceipt = validateReceiptPayload(receiptName, receiptContent);
      const fileName = `${reservation.reference}-${Date.now()}${parsedReceipt.extension}`;
      await fsp.writeFile(path.join(UPLOADS_DIR, fileName), parsedReceipt.buffer);

      db.prepare(`
        UPDATE reservations
        SET receipt_name = ?, receipt_uploaded_at = ?, note = ?, status = ?, receipt_path = ?, expires_at = ''
        WHERE id = ?
      `).run(
        receiptName,
        new Date().toLocaleString("tr-TR"),
        note || "",
        "pending",
        fileName,
        reservationId
      );

      return sendJson(response, 200, publicReservationShape(getReservationById(reservationId)));
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (request.method === "GET" && url.pathname === "/api/admin/session") {
    const session = getSession(request);
    return sendJson(response, 200, {
      authenticated: Boolean(session),
      username: session?.username || ""
    });
  }

  if (request.method === "POST" && url.pathname === "/api/admin/login") {
    const body = await parseJsonBody(request);
    const username = String(body.username || "");
    const password = String(body.password || "");
    const incomingHash = createPasswordHash(password);

    const usernameMatches = username === ADMIN_USERNAME;
    const passwordMatches = timingSafeEqual(incomingHash, adminPasswordHash);

    if (!usernameMatches || !passwordMatches) {
      return sendJson(response, 401, { error: "Kullanıcı adı veya şifre hatalı." });
    }

    const token = createSession();
    return sendJson(
      response,
      200,
      { ok: true, username: ADMIN_USERNAME },
      {
        "Set-Cookie": `admin_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`
      }
    );
  }

  if (request.method === "POST" && url.pathname === "/api/admin/logout") {
    const session = getSession(request);
    if (session) {
      sessions.delete(session.token);
    }

    return sendJson(
      response,
      200,
      { ok: true },
      { "Set-Cookie": "admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" }
    );
  }

  if (request.method === "GET" && url.pathname === "/api/admin/reservations") {
    if (!requireAdmin(request, response)) {
      return;
    }

    return sendJson(response, 200, getAllReservations().map(adminReservationShape));
  }

  if (request.method === "PATCH" && /^\/api\/admin\/reservations\/[^/]+\/status$/.test(url.pathname)) {
    if (!requireAdmin(request, response)) {
      return;
    }

    const reservationId = url.pathname.split("/")[4];
    const body = await parseJsonBody(request);
    const { status } = body;

    if (!["approved", "rejected", "pending"].includes(status)) {
      return sendJson(response, 400, { error: "Geçersiz durum." });
    }

    const reservation = getReservationById(reservationId);
    if (!reservation) {
      return sendJson(response, 404, { error: "Rezervasyon bulunamadı." });
    }

    db.prepare("UPDATE reservations SET status = ? WHERE id = ?").run(status, reservationId);
    const updatedReservation = getReservationById(reservationId);

    let notification = {
      delivered: false,
      reason: "Bildirim gonderilmedi."
    };

    if (status === "approved" || status === "rejected") {
      try {
        notification = await sendStatusNotification(updatedReservation, status);
      } catch (error) {
        notification = {
          delivered: false,
          reason: `Mail gonderilemedi: ${error.message}`
        };
      }
    }

    return sendJson(response, 200, {
      reservation: adminReservationShape(updatedReservation),
      notification
    });
  }

  if (request.method === "DELETE" && /^\/api\/admin\/reservations\/[^/]+$/.test(url.pathname)) {
    if (!requireAdmin(request, response)) {
      return;
    }

    const reservationId = url.pathname.split("/")[4];
    const reservation = getReservationById(reservationId);
    if (!reservation) {
      return sendJson(response, 404, { error: "Rezervasyon bulunamadı." });
    }

    await removeReceiptFile(reservation.receipt_path);
    db.prepare("DELETE FROM reservations WHERE id = ?").run(reservationId);
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === "POST" && url.pathname === "/api/admin/reservations/cleanup") {
    if (!requireAdmin(request, response)) {
      return;
    }

    const cleanupTargets = db.prepare(`
      SELECT * FROM reservations
      WHERE status IN ('rejected', 'expired')
    `).all();

    for (const reservation of cleanupTargets) {
      await removeReceiptFile(reservation.receipt_path);
    }

    db.prepare(`
      DELETE FROM reservations
      WHERE status IN ('rejected', 'expired')
    `).run();

    return sendJson(response, 200, {
      ok: true,
      deletedCount: cleanupTargets.length
    });
  }

  if (request.method === "GET" && /^\/api\/admin\/receipts\/[^/]+$/.test(url.pathname)) {
    if (!requireAdmin(request, response)) {
      return;
    }

    const reservationId = url.pathname.split("/")[4];
    const reservation = getReservationById(reservationId);
    if (!reservation || !reservation.receipt_path) {
      return sendText(response, 404, "Dekont bulunamadı.");
    }

    const filePath = path.join(UPLOADS_DIR, getStoredReceiptFileName(reservation.receipt_path));
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${sanitizeFileName(reservation.receipt_name || path.basename(filePath))}"`
    });
    fs.createReadStream(filePath).pipe(response);
    return;
  }

  return false;
}

async function serveStatic(response, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) {
    sendText(response, 403, "Erişim engellendi.");
    return;
  }

  try {
    const stats = await fsp.stat(filePath);
    if (stats.isDirectory()) {
      sendText(response, 404, "Bulunamadı.");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(response);
  } catch {
    sendText(response, 404, "Bulunamadı.");
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(request, response, url);
      if (handled !== false) {
        return;
      }
      return sendJson(response, 404, { error: "API bulunamadı." });
    }

    await serveStatic(response, decodeURIComponent(url.pathname));
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "Sunucu hatası oluştu." });
  }
});

ensureStorage()
  .then(() => {
    mailTransporter = createMailTransporter();
    server.listen(PORT, HOST, () => {
      console.log(`Sunucu çalışıyor: http://localhost:${PORT}`);
      console.log(`Admin kullanıcı adı: ${ADMIN_USERNAME}`);
      if (!mailTransporter) {
        console.log("Mail bildirimi icin SMTP ayarlari eksik.");
      }
    });
  })
  .catch((error) => {
    console.error("Sunucu başlatılamadı:", error);
    process.exit(1);
  });
