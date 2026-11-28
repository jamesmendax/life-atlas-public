# 足迹地图的边界与许可

中国地图的现行图层有 477 个可点亮地区，包括地级行政区、部分省直辖县市、四个直辖市的区县、香港 18 区、澳门 7 个堂区及路氹填海区。台湾使用整体边界。原重庆江北区和渝北区的 2025 年历史边界另存，原有旅行手记可以按旧名称或代码打开。

## 中国省、地、县边界

Rui Cheng、Chiwei Xiao、Yanjun Wang、Yunfeng Hu，*CTAmap: A continuous vector dataset of Chinese administrative divisions from 2000 to 2026*，v2.0，2026-09-01。作者以 CC BY 4.0 发布成品省、地、县图层。使用、改编和再分发这些数据时，请保留作者、版本、来源、许可证和改动说明。作者的发布说明将构建过程中使用的原始村镇图层排除在数据包之外。本组件读取作者发布的成品 GeoPackage。[数据集与 DOI](https://doi.org/10.5281/zenodo.22179207) · [作者随附许可说明](https://zenodo.org/api/records/22179207/files/README.md/content) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

Life Atlas 按六位区划码选择 `T2026_province`、`T2026_prefecture`、`T2026_county` 三层。年度图层表示当年 1 月 1 日状态。原江北区（500105）和渝北区（500112）来自 `T2025_county`，各自保留原码和历史轮廓。2026 年图层中的两江新区（500157）有独立手记。海南省的离岛按原经纬度绘入标明「南海诸岛」的插图。[作者的版本说明](https://www.shengshixian.com/pages/9f2c41/)

## 世界、日本和香港

Natural Earth Admin 0 Countries 1:110m 提供世界 176 个国家和地区的轮廓，使用仓库 v5.1.2 中的固定文件。其 1:10m Admin 1 States, Provinces 数据包 v5.1.1 提供日本全部 47 个都道府县和香港 18 个区。日本由 ISO 3166-2 代码对应旧手记，香港逐一依据 HASC 地区代码匹配旧 ID。世界底图沿用此比例尺的数据表达，南极洲在版图范围外。Natural Earth 将其地图数据置于公共领域，明确允许修改和电子再分发。[世界数据](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_110m_admin_0_countries.geojson) · [一级行政区数据](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/) · [Natural Earth 使用条款](https://www.naturalearthdata.com/about/terms-of-use/)

## 澳门独立数据

© OpenStreetMap contributors。澳门的七个堂区及路氹填海区采用 OpenStreetMap 的八个边界关系，由 mini-macau 于 2026-09-10 提取。本组件使用该项目固定提交中的几何，保留关系 ID，简化坐标并扣除嘉模堂区同路氹重叠的面积。澳门衍生数据库以 Open Database License 1.0（ODbL）单独提供。[原始提取文件](https://github.com/asdfghj1237890/mini-macau/blob/73464205e99e782d8f1d9b0e8622ac3e681e3193/public/data/parishes.json) · [提取方法](https://github.com/asdfghj1237890/mini-macau/blob/73464205e99e782d8f1d9b0e8622ac3e681e3193/data/scripts/fetch_parishes.py) · [OpenStreetMap 版权](https://www.openstreetmap.org/copyright) · [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)

公开分发的完整澳门 GeoJSON 在足迹包内的 `assets/maps/macau-parishes.json`。可用 ZIP 工具打开 `.atlaspack` 提取，也可从组件内「地图范围与数据来源 → 查看并复制澳门边界 GeoJSON」读取。对应源码为 `src/editor/widgets/footprint-data/macau-parishes.json`。包内 `assets/licenses/cc-by-4.0.txt` 和 `assets/licenses/odbl-1.0.txt` 提供许可证全文。

## 复现

从项目根目录运行以下命令。下载约 180 MiB，上游文件进入指定缓存目录，生成的地图随可选组件发布。

```sh
uv run scripts/generate-footprint-boundaries.py --cache-dir .qa/footprint-geometry-inputs-v2
```

脚本为每个输入固定 URL 和 SHA-256，并固定 Shapely 和 PyShp 版本。可加 `--output-root <目录>` 生成独立树后比较。Life Atlas 从 WGS84 面选取可见岛屿、保留孔洞，按图层比例简化并舍入至 3–5 位小数，在主要多边形内部重新计算标记位置。非澳门图层使用整数增量编码；澳门保持标准 GeoJSON。行程组件中用于筛选高德入口的轮廓由同一 Natural Earth CHN 面直接生成。景点与旧 ID 的对应另见 `chinaLandmarks.js`，省市与都道府县的界面简称见 `scripts/footprint-display-names.json`。
