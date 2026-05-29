# GitHub Pages 部署说明

这个项目是纯静态网页，可以直接部署到 GitHub Pages、Cloudflare Pages、Vercel 或 Netlify。

推荐 GitHub Pages：

1. 在 GitHub 新建一个仓库，例如 `left-hand-rule-camera-demo`。
2. 在本地项目目录执行：

```powershell
git remote add origin https://github.com/你的用户名/left-hand-rule-camera-demo.git
git branch -M main
git push -u origin main
```

3. 打开 GitHub 仓库的 `Settings` -> `Pages`。
4. `Build and deployment` 选择 `Deploy from a branch`。
5. Branch 选择 `main`，目录选择 `/root`，保存。
6. 等待部署完成后，GitHub 会给出一个 HTTPS 链接。

注意：

- 手机和 iPad 需要通过 HTTPS 链接访问，摄像头权限才能稳定工作。
- 当前项目已内置 MediaPipe、wasm、Three.js 和手部识别模型，不依赖 jsDelivr/unpkg。
- 不要把历史 zip 包或 `_package-*` 临时目录提交到 Git。
