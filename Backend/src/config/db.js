const mysql = require("mysql2/promise");

const dbNameRaw = process.env.DB_NAME || "explorex";
const dbName = /^[a-zA-Z0-9_]+$/.test(dbNameRaw) ? dbNameRaw : "explorex";

function toPositiveInt(value, fallback, { min = 1, max = 100 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

const baseConfig = {
  host: process.env.DB_HOST || "localhost",
  port: toPositiveInt(process.env.DB_PORT || 3306, 3306, { min: 1, max: 65535 }),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  connectTimeout: toPositiveInt(process.env.DB_CONNECT_TIMEOUT_MS || 10000, 10000, { min: 1000, max: 60000 })
};

const pool = mysql.createPool({
  ...baseConfig,
  database: dbName,
  waitForConnections: true,
  connectionLimit: toPositiveInt(process.env.DB_CONNECTION_LIMIT || 10, 10, { min: 1, max: 50 }),
  queueLimit: toPositiveInt(process.env.DB_QUEUE_LIMIT || 0, 0, { min: 0, max: 10000 }),
  decimalNumbers: true
});

function describeDatabaseError(error) {
  const code = error?.code || "UNKNOWN";
  if (code === "ECONNREFUSED") {
    return "MySQL connection refused. Please start MySQL and verify DB_HOST/DB_PORT.";
  }
  if (code === "ER_ACCESS_DENIED_ERROR") {
    return "MySQL access denied. Please verify DB_USER and DB_PASSWORD in Backend/.env.";
  }
  if (code === "ENOTFOUND") {
    return "MySQL host not found. Please verify DB_HOST in Backend/.env.";
  }
  if (code === "ETIMEDOUT" || code === "PROTOCOL_SEQUENCE_TIMEOUT") {
    return "MySQL connection timed out. Please verify MySQL is reachable.";
  }
  return error?.message || "Database error";
}

const DEFAULT_KUMBH_ITEMS = [
  {
    type: "ticker",
    key: "crowd_advisory",
    title: "Ram Kund crowd is high after 8 AM. Prefer early morning darshan.",
    priority: 90
  },
  {
    type: "ticker",
    key: "medical_camps",
    title: "Medical camps and drinking water points are available near major ghats.",
    priority: 80
  },
  {
    type: "ticker",
    key: "lost_found",
    title: "For lost and found help, use the nearest official police or help desk.",
    priority: 70
  },
  {
    type: "crowd",
    key: "ram_kund",
    title: "Ram Kund Ghat",
    category: "High",
    priority: 100,
    meta: { level: 3, percent: 90 }
  },
  {
    type: "crowd",
    key: "panchvati_ghat",
    title: "Panchvati Ghat",
    category: "Medium",
    priority: 90,
    meta: { level: 2, percent: 58 }
  },
  {
    type: "crowd",
    key: "sita_gufaa",
    title: "Sita Gufa Ghat",
    category: "Medium",
    priority: 80,
    meta: { level: 2, percent: 54 }
  },
  {
    type: "crowd",
    key: "gorakhkund",
    title: "Gorakhkund Ghat",
    category: "Low",
    priority: 70,
    meta: { level: 1, percent: 28 }
  },
  {
    type: "crowd",
    key: "ahilyadevi",
    title: "Ahilyadevi Ghat",
    category: "Low",
    priority: 60,
    meta: { level: 1, percent: 30 }
  },
  {
    type: "crowd",
    key: "makhmalabad",
    title: "Makhmalabad Route",
    category: "Medium",
    priority: 50,
    meta: { level: 2, percent: 48 }
  },
  {
    type: "date",
    key: "peshwai",
    title: "Shahi Snan - Peshwai",
    subtitle: "Grand procession and royal bath",
    category: "shahi",
    priority: 100,
    date: "2027-07-11",
    meta: { tagLabel: "Shahi Snan" }
  },
  {
    type: "date",
    key: "nag_panchami",
    title: "Shahi Snan - Nag Panchami",
    subtitle: "Biggest holy dip of Kumbh",
    category: "shahi",
    priority: 95,
    date: "2027-08-27",
    meta: { tagLabel: "Shahi Snan" }
  },
  {
    type: "date",
    key: "ramnavami",
    title: "Shahi Snan - Ramnavami",
    subtitle: "Final main Snan day",
    category: "shahi",
    priority: 90,
    date: "2027-09-13",
    meta: { tagLabel: "Shahi Snan" }
  },
  {
    type: "date",
    key: "guru_purnima",
    title: "Guru Purnima Snan",
    subtitle: "Auspicious full moon holy dip",
    category: "snan",
    priority: 80,
    date: "2027-07-15",
    meta: { tagLabel: "Snan" }
  },
  {
    type: "facility",
    key: "toilets",
    title: "Public Toilets",
    subtitle: "50m - Ram Kund",
    category: "Sanitation",
    priority: 100
  },
  {
    type: "facility",
    key: "water",
    title: "Drinking Water",
    subtitle: "Every 100m on ghats",
    category: "Essentials",
    priority: 95
  },
  {
    type: "facility",
    key: "medical_camp",
    title: "Medical Camp",
    subtitle: "Panchvati Entry Gate",
    category: "Emergency",
    priority: 90
  },
  {
    type: "facility",
    key: "police_post",
    title: "Police Post",
    subtitle: "Ram Kund Chowk",
    category: "Emergency",
    priority: 85
  },
  {
    type: "helpline",
    key: "police",
    title: "Police Control Room",
    subtitle: "100",
    description: "Nashik City Police - 24/7 active",
    category: "Police",
    priority: 100
  },
  {
    type: "helpline",
    key: "ambulance",
    title: "Medical Emergency",
    subtitle: "108",
    description: "Ambulance Service - Pan Maharashtra",
    category: "Medical",
    priority: 95
  },
  {
    type: "helpline",
    key: "emergency",
    title: "National Emergency",
    subtitle: "112",
    description: "Police, fire and medical emergency",
    category: "Emergency",
    priority: 110
  },
  {
    type: "route",
    key: "nashik_city__ram_kund",
    title: "Nashik City Center to Ram Kund",
    subtitle: "3.2 km",
    description: "Use Sharanpur Road for a balanced route.",
    priority: 90,
    meta: { from: "nashik_city", to: "ram_kund", dist: "3.2 km", time: "12 min", via: "Sharanpur Rd", tip: "Arrive before 7 AM for peaceful darshan." }
  },
  {
    type: "route",
    key: "cbs__ram_kund",
    title: "CBS Bus Stand to Ram Kund",
    subtitle: "1.8 km",
    description: "Short city route via Panchvati Road.",
    priority: 80,
    meta: { from: "cbs", to: "ram_kund", dist: "1.8 km", time: "8 min", via: "Panchvati Rd", tip: "Good route for walking or auto." }
  },
  {
    type: "tip",
    key: "early_visit",
    title: "Best time to visit",
    description: "Visit before sunrise or after evening peak for calmer darshan.",
    category: "Planning",
    priority: 100
  },
  {
    type: "moment",
    key: "ram_kund_evening",
    title: "Evening Aarti Glow",
    subtitle: "Ram Kund",
    description: "Golden evening lights near the ghats during aarti.",
    category: "Admin Pick",
    priority: 100,
    meta: {
      image: "https://images.unsplash.com/photo-1609766857933-a1b6fcc7a54f?w=700&q=80&fit=crop",
      user: "ExploreX Team",
      location: "Ram Kund"
    }
  },
  {
    type: "moment",
    key: "panchvati_prayers",
    title: "Pilgrims at Panchvati",
    subtitle: "Panchvati Ghat",
    description: "A peaceful morning moment from Panchvati.",
    category: "Featured",
    priority: 90,
    meta: {
      image: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=700&q=80&fit=crop",
      user: "ExploreX Team",
      location: "Panchvati Ghat"
    }
  },
  {
    type: "moment",
    key: "trimbak_devotion",
    title: "Devotion at Trimbak",
    subtitle: "Trimbakeshwar",
    description: "Spiritual travel moment from the Kumbh region.",
    category: "Featured",
    priority: 80,
    meta: {
      image: "https://images.unsplash.com/photo-1548013146-72479768bada?w=700&q=80&fit=crop",
      user: "ExploreX Team",
      location: "Trimbakeshwar"
    }
  }
];

const DEFAULT_KUMBH_SETTINGS = {
  enabled: true,
  badge: "Nashik Kumbh Mela Guide",
  title: "Nashik Kumbh Mela Smart Guide",
  subtitle: "Crowd guidance, smart routes, important dates and emergency help for Nashik Kumbh Mela 2027.",
  emergencyText: "Emergency Help Available 24/7",
  helpline: "112",
  disabledTitle: "Kumbh Guide is temporarily offline",
  disabledMessage: "The admin team is updating guide information. Please check again shortly.",
  sections: {
    ticker: false,
    crowd: true,
    dates: true,
    weather: false,
    route: true,
    facilities: true,
    plan: true,
    suggestions: true,
    memories: false
  }
};

function toDateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function stringifyJson(value) {
  try {
    return JSON.stringify(value == null ? {} : value);
  } catch (error) {
    return "{}";
  }
}

async function ensureDatabase() {
  const connection = await mysql.createConnection(baseConfig);
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await connection.end();
  }
}

async function testConnection() {
  const connection = await pool.getConnection();
  try {
    await connection.query("SELECT 1");
  } finally {
    connection.release();
  }
}

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      full_name VARCHAR(120) NOT NULL,
      email VARCHAR(190) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      username VARCHAR(80) NULL,
      role VARCHAR(32) NOT NULL DEFAULT 'Traveller',
      phone VARCHAR(40) NULL,
      admin_pin_hash VARCHAR(255) NULL,
      admin_pin_updated_at DATETIME NULL,
      admin_pin_failed_attempts INT UNSIGNED NOT NULL DEFAULT 0,
      admin_pin_locked_until DATETIME NULL,
      account_status VARCHAR(24) NOT NULL DEFAULT 'active',
      deleted_at DATETIME NULL,
      deleted_original_email VARCHAR(190) NULL,
      deleted_original_username VARCHAR(80) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_users_email (email),
      UNIQUE KEY uq_users_username (username),
      KEY idx_users_status (account_status),
      KEY idx_users_role (role)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      token_hash CHAR(64) NOT NULL,
      requested_ip VARCHAR(64) NULL,
      attempts INT UNSIGNED NOT NULL DEFAULT 0,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_reset_token_hash (token_hash),
      KEY idx_reset_tokens_user (user_id),
      KEY idx_reset_tokens_expires (expires_at),
      CONSTRAINT fk_reset_tokens_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS phone_otp_verifications (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      phone VARCHAR(40) NOT NULL,
      purpose VARCHAR(40) NOT NULL DEFAULT 'signup',
      otp_hash CHAR(64) NOT NULL,
      verification_token_hash CHAR(64) NULL,
      requested_ip VARCHAR(64) NULL,
      attempts INT UNSIGNED NOT NULL DEFAULT 0,
      expires_at DATETIME NOT NULL,
      verified_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_phone_otp_lookup (phone, purpose, expires_at),
      KEY idx_phone_otp_token (verification_token_hash)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_otp_verifications (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      email VARCHAR(190) NOT NULL,
      purpose VARCHAR(40) NOT NULL DEFAULT 'signup',
      otp_hash CHAR(64) NOT NULL,
      requested_ip VARCHAR(64) NULL,
      attempts INT UNSIGNED NOT NULL DEFAULT 0,
      expires_at DATETIME NOT NULL,
      verified_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_email_otp_lookup (email, purpose, expires_at),
      KEY idx_email_otp_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_token_revocations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      token_hash CHAR(64) NOT NULL,
      user_id BIGINT UNSIGNED NULL,
      reason VARCHAR(40) NOT NULL DEFAULT 'logout',
      revoked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_auth_revocation_hash (token_hash),
      KEY idx_auth_revocation_user (user_id),
      KEY idx_auth_revocation_expires (expires_at),
      CONSTRAINT fk_auth_revocation_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id BIGINT UNSIGNED NOT NULL,
      name VARCHAR(120) NOT NULL DEFAULT 'Traveller',
      username VARCHAR(80) NOT NULL DEFAULT '@explorer',
      bio TEXT NULL,
      location VARCHAR(190) NULL,
      avatar_url LONGTEXT NULL,
      cover_url LONGTEXT NULL,
      settings_json LONGTEXT NOT NULL,
      visited_ids_json LONGTEXT NOT NULL,
      saved_ids_json LONGTEXT NOT NULL,
      activity_json LONGTEXT NOT NULL,
      goals_json LONGTEXT NOT NULL,
      interests_json LONGTEXT NOT NULL,
      memories_json LONGTEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id),
      CONSTRAINT fk_user_profiles_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Backward-compatible migration for already created tables.
  await pool.query(`
    ALTER TABLE user_profiles
      MODIFY avatar_url LONGTEXT NULL,
      MODIFY cover_url LONGTEXT NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS profile_states (
      uid VARCHAR(64) NOT NULL,
      name VARCHAR(120) NOT NULL DEFAULT 'Traveller',
      username VARCHAR(80) NOT NULL DEFAULT '@explorer',
      bio TEXT NULL,
      location VARCHAR(150) NOT NULL DEFAULT 'Nashik, Maharashtra',
      avatar_url LONGTEXT NULL,
      cover_url LONGTEXT NULL,
      settings_json LONGTEXT NULL,
      visited_ids_json LONGTEXT NULL,
      visited_places_json LONGTEXT NULL,
      saved_ids_json LONGTEXT NULL,
      saved_places_json LONGTEXT NULL,
      activity_json LONGTEXT NULL,
      goals_json LONGTEXT NULL,
      interests_json LONGTEXT NULL,
      memories_json LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (uid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS places (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(160) NOT NULL,
      city VARCHAR(120) NOT NULL,
      area VARCHAR(160) NULL,
      latitude DECIMAL(10,7) NULL,
      longitude DECIMAL(10,7) NULL,
      entry_fee VARCHAR(80) NULL,
      category VARCHAR(80) NOT NULL,
      secondary_category VARCHAR(80) NULL,
      best_time VARCHAR(160) NULL,
      time_required VARCHAR(120) NULL,
      image_url LONGTEXT NULL,
      description TEXT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'draft',
      featured TINYINT(1) NOT NULL DEFAULT 0,
      priority INT UNSIGNED NOT NULL DEFAULT 0,
      scheduled_at DATETIME NULL,
      slug VARCHAR(190) NOT NULL,
      meta_title VARCHAR(190) NULL,
      meta_description TEXT NULL,
      cover_alt VARCHAR(190) NULL,
      gallery_json LONGTEXT NULL,
      analytics_json LONGTEXT NULL,
      is_deleted TINYINT(1) NOT NULL DEFAULT 0,
      deleted_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_places_slug (slug),
      KEY idx_places_status (status),
      KEY idx_places_city (city),
      KEY idx_places_deleted (is_deleted)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS city_services (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(160) NOT NULL,
      city VARCHAR(120) NOT NULL,
      area VARCHAR(160) NULL,
      category VARCHAR(80) NOT NULL DEFAULT 'Transport',
      description TEXT NULL,
      link VARCHAR(700) NULL,
      availability_label VARCHAR(120) NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_services_city (city),
      KEY idx_services_category (category),
      KEY idx_services_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS city_service_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      service_id BIGINT UNSIGNED NOT NULL,
      event_type VARCHAR(32) NOT NULL DEFAULT 'open',
      city VARCHAR(120) NULL,
      category VARCHAR(80) NULL,
      user_uid VARCHAR(80) NULL,
      session_id VARCHAR(120) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_service_events_service (service_id),
      KEY idx_service_events_type (event_type),
      KEY idx_service_events_created (created_at),
      CONSTRAINT fk_service_events_service
        FOREIGN KEY (service_id) REFERENCES city_services(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS city_service_reports (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      service_id BIGINT UNSIGNED NOT NULL,
      reason VARCHAR(80) NOT NULL DEFAULT 'wrong_info',
      details TEXT NULL,
      city VARCHAR(120) NULL,
      reporter_uid VARCHAR(80) NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_service_reports_service (service_id),
      KEY idx_service_reports_status (status),
      KEY idx_service_reports_created (created_at),
      CONSTRAINT fk_service_reports_service
        FOREIGN KEY (service_id) REFERENCES city_services(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS city_service_ratings (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      service_id BIGINT UNSIGNED NOT NULL,
      rating TINYINT UNSIGNED NOT NULL,
      city VARCHAR(120) NULL,
      user_uid VARCHAR(80) NULL,
      session_id VARCHAR(120) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_service_ratings_service (service_id),
      KEY idx_service_ratings_created (created_at),
      CONSTRAINT fk_service_ratings_service
        FOREIGN KEY (service_id) REFERENCES city_services(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kumbh_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      item_type VARCHAR(40) NOT NULL,
      item_key VARCHAR(120) NOT NULL,
      title VARCHAR(190) NOT NULL,
      subtitle VARCHAR(255) NULL,
      description TEXT NULL,
      icon VARCHAR(24) NULL,
      category VARCHAR(80) NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'active',
      priority INT UNSIGNED NOT NULL DEFAULT 0,
      date_value DATE NULL,
      meta_json LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_kumbh_item_type_key (item_type, item_key),
      KEY idx_kumbh_type_status (item_type, status),
      KEY idx_kumbh_priority (priority)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kumbh_settings (
      setting_key VARCHAR(80) NOT NULL,
      setting_value LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (setting_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS home_sections (
      section_key VARCHAR(60) NOT NULL,
      label VARCHAR(120) NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      display_order INT UNSIGNED NOT NULL DEFAULT 1,
      title VARCHAR(190) NULL,
      subtitle VARCHAR(255) NULL,
      meta_json LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (section_key),
      KEY idx_home_sections_order (display_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS search_analytics (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      query VARCHAR(180) NOT NULL,
      normalized_query VARCHAR(180) NOT NULL,
      city VARCHAR(120) NULL,
      category VARCHAR(80) NULL,
      user_uid VARCHAR(80) NULL,
      result_count INT UNSIGNED NOT NULL DEFAULT 0,
      source VARCHAR(40) NOT NULL DEFAULT 'home',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_search_analytics_query (normalized_query),
      KEY idx_search_analytics_city (city),
      KEY idx_search_analytics_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      action VARCHAR(80) NOT NULL,
      entity VARCHAR(80) NOT NULL,
      entity_id BIGINT NULL,
      details TEXT NOT NULL,
      meta_json LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_audit_entity (entity),
      KEY idx_audit_action (action),
      KEY idx_audit_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_permissions (
      admin_id BIGINT UNSIGNED NOT NULL,
      permission_key VARCHAR(64) NOT NULL,
      can_edit TINYINT(1) NOT NULL DEFAULT 1,
      updated_by BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (admin_id, permission_key),
      KEY idx_admin_permissions_updated_by (updated_by),
      CONSTRAINT fk_admin_permissions_admin
        FOREIGN KEY (admin_id) REFERENCES users(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_admin_permissions_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id)
        ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hotel_bookings (
      id VARCHAR(80) NOT NULL,
      user_uid VARCHAR(120) NULL,
      user_name VARCHAR(160) NULL,
      hotel_id VARCHAR(120) NULL,
      owner_hotel_id VARCHAR(120) NULL,
      hotel_place_id VARCHAR(120) NULL,
      hotel_name VARCHAR(190) NULL,
      place_name VARCHAR(190) NULL,
      city VARCHAR(120) NULL,
      room_key VARCHAR(80) NULL,
      room_name VARCHAR(160) NULL,
      checkin VARCHAR(32) NULL,
      checkout VARCHAR(32) NULL,
      guests INT UNSIGNED NOT NULL DEFAULT 1,
      rooms INT UNSIGNED NOT NULL DEFAULT 1,
      nights INT UNSIGNED NOT NULL DEFAULT 1,
      subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
      taxes DECIMAL(12,2) NOT NULL DEFAULT 0,
      total DECIMAL(12,2) NOT NULL DEFAULT 0,
      commission_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
      platform_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
      commission_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      hotel_payout DECIMAL(12,2) NOT NULL DEFAULT 0,
      payout_status VARCHAR(32) NOT NULL DEFAULT 'pending',
      status VARCHAR(32) NOT NULL DEFAULT 'requested',
      assigned_room_numbers_json LONGTEXT NULL,
      meta_json LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_hotel_bookings_user (user_uid),
      KEY idx_hotel_bookings_owner (owner_hotel_id),
      KEY idx_hotel_bookings_hotel (hotel_id),
      KEY idx_hotel_bookings_place (hotel_place_id),
      KEY idx_hotel_bookings_status (status),
      KEY idx_hotel_bookings_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hotel_owner_states (
      hotel_id VARCHAR(120) NOT NULL,
      hotel_name VARCHAR(190) NULL,
      profile_json LONGTEXT NULL,
      rooms_json LONGTEXT NULL,
      settings_json LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (hotel_id),
      KEY idx_hotel_owner_states_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hotel_owner_logins (
      hotel_id VARCHAR(120) NOT NULL,
      hotel_name VARCHAR(190) NOT NULL DEFAULT 'Hotel',
      password_hash VARCHAR(255) NOT NULL,
      place_id VARCHAR(120) NULL,
      hotel_place_id VARCHAR(120) NULL,
      city VARCHAR(120) NULL,
      area VARCHAR(160) NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'active',
      last_login_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (hotel_id),
      UNIQUE KEY uq_hotel_owner_logins_place (hotel_place_id),
      KEY idx_hotel_owner_logins_status (status),
      KEY idx_hotel_owner_logins_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hotel_enquiries (
      id VARCHAR(80) NOT NULL,
      user_uid VARCHAR(120) NULL,
      user_name VARCHAR(160) NULL,
      phone VARCHAR(80) NULL,
      email VARCHAR(190) NULL,
      topic VARCHAR(160) NULL,
      message TEXT NULL,
      reply_note TEXT NULL,
      hotel_id VARCHAR(120) NULL,
      owner_hotel_id VARCHAR(120) NULL,
      hotel_place_id VARCHAR(120) NULL,
      hotel_name VARCHAR(190) NULL,
      place_name VARCHAR(190) NULL,
      city VARCHAR(120) NULL,
      room_key VARCHAR(80) NULL,
      room_name VARCHAR(160) NULL,
      checkin VARCHAR(32) NULL,
      checkout VARCHAR(32) NULL,
      guests INT UNSIGNED NOT NULL DEFAULT 1,
      rooms INT UNSIGNED NOT NULL DEFAULT 1,
      status VARCHAR(32) NOT NULL DEFAULT 'new',
      meta_json LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_hotel_enquiries_user (user_uid),
      KEY idx_hotel_enquiries_owner (owner_hotel_id),
      KEY idx_hotel_enquiries_hotel (hotel_id),
      KEY idx_hotel_enquiries_place (hotel_place_id),
      KEY idx_hotel_enquiries_status (status),
      KEY idx_hotel_enquiries_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS memory_moderation (
      uid VARCHAR(64) NOT NULL,
      memory_id VARCHAR(120) NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'pending',
      reports INT UNSIGNED NOT NULL DEFAULT 0,
      moderated_by BIGINT UNSIGNED NULL,
      moderated_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (uid, memory_id),
      KEY idx_memory_moderation_status (status),
      KEY idx_memory_moderation_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS itineraries (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      title VARCHAR(160) NOT NULL DEFAULT 'My Trip',
      from_city VARCHAR(120) NOT NULL,
      to_city VARCHAR(120) NOT NULL,
      travel_mode VARCHAR(24) NOT NULL DEFAULT 'car',
      distance_km INT UNSIGNED NULL,
      duration_minutes INT UNSIGNED NULL,
      travel_date DATE NULL,
      notes TEXT NULL,
      meta_json LONGTEXT NULL,
      deleted_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_itineraries_user (user_id),
      KEY idx_itineraries_deleted (deleted_at),
      KEY idx_itineraries_created (created_at),
      CONSTRAINT fk_itineraries_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS itinerary_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      itinerary_id BIGINT UNSIGNED NOT NULL,
      place_id BIGINT UNSIGNED NULL,
      stop_name VARCHAR(160) NOT NULL,
      stop_city VARCHAR(120) NULL,
      stop_area VARCHAR(160) NULL,
      stop_category VARCHAR(80) NULL,
      sequence_no INT UNSIGNED NOT NULL DEFAULT 1,
      notes VARCHAR(255) NULL,
      meta_json LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_itinerary_items_itinerary (itinerary_id),
      KEY idx_itinerary_items_sequence (sequence_no),
      KEY idx_itinerary_items_place (place_id),
      CONSTRAINT fk_itinerary_items_itinerary
        FOREIGN KEY (itinerary_id) REFERENCES itineraries(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_itinerary_items_place
        FOREIGN KEY (place_id) REFERENCES places(id)
        ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      subject VARCHAR(160) NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'pending',
      resolved_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_support_tickets_user (user_id),
      KEY idx_support_tickets_status (status),
      KEY idx_support_tickets_updated (updated_at),
      CONSTRAINT fk_support_tickets_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_messages (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      ticket_id BIGINT UNSIGNED NOT NULL,
      sender_type VARCHAR(16) NOT NULL,
      sender_id BIGINT UNSIGNED NULL,
      message TEXT NOT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_support_messages_ticket_created (ticket_id, created_at),
      KEY idx_support_messages_ticket_read (ticket_id, is_read),
      CONSTRAINT fk_support_messages_ticket
        FOREIGN KEY (ticket_id) REFERENCES support_tickets(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  const [passwordResetAttemptsCol] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = 'password_reset_tokens'
       AND COLUMN_NAME = 'attempts'`,
    [dbName]
  );
  if (!passwordResetAttemptsCol[0]?.c) {
    await pool.query(`ALTER TABLE password_reset_tokens ADD COLUMN attempts INT UNSIGNED NOT NULL DEFAULT 0 AFTER requested_ip`);
  }

  const [savedPlacesCol] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = 'profile_states'
       AND COLUMN_NAME = 'saved_places_json'`,
    [dbName]
  );
  if (!savedPlacesCol[0]?.c) {
    await pool.query(`ALTER TABLE profile_states ADD COLUMN saved_places_json LONGTEXT NULL`);
  }

  const [visitedPlacesCol] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = 'profile_states'
       AND COLUMN_NAME = 'visited_places_json'`,
    [dbName]
  );
  if (!visitedPlacesCol[0]?.c) {
    await pool.query(`ALTER TABLE profile_states ADD COLUMN visited_places_json LONGTEXT NULL`);
  }

  const [homeSectionsMetaCol] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = 'home_sections'
       AND COLUMN_NAME = 'meta_json'`,
    [dbName]
  );
  if (!homeSectionsMetaCol[0]?.c) {
    await pool.query(`ALTER TABLE home_sections ADD COLUMN meta_json LONGTEXT NULL AFTER subtitle`);
  }

  const [placesEntryFeeCol] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = 'places'
       AND COLUMN_NAME = 'entry_fee'`,
    [dbName]
  );
  if (!placesEntryFeeCol[0]?.c) {
    await pool.query(`ALTER TABLE places ADD COLUMN entry_fee VARCHAR(80) NULL AFTER area`);
  }

  const [placesLatitudeCol] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = 'places'
       AND COLUMN_NAME = 'latitude'`,
    [dbName]
  );
  if (!placesLatitudeCol[0]?.c) {
    await pool.query(`ALTER TABLE places ADD COLUMN latitude DECIMAL(10,7) NULL AFTER area`);
  }

  const [placesLongitudeCol] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = 'places'
       AND COLUMN_NAME = 'longitude'`,
    [dbName]
  );
  if (!placesLongitudeCol[0]?.c) {
    await pool.query(`ALTER TABLE places ADD COLUMN longitude DECIMAL(10,7) NULL AFTER latitude`);
  }

  const placeDetailColumns = [
    ["secondary_category", "ALTER TABLE places ADD COLUMN secondary_category VARCHAR(80) NULL AFTER category"],
    ["best_time", "ALTER TABLE places ADD COLUMN best_time VARCHAR(160) NULL AFTER secondary_category"],
    ["time_required", "ALTER TABLE places ADD COLUMN time_required VARCHAR(120) NULL AFTER best_time"]
  ];
  for (const [column, statement] of placeDetailColumns) {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS c
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = 'places'
         AND COLUMN_NAME = ?`,
      [dbName, column]
    );
    if (!rows[0]?.c) {
      await pool.query(statement);
    }
  }

  const [servicesAvailabilityCol] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = 'city_services'
       AND COLUMN_NAME = 'availability_label'`,
    [dbName]
  );
  if (!servicesAvailabilityCol[0]?.c) {
    await pool.query(`ALTER TABLE city_services ADD COLUMN availability_label VARCHAR(120) NULL AFTER link`);
  }

  const hotelBookingFinanceColumns = [
    ["commission_rate", "ALTER TABLE hotel_bookings ADD COLUMN commission_rate DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER total"],
    ["platform_fee", "ALTER TABLE hotel_bookings ADD COLUMN platform_fee DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER commission_rate"],
    ["commission_amount", "ALTER TABLE hotel_bookings ADD COLUMN commission_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER platform_fee"],
    ["hotel_payout", "ALTER TABLE hotel_bookings ADD COLUMN hotel_payout DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER commission_amount"],
    ["payout_status", "ALTER TABLE hotel_bookings ADD COLUMN payout_status VARCHAR(32) NOT NULL DEFAULT 'pending' AFTER hotel_payout"]
  ];
  for (const [columnName, alterSql] of hotelBookingFinanceColumns) {
    const [columnRows] = await pool.query(
      `SELECT COUNT(*) AS c
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = 'hotel_bookings'
         AND COLUMN_NAME = ?`,
      [dbName, columnName]
    );
    if (!columnRows[0]?.c) {
      await pool.query(alterSql);
    }
  }

  const [servicesCategoryIndex] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = 'city_services'
       AND INDEX_NAME = 'idx_services_category'`,
    [dbName]
  );
  if (!servicesCategoryIndex[0]?.c) {
    await pool.query(`CREATE INDEX idx_services_category ON city_services(category)`);
  }

  const [usersRoleCol] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'role'`,
    [dbName]
  );
  if (!usersRoleCol[0]?.c) {
    await pool.query(
      `ALTER TABLE users ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'Traveller' AFTER username`
    );
  }

  const [usersPhoneCol] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'phone'`,
    [dbName]
  );
  if (!usersPhoneCol[0]?.c) {
    await pool.query(
      `ALTER TABLE users ADD COLUMN phone VARCHAR(40) NULL AFTER role`
    );
  }

  const adminPinColumns = [
    ["admin_pin_hash", "ALTER TABLE users ADD COLUMN admin_pin_hash VARCHAR(255) NULL AFTER phone"],
    ["admin_pin_updated_at", "ALTER TABLE users ADD COLUMN admin_pin_updated_at DATETIME NULL AFTER admin_pin_hash"],
    ["admin_pin_failed_attempts", "ALTER TABLE users ADD COLUMN admin_pin_failed_attempts INT UNSIGNED NOT NULL DEFAULT 0 AFTER admin_pin_updated_at"],
    ["admin_pin_locked_until", "ALTER TABLE users ADD COLUMN admin_pin_locked_until DATETIME NULL AFTER admin_pin_failed_attempts"]
  ];
  for (const [columnName, alterSql] of adminPinColumns) {
    const [columnRows] = await pool.query(
      `SELECT COUNT(*) AS c
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = 'users'
         AND COLUMN_NAME = ?`,
      [dbName, columnName]
    );
    if (!columnRows[0]?.c) {
      await pool.query(alterSql);
    }
  }

  const [usersAccountStatusCol] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'account_status'`,
    [dbName]
  );
  if (!usersAccountStatusCol[0]?.c) {
    await pool.query(
      `ALTER TABLE users ADD COLUMN account_status VARCHAR(24) NOT NULL DEFAULT 'active' AFTER phone`
    );
  }

  const [usersDeletedAtCol] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'deleted_at'`,
    [dbName]
  );
  if (!usersDeletedAtCol[0]?.c) {
    await pool.query(
      `ALTER TABLE users ADD COLUMN deleted_at DATETIME NULL AFTER account_status`
    );
  }

  const deletedUserIdentityColumns = [
    ["deleted_original_email", "ALTER TABLE users ADD COLUMN deleted_original_email VARCHAR(190) NULL AFTER deleted_at"],
    ["deleted_original_username", "ALTER TABLE users ADD COLUMN deleted_original_username VARCHAR(80) NULL AFTER deleted_original_email"]
  ];
  for (const [columnName, alterSql] of deletedUserIdentityColumns) {
    const [columnRows] = await pool.query(
      `SELECT COUNT(*) AS c
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = 'users'
         AND COLUMN_NAME = ?`,
      [dbName, columnName]
    );
    if (!columnRows[0]?.c) {
      await pool.query(alterSql);
    }
  }

  const [usersStatusIndex] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = 'users'
       AND INDEX_NAME = 'idx_users_status'`,
    [dbName]
  );
  if (!usersStatusIndex[0]?.c) {
    await pool.query(`CREATE INDEX idx_users_status ON users(account_status)`);
  }

  const [usersRoleIndex] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = 'users'
       AND INDEX_NAME = 'idx_users_role'`,
    [dbName]
  );
  if (!usersRoleIndex[0]?.c) {
    await pool.query(`CREATE INDEX idx_users_role ON users(role)`);
  }

  await pool.query(
    `UPDATE support_tickets
     SET status = CASE
       WHEN status IS NULL OR TRIM(status) = '' THEN 'pending'
       ELSE LOWER(status)
     END`
  );

  await pool.query(
    `UPDATE support_tickets
     SET status = 'pending'
     WHERE status NOT IN ('pending', 'resolved')`
  );

  await pool.query(
    `UPDATE users
     SET account_status = CASE
       WHEN account_status IS NULL OR TRIM(account_status) = '' THEN 'active'
       ELSE LOWER(account_status)
     END`
  );

  await pool.query(
    `UPDATE users
     SET account_status = 'deleted'
     WHERE deleted_at IS NOT NULL`
  );

  await pool.query(
    `UPDATE users
     SET
       deleted_original_email = CASE
         WHEN deleted_original_email IS NULL
              AND email NOT LIKE 'deleted+%@deleted.explorex.local'
           THEN email
         ELSE deleted_original_email
       END,
       deleted_original_username = CASE
         WHEN deleted_original_username IS NULL
              AND username IS NOT NULL
              AND username NOT LIKE '@deleted_%'
           THEN username
         ELSE deleted_original_username
       END,
       email = CASE
         WHEN email NOT LIKE 'deleted+%@deleted.explorex.local'
           THEN CONCAT('deleted+', id, '+', COALESCE(UNIX_TIMESTAMP(deleted_at), UNIX_TIMESTAMP()), '@deleted.explorex.local')
         ELSE email
       END,
       username = CASE
         WHEN username IS NULL OR username LIKE '@deleted_%' THEN username
         ELSE LEFT(CONCAT('@deleted_', id, '_', COALESCE(UNIX_TIMESTAMP(deleted_at), UNIX_TIMESTAMP())), 80)
       END
     WHERE deleted_at IS NOT NULL
       AND account_status = 'deleted'
       AND email NOT LIKE 'deleted+%@deleted.explorex.local'`
  );

  await pool.query(
    `UPDATE users
     SET account_status = 'active'
     WHERE account_status NOT IN ('active', 'inactive', 'blocked', 'deleted')`
  );

  // Keep revocation table clean.
  await pool.query(
    `DELETE FROM auth_token_revocations
     WHERE expires_at < NOW()`
  );

  // SECURITY: Admin role is now exclusively assigned via ADMIN_EMAILS env var
  // during registration (see auth.routes.js → resolveRegistrationRole).
  // Manual promotion can be done via the admin panel or direct SQL.

  await ensureDefaultKumbhItems();
  await ensureDefaultKumbhSettings();
}

async function ensureDefaultKumbhItems() {
  for (const item of DEFAULT_KUMBH_ITEMS) {
    await pool.query(
      `
      INSERT INTO kumbh_items (
        item_type, item_key, title, subtitle, description, icon, category,
        status, priority, date_value, meta_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE item_key = item_key
      `,
      [
        item.type,
        item.key,
        item.title,
        item.subtitle || null,
        item.description || null,
        item.icon || null,
        item.category || null,
        item.status || "active",
        Math.max(0, Math.trunc(Number(item.priority) || 0)),
        toDateOnly(item.date),
        stringifyJson(item.meta || {})
      ]
    );
  }

  // Retire only the two legacy seed contacts that were not official Kumbh helplines.
  await pool.query(
    `UPDATE kumbh_items
     SET status = 'inactive'
     WHERE item_type = 'helpline'
       AND ((item_key = 'tourist' AND subtitle = '1950')
         OR (item_key = 'medical_camp' AND subtitle = '0253-2573000'))`
  );

  await pool.query(
    `UPDATE kumbh_items
     SET title = 'For lost and found help, use the nearest official police or help desk.'
     WHERE item_type = 'ticker' AND item_key = 'lost_found'
       AND title LIKE '%tourist helpline%'`
  );
}

async function ensureDefaultKumbhSettings() {
  const entries = Object.entries(DEFAULT_KUMBH_SETTINGS);
  for (const [key, value] of entries) {
    await pool.query(
      `
      INSERT INTO kumbh_settings (setting_key, setting_value)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE
        setting_value = COALESCE(NULLIF(setting_value, ''), VALUES(setting_value))
      `,
      [key, stringifyJson(value)]
    );
  }


  await pool.query(
    `UPDATE kumbh_settings
     SET setting_value = '112'
     WHERE setting_key = 'helpline' AND setting_value = '1950'`
  );

  await pool.query(
    `UPDATE kumbh_settings
     SET setting_value = REPLACE(setting_value, 'Live crowd status', 'Crowd guidance')
     WHERE setting_key = 'subtitle' AND setting_value LIKE '%Live crowd status%'`
  );
}

module.exports = {
  pool,
  ensureDatabase,
  testConnection,
  initSchema,
  describeDatabaseError,
  ensureDefaultKumbhItems,
  ensureDefaultKumbhSettings
};
