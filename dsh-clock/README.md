# dsh-clock（悬浮时钟）

A small draggable floating clock plugin for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness).

DeepSeek Harness 网页端内的可拖动悬浮时钟插件。

Repository / 仓库: <https://github.com/HuiLiYi-Cute/dsh-clock>

## Features / 功能

- Current time, weekday and date / 显示当前时间、日期星期
- Stopwatch (count up) / 正计时
- Countdown timer / 倒计时
- Alarm clock with optional daily repeat and custom reminder text / 闹钟（可选每天重复、自定义提醒内容）
- **Only one** of stopwatch / countdown / alarm can run at a time / 正计时、倒计时、闹钟同时只能运行一个
- Auto-collapses into a pill after 5s idle; the pill alternates between the current time and the running task every 10s / 5 秒不触碰自动小化为胶囊，每 10 秒轮流显示当前时间与正在执行的计时/闹钟
- Draggable anywhere, position persisted / 可自由拖动，位置持久化
- Panel colour: 8 presets or any custom hex (e.g. `#77DD77`), text automatically stays readable (dark text on light backgrounds, light text on dark ones, WCAG AA) / 面板配色：8 个预设或任意十六进制自定义色，文字对比度自动保证可读
- Follows host theme tokens when set to “A”; light/dark aware / 选“A”时跟随应用主题，明暗自适应
- zh-CN / en UI / 中英文界面

## Install / 安装

In DSH, open **Plugins → Discover** (with this package in your market index), or install directly:

```
pnpm add dsh-clock        # once published to npm
```

In the Plugin Manager, install from a git checkout:

```
plugin_manager: install_bundle, target: <path or package spec of dsh-clock>
```

Then refresh the DSH web page — the clock appears (bottom-right by default).

Settings entry: **Settings → 悬浮时钟设置 / Floating clock** tab.

## Development

Plain JavaScript ESM, no build step:

| File | Purpose |
|---|---|
| `index.js` | Host half (activation no-op) |
| `client.js` | Client half: React component registered into `shell.overlay` + settings page into `settings.section` |
| `cordis.patch.yml` | Bundle patch inserting the plugin row |
| `locale/*.json` | Display metadata (title/description shown in Plugin Manager) |
| `icon.svg` | Plugin icon |

State is persisted in `localStorage` (`dsh.floating-clock.*`); nothing touches the network.

## License

MIT
