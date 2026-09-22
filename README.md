# Design Thinking + GenAI Help-Seeking Research Platform v11.22

## 当前研究/课程安排
- W1：椅子快速设计热身，普通AI；旧数据继续保留。
- **W2（9/21）：正式实验前共同AI试用课。所有学生统一普通AI，不分A/B，不做前测。**
- W3–W8：正式主项目《辅助绘画装置》，W3前按年级分层随机；A为学业求助支持型AI，B为普通AI。
- W8：正式项目结束后做14题学业求助意图问卷。
- W9–W11：撤除支持，两组统一普通AI做迁移任务。
- W12–W13：访谈、展示与归档。

## W2：约50分钟，零材料、纯网页
### 主任务｜重新设计学校午餐体验
来源：Stanford d.school `Redesign the School Lunch Experience` 的课堂适配。

流程：
1. 阅读统一午餐情境资料；
2. 从原始记录中识别3个重要问题/需要，并写证据；
3. 只选一个优先问题并形成第一版问题定义；
4. 提出3个解决方式明显不同的方向；
5. 作出初步选择并说明优点、风险和依据；
6. 点击“查看新反馈”，获得统一的新约束；
7. 决定是否修订，并写最终方案。

### 可选加练｜Marisol 的储物柜问题
来源：TeachEngineering `Solving Everyday Problems Using the Engineering Design Cycle`。
只有在主任务最终方案完成后才可打开。先根据“5分钟课间 + 储物柜混乱”做第一判断，再解锁预算、尺寸、承重等新增条件并修订。**加练全部为文字任务，不需要制作、画图或上传图片。**

### 50分钟课堂建议
- 0–5分钟：登录、说明任务规则；
- 5–30分钟：午餐主任务前半段与方案选择；
- 30–40分钟：查看统一新反馈并完成修订；
- 40–47分钟：有余力的学生进入储物柜加练；
- 47–50分钟：检查保存与提交。

## AI使用说明
W2定位为**平台/编码试用课**，不是“学生是否会自然求助”的正式基线。学生端只做中性说明：

> 本节会使用右侧AI助手。请至少实际使用1次；具体什么时候使用、向AI询问什么、是否继续追问，都由你自己决定。

平台不会提示“最不确定时问AI”“需要比较时问AI”等求助策略。为了防止AI接口故障阻塞课堂，后台不会因未成功使用AI而禁止最终提交；若未使用，会记录 `ai_required_not_used_at_submit` 事件供课后检查。

## v11.22 新增研究数据
### 1. AI输入草稿事件（不保存被删除的具体文字）
- `ai_draft_started`：开始在AI输入框输入；
- `ai_draft_deleted_unsent`：输入后全部删除且未发送；
- `ai_draft_left_unsent`：页面离开/隐藏时输入框仍有未发送内容；
- `ai_draft_sent`：该草稿最终发送。

只保存时长、最大字符数、编辑次数等行为元数据，不保存学生删掉的草稿全文。

### 2. 聊天历史回看
学生向上滚动并停留约2秒查看旧回复时，记录 `chat_history_revisit` 候选事件。该事件仅说明“回看旧消息”，后续是否编码为 Processing.Returning 由人工编码规则决定。

### 3. 任务文本版本历史
重要任务文本框不再只保留最后答案。只要内容真实发生变化，服务器会保存版本：
- `field_key` / `field_revision_no`；
- `previous_text` / `text`；
- `created_at`；
- `save_reason`；
- 最近一条AI回复的 `last_ai_message_id` 与 `last_ai_message_at`；
- `seconds_since_last_ai_reply`。

前端停止输入约2.5秒、离开文本框、手动保存、AI发送前、任务提交等节点会触发保存；相同内容不会重复生成版本。

### 4. 导出
教师后台“任务记录 + 学生作品 ZIP”现在同时包含：
- `task_records.csv`：每课次当前/最终文本；
- `task_revisions.csv`：版本历史；
- `behavior_events.csv`：草稿、回看、新反馈等事件；
- `works/`：需要上传作品/证据图片的课次。

“完整 JSON 备份”也会包含每课次 `revisions`。

## 问卷
平台保留14题学业求助意图情境适配稿，但 **W2不弹前测**。当前计划只在W8正式主项目结束后做项目结束测量。

## 旧数据保留
重新部署 v11.22 不会因为代码更新清空 W1。存储根路径仍为：
`runs/<EXPERIMENT_RUN_ID>/course-v11-enhanced/`

必须继续使用同一个项目、同一 `BLOB_STORE_NAME` 和同一 `EXPERIMENT_RUN_ID`。不要点击“整批更换学生名单”，也不要重置 W1/W2，除非确实要清空。


## v11.22 求助过程证据导出补强

- “AI求助过程数据 ZIP”一次导出 `chat_messages.csv`、`behavior_events.csv`、`task_revisions.csv`、`process_timeline.csv` 和允许课次中的聊天图片。
- 每轮学生—AI交互新增 `interaction_id`，并记录 `client_sent_at`、`server_received_at`、`ai_request_started_at`、`ai_response_received_at`、`ai_latency_ms`。
- 学生发送AI消息时同步记录最近正在编辑的任务字段 `task_field_key / label / stage`，用于判断“该请求发生在任务哪个步骤”，平台不自动做 IHS/EHS 编码。
- 任务文本版本历史新增字段标签与阶段；统一时间线仅合并原始证据，不做心理状态推断。
- W2关闭聊天图片，只用文字；W1、W3及以后仍可按课程需要上传聊天图片。
- 两种AI共用事实约束：不得把任务材料中没有的具体数字、比例、时长、调查结果或效果量编造成事实。
- 当前问卷路线为 W8 posttest-only；正式问卷CSV只导出后测。历史前测若曾测试，只保留在完整JSON/后台，不进入当前正式分析。
