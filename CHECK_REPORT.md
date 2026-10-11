# v11.41 检查报告

检查日期：2026-10-10

已执行并通过：

- `npm run check`
- `npm test`
- `node --check`（src / public/js / cloud-functions / scripts 全部JS/MJS）

关键核对：

1. W2 普通AI、自主使用；W3共同准备且不是正式干预。
2. W4–W9实验组为支持型AI，对照组为普通AI；W10–W11两组均回到普通AI。
3. 实验组每轮先内部路由 `IHS / EHS / OTHER`，EHS才触发 `executive_help_restructure`。
4. 支持型AI机器标记会在服务器端剥离，学生端不显示；缺失/错误标记会记录为 `UNRESOLVED`/解析状态，不伪造分类。
5. `agent_route / scaffold_triggered / scaffold_type / route_parse_status` 被保存在聊天与事件导出中；明确仅用于干预执行/fidelity，不等于正式人工编码。
6. W7个人回看优先选取本人真实EHS候选和IHS候选，学生端不显示分类标签；不足时回退到最近真实query。
7. 已有AI草稿过程记录保留：开始输入、删除未发送、离开未发送、最终发送；未发送正文不保存。
8. 正式导出将删除/离开未发送标记为 `potential_unsent_help_event=1`，不自动等同AHS。
9. 问卷候选模块默认关闭；S04/S05固定B对照组；教师手动分组调整机制保留。
10. 对照组不设置固定字数/固定三点等人为输出限制。

部署注意：ZIP不包含 `node_modules`。上线前需 `npm install`，配置环境变量，并把 `COZE_SYSTEM_PROMPTS_READY_TO_PASTE.md` 中最新两份系统提示词同步到对应Coze Bot。
