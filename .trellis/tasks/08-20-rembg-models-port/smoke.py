"""E2E smoke: run each new model family through the real browser pipeline.

Steps per model: open /removerized?model=<key>, upload synthetic image, wait
for the "Remove Background" button to enable, click it, wait for the "Batch
done" toast (printing progress dots), download the result and assert the
alpha channel has both transparent and opaque pixels.
Usage: python smoke.py <model-key> [<model-key> ...]
"""

import io
import sys
import time
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
IMG = ROOT / ".smoke-test.png"
BASE = "http://localhost:3000"


def verify_alpha(blob: bytes) -> tuple[bool, str]:
    img = Image.open(io.BytesIO(blob))
    if img.mode != "RGBA":
        return False, f"mode={img.mode} (no alpha)"
    a = img.getchannel("A")
    hist = a.histogram()
    transparent = sum(hist[:32])
    opaque = sum(hist[224:])
    total = img.width * img.height
    if transparent < total * 0.05:
        return False, f"no transparent region ({transparent}/{total})"
    if opaque < total * 0.05:
        return False, f"no opaque region ({opaque}/{total})"
    return True, f"{img.width}x{img.height} alpha ok (t={transparent}, o={opaque})"


def current_progress(page) -> str:
    """Extract the processing dialog text if visible."""
    try:
        dlg = page.locator("[role=dialog], [data-state=open]").last
        if dlg.is_visible(timeout=500):
            t = dlg.inner_text(timeout=500)
            if t:
                return t.splitlines()[0][:80]
    except Exception:
        pass
    return ""


def smoke_one(page, key: str) -> bool:
    url = f"{BASE}/removerized?model={key}"
    page.goto(url, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(1500)

    page.locator('input[type="file"]').first.set_input_files(str(IMG))

    btn = page.get_by_role("button", name="Remove Background")
    btn.wait_for(state="visible", timeout=30000)
    page.wait_for_function(
        "() => !document.evaluate(\"//button[.='Remove Background']\", document, null, 9, null).singleNodeValue.disabled",
        timeout=30000,
    )

    # Wait for completion toast (download + session init + inference).
    deadline = time.time() + 1800
    last = ""
    while time.time() < deadline:
        if page.locator("text=/Batch done in").count() > 0:
            break
        fail = page.locator("text=/failed/i")
        if fail.count() > 0:
            print(f"\n[{key}] FAIL toast: {fail.first.inner_text()[:120]}")
            return False
        prog = current_progress(page)
        if prog != last:
            print(f"\n  [{key}] {prog}", end="", flush=True)
            last = prog
        print(".", end="", flush=True)
        page.wait_for_timeout(2000)
    else:
        print(f"\n[{key}] TIMEOUT waiting for Batch done")
        return False
    print()

    # Download the processed result and inspect its alpha channel.
    with page.expect_download(timeout=30000) as dl:
        page.locator('button[aria-label="Download result"]').click()
    path = dl.value.path()
    ok, detail = verify_alpha(Path(path).read_bytes())
    print(f"[{key}] output: {detail}")
    return ok


def main():
    keys = sys.argv[1:]
    ok = True
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        for key in keys:
            t0 = time.time()
            try:
                r = smoke_one(page, key)
            except Exception as e:
                print(f"\n[{key}] EXCEPTION: {type(e).__name__}: {str(e)[:200]}")
                r = False
            print(f"[{key}] {'PASS' if r else 'FAIL'} ({time.time() - t0:.0f}s)")
            ok = ok and r
        browser.close()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
