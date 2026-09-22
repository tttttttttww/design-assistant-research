# v11.23 部署与历史数据检查

1. 用本 ZIP 更新当前 GitHub 项目并等待 EdgeOne Pages 部署完成。
2. **不要修改 `BLOB_STORE_NAME` 或 `EXPERIMENT_RUN_ID`**；这样原有 W1/W2 记录继续保留。
3. 如果还是同一批学生，不要点“整批更换学生名单”。
4. 部署后先用 S00 做一次数据链测试：
   - 在任务文本框输入并修改两次；
   - 打开AI，发送至少2轮文字消息；
   - 输入一段AI草稿后全部删除；
   - 向上回看旧AI回复并停留2秒以上；
   - 再修改一个任务文本字段并提交。
5. 到教师后台下载 **“AI求助过程数据 ZIP”**，确认其中有：
   - `chat_messages.csv`
   - `behavior_events.csv`
   - `task_revisions.csv`
   - `process_timeline.csv`
   - 如该课允许聊天图片，则还有 `chat_images/`
6. 重点检查：
   - `chat_messages.csv` 中学生/AI同一轮有相同 `interaction_id`；
   - `ai_latency_ms` 不再是保存时产生的毫秒级假时间，而是服务端实际等待AI的时长；
   - `task_field_key / label / stage` 能显示学生发消息时大致处于哪个任务步骤；
   - `behavior_events.csv` 能看到 `ai_draft_deleted_unsent`、`chat_history_revisit` 等；
   - `task_revisions.csv` 能看到 V1/V2/V3 及最近AI回复关联；
   - `process_timeline.csv` 能按学生×课次把上述证据按时间顺序合并。
7. W2聊天图片已关闭；W1、W3及以后仍可按课程需要上传聊天图片。
8. 正式问卷按钮现在导出 W8 后测 CSV，不再生成当前研究不用的前测空行。
9. 两组AI都必须使用 `COZE_PROMPTS.md` 中的共同事实规则；这条规则不是实验组干预差异。
10. 现有历史CSV不会被“补出”旧版本当时没有采集的字段；新增字段只从部署 v11.22 / v11.23 以后开始真实记录。旧W2数据仍可继续用于试编码，但不能反推未采集的草稿/版本/任务阶段信息。


## 部署后第一件事
1. 登录教师后台，先不要重置任何课次。
2. 打开“历史课次 → 存储诊断 / 可恢复归档”，点击“检查历史数据”。
3. 重点看 W2 的 `record` / `messages` 是否大于0。
4. 如果“最近可恢复归档”里出现 Sxx W2，可在对应当前课次为空时按按钮恢复；恢复前系统不会覆盖已有活动数据。
5. 再到“实时AI对话”用 S00 测试：学生发出消息后，后台应先出现学生问题和“AI处理中”，随后显示AI回复。
