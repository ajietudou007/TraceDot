#!/usr/bin/env bash
# 打包内置标贝语音服务（macOS）
# 产物：service/dist/tts_baker_service/tts_baker_service + _internal（含标贝模型）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

python -m pip install --upgrade pyinstaller sherpa-onnx

# 首次构建时从 ModelScope 拉模型（约 130 MB），已存在则跳过
python tts_baker.py --download-only

python -m PyInstaller --noconfirm --onedir --name tts_baker_service \
  --distpath "$ROOT/service/dist" \
  --workpath "$ROOT/service/build" \
  --specpath "$ROOT/service" \
  --collect-all sherpa_onnx \
  --add-data "$ROOT/tts_models/matcha-icefall-zh-baker:tts_models/matcha-icefall-zh-baker" \
  "$ROOT/tts_baker.py"

# Apple 芯片要求可执行文件带签名；无开发者证书时做 ad-hoc 签名
if [ "$(uname -m)" = "arm64" ]; then
  codesign --force --sign - "$ROOT/service/dist/tts_baker_service/tts_baker_service"
fi

echo "完成：$ROOT/service/dist/tts_baker_service"
