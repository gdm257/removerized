"""Probe candidate HF mirrors for the rembg model port (v2).

Fixes from v1: auto-discover the single .onnx file per repo instead of
guessing filenames; fixed-size dummy input derived from declared shape
(bria fp16 declares dynamic H/W — use 1024 explicitly).
"""

import json
import os
import sys
import urllib.request

os.environ.setdefault("HTTPS_PROXY", "http://127.0.0.1:7890")

CANDIDATES = [
    # key, repo, required
    ("u2netp", "mixdon/u2netp", True),
    ("u2netp_alt", "Remeich/u2netp", True),
    ("u2net_human_seg", "jellybox/u2net-human-seg", True),
    ("u2net_cloth_seg", "jellybox/u2net-cloth-seg", True),
    ("silueta", "jellybox/silueta", True),
    ("isnet_anime", "jellybox/isnet-anime", True),
    ("bria_rmbg_2_0", "kn4666/bria-rmbg-2.0-web", True),
    ("birefnet_general", "yiwangsimple/BiRefNet-general-epoch_244", True),
    ("birefnet_massive", "not-lain/BiRefNet-massive", True),
    ("birefnet_general_alt", "zachyuan/BiRefNet-general-epoch_244", False),
]

CACHE = os.path.join(os.path.dirname(__file__), "probe-cache")
os.makedirs(CACHE, exist_ok=True)


def list_files(repo):
    url = f"https://huggingface.co/api/models/{repo}"
    with urllib.request.urlopen(url, timeout=30) as r:
        data = json.load(r)
    return [s["rfilename"] for s in data.get("siblings", [])]


def download(repo, fname):
    dest = os.path.join(CACHE, f"{repo.replace('/', '__')}__{os.path.basename(fname)}")
    if os.path.exists(dest):
        return dest
    url = f"https://huggingface.co/{repo}/resolve/main/{fname}"
    with urllib.request.urlopen(url, timeout=120) as r, open(dest + ".part", "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    os.rename(dest + ".part", dest)
    return dest


def probe(key, repo, required):
    print(f"== {key} :: {repo}")
    try:
        files = [f for f in list_files(repo) if f.endswith(".onnx")]
        print(f"   onnx files: {files}")
        if not files:
            print("   NO ONNX IN REPO")
            return not required
        # Prefer fp32 model.onnx over quantized variants when both exist.
        fname = sorted(files, key=lambda f: (not f.endswith("model.onnx"), len(f)))[0]

        path = download(repo, fname)
        print(f"   file: {fname} ({os.path.getsize(path):,} bytes)")

        import onnxruntime as ort

        sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        inp = sess.get_inputs()[0]
        out = sess.get_outputs()[0]
        print(f"   input : {inp.name} {inp.type} {inp.shape}")
        print(f"   output: {out.name} {out.type} {out.shape}")
        print(f"   n_outputs: {len(sess.get_outputs())}")

        import numpy as np

        size = next((d for d in inp.shape[2:] if isinstance(d, int)), 1024)
        dummy = np.zeros((1, 3, size, size), dtype=np.float32) + 0.5
        outs = sess.run(None, {inp.name: dummy})
        o = outs[0]
        print(f"   run ok @ {size}: shape={o.shape} min={o.min():.4f} max={o.max():.4f}")
        return True
    except Exception as e:
        print(f"   PROBE FAILED: {type(e).__name__}: {str(e)[:300]}")
        return not required


def main():
    ok = True
    for key, repo, required in CANDIDATES:
        if not probe(key, repo, required):
            ok = False
    print("RESULT:", "OK" if ok else "GAPS FOUND")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
