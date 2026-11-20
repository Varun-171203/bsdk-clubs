# BSDK Clubs — Private Anonymous Group Messaging Web App

> **Your Gang. Your Bang.** — *WhatsApp like hood app • Their phone is their host.*
> Real friends are visible in **Group Info** for trust, while inside the chat every member speaks under a unique **per-group anonymous alias**.

## What's Included (Built from Complete Documentation v3.0)

- **Auth & Profile Setup**: User ID + Password login/register (bcrypt hashed), 5-attempt lockout rate limit, password recovery flow, JWT access + refresh tokens, profile setup (`Real Name + Photo` strictly for Group Info), plus **1-Click Demo Gang Login** (`piyush`, `rohan`, `ananya`, `kabir`, `meera`, password `bsdk1234`).
- **WhatsApp-Style Familiar UI**:
  - **Light theme default** (`#075E54` deep green header, `#128C7E` primary green, `#25D366` accent, `#ECE5DD` doodle chat wallpaper, `#D9FDD3` own bubbles, `#FFFFFF` others' bubbles).
  - **Dark theme optional** (`#111B21` / `#0B141A` / `#1F2C34`), selectable in **Settings → Chats**.
  - Desktop WhatsApp Web dual-pane layout + responsive mobile bottom navigation (`Chats | Clubs | Updates | Calls`).
- **Core Anonymity Guarantees (Server-Enforced)**:
  - Different auto-assigned alias per club (`SilentFox_42`, `GhostByte_07`, `PixelPanda_19`, etc.) — editable anytime with profanity filtering.
  - Chat REST APIs and WebSocket payloads **never** include `user_id`, `phone`, `email`, `real_name`, or `sender_member_id` (enforced by `assertNoIdentityLeak()`).
  - Real members appear **only** in `GET /api/v1/clubs/:id/members` (Group Info) — without alias mapping.
- **Messaging, Polls, Camera Snaps & Disappearing Messages**:
  - Real-time Socket.IO chat (`/ws`), reply-quote, emoji reactions, read ticks, typing indicators (alias-only), delete-for-everyone (1-hour window).
  - **Anonymous Polls**: 2–6 options, single/multi-choice toggle, live `%` bars, voter identities never exposed.
  - **In-App Camera Only Rule**: Live camera snap capture modal (no gallery upload button), magic-byte image validation on backend.
  - **Disappearing Messages**: Off / 24h / 7 days (default) with background hard-delete cron job.
- **Group-Wise Anonymous Status (Updates Tab)**:
  - Club-scoped 24-hour text or camera statuses, alias circles, fullscreen viewer with progress bars, alias reply box, and poster-only view count (no viewer names).
- **Pre-Join Member Preview & Admin Moderation**:
  - Invite code preview shows real club members *before* joining.
  - Admin controls: Edit club info, change disappearing timer, make/remove admin, mute member (24h), remove member, reset invite code, share QR code.
  - Safety: Report messages/users/clubs (anonymous reporter) + Report History + platform-level Block/Unblock.
- **Full WhatsApp-Style Settings**:
  - Account, Privacy (with fixed Group Info trust rule, Blocked List & Report History), Chats (Theme, Wallpapers, Font size), Notifications, Storage & Data, App Language, Help (FAQ + Privacy Policy & Terms Drafts), Invite a Friend.
- **Calls Tab (MVP)**: Honest `"Calls jald aa rahe hain"` empty state (no dialer or fake call log).

## Quick Start (Local Development)

1. **Install dependencies** (already done if cloned/built here):
   ```bash
   npm run install:all
   ```

2. **Build the frontend** (so the single server at `http://localhost:4000` serves both API + Website):
   ```bash
   npm run build
   npm start
   ```
   Open **http://localhost:4000** in your browser!

   *(Optional dev mode with Vite HMR: run `npm run dev:backend` in terminal 1 and `npm run dev:frontend` in terminal 2, then open `http://localhost:5173`.)*

3. **Run the Critical Alias-Privacy & QA Test Suite**:
   ```bash
   npm run test:privacy
   ```

## Production Stack Reference
- `docker-compose.yml` provides PostgreSQL 16 + Redis 7.
- `backend/sql/schema.postgres.sql` contains the complete PostgreSQL DDL matching Section 5 of the documentation.
- Local runs use Node 24's built-in `node:sqlite` (`backend/data/bsdk-clubs.sqlite`) for zero-configuration setup.
