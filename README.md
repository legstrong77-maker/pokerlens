# PokerLens 牌眼

德州撲克 AI 決策助手：用 iPhone 掃描手牌與公牌，第一視角計算勝率、底池賠率與 EV，並建議 **棄牌 / 過牌 / 跟注 / 下注尺寸**，同時說明原因。

A mobile-first Texas Hold'em decision assistant (PWA): scan your hole cards and the board with the phone camera, get equity, pot odds, EV and a recommended action with sizing — with reasons.

**線上使用：** https://legstrong77-maker.github.io/pokerlens/

## 功能

- **牌桌分析（第一視角）**：手牌在下、公牌在中間，點格子選牌或用相機掃描；翻前 → 翻牌 → 轉牌 → 河牌依序推進，底池與對手範圍自動延續。
- **AI 建議卡**：動作（中英文）、尺寸、混合頻率、勝率環（標出跟注所需勝率）、底池賠率、SPR、各行動 EV，以及「為什麼這樣打」。
- **策略引擎**
  - 翻前：2–9 人桌開池範圍、面對開池（3-bet/跟注）、面對 3-bet / 4-bet、跛入孤立、短碼推擠/棄牌（內建 Nash 求解器）。
  - 翻後：依翻前情況建立對手範圍，再依每條街的動作（下注 / 過牌 / 跟注 / 加注）做貝氏收斂；比較棄牌、過牌、跟注、各尺寸下注/加注的 EV（含棄牌率、被跟注勝率、勝率實現、隱含賠率）。
  - 對手類型：常規 / 緊弱 / 緊兇 / 鬆兇 / 跟注站 / 瘋子，自動調整範圍與剝削策略。
- **掃描**：即時相機（裝置端 YOLO 模型，離線）、拍照、上傳照片或影片；自動分出手牌與公牌，可點選修正。另有「AI 精準辨識」（Claude 視覺，可讀出底池與下注）。
- **範圍表**：13×13 圖表，混合頻率以分色顯示。
- **工具**：多人勝率計算器（手牌或範圍）、Outs 機率表、底池賠率 / MDF、手牌紀錄。

## 安裝到 iPhone

1. 用 Safari 開啟上方網址
2. 點「分享」→「加入主畫面」
3. 從主畫面開啟：全螢幕、可離線、相機權限會被記住

## 準確度

- 7 張牌評估器與 20 萬手隨機牌的暴力解比對一致；翻牌後單挑勝率為精確列舉。
- 推擠/棄牌求解結果與公開 Nash 表一致（10 BB：小盲全下 59%、大盲跟注 37%）。
- 裝置端辨識（高精度模型）在 61 張真實照片上：精確率 98.8%、召回率 91.7%。

## 開發

```bash
npm test                 # 引擎單元測試、策略回歸與隨機合理性檢查
node tools/build.js      # 產生 service worker 快取清單與 claude.ai 版本 (dist/artifact)
node tools/serve.js 8080 # 本機預覽 http://localhost:8080
node tools/precompute.js # 重新計算翻前 169×169 勝率表
```

## 致謝與授權

- 裝置端辨識模型：[sroot/lgd-cards-gen3](https://huggingface.co/sroot/lgd-cards-gen3)（YOLO11s）、[Gholamrezadar/yolo11-poker-hand-detection-and-analysis](https://github.com/Gholamrezadar/yolo11-poker-hand-detection-and-analysis)（YOLO11n）；皆衍生自 Ultralytics YOLO（AGPL-3.0）。
- 推論：[onnxruntime-web](https://github.com/microsoft/onnxruntime)（MIT）。
- AI 辨識：[Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript)。
- 因包含 AGPL-3.0 模型權重，本專案以 **AGPL-3.0** 授權釋出（見 `LICENSE`）。

## 公平競技

多數娛樂場與線上撲克平台禁止在牌局進行中使用即時輔助工具（RTA）。請用於練習、復盤、學習，或經所有玩家同意的私人牌局。建議僅供參考，不保證獲利。
