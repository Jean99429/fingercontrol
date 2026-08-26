# fingercontrol Handoff — 2026-08-26

## 最终目标

把已完成视觉风格的视频作为显示主轨，离线识别双手捏合，在正确时间与位置叠加文字、追踪视觉和语音，并下载成片。实时摄像头模式保留，但上传视频是主要制作流程。

## 已完成

- CAMERA / UPLOAD VIDEO 双模式。
- 左右手八个可编辑文字槽；双手统一捏合规则。
- 显示视频与可选识别视频双轨。
- 离线手势分析、事件时间轴、事件删除和重新分析。
- 镜像与左右手映射修正。
- 短促错误事件过滤，解决 WELCOME 前闪现 HI 等问题。
- `#E60340` 指尖点和文字底色；白色触发框；灰底白字坐标。
- 文字全大写、无黑描边、无拖尾，松开立即消失。
- Kokoro 神经语音与 Web Audio 导出混音。
- 仅保留并循环三种音色：`af_heart`、`am_puck`、`af_sarah`。
- Kokoro 动态导入；初始主脚本由约 2.6MB 降至约 397KB。
- 导出阶段反馈、持久 `SAVE VIDEO` 链接和 `.mp4` 文件名。

## 关键实现文件

- `src/components/SetupScreen.tsx`：设置与视频选择。
- `src/components/PerformanceScreen.tsx`：预览、播放、语音混音和 MP4 导出。
- `src/vision/gestureRecognizer.ts`：MediaPipe、左右手与事件稳定。
- `src/renderer/visualRenderer.ts`：红点、坐标、白框和触发文字。
- `src/utils/speechEngine.ts`：三音色 Kokoro、系统语音回退和懒加载。
- `src/utils/audio.ts`：Web Audio 混音与导出音轨。

## 验收步骤

1. 在 SETUP 输入八个文字。
2. 上传显示视频；必要时添加同源干净识别视频。
3. 点击分析，确认事件的手、手指、时间和位置。
4. 播放检查：红点与坐标跟手，触发时出现白框、文字和声音。
5. 点击 `DOWNLOAD VIDEO`。
6. 等待 `PREPARING AUDIO…` 与 `EXPORTING…` 完成。
7. 点击 `SAVE VIDEO`，确认文件扩展名为 `.mp4` 且包含声音。

## 已知限制

- 浏览器必须原生支持某种 `video/mp4` MediaRecorder 编码；不支持时不会生成假的 MP4。
- 首次导出需要下载并初始化 Kokoro 模型，因此语音准备时间比后续导出长。
- 本地视频 File 对象不会写入 localStorage，刷新或热更新后必须重新选择视频。
- 重度 ASCII / Dither 视频仍建议搭配同源干净识别视频。

## 仓库

- 正式路径：`/Users/jean/Documents/ChatGPT/fingercontrol`
- GitHub：`https://github.com/Jean99429/fingercontrol`
- 不要修改：`/Users/jean/Documents/ChatGPT/portfolio WEB OF JEAN`
