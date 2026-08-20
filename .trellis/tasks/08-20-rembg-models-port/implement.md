# 执行计划:rembg ONNX 模型移植

> 前置阅读:`design.md`(契约)、`prd.md`(验收)、`.trellis/spec/frontend/*`(组件/类型规范)。
> 子代理派发约束:每个 dispatch prompt 首行 `Active task: .trellis/tasks/08-20-rembg-models-port`。

## Step 0 外部前置(已消解,可选)

直链方案落地后**无必做外部步骤**(probe-mirrors.py 已实测 16/17 落点,零上传零 token)。

- [ ] (可选,仅当用户要 birefnet_massive)创建个人 HF repo,从 rembg GitHub Release 下载 BiRefNet-massive-TR_DIS5K_TR_TEs-epoch_420.onnx(900MB)上传;否则该变体不进菜单

## Step 1 管线参数化(不引入新模型)

- [ ] `types.ts`:`ModelKey` 加 16 个 key(无 u2netp / birefnet_massive)
- [ ] `constants.ts`:元数据类型扩展 `inputSize/mean/std/maskMode/argmaxClass`,现有条目补默认值(1024/[0,0,0]/[1,1,1]/alpha),删除 `inputType` 字段
- [ ] `onnx-pipeline.ts`:`preprocessImage(imgEl, ort, size, mean, std)`
- [ ] `use-onnx-session.ts`:两处 `session.run` 改 `session.inputNames[0]`;`runInference` 从元数据传参
- [ ] 验证:`pnpm build` + 现有 5 模型各抠一张图,输出与 main 一致(回归门)

## Step 2 maskMode 扩展

- [ ] `applyMaskAsAlpha` 实现 `logits` / `argmax` 模式(design §3.2)
- [ ] `runInference` 按 `MODELS[key].maskMode` 分支
- [ ] 验证:单元级冒烟——构造 logits 张量与 [1,4,H,W] 张量,断言 alpha 输出符合预期(零外部依赖的 node 脚本或 vitest,遵循项目现有测试形态)

## Step 3 新模型条目

- [ ] `constants.ts`:16 条目,URL 直链 R1 落点清单(jellybox / kn4666 / onnx-community),体积用 probe 实测值;cloth 三条目共享 cacheKey
- [ ] 逐文件复核 rembg 各 session 的 mean/std/maskMode(design 风险表第 3 条)
- [ ] 验证:`pnpm build`;`ModelSelectorDialog` 渲染 16 个新条目

## Step 4 端到端冒烟(每家族 ≥1)

- [ ] u2net(320)/ u2net_cloth_upper(768 argmax)/ isnet_general_use / bria_rmbg_2_0 / birefnet_general(logits)各完成一次 `pnpm dev` 抠图
- [ ] cloth 三条目切换不触发重复下载(IDB 缓存命中)
- [ ] 大模型取消/超时路径不崩溃

## Step 5 收尾(Phase 3)

- [ ] 2.2 全量质检(lint + build + 既有测试)
- [ ] 3.3 spec 更新:如管线契约变化值得沉淀,更新 `.trellis/spec/frontend/`
- [ ] 3.4 单 commit 提交(回滚点)

## 回滚点

- Step 1-3 各自可独立 `git checkout -- <files>`;整任务单 commit,`git revert` 即回滚。
- 镜像失效(jellybox 等删库)→ 对应菜单项 404,不影响其他模型;换落点或自转存(见 prd R3 可选场景)。

## 审查门

- Step 1 完成后:现有 5 模型回归通过才继续(用户可抽查)。
- Step 4 完成后:向用户出示每家族冒烟截图/输出,确认后进 Phase 3。
