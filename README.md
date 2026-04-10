# KF3 Grain Ticket Manager & Inventory

Web app for managing grain delivery tickets, contract tracking, and hauling logistics.

**Live:** https://kf3tickets.netlify.app

## Stack

- **Frontend:** React 18 + TypeScript + Tailwind CSS + Vite
- **Backend:** Supabase (PostgreSQL)
- **Hosting:** Netlify (auto-deploys from `main`)
- **Image Storage:** Cloudflare R2
- **AI:** OpenAI GPT-4o Vision for ticket photo parsing

## Features

- **Upload:** Photo upload with AI auto-fill (GPT-4o Vision extracts ticket data)
- **Review Queue:** Editable fields, approve with contract split confirmation, spot sale
- **Tickets:** Sortable/searchable table, multi-select bulk actions, batch entry, rematch, inline splits display, edit splits
- **Contracts:** CRUD, bulk edit, Excel import, contract detail modal with ticket management
- **Haul Board:** Real-time contract fill status with live updates
- **Exports:** Hauling Log (one row per split), Contract sync, Standard tickets — designed for Excel integration
- **Inventory & Origins:** Tracking pages

## Architecture

- **Web app** = intake/routing layer for the trucking team
- **Excel workbook** = accounting/reconciliation layer (data flows web -> Excel)
- **ticket_splits** table is only used when a ticket is genuinely split across multiple contracts. Single-contract tickets (100% allocation) use `ticket.contract_id` directly — no split record needed.
- Both Tickets and Contracts pages calculate delivered bushels from splits + unsplit tickets with fallback logic

## Development

```bash
npm install
npm run dev
```

Pushes to `main` auto-deploy via Netlify.
