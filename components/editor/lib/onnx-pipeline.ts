import { INFERENCE_SIZE, MODELS } from "../constants"
import type { ModelKey } from "../types"

type Ort = typeof import("onnxruntime-web")

// ── Pre-processing ────────────────────────────────────────────────────────────

/**
 * Converts an HTMLImageElement into a normalised Float32 tensor ready for the
 * ONNX background-removal model.
 *
 * Steps:
 *  1. Draw the image onto an offscreen canvas resized to INFERENCE_SIZE².
 *  2. Read the raw RGBA pixel buffer.
 *  3. Convert each channel to float, apply ImageNet mean/std normalisation.
 *  4. Arrange the result in CHW order (channel-height-width) as required by
 *     PyTorch-exported ONNX models.
 *
 * @param imgEl - The source image element (can be any natural size).
 * @returns     - An ort.Tensor with dtype "float32" and shape [1, 3, 1024, 1024].
 */
export const preprocessImage = (
  imgEl: HTMLImageElement,
  ort: Ort,
  size: number = INFERENCE_SIZE,
  mean: [number, number, number] = [0, 0, 0],
  std: [number, number, number] = [1, 1, 1]
) => {
  const S = size

  const canvas = document.createElement("canvas")
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext("2d")!

  const ratio = Math.min(S / imgEl.naturalWidth, S / imgEl.naturalHeight)
  const newW = imgEl.naturalWidth * ratio
  const newH = imgEl.naturalHeight * ratio
  const dx = (S - newW) / 2
  const dy = (S - newH) / 2

  ctx.fillStyle = "black"
  ctx.fillRect(0, 0, S, S)
  ctx.drawImage(imgEl, dx, dy, newW, newH)

  const { data } = ctx.getImageData(0, 0, S, S)

  const float32 = new Float32Array(3 * S * S)

  for (let i = 0; i < S * S; i++) {
    float32[i] = (data[i * 4] / 255 - mean[0]) / std[0]
    float32[S * S + i] = (data[i * 4 + 1] / 255 - mean[1]) / std[1]
    float32[S * S * 2 + i] = (data[i * 4 + 2] / 255 - mean[2]) / std[2]
  }

  return new ort.Tensor("float32", float32, [1, 3, S, S])
}

// ── Post-processing ───────────────────────────────────────────────────────────

/**
 * Composites the model's foreground-probability mask onto the original image
 * as an alpha channel, producing a transparent image Blob.
 *
 * Steps:
 *  1. Read the flat Float32 mask from the output tensor (shape [1,1,H,W],
 *     or [1,C,H,W] with C semantic classes when maskMode is "argmax").
 *  2. Resolve the per-pixel foreground value according to maskMode:
 *     - "alpha":  use the value as-is; sigmoid is applied only when the
 *       tensor contains raw logits outside [0, 1].
 *     - "logits": always apply sigmoid.
 *     - "argmax": pick the argmax class per pixel; the pixel is opaque
 *       exactly when it equals argmaxClass (e.g. cloth-segmentation).
 *  3. Draw the original image on a canvas.
 *  4. For every pixel, replace the alpha byte with the mask value at the
 *     corresponding location (letterbox-aware).
 *  5. Export via `canvas.toBlob`.
 *
 * @param maskTensor  - The raw output tensor from session.run().
 * @param imgEl       - The original source image used to recover natural
 *                      dimensions and pixel data.
 * @param maskMode    - How to interpret the mask values (default "alpha").
 * @param argmaxClass - For "argmax" mode: the class index that counts as
 *                      foreground (default 1).
 * @returns           - A Promise resolving to a transparent image Blob.
 */
export const applyMaskAsAlpha = (
  maskTensor: { dims: readonly number[]; data: Float32Array },
  imgEl: HTMLImageElement,
  quality: number = 0.9,
  maskMode: "alpha" | "logits" | "argmax" = "alpha",
  argmaxClass: number = 1
): Promise<Blob> => {
  const { promise, resolve } = Promise.withResolvers<Blob>()
  const ow = imgEl.naturalWidth
  const oh = imgEl.naturalHeight

  const mH = maskTensor.dims[2] ?? INFERENCE_SIZE
  const mW = maskTensor.dims[3] ?? INFERENCE_SIZE
  const maskData = maskTensor.data
  const nC = maskTensor.dims[1] ?? 1
  const plane = mH * mW

  const origCanvas = document.createElement("canvas")
  origCanvas.width = ow
  origCanvas.height = oh
  const origCtx = origCanvas.getContext("2d")!
  origCtx.drawImage(imgEl, 0, 0)
  const origPx = origCtx.getImageData(0, 0, ow, oh)

  // Calculate ratio and offsets once outside the loop
  const ratio = Math.min(mW / ow, mH / oh)
  const newW = ow * ratio
  const newH = oh * ratio
  const dx = (mW - newW) / 2
  const dy = (mH - newH) / 2

  for (let i = 0; i < ow * oh; i++) {
    const x = i % ow
    const y = Math.floor(i / ow)

    const mx = Math.floor(x * ratio + dx)
    const my = Math.floor(y * ratio + dy)

    // Out of mask bounds
    if (mx < 0 || my < 0 || mx >= mW || my >= mH) {
      origPx.data[i * 4 + 3] = 0
      continue
    }

    if (maskMode === "argmax") {
      // Argmax over the class axis; opaque only for the requested class
      let best = 0
      let bestVal = -Infinity
      for (let c = 0; c < nC; c++) {
        const v = maskData[c * plane + my * mW + mx]
        if (v > bestVal) {
          bestVal = v
          best = c
        }
      }
      origPx.data[i * 4 + 3] = best === argmaxClass ? 255 : 0
      continue
    }

    let maskValue = maskData[my * mW + mx]

    if (maskMode === "logits") {
      maskValue = 1 / (1 + Math.exp(-maskValue))
    } else if (maskValue < 0 || maskValue > 1) {
      // Apply sigmoid only if tensor contains raw logits instead of probabilities
      maskValue = 1 / (1 + Math.exp(-maskValue))
    }

    // Smooth alpha blending
    origPx.data[i * 4 + 3] = Math.round(maskValue * 255)
  }

  const outCanvas = document.createElement("canvas")
  outCanvas.width = ow
  outCanvas.height = oh
  outCanvas.getContext("2d")!.putImageData(origPx, 0, 0)
  // Use WebP for better compression with transparency
  outCanvas.toBlob((blob: Blob | null) => resolve(blob!), "image/webp", quality)
  return promise
}

/**
 * Prepares a tensor for Image-to-Image models (Upscaler, Colorizer).
 */
export const preprocessImageToImage = (
  imgEl: any,
  ort: Ort,
  size: number = 512,
  options: {
    keepAspectRatio?: boolean
    grayscale?: boolean
    useByteRange?: boolean
  } = {}
) => {
  const { keepAspectRatio = false, grayscale = false, useByteRange = false } =
    options

  let width = size
  let height = size
  let drawWidth = width
  let drawHeight = height
  let offsetX = 0
  let offsetY = 0

  if (keepAspectRatio) {
    const originalWidth = imgEl.naturalWidth
    const originalHeight = imgEl.naturalHeight
    const ratio = Math.min(size / originalWidth, size / originalHeight)

    drawWidth = Math.max(1, Math.round(originalWidth * ratio))
    drawHeight = Math.max(1, Math.round(originalHeight * ratio))
    offsetX = Math.round((width - drawWidth) / 2)
    offsetY = Math.round((height - drawHeight) / 2)
  }

  const canvas = (globalThis as any).document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")!

  ctx.fillStyle = "black"
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(imgEl, offsetX, offsetY, drawWidth, drawHeight)

  const { data } = ctx.getImageData(0, 0, width, height)
  const float32 = new Float32Array(3 * width * height)

  for (let i = 0; i < width * height; i++) {
    let r = data[i * 4]
    let g = data[i * 4 + 1]
    let b = data[i * 4 + 2]

    if (grayscale) {
      // Standard luminance weights: 0.299R + 0.587G + 0.114B
      const gray = 0.299 * r + 0.587 * g + 0.114 * b
      r = g = b = gray
    }

    if (useByteRange) {
      float32[i] = r
      float32[width * height + i] = g
      float32[width * height * 2 + i] = b
      continue
    }

    float32[i] = r / 255
    float32[width * height + i] = g / 255
    float32[width * height * 2 + i] = b / 255
  }

  return new ort.Tensor("float32", float32, [1, 3, height, width])
}

/**
 * Converts a [1, 3, H, W] tensor back into a PNG Blob.
 */
export const tensorToImageData = (
  tensor: any,
  width: number,
  height: number,
  options: { valueMode?: "unit" | "byte"; quality?: number } = {}
): Promise<Blob> =>
  new Promise((resolve) => {
    const { valueMode = "unit", quality = 0.9 } = options
    const canvas = (globalThis as any).document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")!
    const imageData = ctx.createImageData(width, height)

    const data = tensor.data as Float32Array
    const size = width * height
    const scale = valueMode === "byte" ? 1 : 255

    for (let i = 0; i < size; i++) {
      imageData.data[i * 4] = Math.max(0, Math.min(255, data[i] * scale))
      imageData.data[i * 4 + 1] = Math.max(
        0,
        Math.min(255, data[size + i] * scale)
      )
      imageData.data[i * 4 + 2] = Math.max(
        0,
        Math.min(255, data[size * 2 + i] * scale)
      )
      imageData.data[i * 4 + 3] = 255
    }

    ctx.putImageData(imageData, 0, 0)
    // Use WebP for better compression
    canvas.toBlob((blob: any) => resolve(blob!), "image/webp", quality)
  })

/**
 * Reuses the model output as low-resolution chroma and keeps the original
 * image luminance/detail. This mirrors how other DeOldify integrations avoid
 * mushy results on non-square images.
 */
export const applyColorizerChromaToOriginal = (
  tensor: any,
  imgEl: any,
  quality: number = 0.9
): Promise<Blob> =>
  new Promise((resolve) => {
    const ow = imgEl.naturalWidth
    const oh = imgEl.naturalHeight

    const tH = Number(tensor.dims[2]) || oh
    const tW = Number(tensor.dims[3]) || ow

    const colorCanvas = (globalThis as any).document.createElement("canvas")
    colorCanvas.width = tW
    colorCanvas.height = tH
    const colorCtx = colorCanvas.getContext("2d")!
    const colorImageData = colorCtx.createImageData(tW, tH)
    const data = tensor.data as Float32Array
    const size = tW * tH

    for (let i = 0; i < size; i++) {
      colorImageData.data[i * 4] = Math.max(0, Math.min(255, data[i]))
      colorImageData.data[i * 4 + 1] = Math.max(
        0,
        Math.min(255, data[size + i])
      )
      colorImageData.data[i * 4 + 2] = Math.max(
        0,
        Math.min(255, data[size * 2 + i])
      )
      colorImageData.data[i * 4 + 3] = 255
    }
    colorCtx.putImageData(colorImageData, 0, 0)

    const outCanvas = (globalThis as any).document.createElement("canvas")
    outCanvas.width = ow
    outCanvas.height = oh
    const outCtx = outCanvas.getContext("2d")!
    const ratio = Math.min(tW / ow, tH / oh)
    const contentWidth = Math.max(1, Math.round(ow * ratio))
    const contentHeight = Math.max(1, Math.round(oh * ratio))
    const cropX = Math.max(0, Math.round((tW - contentWidth) / 2))
    const cropY = Math.max(0, Math.round((tH - contentHeight) / 2))

    const resizedColorCanvas = (globalThis as any).document.createElement(
      "canvas"
    )
    resizedColorCanvas.width = ow
    resizedColorCanvas.height = oh
    const resizedColorCtx = resizedColorCanvas.getContext("2d")!
    resizedColorCtx.imageSmoothingEnabled = true
      ; (resizedColorCtx as any).imageSmoothingQuality = "high"
    resizedColorCtx.drawImage(
      colorCanvas,
      cropX,
      cropY,
      contentWidth,
      contentHeight,
      0,
      0,
      ow,
      oh
    )

    // Slightly blur only the chroma source to reduce blockiness from 256x256 inference.
    const blurredColorCanvas = (globalThis as any).document.createElement(
      "canvas"
    )
    blurredColorCanvas.width = ow
    blurredColorCanvas.height = oh
    const blurredColorCtx = blurredColorCanvas.getContext("2d")!
    blurredColorCtx.filter = "blur(1.25px)"
    blurredColorCtx.drawImage(resizedColorCanvas, 0, 0)

    // Start from the original image so all fine luminance detail remains intact.
    outCtx.drawImage(imgEl, 0, 0, ow, oh)
    outCtx.globalCompositeOperation = "color"
    outCtx.drawImage(blurredColorCanvas, 0, 0, ow, oh)
    outCtx.globalCompositeOperation = "source-over"

    // Use WebP for better compression
    outCanvas.toBlob((blob: any) => resolve(blob!), "image/webp", quality)
  })
