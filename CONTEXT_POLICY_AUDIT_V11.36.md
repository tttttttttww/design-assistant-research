# AI任务上下文审计 v11.36

正式干预与迁移阶段：
- 不传 session.title
- 不传 session.brief
- 不传 session.requirements
- 不传 session.prompt_context
- 不传材料银行
- 不传任务字段当前文字内容
- 不传学生平台表单答案给AI
- 保留：学生真正发送给AI的消息、同一AI会话历史、学生主动发送到聊天的图片

因此，学生若只问“给这类人群做个装置怎么做”，但此前AI对话没有说明“这类人群”是谁，AI不应知道课堂中的具体使用者前提。
