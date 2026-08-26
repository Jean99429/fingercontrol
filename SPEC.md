# fingercontrol — Product & Technical Specification

状态：实现规格 v3.0（2026-08-26 最终收尾版）
项目路径：`/Users/jean/Documents/ChatGPT/fingercontrol`  
归属：独立工具，不属于 `portfolio WEB OF JEAN`

本文档是 fingercontrol 的唯一权威规格。AI Studio 提示词、代码重构、视觉审核和验收均以本文为准。旧版“左手文字 + 右手视觉效果”方案已废弃；实时摄像头作为输入模式保留，但不再生成视觉效果。

## 1. 产品定义

fingercontrol 是一个桌面端手势文字与语音视频合成工具，提供 `CAMERA` 和 `UPLOAD VIDEO` 两种输入模式。摄像头模式实时识别和合成；上传模式逐帧分析用户选择的任意本地视频。两种模式都在正确位置叠加自定义文字，并使用三种固定 Kokoro 音色循环朗读任意输入文字。

### 1.1 核心目标

- 识别实时摄像头或上传视频中的左右手。
- 识别每只手的拇指与食指、中指、无名指、小指接触。
- 左右手各显示四个固定文字输入框，共八个单词。
- 所有手指循环使用 `af_heart`、`am_puck`、`af_sarah` 三种音色朗读。
- 在触发位置显示文字并立即发音。
- 显示清楚的 `#E60340` 指尖点、坐标标签和触发时白色手框。
- 将视频、文字、追踪层和音频合成为可保存的 MP4 文件。

### 1.2 明确非目标

- 摄像头权限只在 Jean 主动选择 `CAMERA` 并点击开始后请求。
- 不在 fingercontrol 中生成 ASCII、Dither、粒子、RGB、Glyph Dissolve 或其他视觉效果。
- 不包含人物分割或 WebGL 效果库。
- 不再让右手控制视觉效果；左右手功能完全一致。
- 不使用 Gemini TTS、外部语音 API 或上传音频文件；Kokoro 在浏览器本地运行。
- 不用提示音或效果音冒充单词语音。
- 不提供校准页、账号、数据库或多人协作。
- 不修改作品集网站。

## 2. 两种制作流程

```text
准备视频
  ├─ 任意显示视频（必选）
  └─ 同源干净识别视频（重度风格化画面时可选）

fingercontrol
  ├─ 上传视频
  ├─ 配置左右手八个文字/音频行
  ├─ MediaPipe 逐帧分析识别视频
  ├─ 生成手势事件时间轴
  ├─ 在显示视频上合成追踪层与文字
  ├─ 在触发时间点播放三音色语音
  └─ 预览并导出最终视频

CAMERA
  ├─ 选择摄像头设备
  ├─ 实时 Hand Landmarker
  ├─ 正常摄像头画面 + 追踪层 + 文字
  ├─ 触发浏览器语音
  └─ 内置录制或系统录屏
```

## 3. 技术架构

### 3.1 技术栈

- React
- TypeScript
- MediaPipe `@mediapipe/tasks-vision`
- Hand Landmarker：`runningMode: VIDEO`，`numHands: 2`
- Canvas 2D：视频、文字和追踪层的最终合成画布
- Kokoro.js：三音色神经语音，仅在需要时动态加载
- Web Speech API：预览即时语音与 Kokoro 不可用时的回退
- Canvas、Web Audio 与 MediaRecorder：合成画面、原视频音轨和神经语音
- localStorage：保存文字与轻量 UI 配置
- `getUserMedia()`：仅用于 CAMERA 模式
- 目标平台：桌面 Chrome

不需要 Three.js、人物分割或 Shader。CAMERA 模式直接绘制原始摄像头画面，不添加滤镜。

### 3.2 CAMERA 模式

- 只有选择 CAMERA 并点击 `START CAMERA →` 后才请求权限。
- 允许选择浏览器可用的摄像头设备。
- 画面水平镜像由 `MIRRORED` 设置控制。
- Hand Landmarker 使用 VIDEO 模式实时处理摄像头帧。
- 显示原始 RGB 摄像头画面，不做灰度、背景替换或视觉效果。
- 追踪点、坐标框、文字和浏览器语音规则与上传模式完全一致。
- 可使用内置录制导出，或由 Jean 使用系统录屏。

### 3.3 UPLOAD VIDEO 的两条视频轨

#### `displayVideo`（必选）

- 浏览器可解码的任意本地视频。
- 用于预览与最终成片。
- fingercontrol 原样使用其画面，不添加或改变视觉效果。

#### `trackingVideo`（可选）

- 与显示视频同步、手部轮廓更清楚的原视频。
- 只用于 Hand Landmarker 推理，绝不绘制到最终画面。
- 如果不存在，则使用 `displayVideo` 完成识别。

显示视频始终是时长、尺寸和最终画面的主轨。识别视频只负责定位手指，不使用“时长不一致”阻止分析；用户负责保证两条素材起点大致对应。

### 3.4 上传视频分析方式

- 根据视频时间戳顺序调用 `detectForVideo()`。
- 识别过程显示明确进度，不要求实时播放速度。
- 推理尽量放入 Web Worker，避免页面冻结。
- 分析完成后保存手势事件，不在每次播放时重复推理。

## 4. 应用结构

应用只有两个主页面：

1. `SETUP`
2. `LIVE / PREVIEW / EXPORT`

不增加欢迎页、视觉效果选择页或校准页。CAMERA 的实时画面与 UPLOAD VIDEO 的预览共用第二个页面。

## 5. SCREEN 1 — SETUP

### 5.1 页面结构

参考 Jean 提供的 Fingertalk 截图，只采用布局逻辑：

- 深色全屏背景。
- 内容整体水平、垂直居中。
- 主内容最大宽度约 840–960px。
- 顶部：`fingercontrol` 标题和一行说明。
- 标题下方是紧凑的 `CAMERA / UPLOAD VIDEO` 分段切换。
- 视频上传区保持紧凑，不做巨大拖拽面板。
- 中部：左右两个等宽、等高的配置框。
- 左框为 `LEFT HAND`，右框为 `RIGHT HAND`。
- 左手必须在页面左侧，右手必须在页面右侧。
- 底部只有一个高优先级按钮：CAMERA 模式为 `START CAMERA →`，UPLOAD VIDEO 模式为 `ANALYZE VIDEO →`。

禁止旧版上下堆叠布局、视觉效果下拉框、多层工具栏、机器人贴纸、游戏 HUD 和发光渐变卡片。

### 5.2 输入模式区域

CAMERA 模式显示：

- 摄像头设备选择。
- `MIRRORED` 开关。
- 不显示视频上传框。

UPLOAD VIDEO 模式显示：

- `VIDEO`：必选，接受任意浏览器可解码的本地视频。
- `CLEAN TRACKING VIDEO`：可选，注明“风格化视频识别不稳定时使用”。
- 显示文件名、时长、分辨率和替换/删除操作。
- 提供 `MIRRORED VIDEO` 开关，用于正确解释左右手和叠加坐标。

### 5.3 左右手输入框

左右手各一个面板。每个面板固定四行：

1. INDEX
2. MIDDLE
3. RING
4. PINKY

每一行：

- 左侧是固定手指名称。
- 右侧是一个直接输入单词的文字框。
- 不显示手指映射下拉框。
- 不显示声音模式、声音选择、语速、音高、音量或效果设置。

拇指只作为触发器，不显示为输入行。

### 5.4 三音色语音系统

- 不提供声音选择 UI。
- 八个槽按顺序循环使用 `af_heart`、`am_puck`、`af_sarah`。
- 三种音色分别来自当前 JEAN、I、AM 所使用的最终声音。
- 任意输入文字都使用这三种音色之一，不限制为 I / AM / JEAN 三个词。
- Kokoro 模型只在需要神经语音或开始导出时动态加载，禁止设置页启动时预热八个槽。
- 预览优先使用浏览器英文系统语音保证即时触发；无可用系统语音时回退 Kokoro。
- `newjeans` 在发音前替换为 `new jeans`。
- `speechSynthesis.onvoiceschanged` 后重新分配 voices。
- 点击模式主按钮时执行 `speechSynthesis.resume()`、刷新 voices，并 speak 一个空白 utterance 完成用户手势解锁。
- 每次发音前执行 `speechSynthesis.cancel()`，再立即 speak 当前单词。
- 语音异常必须记录并显示调试信息，禁止静默吞掉错误。

### 5.5 设置保存

localStorage 保存八个文字、启用状态、镜像设置和追踪层显示设置。浏览器不持久保存本地视频文件；刷新后需要重新选择视频。

## 6. SCREEN 2 — LIVE / PREVIEW / EXPORT

### 6.1 画面构成

- CAMERA 模式显示正常实时摄像头；UPLOAD VIDEO 模式原样显示上传的视频。
- 在同一个 Canvas 中绘制视频、追踪标记和文字。
- 预览由系统英文语音即时触发，导出由 Kokoro 音频进入 Web Audio 混音。
- 不添加任何新的视觉滤镜。

### 6.2 精简控制

只保留：

- `BACK TO SETUP`
- 播放/暂停
- 时间轴拖动
- 上传模式显示 `REANALYZE`；摄像头模式显示 `STOP CAMERA`
- `EXPORT VIDEO`

允许显示轻量事件时间轴，用于查看检测结果和删除明显误触。调试日志和模型参数默认隐藏。

## 7. 手部识别

### 7.1 左右手

- `numHands: 2`。
- 使用 MediaPipe handedness 区分左右手。
- `MIRRORED VIDEO` 开启时，只在业务映射和屏幕坐标转换处纠正一次。
- 两只手允许同时触发不同单词。
- 每只手同一时刻只允许一个手指处于 ACTIVE。

### 7.2 捏合规则

- THUMB TIP：4
- INDEX TIP：8
- MIDDLE TIP：12
- RING TIP：16
- PINKY TIP：20

使用相对于手掌尺度归一化的指尖距离。每只手独立维护：

```text
IDLE → APPROACHING → ARMING → ACTIVE → RELEASING → IDLE
```

- 进入阈值后保持约 180–250ms 才确认。
- `pinchOff` 大于 `pinchOn`，形成滞回。
- ACTIVE 只创建一个事件。
- 松开并完成冷却后才能再次触发。
- 多根手指同时靠近时选择归一化距离最近者。

### 7.3 风格化视频识别风险

ASCII、Dither 或其他重度风格化画面可能破坏手指边缘。上传模式必须支持可选干净识别视频，而不是不断降低置信度制造误识别。普通视频直接使用自身识别；摄像头模式直接分析实时画面。

## 8. 追踪视觉规范

### 8.1 指尖点

- 双手各显示五个指尖点。
- 颜色固定为 `#E60340`，无黑色描边。
- 以 1920×1080 为基准：普通半径 7px，接近时 9px，ACTIVE 时 12px。
- 根据输出分辨率等比缩放并设置合理上下限。
- 点必须清楚可见，但不能覆盖整根手指。

### 8.2 双手坐标框

- 红点和坐标标签常显；手部框只在对应文字触发时显示。
- 根据该手 21 个关键点计算屏幕包围盒。
- 四周增加约 18% padding，使框比手本身明显大一点。
- 最小可视尺寸约为画面短边的 12%。
- 触发框使用白色细线。
- 优先使用四角短线，避免厚重封闭矩形。
- 显示 `L` 或 `R`、短 X/Y 轴和捏合中心十字。
- 坐标与点优先低延迟跟随当前识别帧，不增加可感知的额外平滑延迟。
- 不显示完整骨骼、手腕轨迹或 21 点编号。

所有追踪元素必须绘入合成 Canvas，而不是只作为 HTML 调试层。

## 9. 文字行为

某一行进入 ACTIVE 时：

1. 在拇指与目标手指中点附近生成输入框中的文字。
2. 使用该行在三音色循环中分配到的 voice 朗读文字一次。
3. 文字使用白字、`#E60340` 底色、终端等宽字体和少量 padding。
4. 松开后立即消失，不保留重影、拖尾或释放缓冲。
5. 单次捏合不重复创建文字或播放音频。

字号以 1920×1080 为基准：触发文字 30px、坐标数字与编号 8px、通道小标签及拇指 `T` 为 5px。其他分辨率统一按 `视频短边 / 1080` 等比缩放。

未触发时不显示任何输入框文字。

## 10. 语音触发与导出

### 10.1 唯一声音来源

- Kokoro `af_heart`、`am_puck`、`af_sarah` 三音色。
- 预览阶段可使用浏览器系统英文 voice 作为即时路径。
- 可选保留上传视频已有音轨。

禁止 Gemini TTS、外部语音 API、上传音频文件，以及用点击声、提示音或效果音代替单词朗读。

### 10.2 触发实现

- 使用 `pinchNow[]` 和上一帧状态比较，仅在 `false → true` 的瞬间触发。
- 每个单词维护 `lastSpoke`；距离上次发音不足 450ms 时忽略。
- 触发函数直接调用 `speechSynthesis.cancel()` 和 `speechSynthesis.speak(utterance)`。
- 不把语音藏在 `audioMode`、左右手分支或旧效果状态后面。
- 左右手完全相同，八个非空输入框均可直接发音。
- 双手心形保持超过 350ms 时，按左右面板和手指顺序将所有非空单词排队朗读；完成前不响应单个单词；心形触发冷却 3500ms。

### 10.3 MP4 导出

- 上传模式使用 Canvas capture、显示视频原音轨和 Web Audio Kokoro 音轨完成混音。
- 依次检测浏览器支持的 MP4/H.264/AAC 或 MP4/H.264/Opus 类型。
- 只在真实支持 MP4 时创建 MediaRecorder；不支持时明确失败，不生成 WebM 后改扩展名。
- Canvas 保持显示视频原始像素尺寸，并从解码帧时间估算最接近的 24/25/30/50/60fps。
- 视频基础码率：720p 9Mbps、1080p 14Mbps、1440p 22Mbps、4K 36Mbps；50/60fps 乘以 1.5。音频码率 192kbps。
- 导出阶段显示准备与实时渲染进度。
- 生成 Blob 后既尝试自动下载，也保留持久 `SAVE VIDEO` 链接。

## 11. 数据模型

```ts
type Hand = 'left' | 'right';
type Finger = 'index' | 'middle' | 'ring' | 'pinky';

type ContentSlot = {
  id: string;
  hand: Hand;
  finger: Finger;
  enabled: boolean;
  text: string;
  voiceURI?: string;
  pitch?: number;
  rate?: number;
};

type GestureEvent = {
  id: string;
  hand: Hand;
  finger: Finger;
  startTime: number;
  releaseTime: number;
  x: number;
  y: number;
};

type FingercontrolConfig = {
  version: 2;
  mirroredVideo: boolean;
  trackingVisible: boolean;
  slots: ContentSlot[];
};
```

视频与 `File` 对象只在当前会话保留，不写入 localStorage。

## 12. UI 视觉系统

### 12.1 参考图采用范围

采用居中单焦点布局、标题/说明/两个等宽框/单一主按钮的层级、大量留白、等宽字体、深色背景和细边框。

不采用 `Fingertalk` 名称、韩文、机器人图案、原图品牌文字和完全照抄的配色。

### 12.2 建议视觉令牌

- 页面背景：深黑蓝，接近 `#07111F`。
- 面板背景：比页面略亮但低对比。
- 面板边框：低饱和蓝灰。
- 主文字：接近白。
- 次要文字：中性灰蓝。
- 追踪强调色：严格使用 `#E60340`；触发框使用白色。
- 字体：清晰的等宽字体。
- 圆角适中，不使用巨大胶囊和过度阴影。

## 13. 错误与降级

- CAMERA 模式摄像头被拒绝或不可用：停留在设置页并说明如何处理。
- UPLOAD VIDEO 模式显示视频缺失：禁止分析。
- 视频无法解码：说明支持格式并允许替换。
- 双轨时长不一致：以显示视频为主轨继续，识别轨只用于坐标辅助。
- Hand Landmarker 加载失败：提供重试。
- 只识别到一只手：保留已识别事件并明确报告。
- 风格化视频识别率过低：建议上传干净识别视频。
- 音频无法解码：标记具体行，不用提示音代替。
- 不支持 MP4：明确提示不支持并停止，不回退成其他容器。

## 14. 代码重构范围

下一轮实现必须删除或停用旧版：

- Person Segmentation。
- EffectEngine 和全部视觉效果。
- 左手/右手不同业务逻辑。
- 旧版可编辑 TTS 设置、音频文件上传、效果音和八音色预热。
- 旧版 `ENABLE CAMERA` 流程和旧版视觉 PERFORMANCE 页面；以新的模式选择和 LIVE/PREVIEW 页面替代。

保留并改造：

- MediaPipe Hand Landmarker。
- 左右手 handedness 处理。
- 捏合状态机。
- 文字合成层。
- 指尖追踪层。
- localStorage 配置框架。

## 15. 实施阶段

### Phase 1 — 新设置页与双输入模式

- 重建双栏 SETUP。
- CAMERA 设备选择与实时输入。
- 显示视频和可选识别视频上传。
- 左右手八个固定文字输入框。
- 视频模式 Hand Landmarker。
- 生成手势事件列表。

### Phase 2 — 合成预览

- 正常摄像头 Canvas 实时画面。
- 上传视频 Canvas 播放。
- `#E60340` 大号指尖点。
- 常显坐标标签与触发时白色手框。
- 全大写文字出现并在松开时立即消失。
- 三音色循环语音直接触发。

### Phase 3 — 导出与修正

- 轻量事件时间轴。
- 删除误触事件。
- Canvas + 原视频音轨 + Kokoro Web Audio 混音验证。
- 真实 MP4 MediaRecorder 与 `SAVE VIDEO` 验证。

## 16. MVP 验收标准

### 设置页

- 页面采用参考图式居中布局，不再上下堆叠。
- 可在 CAMERA 和 UPLOAD VIDEO 之间清楚切换。
- 左手和右手是两个并排、等宽的大框。
- 每只手只有 INDEX、MIDDLE、RING、PINKY 四个文字输入框。
- 每行只有固定手指名称和文字输入框。
- 不存在手指映射、视觉效果选择、音频上传或声音参数设置。

### 输入与手势

- CAMERA 模式能选择摄像头并实时运行。
- CAMERA 模式显示正常原色画面，不添加任何效果。
- 能上传任意本地视频和可选干净识别视频。
- 正确区分左右手。
- 两只手都能触发文字和音频。
- 八种拇指接触均可识别。
- 单次捏合只生成一个事件。
- 识别轨永不进入成片。

### 追踪层

- 指尖点明显大于旧版。
- 普通点以 1080p 半径 7px 为基准。
- 颜色是 `#E60340` 且无黑色描边。
- 红点和坐标常显；左右手触发时出现略大于手部的白色框。
- 不出现骨骼和满屏 HUD。

### 文字、声音与导出

- 文字出现在对应捏合位置。
- 左右手行为一致。
- 触发时直接朗读输入框单词，而不是播放效果音。
- 八个槽循环使用 `af_heart`、`am_puck`、`af_sarah` 三种声音。
- 设置页不预热 Kokoro；首次导出时显示明确的语音准备状态。
- 导出结果包含原画面、追踪层、文字、原视频音轨和可听见的 Kokoro 语音。
- 导出视频时长与输入视频一致。
- 稳定导出可播放、带声音、真实容器的 MP4。
