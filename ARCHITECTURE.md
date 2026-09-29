# Architecture Baseline

## Current state
目前前端核心集中於 index.html：HTML、CSS、JavaScript、業務邏輯、Supabase data access 與部分權限判斷高度集中。

## Observed functional domains
1. Check-in — QR、人臉、出勤
2. Scheduling — 同工排班、工時
3. Roll Call — 學員出席、作業、聯絡簿
4. People — 學員與同工資料
5. Counseling/Care — 個別輔導與關懷
6. Parent Communication — 家長留言
7. Reporting — 報表與列印
8. Import/Admin — 舊資料匯入
9. Auth/Authorization — 現行同工登入與前端權限

## Target direction
逐步形成 App Shell + domain modules + data layer + authentication/RBAC。此為方向，不代表立即重寫。

## Migration principle
採 Strangler/Incremental approach。每次只抽離一個可驗證邊界，保持現有 UI/API/data behavior 相容。

## Immediate architectural risks
- 單一 index.html 變更衝突與回歸風險高
- Supabase queries 散落於 UI/business logic
- client-side session/authorization 不足以作為真正安全邊界
- 缺少 repository-level architecture/database documentation
- 尚未建立明確 automated regression safety net

任何修正必須先確保現行日常操作不中斷。
