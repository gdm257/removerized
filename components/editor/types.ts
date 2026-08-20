export type ActiveTool = "remover" | "upscaler" | "colorizer"

export type ModelKey =
  | "ormbg_quantized"
  | "ormbg_fp16"
  | "isnet_quantized"
  | "isnet_fp16"
  | "birefnet_lite"
  | "birefnet_lite_fp16"
  | "rmbg_1_4_quantized"
  | "rmbg_1_4_fp16"
  | "modnet_quantized"
  | "u2net"
  | "silueta"
  | "u2net_human_seg"
  | "u2net_cloth_upper"
  | "u2net_cloth_lower"
  | "u2net_cloth_full"
  | "isnet_general_use"
  | "isnet_anime"
  | "bria_rmbg_2_0"
  | "birefnet_general"
  | "birefnet_portrait"
  | "birefnet_dis"
  | "birefnet_hrsod"
  | "birefnet_cod"
  | "swin2sr_quantized"
  | "swin2sr_fp16"
  | "deoldify_artistic_quantized"
  | "deoldify_artistic_fp16"

export type UpscalerModelKey = "performance" | "balanced" | "quality"

export type ModelStatus = "idle" | "downloading" | "ready" | "error"

export interface QueueResult {
  name: string
  data: Blob
}

export type ProgressCallback = (text: string, pct: number) => void

export interface DialogState {
  open: boolean
  text: string
  progress: number
}
