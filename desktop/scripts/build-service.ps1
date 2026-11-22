# 打包内置标贝语音服务（Windows）
# 产物：service\dist\tts_baker_service\tts_baker_service.exe + _internal（含标贝模型）
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# CI 的 stdout 是管道，默认走 ANSI 代码页（cp1252），脚本里的中文进度会直接抛
# UnicodeEncodeError；显式让 Python 用 UTF-8。
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'

Push-Location $root
try {
  New-Item -ItemType Directory -Force (Join-Path $root 'service\dist'), (Join-Path $root 'service\build'), (Join-Path $root 'service') | Out-Null

  python -m pip install --upgrade pyinstaller sherpa-onnx
  if ($LASTEXITCODE -ne 0) { throw "安装 pyinstaller / sherpa-onnx 失败（exit $LASTEXITCODE）" }

  # 首次构建时从 ModelScope 拉模型（约 130 MB），已存在则跳过
  python tts_baker.py --download-only
  if ($LASTEXITCODE -ne 0) { throw "下载标贝模型失败（exit $LASTEXITCODE）" }

  $params = @(
    '--noconfirm', '--onedir', '--name', 'tts_baker_service',
    '--distpath', (Join-Path $root 'service\dist'),
    '--workpath', (Join-Path $root 'service\build'),
    '--specpath', (Join-Path $root 'service'),
    '--collect-all', 'sherpa_onnx',
    '--add-data', "$root\tts_models\matcha-icefall-zh-baker;tts_models/matcha-icefall-zh-baker",
    (Join-Path $root 'tts_baker.py')
  )
  python -m PyInstaller @params
  if ($LASTEXITCODE -ne 0) { throw "PyInstaller 打包失败（exit $LASTEXITCODE）" }

  Write-Host "完成：$root\service\dist\tts_baker_service"
} finally {
  Pop-Location
}
