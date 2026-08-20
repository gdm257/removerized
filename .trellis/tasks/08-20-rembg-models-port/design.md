# 技术设计:rembg ONNX 模型移植

## 1. 改动面总览

| 文件 | 改动 |
|---|---|
| `components/editor/constants.ts` | `MODELS` 增加 17 个条目;元数据类型扩展 `inputSize` / `mean` / `std` / `maskMode` / `argmaxClass`;删除 `inputType`;新增 `REMBG_HF_BASE` 常量 |
| `components/editor/types.ts` | `ModelKey` union 增加 17 个 key |
| `components/editor/lib/onnx-pipeline.ts` | `preprocessImage` 参数化(size/mean/std);`applyMaskAsAlpha` 支持 logits-sigmoid 与 argmax-class 两种新模式 |
| `components/editor/hooks/use-onnx-session.ts` | 输入名改 `session.inputNames[0]`;`runInference` 从元数据取 size/mean/std/maskMode 传入管线 |
| `scripts/rehost-rembg-models.mjs`(新) | HEAD 探测 rembg GitHub Release 各文件体积 → 按需下载到 `./models-cache/` → 供 HF 上传 |

UI(`ModelSelectorDialog.tsx`)用 `Object.keys(MODELS).filter(tool===activeTool)` 平铺渲染,新条目自动出现,无需改动;`index.tsx` 的 `VALID_MODELS`(URL 参数白名单)随 types 扩展自动覆盖(实现时验证其来源)。

## 2. 元数据契约(MODELS 条目新增字段)

```ts
inputSize: number                  // 推理边长;现有 5 模型 = 1024(保持 INFERENCE_SIZE 语义)
mean: [number, number, number]     // 通道均值;现有 5 模型 = [0,0,0](行为不变)
std: [number, number, number]      // 通道标准差;现有 5 模型 = [1,1,1]
maskMode?: "alpha" | "logits" | "argmax"   // 默认 "alpha"(现状:值域越界才 sigmoid)
argmaxClass?: number               // 仅 maskMode="argmax":目标类索引
```

新模型参数(源自 `rembg/rembg/sessions/*.py`,实现时逐文件复核):

| 模型 | inputSize | mean | std | maskMode |
|---|---|---|---|---|
| u2net / u2netp / silueta / u2net_human_seg | 320 | ImageNet | ImageNet | alpha |
| u2net_cloth_{upper,lower,full} | 768 | ImageNet | ImageNet | argmax(class 1/2/3,同一文件共享 cacheKey) |
| isnet_general_use | 1024 | (0.5,0.5,0.5) | (1,1,1) | alpha |
| isnet_anime | 1024 | ImageNet | (1,1,1) | alpha |
| bria_rmbg_2_0 | 1024 | ImageNet | ImageNet | alpha |
| birefnet_* (7 个) | 1024 | ImageNet | ImageNet | logits(ONNX 输出为 logits,强制 sigmoid;rembg `birefnet_general.py` 同款) |

ImageNet = (0.485, 0.456, 0.406) / (0.229, 0.224, 0.225)。
## 3. 管线改动

### 3.1 preprocessImage(参数化)

```
preprocessImage(imgEl, ort, size, mean, std)
```

- letterbox 几何保持不变(黑边居中),仅把 `INFERENCE_SIZE` 换成 `size`。
- 归一化:`(px/255 - mean) / std`,mean=0/std=1 时与现行为逐位一致。
- **有意偏差**(不复制 rembg):① 保留 letterbox 而非 rembg 的直接拉伸(letterbox 保持纵横比,`applyMaskAsAlpha` 的反向映射已配套);② 保留 `/255` 而非 rembg 的 `/max(pixel)`(后者是暗图会整体提亮的怪癖,模型按标准归一化训练)。

### 3.2 applyMaskAsAlpha(三种 maskMode)

1. **alpha**(现状):逐像素值域越界才 sigmoid。现有 5 模型 + u2net 系 + isnet + bria 走此路径。
2. **logits**:`maskValue = sigmoid(v)` 无条件应用(birefnet_* rembg 变体)。
3. **argmax**:张量 `[1, C, H, W]`,逐像素对 C 通道取 argmax,`alpha = (cls === argmaxClass) ? 255 : 0`(二值边缘,忠实 rembg 的 palette→L 行为);cloth 三条目 class 分别 1/2/3。

反向 letterbox 映射循环对所有模式共用。

### 3.3 输入名动态化

`session.run({ [session.inputNames[0]]: inputTensor })` 替代 `MODELS[modelKey].inputType`(rembg 同款做法 `get_inputs()[0].name`),消灭 17 个待验证输入名。`runInference` 与 `runImageToImage` 同步修改;`inputType` 字段及 13 处既有条目一并删除(clean cutover)。

## 4. 模型托管(直链 HF 现有转档,不建自托管)

- **CORS 已实测**(2026-08-20):① 代理 HEAD:GitHub Release 资产无任何 `Access-Control-Allow-Origin` 头;② 真浏览器 Chromium fetch:`github.com/.../u2netp.onnx` → `TypeError: Failed to fetch`(被 CORS 策略拦截),HF resolve → 200 且 body 可读。结论:浏览器端只能用 HF。rembg 能直连 GitHub 是因为它是 Python 进程,无同源策略。
- 排除的替代:jsDelivr 不代理 Release 资产;CF Pages 静态资产 25MB/文件上限;CF Worker 反代 = 自建后端,与纯静态架构矛盾。
- **镜像探测已完成**(2026-08-20,`probe-mirrors.py`,onnxruntime 实跑):16/17 模型在 HF 有 public+ungated 落点,直链即可,**零上传、零 token**。与现有 7 模型引用 onnx-community/Xenova 完全同构。

落点清单(实测体积/输入名):

| 模型 | repo / 文件 | 体积 | 输入名 |
|---|---|---|---|
| u2net | `jellybox/u2net` u2net_320.onnx | 176MB | `input.1` |
| u2net_human_seg | `jellybox/u2net-human-seg` u2net-human-seg_320.onnx | 176MB | `input.1` |
| u2net_cloth_seg | `jellybox/u2net-cloth-seg` u2net-cloth-seg_768.onnx(输出 [1,4,768,768] 已确认) | 176MB | `input` |
| silueta | `jellybox/silueta` silueta_320.onnx | 44MB | `input.1` |
| isnet_general_use | `jellybox/isnet-general-use` isnet-general-use_1024.onnx | 176MB | `input_image` |
| isnet_anime | `jellybox/isnet-anime` isnet-anime_1024.onnx | 176MB | `img` |
| bria_rmbg_2_0 | `kn4666/bria-rmbg-2.0-web` onnx/model_fp16.onnx(WASM CPU 下默认挂 fp16,513MB;fp32 1.02GB 备选) | 513MB | `pixel_values` |
| birefnet_general | `onnx-community/BiRefNet-ONNX` onnx/model_fp16.onnx(tags 证实 = ZhengPeng7/BiRefNet general 权重) | ~215MB | 待 Step 1 统一动态读取 |
| birefnet_{cod,hrsod,portrait,dis} | `onnx-community/BiRefNet-{COD,HRSOD_DHU,portrait}-ONNX`、`onnx-community/BiRefNet-DIS5K-ONNX` | — | 同上 |
| birefnet_general_lite | 复用现有 `onnx-community/BiRefNet_lite-ONNX`(同一模型 bb_swin_v1_tiny) | 已在用 | 已在用 |
| birefnet_massive | **无 ONNX 镜像(唯一缺口)** | — | — |
| u2netp | **无独立镜像**(Remeich 挂的是全量 u2net;mixdon 空库) | — | — |

- 缺口处理:**u2netp 从名单移除**(u2net 本体已覆盖,4.7MB 轻量版由现有 MODNet 25MB 档承担,不值得为其自托管);**birefnet_massive 可选自转存**(个人 namespace `demo/rembg-birefnet-massive`,900MB,用户决定;不做则该变体不进菜单)。Step 0 的"用户创建 HF repo + token + 上传"从必做降级为可选,仅当要 massive 时执行。
- 删库风险对冲:菜单/常量按 repo 备注来源;若镜像消失,仅对应菜单项 404,不影响其他模型(下载失败路径已有超时与错误 toast)。

## 5. 兼容与回滚

- 现有 5 模型:mean=[0,0,0]/std=[1,1,1]/size=1024/maskMode=alpha → 预处理输出与改造前逐位一致;唯一行为差异是输入名从静态映射变动态读取(值相同)。
- cloth 三条目共享 `cacheKey: "u2net_cloth_seg_v1"`,IndexedDB 只存一份。
- 回滚点:整任务单 commit,revert 即回到现状。

## 6. 风险

| 风险 | 缓解 |
|---|---|
| birefnet rembg 变体 ONNX 输出可能已含 sigmoid(则强制 sigmoid 二次压缩对比度) | 实现时抽查一个变体输出值域,若 ∈[0,1] 则该组降级为 maskMode=alpha |
| ≥900MB 模型在 WASM/移动端 OOM 或超时 | 已有 session 创建/inference 超时兜底(`use-onnx-session.ts`);菜单如实标注体积 |
| rembg 各 birefnet 1.6KB session 文件的 mean/std 可能有别于 general | 实现时逐文件核对(验收项) |
| GitHub Release 下载在用户网络不可达 | 脚本失败即阻塞 HF 转存;属外部依赖,如实上报 |
