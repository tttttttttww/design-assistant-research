# v11.5 image-debug check

- Multimodal message now matches Coze documented shape more strictly: `type=question`, image object first, text object second.
- S00 receives Coze stage/chat_id/file_id/logid/error details when available.
- Formal students still receive a generic error; debugging internals are not exposed to them.
- Failed S00 local image is retained for diagnosis; formal failed uploads are cleaned.
- Existing 12-session routing, admin dashboard, reset/archive, exports, and A/B/transfer routing retained.

- v11.5: verified task draft autosave and pre-action persistence hooks in task.js.
