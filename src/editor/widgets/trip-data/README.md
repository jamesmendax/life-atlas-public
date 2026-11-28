# 旅行组件的离线地图与路线

`amap-coverage.json` 是 Natural Earth 1:110m Admin 0 Countries 的 CHN 面，用于离线判断高德导航入口的覆盖范围。足迹和行程使用同一次转换生成的 WGS84 简化边界。来源固定在 natural-earth-vector v5.1.2，输入 SHA-256 和可复现命令见足迹包署名。几何为公共领域。[Natural Earth 源文件](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_110m_admin_0_countries.geojson) · [使用条款](https://www.naturalearthdata.com/about/terms-of-use/)

`place-labels.json` 的城区、河流与道路标注取自下述同一地图快照，与区域道路数据一起以 ODbL 1.0 提供。

`regional-streets.json` 包含关西、京都和成都三个局部地图。道路、铁路、水系和绿地取自 OpenFreeMap 的 2026-11-22 OpenMapTiles 快照。每条线使用 precision 5 的 encoded polyline，解码后是 WGS84 纬度、经度。区域边界采用西、南、东、北顺序。原始快照的 URL 模板随数据保存。数据版权归 OpenStreetMap 贡献者，区域数据库以 ODbL 1.0 提供。制图数据由 OpenFreeMap 和 OpenMapTiles 提供。[OpenStreetMap 数据许可](https://www.openstreetmap.org/copyright) · [OpenFreeMap](https://openfreemap.org/quick_start/) · [OpenMapTiles](https://openmaptiles.org/)

`example-routes.json` 收录 2026-11-25 按行程公开示例坐标逐次向 FOSSGIS 的 OSRM 服务取得的道路路线。京都和旧版成都四站样例包含驾车、骑行、步行三种方式，大阪、奈良和成都样例第二天包含驾车路线。四站成都快照也可在保留了对应站名、坐标和先后顺序的旧版行程中查看。每一段分别保留服务返回的道路距离、模型预计耗时及简化后的道路轨迹。底层开放道路数据采用 ODbL 1.0，用户可以从本目录取得机器可读版本。[FOSSGIS 路线服务](https://routing.openstreetmap.de/about.html) · [OSRM Route API](https://project-osrm.org/docs/v5.24.0/api/#route-service)

`chengdu-transit.json` 是于 2026-11-25 整理的成都局部公交地铁线网。它覆盖 87 路及地铁 2、3、4、5 号线在四站样例附近的部分区间。来自同一线路的上下车点、各方向轨迹和实际通行方向独立核对。它支持对资源内的 WGS84 坐标重新组合、按各自的方向行驶或换乘。坐标使用五位小数匹配。此文件保留四站样例的实测路网接驳；其他坐标通过下述城市轨道网络寻找临近车站。样例路线按保存坐标查询，熊猫基地起点包含前往公交站的园区接驳步行。路线只在有轨迹的部分绘制，线路平台和站点标注之间可能有地理位置差异。数据源未提供站内步行轨迹。

- 87 路使用 Wang 等的 **China Public Transport Operation Network Dataset (CPTOND-2025)** 公交线网（2025-06，CC BY 4.0）。成都熊猫基地官方出行说明列明公交 87 路与地铁 3 号线的动物园站换乘。408 路是熊猫大道站的另一条接驳选择。选用 87 路的往返方向分别来自开放数据，不混用 408 路的轨迹。[CPTOND-2025 数据及署名](https://doi.org/10.6084/m9.figshare.29377427.v2) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) · [熊猫基地官方出行方式](https://www.panda.org.cn/cn/service/transit/) · [87 路站序](https://chengdu.8684.com.cn/x_2a59fea4)
- 地铁几何取自 OpenStreetMap 贡献者的路线关系（ODbL 1.0，2026-10）。两类线网的输入文件由 Chengdu Public Transport 地图公开汇整。用各方向轨迹在上下车站投影处裁剪，计算简化前折线的地理长度，再将其简化为精度为 5 的 encoded polyline。步行接驳来自按方向查询取得的 FOSSGIS / OSRM 路网，保留服务返回的距离和耗时。[成都公共交通地图](https://agcghub.github.io/chengdu-bus-map/) · [输入轨迹](https://agcghub.github.io/chengdu-bus-map/data/gtfs-shape.geojson) · [输入站点](https://agcghub.github.io/chengdu-bus-map/data/stops.geojson) · [OpenStreetMap 许可](https://www.openstreetmap.org/copyright) · [高德成都线网和站序](https://amap-pc-ssr.amap.com/ssr/subway/chengdu-5101)
- 乘车时间用于估算。87 路两个方向采用当地报道的动物园至熊猫基地约 15 分钟作为参考。地铁按线路站序，以相邻站间约 2 分钟计算。步行沿路网计时。旅行规划按下述模型另计候车和站内换乘。需要按日期和出发时刻查线路时，可使用站距详情内的外部地图入口。[87 路参考乘车时间](https://news.chengdu.cn/2026/0213/698ec4e4bda5fc6bcf809ad7.shtml) · [地铁按站估算参考](https://www.ditie.site/chengdu/shenxianshu-go-zhongyidashengyiyuan)
- 开放输入快照的 SHA-256。轨迹为 `9cb55c4866cdcc94310dc06d8bbda8f7ead016a5e75af9ec2b963fe31b646114`。站点为 `48e7efe30d187d71aa6b30a2aae4e5680fa831697ff8e9b58e87fb9911f03180`。

公共 FOSSGIS / OSRM 没有公交地铁班次。Transitous 的中国源仅包含国铁，公开免费接口默认面向开源非商用项目。高德路线规划 Web API 可返回公交地铁线路编号、上下车站、换乘步骤、耗时和轨迹，调用需要开发者账号及 Web 服务 Key。配有高德 Web 服务 Key 的设备还可以在高德覆盖城市查询具体两站的方案。[FOSSGIS 支持方式](https://routing.openstreetmap.de/about.html) · [Transitous 中国源](https://github.com/public-transport/transitous/blob/main/feeds/cn.json) · [Transitous API 使用政策](https://transitous.org/api/) · [高德路径规划 API](https://lbs.amap.com/api/webservice/guide/api/newroute)

## 旅行规划的地点与公交数据

`chengdu-rail.json` 取自上述成都公共交通地图的 2026-10 方向轨迹与站点。它覆盖 16 条数字编号地铁线、34 个运行方向（含支线）、361 个参与规划的车站及 906 个有方向的站间区间。两向轨迹分别处理，闭环沿数据内的实际环线相连。区间按源站点在线路上的投影裁剪。文件中的折线与站点采用 WGS84、ODbL 1.0；开放数据库可直接从本目录取得。支线和线路方向按各段运营方向显示。[成都公共交通地图与来源](https://agcghub.github.io/chengdu-bus-map/) · [OpenStreetMap 数据许可](https://www.openstreetmap.org/copyright)

`chengdu-pois.json` 包含 5,826 条来自成都城区及周边部分区域的命名地点。每条记录依次为名称、WGS84 纬度、经度、来源别名、地图分类。数据取自 2026-11-22 OpenFreeMap/OpenMapTiles 的 13、14 级矢量瓦片 POI 图层，瓦片编号与 SHA-256 保存在项目验收记录。机场、商家和郊区覆盖程度随快照及抽取范围而异。离线搜索也包括成都轨道站、关西区域地名和内置行程地名。署名为 © OpenStreetMap contributors，成都地点数据库以 ODbL 1.0 提供。[地图数据来源](https://openfreemap.org/quick_start/) · [OpenMapTiles POI 图层](https://openmaptiles.org/schema/#poi) · [ODbL 许可](https://www.openstreetmap.org/copyright)

**离线耗时。** 城市轨道规划按分钟估算，以每小时 35 公里折算站间用时，单区间最少 60 秒。每次乘车另加地铁 3 分钟或公交 5 分钟候车时间，直接换乘另一条轨道服务另加 3 分钟站内步行。旧四站公交和道路接驳使用上文所列的路网、车程和站距数据。任意地图点会在 1,500 米半径内考虑最多四座邻近车站，接驳按直线距离 × 1.35、步速 1.2 米/秒估算。仅对有来源折线的区间绘制轨迹。线路之间或相邻行程点允许局部缺失，园区封闭、过街限制、运营时段和当日拥挤可能影响可行性与耗时。可公开取得的成都运营报告描述全网运营及部分高峰时段间隔，未提供这些行程的逐站实时发车/到站数据。[成都轨道运营报告](https://static.sse.com.cn/disclosure/bond/announcement/company/c/new/2026-04-13/244941_20260413_XWRA.pdf)

**联网查询。** 已配置本机高德 Web 服务 Key 时，中国大陆的地点、驾车、骑行、步行和公交分别使用对应接口。地点结果保留行政区、类型、POI ID 和服务提供的入口。默认全国搜索，填写城市后可限定在线搜索范围。用户在候选中选择具体地点或入口。公交按分段计划出发时刻请求，基于中国当地日历处理跨日，可查看提供方返回的各个方案。总时长取提供方返回的预计秒数，缺少的分步耗时保持空值。高德坐标为 GCJ-02，行程路网使用近似反算的 WGS84。[高德搜索 POI 2.0](https://lbs.amap.com/api/webservice/guide/api/newpoisearch) · [高德路径规划 2.0](https://lbs.amap.com/api/webservice/guide/api/newroute)

**长途路线。** 每次最多处理 100,000 个由服务返回的轨迹点。连续的道路折线按最多 20,000 点分块，相邻块共享边界点。原有断点保留。起终点或路线内部断口超过 250 米时显示接驳提示，目的地抵达时间显示为未计算。

**离线路网。** 在「设置 → 地图服务」选择官方 BRouter 1.7.10 文件夹、可用的 Java 17 或更新版本，并导入 `.rd5` 数据。也可以在行程的「离线路网」中按起终点和途经站下载区域文件。准备好后，选择「离线」即可在本机重新计算驾车、骑行和步行。分片提供道路计算数据，离线底图沿用已随包提供的区域街图及地形。[BRouter 官方源](https://github.com/abrensch/brouter/releases/tag/v1.7.10) · [官方路网文件](https://brouter.de/brouter/segments4/) · [OpenStreetMap 数据许可](https://www.openstreetmap.org/copyright)

**高德底图预览。** 地图服务设置接受独立的高德 Web 端 JS Key 和安全密钥。桌面端在隔离的高德底图窗口中传入当前选中路段的折线。能否加载取决于该 Key 对本机预览地址的授权。[高德 JS API 安全密钥](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode) · [高德域名验证公告](https://lbs.amap.com/news/initialization_amap)

未配置高德时，用户可以点击联网搜索向 Nominatim 提交一个公开地点关键词和可选地区。输入时只搜本地。本机工作区共享冷却时间与缓存，识别请求的 User-Agent 标出本项目和联系地址，结果显示 OpenStreetMap 署名。高德失败保留本地结果，不自动改用另一家服务。公共 Nominatim 适合少量、手动查询，大规模部署可在用户设备上配置高德，或由部署者安排有容量和政策许可的服务。[Nominatim 使用政策](https://operations.osmfoundation.org/policies/nominatim/) · [OpenStreetMap 数据署名](https://www.openstreetmap.org/copyright)

区域以外的离线世界概览使用项目已有的 Natural Earth 陆地数据。在线街道底图只响应用户的地图视野，通过具有 HTTP 缓存的独立 Electron 会话按需请求 OpenStreetMap 公共瓦片。用户主动查询行程时请求一次 FOSSGIS，限当前客户端每秒最多一次。公共服务面向低流量使用。大规模分发应安排有容量保障的服务或自托管。[OSM 瓦片使用政策](https://operations.osmfoundation.org/policies/tiles/) · [FOSSGIS 使用说明](https://routing.openstreetmap.de/about.html)

Google 和 Apple 地图按当前方式打开对应的两点路线。高德 PC 路径接口使用 GCJ-02，成都示例的七组坐标通过官方单点标注的 WGS84 模式核对。其他国内终点以高德支持的 WGS84 标注方式打开，用户可以在地图内选择出发地。高德 PC 路径 URI 的骑行模式仅在移动端有效。[高德标注坐标系](https://lbs.amap.com/api/uri-api/gettingstarted) · [高德路线 URI](https://lbs.amap.com/api/uri-api/guide/travel/route) · [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started) · [Apple Maps URLs](https://developer.apple.com/documentation/mapkit/unified-map-urls)

## 旅行地图底图

离线地形采用 Natural Earth Gray Earth with Shaded Relief, Hypsography, and Flat Water（1:50m，v3.2.0，公共领域）。原始等距经纬度栅格经 Web Mercator 重投影、缩小并编码为 WebP，纬度显示限制为南北 85°。该层展示概略地形，精细街道使用用户开启的 OpenStreetMap 视野瓦片。[原始地形](https://www.naturalearthdata.com/downloads/50m-raster-data/50m-gray-earth/) · [Natural Earth 使用条款](https://www.naturalearthdata.com/about/terms-of-use/)

省级和地级等轮廓复用本项目按区划码筛选、简化和编码的地图数据。Rui Cheng、Chiwei Xiao、Yanjun Wang、Yunfeng Hu，*CTAmap: A continuous vector dataset of Chinese administrative divisions from 2000 to 2026*，v2.0，CC BY 4.0。香港区界及世界轮廓来自 Natural Earth。地图按真实 WGS84 地理位置显示，标注点为地区代表点。细放后经纬网用于离线坐标定位。[CTAmap](https://doi.org/10.5281/zenodo.22179207) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) · [Natural Earth 世界边界](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_110m_admin_0_countries.geojson)

## 全国地名和按编号查公路

`china-places.json` 含中国大陆 31 个省级地区的 7,088 条离线搜索记录。2,851 个县级区划来自 Rui Cheng、Chiwei Xiao、Yanjun Wang、Yunfeng Hu 的 **CTAmap v2.0**，采用 2026 年 1 月 1 日年度图层的名称和代码。坐标取县级面最大主体内部的代表点，适合定位到县域。图层原文件 `T2026_county.gpkg` 的 SHA-256 是 `4c7f4cfed6ff0bf96ed569ef3a653bc19506c4e95781349b201084349a19c980`。[CTAmap 数据及署名](https://doi.org/10.5281/zenodo.22179207) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

其余 4,237 条取自 **GeoNames**。抽取 WGS84 城市和县城驻地点、省级和地级行政代表点及数据内有中文名的部分机场、车站、广场、城门等地点，用简体中文名及原始拼写建立索引。地名库的行政标签和地点年份随来源记录而异。查询具体街道、门牌和未收录商户时，可以手动使用联网地点搜索。2026-11-25 获取的 `CN.zip` SHA-256 为 `dcaefcb5cfe82037bf2cf2ff18b822beb495d1c694fc45333e172c579c65843f`，分国异名文件 `alternatenames/CN.zip` 为 `7d08c1b7c70955590d1141cea0fa81bf1204192300c082a130a4a7425654e0ac`。[GeoNames 地名库](https://www.geonames.org/) · [字段和授权](https://download.geonames.org/export/dump/readme.txt) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

用户按公路编号查途经点时，查询所选位置周围 12 公里，按需读取 OpenFreeMap 生产地图的当期快照。在 OpenMapTiles 的 `transportation_name` 层按 `ref` 或共线关系的 `route_n_ref` 精确匹配，最多同时读取四张图块，再将所选位置投影到匹配的道路折线上。结果是 OSM 中有相应编号的地图途经点。编号缺失、短路段未出现在该比例尺、该范围内无相应公路等情况可能返回空结果。OpenFreeMap 和 OpenMapTiles 提供制图服务，路网版权归 OpenStreetMap 贡献者，ODbL 1.0。[OpenFreeMap 使用规则](https://openfreemap.org/quick_start/) · [OpenMapTiles 路网字段](https://openmaptiles.org/docs/schema/#transportation_name) · [OSM 数据许可](https://www.openstreetmap.org/copyright)

驾车候选来自 OSRM 或用户选择的高德 Web 服务。指定路号时，在返回的候选中按明确标识该公路的路程占比挑选。OSRM 使用分步导航的道路编号或道路名称，高德使用 `road_name`，按步骤距离和对应几何计算可核验部分。通行方向、道路施工和限行状况以出行时的导航服务为准。未匹配部分仍保留为普通驾车路径。运营方可通过 `LIFE_ATLAS_OSRM_BASE_URL` 指向提供相同 `/routed-car`、`/routed-bike` 和 `/routed-foot` 前缀的自托管 HTTPS 服务。无 Key 的公共服务只由用户主动查询触发。[OSRM Route API 和 RouteStep](https://project-osrm.org/docs/v5.24.0/api/) · [FOSSGIS 服务说明](https://routing.openstreetmap.de/about.html) · [高德路径规划 2.0](https://lbs.amap.com/api/webservice/guide/api/newroute)
