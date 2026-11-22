#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
迹点点 · 铁路广播操作台 —— 离线语音服务（sherpa-onnx）

内置两套离线音色：
      1) matcha-icefall-zh-baker     标贝女声，单说话人，22.05kHz
      2) kokoro-int8-multi-lang-v1_1 Kokoro 中文女声（多说话人），24kHz

特点：
      纯本地合成，不联网、不调用任何在线接口。
      网页端 http://127.0.0.1:5003 ，手机端用控制电脑局域网 IP + 5003。

启动： python tts_baker.py                     默认监听 0.0.0.0:5003
      python tts_baker.py --port 5003
      python tts_baker.py --download-only       只下载模型不启动

依赖： pip install sherpa-onnx
接口：
      GET /health                             {"ok":true,"voices":[...],"styles":[...]}
      GET /tts?text=...&voice=baker&speed=1.0&style=standard
                                              返回 audio/wav（16bit PCM 单声道）

首次启动会自动从 ModelScope 下载模型（标贝约 130 MB；Kokoro 约 205 MB，用 --download-kokoro 单独拉取）。
注意：标贝（Baker）训练集为非商用许可，商用场景需另行授权。
"""

import argparse
import json
import os
import shutil
import sys
import threading
import time
import urllib.parse
import urllib.request
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = (getattr(sys, "_MEIPASS", None) or os.path.dirname(os.path.abspath(__file__))) if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(__file__))
MODEL_NAME = "matcha-icefall-zh-baker"
MODEL_DIR = os.path.join(BASE_DIR, "tts_models", MODEL_NAME)
URL_TPL = ("https://modelscope.cn/api/v1/models/gomodels/sherpa/repo"
           "?Revision=master&FilePath=" + MODEL_NAME + "/{name}")

# 文件名 -> 预期字节数（0 表示不校验大小）
FILES = OrderedDict([
    ("model-steps-3.onnx", 75624611),
    ("vocos-22khz-univ.onnx", 53884024),
    ("lexicon.txt", 0),
    ("tokens.txt", 0),
    ("phone.fst", 0),
    ("date.fst", 0),
    ("number.fst", 0),
])
RULE_FSTS = "phone.fst,date.fst,number.fst"

# ---- Kokoro 多音色（中文女声，sid 见 k2-fsa 文档） ----
KOKORO_NAME = "kokoro-int8-multi-lang-v1_1"
KOKORO_DIR = os.path.join(BASE_DIR, "tts_models", KOKORO_NAME)
KOKORO_FSTS = "phone-zh.fst,date-zh.fst,number-zh.fst"

# 音色表：id -> (显示名, 引擎, sid)
# Kokoro v1.1-zh 共 103 个说话人，前 3 个是英文音色，sid 3 起为中文；
# 这里均匀取 8 条女声 + 2 条偏低沉的音色，命名保持中性，以试听结果为准。
VOICES = OrderedDict([
    ("baker", ("标贝女声 · 车站播报", "baker", 0)),
    ("k03", ("中文音色 1", "kokoro", 3)),
    ("k09", ("中文音色 2", "kokoro", 9)),
    ("k17", ("中文音色 3", "kokoro", 17)),
    ("k25", ("中文音色 4", "kokoro", 25)),
    ("k33", ("中文音色 5", "kokoro", 33)),
    ("k41", ("中文音色 6", "kokoro", 41)),
    ("k49", ("中文音色 7", "kokoro", 49)),
    ("k57", ("中文音色 8", "kokoro", 57)),
    ("k58", ("中文音色 9", "kokoro", 58)),
    ("k59", ("中文音色 10", "kokoro", 59)),
])

MAX_TEXT = 600
CACHE_SIZE = 40

# 车次字母 -> 铁路读法（kaldifst 只认 ASCII 路径且拉丁字母不在词表里，需先转中文）
TRAIN_LETTER = {
    "G": "高", "D": "动", "C": "城", "Z": "直", "T": "特",
    "K": "快", "S": "市", "Y": "旅", "L": "临", "X": "行",
}
DIGIT_CN = "零一二三四五六七八九"

# 播报风格（Baker 是单说话人模型，靠语速塑造听感差异）
STYLES = OrderedDict([
    ("standard", ("标准播报", 1.00)),
    ("steady", ("沉稳", 0.90)),
    ("bright", ("清亮", 1.10)),
    ("slow", ("慢速", 0.85)),
])

_tts = None
_tts_lock = threading.Lock()
_kokoro = None
_kokoro_lock = threading.Lock()
_kokoro_error = ""
_cache = OrderedDict()
_cache_lock = threading.Lock()
_state = {"status": "starting", "message": "初始化中", "ready_at": 0}


# ----------------------------------------------------------------------------
# 模型下载
# ----------------------------------------------------------------------------
def _size_ok(path, expect):
    if not os.path.exists(path):
        return False
    size = os.path.getsize(path)
    if size <= 0:
        return False
    if expect and size != expect:
        return False
    return True


def _download(name, expect, idx, total):
    url = URL_TPL.format(name=urllib.parse.quote(name))
    dst = os.path.join(MODEL_DIR, name)
    tmp = dst + ".part"
    req = urllib.request.Request(url, headers={"User-Agent": "jdd-tts/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        length = int(resp.headers.get("Content-Length") or 0)
        done = 0
        last = 0.0
        with open(tmp, "wb") as f:
            while True:
                chunk = resp.read(256 * 1024)
                if not chunk:
                    break
                f.write(chunk)
                done += len(chunk)
                now = time.time()
                if now - last > 0.6:
                    last = now
                    pct = ("%.0f%%" % (done * 100.0 / length)) if length else ("%d KB" % (done // 1024))
                    sys.stdout.write("\r[模型 %d/%d] %-22s %s" % (idx, total, name, pct))
                    sys.stdout.flush()
    sys.stdout.write("\r[模型 %d/%d] %-22s 完成 %s      \n"
                     % (idx, total, name, "%.1f MB" % (os.path.getsize(tmp) / 1048576.0)))
    if expect and os.path.getsize(tmp) != expect:
        raise RuntimeError("%s 大小不符（%d != %d），请删除后重试"
                           % (name, os.path.getsize(tmp), expect))
    os.replace(tmp, dst)


def ensure_models():
    os.makedirs(MODEL_DIR, exist_ok=True)
    missing = [(n, s) for n, s in FILES.items()
               if not _size_ok(os.path.join(MODEL_DIR, n), s)]
    if not missing:
        return
    print("[模型] 缺失 %d 个文件，开始从 ModelScope 下载到：%s" % (len(missing), MODEL_DIR))
    for i, (name, expect) in enumerate(missing, 1):
        for attempt in range(1, 4):
            try:
                _download(name, expect, i, len(missing))
                break
            except Exception as exc:  # noqa: BLE001
                part = os.path.join(MODEL_DIR, name + ".part")
                if os.path.exists(part):
                    try:
                        os.remove(part)
                    except OSError:
                        pass
                if attempt >= 3:
                    raise RuntimeError("下载 %s 失败：%s" % (name, exc)) from exc
                print("\n[模型] %s 第 %d 次失败：%s，重试…" % (name, attempt, exc))
                time.sleep(2)


# ----------------------------------------------------------------------------
# 合成引擎
# ----------------------------------------------------------------------------
def normalize_text(text):
    """把 G105 / D313 这类车次改写成中文读法，避免拉丁字母被词表丢弃。"""
    import re

    def repl(m):
        return TRAIN_LETTER[m.group(1)] + "".join(DIGIT_CN[int(c)] for c in m.group(2))

    return re.sub(r"([GDCZTKSYLX])(\d+)", repl, text)


def _short_ascii(path):
    """取 Windows 8.3 短路径（纯 ASCII）。用户名含中文时，靠它仍能留在用户目录内。"""
    try:
        import ctypes

        buf = ctypes.create_unicode_buffer(1024)
        n = ctypes.windll.kernel32.GetShortPathNameW(path, buf, 1024)
        if n and buf.value and buf.value.isascii():
            return buf.value
    except Exception:  # noqa: BLE001
        pass
    return None


def _writable_ascii_dir(d):
    """makedirs 成功不代表能写文件，这里真写一个探针文件再决定。"""
    os.makedirs(d, exist_ok=True)
    probe = os.path.join(d, ".jdd_probe")
    with open(probe, "wb") as f:
        f.write(b"1")
    os.remove(probe)


def _ascii_root(tag):
    """fst 只认纯 ASCII 路径，逐个尝试可写文件的 ASCII 目录（用户名含中文时也能用）。"""
    last_err = None
    local = os.environ.get("LOCALAPPDATA")
    bases = [local, _short_ascii(local) if local else None,
             os.environ.get("PUBLIC"),
             os.environ.get("ProgramData"),
             os.environ.get("SystemDrive", "C:") + os.sep]
    for base in bases:
        if not base:
            continue
        d = os.path.join(base, "jdd_tts_baker", tag)
        if not d.isascii():
            continue
        try:
            _writable_ascii_dir(d)
            return d
        except OSError as exc:
            last_err = exc
            continue
    raise RuntimeError("找不到可写的 ASCII 缓存目录，无法加载语音规则文件：%s" % last_err)


def _copy_ascii(model_dir, name, tag, is_dir=False):
    src = os.path.join(model_dir, name)
    dst = os.path.join(_ascii_root(tag), name)
    if is_dir:
        if not os.path.isdir(dst):
            tmp = dst + ".part"
            shutil.rmtree(tmp, ignore_errors=True)
            try:
                shutil.copytree(src, tmp)
                os.replace(tmp, dst)
            except OSError:
                shutil.rmtree(tmp, ignore_errors=True)
                raise
    elif (not os.path.exists(dst)) or os.path.getsize(dst) != os.path.getsize(src):
        shutil.copyfile(src, dst)
    return dst


def fst_dir_for_engine():
    """kaldifst 在 Windows 上用 ANSI 路径打开 fst，中文目录会失败，这里复制到 ASCII 目录；
    macOS / Linux 用 UTF-8 打开，直接用模型目录，不做拷贝。"""
    if sys.platform != "win32":
        return ",".join(os.path.join(MODEL_DIR, n) for n in RULE_FSTS.split(","))
    return ",".join(_copy_ascii(MODEL_DIR, n, "baker_fst") for n in RULE_FSTS.split(","))


def load_tts():
    """标贝女声（单说话人）。"""
    global _tts
    with _tts_lock:
        if _tts is not None:
            return _tts
        import sherpa_onnx
        p = lambda n: os.path.join(MODEL_DIR, n)
        cfg = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                matcha=sherpa_onnx.OfflineTtsMatchaModelConfig(
                    acoustic_model=p("model-steps-3.onnx"),
                    vocoder=p("vocos-22khz-univ.onnx"),
                    lexicon=p("lexicon.txt"),
                    tokens=p("tokens.txt"),
                ),
                num_threads=2,
                provider="cpu",
            ),
            rule_fsts=fst_dir_for_engine(),
            max_num_sentences=1,
            silence_scale=0.2,
        )
        _tts = sherpa_onnx.OfflineTts(cfg)
        return _tts


def kokoro_ready():
    files = ("model.int8.onnx", "voices.bin", "tokens.txt", "lexicon-zh.txt",
             "phone-zh.fst", "date-zh.fst", "number-zh.fst")
    return (all(os.path.exists(os.path.join(KOKORO_DIR, n)) for n in files)
            and os.path.isdir(os.path.join(KOKORO_DIR, "espeak-ng-data"))
            and os.path.isdir(os.path.join(KOKORO_DIR, "dict")))


def load_kokoro():
    """Kokoro 中文多音色（24kHz）。"""
    global _kokoro, _kokoro_error
    with _kokoro_lock:
        if _kokoro is not None:
            return _kokoro
        if not kokoro_ready():
            raise RuntimeError("Kokoro 模型未下载（运行 python tts_baker.py --download-kokoro）")
        import sherpa_onnx
        p = lambda n: os.path.join(KOKORO_DIR, n)
        if sys.platform == "win32":
            tag = "kokoro"
            data_dir = _copy_ascii(KOKORO_DIR, "espeak-ng-data", tag, is_dir=True)
            dict_dir = _copy_ascii(KOKORO_DIR, "dict", tag, is_dir=True)
            fsts = ",".join(_copy_ascii(KOKORO_DIR, n, tag + "_fst") for n in KOKORO_FSTS.split(","))
        else:
            data_dir = p("espeak-ng-data")
            dict_dir = p("dict")
            fsts = ",".join(p(n) for n in KOKORO_FSTS.split(","))
        try:
            cfg = sherpa_onnx.OfflineTtsConfig(
                model=sherpa_onnx.OfflineTtsModelConfig(
                    kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                        model=p("model.int8.onnx"),
                        voices=p("voices.bin"),
                        tokens=p("tokens.txt"),
                        lexicon=p("lexicon-zh.txt"),
                        data_dir=data_dir,
                        dict_dir=dict_dir,
                        length_scale=1.0,
                        lang="zh",
                    ),
                    num_threads=4,
                    provider="cpu",
                ),
                rule_fsts=fsts,
                max_num_sentences=1,
                silence_scale=0.2,
            )
            _kokoro = sherpa_onnx.OfflineTts(cfg)
        except Exception as exc:  # noqa: BLE001
            _kokoro_error = str(exc)
            raise
        return _kokoro


def synth_wav(text, speed, voice="baker"):
    import numpy as np
    import wave
    import io

    _, engine, sid = VOICES.get(voice) or VOICES["baker"]
    tts = load_kokoro() if engine == "kokoro" else load_tts()
    audio = tts.generate(normalize_text(text), sid=sid, speed=speed)
    samples = np.asarray(audio.samples, dtype="float32")
    if samples.size == 0:
        raise RuntimeError("合成结果为空")
    # 峰值归一化，避免过载同时让音量稳定
    peak = float(np.max(np.abs(samples)))
    if peak > 0.98:
        samples = samples * (0.98 / peak)
    pcm = np.clip(samples, -1.0, 1.0)
    pcm = (pcm * 32767.0).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(audio.sample_rate))
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def _warm_kokoro():
    try:
        t0 = time.time()
        load_kokoro()
        first = next((k for k, v in VOICES.items() if v[1] == "kokoro"), "baker")
        synth_wav("欢迎使用迹点点铁路广播", 1.0, first)
        print("[引擎] Kokoro 多音色就绪，用时 %.1fs" % (time.time() - t0))
    except Exception as exc:  # noqa: BLE001
        print("[引擎] Kokoro 加载失败：%s" % exc)


def warmup():
    _state["status"] = "loading"
    _state["message"] = "加载模型"
    try:
        ensure_models()
        t0 = time.time()
        load_tts()
        synth_wav("欢迎使用迹点点铁路广播", 1.0)
        _state["status"] = "ready"
        _state["message"] = "就绪"
        _state["ready_at"] = int(time.time())
        print("[引擎] 标贝女声就绪，用时 %.1fs，监听端口见下方提示" % (time.time() - t0))
    except Exception as exc:  # noqa: BLE001
        _state["status"] = "error"
        _state["message"] = str(exc)
        print("[引擎] 初始化失败：%s" % exc)
        import traceback
        traceback.print_exc()
    if kokoro_ready():
        threading.Thread(target=_warm_kokoro, daemon=True).start()


# ----------------------------------------------------------------------------
# HTTP
# ----------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # noqa: N802
        sys.stdout.write("[tts] " + (fmt % args) + "\n")

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self):  # noqa: N802
        self.do_GET(head_only=True)

    def do_GET(self, head_only=False):  # noqa: N802
        u = urllib.parse.urlparse(self.path)
        if u.path in ("/health", "/"):
            self._json({
                "ok": _state["status"] == "ready",
                "engine": "baker",
                "model": MODEL_NAME,
                "status": _state["status"],
                "message": _state["message"],
                "sample_rate": 22050,
                "voices": [{"id": k, "name": v[0], "engine": v[1]} for k, v in VOICES.items()],
                "kokoro": {"ready": kokoro_ready(), "loaded": _kokoro is not None, "error": _kokoro_error},
                "styles": [{"id": k, "name": v[0]} for k, v in STYLES.items()],
            })
            return
        if u.path != "/tts":
            self._json({"ok": False, "error": "not found"}, 404)
            return
        if _state["status"] != "ready":
            self._json({"ok": False, "error": "engine " + _state["status"] + ": " + _state["message"]}, 503)
            return

        q = urllib.parse.parse_qs(u.query)
        text = (q.get("text") or [""])[0].strip()
        voice = (q.get("voice") or ["baker"])[0]
        if voice not in VOICES:
            voice = "baker"
        style = (q.get("style") or ["standard"])[0]
        style = style if style in STYLES else "standard"
        try:
            speed = float((q.get("speed") or ["1.0"])[0])
        except ValueError:
            speed = 1.0
        speed = max(0.5, min(2.0, speed * STYLES[style][1]))

        if not text:
            self._json({"ok": False, "error": "text is required"}, 400)
            return
        if len(text) > MAX_TEXT:
            self._json({"ok": False, "error": "text too long"}, 400)
            return

        key = (text, speed, voice)
        with _cache_lock:
            hit = _cache.get(key)
            if hit is not None:
                _cache.move_to_end(key)
        if hit is None:
            try:
                hit = synth_wav(text, speed, voice)
            except Exception as exc:  # noqa: BLE001
                self._json({"ok": False, "error": "synthesis failed: " + str(exc)}, 500)
                return
            with _cache_lock:
                _cache[key] = hit
                while len(_cache) > CACHE_SIZE:
                    _cache.popitem(last=False)

        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(hit)))
        self._cors()
        self.end_headers()
        if not head_only:
            self.wfile.write(hit)


def lan_ip():
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("223.5.5.5", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:  # noqa: BLE001
        return "127.0.0.1"


def ensure_kokoro():
    """按需从 ModelScope 拉取 Kokoro 多音色模型（约 205MB / 377 个文件）。"""
    if kokoro_ready():
        return
    import concurrent.futures
    api = ("https://modelscope.cn/api/v1/models/gomodels/sherpa/repo"
           "?Revision=master&Recursive=true")
    req = urllib.request.Request(api, headers={"User-Agent": "jdd-tts/1.0"})
    data = json.loads(urllib.request.urlopen(req, timeout=120).read().decode("utf-8"))
    paths = [f["Path"] for f in data["Data"]["Files"] if f["Path"].startswith(KOKORO_NAME + "/")]
    paths = [p for p in paths if not any(q.startswith(p + "/") for q in paths)]
    base = ("https://modelscope.cn/api/v1/models/gomodels/sherpa/repo"
            "?Revision=master&FilePath=")
    os.makedirs(KOKORO_DIR, exist_ok=True)
    todo = []
    for p in paths:
        dst = os.path.join(BASE_DIR, "tts_models", *p.split("/"))
        if os.path.exists(dst) and os.path.getsize(dst) > 0:
            continue
        todo.append((p, dst))
    print("[模型] Kokoro 需下载 %d 个文件（约 205 MB）" % len(todo))

    def fetch(item):
        p, dst = item
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        tmp = dst + ".part"
        req2 = urllib.request.Request(base + urllib.parse.quote(p), headers={"User-Agent": "jdd-tts/1.0"})
        with urllib.request.urlopen(req2, timeout=180) as r, open(tmp, "wb") as f:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
        os.replace(tmp, dst)

    done = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        futs = [ex.submit(fetch, it) for it in todo]
        for i, fu in enumerate(concurrent.futures.as_completed(futs), 1):
            fu.result()
            done += 1
            if done % 20 == 0 or done == len(futs):
                sys.stdout.write("\r[模型] Kokoro %d/%d" % (done, len(futs)))
                sys.stdout.flush()
    print("\n[模型] Kokoro 下载完成")


def main():
    ap = argparse.ArgumentParser(description="迹点点 · 离线语音服务（标贝 + Kokoro）")
    ap.add_argument("--host", default="0.0.0.0", help="监听地址，默认 0.0.0.0（手机可访问）")
    ap.add_argument("--port", type=int, default=5003, help="监听端口，默认 5003")
    ap.add_argument("--download-only", action="store_true", help="只下载模型")
    ap.add_argument("--download-kokoro", action="store_true", help="下载/补齐 Kokoro 多音色模型")
    args = ap.parse_args()

    print("=" * 62)
    print(" 迹点点 · 铁路广播操作台 —— 离线语音服务（标贝 + Kokoro）")
    print(" 模型目录：%s" % os.path.join(BASE_DIR, "tts_models"))
    print("=" * 62)

    ensure_models()
    if args.download_kokoro:
        ensure_kokoro()
    if args.download_only:
        print("[模型] 已就绪，退出。")
        return

    threading.Thread(target=warmup, daemon=True).start()

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    ip = lan_ip()
    print("[服务] 电脑本机：http://127.0.0.1:%d/health" % args.port)
    print("[服务] 手机访问：http://%s:%d/health （需与电脑同一 Wi-Fi）" % (ip, args.port))
    print("[服务] 网页端/手机端把“本地语音服务地址”填上面地址即可。Ctrl+C 停止。")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[服务] 已停止。")
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
