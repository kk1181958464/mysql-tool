# MySQL 连接工具

## 项目信息
- Electron + React + TypeScript + electron-vite
- 包管理：npm
- 构建：`npx electron-vite build`
- 开发：`npx electron-vite dev`

## 打包
- 打包默认指 GitHub Actions 打包（`.github/workflows/build.yml`）
- 推送 tag 自动触发：`git tag v1.0.0 && git push origin v1.0.0`
- 也可在 GitHub Actions 页面手动触发 workflow_dispatch
- 产物：Win(nsis+portable) / Mac(dmg) / Linux(AppImage+deb)

## Git
- 代理：`http://127.0.0.1:7890`
- 仓库：https://github.com/kk1181958464/mysql-tool
