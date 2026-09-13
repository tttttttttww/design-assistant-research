# Design Thinking + GenAI Help-Seeking Research Platform v11

用于12课时设计思维课程与生成式AI学业求助研究的数据采集平台。

## 本版核心变化

- 固定学生编号：S01-S30；S00为教师测试号。
- 编号后续分组不改变，只更新 `condition`：A=支持型AI，B=自由AI。
- 12课时任务全部加入配置，教师后台可逐课预览并切换当前课次。
- AI不再等“先完成第一版”后才解锁：有AI的课次从任务开始就可由学生自行打开。
- 自动记录：任务开始、首次打开AI、首次发送AI消息、各自时延、AI打开次数、完整聊天、图片、文字、提交时间与事件日志。
- 注意：`first_user_message_at` 是“首次发送给AI的消息”，不自动等同于“首次学业求助”。正式的 `first_help_request` 应在后续行为编码后确定。
- W4-W9：A组自动路由到支持型AI，B组路由到自由AI；学生界面不显示组别。
- W10-W11：撤除实验性支持，两组都自动回到同一个自由AI。
- W2/W10/W11任务目前标记为“候选”，方便你先看平台形态，正式研究前可在 `src/config/researchConfig.js` 一处替换。
- W2/W12问卷只留接口和位置，不提前放未冻结题项。

## 12课时默认配置

W1 椅子快速设计挑战（pilot，自由AI）
W2 正式基线设计任务（候选，自由AI；任务后前测问卷待接入）
W3 辅助绘画装置：理解使用者（自由AI）
W4 构思方案（A支持型/B自由AI）
W5 制作V1（A支持型/B自由AI）
W6 测试V1（A支持型/B自由AI）
W7 制定修改计划（A支持型/B自由AI）
W8 制作V2（A支持型/B自由AI）
W9 V2测试与完成（A支持型/B自由AI）
W10 迁移任务一（候选，全部自由AI）
W11 迁移任务二（候选，全部自由AI）
W12 课程回顾与后测（无AI；后测问卷待接入）

## 数据导出

教师后台可下载：
- `participants.csv`：学生编号、年级、分组
- `session_records.csv`：12课时文字、时间、AI时机、图片元数据、提交记录
- `chat_messages.csv`：所有AI对话
- `events.csv`：任务开始、AI打开、上传、保存、发送、提交等事件
- `course_research_all.json`：完整原始数据
- `S00_test_archives.json`：测试号归档

## 求助时机的解释

平台自动给出：
- `first_ai_open_at` / `first_ai_open_latency_seconds`
- `first_user_message_at` / `first_user_message_latency_seconds`

其中“首次打开AI”只能说明进入AI界面；“首次发送消息”也不一定必然是学业求助。正式分析中，应先根据行为编码判断哪一条学生消息真正具有求助功能，再由消息时间戳计算正式的首次求助时延。

## 部署

见 `DEPLOY_FIRST.md`。

## Coze智能体

见：
- `COZE_FREE_AGENT_PROMPT.md`
- `COZE_SUPPORTED_AGENT_PROMPT.md`
