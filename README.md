# kMysql

一个基于 **Electron + React + TypeScript** 的桌面 MySQL 客户端，面向日常开发与运维场景，提供连接管理、对象浏览、SQL 查询、数据编辑与导入导出能力。

## 功能特性

- 🔌 **连接管理**
  - 支持多连接配置与快速切换
- 🗂️ **对象浏览**
  - 数据库 / 表 / 视图树形浏览
  - 对象右键菜单操作（新建查询、结构/数据导出等）
- 🧠 **SQL 查询**
  - 多标签查询窗口
  - 常见 SQL 编辑与执行流程
- 📊 **数据浏览与编辑**
  - 表数据分页浏览
  - 单元格编辑、批量行选择、批量删除
  - `Ctrl/Cmd + A` 全选复选框行（用于批量操作）
- 📥 **SQL 导入**
  - 对象页拖拽导入 `.sql`
  - 导入进度提示与失败原因汇总
- 📤 **SQL 导出**
  - 支持结构导出、结构+数据导出
  - 导出格式尽量贴近 Navicat 风格，便于互导
- 📦 **跨平台打包**
  - Windows: `nsis` + `portable`
  - macOS: `dmg`
  - Linux: `AppImage` + `deb`

## 技术栈

- Electron
- React
- TypeScript
- electron-vite
- mysql2
- Zustand

## 本地开发

> 推荐 Node.js 20+

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

等价命令：

```bash
npx electron-vite build
```

## 本地打包

```bash
npm run dist
```

## GitHub Actions 打包（推荐）

项目默认通过 GitHub Actions 打包发布。

当需要发版时：

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

推送 tag 后会自动触发 `.github/workflows/build.yml` 进行多平台构建与 Release 产物发布。

## 项目结构（核心目录）

```text
src/
  main/        # Electron 主进程（IPC、服务）
  preload/     # preload bridge
  renderer/    # React 前端
.github/
  workflows/   # CI/CD 工作流
```

## 常用脚本

- `npm run dev`：启动开发环境
- `npm run build`：构建主进程 / 预加载 / 渲染进程
- `npm run pack`：生成未打包目录
- `npm run dist`：生成安装包

---

如需补充截图、使用示例或 FAQ，可在后续版本继续扩展 README。
