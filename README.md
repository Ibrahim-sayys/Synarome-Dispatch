# Synarome-Dispatch
Synarome Dispatch is a web-based bilty and WhatsApp dispatch management system built to streamline contact management, file sharing, and dispatch tracking for Synarome. It provides role-based access, marketing personnel management, multi-recipient WhatsApp sending, and centralized dispatch history.

## WhatsApp development setup

The dispatch module is wired for Meta WhatsApp Cloud API development/test numbers. Create a Meta developer app with WhatsApp enabled, add your test recipient numbers in the Meta dashboard, then set these environment variables:

- `WHATSAPP_API_URL=https://graph.facebook.com/v26.0`
- `WHATSAPP_API_TOKEN=<temporary-or-system-user-token>`
- `WHATSAPP_PHONE_NUMBER_ID=<test-phone-number-id>`
- `WHATSAPP_DRY_RUN=false`

Use `WHATSAPP_DRY_RUN=true` only when you want local dispatch records without calling WhatsApp.
