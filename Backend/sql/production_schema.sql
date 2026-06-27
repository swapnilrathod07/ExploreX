-- ExploreX production database schema
-- MySQL 8.x compatible. Import this into your production MySQL database before deploying the backend.
CREATE DATABASE IF NOT EXISTS `explorex`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `explorex`;

SET NAMES utf8mb4;
SET time_zone = '+00:00';

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS place_categories (
  slug VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL,
  icon VARCHAR(16) NOT NULL DEFAULT '🏷️',
  description VARCHAR(255) NULL,
  color VARCHAR(24) NOT NULL DEFAULT '#1A3CD8',
  bg_color VARCHAR(24) NOT NULL DEFAULT '#DBEAFE',
  cover_image_url LONGTEXT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  display_order INT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (slug),
  KEY idx_place_categories_order (display_order),
  KEY idx_place_categories_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kumbh_settings (
  setting_key VARCHAR(80) NOT NULL,
  setting_value LONGTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- End of ExploreX production schema.
