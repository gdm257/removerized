# Port rembg ONNX models into Removerized

> 需求基线来自已确认的 intent 文档:`docs/intent/rembg-models-port.md`(user: yes, 2026-08-20)。

## Goal

把 rembg 生态中所有技术可行的 ONNX 抠图模型移植进 Removerized,模型菜单从 5 家族扩展到约 13 家族;产物部署到 Cloudflare Pages(纯静态,无后端)。

## Requirements

### R1 模型清单(全搬,以 HF 可直链落点为准)

| 组 | 模型 key(计划) | HF 落点(2026-08-20 探测实测) |
|---|---|---|
| U²-Net 家族 320 | `u2net` / `silueta` / `u2net_human_seg` | `jellybox/*`(u2net 176MB / silueta 44MB / human_seg 176MB,均实跑通过) |
| 服装分割 768 | `u2net_cloth_upper` / `u2net_cloth_lower` / `u2net_cloth_full`(同一模型文件,3 个菜单条目) | `jellybox/u2net-cloth-seg`(输出 [1,4,768,768] 已确认) |
| ISNet 1024 | `isnet_general_use` / `isnet_anime` | `jellybox/isnet-general-use` / `jellybox/isnet-anime`(均实跑通过) |
| BRIA 1024 | `bria_rmbg_2_0`(默认挂 fp16 513MB) | `kn4666/bria-rmbg-2.0-web`(fp32/fp16/uint8/q4 全档实跑通过) |
| BiRefNet 1024 | `birefnet_general` / `birefnet_general_lite`(复用现有 BiRefNet_lite)/ `birefnet_portrait` / `birefnet_dis` / `birefnet_hrsod` / `birefnet_cod` | `onnx-community/BiRefNet-ONNX` 及各变体 repo |
| ~~u2netp~~ | **移除**:HF 无独立镜像;u2net 本体已覆盖,轻量档由现有 MODNet(25MB)承担 | — |
| ~~birefnet_massive~~ | **可选缺口**:HF 无 ONNX 镜像;要上架需用户自转存(个人 namespace,900MB),默认不做 | — |


### R2 前置管线改造

- `preprocessImage` 支持按模型指定输入尺寸(320/768/1024);当前硬编码 `INFERENCE_SIZE=1024`。
- `MODELS` 元数据增加 `inputSize` / `mean` / `std`(归一化参数,与 rembg 各 session 对齐)。
- 输入张量名改为运行时从 `session.inputNames[0]` 动态获取(替代静态 `inputType` 映射)。
### R3 模型托管(直链现有 HF 转档)

- CORS 已双重实测(代理 HEAD + 真浏览器 fetch):GitHub Release 资产被浏览器 CORS 拦截,HF resolve 可用 → 新模型一律直链 HF 现有 public+ungated 转档(见 R1 落点列)。
- 沿用现有 `idb.ts` HF 流式下载 + IndexedDB 缓存,零自托管、零 token。
- 唯一自托管场景(可选):用户决定上架 birefnet_massive 时,转存到个人 namespace HF repo。


### R4 现有行为不变

- 现有 5 个抠图模型(ormbg / isnet / birefnet_lite / rmbg_1_4 / modnet)的输出不得因管线改造而回归。

### R5 许可(用户已拍板 B1)

- `bria_rmbg_2_0`(Non-Commercial)保留上架,风险已知悉;纯前端架构下模型不经站长分发。
- 菜单条目沿用现有 `license` 字段如实标注。

## Acceptance Criteria

- [ ] `pnpm build` 通过,无类型错误。
- [ ] 模型选择菜单出现全部 16 个新条目(R1 表,不含 u2netp/massive),标签/许可/体积如实。
- [ ] 320 输入模型(u2net 系)能跑通推理并输出正确 alpha(shape 不再 mismatch)。
- [ ] cloth_seg 三条目共享同一 IndexedDB 缓存(只下载一次),分别输出上装/下装/全身 mask。
- [ ] BiRefNet rembg 变体(logits 输出)经 sigmoid 后 alpha 正确。
- [ ] 现有 5 模型对同一测试图输出与改造前一致(肉眼 + alpha 通道抽样对比)。
- [ ] 本地 `pnpm dev` 手动冒烟:每家族至少 1 个模型(u2net / cloth / isnet-general / bria 2.0 / birefnet-general)完成一次完整抠图。
- [ ] 大模型(bria fp16 513MB / birefnet_general fp16 ~215MB)在菜单中体积标注清晰,加载失败路径不崩溃。

## Constraints

- 纯前端 WASM CPU 推理(`executionProviders: ["wasm"]`),不做量化/FP16 转换(Out of scope)。
- 单一 `preprocessImage` 管线服务于所有模型;不为新模型另起并行管线。

## Out of scope

- SAM、ben_custom、withoutbg(范式冲突 / 远程 API)
- 自做量化 / FP16
- PR 给上游 yoss-pro/removerized
