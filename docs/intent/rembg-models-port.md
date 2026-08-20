# Intent: 移植 rembg 生态模型进 Removerized

状态: 已确认 (user: yes, 2026-08-20)
产出自 interview-me 访谈; 下游消费方 (规格/计划/任务) 以此为需求基线。

## Outcome

把 rembg 生态中所有技术可行的 ONNX 模型移植进 Removerized, 模型菜单从 5 家族扩展到约 13 家族。

## User / 去向

- 站长自用 + 公开访问: 部署到 Cloudflare Pages (纯静态 SPA, 无后端)。
- 模型由用户浏览器直连 HF 下载, 推理在用户设备完成, 站长不分发权重、不提供推理服务。

## Why now

现有 5 个模型菜单太薄; "全本地 + 免费隐私" 的工具形态值得配全模型选择。

## Success

部署到 CF Pages 后, 每个新增模型在下拉菜单可选、下载后能正确出图。

## 移植名单 (全搬, 技术可行为准)

u2net / u2netp / silueta / u2net_human_seg / u2net_cloth_seg (3 路 mask, 需扩展后处理) / isnet-general-use / isnet-anime / bria-rmbg 2.0 / BiRefNet 7 变体 (general、general-lite、portrait、DIS、HRSOD、COD、massive)。

## 约束

1. 前置改造先行:
   - components/editor/lib/onnx-pipeline.ts 的 preprocessImage 尺寸参数化 (320/768/1024; 当前硬编码 INFERENCE_SIZE=1024);
   - components/editor/constants.ts 的 MODELS 增加 mean/std/inputSize 元数据字段。
2. 下载源: rembg 的 GitHub Releases 直链 CORS 未验证, 模型统一转存 HuggingFace (沿用现有 idb.ts HF 流式下载 + IndexedDB 缓存)。
3. 许可: bria-rmbg (Non-Commercial) 按用户决定保留 (B1, 风险已知悉; 纯前端架构下模型不经站长分发)。上游已有的 bria 1.4 保持不动。
4. 现有 5 个模型行为不变。

## Out of scope

- SAM (交互式点选, encoder/decoder 两段范式, 与单输入单输出管线冲突)
- ben_custom / withoutbg (远程付费 API, 与全本地定位冲突)
- 自做量化 / FP16 转换 (900MB 级 FP32 模型先原样上架, 体验差是已知代价)
- 提 PR 给上游 yoss-pro/removerized
