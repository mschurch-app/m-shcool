# M+ School 課輔行政系統

M+ School 是目前正式使用中的課輔行政系統。

## Production status
此 repository 的 main 分支視為目前正式環境基準。系統正在日常使用，因此後續採漸進式接管與重構，不進行一次性全面重寫。

## 2026-10-09：課輔登入與權限第一階段

目前使用教會共用專案 `aqanuwilmvdtlzuqlrau` 的 `mschool` schema。人員資料由 `mschool-api` 驗證後存取，瀏覽器不持有伺服器金鑰。

- 同工由教會 OS 使用 LINE 或 Email 登入，選擇課輔進入。學生打卡不需登入。
- 課輔登入角色獨立存於 `mschool.staff_access`，依已審核的教會帳號 ID 對應；執行時不以姓名或編號推算權限。
- 一般人員表單不能調整既有登入角色。管理同工編輯其他教職資料時，可另開「設定同工登入權限」。新同工須先在教會 OS 授權課輔入口。
- 登出會撤銷伺服器工作階段；停權、離職及權限異動會使既有登入失效。更新前的課輔工作階段需要重新登入。
- 第一階段資料庫變更為新增授權表、工作階段欄位與受限伺服器函式；沒有刪除學生、出席、排班、輔導或照片資料。

詳細部署與復原順序見 [AUTH_PHASE1.md](AUTH_PHASE1.md)。以下較早的盤點是歷史紀錄，遇到不同敘述以上方及目前程式為準。

## 現有主要功能
- 學員／人員名冊
- 課堂點名、作業與聯絡簿紀錄
- QR／人臉打卡
- 同工與排班
- 個別輔導／家庭關懷
- 家長留言
- 報表與列印
- 舊資料匯入
- Supabase 資料存取

## 接管策略
1. 保持 production 穩定
2. 建立現況文件
3. 盤點 Supabase schema / RLS / 權限
4. 補上測試與 rollback
5. 逐模組整理
6. 驗證後才合併 main

詳細規則請先閱讀 AGENTS.md。

## Codex takeover references
- `PHASE1_AUDIT.md` — production/source audit and Phase 1 checklist
- `DATABASE.md` — Supabase schema, grants, RLS, Storage, and write paths
- `TESTING.md` — offline tests and safe synthetic test plan
- `ACCESS_RECOVERY.md` — observed access gates, backup snapshot, and recovery decisions
