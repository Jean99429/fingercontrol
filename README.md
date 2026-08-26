# fingercontrol

fingercontrol 是独立的双手手势文字与语音视频合成工具，不属于 `portfolio WEB OF JEAN`。

## 当前版本

- 两种输入：实时摄像头，或上传任意本地视频。
- 可选上传同源干净视频作为隐藏识别轨；显示视频始终是最终画面主轨。
- 左右手采用同一套规则：拇指是触发器，分别与食指、中指、无名指、小指捏合。
- 八个手指槽均可输入任意文字。
- 红色指尖点和坐标标签常显；白色细手框只在文字触发时出现。
- 触发文字为白字、`#E60340` 底色、无描边、全大写。
- 所有手指循环使用三种 Kokoro 音色：`af_heart`、`am_puck`、`af_sarah`。
- Kokoro 仅在需要神经语音时懒加载，不阻塞设置页输入。
- 上传视频分析会过滤短促误识别事件，显示视频决定时长与最终画面。
- 完成后保留 `SAVE VIDEO`，只下载 `.mp4`，不伪装或回退为 WebM。
- 导出保持显示视频原始像素尺寸，自动估算 24/25/30/50/60fps，并按分辨率使用高码率重新编码。

## 本地运行

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

## 文档

- [SPEC.md](./SPEC.md)：当前产品与技术规格。
- [INTERACTION.md](./INTERACTION.md)：交互和视觉规则。
- [HANDOFF.md](./HANDOFF.md)：本轮实现总结、已知限制和交接信息。

正式项目路径：`/Users/jean/Documents/ChatGPT/fingercontrol`。
