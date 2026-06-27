# ExploreX MySQL Production Deployment Guide

This guide prepares the ExploreX MySQL database for a Render backend deployment without changing frontend or application logic.

## Recommended Free MySQL Provider

Recommended for a free demo/presentation deployment: FreeSQLDatabase.com

Why this fits ExploreX now:
- It provides a free MySQL database.
- It allows remote connections, so Render can connect to it.
- It includes phpMyAdmin, so importing SQL is beginner-friendly.
- It works with the current backend connection style: host, port, user, password, database.

Important limitation:
- The free database space is small. It is okay for demo/presentation, but for real public production you should upgrade to a paid MySQL provider with backups, monitoring, storage, and SLA.

Avoid for production:
- db4free.net is useful for testing MySQL versions, but its official site says it is not suitable for production.

Future stronger option:
- TiDB Cloud Starter has a large free serverless tier and MySQL-compatible behavior, but it can require SSL connection settings. Use it later if we add DB SSL support safely.

## Files

- `Backend/sql/production_schema.sql` is the clean production import file.
- `Backend/sql/schema.sql` remains as the existing project schema reference.
- `Backend/.env.example` contains safe placeholders only.
- `Backend/.env` must never be committed.

## Database Creation Steps

1. Create a free MySQL account on your provider.
2. Create one database named `explorex` if the provider lets you choose the name.
3. Copy the connection details:
   - host
   - port, usually `3306`
   - database name
   - username
   - password
4. Open phpMyAdmin or your MySQL client.
5. Select the ExploreX database.
6. Import `Backend/sql/production_schema.sql`.
7. Confirm all tables are created successfully.

## SQL Import Options

### Option A: phpMyAdmin

1. Login to phpMyAdmin.
2. Select your ExploreX database.
3. Click `Import`.
4. Choose `Backend/sql/production_schema.sql`.
5. Click `Go`.

### Option B: MySQL CLI

Run this from the project root after replacing the placeholders:

```bash
mysql -h YOUR_DB_HOST -P 3306 -u YOUR_DB_USER -p YOUR_DB_NAME < Backend/sql/production_schema.sql
```

If the SQL file already includes `CREATE DATABASE` and your provider does not allow database creation, open the file and import only after the `USE explorex;` line using phpMyAdmin. Most free hosts already create the database for you.

## Required Render Environment Variables

Add these in Render Dashboard > your backend service > Environment:

```env
NODE_ENV=production
DB_HOST=your_mysql_host
DB_PORT=3306
DB_USER=your_mysql_user
DB_PASSWORD=your_mysql_password
DB_NAME=your_mysql_database
DB_CONNECTION_LIMIT=10
DB_QUEUE_LIMIT=0
DB_CONNECT_TIMEOUT_MS=10000
JWT_SECRET=replace_with_a_long_random_secret
FRONTEND_ORIGIN=https://YOUR_GITHUB_USERNAME.github.io
FRONTEND_APP_URL=https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPOSITORY_NAME
PUBLISH_DUE_JOB_ENABLED=true
```

Optional, only if you use these features in production:

```env
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email_user
SMTP_PASS=your_email_password
EMAIL_FROM=ExploreX <no-reply@example.com>
SMS_OTP_PROVIDER=dev
OPENROUTESERVICE_API_KEY=your_openrouteservice_key
```

Render sets `PORT` automatically. Do not hardcode it.

## Backend Connection Verification

After deploying the backend on Render:

1. Open the backend health route:

```text
https://YOUR_RENDER_BACKEND.onrender.com/
```

Expected response:

```json
{ "status": "ExploreX Backend Running" }
```

2. Check database health:

```text
https://YOUR_RENDER_BACKEND.onrender.com/api/health/db
```

Expected result should show database connectivity as healthy.

3. Test login/signup from frontend.
4. Test profile save/update, route save, support ticket, hotel booking, and admin login.
5. If Render logs show `Access denied`, check DB username/password.
6. If Render logs show `connect ETIMEDOUT`, check host, port, remote connection permission, or provider firewall.
7. If Render logs show SSL errors, the selected DB host requires SSL and we need to add `DB_SSL` support in backend connection config.

## Schema Verification Summary

The production schema includes all current ExploreX tables:

- auth and users: `users`, `password_reset_tokens`, `phone_otp_verifications`, `email_otp_verifications`, `auth_token_revocations`
- profile: `profile_states`, `user_profiles`, `memory_moderation`
- places and route planner: `places`, `place_categories`, `itineraries`, `itinerary_items`
- city services: `city_services`, `city_service_events`, `city_service_reports`, `city_service_ratings`
- Kumbh and home: `kumbh_items`, `kumbh_settings`, `home_sections`, `search_analytics`
- admin/security: `audit_logs`, `admin_permissions`
- hotels: `hotel_bookings`, `hotel_owner_states`, `hotel_owner_logins`, `hotel_enquiries`
- support: `support_tickets`, `support_messages`

The schema uses:

- MySQL 8.x compatible SQL
- InnoDB tables
- `utf8mb4_unicode_ci` collation
- primary keys for all tables
- unique keys for login/profile-safe data where needed
- indexes for common lookup columns
- foreign keys with cascade behavior where records are owned by users, tickets, services, routes, or places

## Production Safety Notes

- Keep `Backend/.env` private.
- Keep `.env.example` tracked.
- Do not commit database dumps with real user data.
- Use a strong `JWT_SECRET`.
- Use a MySQL password that is unique to this project.
- Before a real public launch, move from a free DB to a paid database with automated backups.

