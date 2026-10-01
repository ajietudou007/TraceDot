# CREDITS · 开源项目、数据源、云服务与开发工具

本项目在开发过程中使用、内嵌或参考的第三方项目与资源。所有内嵌组件的许可声明同时保留在应用源码内。

---

## 一、开源项目（内嵌 / 演化 / 参考）

| 项目 | 许可证 | 用途 |
|------|--------|------|
| [12306 火车票票根编辑器](https://github.com/ajietudou007/12306-train-ticket-editor) | MIT | **本项目前身**。迹点点的火车票工坊模块即由其 V6.2.x 内核演化而来（Canvas 绘制管线、六款底图、模块级细节精修、PDF 导入、OCR 等） |
| [pdf.js](https://github.com/mozilla/pdf.js) 相关组件 | Apache-2.0 | 内嵌于火车票工坊，解析 12306 官方「行程信息提示」PDF（Copyright 2023 Mozilla Foundation） |
| [LZ-String](https://github.com/pieroxy/lz-string) | MIT | 火车票工坊行程数据压缩进 URL，支持携带数据的分享链接与旧格式回退 |
| [html2canvas](https://html2canvas.hertzen.com) 1.4.1 | MIT | 登机牌 / 交通票 / 影演票工坊的票面导出管线（离屏克隆 + 固定 2x 高清）。V4.0.0 起作为跨模块共享资源去重内嵌（Copyright (c) 2022 Niklas von Hertzen） |
| [qrcode-generator](http://www.d-project.com/) | MIT | 登机牌及票面二维码生成（Copyright (c) 2009 Kazuhiko Arase / d-project.com；专利声明参考 denso-wave.com） |
| [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) PP-OCRv5 / PP-OCRv6 | Apache-2.0 | 火车票工坊本地 OCR 高精度 / 超精度引擎：浏览器端 ONNX Runtime Web 推理，模型自 paddle-model-ecology.bj.bcebos.com 按需懒加载并缓存于 IndexedDB |
| [Tesseract.js](https://github.com/naptha/tesseract.js) | Apache-2.0 | 火车票工坊本地 OCR 轻量引擎（回退档） |
| [ONNX Runtime Web](https://onnxruntime.ai/) | MIT | 本地 OCR 引擎的浏览器端推理运行时（随 PaddleOCR SDK 引入） |
| [bradtraversy/movieinfo](https://github.com/bradtraversy/movieinfo) | MIT | 电影海报 OMDb 检索实现参考（`?t=片名` 取 Poster，未命中退化 `?s=` 取 Search 首条） |
| Material Symbols（flight 等） | Apache-2.0 | 行程地图航班图标与登机牌预览同款 Material flight 轮廓 |
| ReactBits 风格动效 | 参考 | 外壳侧栏「磁吸聚光 · 扫光 · 流光边框 · 波纹涟漪」动效注入（jdd-fx，V3.0.2 侧栏重构） |
| Wave Grid / 06 SPATIAL CARD 设计稿 | 设计参考 | 珍藏册波浪网格 / 3D 视角展示模式的参考图（V3.3.0 ~ V3.3.2，经像素分析拟合视角方向） |

## 二、AI 与云服务（均需用户明确确认后才联网）

| 服务 | 用途 |
|------|------|
| [Agnes AI](https://api.agnes-ai.cn)（OpenAI 兼容接口） | **Agnes 3.0 Flash / 2.5 Flash**：视觉大模型 OCR——「看」票面照片逐行转录文字并匹配字段（火车票 / 登机牌工坊默认 AI 识别引擎，内置体验 Key）；另负责中文片名 → 英文片名转换（电影海报检索前置） |
| [OMDb API](https://www.omdbapi.com/) | 影演票工坊电影海报自动匹配（仅电影票保留自动匹配；图床 m.media-amazon.com 带 CORS 放行） |
| [OCR.space](https://ocr.space/) | 火车票工坊联网 OCR 备选引擎（免费云识别，Key 仅存本机） |
| [百度智能云 OCR](https://cloud.baidu.com/product/ocr) | 火车票工坊联网 OCR 备选引擎（文字识别标准版，免费 500 次/日，API Key / Secret Key 仅存本机，凭证缓存 30 天） |
| [维基百科 zh.wikipedia MediaWiki API](https://zh.wikipedia.org/) | 全国 4A / 5A 旅游景区数据源（`国家5A级旅游景区` / `国家4A级旅游景区` 条目解析，去重后 5463 条 gzip+base64 内联） |
| 12306 官网（www.12306.cn） | 行程 PDF 官方下载入口；车站 / 车次数据参考 |
| 豆瓣 / 携程（you.ctrip.com）/ 大麦（search.damai.cn）/ 必应图片（cn.bing.com） | 影演票工坊海报 / 景区图检索参考链路（提示与降级来源） |

## 三、内置数据集

| 数据 | 规模 | 说明 |
|------|------|------|
| 全球机场数据库（aptdata） | 462KB，IATA 码 + 坐标 | 登机牌工坊联想与行程地图航班弧线；数据日期 2026-09-27；内置优先、与全球库合并去重 |
| 全球航司数据库（airdata） | 459KB，IATA 二字码 | 登机牌工坊航司信息；数据日期 2026-09-28 |
| 全国行政区划与城市坐标库（DISTRICT_DATA） | 333 城市（自带「市」后缀键） | 行程地图城市级定位、影演票城市 / 区县联动 |
| 全国火车站名与坐标库 | 全国站点 | 火车票智能联想（拼音反查 + 编辑距离 ≤2 模糊兜底）与行程地图铁路弧线 |
| 全国地铁线路站点数据（metro-data） | 多城市线路 | 地铁票面与行程地图（IndexedDB `jdd-metro` 坐标缓存） |
| 国家 5A / 4A 旅游景区数据（SCENIC_DATA） | 5463 条（5A 374 + 4A 5089） | 影演票景区模糊联想搜索（gzip+base64 内联 87KB） |
| 影城 / 景区 / 演出场馆 POI 坐标库（VENUE_POS） | V4.0.2 新增 | 票种地点优先使用实际 POI 坐标，避免商圈名称误匹配 |
| 六款 12306 票面底图 | 约 0.5MB（压缩自 4.3MB） | 蓝票 / 蓝纸票 / 蓝磁票 / 红票 / 红纸票 / 红磁票，Base64 内嵌离线可用 |

## 四、开发平台与工具

| 工具 | 用途 |
|------|------|
| **Trae（AI IDE）** | 人机结对开发平台——需求澄清、代码实现、Playwright 自动化验证全流程 |
| **Playwright（Chromium headless）** | 功能回归自动化测试：无截图断言（expect_download 捕获导出、frame.evaluate、console / pageerror 监听）、行 / 列像素差异剖面分析（定位半像素漏色等渲染问题）、参考图像素分析 |
| **Python 3（标准库）** | 版本快照打包脚本（repack：占位符替换 + gzip + base64 内联与计数断言）、维基百科景区数据抓取清洗、版本间 HTML / payload 差异比对 |
| **git + GitHub** | 版本管理与开源发布；前身项目经 GitHub Pages 发布（ajietudou007.github.io） |
| **GitHub Pages** | 前身项目在线使用入口托管 |
| **python3 -m http.server / npm start** | 本地开发与验证服务器 |
| **Clash Verge（系统代理 127.0.0.1:7897）** | 开发期网络代理（Wikipedia / OMDb / 图床等外网资源抓取；网络可达性判断必须用 Playwright 实测，不能用 curl 下结论） |
| **macOS** | 主开发环境 |
| 目标浏览器 | Chrome / Edge（Chromium）、Safari、Firefox 最新版；夸克 / UC 等移动内核（触控与下载兼容） |

## 五、设计语言

- **铁路信号台**（前身项目 V4.9.2 引入）：火车票工坊整体设计语言，全套自绘图标，明暗双主题
- **冷调时刻表 / Aurora 极光光场**（V2.7.0）：全站统一光场背景，仅 transform 动画、独立合成层
- **青瓷绿主题**（V3.0.4）：全局唯一主题色，移除其他配色与切换功能
- **五步分区标题**（V2.4.5）：绿皮车 × 现代时刻表（等宽编号 + 点线 + 英文小标）
- **统一 UI（album-unified-ui）**：珍藏册与各工坊控制台 / 预览模块的共享样式层（V4.0.0 起跨模块去重）
