# MK Studio V2 — Phase 7

GitHub Pages-ready build.

This build is configured with the provided Supabase project URL and public publishable key.

Run `supabase-schema.sql` in the Supabase SQL Editor before using Cloud Sync or Recording Storage.

Recording files are uploaded to the private `mk-studio-recordings` bucket under `<user-id>/<recording-id>.webm`.

Settings includes Export Backup and Import Backup. Imports are merged by stable IDs rather than blindly replacing local data.
