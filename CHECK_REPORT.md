# v11.22 检查要点

- 13周课程配置保留；W2统一 `free`，W3–W8 `condition`，W9–W11统一 `free`。
- W2继续作为共同普通AI试行课：无前测/分组门槛，学生至少实际使用1次AI，但不提示求助时机或求助策略。
- W2主任务为学校午餐体验课堂适配，储物柜为可选加练；两项均纯网页、零材料。W2聊天图片入口已关闭，只收文字对话。
- AI输入草稿记录开始/删除未发送/离开未发送/发送等元数据，不保存未提交草稿全文；保留 `chat_history_revisit` 回看旧回复事件。
- 任务文本版本历史保留 V1/V2/V3，并新增 `field_label`、`field_stage`，可关联最近AI回复及时间间隔。
- 每轮成功AI交互新增 `interaction_id`，并分别保存 `client_sent_at`、`server_received_at`、`ai_request_started_at`、`ai_response_received_at`、`ai_latency_ms`。
- 学生发送AI消息时同步保存最近正在处理的任务字段 `task_field_key / task_field_label / task_field_stage`；如果学生尚未点过某个文本框，前端会根据当前可见且尚未完成的任务字段做保守定位。
- “AI求助过程数据 ZIP”一次导出 `chat_messages.csv`、`behavior_events.csv`、`task_revisions.csv`、`process_timeline.csv` 和允许课次的聊天原图；`process_timeline.csv` 仅按时间合并原始证据，不做 IHS/EHS/AHS 自动判定。
- “任务记录 + 学生作品 ZIP”只保留 `task_records.csv` 和作品原图，避免和求助过程包重复。
- 正式问卷导出改为 W8 posttest-only：`questionnaire_posttest_raw.csv`。历史前测如曾测试，只留在完整JSON/后台，不进入当前正式分析。
- 普通AI与支持型AI共同加入事实约束：不得把任务资料未提供的数字、比例、时长、调查结果、效果量等编造成事实；缺证据必须明确说明。
- Blob 根前缀未改，已有 W1/W2 历史数据不会因代码部署自动删除。
- `npm run check`、`npm test`、关键 JS `node --check` 已通过。
