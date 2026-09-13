# v11 部署顺序

1. 用本ZIP内容替换当前GitHub项目（建议先新建分支或保留v10标签）。
2. 推送GitHub，等待腾讯云 EdgeOne Pages 重新部署。
3. 在腾讯云环境变量中确认：
   - `COZE_ACCESS_TOKEN`
   - `COZE_FREE_BOT_ID`
   - `COZE_SUPPORTED_BOT_ID`
   - `ADMIN_PASSWORD`
   - `BLOB_STORE_NAME`
   - `EXPERIMENT_RUN_ID=design-thinking-course-202609`
4. 打开 `/health`，应显示 `course-v11`。
5. 打开 `/admin.html`，先把当前课次设为 W1，并保持“开放当前课次”。
6. 用 S00 登录，从任务开始直接测试AI：
   - 不填写任何字段，先打开AI并发消息；应允许；
   - 再填写任务、上传图片并提交；
   - 后台应看到首次打开AI和首次发消息的时延。
7. 后台把当前课次依次切到 W2-W12，用同一个S00页面刷新即可预览各课任务；无需每次重新登录。
8. W4-W9测试A/B路由：后台将S00 condition设为A，刷新并发消息；再改B重复测试。A应走支持型Bot，B应走自由Bot。

## 重要

- S00重新从登录页进入会归档并清空上一轮S00数据；如果你只是连续预览W1-W12，不要回登录页，直接在后台切换课次后刷新S00任务页。
- 正式学生S01-S30编号始终不变。
- W2/W10/W11目前是候选任务，正式研究前可以只改 `src/config/researchConfig.js`。
- 问卷题项尚未写入代码，这是故意的：等中文版冻结后再加，避免现在误用未定稿题项。
