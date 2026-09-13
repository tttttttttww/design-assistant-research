# Design Thinking + GenAI Help-Seeking Research Platform v11 Enhanced 11.2

用于12课时设计思维课程与生成式AI学业求助研究的数据采集平台。

## 这一版新增

- **教师后台完整保留并增强**：首页直接有“进入教师后台”，也可以直接访问 `/admin.html`。
- 后台实时查看：学生是否进入任务、首次打开AI时间、首次发送消息时间、AI消息数、AI聊天图片数、任务图片数、提交状态。
- 点击任一学生编号，可查看 **12课时完整记录**：文字、任务作品、AI聊天、聊天图片、时间戳和系统事件。
- 正式数据一键导出：学生信息、课次记录、AI聊天、聊天图片索引、事件日志、完整JSON。
- **AI聊天支持图片**：学生可以把草图、原型、测试照片和文字一起发给AI。每条图片消息都和对应学生消息、课次、时间戳绑定保存。
- AI聊天图片能力对A/B两组完全一致；组间差异仍只来自两只Coze智能体的系统提示词。
- 学生端不再显示“候选任务”的教师说明；候选标记只在教师后台出现。
- 学生端AI说明改为中性表述：“本节任务中可以使用AI设计助手，也可以不使用。”
- ZIP中**不放Coze智能体提示词**，避免和你当前已确定的最新版提示词混淆；请直接在Coze中粘贴你手头的两组最新版提示词。

## 研究结构

- W1：椅子快速设计挑战，pilot，全部自由AI。
- W2：正式基线短任务，全部自由AI；先任务后问卷。
- W3：辅助绘画装置主项目启动，全部自由AI。
- W4-W9：A组支持型AI，B组自由AI。
- W10-W11：撤除支持，两组统一回到自由AI，用于迁移/保持观察。
- W12：课程回顾与后测，无AI。

## 数据字段

平台自动记录：

- `task_started_at`
- `first_ai_open_at` / `first_ai_open_latency_seconds`
- `first_user_message_at` / `first_user_message_latency_seconds`
- `ai_open_count`
- 每条学生/AI消息及时间戳
- `message_has_image`
- 聊天图片元数据和对应消息序号
- 任务文字字段
- 任务作品/证据图片
- 提交时间
- 系统事件日志

注意：`first_user_message_at` 只是“首次发送给AI的消息”，**不自动等于首次学业求助**。正式的首次求助仍需后续行为编码判断哪条消息真正具有求助功能。

## 教师后台

入口：`/admin.html`

正式导出只包含 S01-S30，自动排除 S00：

- `participants.csv`
- `session_records.csv`
- `chat_messages.csv`
- `chat_attachments.csv`
- `events.csv`
- `course_research_all.json`

S00测试历史单独导出：

- `S00_test_archives.json`

## AI图片说明

聊天图片通过平台存储后，以公开图片URL发送给Coze多模态对话接口。因此：

1. 两只Coze智能体必须使用**支持图片理解/视觉输入**的同一底层模型；
2. 支持 JPG、PNG、WEBP，每次最多1张，≤10MB；
3. 图片消息必须同时配一段文字，便于判断学生的真实求助意图；
4. v11.3 起，聊天图片会先通过 Coze `/v1/files/upload` 上传并取得 `file_id`，再交给智能体识图，不再依赖 Coze 回访本站图片 URL。请确保 `COZE_ACCESS_TOKEN` 已授权“文件-uploadFile”权限。`PUBLIC_BASE_URL` 仅保留为兼容备用。

## 部署

见 `DEPLOY_FIRST.md`。


## 管理员误触重置（11.2）
教师后台支持按学生重置任意课次，以及批量重置当前课次 S00–S30。重置前自动把当前结构化记录保存到 `reset-archives/`；正式 CSV/JSON 导出不包含这些归档。为防误操作，批量重置必须二次确认并输入 `RESET Wn`。


## v11.5 草稿自动保存修复
- 左侧任务文字输入会自动保存（输入停止约1秒后保存，离开输入框时再次保存）。
- 打开AI、发送AI消息、上传任务图片前，平台会先保存左侧尚未提交的文字，防止界面重绘导致内容丢失。
- “保存当前记录”按钮继续保留，可手动确认保存。
