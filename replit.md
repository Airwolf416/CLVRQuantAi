# AlphaScan | Perp Intelligence

## Overview

AlphaScan is a perpetuals trading intelligence dashboard (branded "Perp Intelligence"). It's a full-stack web application built with React on the frontend and Express.js on the backend. The app integrates with the Anthropic Claude AI API to provide trading analysis and insights. The UI has a dark, monospace terminal aesthetic styled with IBM Plex Mono font, targeting a crypto/trading audience.

The project is currently in an early/scaffold state — the backend has a working AI analysis endpoint and a basic user storage layer, while the frontend has a full shadcn/ui component library set up and ready for feature development.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

- **Framework**: React 18 with TypeScript, using Vite as the build tool
- **Routing**: Wouter (lightweight client-side router)
- **State/Data Fetching**: TanStack Query (React Query v5) for server state management
- **UI Components**: shadcn/ui component library (New York style) built on top of Radix UI primitives
- **Styling**: Tailwind CSS with CSS custom properties for theming; dark theme only with a near-black background (`#04060d`), green primary accents, and IBM Plex Mono monospace font throughout
- **Forms**: React Hook Form with Zod validation via `@hookform/resolvers`
- **Charts**: Recharts (via the `chart.tsx` component wrapper)
- **Path aliases**: `@/` maps to `client/src/`, `@shared/` maps to `shared/`

### Backend Architecture

- **Runtime**: Node.js with TypeScript (run via `tsx` in dev, compiled with esbuild for production)
- **Framework**: Express.js v5
- **API Structure**: REST endpoints under `/api/`
  - `POST /api/ai/analyze` — proxies requests to Anthropic Claude API, accepts `system` and `userMessage` fields, returns AI-generated text
- **Storage**: Currently uses in-memory storage (`MemStorage` class in `server/storage.ts`). The `IStorage` interface is defined, making it easy to swap in a database-backed implementation
- **Development server**: Vite dev server runs as middleware inside the Express server, enabling HMR

### Data Layer

- **ORM**: Drizzle ORM configured for PostgreSQL (`drizzle.config.ts` points to `DATABASE_URL`)
- **Schema**: Defined in `shared/schema.ts` — currently only a `users` table with `id`, `username`, and `password` fields
- **Validation**: `drizzle-zod` generates Zod schemas from Drizzle table definitions
- **Migrations**: Output to `./migrations` directory, push via `npm run db:push`
- **Note**: The database schema and Drizzle are set up for PostgreSQL, but the active storage implementation is still in-memory. A PostgreSQL-backed storage implementation needs to be wired up.

### Build System

- **Client**: Vite builds the React app to `dist/public/`
- **Server**: esbuild bundles the Express server to `dist/index.cjs`
- **Key bundled server deps**: express, drizzle-orm, pg, passport, stripe, openai, ws, xlsx, nodemailer, and others listed in `script/build.ts` allowlist

### Authentication

- The schema has a `users` table and basic CRUD interface, but authentication is not yet implemented. The `package.json` includes `passport`, `passport-local`, `express-session`, and `connect-pg-simple` as dependencies, indicating session-based auth with Passport.js is planned.

## External Dependencies

### AI / LLM
- **Anthropic Claude** (`claude-sonnet-4-20250514` model) — used for trading analysis via `POST /api/ai/analyze`. Requires `ANTHROPIC_API_KEY` environment variable.

### Database
- **PostgreSQL** — target database via Drizzle ORM. Requires `DATABASE_URL` environment variable. Currently not actively used (in-memory storage is live).

### Key Frontend Libraries
- **Radix UI** — full suite of accessible headless UI primitives (accordion, dialog, dropdown, select, tabs, etc.)
- **TanStack Query v5** — server state, caching, and data fetching
- **Recharts** — charting library for trading data visualization
- **Embla Carousel** — carousel/slider component
- **date-fns** — date formatting and manipulation
- **Lucide React** — icon library
- **vaul** — drawer component
- **cmdk** — command palette component

### Key Backend Libraries (planned/available)
- **passport / passport-local** — authentication middleware
- **express-session + connect-pg-simple** — session management with PostgreSQL session store
- **jsonwebtoken** — JWT support
- **stripe** — payment processing
- **nodemailer** — email sending
- **ws** — WebSocket support
- **xlsx** — spreadsheet export
- **multer** — file uploads
- **nanoid / uuid** — ID generation

### Development / Replit
- **@replit/vite-plugin-runtime-error-modal** — shows runtime errors as overlay in dev
- **@replit/vite-plugin-cartographer** — Replit-specific dev tooling
- **@replit/vite-plugin-dev-banner** — Replit dev banner