# TECH_STACK.md — EduVerse stack vs the proposed stack (2026-11-10)

Audited against the proposed stack in emi's advanced-features spec. Most of it matches;
the differences below are deliberate and documented — no rebuild was done for them.

## Matches
| Proposed | Actual | Notes |
|---|---|---|
| Node.js backend | Node.js 18+ (`backend/server.js`, plain `http`) | Zero-framework API, `ws` for real-time |
| REST APIs, business logic, auth | Yes | Session cookies + JWT (Bearer), role gates |
| File storage (S3) | S3-compatible (`backend/storage.js`) | Local disk default; S3 via `S3_*` env |
| Real-time communication | `ws` (WebSocket) | Live classroom signaling + chat |
| AI services | Nova (`backend/nova.js`) | OpenAI via env, automatic local fallback per tool |

## Deliberate differences (not rebuilt)
| Proposed | Actual | Why |
|---|---|---|
| **React + Vite frontend** | Plain HTML/CSS/JS, no build step | The whole app (60+ screens) is plain JS; a React rewrite is a full rebuild for no user-facing gain. New screens keep the same stack. |
| **Three.js 3D** | 3D Campus is CSS-3D based; Three.js is used in HORLOGE, not EduVerse | The "3D" in EduVerse 3D is the campus + vision lab, built with CSS 3D transforms + webcam. A Three.js campus rewrite is a separate project, not a feature add. |
| **Express.js** | Plain `node:http` server | Zero-dependency API by design (only `ws` in prod deps). Express would add a dep for no new capability. |
| **MongoDB** | Local JSON store (`backend/data/store.json`), Postgres schema as migration target (`migrations/001_initial.sql`) | The JSON store + PG migration path already exists and is tested. A MongoDB migration (Mongoose models, connection, migration of every store read/write) is a platform rebuild, not a feature. Collections map 1:1 — see `BACKEND_STRUCTURE.md`. |
| **Cloudinary** | Not used | S3-compatible storage covers uploads; Cloudinary would be a second storage backend for the same files. |
| **Socket.IO** | `ws` | Live classroom signaling + chat already run on `ws`. Socket.IO adds a protocol + client lib for the same messages. |
| **Python + FastAPI AI services** | Nova is Node + OpenAI | AI tools run in-process with a local fallback; a separate Python service adds a deployable + latency for the same 14 tools. |

## If emi wants a migration later
- MongoDB: write Mongoose models from `BACKEND_STRUCTURE.md`, swap the store layer
  (`initStoreCollections`/`persist` in `server.js`), migrate `store.json` once.
- React: rebuild screens one by one against the same REST API (the API is framework-free,
  so the frontend can be replaced without touching the backend).
- Neither is needed for any feature in the advanced-features list.
