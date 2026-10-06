<div align="center">

# 🧳 迹点点 · 行程地图 V4.1.2

*纯前端 · 单文件 · 零框架 · 数据不出浏览器*

![Version](https://img.shields.io/badge/version-4.1.2-2E7CF6)
![License](https://img.shields.io/badge/license-MIT-green)
![Dependencies](https://img.shields.io/badge/runtime_dependencies-0-success)
![Runtime](https://img.shields.io/badge/runtime-浏览器%20%2B%20Canvas%20%2B%20SVG-9B59B6)
![Modules](https://img.shields.io/badge/模块-6-orange)

一款集成式「旅行纪念票根工作室」：把火车票、登机牌、公交、地铁、出租车、长途客运、电影票、景区门票、演唱会票  
九种票面在一处制作、收藏、绘制成地图——六大模块在一个单文件 HTML 里协同工作，离线即开即用。

**前身项目**：[12306 火车票票根编辑器](https://github.com/ajietudou007/12306-train-ticket-editor)（MIT）——
迹点点的火车票工坊即由它演化而来，并在此基础上扩展出登机牌、交通票、影演票三大工坊、行程地图、珍藏册与我的旅游计划。

</div>

> **⚠️ 免责声明**
> 本项目仅供**个人纪念与娱乐创作**使用（如收藏票根、短视频道具、手账素材、同人创作等）。
> 与中国国家铁路集团（12306）、各航空公司、文旅机构均无任何隶属或合作关系。
> 严禁将生成的票面用于报销、退票、逃票、诈骗或其他任何违法违规用途，由此产生的一切后果由使用者自行承担。

---

## 🧭 七大模块

| # | 模块 | 说明 |
|---|------|------|
| 01 | **行程地图** | 收藏的每张票自动绘制到自绘中国底图上：铁路实线弧、航班虚线航路 + 飞机标记、到访城市点亮、榜单统计（距离 / 时长 / 费用）；添加行程支持即时预览真实票面 |
| 02 | **我的旅游计划** | 对话式 AI 行程规划：七步实时进度 + 思考面板，查询真实景点 / 酒店 / 美食 / 天气，按天生成时间轴、行李清单，支持多轮追问调整 |
| 03 | **火车票工坊** | 12306 风格票根编辑器（源自前身项目）：六款底图、正反面制作、18 模块级细节精修、行程 PDF 智能导入、纸质票拍照 OCR |
| 04 | **登机牌工坊** | 航班登机牌制作：全球机场 / 航司数据库联想、扫描件 AI 识别回填、登机牌导出 |
| 05 | **交通票工坊** | 公交、地铁、出租车发票、长途客运四种票面差异化版式，固定像素还原票样 |
| 06 | **影演票工坊** | 电影票、景区门票、演唱会票：票面配色自定义、海报 / 景区图自动匹配与自定义取景、全国 4A/5A 景区联想搜索 |
| 07 | **珍藏册** | 行程时间轴：所有票面按出行时间串成旅行编年史，支持票种 / 城市筛选，一键清除 / 导入 / 导出 |

## ✨ 功能亮点

- **九种票面一站式制作**：所有票面以真实票样为参照设计，支持明暗双主题、移动端自适应
- **行程地图自动绘制**：任何工坊「存入珍藏册」后同步写入行程地图；站名 / 机场 / 城市 / 景区多级地点解析，解析失败自动回退城市级单点标记
- **我的旅游计划（V4.1.1）**：对话式 AI 行程规划——高德 JS API v2.0 实时查询地理编码 / POI / 天气（Key 用户自配、附五步申请教程），Agnes 生成按天行程卡与行李清单（AI 大语言模型接口内置、全量可用），未配置 Key 自动引导、接口不可用自动降级 AI 推荐
- **手机端「添加票面 / 我的」页（V4.1.2）**：底栏精简为 5 个标签（行程地图 / 我的旅游计划 / 添加票面 / 珍藏册 / 我的），四个票务工坊统一从「添加票面」进入；「我的」页含用户信息与改名、数据管理（导出 / 导入 / 云端更新 / 清除行程数据）、软件更新与联系方式、关于与隐私声明
- **AI 能力开箱即用**：视觉大模型（Agnes 3.0 Flash，内置体验 Key）转录票面文字并匹配字段；电影海报自动匹配（OMDb）
- **本地 OCR 多引擎**：PP-OCRv6 / v5（浏览器端 ONNX 推理）、Tesseract.js 轻量引擎、OCR.space 与百度 OCR 联网备选引擎——联网引擎仅在用户明确确认后上传
- **行程时间轴**：珍藏册把每张票按出行时间串成编年史视图；9 票种示例票面一键导入；票种 / 城市筛选
- **数据本地双保险**：localStorage 同步总线 + IndexedDB 镜像，断网可用；「清除所有数据」需二次确认且仅清除用户内容（密钥、主题等设置保留）
- **单文件零构建**：全部样式 / 脚本 / 票面底图 / 数据库以 Base64 / gzip 内嵌，双击即用；V4.0.0 起共享资源（html2canvas、机场库等）跨模块去重存储

## 🚀 快速开始

> **在线访问**：官网 <https://jidiandian.top>（Cloudflare 托管）· 备用线路：<https://ajietudou007.github.io/TraceDot/>，
> 直接使用应用：<https://jidiandian.top/release/TraceDot-V4.1.2.html>

本项目是**零构建、零运行时依赖的单文件应用**，无需安装任何包。

### 方式一：直接打开

下载 `release/TraceDot-V4.1.2.html` 后用现代浏览器双击打开即可使用。

### 方式二：本地服务（推荐）

```bash
python3 -m http.server 8080
# 打开 http://127.0.0.1:8080
```

### 方式三：GitHub Pages

将 `release/` 中的 HTML 重命名为 `index.html` 推送到仓库根目录，
在 **Settings → Pages** 中选择分支根目录后即可在线访问。

> 💡 建议在链接后附加版本参数（如 `?v=4.1.2`）以绕过 CDN / 浏览器缓存。

## 📁 项目结构

```text
迹点点v4/
├── README.md                    # 本文件
├── CHANGELOG.md                 # 全量版本日志（前身项目 V4.0 → 迹点点 V4.1.2）
├── CREDITS.md                   # 开源项目 / 数据源 / 云服务 / 开发平台与工具
├── LICENSE                      # MIT（含第三方组件许可声明）
├── docs/
│   └── FEATURES.md              # 六大模块功能详表
├── website/
│   └── index.html               # 官方网站（苹果风格，纯静态单文件）
└── release/
    ├── TraceDot-V4.1.2.html       # 应用本体（单文件，含全部样式 / 脚本 / 内嵌资源）
    ├── TraceDot-V4.1.1.html       # 上一版本快照
    ├── TraceDot-V4.0.20.html       # 历史版本快照
    └── TraceDot-V4.0.19.html       # 历史版本快照
```

## 🛠 技术实现

- **技术栈**：原生 HTML / CSS / JavaScript，无框架、无构建步骤、无运行时依赖
- **单文件多模块架构**：外壳（Shell）+ 六个功能模块。各模块 HTML 以 Base64 形式内嵌为 `<script type="text/plain" id="payload-*">`，运行时经 `jddModuleHtml()` 解码并注入隐藏 iframe；模块间通过 `postMessage` 总线通信（独立消息标记 `__ticket` / `__plane` / `__transit` / `__venue` / `__collection` / `__ledger`）
- **共享资源去重（V4.0.0）**：跨模块重复的内联资源（html2canvas、全球机场库 / 航司库、统一 UI 样式、动效脚本）抽取为 `shared-*` 块，模块内以 `<!--jdd-shared:N-->` 占位，注入 iframe 前还原——多模块复用一份存储
- **导出管线**：登机牌 / 交通票 / 影演票使用内嵌 html2canvas 1.4.1（离屏克隆 + 固定 2x 高清）；火车票走 Canvas 原生绘制直出
- **地图绘制**：自绘 SVG 中国底图（无第三方地图库），贝塞尔弧线 + 图层控件 + 榜单悬浮卡；地点解析四级兜底（站名库 → 机场库 → 城市坐标库 → 模糊匹配）
- **数据压缩**：大数据集（机场库 / 航司库 / 景区库等）gzip + Base64 内联，运行时 `DecompressionStream('gzip')` 解压

## 🔒 隐私说明

- 所有表单数据、票面数据、导出图片默认**只保存在本机浏览器**（localStorage + IndexedDB），无任何统计、追踪或后端服务器
- 仅两类操作会经用户**明确确认后**联网：
  1. 识别引擎选择「联网引擎」（Agnes / OCR.space / 百度）时上传票面照片用于 OCR；
  2. 影演票工坊点击「自动匹配」时向 OMDb 查询电影海报。
- 珍藏册数据支持 JSON 导入 / 导出，可自由备份迁移

## 🌐 浏览器兼容

| 浏览器 | 支持情况 |
|--------|----------|
| Chrome / Edge（Chromium） | ✅ 推荐使用最新版 |
| Safari | ✅ 最新版 |
| Firefox | ✅ 最新版 |
| 夸克 / UC 等移动内核 | ✅ 已做触控与下载兼容 |

需要支持 Canvas 2D、`FileReader` / `DataTransfer`、`DecompressionStream` 的现代浏览器。

## 📋 版本日志

完整修改记录见 [CHANGELOG.md](CHANGELOG.md)——涵盖前身项目「12306 火车票票根编辑器」V4.0 → V6.2.4 全部 26 个版本，以及迹点点 V2.x 内部迭代、V3.0.0 → V4.1.2 全部公开版本。

## 🤝 参与贡献

欢迎 Issue 与 PR！

1. Fork 本仓库并新建分支（`git checkout -b feature/your-feature`）
2. 修改 `release/` 中的单文件应用（保持单文件架构，勿引入构建步骤或外部运行时依赖）
3. 提交变更（`git commit -m "feat: xxx"`）并发起 Pull Request
4. 提交前请自测：明暗双主题、七大模块互转、票面导出与珍藏册同步均应正常

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源；前身项目「12306 火车票票根编辑器」同为 MIT。
第三方内嵌组件的许可声明见 [LICENSE](LICENSE) 附录与 [CREDITS.md](CREDITS.md)。

## 🙏 致谢

- [12306 火车票票根编辑器](https://github.com/ajietudou007/12306-train-ticket-editor) —— 迹点点的前身与火车票工坊内核
- [pdf.js](https://github.com/mozilla/pdf.js) · [html2canvas](https://html2canvas.hertzen.com) · [qrcode-generator](http://www.d-project.com/) · [LZ-String](https://github.com/pieroxy/lz-string) · [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) · [Tesseract.js](https://github.com/naptha/tesseract.js)

完整名单见 [CREDITS.md](CREDITS.md)。
