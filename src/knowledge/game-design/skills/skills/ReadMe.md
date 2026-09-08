#游戏Demo框架

框架视图：
    ——————
        |——— scripts 游戏代码目录
            |——— scenes 游戏场景控制脚本目录
            |——— managers 游戏各种manager脚本目录
                |——— EventManager 事件管理mgr脚本 可以收发事件 事件唯一id在 EventEnum中定义 方便查看事件
            |——— handlers 游戏请求回调脚本目录
            |——— controls 游戏网络请求脚本目录
            |——— views  游戏界面脚本目录
            |——— components 游戏组件脚本目录
            |——— global 全局变量脚本
            |——— enums 全局枚举脚本目录
                |——— EventEnum  事件收发事件枚举
        |——— assets  游戏资源目录
            |——— textures 游戏图片资源目录
            |——— sounds 游戏声音资源目录
            |——— videos 游戏视频资源目录
            |——— prefabs 游戏预制体资源目录
            |——— maps 游戏地图数据目录
        |——— configs 游戏配置目录
        |——— libs 游戏插件相关目录
        |——— tools 游戏脚本目录
        |——— .md md文件 游戏相关描述