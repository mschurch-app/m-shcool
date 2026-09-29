# Database Baseline — Supabase

## Status
Production Supabase 已被現行系統使用。本文件目前只是接管基準，不授權任何 schema 變更。

## Tables observed from application code
已確認程式直接使用的資料表至少包含：
- users
- schedules

其他資料表需由下一階段 code inventory / Supabase schema inventory 確認後補入，禁止猜測。

## Safety policy
在完整 schema、foreign keys、indexes、RLS policies、triggers、functions 與資料量盤點完成以前：
- 不刪 table
- 不刪/改 column
- 不修改 production RLS
- 不大量 update/delete production data
- 不以新 schema 強制取代舊 schema

## Required inventory
Codex 接管下一階段必須建立：
1. table / column inventory
2. app function -> table mapping
3. RLS policy inventory
4. sensitive personal data classification
5. backup/recovery procedure
6. migration + rollback procedure

## Authentication note
目前程式碼存在 client-side user lookup/session behavior。真正的 authentication 與 RBAC 必須另外設計並漸進導入，不得直接造成現場同工無法登入。
