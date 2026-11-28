# Life Atlas 离线识图组件

识图使用 Tesseract.js Core 7.0.0 的 LSTM WebAssembly 构建。Life Atlas 通过 Tesseract API 在独立工作线程中处理图片，语言模型及引擎均随安装包提供。用户选择的图片和屏幕选区只在内存中处理。 [Tesseract.js Core v7.0.0](https://github.com/naptha/tesseract.js-core/tree/v7.0.0)

`eng.traineddata` 和 `chi_sim.traineddata` 来自 Tesseract 官方 `tessdata_fast` 4.1.0。模型授权为 Apache-2.0，原文见 `tessdata-LICENSE.txt`。 [官方模型](https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0)

| 模型 | SHA-256 |
| --- | --- |
| `eng.traineddata` | `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2` |
| `chi_sim.traineddata` | `a5fcb6f0db1e1d6d8522f39db4e848f05984669172e584e8d76b6b3141e1f730` |

同目录包含 WebAssembly 上游及其编译组件的许可。软件中包含 IJG libjpeg 项目代码。 [引擎依赖版本](https://github.com/naptha/tesseract.js-core/tree/v7.0.0/third_party) [Emscripten 4.0.15](https://github.com/emscripten-core/emscripten/tree/4.0.15)
