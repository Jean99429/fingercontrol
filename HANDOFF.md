# fingercontrol Handoff — 2026-09-08

## 当前目标

以两只张开的手作为可直接编辑与表演的界面：八根非拇指承载文字，拇指捏合对应手指触发语音。设置页与表演页使用同一套文字映射、字体、颜色和设计语言。

## 本轮已完成

- 设置页重构为两只大型镜像手掌，不再使用传统双栏表单。
- 八个文字输入直接定位在对应手指上，移除输入框外框、下划线、暗色底和旋转角度。
- 修正手掌、文字与拇指触发点的位移和左右镜像关系。
- 增加八套指定字体与颜色，并抽取为共享 `SLOT_VISUALS` 配置。
- 修正左手默认映射：中指 `PULSE`、无名指 `VECTOR`，并迁移旧 localStorage 默认值。
- 新首页文案：`Pinch a finger. Make it speak.`；摄像头按钮改为 `Start performing`。
- 表演页在识别到手后常显四根手指文字，不再只在触发期间显示。
- 表演页文字与首页完全共用内容、字体、字重、斜体和颜色。
- 应用主强调色由大红改为薄荷绿 `#5CFFB0`。
- 红色仅保留为手指追踪语义；首页拇指点与表演页指尖点统一为 `#E60340`。
- 表演页顶部栏、按钮、边框、背景和状态控件统一为首页的深色视觉语言。
- 保留 CAMERA / UPLOAD VIDEO、MediaPipe、语音、事件时间轴和 MP4 导出能力。

## 关键实现文件

- `src/components/SetupScreen.tsx`：双手设置页与直接文字编辑。
- `src/components/PerformanceScreen.tsx`：实时/视频表演页、控制、语音和导出。
- `src/utils/slotVisuals.ts`：八个手指槽共享字体与颜色配置。
- `src/renderer/visualRenderer.ts`：指尖追踪、常显文字与 Canvas 合成。
- `src/utils/storage.ts`：默认文字和旧配置迁移。
- `src/index.css`：全局视觉系统、双手布局、字体与响应式规则。
- `public/assets/hand-right.svg`：当前双手共用的右手 SVG；左手由 CSS 镜像。
- `public/assets/ATTRIBUTION.md`：手部图形来源说明。

## 验收结果

- TypeScript 与 Vite 生产构建通过。
- 八款指定 Google Fonts 均按对应字重/斜体成功加载。
- 首页八个文字值、字体 class、颜色与水平位置已在本地预览核对。
- CAMERA 内页已实际打开检查，薄荷绿主色和深色界面已生效。
- 手指文字常显逻辑已接入 CAMERA 与 UPLOAD VIDEO 两条渲染路径。

## 已知限制

- 常显文字需要 MediaPipe 检测到手后才会出现在画布上。
- Google Fonts 需要网络；网络不可用时会使用各字体声明中的本地回退字体。
- 浏览器必须原生支持某种 MP4 MediaRecorder 编码，否则导出会明确失败。
- 首次使用 Kokoro 需要下载并初始化模型，准备时间较长。
- 本地视频 `File` 对象不会写入 localStorage，刷新后需要重新选择。
- 重度 ASCII / Dither 视频建议搭配同源干净识别视频。

## 仓库

- 本地路径：`/Users/jean/Documents/ChatGPT/Fingercontrol 2`
- GitHub：<https://github.com/Jean99429/fingercontrol>
- 分支：`main`
