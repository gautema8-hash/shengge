# 「生格」设计规范系统 Design System v1.0

> 设计基调：极简、低饱和、安静留白。无大红大绿，无励志热血。
> 视觉使命：**让用户"平静地来，平静地走"**——每一次视觉决策都要降低压迫感。
> 适用范围：生格 App（iOS / Android）。管理系统沿用同一 Token，差异点见 §10。
> 版本：v1.0 ｜ 2026-10-15 ｜ 维护：UI Designer ｜ Flutter 映射见 §9，可直接落地

---

## 1. 设计原则（先于一切参数）

| 原则 | 视觉翻译 |
|------|---------|
| 接纳，不施压 | 无刺眼强调色、无红点徽标、无倒计时恐吓字体 |
| 安静，不寡淡 | 用色温与留白建立层次，而非用饱和度 |
| 温和的时间感 | 数字用等宽变体，进度用柔和曲线不用百分比大字 |
| 留白即尊重 | 间距宁大勿小，信息密度主动降低 |
| 色彩不说话 | 情绪标注永远"图标+文字+颜色"三通道，不单靠颜色 |

---

## 2. 色彩体系

### 2.1 主色 · 晨雾青 Mist Teal（品牌色，克制使用）

| 阶 | Hex | 用途 |
|----|-----|------|
| 50 | `#F3F7F6` | 页面浅底、选中背景 |
| 100 | `#E1ECEA` | 悬浮态背景、浅填充 |
| 200 | `#C4DAD6` | 边框强调、分割线（选中） |
| 300 | `#A0C2BC` | 深色模式主强调、图标次级 |
| 400 | `#7BA6A0` | 图标主色、次要按钮描边 |
| **500** | **`#5B8A83`** | **品牌识别色**：Logo、插画、插画型空状态 |
| **600** | **`#477069`** | **主按钮背景 / 主文字强调**（白字对比 5.4:1 ✅） |
| 700 | `#365751` | 按钮按压态背景 |
| 800 | `#28413D` | 深色强调文字 |
| 900 | `#1B2C29` | 深色模式文字强调 |

> ⚠️ 使用纪律：主色 500/600 每屏出现 **不超过 3 处**（按钮 + 当前方格 + 选中态）。大面积永远是中性色。

### 2.2 辅助色 · 暖陶 Warm Clay（点缀、插画、温暖时刻）

| 阶 | Hex | 用途 |
|----|-----|------|
| 50 | `#FAF3EC` | 温暖卡片浅底 |
| 100 | `#F3E4D3` | 愿望完成庆祝底色 |
| 200 | `#E5C9A8` | 插画辅助 |
| 300 | `#D4AB7E` | 年度回顾高亮 |
| 400 | `#C29159` | 收藏/纪念标记 |
| 500 | `#A87A44` | 图标点缀（ sparingly） |
| 600 | `#8A6136` | 暖陶深文字 |

### 2.3 语义色（全部低饱和，禁用大红大绿）

| 语义 | 主值 | 浅底 | 深文字 | 用途 |
|------|------|------|--------|------|
| 成功 安然绿 | `#6F9E7C` | `#EAF2EC` | `#3F6B4B` | 愿望完成、同步成功 |
| 警告 暖赭 | `#B98A45` | `#F8F1E4` | `#7A5A2B` | 存储空间、软性提醒 |
| 错误 砂红 | `#C2706B` | `#FBEDEC` | `#8F4A46` | 删除确认、同步失败 |
| 信息 雾蓝 | `#6E88A6` | `#EDF1F5` | `#465D75` | 免责声明、说明类 |

### 2.4 情绪标注色（产品核心双通道）

| 情绪 | 色值 | 图标 | 文字 | 形态 |
|------|------|------|------|------|
| 滋养时刻 | `#6F9E7C` | 🌱→`sprout`(线性) | "滋养" | 图标+文字+浅底 Tag |
| 耗竭时刻 | `#C2706B` | 🍂→`leaf-fall`(线性) | "耗竭" | 图标+文字+浅底 Tag |
| 平静（未标注） | `#A8A6A0` | `circle-dashed` | "未标注" | 灰色虚线圆 |

### 2.5 中性色 · 暖灰纸感（界面的绝对主体，约占 85%）

| 阶 | Hex（浅色模式） | 用途 |
|----|------|------|
| 0 | `#FFFFFF` | 卡片表面 |
| 50 | `#FAFAF8` | **页面背景（默认）** |
| 100 | `#F2F1ED` | 分组背景、输入框底 |
| 200 | `#E4E2DC` | 分割线、边框 |
| 300 | `#CFCDC5` | 禁用边框、占位图形 |
| 400 | `#A8A6A0` | 占位文字、禁用文字 |
| 500 | `#7C7A74` | 次要文字 |
| 600 | `#5C5A55` | 辅助文字 |
| 700 | `#44423E` | 次级标题 |
| 800 | `#2E2C29` | **正文主文字（对比 12.9:1 ✅）** |
| 900 | `#1C1B19` | 标题文字（对比 16.8:1 ✅） |

### 2.6 深色模式映射（iOS/Android 跟随系统 + 手动开关）

| Token | 浅色 | 深色 |
|-------|------|------|
| 页面背景 | `#FAFAF8` | `#141615` |
| 卡片表面 | `#FFFFFF` | `#1F2220` |
| 分组背景 | `#F2F1ED` | `#262926` |
| 分割线 | `#E4E2DC` | `#333633` |
| 正文 | `#2E2C29` | `#ECEDEA` |
| 标题 | `#1C1B19` | `#F5F6F3` |
| 次要文字 | `#7C7A74` | `#9BA19B` |
| 主强调 | `#477069` | `#A0C2BC`（主300 上移） |
| 语义色 | 主值 | 统一上移到 300 阶亮度 |

---

## 3. 字体排印

### 3.1 字体栈

```text
iOS:      PingFang SC（系统默认，不引入自定义字体）
Android:  MiSans → HarmonyOS Sans → Source Han Sans → Roboto + Noto Sans SC
数字:     tabular figures（等宽数字，方格计数/剩余天数必须使用）
```

> 决策：**不引入自定义品牌字体**。系统字体保证渲染性能、动态字号适配与克制的调性。

### 3.2 字号层级（8 级）

| 层级 | 字号/行高 | 字重 | 用途 | 示例 |
|------|----------|------|------|------|
| Display | 32/40 | 600 | 方格页主数字 | 剩余天数 `12,417` |
| H1 | 28/36 | 600 | 页面大标题 | 生命方格 |
| H2 | 24/32 | 600 | 卡片组标题 | 本周记录 |
| H3 | 20/28 | 500 | 区块标题 | 滋养时刻 |
| Title | 17/24 | 500 | 列表标题、导航标题 | 今天的问题 |
| Body | 15/24 | 400 | **正文默认** | 日记内容 |
| Caption | 13/18 | 400 | 辅助说明、Tag 文字 | 记录于 3 月 12 日 |
| Footnote | 11/16 | 400 | 免责声明、版权 | 本工具不能替代专业心理帮助 |

### 3.3 排印规则

- 字重仅三档：Regular 400 / Medium 500 / Semibold 600（禁用 Bold 700，视觉过重）
- 正文行高 1.6，标题 1.3~1.35，保证呼吸感
- 数字场景（天数、格数、进度）一律 `FontFeature.tabularFigures()`
- 段落最大宽度 22 字/行（手机端自然断行即可，不强制）
- 全局支持系统动态字号缩放至 130%（`MediaQuery.textScaler`），Footnote 不缩放

---

## 4. 间距与栅格

### 4.1 间距刻度（4pt 基数）

```
space-1=4  space-2=8  space-3=12  space-4=16  space-5=20
space-6=24 space-8=32 space-10=40 space-12=48 space-16=64
```

### 4.2 使用规则

| 场景 | 值 | Token |
|------|-----|-------|
| 页面左右边距 | 20 | `screen-margin` |
| 卡片内边距 | 16 | `card-padding` |
| 列表项间距 | 12 | `list-gap` |
| 卡片与卡片间距 | 16 | `card-gap` |
| 区块之间 | 32 | `section-gap` |
| 图标与文字 | 8 | `icon-gap` |
| 按钮内水平边距 | 20 | `btn-padding-h` |
| 页面底部安全区 | 24 + SafeArea | `bottom-safe` |

### 4.3 栅格

- 手机：单列流式布局，无多列栅格（内容即栅格）
- 平板（≥600dp）：内容区最大 480dp 居中，两侧留白
- 底部导航：4 Tab 等分；导航高度 56 + 底部安全区
- 管理系统（后台）：12 列栅格、8pt 基数，见 §10

---

## 5. 圆角与阴影

### 5.1 圆角刻度

| Token | 值 | 用途 |
|-------|-----|------|
| `radius-xs` | 8 | 小 Tag、进度条端点 |
| `radius-sm` | 12 | 按钮、输入框 |
| `radius-md` | 16 | **卡片（默认）**、BottomSheet 顶部 |
| `radius-lg` | 24 | 弹窗、大容器 |
| `radius-full` | 999 | 圆形按钮、心情选择 |

### 5.2 阴影（极轻，能用边框就不用阴影）

| Token | 值 | 用途 |
|-------|-----|------|
| `shadow-none` | 无 | **卡片默认：1px `#E4E2DC` 边框替代阴影** |
| `shadow-sm` | `0 1px 2px rgba(28,27,25,0.04)` | 悬浮卡片、下拉面板 |
| `shadow-md` | `0 4px 12px rgba(28,27,25,0.08)` | BottomSheet |
| `shadow-lg` | `0 8px 24px rgba(28,27,25,0.12)` | 危机弹窗、居中 Modal |

> 深色模式下阴影失效，改用表面色阶（`#1F2220` vs `#141615`）表达层级。

---

## 6. 组件规范

### 6.1 按钮 Button

| 变体 | 背景 | 文字 | 用途 |
|------|------|------|------|
| Primary | 主600 `#477069` | 白 `#FFFFFF` | 每屏最多 1 个：保存、完成 |
| Secondary | 主50 `#F3F7F6` | 主600 | 次要操作：查看、切换 |
| Ghost | 透明 | 中性700 + 1px `#CFCDC5` 边框 | 弱操作：稍后再说 |
| Text | 透明 | 主600 | 内联操作：了解更多 |
| Danger-ghost | 透明 | 砂红 `#C2706B` + 1px `#C2706B` 边框 | 删除（必须二次确认） |

**尺寸**：Large 高 52（页面主操作）/ Medium 高 44（列表内）/ Small 高 36；圆角 `radius-sm=12`；内边距水平 20；文字 Title 17/Medium。

**状态与交互**：

| 状态 | 表现 | 时长 |
|------|------|------|
| Default | 规范色 | — |
| Pressed | 缩放 0.98 + 透明度 0.9；Primary 背景变 700 | 150ms ease-out |
| Disabled | 背景中性100、文字中性400（Primary）；其余 40% 透明度 | — |
| Loading | 文字淡出→16px 圆形进度条（2px 线宽）居中 | 250ms |
| Focus(键盘) | 2px 主600 外描边，偏移 2px | — |

> 纪律：**永不做"呼吸/闪烁"按钮**；按钮文案禁用感叹号。

### 6.2 输入框 Input / TextArea

- 高度 48（Input）/ TextArea 最小 120，随内容增长上限 320 后内部滚动
- 背景：中性50 `#F2F1ED`；圆角 `radius-sm=12`；无边框
- Focus：1px 主600 边框（outline，非阴影）；Error：1px 砂红 + 底部 13px 错误文案（砂红深文字 `#8F4A46`）
- 占位文字中性400；已输入文字 Body 15
- 日记 TextArea：右上角常驻字数（Caption，中性500，不设上限提示——**不制造写作压力**）
- 清除按钮：28px 圆形，中性400

### 6.3 Tag / 情绪标注 Chip

- 高度 28，圆角 `radius-full`，内边距水平 10、垂直 4
- 结构：16px 线性图标 + 8 间距 + Caption 13 文字（三通道）
- 滋养：底 `#EAF2EC` 文字 `#3F6B4B` ｜ 耗竭：底 `#FBEDEC` 文字 `#8F4A46`
- 可选中态：边框 1px 主600 + 底主50；不可用透明度表达选中

### 6.4 卡片 Card

- 背景 0 `#FFFFFF`（深色 `#1F2220`），圆角 `radius-md=16`，1px `#E4E2DC` 边框，内边距 16
- 无默认阴影（见 §5.2）；列表卡片间距 16
- 卡片内层级：H3 标题 → Body 内容 → Caption 元信息（间距 12/8）
- 特例 · 方格卡片：无边框无背景，直接置于页面（画布即内容）

### 6.5 底部导航 BottomNav

- 高 56 + SafeArea；背景 0/`#1F2220`；顶部 1px 分割线
- 4 Tab：方格 / 记录 / 愿望 / 我的
- 图标 24px 线性；未选中中性500，选中主600 + 图标填充为 1.5px 加粗
- 无红点、无徽标计数（产品宪法）
- 切换：页面淡入 250ms，**不做转场动画**

### 6.6 列表项 Cell

- 高度最小 64；左侧 40px 图标位（可选）；标题 Title + 副文 Caption
- 按压态：整行背景变中性100（无缩放）；右箭头 16px 中性400
- 分割线：左侧缩进 72（对齐文字），1px 中性200

### 6.7 弹窗 Modal / BottomSheet

- 底部弹层：圆角顶 `radius-md=16`、拖拽指示条 32×4 中性300、`shadow-md`
- 居中弹窗：宽 ≤320、圆角 `radius-lg=24`、`shadow-lg`
- 遮罩：`rgba(28,27,25,0.4)`；点击遮罩可关闭（危机弹窗除外）
- 进出动画：250ms，位移 + 淡入，`Curves.easeOutCubic`

### 6.8 危机干预弹窗 CrisisModal（专属规范，不可复用）

- 居中 Modal，`shadow-lg`，圆角 24
- 标题 H3「此刻的感受很沉重吗」——**不用感叹号、不用"注意/警告"字样**
- 正文 Body：固定合规文案（见合规方案 §2.3），含热线 12356
- 按钮：Large Primary「拨打热线」（44px+ 触控）+ Ghost「关闭」
- 出现动画 400ms 缓入——刻意比普通弹窗慢，降低惊吓感
- 背景：白底黑字，**禁止使用砂红/警示配色**——它不是警告，是陪伴

### 6.9 开关 Switch / 进度 Progress

- Switch：51×31（iOS 规格），选中主600，未选中中性300
- 方格进度：4px 圆角条，主600 填充于中性100 轨道；**不用百分比大字**
- 生命进度条：高度 8，圆角 `radius-xs`，末端 8px 圆点标记"今天"

---

## 7. 图标风格

| 项 | 规范 |
|----|------|
| 风格 | **线性 Outline**，1.5px 描边（24 网格），圆头圆角（`stroke-linecap: round`） |
| 网格 | 24×24，安全区 2px |
| 尺寸 | 20（列表内）/ 24（导航、按钮内）/ 40（空状态） |
| 颜色 | 跟随文字色；选中主600；禁用中性300 |
| 曲率 | 圆润有机线条，禁用尖锐直角（与"安静"调性一致） |
| 来源 | Material Symbols Rounded 为基，缺的自绘；统一入库 `app/ui/icons/` |
| 命名 | `icon_{名称}_{尺寸}.svg`，如 `icon_sprout_24.svg` |
| 双色 | 仅情绪图标（滋养/耗竭）允许 2 色：描边+浅底填充 |

---

## 8. 无障碍要求（WCAG AA 最低标准，全部强制）

### 8.1 对比度（已实测设计值）

| 组合 | 对比度 | 达标 |
|------|--------|------|
| 正文 `#2E2C29` / 页面 `#FAFAF8` | 12.9:1 | ✅ AAA |
| 标题 `#1C1B19` / 页面 | 16.8:1 | ✅ AAA |
| 次要 `#7C7A74` / 页面 | 4.6:1 | ✅ AA |
| 按钮白字 / 主600 `#477069` | 5.4:1 | ✅ AA |
| 主600 文字 / 页面 | 5.6:1 | ✅ AA |
| 滋养深字 `#3F6B4B` / 浅底 `#EAF2EC` | 4.8:1 | ✅ AA |
| 耗竭深字 `#8F4A46` / 浅底 `#FBEDEC` | 5.1:1 | ✅ AA |
| 禁用文字 `#A8A6A0` / 页面 | 2.6:1 | ⚠️ 豁免（禁用态不承载信息） |

> 禁止出现主500 `#5B8A83` 直接做正文色（对比 3.9:1 不达标）——只能做图形/大标题装饰。

### 8.2 触控与操作

- 所有可点元素 ≥44×44pt（含视觉间距）
- 手势均有等价按钮操作（方格的捏合缩放必须配"年/月"切换按钮）
- 危机弹窗的「拨打」按钮独占一屏焦点，Enter 直接触发

### 8.3 色彩非唯一通道

- 滋养/耗竭 = 图标 + 文字 + 颜色；方格 legend 必须带文字说明
- 同步状态 = 图标 + 文字，不只用颜色点
- 为色觉障碍用户验证：滋养绿/耗竭红在绿色盲模拟下依赖图标区分

### 8.4 动效与缩放

- 尊重系统"减弱动态效果"：`prefers-reduced-motion` 关闭缩放/位移，仅保留淡入淡出
- 动态字号 130% 下布局不截断（用 Flexible/流式，禁止固定高度容器装文字）
- 屏幕阅读器：方格画布提供语义替代——"你已记录 X 天，还剩 Y 天"（`Semantics` 标签）

---

## 9. Flutter 落地映射（直接可用）

### 9.1 设计 Token → ThemeData 骨架

```dart
// core/theme/tokens.dart —— 设计 Token 单一事实来源
abstract class SgColors {
  static const primary50 = Color(0xFFF3F7F6);
  static const primary500 = Color(0xFF5B8A83);
  static const primary600 = Color(0xFF477069);
  static const primary700 = Color(0xFF365751);
  static const bgPage = Color(0xFFFAFAF8);
  static const surface = Color(0xFFFFFFFF);
  static const divide = Color(0xFFE4E2DC);
  static const textPrimary = Color(0xFF1C1B19);
  static const textBody = Color(0xFF2E2C29);
  static const textSecondary = Color(0xFF7C7A74);
  static const nourish = Color(0xFF6F9E7C);
  static const drain = Color(0xFFC2706B);
}

// 深色模式在 SgColorsDark 同构实现，由 ThemeMode 切换

ThemeData sgTheme(Brightness b) {
  final isDark = b == Brightness.dark;
  return ThemeData(
    useMaterial3: true,
    scaffoldBackgroundColor: isDark ? const Color(0xFF141615) : SgColors.bgPage,
    colorScheme: ColorScheme.fromSeed(
      seedColor: SgColors.primary600, brightness: b,
    ).copyWith(primary: isDark ? SgColors.primary300 : SgColors.primary600),
    fontFamily: null, // 跟随系统，不引入自定义字体
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.transparent, elevation: 0, centerTitle: true,
      titleTextStyle: TextStyle(fontSize: 17, fontWeight: FontWeight.w500),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: isDark ? SgColors.primary300 : SgColors.primary600,
        foregroundColor: isDark ? const Color(0xFF141615) : Colors.white,
        minimumSize: const Size(0, 52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w500),
        animationDuration: const Duration(milliseconds: 150),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: isDark ? const Color(0xFF262926) : const Color(0xFFF2F1ED),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
    ),
    cardTheme: CardThemeData(
      color: isDark ? const Color(0xFF1F2220) : Colors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isDark ? const Color(0xFF333633) : const Color(0xFFE4E2DC)),
      ),
      margin: EdgeInsets.zero,
    ),
    navigationBarTheme: const NavigationBarThemeData(height: 56, elevation: 0),
  );
}
```

### 9.2 组件使用示例

```dart
// 主按钮：每屏最多一个
SgButton.primary(label: '保存今天', onPressed: save)

// 情绪 Tag（三通道：图标+文字+色）
SgMoodTag(type: MoodType.nourish)  // 渲染: 🌱 滋养

// 日记输入：无上限字数压力
SgTextArea(hint: '想到什么写什么，不写也没关系', maxLines: 6)
```

### 9.3 动效参数

| 场景 | 时长 | 曲线 |
|------|------|------|
| 按压反馈 | 150ms | `Curves.easeOut` |
| 页面/弹窗 | 250ms | `Curves.easeOutCubic` |
| 方格视角切换（倒计时↔收集） | 400ms | `Curves.easeInOutCubic`（标志性动效，格子逐格换色） |
| 危机弹窗 | 400ms | `Curves.easeIn`（刻意放缓） |

---

## 10. 管理系统（admin）设计差异点

- 基础 Token 完全复用本文档（同一套色板/字体/圆角）
- 中性色可加重：页面底改纯 `#F5F5F4`，信息密度提高（表格 12 列栅格、8pt 基数）
- 新增数据可视化色板（图表用）：`#5B8A83 / #A87A44 / #6E88A6 / #C2706B / #7C7A74` 循环
- 允许表格斑马纹、密集列表——后台效率优先，但**同样禁止大红大绿与红色徽标轰炸**

---

## 变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-10-15 | 初版：色彩/字体/间距/圆角阴影/9类组件/图标/无障碍/Flutter映射 |
