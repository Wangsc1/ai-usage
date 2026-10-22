# 离线回归测试

需要 Node.js 18+、TypeScript 5.9.3。测试配置与依赖仅放在 `tests/`，不改变 Scripting 根目录入口。

## 执行

在项目根目录安装精确版本的测试依赖后运行：

```sh
npm install --prefix tests --ignore-scripts --no-audit --no-fund
node tests/run.cjs
```

也可复用现有 TypeScript 安装，无需在项目安装依赖：

```sh
TYPESCRIPT_PATH=/absolute/path/to/typescript node tests/run.cjs
```

该路径必须指向可由 Node `require` 加载的 TypeScript 模块目录或入口文件，不固定依赖任何 `/tmp` 路径。可通过同样的环境变量单独运行 `node tests/mock.cjs` 等套件。

`run.cjs` 为各套件创建独立进程，即使某套失败也继续执行其余套件，最终以非零状态报告失败。不把最后一个命令成功或部分 PASS 当作完整通过。

## 边界

- 全部服务响应、Keychain、Storage、HTTP listener、WebView 都是内存模拟，仅执行生产 TS/TSX；不读取真实登录、不绑定真实端口、不调用外网业务。
- `mock.cjs` 覆盖组合数据、Codex/Claude协议、Sub2API、DeepSeek及组件/App入口；其他专项独立覆盖账号可见性、Antigravity、导航、WorkBuddy、清理、轮换保存恢复、刷新/渲染计数及详情单账号刷新。轮换恢复和详情请求隔离测试独立于布局断言运行。
- Keychain保存失败测试覆盖返回false和抛异常、反复失败、候选过期、并发、来源/凭据变化、退出/重新登录与迟到响应；候选不写Storage。
- 小组件稳定性专项执行真实run入口：15秒预算超时回退、网络拒绝/永不完成/统计卡住、Keychain/Storage/设置抛错、畸形缓存与损坏凭据兜底、intent注册失败、来源切换/迟到隔离、单次present与诊断脱敏。
- 详情专项执行真实右上按钮，覆盖各来源已支持服务的目标请求数、其他账号／统计零请求、失败保旧、busy、并发合并与迟到保护，以及七种组件入口缓存同步不联网；Parrot DeepSeek未核实单频道接口时明确阻塞且零请求。
- 计数测试验证多账号单次渲染的凭据/排序读取不随行数增长，以及来源切换/删除一次重载、主动刷新不被TTL抑制；不代表真机耗时或系统组件调度次数。
- JSX树和布局预算不是原生字体、像素、手势、生命周期或真实服务兼容性证明；这些仍需设备验收。
- 可选的历史树比较仅在显式提供各测试声明的 baseline 环境变量时执行。缺少历史快照不会伪造比较通过，也不依赖机器私有历史源码完成正常测试。
