# ExploreX Backend (Node.js + MySQL)

This backend supports auth flows used by `Frontend/login_1.html`.

## 1) Install prerequisites
- Install Node.js (LTS) and npm
- Install MySQL Server

## 2) Configure env
Copy `.env.example` values into `.env` and update:
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `FRONTEND_ORIGIN`

## 3) Install dependencies
```bash
npm install
```

## 4) Start backend
```bash
npm run dev
```
or
```bash
npm start
```

Server runs on: `http://localhost:5000`

## 5) APIs

### Health
- `GET /api/health`

### Register
- `POST /api/auth/register`
- Alias: `POST /api/register`

Body:
```json
{
  "name": "Swapnil Rathod",
  "email": "swapnil@example.com",
  "password": "secret123"
}
```

### Login
- `POST /api/auth/login`
- Alias: `POST /api/login`

Body:
```json
{
  "email": "swapnil@example.com",
  "password": "secret123"
}
```

### Profile (for `profile_2.html`)
- `GET /api/profile/:uid`
- `PUT /api/profile/:uid`

Example:
```json
{
  "name": "Swapnil Rathod",
  "username": "@swapnil",
  "bio": "Travel lover",
  "location": "Nashik, Maharashtra",
  "avatarUrl": "",
  "coverUrl": "",
  "settings": {
    "profile_public": true,
    "mem_public_default": false,
    "show_map": true,
    "track_activity": true
  },
  "visitedIds": [1,4,7],
  "visitedPlaces": [
    {
      "id": "vp_1714550000000_1",
      "placeId": 1,
      "name": "Pandavleni Caves",
      "area": "Nashik",
      "location": "Pandavleni, Nashik",
      "description": "Great morning view",
      "visitedDate": "2026-05-01",
      "image": ""
    }
  ],
  "savedIds": [2,8],
  "savedPlaces": {},
  "activity": [],
  "goals": [],
  "interests": ["Nature","Food"],
  "memories": []
}
```

### Admin APIs (for `explorex-admin.html`)

#### Overview
- `GET /api/admin/overview`

#### Users
- `GET /api/admin/users`
- `DELETE /api/admin/users/:id`

#### Places
- `GET /api/admin/places`
- `GET /api/admin/places/:id`
- `POST /api/admin/places`
- `PUT /api/admin/places/:id`
- `DELETE /api/admin/places/:id` (soft delete to trash)
- `POST /api/admin/places/:id/restore`
- `DELETE /api/admin/places/:id/permanent`
- `POST /api/admin/places/publish-due`

#### Services
- `GET /api/admin/services`
- `GET /api/admin/services/:id`
- `POST /api/admin/services`
- `PUT /api/admin/services/:id`
- `DELETE /api/admin/services/:id`

#### Home Sections
- `GET /api/admin/home-sections`
- `PUT /api/admin/home-sections`

Body example:
```json
{
  "sections": [
    {
      "key": "hero",
      "label": "Hero Section",
      "enabled": true,
      "order": 1,
      "title": "Explore Places Near You",
      "subtitle": "Discover hidden gems near your city"
    }
  ]
}
```

#### Audit Logs
- `GET /api/admin/audit-logs`
- `POST /api/admin/audit-logs`

### Live Chat Support APIs

#### User Support
- `POST /api/support/ticket`
- `GET /api/support/my-tickets`
- `GET /api/support/ticket/:id/messages`
- `POST /api/support/ticket/:id/message`

#### Admin Support
- `GET /api/admin/support/tickets`
- `PATCH /api/admin/support/ticket/:id/status`

## 6) DB schema
- Auto-created on startup (`users`, `profile_states` tables)
- Manual SQL available in `sql/schema.sql`
