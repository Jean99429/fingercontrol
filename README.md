# Fingercontrol

fingercontrol 是一个以双手为界面的手势文字与语音工具。用户可以直接编辑八根非拇指上的文字，再用拇指与对应手指捏合触发语音。项目独立于 `portfolio WEB OF JEAN`。

## 功能亮点

- 用 MediaPipe 在浏览器中实时识别双手和捏合手势。
- 为八根手指分别配置文字、字体、颜色与语音。
- 支持摄像头实时表演和本地视频分析。
- 支持编辑事件时间轴并导出 MP4。
- 摄像头与视频识别在本地浏览器中完成，不上传媒体内容。

## 当前版本

- 首页以两只镜像手掌作为主要界面，文字直接显示并编辑在对应手指上。
- 拇指不放文字，只保留 `#E60340` 触发点。
- 左手：FLOW / VECTOR / PULSE / SIGNAL；右手：OBJECT / MOTION / SPACE / TIME。
- 八个槽使用各自的英文字体、字重、斜体和颜色；设置页与表演页共用同一份视觉配置。
- 首页引导文案为 “Pinch a finger. Make it speak.”，摄像头入口为 “Start performing”。
- 表演页在检测到手后常显四根手指的文字，不必等捏合后才出现。
- 应用以 `#5CFFB0` 薄荷绿为主强调色；红色仅用于手指追踪点，内外页红点统一为 `#E60340`。
- 支持实时摄像头和本地视频上传；可选同源干净视频作为隐藏识别轨。
- 使用 MediaPipe 识别双手捏合，以 Kokoro / 系统语音朗读文字。
- 上传模式支持事件时间轴、误触删除、重新分析和 MP4 导出。

## 默认手指映射

| 手 | 手指 | 文字 | 字体 | 颜色 |
| --- | --- | --- | --- | --- |
| 左 | 小指 | FLOW | Instrument Serif Italic | `#C77CFF` |
| 左 | 无名指 | VECTOR | Unbounded 800 | `#E65100` |
| 左 | 中指 | PULSE | Caveat 700 | `#3CD9FF` |
| 左 | 食指 | SIGNAL | Archivo Black 900 | `#FF5A5A` |
| 右 | 食指 | OBJECT | DM Mono 500 | `#FF5A5A` |
| 右 | 中指 | MOTION | Space Grotesk 700 | `#FFB300` |
| 右 | 无名指 | SPACE | Bricolage Grotesque 800 | `#3CD9FF` |
| 右 | 小指 | TIME | Playfair Display 600 Italic | `#5CFFB0` |

## 本地运行

```bash
npm ci
npm run dev
```

生产构建：

```bash
npm run build
```

## 文档

- [SPEC.md](./SPEC.md)：产品与技术规格。
- [INTERACTION.md](./INTERACTION.md)：交互和视觉规则。
- [HANDOFF.md](./HANDOFF.md)：当前实现、验证结果和已知限制。

## 浏览器要求

建议使用最新版 Chrome 或 Edge。实时模式需要摄像头权限；语音效果取决于浏览器提供的语音能力及 Kokoro 模型的可用性。

## 参与贡献

欢迎提交 issue 和 pull request。开始前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可证

本项目采用 [MIT License](./LICENSE)。
