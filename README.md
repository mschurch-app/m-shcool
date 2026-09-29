# M+ School 課輔行政系統

M+ School 是目前正式使用中的課輔行政系統。

## Production status
此 repository 的 main 分支視為目前正式環境基準。系統正在日常使用，因此後續採漸進式接管與重構，不進行一次性全面重寫。

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
