# 第三方组件声明

本项目（WordSearch）采用 MIT 许可证，详见 [LICENSE](LICENSE)。

本声明列举项目引用或分发的第三方开源组件及其许可证。各组件版权归其作者所有，适用各自的许可条款；本项目仅保留必要声明，不修改其许可证。

## 数据与模型

| 组件 | 用途 | 许可证 | 版权 | 说明 |
|---|---|---|---|---|
| [ECDICT](https://github.com/skywind3000/ECDICT) | 英汉词典数据（约 77 万词条） | MIT | Copyright (c) 2017 Linwei | 原始数据 `data/ecdict.csv` 与本地库 `data/ecdict.db` 由使用者自行下载/构建，不随仓库分发；随仓库分发的 `data/vectors_common.db` 为其衍生数据 |
| [BGE-M3](https://github.com/FlagOpen/FlagEmbedding) | 多语言向量化模型 | MIT | © BAAI / FlagOpen 项目 | 模型权重由使用者运行时从 HuggingFace 下载，不随仓库分发；`data/vectors_common.db` 为其模型产出的向量数据 |

## 运行时依赖（通过 pip 安装，不随仓库分发）

| 组件 | 许可证 |
|---|---|
| [fastapi](https://github.com/fastapi/fastapi) | MIT |
| [uvicorn](https://github.com/encode/uvicorn) | BSD-3-Clause |
| [sqlite-vec](https://github.com/asg017/sqlite-vec) | MIT / Apache-2.0（双许可） |
| [starlette](https://github.com/encode/starlette) | BSD-3-Clause |
| [pydantic](https://github.com/pydantic/pydantic) | MIT |

## 构建向量库的依赖（在其他设备上安装使用）

| 组件 | 许可证 |
|---|---|
| [sentence-transformers](https://github.com/UKPLab/sentence-transformers) | Apache-2.0 |
| [PyTorch](https://github.com/pytorch/pytorch) | BSD-3-Clause |

## MIT 许可证全文（ECDICT 版权声明）

随仓库分发的 `data/vectors_common.db` 基于 ECDICT 数据（MIT 许可证）生成。按 MIT 许可证要求，保留其版权与许可声明如下：

```
MIT License

Copyright (c) 2017 Linwei

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
