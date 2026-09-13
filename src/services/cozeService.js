class CozeService {
  token() {
    const v = process.env.COZE_ACCESS_TOKEN;
    if (!v) throw new Error('Missing COZE_ACCESS_TOKEN');
    return v;
  }
  botId(variant = 'free') {
    const id = variant === 'supported'
      ? process.env.COZE_SUPPORTED_BOT_ID
      : (process.env.COZE_FREE_BOT_ID || process.env.COZE_AUTONOMOUS_BOT_ID);
    if (!id) throw new Error(variant === 'supported' ? 'Missing COZE_SUPPORTED_BOT_ID' : 'Missing COZE_FREE_BOT_ID');
    return id;
  }
  modelName() { return process.env.COZE_MODEL_NAME || 'configured-in-coze'; }
  headers() { return { Authorization: `Bearer ${this.token()}`, 'Content-Type': 'application/json' }; }

  async createConversation(participantId, sessionId, courseSessionId, variant) {
    if (process.env.COZE_MOCK === '1') return `mock_conv_${participantId}_${courseSessionId}_${sessionId}`;
    const { default: axios } = await import('axios');
    const response = await axios.post('https://api.coze.cn/v1/conversation/create', {
      bot_id: this.botId(variant),
      meta_data: {
        participant_id: participantId,
        session_id: sessionId,
        course_session_id: courseSessionId,
        ai_variant: variant,
        experiment_run_id: process.env.EXPERIMENT_RUN_ID || 'default',
      },
    }, { headers: this.headers(), timeout: 20000 });
    const id = response.data?.data?.id;
    if (!id) throw new Error(`Coze会话创建失败：${response.data?.msg || '未返回 conversation id'}`);
    return id;
  }

  async uploadImage({ buffer, fileName, mime }) {
    if (!buffer) return '';
    if (process.env.COZE_MOCK === '1') return `mock_file_${Date.now()}`;
    try {
      const form = new FormData();
      form.append('file', new Blob([buffer], { type: mime || 'image/jpeg' }), fileName || `image_${Date.now()}.jpg`);
      const response = await fetch('https://api.coze.cn/v1/files/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token()}` },
        body: form,
      });
      let body = {};
      try { body = await response.json(); } catch (_) {}
      const id = body?.data?.id || body?.data?.file_id;
      if (!response.ok || body?.code && body.code !== 0 || !id) {
        const detail = body?.msg || body?.message || `HTTP ${response.status}`;
        throw new Error(detail);
      }
      return String(id);
    } catch (e) {
      const msg = e?.message || '未知错误';
      throw Object.assign(new Error(`Coze图片上传失败：${msg}。请确认当前 COZE_ACCESS_TOKEN 已授权“文件-uploadFile”权限。`), { status: 502 });
    }
  }

  buildAdditionalMessage(message, { fileId = '', imageUrl = '' } = {}) {
    if (!fileId && !imageUrl) return { role: 'user', type: 'question', content: message, content_type: 'text' };
    const image = fileId ? { type: 'image', file_id: fileId } : { type: 'image', file_url: imageUrl };
    // Match Coze's documented multimodal examples exactly: image object first, then one text object.
    const objects = [
      image,
      { type: 'text', text: message },
    ];
    return { role: 'user', type: 'question', content: JSON.stringify(objects), content_type: 'object_string' };
  }

  debugDetail(body, fallback = '') {
    const d = body?.detail || {};
    const last = body?.data?.last_error || body?.last_error || {};
    const bits = [];
    const code = last?.code ?? body?.code;
    const msg = last?.msg || body?.msg || body?.message;
    if (code !== undefined && code !== null && String(code) !== '' && Number(code) !== 0) bits.push(`code=${code}`);
    if (msg) bits.push(`msg=${msg}`);
    if (d?.logid) bits.push(`logid=${d.logid}`);
    return bits.join('；') || fallback;
  }

  async sendMessage({ participantId, sessionId, courseSessionId, conversationId, message, image = null, imageUrl = '', variant }) {
    if (process.env.COZE_MOCK === '1') return {
      bot_id: this.botId(variant),
      conversation_id: conversationId || `mock_conv_${participantId}_${courseSessionId}_${sessionId}`,
      chat_id: `mock_chat_${Date.now()}`,
      message_id: `mock_msg_${Date.now()}`,
      assistant_message: `模拟${variant === 'supported' ? '支持型' : '自由'}AI回复：我收到了“${String(message).slice(-80)}”${image || imageUrl ? '，并收到了1张图片。' : '。'}`,
      model: this.modelName(),
      coze_file_id: image ? `mock_file_${Date.now()}` : '',
    };
    const { default: axios } = await import('axios');
    const active = conversationId || await this.createConversation(participantId, sessionId, courseSessionId, variant);
    const botId = this.botId(variant);

    // Prefer Coze's own file upload API. This avoids requiring Coze to fetch a temporary/public URL from our site.
    let cozeFileId = '';
    if (image?.buffer) cozeFileId = await this.uploadImage(image);

    let start;
    try {
      start = await axios.post(`https://api.coze.cn/v3/chat?conversation_id=${encodeURIComponent(active)}`, {
        bot_id: botId,
        user_id: participantId,
        stream: false,
        auto_save_history: true,
        additional_messages: [this.buildAdditionalMessage(message, { fileId: cozeFileId, imageUrl: cozeFileId ? '' : imageUrl })],
      }, { headers: this.headers(), timeout: 30000 });
    } catch (e) {
      const detail = this.debugDetail(e?.response?.data, e?.message || 'HTTP request failed');
      throw Object.assign(new Error(`Coze对话启动请求失败：${detail}${cozeFileId ? `；file_id=${cozeFileId}` : ''}`), {
        status: 502, coze_file_id: cozeFileId, stage: 'chat_start', raw: e?.response?.data || null,
      });
    }
    const chatId = start.data?.data?.id;
    if (!chatId) {
      const detail = this.debugDetail(start.data, '未返回 chat id');
      throw Object.assign(new Error(`Coze对话启动失败：${detail}${cozeFileId ? `；file_id=${cozeFileId}` : ''}`), { status: 502, coze_file_id: cozeFileId, stage: 'chat_start' });
    }
    let status = start.data?.data?.status || 'in_progress';
    let lastError = start.data?.data?.last_error || null;
    let lastRetrieve = start.data;
    const started = Date.now();
    while (['created','in_progress'].includes(status)) {
      if (Date.now() - started > 80000) throw new Error('Coze response timeout');
      await new Promise(r => setTimeout(r, 900));
      const q = await axios.get('https://api.coze.cn/v3/chat/retrieve', {
        params: { conversation_id: active, chat_id: chatId },
        headers: { Authorization: `Bearer ${this.token()}` },
        timeout: 15000,
      });
      status = q.data?.data?.status;
      lastRetrieve = q.data;
      lastError = q.data?.data?.last_error || lastError;
      if (['failed','canceled','required_action','requires_action'].includes(status)) {
        const detail = this.debugDetail(q.data, this.debugDetail({ data: { last_error: lastError } }, 'Coze未返回具体错误'));
        throw Object.assign(new Error(`Coze chat ${status}：${detail}；chat_id=${chatId}${cozeFileId ? `；file_id=${cozeFileId}` : ''}`), {
          status: 502, coze_file_id: cozeFileId, chat_id: chatId, stage: 'chat_retrieve', raw: q.data || null,
        });
      }
    }
    if (status !== 'completed') {
      const detail = this.debugDetail(lastRetrieve, `unexpected status=${status}`);
      throw Object.assign(new Error(`Coze对话未正常完成：${detail}；chat_id=${chatId}${cozeFileId ? `；file_id=${cozeFileId}` : ''}`), { status: 502, coze_file_id: cozeFileId, chat_id: chatId, stage: 'chat_terminal' });
    }

    const list = await axios.get('https://api.coze.cn/v3/chat/message/list', {
      params: { conversation_id: active, chat_id: chatId },
      headers: { Authorization: `Bearer ${this.token()}` },
      timeout: 15000,
    });
    const answers = (list.data?.data || []).filter(m => m.role === 'assistant' && (m.type === 'answer' || !m.type));
    return {
      bot_id: botId,
      conversation_id: active,
      chat_id: chatId,
      message_id: answers.at(-1)?.id || '',
      assistant_message: answers.map(m => m.content).filter(Boolean).join('\n') || '抱歉，这一轮没有生成可显示的回复。',
      model: start.data?.data?.model || this.modelName(),
      coze_file_id: cozeFileId,
    };
  }
}
export const cozeService = new CozeService();
