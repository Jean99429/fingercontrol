# fingercontrol

fingercontrol 是一个独立的“上传视频 + 双手手势识别 + 文字/音频合成”工具，不属于作品集网站代码库。

## 新方向

视觉效果不再由 fingercontrol 实时生成。Jean 先在 Efecto 中制作并导出全程开启 ASCII 效果的视频，再把视频上传到 fingercontrol：

1. 上传 Efecto 导出的 ASCII 视频。
2. 可选上传同一段未经 ASCII 处理的原视频，专门用于更稳定的手部识别。
3. MediaPipe 逐帧识别左右手和拇指捏合动作。
4. 左右手各有四个固定手指输入框，共八个自定义单词。
5. 每个单词可以绑定一个 Jean 提供的真实音频文件。
6. 触发时在视频上显示文字并播放对应音频。
7. 预览后导出带文字与声音的最终视频。

项目不再包含实时摄像头、人物分割、粒子、RGB、Dither、Glyph Dissolve 或其他视觉效果。ASCII 画面由 Efecto 预先完成。

## 文档

- [SPEC.md](./SPEC.md)：唯一权威产品与技术规格。
- [INTERACTION.md](./INTERACTION.md)：交互与视觉方向摘要。

如文档冲突，以 `SPEC.md` 为准。
